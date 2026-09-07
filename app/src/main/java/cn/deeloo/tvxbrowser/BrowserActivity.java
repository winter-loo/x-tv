package cn.deeloo.tvxbrowser;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Matrix;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebRequestError;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class BrowserActivity extends Activity {
    private static final String TAG = "BrowserActivity";
    public static final String X_HOME_URL = "https://x.com/home";

    private GeckoView mGeckoView;
    private GeckoSession mSession;
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

        try {
            GeckoSessionSettings settings = new GeckoSessionSettings.Builder()
                    .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
                    .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
                    .build();
            mSession = new GeckoSession(settings);

            mBridge = new NavigationBridge(TvXApplication.getRuntime(), mSession);
            mBridge.setTapListener((x, y) -> {
                runOnUiThread(() -> {
                    if (mPopupSession != null) return;
                    Matrix transform = new Matrix();
                    mSession.getClientToSurfaceMatrix(transform);
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

            mSession.setProgressDelegate(new GeckoSession.ProgressDelegate() {
                @Override
                public void onPageStart(GeckoSession session, String url) {
                    Log.i(TAG, "===> Page started: " + url);
                }

                @Override
                public void onPageStop(GeckoSession session, boolean success) {
                    Log.i(TAG, "===> Page stopped, success: " + success);
                }

                @Override
                public void onProgressChange(GeckoSession session, int progress) {
                    Log.d(TAG, "Page progress: " + progress + "%");
                }
            });

            mSession.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
                @Override
                public void onCanGoBack(GeckoSession session, boolean canGoBack) {
                    Log.i(TAG, "canGoBack: " + canGoBack);
                    mKeyRouter.setCanGoBack(canGoBack);
                }

                @Override
                public GeckoResult<GeckoSession> onNewSession(GeckoSession session, String uri) {
                    Log.e(TAG, "===> onNewSession requested");
                    GeckoSession popupSession = new GeckoSession(mSession.getSettings());
                    mPopupSession = popupSession;
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
                                    mGeckoView.setSession(mSession);
                                    TvXApplication.getRuntime().getWebExtensionController().setTabActive(mSession, true);
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
                    TvXApplication.getRuntime().getWebExtensionController().setTabActive(mSession, false);
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

            handleIntent(getIntent());
            Log.e(TAG, "===> BrowserActivity.onCreate FINISHED <===");
        } catch (Throwable t) {
            Log.e(TAG, "===> Exception in BrowserActivity.onCreate <===", t);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
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
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            Log.e(TAG, "===> dispatchKeyEvent: " + keyCode + " (" + KeyEvent.keyCodeToString(keyCode) + ") <===");

            if (mPopupSession != null) {
                if (keyCode == KeyEvent.KEYCODE_BACK) {
                    Log.i(TAG, "Closing popup session on BACK key");
                    GeckoSession s = mPopupSession;
                    mPopupSession = null;
                    mGeckoView.setSession(mSession);
                    TvXApplication.getRuntime().getWebExtensionController().setTabActive(mSession, true);
                    mBridge.sendCommand("restoreLogin", null);
                    s.close();
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }

            // Menu key or F1 toggles between Mock Timeline and x.com/home
            if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_F1) {
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
