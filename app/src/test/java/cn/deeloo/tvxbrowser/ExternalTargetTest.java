package cn.deeloo.tvxbrowser;
import org.junit.Test;
import static org.junit.Assert.*;

public class ExternalTargetTest {
    @Test public void publisherPagesAndShortenersAreOpenable() {
        assertEquals("https://en.algorithmica.org/hpc/", ExternalTarget.normalize("https://en.algorithmica.org/hpc/"));
        assertEquals("https://t.co/abc", ExternalTarget.normalize("https://t.co/abc"));
        assertEquals("https://example.org/a?b=1#c", ExternalTarget.normalize("https://example.org/a?b=1#c"));
    }
    @Test public void aTargetLeadingBackIntoXIsNotAnExternalTarget() {
        assertNull(ExternalTarget.normalize("https://x.com/author/status/1"));
        assertNull(ExternalTarget.normalize("https://mobile.twitter.com/home"));
        assertNull(ExternalTarget.normalize("https://X.com/home"));
    }
    @Test public void onlyHttpsTargetsReachTheBrowser() {
        assertNull(ExternalTarget.normalize("http://insecure.example/page"));
        assertNull(ExternalTarget.normalize("javascript:alert(1)"));
        assertNull(ExternalTarget.normalize("file:///android_asset/reader/index.html"));
        assertNull(ExternalTarget.normalize("data:text/html,<b>x</b>"));
    }
    @Test public void malformedOrOversizedTargetsAreRefused() {
        assertNull(ExternalTarget.normalize(null));
        assertNull(ExternalTarget.normalize(""));
        assertNull(ExternalTarget.normalize("not a url"));
        assertNull(ExternalTarget.normalize("https:///nohost"));
        assertNull(ExternalTarget.normalize("https://example.org/" + "x".repeat(4000)));
    }
}
