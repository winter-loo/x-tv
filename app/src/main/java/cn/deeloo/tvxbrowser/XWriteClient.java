package cn.deeloo.tvxbrowser;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
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
    interface Metadata { void prepare(String operation, java.util.function.Consumer<JSONObject> callback); }
    private final XReadClient session;
    private final Metadata metadata;
    private final SharedPreferences uncertainReplies;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean busy;
    private volatile boolean closed;
    private volatile HttpURLConnection connection;

    XWriteClient(Context context, XReadClient session, Metadata metadata) {
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
        final JSONObject auth = session.writeSession();
        if (auth == null) { callback.complete(result("session")); return; }
        final String fingerprint = digest(auth.optString("account") + ":" + postId + ":" + text);
        if (!like && uncertainReplies.contains(fingerprint)) { callback.complete(result("unknown")); return; }
        busy = true;
        final String operation = like ? (desired ? "FavoriteTweet" : "UnfavoriteTweet") : "CreateTweet";
        final long start = SystemClock.elapsedRealtime();
        metadata.prepare(operation, info -> {
            if (closed) { busy = false; return; }
            if (info == null || info.has("error") || !session.matchesWriteSession(auth)) {
                finish(callback, result("not_ready"), start); return;
            }
            executor.execute(() -> {
                JSONObject outcome = result("failed");
                boolean dispatched = false;
                try {
                    Map<String,String> headers = headers(auth);
                    if (!info.getString("csrf").equals(headers.get("x-csrf-token"))) throw new IOException("session");
                    if (!like && !accountId(headers.get("cookie")).matches("[0-9]+")) throw new IOException("session");
                    JSONObject queries = info.getJSONObject("queries");
                    // Validate both definitions before a write is possible.
                    validate(queries.getJSONObject(operation)); validate(queries.getJSONObject("TweetResultByRestId"));
                    JSONObject variables = new JSONObject();
                    if (like) variables.put("tweet_id", postId);
                    else variables.put("tweet_text", text).put("dark_request", false)
                        .put("media", new JSONObject().put("media_entities", new JSONArray()).put("possibly_sensitive", false))
                        .put("semantic_annotation_ids", new JSONArray())
                        .put("reply", new JSONObject().put("in_reply_to_tweet_id", postId).put("exclude_reply_user_ids", new JSONArray()));
                    if (!session.matchesWriteSession(auth) || closed) throw new IOException("session");
                    if (!like && !uncertainReplies.edit().putBoolean(fingerprint, true).commit()) throw new IOException("journal");
                    dispatched = true;
                    Response response = request(operation, variables, queries, headers, auth);
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
                        JSONObject tweet = read(postId, info.getJSONObject("queries"), headers(auth), auth);
                        if (tweet != null && tweet.getJSONObject("legacy").has("favorited")
                            && tweet.getJSONObject("legacy").getBoolean("favorited") == desired)
                            outcome = result("ok").put("liked", desired).put("likes", tweet.getJSONObject("legacy").optLong("favorite_count"));
                    } catch (Exception ignored) {}
                }
                if (!like && !outcome.optString("status").equals("unknown")) uncertainReplies.edit().remove(fingerprint).commit();
                if (!session.matchesWriteSession(auth)) outcome = result("session");
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
    private static Map<String,String> headers(JSONObject auth) throws JSONException {
        Map<String,String> result = new HashMap<>();
        JSONArray list = auth.getJSONArray("headers");
        for(int i=0;i<list.length();i++) {
            JSONObject h=list.getJSONObject(i);String name=h.getString("name").toLowerCase(Locale.ROOT);
            if (Arrays.asList("authorization","cookie","x-csrf-token","user-agent").contains(name)) result.put(name,h.getString("value"));
        }
        if (!result.containsKey("cookie") || !result.containsKey("authorization") || !result.containsKey("x-csrf-token")) throw new JSONException("session");
        result.put("content-type","application/json");result.put("x-twitter-auth-type","OAuth2Session");
        result.put("x-twitter-active-user","yes");result.put("x-twitter-client-language","en");
        result.put("origin","https://x.com");result.put("referer","https://x.com/home");
        return result;
    }
    private static void validate(JSONObject q) throws JSONException {
        if (!q.getString("queryId").matches("[A-Za-z0-9_-]{8,100}") || !q.getString("transaction").matches("[A-Za-z0-9+/=_-]{8,1024}")) throw new JSONException("metadata");
        for(String key:Arrays.asList("features","fieldToggles")) {
            JSONObject values=q.getJSONObject(key);if(values.length()>200)throw new JSONException("metadata");
            Iterator<String> names=values.keys();while(names.hasNext()) {String name=names.next();if(!name.matches("[A-Za-z0-9_]{1,150}") || !(values.get(name) instanceof Boolean))throw new JSONException("metadata");}
        }
    }
    private JSONObject read(String id, JSONObject queries, Map<String,String> headers, JSONObject auth) throws Exception {
        JSONObject vars=new JSONObject().put("tweetId",id).put("withCommunity",false).put("includePromotedContent",false).put("withVoice",false);
        Response response=request("TweetResultByRestId",vars,queries,headers,auth);
        return response.ok()?findTweet(response.body,id):null;
    }
    private Response request(String operation, JSONObject variables, JSONObject queries, Map<String,String> headers, JSONObject auth) throws Exception {
        if (closed || !session.matchesWriteSession(auth)) throw new IOException("session");
        if (!Arrays.asList("FavoriteTweet","UnfavoriteTweet","CreateTweet","TweetResultByRestId").contains(operation)) throw new IOException("operation");
        JSONObject q=queries.getJSONObject(operation);validate(q);
        boolean read=operation.equals("TweetResultByRestId");
        Uri.Builder uri=Uri.parse("https://x.com/i/api/graphql/"+q.getString("queryId")+"/"+operation).buildUpon();
        JSONObject body=new JSONObject().put("variables",variables).put("queryId",q.getString("queryId"));
        if(read) {uri.appendQueryParameter("variables",variables.toString());uri.appendQueryParameter("features",q.getJSONObject("features").toString());uri.appendQueryParameter("fieldToggles",q.getJSONObject("fieldToggles").toString());}
        else {if(q.getJSONObject("features").length()>0)body.put("features",q.getJSONObject("features"));if(q.getJSONObject("fieldToggles").length()>0)body.put("fieldToggles",q.getJSONObject("fieldToggles"));}
        HttpURLConnection c=(HttpURLConnection)new URL(uri.build().toString()).openConnection();connection=c;
        long started=SystemClock.elapsedRealtime();
        try {
            c.setConnectTimeout(4000);c.setReadTimeout(5000);c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setRequestMethod(read?"GET":"POST");
            for(Map.Entry<String,String> h:headers.entrySet())c.setRequestProperty(h.getKey(),h.getValue());
            c.setRequestProperty("x-client-transaction-id",q.getString("transaction"));
            c.setRequestProperty("Accept-Encoding","gzip");
            if(!read){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
            int status=c.getResponseCode();InputStream raw=status>=400?c.getErrorStream():c.getInputStream();
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(raw!=null)try(InputStream in="gzip".equalsIgnoreCase(c.getContentEncoding())?new java.util.zip.GZIPInputStream(raw):raw){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>2_000_000)throw new IOException("size");bytes.write(buffer,0,n);}}
            JSONObject data;try{data=new JSONObject(bytes.toString("UTF-8"));}catch(JSONException e){data=new JSONObject();}
            android.util.Log.w("TvXWritePerf",operation+" status="+status+" ms="+(SystemClock.elapsedRealtime()-started));
            return new Response(status,data);
        } finally {connection=null;c.disconnect();}
    }
    private static String accountId(String cookies) {
        try {
            for (String entry : cookies.split(";")) if (entry.trim().startsWith("twid="))
                return URLDecoder.decode(entry.trim().substring(5), "UTF-8").replaceFirst("^u=", "");
        } catch (Exception ignored) {}
        return "";
    }
    static boolean authorMatches(JSONObject tweet, String cookies) {
        try {
            String expected = accountId(cookies);
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
    static final class Response {
        final int status;final JSONObject body;
        Response(int status,JSONObject body){this.status=status;this.body=body;}
        boolean ok(){return status==200&&body.has("data")&&(body.optJSONArray("errors")==null||body.optJSONArray("errors").length()==0);}
        boolean definitivelyRejected(){return Arrays.asList(400,401,403,404,422,429).contains(status);}
        String failure(){return status==401||status==403?"session":status==429?"rate_limit":"failed";}
    }
    void close() {closed=true;HttpURLConnection c=connection;if(c!=null)c.disconnect();executor.shutdown();}
}
