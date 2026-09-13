package cn.deeloo.tvxbrowser;

/** One attempt owns input and completion. Events from retired attempts are inert. */
final class LoginFlow {
    static boolean readableHome(String body,String error) {
        if(body==null || (error!=null && !error.isEmpty()))return false;
        try {
            return new org.json.JSONObject(body).getJSONObject("data").getJSONObject("home")
                .getJSONObject("home_timeline_urt").optJSONArray("instructions")!=null;
        } catch(Exception ignored){return false;}
    }
    enum State { ENTRY, WEB, POPUP, VERIFYING, COMPLETE, CLOSED }
    private State state = State.ENTRY;
    private int generation;
    private boolean authenticated;
    int begin(boolean visible) {
        generation++;
        authenticated = false;
        state = visible ? State.WEB : State.ENTRY;
        return generation;
    }
    boolean accepts(int ticket) { return ticket == generation && state != State.CLOSED && state != State.COMPLETE; }
    boolean popup(int ticket) {
        if (!accepts(ticket) || state != State.WEB) return false;
        state = State.POPUP;
        return true;
    }
    boolean popupClosed(int ticket) {
        if (!accepts(ticket) || state != State.POPUP) return false;
        state = State.WEB;
        return true;
    }
    boolean authenticated(int ticket) {
        if (!accepts(ticket) || state == State.POPUP) return false;
        authenticated = true;
        return true;
    }
    boolean verify(int ticket, boolean credentialsReady) {
        if (!accepts(ticket) || !authenticated || !credentialsReady || state == State.VERIFYING) return false;
        state = State.VERIFYING;
        return true;
    }
    boolean verified(int ticket, boolean sameCredentials, boolean success) {
        if (!accepts(ticket) || state != State.VERIFYING || !sameCredentials) return false;
        state = success ? State.COMPLETE : State.WEB;
        return success;
    }
    void cancel() { generation++; authenticated = false; state = State.ENTRY; }
    void close() { cancel(); state = State.CLOSED; }
    State state() { return state; }
    boolean canShowPageLoadHint() { return state==State.ENTRY || state==State.WEB; }
    int generation() { return generation; }
}
