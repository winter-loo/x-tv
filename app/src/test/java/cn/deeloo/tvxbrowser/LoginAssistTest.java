package cn.deeloo.tvxbrowser;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class LoginAssistTest {
    @Test public void qrInvitationKeepsThePairingCodeOutOfTheHttpRequest() {
        assertEquals("http://192.168.1.20:1234/#code=12345678",
            LoginAssist.qrPayload("http://192.168.1.20:1234","12345678"));
    }
}
