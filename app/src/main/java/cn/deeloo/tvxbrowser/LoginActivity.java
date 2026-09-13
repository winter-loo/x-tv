package cn.deeloo.tvxbrowser;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Matrix;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.UUID;
import org.json.JSONObject;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.StorageController;
import org.mozilla.geckoview.WebRequestError;

/** Native entry and one dedicated authentication tab, with no reader or loading overlay. */
public final class LoginActivity extends Activity {
    private final LoginFlow flow = new LoginFlow();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private LinearLayout entry, browserPane, toolbar;
    private TextView entryStatus, webStatus;
    private Button googleButton, returnButton, checkButton;
    private GeckoView view;
    private GeckoSession session, popup;
    private NavigationBridge bridge;
    private XReadClient reader;
    private LoginAssist assist;
    private String attempt;
    private boolean googlePending, googlePromptVisible, credentialsReady, resumed, leaving, clearing;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        reader = new XReadClient(this);
        buildViews();
        if (getIntent().getBooleanExtra("logout", false)) logout();
        else {
            render("正在检查已有登录，你也可以直接选择登录方式。");
            root.post(() -> begin(false, false, false));
        }
    }

    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) {
        TextView text = new TextView(this); text.setText(value); text.setTextSize(size); text.setTextColor(0xffe6edf4);
        text.setPadding(0,dp(6),0,dp(6)); return text;
    }
    private Button button(LinearLayout parent, String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setTextSize(18);
        button.setTextColor(0xffe6edf4); button.setAllCaps(false); button.setFocusable(true);
        button.setContentDescription(label);
        button.setOnFocusChangeListener((v, focused) -> {
            GradientDrawable shape = new GradientDrawable(); shape.setCornerRadius(dp(10));
            shape.setColor(focused ? 0xff075a87 : 0xff182532);
            shape.setStroke(dp(focused ? 3 : 1), focused ? 0xff59c8ff : 0xff405364);
            v.setBackground(shape);
        });
        GradientDrawable shape = new GradientDrawable(); shape.setCornerRadius(dp(10));shape.setColor(0xff182532);
        button.setBackground(shape); button.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(parent == toolbar ? -2 : -1,dp(52));
        params.setMargins(dp(4),dp(5),dp(4),dp(5)); parent.addView(button, params); return button;
    }
    private void buildViews() {
        root = new FrameLayout(this); root.setBackgroundColor(0xff090d14);setContentView(root);
        browserPane = new LinearLayout(this);browserPane.setOrientation(LinearLayout.VERTICAL);
        root.addView(browserPane,new FrameLayout.LayoutParams(-1,-1));
        view = new GeckoView(this); view.setViewBackend(GeckoView.BACKEND_TEXTURE_VIEW);
        view.setBackgroundColor(0xff090d14);browserPane.addView(view,new LinearLayout.LayoutParams(-1,0,1));
        webStatus = text("上下选择网页控件，确认继续；菜单键打开下方工具。",14);
        browserPane.addView(webStatus);
        toolbar = new LinearLayout(this);toolbar.setGravity(Gravity.CENTER);browserPane.addView(toolbar);
        button(toolbar,"回到网页",() -> view.requestFocus());
        button(toolbar,"手机辅助输入",this::startAssist);
        button(toolbar,"重新加载",() -> {GeckoSession target=displayed();if(target!=null)target.reload();});
        returnButton = button(toolbar,"返回登录方式",this::cancel);
        entry = new LinearLayout(this);entry.setOrientation(LinearLayout.VERTICAL);entry.setPadding(dp(24),dp(14),dp(24),dp(14));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(560),-2,Gravity.CENTER);
        root.addView(entry,params);
        TextView title=text("登录 X",30);title.setGravity(Gravity.CENTER);entry.addView(title);
        entryStatus=text("选择一种登录方式",16);entryStatus.setGravity(Gravity.CENTER);entry.addView(entryStatus);
        googleButton=button(entry,"使用 Google 账号登录",() -> begin(true,true,false));
        button(entry,"使用 X 账号登录",() -> begin(true,false,false));
        button(entry,"用手机辅助登录",() -> begin(true,false,true));
        checkButton=button(entry,"重新检查已有登录",() -> begin(false,false,false));
        button(entry,"退出应用",this::finish);
    }

    private void begin(boolean visible, boolean google, boolean phone) {
        if (leaving || clearing || flow.state()==LoginFlow.State.CLOSED) return;
        disposeAttempt();
        final int ticket=flow.begin(visible);
        attempt=UUID.randomUUID().toString();
        final String id=attempt;
        googlePending=google;googlePromptVisible=false;credentialsReady=false;
        render(visible ? "正在打开 X 登录页面… 上下选择，确认继续。" : "正在检查已有登录，你可以随时选择登录方式。");
        GeckoSessionSettings settings=new GeckoSessionSettings.Builder()
            .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
            .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP).build();
        session=new GeckoSession(settings);
        final GeckoSession main=session;
        bridge=new NavigationBridge(TvXApplication.getRuntime(),main);
        bridge.setAuthListener(message -> {
            if (!current(ticket,main) || !id.equals(message.optString("attempt"))) return;
            String event=message.optString("event");
            if (event.equals("auth_tap") && popup==null && flow.state()==LoginFlow.State.WEB) {
                tap(main,message.optInt("x",-1),message.optInt("y",-1));
            } else if (event.equals("auth_state")) {
                if (message.optBoolean("authenticated") && flow.authenticated(ticket)) verify(ticket,main);
                if (google && message.optBoolean("googlePrompt") && !googlePromptVisible && flow.state()==LoginFlow.State.WEB) {
                    googlePromptVisible=true;googlePending=false;
                    bridge.sendAuth("authGoogle",id);
                    status("请在 Google 账号确认框中继续。上下选择，确认登录。");
                } else if (googlePending && message.optBoolean("googleReady") && flow.state()==LoginFlow.State.WEB) {
                    googlePending=false;
                    bridge.sendAuth("authGoogle",id);
                }
                if (message.optBoolean("pageReady") && flow.state()==LoginFlow.State.ENTRY)
                    entryStatus.setText("选择登录方式。Google 或 X 的验证步骤会在下一页继续。");
            } else if (event.equals("auth_google") && !message.optBoolean("opened"))
                webStatus.setText("Google 入口尚未就绪。可在网页中选择 Google，或重新加载。");
        });
        bridge.setReadTemplateListener(request -> {
            if (!current(ticket,main) || !id.equals(request.optString("authAttempt"))) return;
            reader.accept(request);credentialsReady=reader.available();verify(ticket,main);
        });
        main.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override public void onPageStop(GeckoSession s,boolean success) {
                if (!current(ticket,s)) return;
                if (!success) status("页面连接未完成，可重新加载或返回登录方式。");
                bridge.sendAuth("authState",id);
            }
        });
        main.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override public void onFocusRequest(GeckoSession s) {
                if (current(ticket,s) && flow.state()==LoginFlow.State.WEB && resumed) view.requestFocus();
            }
        });
        main.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public GeckoResult<GeckoSession> onNewSession(GeckoSession s,String uri) {
                if (!current(ticket,s) || !flow.popup(ticket)) return GeckoResult.fromValue(null);
                final GeckoSession child=new GeckoSession(main.getSettings());popup=child;
                child.setContentDelegate(new GeckoSession.ContentDelegate() {
                    @Override public void onCloseRequest(GeckoSession closing) { closePopup(ticket,main,closing); }
                });
                child.setProgressDelegate(new GeckoSession.ProgressDelegate() {
                    @Override public void onPageStop(GeckoSession s,boolean success) {
                        if (current(ticket,main) && popup==s)
                            status(success ? "完成 Google 账号确认后，会自动返回 X。" : "Google 页面连接未完成，可重新加载或返回。");
                    }
                });
                view.setSession(child);
                TvXApplication.getRuntime().getWebExtensionController().setTabActive(main,false);
                TvXApplication.getRuntime().getWebExtensionController().setTabActive(child,true);
                render("请完成 Google 账号确认；返回键关闭这个窗口。");
                return GeckoResult.fromValue(child);
            }
            @Override public GeckoResult<String> onLoadError(GeckoSession s,String uri,WebRequestError error) {
                if(current(ticket,s))status("网页暂时无法连接。菜单键打开工具，可重试或返回。");
                return null;
            }
        });
        main.open(TvXApplication.getRuntime());view.setSession(main);
        TvXApplication.getRuntime().getWebExtensionController().setTabActive(main,true);
        bridge.whenConnected(() -> {
            if (!current(ticket,main)) return;
            main.loadUri((visible ? BrowserActivity.X_LOGIN_URL : BrowserActivity.X_HOME_URL)+"#tvx-auth="+id);
            if (phone) startAssist();
        });
        ui.postDelayed(() -> {
            if (current(ticket,main) && flow.canShowPageLoadHint() && !googlePromptVisible)
                status("如网页没有继续，请用菜单键选择重新加载，或返回登录方式。");
        },25000);
    }

    private boolean current(int ticket,GeckoSession main) {
        return !leaving && !isFinishing() && flow.accepts(ticket) && session==main;
    }
    private void verify(int ticket,GeckoSession main) {
        if (!current(ticket,main) || !flow.verify(ticket,credentialsReady)) return;
        final JSONObject credentials=reader.credentials();
        render("X 已返回账号，正在验证登录是否可用…");
        reader.fetch("login-verify-"+ticket,"home","",null,(body,error) -> {
            if (!current(ticket,main)) return;
            if (!reader.matchesCredentials(credentials)) {cancel();entryStatus.setText("账号已变化，请重新选择登录方式。");return;}
            boolean success=LoginFlow.readableHome(body,error) && reader.markVerified(credentials);
            if(flow.verified(ticket,true,success)) {
                leaving=true;disposeAttempt();
                startActivity(new Intent(this,BrowserActivity.class));finish();
            } else render("暂时无法验证会话。可重新加载网页后再试，返回不会清除浏览器登录。");
        });
    }
    private void closePopup(int ticket,GeckoSession main,GeckoSession child) {
        if (!current(ticket,main) || popup!=child || !flow.popupClosed(ticket)) return;
        popup=null;view.setSession(main);child.close();
        TvXApplication.getRuntime().getWebExtensionController().setTabActive(main,true);
        render("继续完成 X 页面上的确认。确认可用后会自动进入阅读。");
        bridge.sendAuth("authState",attempt);
    }
    private GeckoSession displayed() { return popup!=null?popup:session; }
    private void tap(GeckoSession main,int x,int y) {
        if(x<0||y<0)return;
        Matrix matrix=new Matrix();main.getClientToSurfaceMatrix(matrix);
        float[] point={x,y};matrix.mapPoints(point);
        long now=SystemClock.uptimeMillis();
        MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,point[0],point[1],0);
        MotionEvent up=MotionEvent.obtain(now,now+40,MotionEvent.ACTION_UP,point[0],point[1],0);
        view.dispatchTouchEvent(down);view.dispatchTouchEvent(up);down.recycle();up.recycle();
    }
    private void render(String message) {
        boolean choosing=flow.state()==LoginFlow.State.ENTRY;
        entry.setVisibility(choosing?View.VISIBLE:View.GONE);
        browserPane.setVisibility(choosing?View.GONE:View.VISIBLE);
        root.setContentDescription("tvx-auth-"+flow.state().name().toLowerCase(java.util.Locale.ROOT));
        status(message);
        if(choosing)googleButton.requestFocus();else if(resumed)view.requestFocus();
    }
    private void status(String message) {entryStatus.setText(message);webStatus.setText(message);}
    private void cancel() {flow.cancel();disposeAttempt();render("选择登录方式。浏览器会保留已经完成的账号认证。");}
    private void startAssist() {
        if(assist!=null||session==null||flow.state()==LoginFlow.State.ENTRY)return;
        assist=new LoginAssist(this,view,()->assist=null);assist.start();
    }
    private void disposeAttempt() {
        ui.removeCallbacksAndMessages(null);
        if(assist!=null)assist.close();
        if(bridge!=null){bridge.close();bridge=null;}
        view.releaseSession();
        if(popup!=null){popup.close();popup=null;}
        if(session!=null){session.close();session=null;}
    }
    private void logout() {
        clearing=true;
        flow.cancel();disposeAttempt();reader.clear();render("正在退出此设备上的 X 登录…");
        entry.setEnabled(false);googleButton.setEnabled(false);
        StorageController storage=TvXApplication.getRuntime().getStorageController();
        long flags=StorageController.ClearFlags.COOKIES|StorageController.ClearFlags.DOM_STORAGES|StorageController.ClearFlags.AUTH_SESSIONS;
        storage.clearDataFromBaseDomain("x.com",flags).then(value -> storage.clearDataFromBaseDomain("twitter.com",flags))
            .accept(value -> {if(isFinishing())return;clearing=false;entry.setEnabled(true);googleButton.setEnabled(true);
                    checkButton.setText("重新检查已有登录");checkButton.setContentDescription("重新检查已有登录");
                    checkButton.setOnClickListener(v->begin(false,false,false));render("已退出 X。Google 账号保留，可以重新验证登录。");},
                error -> {if(isFinishing())return;clearing=false;entry.setEnabled(true);googleButton.setEnabled(true);
                    checkButton.setText("重试退出 X 登录");checkButton.setContentDescription("重试退出 X 登录");
                    checkButton.setOnClickListener(v->logout());render("退出未完成，可选择重试退出。");});
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int code=event.getKeyCode();
        if(code==KeyEvent.KEYCODE_BACK) {
            if(event.getAction()==KeyEvent.ACTION_DOWN && event.getRepeatCount()==0) {
                if(assist!=null)assist.close();
                else if(popup!=null)closePopup(flow.generation(),session,popup);
                else if(flow.state()==LoginFlow.State.ENTRY)finish();else cancel();
            }
            return true;
        }
        if(flow.state()==LoginFlow.State.ENTRY)return super.dispatchKeyEvent(event);
        if(code==KeyEvent.KEYCODE_MENU) {
            if(event.getAction()==KeyEvent.ACTION_DOWN)returnButton.requestFocus();return true;
        }
        GeckoSession target=displayed();
        if(target==null||!view.hasFocus())return super.dispatchKeyEvent(event);
        int mapped=code,meta=event.getMetaState();
        if(code==KeyEvent.KEYCODE_DPAD_DOWN)mapped=KeyEvent.KEYCODE_TAB;
        else if(code==KeyEvent.KEYCODE_DPAD_UP){mapped=KeyEvent.KEYCODE_TAB;meta|=KeyEvent.META_SHIFT_ON;}
        else if(code==KeyEvent.KEYCODE_DPAD_CENTER)mapped=KeyEvent.KEYCODE_ENTER;
        KeyEvent key=new KeyEvent(event.getDownTime(),event.getEventTime(),event.getAction(),mapped,
            event.getRepeatCount(),meta,event.getDeviceId(),event.getScanCode(),event.getFlags(),event.getSource());
        // Deliver to the displayed session's text input, not an unfocused ViewGroup child.
        if(event.getAction()==KeyEvent.ACTION_DOWN)return target.getTextInput().onKeyDown(mapped,key);
        if(event.getAction()==KeyEvent.ACTION_UP)return target.getTextInput().onKeyUp(mapped,key);
        return super.dispatchKeyEvent(event);
    }
    @Override protected void onResume(){super.onResume();resumed=true;if(entry!=null){if(flow.state()==LoginFlow.State.ENTRY)googleButton.requestFocus();else view.requestFocus();}}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getBooleanExtra("logout",false)&&!clearing)logout();}
    @Override protected void onPause(){resumed=false;super.onPause();}
    @Override protected void onStop(){if(assist!=null)assist.close();super.onStop();}
    @Override protected void onDestroy(){flow.close();disposeAttempt();reader.close();super.onDestroy();}
}
