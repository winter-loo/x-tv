package cn.deeloo.tvxbrowser;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import java.io.ByteArrayOutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.mozilla.geckoview.GeckoView;

/** Owns the temporary service; backgrounding the Activity always revokes remote access. */
final class LoginAssist implements AutoCloseable {
    private final Activity activity;
    private final GeckoView view;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService setup = Executors.newSingleThreadExecutor();
    private final LoginPairing pairing = new LoginPairing(SystemClock::elapsedRealtime);
    private volatile LoginAssistServer server;
    private volatile boolean closed;
    private AlertDialog dialog;
    private Bitmap qrBitmap;
    private final Runnable onClosed;
    private final Runnable expiry = new Runnable() {
        public void run() { if(pairing.expired())close();else ui.postDelayed(this,1000); }
    };
    LoginAssist(Activity activity, GeckoView view, Runnable onClosed) {
        this.activity=activity;this.view=view;this.onClosed=onClosed;
    }
    void start() {
        Toast.makeText(activity,"正在准备局域网辅助登录…",Toast.LENGTH_SHORT).show();
        setup.execute(() -> {
            try {
                InetAddress address = address();
                byte[] html;
                try (java.io.InputStream input = activity.getAssets().open("login-assist.html")) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer=new byte[4096];int n;
                    while((n=input.read(buffer))!=-1)out.write(buffer,0,n);html=out.toByteArray();
                }
                LoginAssistServer ready = new LoginAssistServer(address,pairing,html,new LoginAssistServer.Page(){
                    public byte[] frame() throws Exception { return capture(); }
                    public void input(JSONObject command) throws Exception { remoteInput(command); }
                });
                Bitmap qr = qrCode(qrPayload(ready.url(),pairing.code()),640);
                ui.post(() -> {
                    if(closed){ready.close();qr.recycle();return;}
                    server=ready;ready.start();
                    qrBitmap=qr;
                    LinearLayout content=new LinearLayout(activity);content.setOrientation(LinearLayout.VERTICAL);
                    int inset=dp(24);content.setPadding(inset,dp(8),inset,0);
                    TextView lead=new TextView(activity);lead.setText("手机扫码后自动配对");lead.setTextSize(20);lead.setGravity(Gravity.CENTER_HORIZONTAL);
                    content.addView(lead,new LinearLayout.LayoutParams(-1,-2));
                    ImageView image=new ImageView(activity);image.setImageBitmap(qr);image.setContentDescription("扫码打开辅助登录");
                    image.setBackgroundColor(Color.WHITE);image.setPadding(dp(10),dp(10),dp(10),dp(10));
                    LinearLayout.LayoutParams imageLayout=new LinearLayout.LayoutParams(dp(220),dp(220));
                    imageLayout.gravity=Gravity.CENTER_HORIZONTAL;imageLayout.topMargin=dp(12);imageLayout.bottomMargin=dp(12);
                    content.addView(image,imageLayout);
                    TextView help=new TextView(activity);
                    help.setText("扫码失败：浏览器打开\n"+ready.url()+"\n配对码："+pairing.code());
                    help.setTextSize(12);help.setTypeface(Typeface.MONOSPACE);
                    content.addView(help,new LinearLayout.LayoutParams(-1,-2));
                    dialog=new AlertDialog.Builder(activity).setTitle("手机 / 电脑辅助登录")
                        .setView(content)
                        .setPositiveButton("隐藏二维码，继续登录",(d,w)->view.requestFocus())
                        .setNegativeButton("停止辅助登录",(d,w)->close()).create();
                    dialog.setOnCancelListener(d->close());dialog.show();ui.post(expiry);
                });
            } catch(Exception ignored) {
                ui.post(()->{if(!closed)Toast.makeText(activity,"无法开启辅助登录，请检查局域网连接",Toast.LENGTH_LONG).show();close();});
            }
        });
    }
    static String qrPayload(String url,String code) { return url+"/#code="+code; }
    private static Bitmap qrCode(String value,int size) throws Exception {
        Map<EncodeHintType,Object> hints=new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.MARGIN,1);hints.put(EncodeHintType.CHARACTER_SET,"UTF-8");
        BitMatrix matrix=new QRCodeWriter().encode(value,BarcodeFormat.QR_CODE,size,size,hints);
        int[] pixels=new int[size*size];
        for(int y=0;y<size;y++)for(int x=0;x<size;x++)pixels[y*size+x]=matrix.get(x,y)?Color.BLACK:Color.WHITE;
        return Bitmap.createBitmap(pixels,size,size,Bitmap.Config.ARGB_8888);
    }
    private int dp(int value) { return Math.round(value*activity.getResources().getDisplayMetrics().density); }
    private InetAddress address() throws Exception {
        ConnectivityManager manager=(ConnectivityManager)activity.getSystemService(Activity.CONNECTIVITY_SERVICE);
        LinkProperties links=manager.getLinkProperties(manager.getActiveNetwork());
        if(links!=null)for(LinkAddress link:links.getLinkAddresses()) {
            InetAddress address=link.getAddress();
            if(address instanceof Inet4Address && address.isSiteLocalAddress())return address;
        }
        throw new java.io.IOException("No LAN IPv4");
    }
    private byte[] capture() throws Exception {
        CompletableFuture<Bitmap> result=new CompletableFuture<>();
        ui.post(()->{
            if(closed||pairing.expired()){result.completeExceptionally(new IllegalStateException());return;}
            view.capturePixels().accept(bitmap->{if(!result.complete(bitmap))bitmap.recycle();},result::completeExceptionally);
        });
        Bitmap bitmap;
        try { bitmap=result.get(4,TimeUnit.SECONDS); }
        catch(Exception e){result.cancel(false);throw e;}
        try {ByteArrayOutputStream out=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.JPEG,65,out);return out.toByteArray();}
        finally {bitmap.recycle();}
    }
    private void remoteInput(JSONObject command) throws Exception {
        String kind=command.optString("kind");
        if(!kind.equals("tap")&&!kind.equals("text")&&!kind.equals("edit")&&!kind.equals("key"))throw new IllegalArgumentException();
        CompletableFuture<Void> done=new CompletableFuture<>();
        ui.post(()->{
            if(done.isCancelled())return;
            try {
                if(closed||pairing.expired())throw new IllegalStateException();
                if(dialog!=null&&dialog.isShowing())dialog.dismiss();
                view.requestFocus();
                if(kind.equals("tap")) {
                    double x=command.getDouble("x"),y=command.getDouble("y");
                    if(!Double.isFinite(x)||!Double.isFinite(y)||x<0||x>1||y<0||y>1)throw new IllegalArgumentException();
                    long now=SystemClock.uptimeMillis();
                    MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,(float)x*view.getWidth(),(float)y*view.getHeight(),0);
                    MotionEvent up=MotionEvent.obtain(now,now+40,MotionEvent.ACTION_UP,(float)x*view.getWidth(),(float)y*view.getHeight(),0);
                    view.dispatchTouchEvent(down);view.dispatchTouchEvent(up);down.recycle();up.recycle();
                } else if(kind.equals("text")||kind.equals("edit")) {
                    String text=command.getString("text");
                    int delete=kind.equals("edit")?command.optInt("delete",-1):0;
                    if(text.length()>2048||delete<0||delete>2048)throw new IllegalArgumentException();
                    EditorInfo info=new EditorInfo();
                    // Capture and input must target the same displayed session, including OAuth popups.
                    InputConnection input=view.onCreateInputConnection(info);
                    if(input==null||info.inputType==0)throw new IllegalStateException();
                    // On Android 7+, Gecko exposes its IME thread on InputConnection itself.
                    Handler inputHandler=input.getHandler();
                    (inputHandler==null?ui:inputHandler).post(() -> {
                        if(done.isCancelled())return;
                        try {
                            if(closed||pairing.expired())throw new IllegalStateException();
                            boolean applied;
                            input.beginBatchEdit();
                            try {
                                applied=(delete==0||input.deleteSurroundingText(delete,0))&&
                                    (text.isEmpty()||input.commitText(text,1));
                            } finally { input.endBatchEdit(); }
                            if(!applied)throw new IllegalStateException();
                            done.complete(null);
                        } catch(Exception e){done.completeExceptionally(e);}
                    });
                    return;
                } else {
                    int key;
                    switch(command.optString("key")) {
                        case "Enter":key=KeyEvent.KEYCODE_ENTER;break;
                        case "Backspace":key=KeyEvent.KEYCODE_DEL;break;
                        case "Tab":key=KeyEvent.KEYCODE_TAB;break;
                        case "PageDown":key=KeyEvent.KEYCODE_PAGE_DOWN;break;
                        case "PageUp":key=KeyEvent.KEYCODE_PAGE_UP;break;
                        default:throw new IllegalArgumentException();
                    }
                    view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,key));
                    view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP,key));
                }
                done.complete(null);
            } catch(Exception e){done.completeExceptionally(e);}
        });
        try {done.get(4,TimeUnit.SECONDS);}catch(Exception e){done.cancel(false);throw e;}
    }
    public void close() {
        if(closed)return;closed=true;pairing.close();ui.removeCallbacks(expiry);
        if(server!=null)server.close();setup.shutdownNow();
        if(dialog!=null)dialog.dismiss();
        Bitmap bitmap=qrBitmap;qrBitmap=null;if(bitmap!=null&&!bitmap.isRecycled())bitmap.recycle();
        onClosed.run();
    }
}
