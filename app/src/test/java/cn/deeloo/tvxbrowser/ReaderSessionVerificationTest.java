package cn.deeloo.tvxbrowser;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ReaderSessionVerificationTest {
    @Test public void capturedOrLegacyTemplateCannotSkipLoginVerification() throws Exception {
        JSONObject session=new JSONObject().put("account","account-a").put("home",new JSONObject());
        assertFalse(XReadClient.verifiedSession(session));
        session.put("verifiedAccount","account-a");
        assertTrue(XReadClient.verifiedSession(new JSONObject(session.toString())));
    }
    @Test public void logoutAndAccountChangeInvalidateReadiness() throws Exception {
        JSONObject session=new JSONObject().put("account","account-b").put("home",new JSONObject())
            .put("verifiedAccount","account-a");
        assertFalse(XReadClient.verifiedSession(session));
        assertFalse(XReadClient.verifiedSession(new JSONObject()));
        session.put("account","account-a").remove("home");
        assertFalse(XReadClient.verifiedSession(session));
    }
}
