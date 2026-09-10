package cn.deeloo.tvxbrowser;

import java.util.ArrayList;
import java.util.List;
import java.util.PriorityQueue;
import java.util.function.Consumer;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class XMetadataTest {
    static final class Fixture implements XMetadata.Page, XMetadata.Scheduler {
        long now;
        boolean external, ready, stalled;
        int restores, probes;
        Consumer<JSONObject> pending;
        final List<JSONObject> results = new ArrayList<>();
        final PriorityQueue<Event> events = new PriorityQueue<>((a,b) -> Long.compare(a.at,b.at));
        final XMetadata preparation = new XMetadata(this, this);
        static final class Event {
            long at; Runnable task;
            Event(long at, Runnable task) { this.at=at; this.task=task; }
        }
        public boolean ensureXPage() {
            if (external) return false;
            if (!ready) restores++;
            return ready;
        }
        public void prepare(String operation, Consumer<JSONObject> callback) {
            probes++;
            if (stalled) pending=callback;
            else callback.accept(new JSONObject());
        }
        public void after(long delay, Runnable task) { events.add(new Event(now+delay,task)); }
        void advance(long ms) {
            long until=now+ms;
            while (!events.isEmpty() && events.peek().at<=until) {
                Event e=events.remove(); now=e.at; e.task.run();
            }
            now=until;
        }
        void begin() { preparation.prepare("FavoriteTweet", results::add); }
    }
    @Test public void waitsForTheRestoredXPageBeyondTheReadersOldRetryBudget() {
        Fixture f=new Fixture(); f.begin(); f.advance(10000);
        assertTrue(f.results.isEmpty()); assertEquals(0,f.probes);
        assertTrue("blank page must request restoration",f.restores>0);
        f.ready=true; f.advance(500);
        assertEquals(1,f.results.size()); assertNotNull(f.results.get(0));
        f.advance(30000); assertEquals(1,f.results.size());
    }
    @Test public void doesNotNavigateOrProbeWhileAnExternalHandoffOwnsTheSession() {
        Fixture f=new Fixture(); f.external=true; f.begin(); f.advance(3000);
        assertEquals(0,f.restores); assertEquals(0,f.probes);
        f.external=false; f.advance(500); assertTrue(f.restores>0);
        f.ready=true; f.advance(500); assertNotNull(f.results.get(0));
    }
    @Test public void metadataNotReadyIsRetriedWithoutOverlappingProbes() throws Exception {
        Fixture f=new Fixture(); f.ready=true; f.stalled=true; f.begin();
        f.advance(1000); assertEquals(1,f.probes);
        f.pending.accept(XWriteClient.result("unused").put("error","not_ready"));
        f.advance(499); assertEquals(1,f.probes);
        f.stalled=false; f.advance(1); assertEquals(2,f.probes);
        assertNotNull(f.results.get(0));
    }
    @Test public void timeoutIsBoundedAndLateMetadataCannotCompleteANewPreparation() {
        Fixture f=new Fixture(); f.ready=true; f.stalled=true; f.begin();
        Consumer<JSONObject> old=f.pending;
        f.advance(20000); assertEquals(1,f.results.size()); assertNull(f.results.get(0));
        f.stalled=false; f.begin(); old.accept(new JSONObject()); f.advance(30000);
        assertEquals(2,f.results.size()); assertNotNull(f.results.get(1));
    }
    @Test public void sessionCancellationDiscardsLateResultsAndScheduledRetries() {
        Fixture f=new Fixture(); f.ready=true; f.stalled=true; f.begin();
        Consumer<JSONObject> old=f.pending;
        f.preparation.cancel(); old.accept(new JSONObject()); f.advance(30000);
        assertEquals(1,f.results.size()); assertNull(f.results.get(0)); assertEquals(1,f.probes);
    }
}
