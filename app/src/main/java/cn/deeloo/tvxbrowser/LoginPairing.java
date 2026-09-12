package cn.deeloo.tvxbrowser;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.util.function.LongSupplier;

/** One client, one short-lived invitation. No credentials or tokens are persisted. */
final class LoginPairing {
    private final LongSupplier clock;
    private final long deadline;
    private final String code;
    private String token;
    private int failures;
    private boolean closed;
    LoginPairing(LongSupplier clock) {
        this.clock = clock;
        deadline = clock.getAsLong() + 10 * 60_000;
        SecureRandom random = new SecureRandom();
        code = String.format(java.util.Locale.ROOT, "%08d", random.nextInt(100_000_000));
    }
    String code() { return code; }
    synchronized boolean expired() { return closed || clock.getAsLong() >= deadline; }
    synchronized String pair(String candidate) {
        if (expired() || token != null || failures >= 5) return null;
        if (!equal(code, candidate)) { failures++; return null; }
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        token = result.toString(); return token;
    }
    synchronized boolean permits(String candidate) { return !expired() && token != null && equal(token, candidate); }
    synchronized void close() { closed = true; token = null; }
    private static boolean equal(String a, String b) {
        return b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
