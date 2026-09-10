package cn.deeloo.tvxbrowser;

import android.util.Log;
import org.json.JSONException;
import org.json.JSONObject;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.WebExtension;

public class NavigationBridge implements WebExtension.MessageDelegate, WebExtension.PortDelegate {
    private static final String TAG = "NavigationBridge";
    public static final String EXTENSION_LOCATION = "resource://android/assets/tv-extension/";
    public static final String EXTENSION_ID = "tv-extension@deeloo.cn";
    public static final String PORT_NAME = "browser_nav_bridge";

    public interface StateListener {
        void onPageStateChanged(String pageType, boolean hasOverlay, boolean canBack);
    }

    public interface BackResultCallback {
        void onResult(boolean handledByWeb);
    }

    public interface TapListener {
        void onTapRequested(int x, int y);
    }

    public interface ReaderReadyListener { void ready(String path); }
    public interface ContentReadyListener { void ready(String url); }
    public interface ReadingOverlapListener { void report(double overlap); }
    private ReadingOverlapListener mReadingOverlapListener;
    /** Fires when an article reports how much of a screen a page turn should keep. */
    public void setReadingOverlapListener(ReadingOverlapListener listener) { mReadingOverlapListener=listener; }
    private ContentReadyListener mContentReadyListener;
    /** Fires when a content script exists on a document and can accept reader commands. */
    public void setContentReadyListener(ContentReadyListener listener) { mContentReadyListener=listener; }
    private java.util.function.Consumer<JSONObject> mReadTemplateListener;
    private Runnable mReadClearListener;
    private ReaderReadyListener mReaderReturnListener;
    private ReaderReadyListener mReaderReadyListener;
    public void setReadTemplateListener(java.util.function.Consumer<JSONObject> listener) { mReadTemplateListener=listener; }
    public void setReadClearListener(Runnable listener) { mReadClearListener=listener; }
    public void setReaderReturnListener(ReaderReadyListener listener) { mReaderReturnListener=listener; }
    public void setReaderReadyListener(ReaderReadyListener listener) { mReaderReadyListener=listener; }
    public void openReaderAction(String path,String action) {
        if(mPort==null)return;
        try {JSONObject msg=new JSONObject();msg.put("command","readerAction");msg.put("path",path);msg.put("action",action);mPort.postMessage(msg);}catch(JSONException ignored){}
    }
    private final android.os.Handler metadataHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private String metadataId;
    private java.util.function.Consumer<JSONObject> metadataCallback;
    public void prepareApi(String operation, java.util.function.Consumer<JSONObject> callback) {
        if (metadataCallback != null || mPort == null || mPort.sender.session != null) { callback.accept(null); return; }
        metadataId = java.util.UUID.randomUUID().toString();
        metadataCallback = callback;
        final String id = metadataId;
        try {
            mPort.postMessage(new JSONObject().put("command", "apiPrepare").put("id", id).put("operation", operation));
        } catch (Exception e) { finishMetadata(null); return; }
        metadataHandler.postDelayed(() -> { if (id.equals(metadataId)) finishMetadata(null); }, 3000);
    }
    private void finishMetadata(JSONObject result) {
        java.util.function.Consumer<JSONObject> callback = metadataCallback;
        metadataCallback = null; metadataId = null;
        if (callback != null) callback.accept(result);
    }
    private Runnable mReadyListener;
    private Runnable mPresentationListener;
    private Runnable mExitListener;
    public void setExitListener(Runnable listener) { mExitListener = listener; }
    public void whenReady(Runnable listener) {
        mReadyListener = listener;
        if (mExtension != null) { mReadyListener = null; listener.run(); }
    }
    public void setPresentationListener(Runnable listener) { mPresentationListener = listener; }
    public void close() {
        finishMetadata(null);
        if (mPort != null) { mPort.disconnect(); mPort = null; }
        mReadyListener = null; mPresentationListener = null; mExitListener = null;
        mReadTemplateListener=null;mReadClearListener=null;mReaderReturnListener=null;mReaderReadyListener=null;
        mContentReadyListener=null;mReadingOverlapListener=null;
    }
    private WebExtension mExtension;
    private WebExtension.Port mPort;
    private GeckoSession mSession;
    private StateListener mStateListener;
    private TapListener mTapListener;
    private BackResultCallback mPendingBackCallback;

    public NavigationBridge(GeckoRuntime runtime, GeckoSession session) {
        mSession = session;
        initExtension(runtime);
    }

    public void setStateListener(StateListener listener) {
        mStateListener = listener;
    }

    public void setTapListener(TapListener listener) {
        mTapListener = listener;
    }

    public void setSession(GeckoSession session) {
        mSession = session;
        if (mExtension != null && mSession != null) {
            try {
                mSession.getWebExtensionController().setMessageDelegate(mExtension, this, PORT_NAME);
                Log.e(TAG, "Attached MessageDelegate to GeckoSession");
            } catch (Exception e) {
                Log.e(TAG, "Failed to attach MessageDelegate to GeckoSession", e);
            }
        }
    }

    private void initExtension(GeckoRuntime runtime) {
        Log.e(TAG, "Registering built-in WebExtension: " + EXTENSION_LOCATION);
        runtime.getWebExtensionController()
                .ensureBuiltIn(EXTENSION_LOCATION, EXTENSION_ID)
                .then(extension -> {
                    Log.e(TAG, "WebExtension registered successfully: " + extension.id);
                    mExtension = extension;
                    mExtension.setMessageDelegate(this, PORT_NAME);
                    if (mSession != null) {
                        try {
                            mSession.getWebExtensionController().setMessageDelegate(mExtension, this, PORT_NAME);
                            Log.e(TAG, "Attached MessageDelegate to GeckoSession successfully");
                        } catch (Exception e) {
                            Log.e(TAG, "Failed to attach MessageDelegate to GeckoSession", e);
                        }
                    }
                    if (mReadyListener != null) { Runnable listener = mReadyListener; mReadyListener = null; listener.run(); }
                    return null;
                }, throwable -> {
                    Log.e(TAG, "Failed to ensure built-in WebExtension", throwable);
                    return null;
                });
    }

    // WebExtension.MessageDelegate
    @Override
    public void onConnect(WebExtension.Port port) {
        Log.e(TAG, "WebExtension Port connected! Name=" + port.name);
        mPort = port;
        mPort.setDelegate(this);

        // Request initial state from extension
        sendCommand("getState", null);
    }

    // WebExtension.PortDelegate
    @Override
    public void onPortMessage(Object message, WebExtension.Port port) {
        // Never log message bodies: extension requests can carry session headers.
        if (message instanceof JSONObject && port == mPort) {
            JSONObject incoming = (JSONObject) message;
            if ("api_metadata".equals(incoming.optString("event"))) {
                if (port.sender.session == null && incoming.optString("id").equals(metadataId))
                    finishMetadata(incoming.optJSONObject("result"));
                return;
            }
            JSONObject json = (JSONObject) message;
            handleJsonMessage(json);
        }
    }

    @Override
    public void onDisconnect(WebExtension.Port port) {
        Log.w(TAG, "WebExtension Port disconnected!");
        if (mPort == port) {
            mPort = null;
            finishMetadata(null);
        }
    }

    private void handleJsonMessage(JSONObject json) {
        try {
            String event = json.optString("event");
            if ("read_api_template".equals(event)) {
                if(mReadTemplateListener!=null)mReadTemplateListener.accept(json);
            } else if ("read_session_clear".equals(event)) {
                if(mReadClearListener!=null)mReadClearListener.run();
            } else if ("reader_browser_ready".equals(event)) {
                if(mReaderReadyListener!=null)mReaderReadyListener.ready(json.optString("path"));
            } else if ("reader_browser_return".equals(event)) {
                if(mReaderReturnListener!=null)mReaderReturnListener.ready(json.optString("path"));
            } else if ("content_ready".equals(event)) {
                if(mContentReadyListener!=null)mContentReadyListener.ready(json.optString("url"));
            } else if ("reading_overlap".equals(event)) {
                if(mReadingOverlapListener!=null)mReadingOverlapListener.report(json.optDouble("overlap",0));
            } else if ("ping".equals(event)) {
                sendCommand("pong", null);
            } else if ("exit_requested".equals(event)) {
                if (mExitListener != null) mExitListener.run();
            } else if ("presentation_ready".equals(event)) {
                if (mPresentationListener != null) mPresentationListener.run();
            } else if ("state".equals(event)) {
                String pageType = json.optString("pageType", "unknown");
                boolean hasOverlay = json.optBoolean("hasOverlay", false);
                boolean canBack = json.optBoolean("canBack", false);
                Log.i(TAG, "State update: pageType=" + pageType + ", hasOverlay=" + hasOverlay + ", canBack=" + canBack);
                if (mStateListener != null) {
                    mStateListener.onPageStateChanged(pageType, hasOverlay, canBack);
                }
            } else if ("backResult".equals(event)) {
                boolean handled = json.optBoolean("handled", false);
                Log.i(TAG, "Back result received: handled=" + handled);
                if (mPendingBackCallback != null) {
                    BackResultCallback cb = mPendingBackCallback;
                    mPendingBackCallback = null;
                    cb.onResult(handled);
                }
            } else if ("request_tap".equals(event)) {
                int x = json.optInt("x", -1);
                int y = json.optInt("y", -1);
                Log.i(TAG, "===> request_tap received for coordinates: (" + x + ", " + y + ")");
                if (mTapListener != null && x >= 0 && y >= 0) {
                    mTapListener.onTapRequested(x, y);
                }
            } else {
                Log.i(TAG, "Received extension event: " + event);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling extension message", e);
        }
    }

    public boolean isConnected() {
        return mPort != null;
    }

    public void sendMove(String direction) {
        sendCommand("move", direction);
    }

    public void sendActivate() {
        sendCommand("activate", null);
    }

    public void sendBack(BackResultCallback callback) {
        if (mPort == null) {
            Log.w(TAG, "Port not connected when sending back command");
            callback.onResult(false);
            return;
        }
        mPendingBackCallback = callback;
        sendCommand("back", null);
    }

    public void sendDismissOverlay() {
        sendCommand("dismissOverlay", null);
    }

    public void sendCommand(String command, String param) {
        if (mPort == null) {
            Log.w(TAG, "Cannot send command '" + command + "', port is null.");
            return;
        }
        try {
            JSONObject msg = new JSONObject();
            msg.put("command", command);
            if (param != null) {
                msg.put("direction", param);
            }
            Log.e(TAG, "===> Sending command to extension: " + msg.toString() + " <===");
            mPort.postMessage(msg);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to create command JSON", e);
        }
    }
}
