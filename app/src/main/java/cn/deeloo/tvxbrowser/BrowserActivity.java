package cn.deeloo.tvxbrowser;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Matrix;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.widget.TextView;
import android.os.Handler;
import android.os.Looper;
import android.net.Uri;
import android.view.MotionEvent;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebRequestError;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;

public class BrowserActivity extends Activity {
    private static final String TAG = "BrowserActivity";
    public static final String X_HOME_URL = "https://x.com/home";

    private View mLoading;
    private boolean mWaitingForPresentation = true;
    private boolean mUsingTvAdapter = true;
    private boolean mLoadRetryAvailable = false;
    private final Handler mUiHandler = new Handler(Looper.getMainLooper());
    private final Runnable mLoadTimeout = () -> {
        mLoadRetryAvailable = true;
        if (mWaitingForPresentation) ((TextView) findViewById(R.id.loading_text)).setText("加载较慢，请检查网络\n按确认重试，返回退出");
    };
    private GeckoView mGeckoView;
    private GeckoSession mSession;
    private final Deque<GeckoSession> mDetailSessions = new ArrayDeque<>();
    private NavigationBridge mBridge;
    private TvKeyRouter mKeyRouter;
    private GeckoSession mPopupSession = null;
    private boolean mShowingMock = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.e(TAG, "===> BrowserActivity.onCreate START <===");

        setContentView(R.layout.activity_browser);
        mGeckoView = findViewById(R.id.geckoview);
        mLoading = findViewById(R.id.loading_overlay);
        // A TextureView participates in the Activity's normal alpha/overlay
        // composition. Older projector SurfaceView implementations can punch
        // through an opaque sibling while their first buffer is attaching.
        mGeckoView.setViewBackend(GeckoView.BACKEND_TEXTURE_VIEW);
        mGeckoView.setAlpha(0f);
        mGeckoView.setBackgroundColor(0xff090d14);
        mGeckoView.coverUntilFirstPaint(0xff090d14);

        try {
            GeckoSessionSettings settings = new GeckoSessionSettings.Builder()
                    .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
                    .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
                    .build();
            mSession = new GeckoSession(settings);

            mBridge = new NavigationBridge(TvXApplication.getRuntime(), mSession);
            mBridge.setPresentationListener(() -> runOnUiThread(this::showPresentation));
            mBridge.setExitListener(() -> runOnUiThread(() -> { if (!mDetailSessions.isEmpty()) closeDetail(); else finish(); }));
            mBridge.setTapListener((x, y) -> {
                runOnUiThread(() -> {
                    if (mPopupSession != null) return;
                    Matrix transform = new Matrix();
                    activeSession().getClientToSurfaceMatrix(transform);
                    float[] point = {x, y};
                    transform.mapPoints(point);
                    long now = SystemClock.uptimeMillis();
                    MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, point[0], point[1], 0);
                    MotionEvent up = MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_UP, point[0], point[1], 0);
                    mGeckoView.dispatchTouchEvent(down);
                    mGeckoView.dispatchTouchEvent(up);
                    down.recycle();
                    up.recycle();
                });
            });
            mKeyRouter = new TvKeyRouter(mBridge, mSession, this::finish);

            // Register the content module so Gecko can complete DOM fullscreen
            // requests. The TV Activity remains immersive on both enter and exit.
            mSession.setContentDelegate(new GeckoSession.ContentDelegate() {
                @Override
                public void onFullScreen(GeckoSession session, boolean fullScreen) {
                    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN |
                            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                }

                @Override
                public void onFocusRequest(GeckoSession session) {
                    if (session == activeSession()) mGeckoView.requestFocus();
                }
            });

            mSession.setProgressDelegate(new GeckoSession.ProgressDelegate() {
                @Override
                public void onPageStart(GeckoSession session, String url) {
                    if (session != activeSession() || "about:blank".equals(url)) return;
                    String host = Uri.parse(url).getHost();
                    mWaitingForPresentation = "x.com".equals(host) || "twitter.com".equals(host);
                    mUsingTvAdapter = mWaitingForPresentation;
                    mLoadRetryAvailable = false;
                    mGeckoView.setAlpha(0f);
                    mLoading.setVisibility(View.VISIBLE);
                    mGeckoView.coverUntilFirstPaint(0xff090d14);
                    ((TextView) findViewById(R.id.loading_text)).setText("正在加载 X…");
                    mUiHandler.removeCallbacks(mLoadTimeout);
                    mUiHandler.postDelayed(mLoadTimeout, 25000);
                    Log.i(TAG, "===> Page started: " + url);
                }

                @Override
                public void onPageStop(GeckoSession session, boolean success) {
                    if (session != activeSession()) return;
                    if (!mUsingTvAdapter) showPresentation();
                    else if (!success) { mLoadRetryAvailable = true; ((TextView) findViewById(R.id.loading_text)).setText("连接未完成，按确认重试\n返回退出"); }
                    Log.i(TAG, "===> Page stopped, success: " + success);
                }

                @Override
                public void onProgressChange(GeckoSession session, int progress) {
                    Log.d(TAG, "Page progress: " + progress + "%");
                }
            });

            mSession.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
                @Override
                public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession session, LoadRequest request) {
                    Uri uri = Uri.parse(request.uri);
                    if (!"tvx".equals(uri.getScheme())) return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                    if (session == activeSession()) {
                        if ("post".equals(uri.getHost())) openDetail(uri.getQueryParameter("url"));
                        else if ("close-detail".equals(uri.getHost())) closeDetail();
                    }
                    return GeckoResult.fromValue(AllowOrDeny.DENY);
                }

                @Override
                public void onCanGoBack(GeckoSession session, boolean canGoBack) {
                    Log.i(TAG, "canGoBack: " + canGoBack);
                    if (session == activeSession()) mKeyRouter.setCanGoBack(canGoBack);
                }

                @Override
                public GeckoResult<GeckoSession> onNewSession(GeckoSession session, String uri) {
                    Log.e(TAG, "===> onNewSession requested");
                    GeckoSession popupSession = new GeckoSession(mSession.getSettings());
                    mPopupSession = popupSession;
                    showPresentation();
                    // GeckoView opens the returned session and preserves its opener.
                    popupSession.setProgressDelegate(new GeckoSession.ProgressDelegate() {
                        @Override
                        public void onPageStop(GeckoSession s, boolean success) {
                            Log.e(TAG, "OAuth popup loaded: " + success);
                        }
                    });
                    popupSession.setContentDelegate(new GeckoSession.ContentDelegate() {
                        @Override
                        public void onCloseRequest(GeckoSession s) {
                            Log.i(TAG, "===> Popup session onCloseRequest");
                            runOnUiThread(() -> {
                                if (mPopupSession == s) {
                                    mPopupSession = null;
                                    mGeckoView.setSession(activeSession());
                                    TvXApplication.getRuntime().getWebExtensionController().setTabActive(activeSession(), true);
                                    mBridge.sendCommand("restoreLogin", null);
                                }
                                s.close();
                            });
                        }
                    });
                    popupSession.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
                        @Override
                        public void onCanGoBack(GeckoSession s, boolean canGoBack) {
                            // Popup history must not overwrite the main tab's back state.
                        }
                    });
                    mGeckoView.setSession(popupSession);
                    TvXApplication.getRuntime().getWebExtensionController().setTabActive(activeSession(), false);
                    TvXApplication.getRuntime().getWebExtensionController().setTabActive(popupSession, true);
                    return GeckoResult.fromValue(popupSession);
                }

                @Override
                public GeckoResult<String> onLoadError(GeckoSession session, String uri, WebRequestError error) {
                    Log.e(TAG, "===> Page load error for URI: " + uri + " (code=" + error.code + ", category=" + error.category + ")");
                    return null;
                }
            });

            Log.e(TAG, "Opening session with runtime...");
            mSession.open(TvXApplication.getRuntime());
            mGeckoView.setSession(mSession);
            TvXApplication.getRuntime().getWebExtensionController().setTabActive(mSession, true);

            mBridge.whenReady(() -> handleIntent(getIntent()));
            Log.e(TAG, "===> BrowserActivity.onCreate FINISHED <===");
        } catch (Throwable t) {
            Log.e(TAG, "===> Exception in BrowserActivity.onCreate <===", t);
        }
    }

    private GeckoSession activeSession() {
        return !mDetailSessions.isEmpty() ? mDetailSessions.peekLast() : mSession;
    }

    private void openDetail(String url) {
        if (url == null) return;
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) || !"x.com".equals(uri.getHost()) ||
                uri.getPath() == null || !uri.getPath().matches("/[^/]+/status/[0-9]+")) return;
        GeckoSession parent = activeSession();
        GeckoSession detail = new GeckoSession(parent.getSettings());
        mDetailSessions.addLast(detail);
        detail.setContentDelegate(mSession.getContentDelegate());
        detail.setProgressDelegate(mSession.getProgressDelegate());
        detail.setNavigationDelegate(mSession.getNavigationDelegate());
        detail.open(TvXApplication.getRuntime());
        mWaitingForPresentation = true;
        mLoading.setVisibility(View.VISIBLE);
        ((TextView) findViewById(R.id.loading_text)).setText("正在加载帖子…");
        mGeckoView.setAlpha(0f);
        TvXApplication.getRuntime().getWebExtensionController().setTabActive(parent, false);
        mGeckoView.setSession(detail);
        mBridge.setSession(detail);
        TvXApplication.getRuntime().getWebExtensionController().setTabActive(detail, true);
        detail.loadUri(uri.buildUpon().appendQueryParameter("tvx_detail", "1").build().toString());
    }

    private void closeDetail() {
        if (mDetailSessions.isEmpty()) return;
        GeckoSession detail = mDetailSessions.removeLast();
        GeckoSession parent = activeSession();
        TvXApplication.getRuntime().getWebExtensionController().setTabActive(detail, false);
        mGeckoView.setSession(parent);
        mBridge.setSession(parent);
        TvXApplication.getRuntime().getWebExtensionController().setTabActive(parent, true);
        mUsingTvAdapter = true;
        showPresentation();
        detail.close();
        mBridge.sendCommand("getState", null);
        mGeckoView.requestFocus();
    }

    private void showPresentation() {
        mWaitingForPresentation = false;
        mUiHandler.removeCallbacks(mLoadTimeout);
        if (mLoading.getVisibility() == View.GONE) return;
        mGeckoView.setAlpha(1f);
        mGeckoView.postOnAnimation(() -> mGeckoView.postOnAnimation(() -> {
            if (mWaitingForPresentation || isFinishing()) return;
            mLoading.setVisibility(View.GONE);
            mGeckoView.requestFocus();
        }));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // A launcher resume must not reload /home and discard the current post.
        if (intent.hasExtra("url") || intent.hasExtra("action")) {
            while (!mDetailSessions.isEmpty()) closeDetail();
            mBridge.whenReady(() -> handleIntent(intent));
        }
    }

    private void handleIntent(Intent intent) {
        if (intent != null && intent.hasExtra("action")) {
            String action = intent.getStringExtra("action");
            Log.i(TAG, "Handling action from intent: " + action);
            if ("google_auth".equalsIgnoreCase(action)) {
                if (mBridge != null) {
                    mBridge.sendCommand("googleAuth", null);
                }
                return;
            }
        }
        if (intent != null && intent.hasExtra("url")) {
            String url = intent.getStringExtra("url");
            if ("mock".equalsIgnoreCase(url)) {
                loadMockTimeline();
            } else if ("probe".equalsIgnoreCase(url)) {
                loadAssetPage("probe.html");
            } else {
                Log.i(TAG, "Loading URL from intent: " + url);
                mShowingMock = false;
                mSession.loadUri(url);
            }
        } else {
            // Default to real x.com/home, user can toggle to mock with Menu key
            loadXHome();
        }
    }

    public void loadMockTimeline() {
        mShowingMock = true;
        loadAssetPage("mock_timeline.html");
    }

    public void loadXHome() {
        mShowingMock = false;
        Log.i(TAG, "Loading x.com/home...");
        mSession.loadUri(X_HOME_URL);
    }

    private void loadAssetPage(String assetName) {
        try {
            InputStream is = getAssets().open(assetName);
            BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
            reader.close();
            is.close();

            byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            String dataUri = "data:text/html;charset=utf-8;base64," + base64;
            Log.i(TAG, "Loading asset [" + assetName + "] via Base64 data URI...");
            mSession.loadUri(dataUri);
        } catch (Exception e) {
            Log.e(TAG, "Failed to read asset: " + assetName, e);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        Log.d(TAG, "BrowserActivity.onStart");
    }

    @Override
    protected void onResume() {
        super.onResume();
        Log.d(TAG, "BrowserActivity.onResume");
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.d(TAG, "BrowserActivity.onPause");
    }

    @Override
    protected void onStop() {
        super.onStop();
        Log.d(TAG, "BrowserActivity.onStop");
    }

    @Override
    protected void onDestroy() {
        Log.e(TAG, "===> BrowserActivity.onDestroy START <===");
        if (mPopupSession != null && mPopupSession.isOpen()) {
            mPopupSession.close();
            mPopupSession = null;
        }
        while (!mDetailSessions.isEmpty()) {
            GeckoSession detail = mDetailSessions.removeLast();
            if (detail.isOpen()) detail.close();
        }
        mUiHandler.removeCallbacksAndMessages(null);
        if (mBridge != null) mBridge.close();
        if (mGeckoView != null) {
            mGeckoView.releaseSession();
        }
        if (mSession != null && mSession.isOpen()) {
            mSession.close();
        }
        super.onDestroy();
        Log.e(TAG, "===> BrowserActivity.onDestroy END <===");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (mPopupSession == null && mLoading.getVisibility() == View.VISIBLE &&
                (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_DPAD_CENTER ||
                code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                if (code == KeyEvent.KEYCODE_BACK) { if (!mDetailSessions.isEmpty()) closeDetail(); else finish(); }
                else if ((code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_DPAD_CENTER) && activeSession() != null && mLoadRetryAvailable) activeSession().reload();
            }
            return true;
        }
        // Route paired, trusted key events directly to the content adapter. This
        // works through native-port outages and preserves media user activation.
        if (mPopupSession == null && (code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN ||
                code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT ||
                code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER ||
                code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)) {
            int mapped = (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) ? KeyEvent.KEYCODE_ENTER : code;
            KeyEvent forwarded = new KeyEvent(event.getDownTime(), event.getEventTime(), event.getAction(), mapped,
                    event.getRepeatCount(), event.getMetaState(), event.getDeviceId(), event.getScanCode(), event.getFlags(), event.getSource());
            return mGeckoView.dispatchKeyEvent(forwarded);
        }
        if (mPopupSession == null && (code == KeyEvent.KEYCODE_MENU ||
                (code == KeyEvent.KEYCODE_BACK && mUsingTvAdapter))) {
            int mapped = code == KeyEvent.KEYCODE_MENU ? KeyEvent.KEYCODE_M : KeyEvent.KEYCODE_ESCAPE;
            return mGeckoView.dispatchKeyEvent(new KeyEvent(event.getDownTime(), event.getEventTime(), event.getAction(), mapped,
                    event.getRepeatCount(), event.getMetaState(), event.getDeviceId(), event.getScanCode(), event.getFlags(), event.getSource()));
        }
        if (event.getAction() == KeyEvent.ACTION_UP && code == KeyEvent.KEYCODE_BACK && mPopupSession == null) return true;
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            Log.e(TAG, "===> dispatchKeyEvent: " + keyCode + " (" + KeyEvent.keyCodeToString(keyCode) + ") <===");

            if (mPopupSession != null) {
                if (keyCode == KeyEvent.KEYCODE_BACK) {
                    Log.i(TAG, "Closing popup session on BACK key");
                    GeckoSession s = mPopupSession;
                    mPopupSession = null;
                    mGeckoView.setSession(activeSession());
                    TvXApplication.getRuntime().getWebExtensionController().setTabActive(activeSession(), true);
                    mBridge.sendCommand("restoreLogin", null);
                    s.close();
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }

            // F1 remains the developer shortcut for the mock timeline.
            if (keyCode == KeyEvent.KEYCODE_F1) {
                if (mShowingMock) {
                    loadXHome();
                } else {
                    loadMockTimeline();
                }
                return true;
            }

            if (mKeyRouter != null && mKeyRouter.handleKeyDown(keyCode, event)) {
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
