package cn.deeloo.tvxbrowser;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class XWriteClientTest {
    @Test public void http200WithoutDataIsNotSuccess() throws Exception {
        XWriteClient.Response r=new XWriteClient.Response(200,new JSONObject("{}"));
        assertFalse(r.ok());assertFalse(r.definitivelyRejected());
    }
    @Test public void partialDataWithErrorsIsAmbiguous() throws Exception {
        XWriteClient.Response r=new XWriteClient.Response(200,new JSONObject("{\"data\":{},\"errors\":[{\"message\":\"resolver failed\"}]}"));
        assertFalse(r.ok());assertFalse(r.definitivelyRejected());
    }
    @Test public void gatewayFailureMustNotUnlockReplyReplay() throws Exception {
        assertFalse(new XWriteClient.Response(502,new JSONObject()).definitivelyRejected());
        assertTrue(new XWriteClient.Response(422,new JSONObject()).definitivelyRejected());
        assertEquals("rate_limit",new XWriteClient.Response(429,new JSONObject()).failure());
    }
    @Test public void graphqlErrorIsNotProofThatNoSideEffectOccurred() throws Exception {
        XWriteClient.Response r=new XWriteClient.Response(200,new JSONObject("{\"errors\":[{\"code\":1}]}"));
        assertFalse(r.ok());assertFalse(r.definitivelyRejected());
    }
    @Test public void replyAuthorMustMatchTheAuthenticatedAccount() throws Exception {
        JSONObject t=new JSONObject("{\"core\":{\"user_results\":{\"result\":{\"rest_id\":\"42\"}}}}");
        assertTrue(XWriteClient.authorMatches(t,"ct0=fixture; twid=u%3D42"));
        assertFalse(XWriteClient.authorMatches(t,"twid=u%3D99"));
        assertFalse(XWriteClient.authorMatches(t,"ct0=fixture"));
    }
    @Test public void readbackMustFindTheRequestedPostNotAnEmbeddedQuote() throws Exception {
        JSONObject data=new JSONObject("{\"quote\":{\"rest_id\":\"1\",\"legacy\":{}},\"reply\":{\"rest_id\":\"2\",\"legacy\":{}}}");
        assertEquals("2",XWriteClient.findTweet(data,"2").getString("rest_id"));
        assertNull(XWriteClient.findTweet(data,"3"));
    }
}
