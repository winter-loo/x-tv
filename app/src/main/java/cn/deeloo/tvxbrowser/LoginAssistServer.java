package cn.deeloo.tvxbrowser;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Deliberately small, bounded HTTP/1.1 surface on a temporary LAN listener. */
final class LoginAssistServer implements AutoCloseable {
    interface Page {
        byte[] frame() throws Exception;
        void input(JSONObject command) throws Exception;
    }
    private final ServerSocket socket;
    private final LoginPairing pairing;
    private final Page page;
    private final byte[] html;
    private final String host;
    private final ExecutorService workers = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(4), new ThreadPoolExecutor.AbortPolicy());
    private final Set<Socket> clients = ConcurrentHashMap.newKeySet();
    private volatile boolean closed;
    LoginAssistServer(InetAddress address, LoginPairing pairing, byte[] html, Page page) throws IOException {
        this.pairing = pairing; this.html = html; this.page = page;
        socket = new ServerSocket(0, 4, address);
        host = address.getHostAddress() + ":" + socket.getLocalPort();
    }
    String url() { return "http://" + host; }
    void start() {
        new Thread(() -> {
            while (!closed) try {
                Socket client = socket.accept(); client.setSoTimeout(5000); clients.add(client);
                try { workers.execute(() -> serve(client)); }
                catch (RejectedExecutionException e) { clients.remove(client); client.close(); }
            } catch (IOException e) { if (!closed) close(); }
        }, "login-assist-listener").start();
    }
    private void serve(Socket client) {
        try (Socket ignored = client) {
            InputStream in = client.getInputStream();
            String[] request = line(in).split(" ");
            if (request.length != 3 || !request[2].equals("HTTP/1.1")) { respond(client,400,"text/plain",new byte[0]); return; }
            Map<String,String> headers = new HashMap<>();
            int headerBytes = 0;
            while (true) {
                String header = line(in); headerBytes += header.length();
                if (headerBytes > 8192) throw new IOException();
                if (header.isEmpty()) break;
                int colon = header.indexOf(':'); if (colon <= 0) throw new IOException();
                String name = header.substring(0,colon).toLowerCase(Locale.ROOT);
                if (headers.put(name,header.substring(colon+1).trim()) != null) throw new IOException();
            }
            String origin = headers.get("origin");
            if (!acceptsSource(host,headers.get("host"),url(),origin,headers.containsKey("transfer-encoding"),
                headers.get("sec-fetch-site"),request[0],request[1])) {
                respond(client,403,"text/plain",new byte[0]); return;
            }
            if (pairing.expired()) { respond(client,410,"text/plain",new byte[0]); return; }
            String method = request[0], path = request[1];
            if (method.equals("GET") && path.equals("/")) { respond(client,200,"text/html; charset=utf-8",html); return; }
            int length;
            try { length = Integer.parseInt(headers.getOrDefault("content-length","0")); }
            catch (NumberFormatException e) { length = -1; }
            if (length < 0 || length > 8192) { respond(client,413,"text/plain",new byte[0]); return; }
            if (method.equals("POST") && !"application/json".equals(headers.get("content-type"))) {
                respond(client,415,"text/plain",new byte[0]); return;
            }
            if (!(method.equals("POST") && path.equals("/pair")) &&
                !authorized(headers.get("authorization"))) {
                respond(client,401,"text/plain",new byte[0]); return;
            }
            byte[] body = new byte[length];
            int offset = 0;
            while (offset < length) { int count = in.read(body,offset,length-offset); if(count<0)throw new EOFException(); offset+=count; }
            try {
                if (method.equals("POST") && path.equals("/pair")) {
                    String token = pairing.pair(new JSONObject(new String(body,StandardCharsets.UTF_8)).optString("code"));
                    respond(client,token == null ? 401 : 200,"application/json",(token == null ? "{}" : new JSONObject().put("token",token).toString()).getBytes(StandardCharsets.UTF_8));
                } else if (method.equals("GET") && path.equals("/frame")) {
                    byte[] frame = page.frame();
                    if (pairing.expired()) respond(client,410,"text/plain",new byte[0]);
                    else respond(client,200,"image/jpeg",frame);
                } else if (method.equals("POST") && path.equals("/input")) {
                    page.input(new JSONObject(new String(body,StandardCharsets.UTF_8)));
                    respond(client,200,"application/json","{}".getBytes(StandardCharsets.UTF_8));
                } else if (method.equals("POST") && path.equals("/close")) {
                    pairing.close(); respond(client,200,"application/json","{}".getBytes(StandardCharsets.UTF_8));
                } else respond(client,404,"text/plain",new byte[0]);
            } catch (org.json.JSONException | IllegalArgumentException e) {
                respond(client,400,"text/plain",new byte[0]);
            } catch (Exception e) {
                respond(client,503,"text/plain",new byte[0]);
            } finally { Arrays.fill(body,(byte)0); }
        } catch (Exception ignored) {
            // Never log requests, frame contents or text input, including on malformed input.
        } finally { clients.remove(client); }
    }
    private boolean authorized(String header) {
        return header != null && header.startsWith("Bearer ") && pairing.permits(header.substring(7));
    }
    static boolean acceptsSource(String expectedHost,String requestHost,String expectedOrigin,String origin,
        boolean transferEncoding,String fetchSite,String method,String path) {
        // A QR scanner hands the URL to Chrome as a cross-site top-level navigation. The landing
        // document is read-only; pairing and every authenticated endpoint stay same-origin only.
        boolean qrLanding="cross-site".equals(fetchSite)&&"GET".equals(method)&&"/".equals(path);
        return expectedHost.equals(requestHost)&&(origin==null||expectedOrigin.equals(origin))&&!transferEncoding&&
            (!"cross-site".equals(fetchSite)||qrLanding);
    }
    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); int previous = -1;
        while (out.size() < 8192) {
            int b = in.read(); if (b < 0) throw new EOFException();
            if (previous == '\r' && b == '\n') return out.toString(StandardCharsets.US_ASCII.name()).substring(0,out.size()-1);
            if (b > 127 || b == 0) throw new IOException();
            out.write(b); previous = b;
        }
        throw new IOException();
    }
    private static void respond(Socket socket, int status, String type, byte[] body) throws IOException {
        OutputStream out = socket.getOutputStream();
        String headers = "HTTP/1.1 " + status + " Response\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length +
            "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n" +
            "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'\r\nConnection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.US_ASCII)); out.write(body); out.flush();
    }
    public void close() {
        closed = true; pairing.close();
        try { socket.close(); } catch (IOException ignored) {}
        for (Socket client : clients) try { client.close(); } catch (IOException ignored) {}
        workers.shutdownNow();
    }
}
