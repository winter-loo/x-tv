package cn.deeloo.tvxbrowser;

import android.net.Uri;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One GraphQL call built natively from live page metadata. The page supplies the operation's
 * identifiers only; the URL, the body and every credential are assembled here.
 */
final class XGraphQL {
    /** Mined metadata for one operation, delivered on the UI thread. */
    interface Metadata {
        void prepare(String operation, java.util.function.Consumer<JSONObject> callback);
    }
    /** Registers the live connection with the caller, which owns cancelling it. */
    interface Track {
        void opened(HttpURLConnection connection);
    }
    /**
     * The only operations that may be built, each with the method its transaction identifier is
     * signed for. This mirrors the extension's own table: the two must agree or X rejects the call.
     */
    private static final Map<String, String> METHODS = new HashMap<>();
    static {
        METHODS.put("FavoriteTweet", "POST");
        METHODS.put("UnfavoriteTweet", "POST");
        METHODS.put("CreateTweet", "POST");
        METHODS.put("TweetResultByRestId", "GET");
        METHODS.put("Likes", "GET");
        METHODS.put("TweetDetail", "GET");
    }
    private static final int LIMIT = 8_000_000;

    private XGraphQL() {}

    /** The signed-in numeric account id, as X itself records it in the session cookie. */
    static String accountId(String cookies) {
        try {
            for (String entry : cookies.split(";"))
                if (entry.trim().startsWith("twid="))
                    return URLDecoder.decode(entry.trim().substring(5), "UTF-8").replaceFirst("^u=", "");
        } catch (Exception ignored) {}
        return "";
    }
    static Map<String, String> headers(JSONObject auth) throws JSONException {
        Map<String, String> result = new HashMap<>();
        JSONArray list = auth.getJSONArray("headers");
        for (int i = 0; i < list.length(); i++) {
            JSONObject h = list.getJSONObject(i);
            String name = h.getString("name").toLowerCase(Locale.ROOT);
            if (Arrays.asList("authorization", "cookie", "x-csrf-token", "user-agent").contains(name))
                result.put(name, h.getString("value"));
        }
        if (!result.containsKey("cookie") || !result.containsKey("authorization")
            || !result.containsKey("x-csrf-token"))
            throw new JSONException("session");
        result.put("content-type", "application/json");
        result.put("x-twitter-auth-type", "OAuth2Session");
        result.put("x-twitter-active-user", "yes");
        result.put("x-twitter-client-language", "en");
        result.put("origin", "https://x.com");
        result.put("referer", "https://x.com/home");
        return result;
    }
    /** Page-supplied metadata is input, never authority: anything unexpected fails the call. */
    static void validate(JSONObject q) throws JSONException {
        if (!q.getString("queryId").matches("[A-Za-z0-9_-]{8,100}")
            || !q.getString("transaction").matches("[A-Za-z0-9+/=_-]{8,1024}"))
            throw new JSONException("metadata");
        for (String key : Arrays.asList("features", "fieldToggles")) {
            JSONObject values = q.getJSONObject(key);
            if (values.length() > 200) throw new JSONException("metadata");
            Iterator<String> names = values.keys();
            while (names.hasNext()) {
                String name = names.next();
                if (!name.matches("[A-Za-z0-9_]{1,150}") || !(values.get(name) instanceof Boolean))
                    throw new JSONException("metadata");
            }
        }
    }
    static Response send(String operation, JSONObject variables, JSONObject query,
        Map<String, String> headers, Track track) throws Exception {
        String method = METHODS.get(operation);
        if (method == null) throw new IOException("operation");
        validate(query);
        boolean read = method.equals("GET");
        Uri.Builder uri =
            Uri.parse("https://x.com/i/api/graphql/" + query.getString("queryId") + "/" + operation)
                .buildUpon();
        JSONObject body = new JSONObject().put("variables", variables).put("queryId", query.getString("queryId"));
        if (read) {
            uri.appendQueryParameter("variables", variables.toString());
            uri.appendQueryParameter("features", query.getJSONObject("features").toString());
            uri.appendQueryParameter("fieldToggles", query.getJSONObject("fieldToggles").toString());
        } else {
            if (query.getJSONObject("features").length() > 0) body.put("features", query.getJSONObject("features"));
            if (query.getJSONObject("fieldToggles").length() > 0)
                body.put("fieldToggles", query.getJSONObject("fieldToggles"));
        }
        HttpURLConnection c = (HttpURLConnection) new URL(uri.build().toString()).openConnection();
        track.opened(c);
        long started = SystemClock.elapsedRealtime();
        try {
            c.setConnectTimeout(read ? 10000 : 4000);
            c.setReadTimeout(read ? 15000 : 5000);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setRequestMethod(method);
            for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
            c.setRequestProperty("x-client-transaction-id", query.getString("transaction"));
            c.setRequestProperty("Accept-Encoding", "gzip");
            if (!read) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
            }
            int status = c.getResponseCode();
            InputStream raw = status >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (raw != null)
                try (InputStream in = "gzip".equalsIgnoreCase(c.getContentEncoding())
                        ? new java.util.zip.GZIPInputStream(raw)
                        : raw) {
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        if (bytes.size() + n > LIMIT) throw new IOException("size");
                        bytes.write(buffer, 0, n);
                    }
                }
            JSONObject data;
            try {
                data = new JSONObject(bytes.toString("UTF-8"));
            } catch (JSONException e) {
                data = new JSONObject();
            }
            AppLog.w("TvXApiPerf",
                operation + " status=" + status + " ms=" + (SystemClock.elapsedRealtime() - started));
            return new Response(status, data);
        } finally {
            c.disconnect();
        }
    }
    static final class Response {
        final int status;
        final JSONObject body;
        Response(int status, JSONObject body) {
            this.status = status;
            this.body = body;
        }
        boolean ok() {
            return status == 200 && body.has("data")
                && (body.optJSONArray("errors") == null || body.optJSONArray("errors").length() == 0);
        }
        boolean definitivelyRejected() {
            return Arrays.asList(400, 401, 403, 404, 422, 429).contains(status);
        }
        String failure() {
            return status == 401 || status == 403 ? "session" : status == 429 ? "rate_limit" : "failed";
        }
    }
}
