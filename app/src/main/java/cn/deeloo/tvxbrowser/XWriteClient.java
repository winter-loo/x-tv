package cn.deeloo.tvxbrowser;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** A single native writer. Page metadata is input, never a URL/body/credential authority. */
final class XWriteClient {
    interface Callback { void complete(JSONObject result); }
    private final XReadClient session;
    private final XGraphQL.Metadata metadata;
    private final SharedPreferences uncertainReplies;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean busy;
    private volatile boolean closed;
    private volatile HttpURLConnection connection;

    XWriteClient(Context context, XReadClient session, XGraphQL.Metadata metadata) {
        this.session = session; this.metadata = metadata;
        uncertainReplies = context.getSharedPreferences("tvx-pending-writes", Context.MODE_PRIVATE);
    }
    static JSONObject result(String status) {
        try { return new JSONObject().put("status", status); } catch (JSONException e) { throw new IllegalStateException(e); }
    }
    void submit(String postId, boolean like, boolean desired, String text, Callback callback) {
        if (closed || busy) { callback.complete(result("busy")); return; }
        if (!postId.matches("[0-9]{1,25}") || (!like && (text.trim().isEmpty() || text.length() > 10000))) {
            callback.complete(result("invalid")); return;
        }
        final JSONObject auth = session.credentials();
        if (auth == null) { callback.complete(result("session")); return; }
        final String fingerprint = digest(auth.optString("account") + ":" + postId + ":" + text);
        if (!like && uncertainReplies.contains(fingerprint)) { callback.complete(result("unknown")); return; }
        busy = true;
        final String operation = like ? (desired ? "FavoriteTweet" : "UnfavoriteTweet") : "CreateTweet";
        final long start = SystemClock.elapsedRealtime();
        metadata.prepare(operation, info -> {
            if (closed) { busy = false; return; }
            if (info == null || info.has("error") || !session.matchesCredentials(auth)) {
                finish(callback, result("not_ready"), start); return;
            }
            executor.execute(() -> {
                JSONObject outcome = result("failed");
                boolean dispatched = false;
                try {
                    Map<String,String> headers = XGraphQL.headers(auth);
                    if (!info.getString("csrf").equals(headers.get("x-csrf-token"))) throw new IOException("session");
                    if (!like && !XGraphQL.accountId(headers.get("cookie")).matches("[0-9]+")) throw new IOException("session");
                    JSONObject queries = info.getJSONObject("queries");
                    // Validate both definitions before a write is possible.
                    XGraphQL.validate(queries.getJSONObject(operation)); XGraphQL.validate(queries.getJSONObject("TweetResultByRestId"));
                    JSONObject variables = new JSONObject();
                    if (like) variables.put("tweet_id", postId);
                    else variables.put("tweet_text", text).put("dark_request", false)
                        .put("media", new JSONObject().put("media_entities", new JSONArray()).put("possibly_sensitive", false))
                        .put("semantic_annotation_ids", new JSONArray())
                        .put("reply", new JSONObject().put("in_reply_to_tweet_id", postId).put("exclude_reply_user_ids", new JSONArray()));
                    if (!session.matchesCredentials(auth) || closed) throw new IOException("session");
                    if (!like && !uncertainReplies.edit().putBoolean(fingerprint, true).commit()) throw new IOException("journal");
                    dispatched = true;
                    XGraphQL.Response response = request(operation, variables, queries, headers, auth);
                    if (response.ok()) {
                        JSONObject data = response.body.optJSONObject("data");
                        if (like && data != null && "Done".equals(data.optString(desired ? "favorite_tweet" : "unfavorite_tweet"))) {
                            outcome = result("ok").put("liked", desired);
                        } else if (!like) {
                            JSONObject tweet = findTweet(response.body, null);
                            if (tweet != null && postId.equals(tweet.getJSONObject("legacy").optString("in_reply_to_status_id_str"))
                                && text.equals(tweet.getJSONObject("legacy").optString("full_text"))
                                && authorMatches(tweet, headers.get("cookie"))) {
                                outcome = result("ok").put("replyId", tweet.getString("rest_id")).put("reply", tweet);
                            } else outcome = result("unknown");
                        } else outcome = result("unknown");
                    } else outcome = result(response.definitivelyRejected() ? response.failure() : "unknown");
                    if (like && (outcome.optString("status").equals("ok") || outcome.optString("status").equals("unknown"))) {
                        try {
                            JSONObject tweet = read(postId, queries, headers, auth);
                            if (tweet != null) {
                                JSONObject legacy = tweet.getJSONObject("legacy");
                                if (legacy.has("favorited") && legacy.getBoolean("favorited") == desired)
                                    outcome = result("ok").put("liked", desired).put("likes", legacy.optLong("favorite_count"));
                                // A late read must not undo a definitive successful write acknowledgement.
                            }
                        } catch (Exception ignored) { /* A confirmed write remains confirmed. */ }
                    }
                } catch (Exception e) {
                    outcome = result(dispatched ? "unknown" : "not_ready");
                    // Like timeouts may have executed. Reconcile without replaying the mutation.
                    if (like && dispatched && !closed) try {
                        JSONObject tweet = read(postId, info.getJSONObject("queries"), XGraphQL.headers(auth), auth);
                        if (tweet != null && tweet.getJSONObject("legacy").has("favorited")
                            && tweet.getJSONObject("legacy").getBoolean("favorited") == desired)
                            outcome = result("ok").put("liked", desired).put("likes", tweet.getJSONObject("legacy").optLong("favorite_count"));
                    } catch (Exception ignored) {}
                }
                if (!like && !outcome.optString("status").equals("unknown")) uncertainReplies.edit().remove(fingerprint).commit();
                if (!session.matchesCredentials(auth)) outcome = result("session");
                final JSONObject completed = outcome;
                ui.post(() -> finish(callback, completed, start));
            });
        });
    }
    private void finish(Callback callback, JSONObject result, long start) {
        busy = false;
        android.util.Log.w("TvXWritePerf", "result=" + result.optString("status") + " ms=" + (SystemClock.elapsedRealtime()-start));
        if (!closed) callback.complete(result);
    }
    private static String digest(String text) {
        try { return android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)), android.util.Base64.NO_WRAP); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    private JSONObject read(String id, JSONObject queries, Map<String,String> headers, JSONObject auth) throws Exception {
        JSONObject vars=new JSONObject().put("tweetId",id).put("withCommunity",false).put("includePromotedContent",false).put("withVoice",false);
        XGraphQL.Response response=request("TweetResultByRestId",vars,queries,headers,auth);
        return response.ok()?findTweet(response.body,id):null;
    }
    private XGraphQL.Response request(String operation, JSONObject variables, JSONObject queries, Map<String,String> headers, JSONObject auth) throws Exception {
        if (closed || !session.matchesCredentials(auth)) throw new IOException("session");
        try { return XGraphQL.send(operation, variables, queries.getJSONObject(operation), headers, c -> connection = c); }
        finally { connection = null; }
    }
    static boolean authorMatches(JSONObject tweet, String cookies) {
        try {
            String expected = XGraphQL.accountId(cookies);
            String actual = tweet.getJSONObject("core").getJSONObject("user_results").getJSONObject("result").getString("rest_id");
            return expected.matches("[0-9]+") && expected.equals(actual);
        } catch (Exception e) { return false; }
    }
    static JSONObject findTweet(Object value,String id) throws JSONException {
        if(value instanceof JSONObject){JSONObject o=(JSONObject)value;
            if(o.has("rest_id")&&o.optJSONObject("legacy")!=null&&(id==null||id.equals(o.optString("rest_id"))))return o;
            Iterator<String> names=o.keys();while(names.hasNext()){JSONObject t=findTweet(o.get(names.next()),id);if(t!=null)return t;}
        }else if(value instanceof JSONArray){JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++){JSONObject t=findTweet(a.get(i),id);if(t!=null)return t;}}
        return null;
    }
    void close() {closed=true;HttpURLConnection c=connection;if(c!=null)c.disconnect();executor.shutdown();}
}
