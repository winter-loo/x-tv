package cn.deeloo.tvxbrowser;

import org.junit.Test;
import static org.junit.Assert.*;

public class LoginFlowTest {
    @Test public void parentPageTimeoutCannotOverwritePopupOrVerificationStatus() {
        LoginFlow flow=new LoginFlow();int attempt=flow.begin(true);
        assertTrue(flow.canShowPageLoadHint());flow.popup(attempt);
        assertFalse(flow.canShowPageLoadHint());flow.popupClosed(attempt);
        assertTrue(flow.canShowPageLoadHint());flow.authenticated(attempt);flow.verify(attempt,true);
        assertFalse(flow.canShowPageLoadHint());flow.close();assertFalse(flow.canShowPageLoadHint());
    }
    @Test public void anHttpSuccessWithoutReadableHomeCannotCompleteLogin() {
        assertFalse(LoginFlow.readableHome("{\"data\":null,\"errors\":[{}]}",null));
        assertFalse(LoginFlow.readableHome("{\"data\":{}}",null));
        String home="{\"data\":{\"home\":{\"home_timeline_urt\":{\"instructions\":[]}}}}";
        assertTrue(LoginFlow.readableHome(home,null));
        assertFalse(LoginFlow.readableHome(home,"session"));
    }
    @Test public void chooserClosingDoesNotCompleteAuthentication() {
        LoginFlow flow = new LoginFlow(); int attempt = flow.begin(true);
        assertTrue(flow.popup(attempt));
        assertFalse(flow.authenticated(attempt));
        assertTrue(flow.popupClosed(attempt));
        assertEquals(LoginFlow.State.WEB, flow.state());
        assertFalse(flow.verify(attempt, true));
    }
    @Test public void completionNeedsCurrentNavigationCredentialsAndSuccessfulRead() {
        LoginFlow flow = new LoginFlow(); int attempt = flow.begin(true);
        flow.authenticated(attempt);
        assertFalse(flow.verify(attempt, false));
        assertTrue(flow.verify(attempt, true));
        assertFalse(flow.verify(attempt, true));
        assertFalse(flow.verified(attempt, false, true));
        assertTrue(flow.verified(attempt, true, true));
        assertEquals(LoginFlow.State.COMPLETE, flow.state());
    }
    @Test public void cancelledAndReplacedAttemptsCannotStealTheScreen() {
        LoginFlow flow = new LoginFlow(); int old = flow.begin(true);
        flow.authenticated(old); flow.verify(old, true); flow.cancel();
        int next = flow.begin(true);
        assertFalse(flow.verified(old, true, true));
        assertFalse(flow.popup(old));
        assertFalse(flow.authenticated(old));
        assertTrue(flow.accepts(next));
        assertEquals(LoginFlow.State.WEB, flow.state());
    }
    @Test public void verificationOutageKeepsWebAuthenticationRecoverable() {
        LoginFlow flow = new LoginFlow(); int attempt = flow.begin(false);
        flow.authenticated(attempt); assertTrue(flow.verify(attempt, true));
        assertFalse(flow.verified(attempt, true, false));
        assertEquals(LoginFlow.State.WEB, flow.state());
        assertTrue(flow.verify(attempt, true));
        flow.close(); assertFalse(flow.verified(attempt, true, true));
    }
}
