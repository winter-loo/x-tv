package cn.deeloo.tvxbrowser;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import org.json.JSONObject;

/** Local reading UI; all authenticated networking remains in XReadClient. */
@SuppressLint("SetJavaScriptEnabled")
final class FastReader extends FrameLayout {
    interface Listener {
        void rendered();
        void openBrowser(String path, String action);
        void cancelBrowser();
        void openExternal(String url);
        void cancelExternal();
        void exit();
    }
    private final WebView web;
    private final XReadClient client;
    private final Listener listener;
    private final XWriteClient writer;
    private android.app.AlertDialog composer;
    private final java.util.Map<String,String> drafts = new java.util.HashMap<>();
    private boolean ready;
    private String queued, queuedCache, pending = "r0";
    private long started;
    private boolean disposed, waitingForBrowser, receivedHome;

    FastReader(Context context, XReadClient client, XWriteClient writer, Listener listener, long launchStarted) {
        super(context);
        this.client = client;
        this.writer = writer;
        this.listener = listener;
        started = launchStarted;
        setBackgroundColor(0xff090d14);
        setContentDescription("tvx-reader-loading");
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web = new WebView(context);
        web.setBackgroundColor(0xff090d14);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String host = u.getHost();
                if ("file".equals(u.getScheme()) && u.toString().startsWith("file:///android_asset/reader/"))
                    return null;
                if ("https".equals(u.getScheme()) && host != null
                    && (host.equals("twimg.com") || host.endsWith(".twimg.com")))
                    return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        });
        web.addJavascriptInterface(new Host(), "ReaderHost");
        addView(web, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        web.loadUrl("file:///android_asset/reader/index.html");
        client.fetchHome(this::receiveHome);
        client.cachedHome((data, at) -> {
            if (disposed || receivedHome || !pending.equals("r0"))
                return;
            String script = "TvXReader.cachedHome(JSON.parse(" + quote(data) + ")," + at + ")";
            if (ready)
                web.evaluateJavascript(script, null);
            else
                queuedCache = script;
        });
    }
    private void receiveHome(String data, String error) {
        if (disposed)
            return;
        receivedHome = data != null && (error == null || error.isEmpty());
        if (pending.equals("r0"))
            receive("r0", data, error);
        else
            web.evaluateJavascript("TvXReader.homeUpdated("
                    + (data == null ? "null" : "JSON.parse(" + quote(data) + ")") + "," + quote(error) + ")",
                null);
    }
    private static String quote(String value) {
        return JSONObject.quote(value == null ? "" : value)
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029");
    }
    private void receive(String id, String data, String error) {
        if (disposed || !id.equals(pending))
            return;
        String script = "TvXReader.receive(" + quote(id) + ","
            + (data == null ? "null" : "JSON.parse(" + quote(data) + ")") + "," + quote(error) + ")";
        if (ready)
            web.evaluateJavascript(script, null);
        else
            queued = script;
    }
    public final class Host {
        @JavascriptInterface
        public void ready() {
            post(() -> {
                if (disposed)
                    return;
                android.util.Log.w(
                    "TvXReaderPerf", "view ready ms=" + (SystemClock.elapsedRealtime() - started));
                ready = true;
                if (queuedCache != null) {
                    web.evaluateJavascript(queuedCache, null);
                    queuedCache = null;
                }
                if (queued != null) {
                    web.evaluateJavascript(queued, null);
                    queued = null;
                }
            });
        }
        @JavascriptInterface
        public void request(String id, String mode, String postId, String cursor) {
            if (!id.matches("r[0-9]+") || (!mode.equals("home") && !mode.equals("detail"))
                || cursor.length() > 10000)
                return;
            post(() -> {
                if (disposed)
                    return;
                if (!pending.equals("r0"))
                    client.cancel(pending);
                pending = id;
                started = SystemClock.elapsedRealtime();
                setContentDescription("tvx-reader-loading");
                client.fetch(id, mode, postId, cursor, (data, error) -> receive(id, data, error));
            });
        }
        @JavascriptInterface
        public void rendered(String id, String kind) {
            post(() -> {
                if (disposed || !pending.equals(id)
                    || (!kind.equals("home") && !kind.equals("detail") && !kind.equals("home_cached")
                        && !kind.equals("detail_cached") && !kind.equals("detail_reused")))
                    return;
                postOnAnimation(() -> postOnAnimation(() -> {
                    if (disposed || !pending.equals(id))
                        return;
                    String mode = kind.startsWith("detail") ? "detail" : "home";
                    String stage = kind.endsWith("_cached") ? "cached"
                        : kind.endsWith("_reused")          ? "reused"
                                                            : "live";
                    setContentDescription("tvx-reader-" + mode + "-ready");
                    android.util.Log.w("TvXReaderPerf",
                        mode + " " + stage + " ms=" + (SystemClock.elapsedRealtime() - started));
                    if (stage.equals("live"))
                        listener.rendered();
                }));
            });
        }
        @JavascriptInterface
        public void restoreScene(String id, String kind) {
            post(() -> {
                if (disposed)
                    return;
                if (!pending.equals("r0"))
                    client.cancel(pending);
                pending = id;
                started = SystemClock.elapsedRealtime();
                postOnAnimation(() -> postOnAnimation(() -> {
                    if (disposed || !pending.equals(id))
                        return;
                    setContentDescription("tvx-reader-" + kind + "-ready");
                    android.util.Log.w(
                        "TvXReaderPerf", kind + " restored ms=" + (SystemClock.elapsedRealtime() - started));
                }));
            });
        }
        @JavascriptInterface
        public void browser(String path, String action) {
            if (!path.matches("/[^/]+/status/[0-9]+") && !path.equals("/home"))
                return;
            post(() -> {
                if (!disposed)
                    listener.openBrowser(path, action);
            });
        }
        @JavascriptInterface
        public void openExternal(String url) {
            String target = ExternalTarget.normalize(url);
            post(() -> {
                if (disposed)
                    return;
                if (target == null)
                    externalFailed(url);
                else
                    listener.openExternal(target);
            });
        }
        @JavascriptInterface
        public void cancelExternal() {
            post(() -> {
                if (!disposed)
                    listener.cancelExternal();
            });
        }
        @JavascriptInterface
        public void write(String id, String postId, String action, boolean desired, String author) {
            if (!id.matches("w[0-9]+") || !postId.matches("[0-9]{1,25}") || author.length() > 200
                || (!action.equals("like") && !action.equals("reply"))) return;
            post(() -> {
                if (disposed) return;
                if (action.equals("reply")) showComposer(id, postId, author);
                else writer.submit(postId, true, desired, "", result -> writeResult(id, postId, result));
            });
        }
        @JavascriptInterface
        public void exit() {
            post(listener::exit);
        }
    }
    private void writeResult(String id, String postId, JSONObject result) {
        if (!disposed) web.evaluateJavascript("TvXReader.writeResult(" + quote(id) + "," + quote(postId)
            + ",JSON.parse(" + quote(result.toString()) + "))", null);
    }
    static String writeError(String status) {
        switch (status) {
            case "unknown": return "发送结果尚未确认。请先查看帖子，勿重复发送；草稿已保留。";
            case "session": return "登录状态已变化，请重新登录后操作。";
            case "not_ready": return "登录会话正在准备，请稍后重试。";
            case "rate_limit": return "操作过于频繁，请稍后再试。";
            case "invalid": return "请填写评论内容。";
            case "busy": return "上一项操作正在完成，请稍候。";
            default: return "未能发送，请检查评论内容或稍后重试。";
        }
    }
    private void showComposer(String id, String postId, String author) {
        if (composer != null) { writeResult(id, postId, XWriteClient.result("busy")); return; }
        android.widget.LinearLayout content = new android.widget.LinearLayout(getContext());
        content.setOrientation(android.widget.LinearLayout.VERTICAL);
        int padding = (int)(24 * getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding/2, padding, padding/2);
        android.widget.EditText input = new android.widget.EditText(getContext());
        input.setId(View.generateViewId());
        input.setTextSize(19); input.setMinLines(3); input.setMaxLines(5);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setGravity(android.view.Gravity.TOP);
        input.setHint("写下你的评论"); input.setContentDescription("评论内容");
        input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(10000)});
        input.setText(drafts.getOrDefault(postId, "")); input.setSelection(input.length());
        content.addView(input, new android.widget.LinearLayout.LayoutParams(-1,-2));
        android.widget.TextView status = new android.widget.TextView(getContext());
        status.setTextSize(15); status.setPadding(0, padding/2, 0, 0);
        status.setText("菜单键选择发送　返回保留草稿"); content.addView(status);
        final boolean[] submitting = {false}, completed = {false};
        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(getContext())
            .setTitle("回复 " + author).setView(content).setNegativeButton("返回", null)
            .setPositiveButton("发送评论", null).create();
        composer = dialog;
        dialog.setOnKeyListener((d, code, event) -> {
            if (code != KeyEvent.KEYCODE_MENU) return false;
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && !submitting[0])
                dialog.getButton(-1).requestFocus();
            return true;
        });
        input.setOnKeyListener((v, code, event) -> {
            if (code != KeyEvent.KEYCODE_DPAD_DOWN || submitting[0] || input.getLayout() == null) return false;
            int line = input.getLayout().getLineForOffset(Math.max(0,input.getSelectionEnd()));
            if (line < input.getLineCount()-1) return false;
            if (event.getAction() == KeyEvent.ACTION_DOWN) dialog.getButton(-1).requestFocus();
            return true;
        });
        dialog.setOnDismissListener(d -> {
            drafts.put(postId, input.getText().toString()); composer = null;
            if (completed[0]) drafts.remove(postId);
            else writeResult(id, postId, XWriteClient.result("cancelled"));
        });
        input.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence s,int start,int count,int after) {}
            public void onTextChanged(CharSequence s,int start,int before,int count) {
                drafts.put(postId,s.toString());
                if (!submitting[0] && dialog.getButton(-1)!=null) dialog.getButton(-1).setEnabled(s.toString().trim().length()>0);
            }
            public void afterTextChanged(android.text.Editable s) {}
        });
        dialog.setOnShowListener(d -> {
            dialog.getButton(-1).setNextFocusUpId(input.getId());
            dialog.getButton(-2).setNextFocusUpId(input.getId());
            dialog.getButton(-1).setEnabled(!input.getText().toString().trim().isEmpty());
            dialog.getButton(-1).setOnClickListener(v -> {
                if (submitting[0]) return;
                final String text = input.getText().toString();
                if (text.trim().isEmpty()) return;
                submitting[0] = true; input.setEnabled(false); dialog.setCancelable(false);
                dialog.getButton(-1).setEnabled(false); dialog.getButton(-2).setEnabled(false);
                status.setText("正在发送…");
                writer.submit(postId, false, false, text, result -> {
                    if (disposed) return;
                    submitting[0] = false;
                    if (result.optString("status").equals("ok")) {
                        completed[0] = true; dialog.dismiss(); writeResult(id, postId, result);
                    } else {
                        input.setEnabled(true); dialog.setCancelable(true); dialog.getButton(-2).setEnabled(true);
                        dialog.getButton(-1).setEnabled(!result.optString("status").equals("unknown"));
                        status.setText(writeError(result.optString("status"))); input.requestFocus();
                    }
                });
            });
            input.requestFocus();
        });
        dialog.show();
        dialog.getWindow().setLayout((int)(getResources().getDisplayMetrics().widthPixels * .72), -2);
        dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }
    boolean handleKey(KeyEvent event) {
        int code = event.getKeyCode();
        String key;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP:
                key = "up";
                break;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                key = "down";
                break;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                key = "left";
                break;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                key = "right";
                break;
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_DPAD_CENTER:
                key = "ok";
                break;
            case KeyEvent.KEYCODE_BACK:
                key = "back";
                break;
            case KeyEvent.KEYCODE_MENU:
                key = "menu";
                break;
            default:
                return false;
        }
        if (waitingForBrowser) {
            if (key.equals("back") && event.getAction() == KeyEvent.ACTION_DOWN
                && event.getRepeatCount() == 0)
                listener.cancelBrowser();
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN
            && (event.getRepeatCount() == 0 || code == 19 || code == 20 || code == 21 || code == 22))
            web.evaluateJavascript("TvXReader.key(" + quote(key) + ")", null);
        return true;
    }
    void restore() {
        setVisibility(View.VISIBLE);
        web.requestFocus();
    }
    void browserWaiting() {
        waitingForBrowser = true;
        web.evaluateJavascript("TvXReader.notice('正在准备帖子操作…')", null);
    }
    /** The target never became readable; the reader comes back and offers a retry. */
    void externalFailed(String url) {
        restore();
        if (!disposed)
            web.evaluateJavascript("TvXReader.externalFailed(" + quote(url) + ")", null);
    }
    void externalClosed() {
        restore();
        if (!disposed)
            web.evaluateJavascript("TvXReader.externalClosed()", null);
    }
    void browserReturned() {
        waitingForBrowser = false;
        restore();
        web.evaluateJavascript("TvXReader.notice('');TvXReader.refreshCurrent()", null);
    }
    void dispose() {
        disposed = true;
        if (composer != null) composer.dismiss();
        drafts.clear();
        client.cancel(pending);
        web.removeJavascriptInterface("ReaderHost");
        web.destroy();
    }
}
