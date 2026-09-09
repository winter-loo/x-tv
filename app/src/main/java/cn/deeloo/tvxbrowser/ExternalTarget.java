package cn.deeloo.tvxbrowser;

import java.net.URI;

/** The single gate an external reading target passes before the browser session loads it. */
final class ExternalTarget {
    private ExternalTarget() {}

    /** Returns the URL to load, or null when the reader offered something we must not open. */
    static String normalize(String url) {
        if (url == null || url.isEmpty() || url.length() > 2000)
            return null;
        URI uri;
        try {
            uri = new URI(url);
        } catch (Exception e) {
            return null;
        }
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || host.isEmpty())
            return null;
        host = host.toLowerCase();
        if (host.equals("x.com") || host.endsWith(".x.com") || host.equals("twitter.com")
            || host.endsWith(".twitter.com"))
            return null;
        return uri.toString();
    }
}
