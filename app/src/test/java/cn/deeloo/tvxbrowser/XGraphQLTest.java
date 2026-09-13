package cn.deeloo.tvxbrowser;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class XGraphQLTest {
    private static JSONObject auth(String... headers) throws Exception {
        JSONArray list=new JSONArray();
        for(int i=0;i<headers.length;i+=2)
            list.put(new JSONObject().put("name",headers[i]).put("value",headers[i+1]));
        return new JSONObject().put("headers",list);
    }
    private static JSONObject query(Object feature) throws Exception {
        return new JSONObject().put("queryId","abcdefgh12").put("transaction","dHJhbnNhY3Rpb24=")
            .put("features",new JSONObject().put("flag",feature)).put("fieldToggles",new JSONObject());
    }
    @Test public void http200WithoutDataIsNotSuccess() throws Exception {
        XGraphQL.Response r=new XGraphQL.Response(200,new JSONObject("{}"));
        assertFalse(r.ok());assertFalse(r.definitivelyRejected());
    }
    @Test public void partialDataWithErrorsIsAmbiguous() throws Exception {
        XGraphQL.Response r=new XGraphQL.Response(200,new JSONObject("{\"data\":{},\"errors\":[{\"message\":\"resolver failed\"}]}"));
        assertFalse(r.ok());assertFalse(r.definitivelyRejected());
    }
    @Test public void gatewayFailureMustNotUnlockReplyReplay() throws Exception {
        assertFalse(new XGraphQL.Response(502,new JSONObject()).definitivelyRejected());
        assertTrue(new XGraphQL.Response(422,new JSONObject()).definitivelyRejected());
        assertEquals("rate_limit",new XGraphQL.Response(429,new JSONObject()).failure());
    }
    @Test public void graphqlErrorIsNotProofThatNoSideEffectOccurred() throws Exception {
        XGraphQL.Response r=new XGraphQL.Response(200,new JSONObject("{\"errors\":[{\"code\":1}]}"));
        assertFalse(r.ok());assertFalse(r.definitivelyRejected());
    }
    @Test public void theSignedInAccountComesFromTheSessionCookie() {
        assertEquals("42",XGraphQL.accountId("ct0=fixture; twid=u%3D42; lang=en"));
        assertEquals("",XGraphQL.accountId("ct0=fixture"));
        assertEquals("",XGraphQL.accountId(""));
    }
    @Test public void onlyTheSessionHeadersAreCarriedOver() throws Exception {
        java.util.Map<String,String> headers=XGraphQL.headers(auth(
            "Cookie","twid=u%3D42","Authorization","Bearer t","x-csrf-token","c",
            "User-Agent","tv","X-Forwarded-For","10.0.0.1","Referer","https://evil.example"));
        assertEquals("twid=u%3D42",headers.get("cookie"));
        assertEquals("https://x.com/home",headers.get("referer"));
        assertNull(headers.get("x-forwarded-for"));
    }
    @Test public void anIncompleteSessionCannotBuildARequest() throws Exception {
        try { XGraphQL.headers(auth("Cookie","twid=u%3D42")); fail("expected a session failure"); }
        catch (org.json.JSONException expected) {}
    }
    @Test public void pageMetadataIsInputNotAuthority() throws Exception {
        XGraphQL.validate(query(Boolean.TRUE));
        for (Object hostile : new Object[]{"true", 1, JSONObject.NULL})
            try { XGraphQL.validate(query(hostile)); fail("expected a metadata failure for "+hostile); }
            catch (org.json.JSONException expected) {}
        try { XGraphQL.validate(query(Boolean.TRUE).put("queryId","../../evil")); fail("expected a metadata failure"); }
        catch (org.json.JSONException expected) {}
        try { XGraphQL.validate(query(Boolean.TRUE).put("transaction","not a transaction")); fail("expected a metadata failure"); }
        catch (org.json.JSONException expected) {}
    }
    @Test public void userTweetsIsConfiguredAsGet() {
        assertEquals("GET", XGraphQL.METHODS.get("UserTweets"));
    }
}
