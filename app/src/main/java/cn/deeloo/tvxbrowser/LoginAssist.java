package cn.deeloo.tvxbrowser;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.Date;
import java.util.concurrent.*;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;
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
                KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
                // Dedicated local HTTPS identity, unrelated to the APK distribution signing key.
                String alias = "tvx-login-assist-tls-v1";
                if (!keys.containsAlias(alias)) {
                    KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,"AndroidKeyStore");
                    generator.initialize(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
                        // Android TLS signs an already-hashed handshake via NONEwithRSA.
                        .setKeySize(2048).setDigests(KeyProperties.DIGEST_NONE,KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA512)
                        .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                        .setCertificateSubject(new X500Principal("CN=X TV Local Login"))
                        .setCertificateSerialNumber(BigInteger.ONE)
                        .setCertificateNotBefore(new Date(0))
                        .setCertificateNotAfter(new Date(4102444800000L)).build());
                    generator.generateKeyPair();
                }
                PrivateKey key = (PrivateKey)keys.getKey(alias,null);
                X509Certificate cert = (X509Certificate)keys.getCertificate(alias);
                X509KeyManager manager = new X509KeyManager() {
                    public String[] getClientAliases(String k,Principal[] p){return null;}
                    public String chooseClientAlias(String[] k,Principal[] p,java.net.Socket s){return null;}
                    public String[] getServerAliases(String k,Principal[] p){return "RSA".equals(k)?new String[]{alias}:null;}
                    public String chooseServerAlias(String k,Principal[] p,java.net.Socket s){return "RSA".equals(k)?alias:null;}
                    public X509Certificate[] getCertificateChain(String a){return alias.equals(a)?new X509Certificate[]{cert}:null;}
                    public PrivateKey getPrivateKey(String a){return alias.equals(a)?key:null;}
                };
                SSLContext tls = SSLContext.getInstance("TLSv1.2"); tls.init(new KeyManager[]{manager},null,new SecureRandom());
                byte[] html;
                try (java.io.InputStream input = activity.getAssets().open("login-assist.html")) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer=new byte[4096];int n;
                    while((n=input.read(buffer))!=-1)out.write(buffer,0,n);html=out.toByteArray();
                }
                LoginAssistServer ready = new LoginAssistServer(tls,address,pairing,html,new LoginAssistServer.Page(){
                    public byte[] frame() throws Exception { return capture(); }
                    public void input(JSONObject command) throws Exception { remoteInput(command); }
                });
                StringBuilder fingerprint = new StringBuilder();
                for(byte b:MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()))fingerprint.append(String.format(java.util.Locale.ROOT,"%02X",b&255));
                ui.post(() -> {
                    if(closed){ready.close();return;}
                    server=ready;ready.start();
                    dialog=new AlertDialog.Builder(activity).setTitle("手机 / 电脑辅助登录")
                        .setMessage("在同一局域网的浏览器打开：\n"+ready.url()+"\n\n配对码："+pairing.code()+
                            "\n\n首次访问：查看浏览器证书，核对 SHA-256 指纹后继续。\n"+fingerprint+
                            "\n\n连接有效期 10 分钟。点击远端画面选中输入框，再发送文字。登录信息保存在投影仪。")
                        .setPositiveButton("隐藏说明，继续登录",(d,w)->view.requestFocus())
                        .setNegativeButton("停止辅助登录",(d,w)->close()).create();
                    dialog.setOnCancelListener(d->close());dialog.show();ui.post(expiry);
                });
            } catch(Exception ignored) {
                ui.post(()->{if(!closed)Toast.makeText(activity,"无法开启辅助登录，请检查局域网连接",Toast.LENGTH_LONG).show();close();});
            }
        });
    }
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
        if(!kind.equals("tap")&&!kind.equals("text")&&!kind.equals("key"))throw new IllegalArgumentException();
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
                } else if(kind.equals("text")) {
                    String text=command.getString("text");if(text.length()>2048)throw new IllegalArgumentException();
                    EditorInfo info=new EditorInfo();
                    // Capture and input must target the same displayed session, including OAuth popups.
                    InputConnection input=view.onCreateInputConnection(info);
                    if(input==null||info.inputType==0)throw new IllegalStateException();
                    // On Android 7+, Gecko exposes its IME thread on InputConnection itself.
                    Handler inputHandler=input.getHandler();
                    (inputHandler==null?ui:inputHandler).post(() -> {
                        if(done.isCancelled())return;
                        try {
                            if(closed||pairing.expired()||!input.commitText(text,1))throw new IllegalStateException();
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
        if(dialog!=null)dialog.dismiss();onClosed.run();
    }
}
