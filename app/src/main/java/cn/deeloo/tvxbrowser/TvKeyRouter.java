package cn.deeloo.tvxbrowser;

import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import org.mozilla.geckoview.GeckoSession;

public class TvKeyRouter {
    private static final String TAG = "TvKeyRouter";
    private static final long MOVE_THROTTLE_MS = 100;

    public interface FallbackExitHandler {
        void onExitRequested();
    }

    private final NavigationBridge mBridge;
    private final GeckoSession mSession;
    private final FallbackExitHandler mExitHandler;
    private final Handler mMainHandler = new Handler(Looper.getMainLooper());

    private long mLastMoveTime = 0;
    private boolean mCanGoBack = false;

    public TvKeyRouter(NavigationBridge bridge, GeckoSession session, FallbackExitHandler exitHandler) {
        mBridge = bridge;
        mSession = session;
        mExitHandler = exitHandler;
    }

    public void setCanGoBack(boolean canGoBack) {
        mCanGoBack = canGoBack;
    }

    public boolean handleKeyDown(int keyCode, KeyEvent event) {
        long now = System.currentTimeMillis();

        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                if (mBridge == null || !mBridge.isConnected()) {
                    AppLog.w(TAG, "Bridge not connected, passing DPAD_UP to GeckoView");
                    return false;
                }
                if (now - mLastMoveTime >= MOVE_THROTTLE_MS) {
                    mLastMoveTime = now;
                    mBridge.sendMove("up");
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (mBridge == null || !mBridge.isConnected()) {
                    AppLog.w(TAG, "Bridge not connected, passing DPAD_DOWN to GeckoView");
                    return false;
                }
                if (now - mLastMoveTime >= MOVE_THROTTLE_MS) {
                    mLastMoveTime = now;
                    AppLog.e(TAG, "Routing DPAD_DOWN to bridge.sendMove('down')");
                    mBridge.sendMove("down");
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (mBridge == null || !mBridge.isConnected()) {
                    AppLog.w(TAG, "Bridge not connected, passing DPAD_LEFT to GeckoView");
                    return false;
                }
                if (now - mLastMoveTime >= MOVE_THROTTLE_MS) {
                    mLastMoveTime = now;
                    mBridge.sendMove("left");
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (mBridge == null || !mBridge.isConnected()) {
                    AppLog.w(TAG, "Bridge not connected, passing DPAD_RIGHT to GeckoView");
                    return false;
                }
                if (now - mLastMoveTime >= MOVE_THROTTLE_MS) {
                    mLastMoveTime = now;
                    mBridge.sendMove("right");
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (mBridge == null || !mBridge.isConnected()) {
                    AppLog.w(TAG, "Bridge not connected, passing ENTER to GeckoView");
                    return false;
                }
                mBridge.sendActivate();
                return true;

            case KeyEvent.KEYCODE_MENU:
                if (mBridge == null || !mBridge.isConnected()) return false;
                if (event.getRepeatCount() == 0) mBridge.sendCommand("menu", null);
                return true;

            case KeyEvent.KEYCODE_BACK:
                if (event.getRepeatCount() == 0) handleBackKey();
                return true;
        }

        return false;
    }

    private void handleBackKey() {
        if (!mBridge.isConnected()) {
            performFallbackBack();
            return;
        }

        // Ask the WebExtension if it handles back (e.g. closing an overlay or modal)
        mBridge.sendBack(handledByWeb -> {
            mMainHandler.post(() -> {
                AppLog.i(TAG, "Back handled by web extension: " + handledByWeb);
                if (!handledByWeb) {
                    performFallbackBack();
                }
            });
        });
    }

    private void performFallbackBack() {
        if (mCanGoBack && mSession != null) {
            AppLog.i(TAG, "Session going back in history...");
            mSession.goBack();
            return;
        }
        if (mExitHandler != null) {
            AppLog.i(TAG, "No history to go back to, exiting Activity.");
            mExitHandler.onExitRequested();
        }
    }
}
