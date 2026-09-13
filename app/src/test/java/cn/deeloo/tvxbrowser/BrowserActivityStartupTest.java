package cn.deeloo.tvxbrowser;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class BrowserActivityStartupTest {
    @Test
    public void missingReaderTemplateDoesNotForceAnAuthenticatedBrowserBackToLogin() {
        assertEquals(BrowserActivity.X_HOME_URL, BrowserActivity.initialXUrl(false));
    }

    @Test
    public void readableSessionStillOpensHome() {
        assertEquals(BrowserActivity.X_HOME_URL, BrowserActivity.initialXUrl(true));
    }
}
