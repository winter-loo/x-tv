package cn.deeloo.tvxbrowser;

/**
 * The one reader → browser handoff in flight, and the generation every asynchronous UI
 * callback must present to still be honoured. It holds no View and no session: callers ask
 * it what is allowed and act. Waiting always belongs to the reader — only {@link #show()}
 * moves the foreground.
 */
final class Handoff {
    /** What the reader handed over for, and the rules that follow from it. */
    enum Kind {
        NONE,
        /** An external reading target. Any non-X page counts, because t.co redirects to it. */
        EXTERNAL,
        /** A post opened on X itself, which only the X adapter can confirm it reached. */
        POST,
        /** Login, which hands the screen over before it has anything to show. */
        LOGIN;

        /** True when a committed document belongs to a handoff of this kind. */
        boolean owns(String url) {
            if (this == NONE) return false;
            return this == EXTERNAL ? ExternalTarget.normalize(url) != null : ExternalTarget.isX(url);
        }

        boolean armsAtOnce() {
            return this == LOGIN;
        }

        boolean armsOnCommit() {
            return this == EXTERNAL;
        }

        boolean armsOnAnnounce() {
            return this == POST;
        }

        /** Login hands over before loading, so its document arriving is what settles it. */
        boolean settlesOnArrival() {
            return this == LOGIN;
        }
    }

    private Kind kind = Kind.NONE;
    private int generation;
    private String target = "", action = "", routed = "";
    private boolean armed, showing, arrived;

    /** Starts a handoff, superseding any other, and returns the generation to quote back. */
    int begin(Kind kind, String target, String action) {
        this.kind = kind;
        this.target = target;
        this.action = action;
        this.armed = kind.armsAtOnce();
        this.showing = this.arrived = false;
        this.routed = "";
        return ++generation;
    }

    /** Ends whatever is in flight and returns its kind, so callers can undo the right thing. */
    Kind end() {
        Kind ended = kind;
        kind = Kind.NONE;
        target = action = routed = "";
        armed = showing = arrived = false;
        generation++;
        return ended;
    }

    int generation() {
        return generation;
    }

    /** True while this callback still belongs to the handoff in flight. */
    boolean accepts(int generation) {
        return kind != Kind.NONE && this.generation == generation;
    }

    boolean active() {
        return kind != Kind.NONE;
    }

    /** True once the browser owns the screen; until then the reader is still in front. */
    boolean showing() {
        return showing;
    }

    Kind kind() {
        return kind;
    }

    String target() {
        return target;
    }

    String action() {
        return action;
    }

    /** The engine committed a document. Only one this handoff owns may arm the screen. */
    void commit(String url) {
        if (!kind.owns(url)) return;
        arrived = true;
        if (kind.armsOnCommit()) armed = true;
    }

    /** The X adapter reported which post it is on. */
    void announce(String path) {
        if (kind.armsOnAnnounce() && target.equals(path)) armed = true;
    }

    /**
     * True when this handoff has already been routed from this document. Asking the X adapter
     * again would make it navigate again, and each navigation injects a fresh content script,
     * which would ask once more — a loop that never lets the adapter finish announcing.
     */
    boolean routedFrom(String committed) {
        return routed.equals(committed);
    }

    void routedVia(String committed) {
        routed = committed;
    }

    /** True when the page asking to close is the one this handoff actually put on screen. */
    boolean closedBy(String path) {
        return showing && kind.armsOnAnnounce() && target.equals(path);
    }

    /** True when the browser may take the screen and has not taken it yet. */
    boolean ready() {
        return armed && !showing;
    }

    void show() {
        if (kind != Kind.NONE) showing = true;
    }

    /** True once this handoff no longer needs its failure timer. */
    boolean settled() {
        return kind.settlesOnArrival() ? arrived : showing;
    }
}
