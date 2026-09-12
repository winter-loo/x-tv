package cn.deeloo.tvxbrowser;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Authenticated, read-only X queries. Session material never enters the reading WebView. */
final class XReadClient {
    interface Callback {
        void complete(String body, String error);
    }
    interface CachedCallback {
        void complete(String body, long savedAt);
    }
    private static final String KEY = "tvx-reader-session";
    /** One screenful of likes and then some: the list is paged, not scrolled. */
    private static final int LIKES_PAGE = 20;
    private final SharedPreferences preferences;
    private final android.util.AtomicFile homeFile;
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
    private final Map<String, FutureTask<Void>> tasks = new ConcurrentHashMap<>();
    private JSONObject session = new JSONObject();
    private volatile boolean closed;
    private int generation;
    private boolean homePrimed, homeFinished;
    private String homeBody, homeError;
    private Callback homeListener;
    Runnable accountChanged;
    /** Live page metadata, for the operations X never sends on its own. */
    XGraphQL.Metadata metadata;

    XReadClient(Context context) {
        preferences = context.getSharedPreferences(KEY, Context.MODE_PRIVATE);
        homeFile = new android.util.AtomicFile(new java.io.File(context.getFilesDir(), "tvx-reader-home"));
        try {
            String saved = preferences.getString("encrypted", null);
            if (saved != null) {
                byte[] packed = Base64.decode(saved, Base64.NO_WRAP);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOf(packed, 12)));
                session = new JSONObject(
                    new String(cipher.doFinal(packed, 12, packed.length - 12), StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {
            preferences.edit().remove("encrypted").apply();
        }
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY))
            return (SecretKey) store.getKey(KEY, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec
                .Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }
    private final java.util.LinkedHashSet<String> seenTweetIds = new java.util.LinkedHashSet<>();

    synchronized void recordSeen(String postId) {
        if (postId != null && postId.matches("[0-9]+")) {
            seenTweetIds.add(postId);
            while (seenTweetIds.size() > 100) {
                java.util.Iterator<String> it = seenTweetIds.iterator();
                it.next();
                it.remove();
            }
        }
    }

    synchronized java.util.List<String> getSeenTweetIds() {
        return new java.util.ArrayList<>(seenTweetIds);
    }

    synchronized boolean available() {
        return session.has("home") && session.has("detail");
    }
    // Trusted native snapshot only. Never expose these headers to the reading WebView.
    /** Everything an operation built from live page metadata needs to authenticate. */
    synchronized JSONObject credentials() {
        try {
            JSONObject template = session.optJSONObject("home");
            if (template == null) return null;
            return new JSONObject().put("account", session.getString("account"))
                .put("generation", generation).put("headers", new JSONArray(template.getJSONArray("headers").toString()));
        } catch (Exception e) { return null; }
    }
    synchronized boolean matchesCredentials(JSONObject snapshot) {
        return !closed && snapshot != null && snapshot.optInt("generation", -1) == generation
            && snapshot.optString("account").equals(session.optString("account"));
    }
    void cachedHome(CachedCallback callback) {
        final int ticket;
        final String account;
        synchronized (this) {
            ticket = generation;
            account = session.optString("account");
        }
        executor.execute(() -> {
            try {
                byte[] packed;
                synchronized (this) {
                    if (!homeFile.getBaseFile().exists() || homeFile.getBaseFile().length() > 10_000_000)
                        return;
                    packed = homeFile.readFully();
                }
                JSONObject saved = new JSONObject(new String(unseal(packed), StandardCharsets.UTF_8));
                if (!account.equals(saved.optString("account")))
                    return;
                String body = saved.getJSONObject("data").toString();
                long at = saved.getLong("at");
                AppLog.w("TvXReaderPerf", "home cache decoded");
                ui.post(() -> {
                    if (!closed && ticket == generation)
                        callback.complete(body, at);
                });
            } catch (Exception e) {
                AppLog.w(
                    "TvXReaderPerf", "home cache unavailable: " + e.getClass().getSimpleName());
            }
        });
    }
    private void saveHome(String body, int ticket) {
        try {
            synchronized (this) {
                if (closed || ticket != generation)
                    return;
                JSONObject saved = new JSONObject()
                                       .put("account", session.getString("account"))
                                       .put("at", System.currentTimeMillis())
                                       .put("data", new JSONObject(body));
                byte[] encrypted = seal(saved.toString().getBytes(StandardCharsets.UTF_8));
                java.io.FileOutputStream out = null;
                try {
                    out = homeFile.startWrite();
                    out.write(encrypted);
                    homeFile.finishWrite(out);
                } catch (Exception e) {
                    if (out != null)
                        homeFile.failWrite(out);
                }
            }
        } catch (Exception ignored) { /* Cache failure must not prevent fresh reading. */
        }
    }
    // Keep hardware-backed operations small; encrypt bulk content with a per-file key.
    // The AndroidKeyStore key wraps that key, so no plaintext key is persisted.
    private byte[] seal(byte[] plaintext) throws Exception {
        byte[] dataKey = new byte[32];
        new java.security.SecureRandom().nextBytes(dataKey);
        Cipher wrapper = Cipher.getInstance("AES/GCM/NoPadding");
        wrapper.init(Cipher.ENCRYPT_MODE, key());
        byte[] wrappingIv = wrapper.getIV(), wrappedKey = wrapper.doFinal(dataKey);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new javax.crypto.spec.SecretKeySpec(dataKey, "AES"));
        byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(plaintext);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[] {'T', 'V', 'X', '2'});
        out.write(wrappingIv);
        out.write(wrappedKey);
        out.write(iv);
        out.write(encrypted);
        return out.toByteArray();
    }
    private byte[] unseal(byte[] packed) throws Exception {
        if (packed.length < 92 || packed[0] != 'T' || packed[1] != 'V' || packed[2] != 'X'
            || packed[3] != '2')
            throw new IllegalArgumentException();
        Cipher wrapper = Cipher.getInstance("AES/GCM/NoPadding");
        wrapper.init(
            Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(packed, 4, 16)));
        byte[] dataKey = wrapper.doFinal(Arrays.copyOfRange(packed, 16, 64));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new javax.crypto.spec.SecretKeySpec(dataKey, "AES"),
            new GCMParameterSpec(128, Arrays.copyOfRange(packed, 64, 76)));
        return cipher.doFinal(Arrays.copyOfRange(packed, 76, packed.length));
    }
    void primeHome() {
        homePrimed = true;
        fetch("r0", "home", "", null, (body, error) -> {
            homeFinished = true;
            homeBody = body;
            homeError = error;
            if (homeListener != null) {
                homeListener.complete(body, error);
                homeListener = null;
                homeBody = null;
            }
        });
    }
    void fetchHome(Callback listener) {
        if (!homePrimed) {
            fetch("r0", "home", "", null, listener);
            return;
        }
        if (homeFinished) {
            listener.complete(homeBody, homeError);
            homeBody = null;
        } else
            homeListener = listener;
    }
    synchronized void clear() {
        homeBody = null;
        homeListener = null;
        homePrimed = false;
        seenTweetIds.clear();
        homeFile.delete();
        generation++;
        session = new JSONObject();
        preferences.edit().remove("encrypted").apply();
        for (FutureTask<Void> task : tasks.values()) task.cancel(true);
        tasks.clear();
        for (HttpURLConnection c : connections.values()) c.disconnect();
        if (accountChanged != null)
            ui.post(accountChanged);
    }
    synchronized void accept(JSONObject request) {
        try {
            URL url = new URL(request.getString("url"));
            String operation = operation(url);
            if (operation == null)
                return;
            String method = request.getString("method");
            if (!method.equals("GET") && !method.equals("POST"))
                return;
            JSONArray headers = request.getJSONArray("headers");
            String token = "";
            for (int i = 0; i < headers.length(); i++) {
                JSONObject h = headers.getJSONObject(i);
                if (h.getString("name").equalsIgnoreCase("Cookie"))
                    for (String cookie : h.getString("value").split(";"))
                        if (cookie.trim().startsWith("auth_token="))
                            token = cookie.trim().substring(11);
            }
            if (token.isEmpty())
                return;
            String account = Base64.encodeToString(
                MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)),
                Base64.NO_WRAP);
            if (session.has("account") && !account.equals(session.optString("account")))
                clear();
            session.put("account", account);
            JSONObject copy = new JSONObject(request.toString());
            copy.remove("event");
            String slot = operation.equals("TweetDetail") ? "detail" : "home";
            boolean first = !session.has(slot);
            session.put(slot, copy);
            if (first)
                AppLog.w("TvXReaderPerf", slot + " session ready");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(session.toString().getBytes(StandardCharsets.UTF_8));
            ByteArrayOutputStream packed = new ByteArrayOutputStream();
            packed.write(cipher.getIV());
            packed.write(encrypted);
            preferences.edit()
                .putString("encrypted", Base64.encodeToString(packed.toByteArray(), Base64.NO_WRAP))
                .apply();
        } catch (Exception ignored) { /* An unusable template never replaces browser login. */
        }
    }
    private static String operation(URL url) {
        if (!"https".equals(url.getProtocol()) || !"x.com".equals(url.getHost()) || url.getPort() != -1)
            return null;
        if (!url.getPath().matches("/i/api/graphql/[^/]+/(HomeTimeline|TweetDetail)"))
            return null;
        return url.getPath().substring(url.getPath().lastIndexOf('/') + 1);
    }
    void fetch(String id, String mode, String postId, String cursor, Callback callback) {
        if (closed)
            return;
        final JSONObject template;
        final int ticket;
        synchronized (this) {
            ticket = generation;
            try {
                template =
                    new JSONObject(session.getJSONObject(mode.equals("home") ? "home" : "detail").toString());
            } catch (Exception e) {
                callback.complete(null, "session");
                return;
            }
        }
        FutureTask<Void> task = new FutureTask<>(() -> {
            long networkStarted = android.os.SystemClock.elapsedRealtime();
            HttpURLConnection connection = null;
            String payload = null, error = null;
            try {
                Uri original = Uri.parse(template.getString("url"));
                String method = template.getString("method");
                JSONObject body = method.equals("POST") ? new JSONObject(template.getString("body")) : null;
                JSONObject variables = body != null ? body.getJSONObject("variables")
                                                    : new JSONObject(original.getQueryParameter("variables"));
                if (mode.equals("home")) {
                    variables.put("count", 20);
                    variables.put("includePromotedContent", false);
                    java.util.List<String> seen = getSeenTweetIds();
                    if (!seen.isEmpty()) {
                        JSONArray arr = new JSONArray();
                        int start = Math.max(0, seen.size() - 60);
                        for (int i = start; i < seen.size(); i++) {
                            arr.put(seen.get(i));
                        }
                        variables.put("seenTweetIds", arr);
                    } else {
                        variables.remove("seenTweetIds");
                    }
                } else {
                    if (!postId.matches("[0-9]+"))
                        throw new IllegalArgumentException();
                    variables.put("focalTweetId", postId);
                }
                // Detail must include an Article's body, not its timeline excerpt.
                JSONObject fieldToggles = null;
                if (mode.equals("detail")) {
                    String fields = original.getQueryParameter("fieldToggles");
                    fieldToggles = body != null ? body.optJSONObject("fieldToggles")
                        : fields == null        ? null
                                                : new JSONObject(fields);
                    if (fieldToggles == null)
                        fieldToggles = new JSONObject();
                    fieldToggles.put("withArticleRichContentState", true);
                    fieldToggles.put("withArticlePlainText", true);
                    if (body != null)
                        body.put("fieldToggles", fieldToggles);
                }
                variables.remove("cursor");
                if (cursor != null && !cursor.isEmpty())
                    variables.put("cursor", cursor);
                Uri.Builder builder = original.buildUpon().clearQuery();
                for (String name : original.getQueryParameterNames()) {
                    if (fieldToggles != null && name.equals("fieldToggles"))
                        continue;
                    builder.appendQueryParameter(name,
                        name.equals("variables") ? variables.toString() : original.getQueryParameter(name));
                }
                if (fieldToggles != null && body == null)
                    builder.appendQueryParameter("fieldToggles", fieldToggles.toString());
                if (mode.equals("home") && body != null) {
                    java.util.Iterator<String> names = body.keys();
                    while (names.hasNext()) {
                        String name = names.next();
                        builder.appendQueryParameter(name, body.get(name).toString());
                    }
                    body = null;
                    method = "GET";
                }
                URL url = new URL(builder.build().toString());
                if (operation(url) == null)
                    throw new IllegalArgumentException();
                connection = (HttpURLConnection) url.openConnection();
                connections.put(id, connection);
                connection.setConnectTimeout(4000);
                connection.setReadTimeout(5000);
                connection.setUseCaches(false);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod(method);
                JSONArray headers = template.getJSONArray("headers");
                for (int i = 0; i < headers.length(); i++) {
                    JSONObject h = headers.getJSONObject(i);
                    String name = h.getString("name");
                    if (name.matches("(?i)Host|Accept-Encoding|Connection|Content-Length|If-None-Match|If-"
                            + "Modified-Since"))
                        continue;
                    connection.setRequestProperty(name, h.getString("value"));
                }
                connection.setRequestProperty("Accept-Encoding", "gzip");
                if (body != null) {
                    byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (java.io.OutputStream out = connection.getOutputStream()) {
                        out.write(bytes);
                    }
                }
                int status = connection.getResponseCode();
                AppLog.w("TvXReaderPerf",
                    mode + " headers ms=" + (android.os.SystemClock.elapsedRealtime() - networkStarted)
                        + " status=" + status
                        + " encoding=" + connection.getHeaderField("Content-Encoding"));
                if (status == 401 || status == 403)
                    error = "session";
                else if (status == 429)
                    error = "busy";
                else if (status != 200)
                    error = "network";
                else
                    try (InputStream in =
                             "gzip".equalsIgnoreCase(connection.getHeaderField("Content-Encoding"))
                            ? new java.util.zip.GZIPInputStream(connection.getInputStream())
                            : connection.getInputStream();
                        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[16384];
                        int n;
                        while ((n = in.read(buffer)) != -1) {
                            if (out.size() + n > 8_000_000)
                                throw new IllegalStateException();
                            out.write(buffer, 0, n);
                        }
                        payload = out.toString("UTF-8");
                        if (!new JSONObject(payload).has("data")) {
                            payload = null;
                            error = "unavailable";
                        }
                    }
            } catch (Exception ignored) {
                error = "network";
            } finally {
                tasks.remove(id);
                connections.remove(id);
                if (connection != null)
                    connection.disconnect();
            }
            AppLog.w("TvXReaderPerf",
                mode + " request ms=" + (android.os.SystemClock.elapsedRealtime() - networkStarted)
                    + " result=" + (error == null ? "ok" : error));
            final String data = payload, problem = error;
            ui.post(() -> {
                if (!closed && ticket == generation)
                    callback.complete(data, problem);
            });
            if (mode.equals("home") && (cursor == null || cursor.isEmpty()) && payload != null
                && error == null)
                saveHome(payload, ticket);
            return null;
        });
        tasks.put(id, task);
        executor.execute(task);
    }
    /**
     * The signed-in reader's own likes. X never issues this query while the reader is up, so
     * there is no captured template to reuse: the operation is built from live page metadata.
     */
    void fetchLikes(String id, String cursor, Callback callback) {
        if (closed) return;
        final JSONObject auth = credentials();
        final XGraphQL.Metadata source = metadata;
        final int ticket;
        synchronized (this) { ticket = generation; }
        if (auth == null || source == null) {
            callback.complete(null, "session");
            return;
        }
        // Claims the request slot straight away: cancel() must reach a fetch still waiting on metadata.
        final FutureTask<Void> gate = new FutureTask<>(() -> null);
        tasks.put(id, gate);
        final long started = android.os.SystemClock.elapsedRealtime();
        source.prepare("Likes", info -> {
            if (closed || ticket != generation || tasks.get(id) != gate) return;
            tasks.remove(id);
            if (info == null || info.has("error") || !matchesCredentials(auth)) {
                AppLog.w("TvXReaderPerf",
                    "likes metadata unavailable ms=" + (android.os.SystemClock.elapsedRealtime() - started));
                callback.complete(null, "not_ready");
                return;
            }
            FutureTask<Void> task = new FutureTask<>(() -> {
                String payload = null, error = null;
                try {
                    Map<String, String> headers = XGraphQL.headers(auth);
                    if (!info.getString("csrf").equals(headers.get("x-csrf-token")))
                        throw new java.io.IOException("session");
                    String userId = XGraphQL.accountId(headers.get("cookie"));
                    if (!userId.matches("[0-9]+")) throw new java.io.IOException("session");
                    JSONObject variables = new JSONObject()
                                               .put("userId", userId)
                                               .put("count", LIKES_PAGE)
                                               .put("includePromotedContent", false)
                                               .put("withClientEventToken", false)
                                               .put("withBirdwatchNotes", false)
                                               .put("withVoice", true)
                                               .put("withV2Timeline", true);
                    if (cursor != null && !cursor.isEmpty()) variables.put("cursor", cursor);
                    XGraphQL.Response response;
                    try {
                        response = XGraphQL.send("Likes", variables, info.getJSONObject("queries").getJSONObject("Likes"),
                            headers, c -> connections.put(id, c));
                    } finally {
                        connections.remove(id);
                    }
                    if (response.status == 401 || response.status == 403) error = "session";
                    else if (response.status == 429) error = "busy";
                    else if (response.status != 200) error = "network";
                    else if (!response.body.has("data")) error = "unavailable";
                    else payload = response.body.toString();
                } catch (Exception e) {
                    error = "session".equals(e.getMessage()) ? "session" : "network";
                } finally {
                    tasks.remove(id);
                }
                AppLog.w("TvXReaderPerf",
                    "likes request ms=" + (android.os.SystemClock.elapsedRealtime() - started)
                        + " result=" + (error == null ? "ok" : error));
                final String data = payload, problem = error;
                ui.post(() -> {
                    if (!closed && ticket == generation) callback.complete(data, problem);
                });
                return null;
            });
            tasks.put(id, task);
            executor.execute(task);
        });
    }
    void cancel(String id) {
        FutureTask<Void> task = tasks.remove(id);
        if (task != null)
            task.cancel(true);
        HttpURLConnection c = connections.remove(id);
        if (c != null)
            c.disconnect();
    }
    void close() {
        closed = true;
        homeBody = null;
        homeListener = null;
        for (String id : tasks.keySet()) cancel(id);
        for (HttpURLConnection c : connections.values()) c.disconnect();
        executor.shutdownNow();
    }
}
