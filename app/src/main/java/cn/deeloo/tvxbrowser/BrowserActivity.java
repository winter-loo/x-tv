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
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.PanZoomController;
import org.mozilla.geckoview.ScreenLength;
import org.mozilla.geckoview.WebRequestError;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class BrowserActivity extends Activity {
    private static final String TAG = "BrowserActivity";
    public static final String X_HOME_URL = "https://x.com/home";
    private static final long HANDOFF_TIMEOUT_MS = 25000;

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
    private NavigationBridge mBridge;
    private TvKeyRouter mKeyRouter;
    private GeckoSession mPopupSession = null;
    private boolean mShowingMock = false;
    private XReadClient mReadClient;
    private FastReader mReader;
    private XWriteClient mWriteClient;
    private XMetadata mMetadata;
    private boolean mWritePageLoading;
    private boolean mPrewarmScheduled;
    private final Handoff mHandoff = new Handoff();
    private String mCommitted = "";
    /**
     * Three lines of the article being read, as a fraction of the screen. The page reports its
     * own; this is only what a page that never reported one gets, so a turn still overlaps.
     */
    private static final double DEFAULT_READING_OVERLAP = .28;
    private static final double MAX_READING_OVERLAP = .5;
    private double mReadingOverlap = DEFAULT_READING_OVERLAP;
    private Runnable mHandoffTimeout;
    private long mLaunchStarted;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        mLaunchStarted=SystemClock.elapsedRealtime();
        super.onCreate(savedInstanceState);
        Log.e(TAG, "===> BrowserActivity.onCreate START <===");

        setContentView(R.layout.activity_browser);
        mLoading = findViewById(R.id.loading_overlay);

        mReadClient=TvXApplication.takeReadClient();
        mMetadata = new XMetadata(new XMetadata.Page() {
            public boolean ensureXPage() { return ensureWritePage(); }
            public void prepare(String operation, java.util.function.Consumer<org.json.JSONObject> callback) {
                mBridge.prepareApi(operation, callback);
            }
        }, (delay, task) -> mUiHandler.postDelayed(task, delay));
        mWriteClient = new XWriteClient(this, mReadClient, mMetadata::prepare);
        mReadClient.metadata = mMetadata::prepare;
        mReadClient.accountChanged=()->{
            if(isFinishing()||isDestroyed())return;
            if(mReader!=null){((android.view.ViewGroup)mReader.getParent()).removeView(mReader);mReader.dispose();mReader=null;}
            mMetadata.cancel();
            closeHandoff();initializeBrowser();loadXHome();
        };
        if(mReadClient.available()&&!getIntent().hasExtra("url")&&!getIntent().hasExtra("action")) {
            mReader=new FastReader(this,mReadClient,mWriteClient,new FastReader.Listener(){
                public void rendered(){if(!mPrewarmScheduled){mPrewarmScheduled=true;mUiHandler.postDelayed(BrowserActivity.this::initializeBrowser,1500);}}
                public void openBrowser(String path,String action){
                    beginHandoff(path.equals("/home")?Handoff.Kind.LOGIN:Handoff.Kind.POST,
                        path.equals("/home")?X_HOME_URL:path,action);
                }
                public void cancelBrowser(){endHandoff();}
                public void openExternal(String url){beginHandoff(Handoff.Kind.EXTERNAL,url,"");}
                public void cancelExternal(){endHandoff();}
                public void exit(){finish();}
            },mLaunchStarted);
            ((android.view.ViewGroup)mLoading.getParent()).addView(mReader,new android.view.ViewGroup.LayoutParams(-1,-1));
        } else initializeBrowser();
    }

    private void initializeBrowser() {
        if(mSession!=null||isFinishing())return;
        try {
            mGeckoView = new GeckoView(this);
            // Create Gecko's view only when login/actions need its renderer.
            mGeckoView.setViewBackend(GeckoView.BACKEND_TEXTURE_VIEW);
            mGeckoView.setAlpha(0f);
            mGeckoView.setBackgroundColor(0xff090d14);
            mGeckoView.coverUntilFirstPaint(0xff090d14);
            ((android.view.ViewGroup)mLoading.getParent()).addView(mGeckoView,0,new android.view.ViewGroup.LayoutParams(-1,-1));
            GeckoSessionSettings settings = new GeckoSessionSettings.Builder()
                    .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
                    .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
                    .build();
            mSession = new GeckoSession(settings);

            mBridge = new NavigationBridge(TvXApplication.getRuntime(), mSession);
            mBridge.setPresentationListener(() -> runOnUiThread(this::showPresentation));
            // The page may ask to close only what it actually owns; a background X document
            // firing this while the reader is in front must not exit the app.
            mBridge.setExitListener(() -> runOnUiThread(()->{if(mHandoff.showing())endHandoff();else if(mReader==null)finish();}));
            mBridge.setReadTemplateListener(mReadClient::accept);
            mBridge.setReadClearListener(mReadClient::clear);
            // A live content script is the real precondition for a post handoff, so drive it here
            // rather than guessing from page-load events an SPA may not deliver in time.
            mBridge.setContentReadyListener(url->{if(ExternalTarget.isX(url)){mCommitted=url;if(mHandoff.kind()==Handoff.Kind.POST)driveHandoff();}});
            // The fraction crosses from page script, so it is clamped here, at the boundary.
            mBridge.setReadingOverlapListener(overlap->{
                if(overlap<=0)return;
                mReadingOverlap=Math.min(MAX_READING_OVERLAP,overlap);
                Log.w(TAG,"===> handoff reading overlap="+mReadingOverlap);});
            // Only the handoff that actually took the screen, for the post it was opened for, may
            // be closed by the page. A stale return from an earlier document is ignored.
            mBridge.setReaderReturnListener(path->{if(mHandoff.closedBy(path))endHandoff();});
            mBridge.setReaderReadyListener(path->{mHandoff.announce(path);showHandoff();});
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
                    if (session == activeSession() && (mReader == null || mHandoff.showing())) mGeckoView.requestFocus();
                }

                @Override
                public void onFirstContentfulPaint(GeckoSession session) {
                    if (session == activeSession()) showHandoff();
                }
            });

            mSession.setProgressDelegate(new GeckoSession.ProgressDelegate() {
                @Override
                public void onPageStart(GeckoSession session, String url) {
                    if (session != activeSession()) return;
                    mWritePageLoading = ExternalTarget.isX(url);
                    if ("about:blank".equals(url)) return;

                    String host = Uri.parse(url).getHost();
                    mWaitingForPresentation = "x.com".equals(host) || "twitter.com".equals(host);
                    mUsingTvAdapter = mWaitingForPresentation;
                    mLoadRetryAvailable = false;
                    mGeckoView.setAlpha(0f);
                    mLoading.setVisibility(mReader != null && !mHandoff.showing() ? View.GONE : View.VISIBLE);
                    mGeckoView.coverUntilFirstPaint(0xff090d14);
                    ((TextView) findViewById(R.id.loading_text)).setText("正在加载 X…");
                    mUiHandler.removeCallbacks(mLoadTimeout);
                    mUiHandler.postDelayed(mLoadTimeout, 25000);
                    Log.i(TAG, "===> Page started: " + url);
                }

                @Override
                public void onPageStop(GeckoSession session, boolean success) {
                    if (session != activeSession()) return;
                    if (!success) mWritePageLoading = false;
                    // A client-side redirect (t.co serves one) aborts the page it navigates away
                    // from, so only a real load error or the timeout may fail a handoff.
                    if (mHandoff.kind() == Handoff.Kind.EXTERNAL) {
                        if (success) showHandoff();
                        return;
                    }
                    if (mHandoff.kind() == Handoff.Kind.POST) driveHandoff();
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
                public void onCanGoBack(GeckoSession session, boolean canGoBack) {
                    Log.i(TAG, "canGoBack: " + canGoBack);
                    if (session == activeSession()) mKeyRouter.setCanGoBack(canGoBack);
                }

                @Override
                public void onLocationChange(GeckoSession session, String url,
                        java.util.List<GeckoSession.PermissionDelegate.ContentPermission> perms,
                        Boolean hasUserGesture) {
                    if (session != activeSession()) return;
                    // Committed, so paints from here belong to this document. A document that
                    // does not belong to the handoff never arms the screen.
                    mCommitted = url;
                    mHandoff.commit(url);
                    if (mHandoff.settled()) clearHandoffTimeout();
                    if (mHandoff.active()) Log.w(TAG, "===> handoff loading url=" + url);
                    // A navigation that started before this handoff has just won the session
                    // (X can take seconds to commit). Take it back rather than time out.
                    if (mHandoff.active() && !mHandoff.arrived()) driveHandoff();
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
                    if (session == activeSession() && mHandoff.kind() == Handoff.Kind.EXTERNAL)
                        failHandoff(mHandoff.generation(), "error-" + error.code);
                    return null;
                }
            });

            Log.e(TAG, "Opening session with runtime...");
            mSession.open(TvXApplication.getRuntime());
            mGeckoView.setSession(mSession);
            TvXApplication.getRuntime().getWebExtensionController().setTabActive(mSession, true);

            mBridge.whenReady(() -> {
                if(mHandoff.active())driveHandoff();
                else handleIntent(getIntent());
            });
            Log.e(TAG, "===> BrowserActivity.onCreate FINISHED <===");
        } catch (Throwable t) {
            Log.e(TAG, "===> Exception in BrowserActivity.onCreate <===", t);
        }
    }

    /** Every reader to browser handoff starts here; the reader stays in front and can cancel. */
    private void beginHandoff(Handoff.Kind kind, String target, String action) {
        if (mReader == null) return;
        mWritePageLoading = false;
        if (kind == Handoff.Kind.EXTERNAL) mReadingOverlap = DEFAULT_READING_OVERLAP;
        final int generation = mHandoff.begin(kind, target, action);
        Log.w(TAG, "===> handoff open kind=" + kind + " gen=" + generation + " target=" + target);
        if (kind != Handoff.Kind.EXTERNAL) mReader.browserWaiting();
        boolean starting = mSession == null;
        initializeBrowser();
        if (!starting) {
            // A pre-warm of X may still be in flight; this handoff owns the session now.
            mSession.stop();
            driveHandoff();
        }
        mHandoffTimeout = () -> failHandoff(generation, "timeout");
        mUiHandler.postDelayed(mHandoffTimeout, HANDOFF_TIMEOUT_MS);
        showHandoff();
    }

    /** Points the session at the handoff target; safe to repeat once a page settles. */
    private void driveHandoff() {
        if (mSession == null) return;
        switch (mHandoff.kind()) {
            case EXTERNAL:
            case LOGIN:
                loadInSession(mHandoff.target(), "handoff");
                break;
            case POST:
                // Only a live X document can route to the post; otherwise load it and wait for
                // the content script to report in.
                boolean routable = ExternalTarget.isX(mCommitted) && mBridge != null;
                Log.w(TAG, "===> handoff drive kind=POST routable=" + routable + " at=" + mCommitted);
                if (!routable)
                    loadInSession("https://x.com" + mHandoff.target(), "handoff-post");
                else if (!mHandoff.routedFrom(mCommitted)) {
                    mHandoff.routedVia(mCommitted);
                    mBridge.openReaderAction(mHandoff.target(), mHandoff.action());
                }
                break;
        }
    }

    /** Hands the screen over, once the handoff's own document is on it. */
    private void showHandoff() {
        if (!mHandoff.ready() || mReader == null) return;
        Log.w(TAG, "===> handoff shown kind=" + mHandoff.kind() + " target=" + mHandoff.target()
                + " at=" + mCommitted);
        mHandoff.show();
        if (mHandoff.settled()) clearHandoffTimeout();
        mReader.setVisibility(View.GONE);
        // Login has nothing loaded yet, so it keeps the loading overlay rather than a blank page.
        if (mHandoff.kind() != Handoff.Kind.LOGIN) showPresentation();
    }

    /** The user came back, or the page asked to close. */
    private void endHandoff() {
        Handoff.Kind kind = closeHandoff();
        if (mReader == null || kind == Handoff.Kind.NONE) return;
        if (kind == Handoff.Kind.EXTERNAL) mReader.externalClosed();
        else mReader.browserReturned();
    }

    private void failHandoff(int generation, String reason) {
        if (!mHandoff.accepts(generation)) return;
        String target = mHandoff.target();
        Handoff.Kind kind = closeHandoff();
        Log.w(TAG, "===> handoff failed kind=" + kind + " reason=" + reason + " target=" + target);
        if (mReader == null) return;
        if (kind == Handoff.Kind.EXTERNAL) mReader.externalFailed(target);
        else mReader.browserReturned();
    }

    /** Tears the handoff down and invalidates every callback still in flight for it. */
    private Handoff.Kind closeHandoff() {
        if (!mHandoff.active()) return Handoff.Kind.NONE;
        Handoff.Kind kind = mHandoff.kind();
        Log.w(TAG, "===> handoff closed kind=" + kind + " gen=" + mHandoff.generation());
        mHandoff.end();
        clearHandoffTimeout();
        // Stop the external document and restore the metadata source behind the reader.
        // A blank page cannot prepare native likes or replies, however often they retry.
        if (kind == Handoff.Kind.EXTERNAL && mSession != null) {
            mCommitted = "";
            mWritePageLoading = false;
            // Restore the metadata page behind the reader, but only once the user has settled:
            // opening another link straight away must not have to race this navigation.
            mUiHandler.postDelayed(() -> {
                if (!mHandoff.active()) ensureWritePage();
            }, 1200);
        }
        return kind;
    }

    /** Every navigation of the shared session goes through here, so the log names who asked. */
    private void loadInSession(String url, String why) {
        if (mSession == null) return;
        Log.w(TAG, "===> handoff load by=" + why + " active=" + mHandoff.active() + " url=" + url);
        mSession.loadUri(url);
    }

    /** Reuse the existing engine without changing the reader's scene or foreground. */
    private boolean ensureWritePage() {
        if (isFinishing() || isDestroyed() || mReader == null || mHandoff.active()) return false;
        boolean starting = mSession == null;
        initializeBrowser();
        if (mSession == null || mBridge == null) return false;
        // Initial creation already schedules /home after the extension is installed.
        if (starting) { mWritePageLoading = true; return false; }
        if (!ExternalTarget.isX(mCommitted)) {
            if (!mWritePageLoading) {
                mWritePageLoading = true;
                loadInSession(X_HOME_URL, "write-page");
            }
            return false;
        }
        return true;
    }

    private void clearHandoffTimeout() {
        if (mHandoffTimeout == null) return;
        mUiHandler.removeCallbacks(mHandoffTimeout);
        mHandoffTimeout = null;
    }

    /** Engine-level scrolling, so the remote reads any page regardless of its own key handling. */
    private void scrollExternal(boolean down) {
        if (mSession == null) return;
        // A page turn less the three lines the article itself reports, so the reader keeps
        // their place; an article that never reported falls back to a sensible slice.
        double page = 1 - mReadingOverlap;
        Log.w(TAG, "===> handoff reading page=" + page);
        mSession.getPanZoomController().scrollBy(ScreenLength.zero(),
                ScreenLength.fromVisualViewportHeight(down ? page : -page),
                PanZoomController.SCROLL_BEHAVIOR_SMOOTH);
    }

    private GeckoSession activeSession() {
        return mSession;
    }

    private void showPresentation() {
        mWaitingForPresentation = false;
        mUiHandler.removeCallbacks(mLoadTimeout);
        // A hidden page becoming ready may clear the overlay, but never take focus from the reader.
        if (mReader != null && !mHandoff.showing()) {
            mLoading.setVisibility(View.GONE);
            return;
        }
        // Revealing is idempotent on purpose: a page that cleared the overlay while the reader
        // was in front must not leave a later handoff stuck on a transparent GeckoView.
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
        // Debug-build acceptance seam: exercise the real metadata path without a mutation.
        if (BuildConfig.DEBUG && "check_write_preparation".equals(intent.getStringExtra("action"))) {
            final long started = SystemClock.elapsedRealtime();
            final org.json.JSONObject auth = mReadClient.credentials();
            mMetadata.prepare("FavoriteTweet", metadata -> {
                boolean ready = metadata != null && !metadata.has("error")
                    && metadata.has("csrf") && metadata.has("queries")
                    && mReadClient.matchesCredentials(auth);
                Log.w("TvXWriteReady", "ready=" + ready + " ms=" + (SystemClock.elapsedRealtime() - started));
            });
            return;
        }
        setIntent(intent);
        // A launcher resume must not reload /home and discard the current post.
        if (intent.hasExtra("url") || intent.hasExtra("action")) {
            closeHandoff();
            if(mReader!=null)mReader.setVisibility(View.GONE);
            initializeBrowser();
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
                loadInSession(url, "intent");
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
        loadInSession(X_HOME_URL, "x-home");
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
            loadInSession(dataUri, "asset");
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
        if(mReader!=null){mReader.dispose();mReader=null;}
        if(mWriteClient!=null)mWriteClient.close();
        if(mMetadata!=null)mMetadata.cancel();
        if(mReadClient!=null)mReadClient.close();
        if (mPopupSession != null && mPopupSession.isOpen()) {
            mPopupSession.close();
            mPopupSession = null;
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
        if(mReader!=null&&mReader.getVisibility()==View.VISIBLE&&mReader.handleKey(event))return true;
        int code = event.getKeyCode();
        if(mGeckoView==null)return super.dispatchKeyEvent(event);
        if(mHandoff.showing()&&mHandoff.kind()==Handoff.Kind.EXTERNAL){
            if(code==KeyEvent.KEYCODE_BACK){
                if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getRepeatCount()==0)endHandoff();
                return true;
            }
            if(code==KeyEvent.KEYCODE_DPAD_UP||code==KeyEvent.KEYCODE_DPAD_DOWN){
                if(event.getAction()==KeyEvent.ACTION_DOWN)scrollExternal(code==KeyEvent.KEYCODE_DPAD_DOWN);
                return true;
            }
        }
        if (mPopupSession == null && mLoading.getVisibility() == View.VISIBLE &&
                (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_DPAD_CENTER ||
                code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                if (code == KeyEvent.KEYCODE_BACK) finish();
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
