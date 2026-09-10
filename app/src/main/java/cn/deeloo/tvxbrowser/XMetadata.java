package cn.deeloo.tvxbrowser;

import java.util.function.Consumer;
import org.json.JSONObject;

/** Waits for live X metadata without blocking the reader or replaying a mutation. UI-thread only. */
final class XMetadata {
    interface Page {
        /** Restores X if the reader owns the session; never navigates an active handoff. */
        boolean ensureXPage();
        void prepare(String operation, Consumer<JSONObject> callback);
    }
    interface Scheduler { void after(long delay, Runnable task); }
    private final Page page;
    private final Scheduler scheduler;
    private Consumer<JSONObject> callback;
    private String operation;
    private int generation;

    XMetadata(Page page, Scheduler scheduler) {
        this.page = page;
        this.scheduler = scheduler;
    }
    void prepare(String operation, Consumer<JSONObject> callback) {
        if (this.callback != null) { callback.accept(null); return; }
        this.operation = operation;
        this.callback = callback;
        int ticket = ++generation;
        scheduler.after(20000, () -> finish(ticket, null));
        attempt(ticket);
    }
    private void attempt(int ticket) {
        if (ticket != generation || callback == null) return;
        if (!page.ensureXPage()) { retry(ticket); return; }
        page.prepare(operation, result -> {
            if (ticket != generation || callback == null) return;
            if (result == null || result.has("error")) retry(ticket);
            else finish(ticket, result);
        });
    }
    private void retry(int ticket) {
        scheduler.after(500, () -> attempt(ticket));
    }
    private void finish(int ticket, JSONObject result) {
        if (ticket != generation || callback == null) return;
        Consumer<JSONObject> completed = callback;
        callback = null;
        generation++;
        completed.accept(result);
    }
    void cancel() { finish(generation, null); }
}
