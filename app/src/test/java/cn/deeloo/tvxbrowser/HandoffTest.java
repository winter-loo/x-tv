package cn.deeloo.tvxbrowser;
import org.junit.Test;
import static org.junit.Assert.*;

public class HandoffTest {
    @Test public void theReaderOwnsTheScreenUntilAHandoffIsShown() {
        Handoff handoff = new Handoff();
        assertFalse(handoff.active());
        assertFalse(handoff.showing());
        handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        assertTrue(handoff.active());
        assertFalse("waiting still belongs to the reader", handoff.showing());
        handoff.commit("https://example.org/a");
        assertTrue(handoff.ready());
        handoff.show();
        assertTrue(handoff.showing());
        assertFalse("already shown", handoff.ready());
    }
    @Test public void anEndedHandoffRejectsItsOwnLateCallbacks() {
        Handoff handoff = new Handoff();
        int mine = handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        assertTrue(handoff.accepts(mine));
        assertEquals(Handoff.Kind.EXTERNAL, handoff.end());
        assertFalse(handoff.accepts(mine));
        assertFalse(handoff.active());
        handoff.commit("https://example.org/a");
        assertFalse("a paint arriving after the user came back must not show anything", handoff.ready());
        assertEquals(Handoff.Kind.NONE, handoff.end());
    }
    @Test public void openingAgainInvalidatesTheHandoffItReplaced() {
        Handoff handoff = new Handoff();
        int first = handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        int second = handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/b", "");
        assertNotEquals(first, second);
        assertFalse(handoff.accepts(first));
        assertTrue(handoff.accepts(second));
        assertEquals("https://example.org/b", handoff.target());
    }
    @Test public void anExternalHandoffIsArmedByAnyPageThatIsNotX() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        handoff.commit("https://x.com/home");
        assertFalse("the session going back to X must not reveal an external target", handoff.ready());
        handoff.commit("about:blank");
        assertFalse(handoff.ready());
        handoff.commit("https://example.org/a");
        assertTrue(handoff.ready());
    }
    @Test public void aPostHandoffIsArmedByItsOwnPostAndNothingElse() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.POST, "/author/status/1", "menu");
        handoff.commit("https://x.com/author/status/1");
        assertFalse("the page loading is not the adapter reporting it is ready", handoff.ready());
        handoff.announce("/author/status/2");
        assertFalse(handoff.ready());
        handoff.announce("/author/status/1");
        assertTrue(handoff.ready());
        assertEquals("menu", handoff.action());
    }
    @Test public void anExternalHandoffIgnoresWhatTheXAdapterAnnounces() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        handoff.announce("https://example.org/a");
        assertFalse(handoff.ready());
    }
    @Test public void loginHandsOverImmediatelyBecauseThereIsNothingToWaitFor() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.LOGIN, BrowserActivity.X_HOME_URL, "login");
        assertTrue(handoff.ready());
        handoff.show();
        assertTrue(handoff.showing());
    }
    @Test public void aHandoffThatEndedWhileShowingOwnsNothing() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        handoff.commit("https://example.org/a");
        handoff.show();
        assertTrue(handoff.showing());
        assertEquals(Handoff.Kind.EXTERNAL, handoff.end());
        assertFalse("the reader owns the screen again", handoff.showing());
        assertFalse(handoff.active());
    }
    @Test public void whatTheAdapterSaysAfterTheUserCameBackArmsNothing() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.POST, "/author/status/1", "menu");
        handoff.end();
        handoff.announce("/author/status/1");
        assertFalse(handoff.ready());
        handoff.show();
        assertFalse("nothing to show once the handoff is gone", handoff.showing());
    }
    @Test public void aNewHandoffDoesNotInheritTheArmingOfTheOneItReplaced() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.LOGIN, BrowserActivity.X_HOME_URL, "login");
        assertTrue(handoff.ready());
        handoff.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        assertFalse(handoff.ready());
    }
    @Test public void loginKeepsItsFailureTimerUntilXActuallyArrives() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.LOGIN, BrowserActivity.X_HOME_URL, "login");
        handoff.show();
        assertFalse("handing over is not arriving; a lost navigation must still recover",
            handoff.settled());
        handoff.commit("https://example.org/a");
        assertFalse(handoff.settled());
        handoff.commit("https://x.com/home");
        assertTrue(handoff.settled());
    }
    @Test public void theOtherHandoffsSettleOnlyWhenTheScreenChangedHands() {
        Handoff external = new Handoff();
        external.begin(Handoff.Kind.EXTERNAL, "https://example.org/a", "");
        external.commit("https://example.org/a");
        assertFalse(external.settled());
        external.show();
        assertTrue(external.settled());

        Handoff post = new Handoff();
        post.begin(Handoff.Kind.POST, "/author/status/1", "menu");
        post.commit("https://x.com/author/status/1");
        assertFalse("the page arriving is not the adapter being ready", post.settled());
        post.announce("/author/status/1");
        post.show();
        assertTrue(post.settled());
    }
    @Test public void onlyThePageAHandoffPutOnScreenMayCloseIt() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.POST, "/author/status/1", "menu");
        assertFalse("a page that never took the screen cannot close the handoff",
            handoff.closedBy("/author/status/1"));
        handoff.announce("/author/status/1");
        handoff.show();
        assertFalse(handoff.closedBy("/author/status/2"));
        assertTrue(handoff.closedBy("/author/status/1"));
    }
    @Test public void aStaleReturnCannotCollapseTheHandoffThatReplacedIt() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.POST, "/author/status/1", "menu");
        handoff.announce("/author/status/1");
        handoff.show();
        handoff.begin(Handoff.Kind.POST, "/author/status/2", "menu");
        assertFalse("the earlier post's return must not close the new handoff",
            handoff.closedBy("/author/status/1"));
        assertFalse("nor may it close one that has not taken the screen",
            handoff.closedBy("/author/status/2"));
    }
    @Test public void aPostHandoffIsRoutedOncePerDocument() {
        Handoff handoff = new Handoff();
        handoff.begin(Handoff.Kind.POST, "/author/status/1", "menu");
        assertFalse(handoff.routedFrom("https://x.com/home"));
        handoff.routedVia("https://x.com/home");
        assertTrue("asking the same document again would make it navigate again",
            handoff.routedFrom("https://x.com/home"));
        assertFalse("the page it navigated to still has to be asked",
            handoff.routedFrom("https://x.com/author/status/1"));
        handoff.begin(Handoff.Kind.POST, "/author/status/2", "menu");
        assertFalse("a new handoff starts unrouted", handoff.routedFrom("https://x.com/home"));
    }
}
