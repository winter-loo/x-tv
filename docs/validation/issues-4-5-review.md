# Issues #4 and #5 — Inline Reply and Post Detail Reply Review

Parallel implementation record for:
- **Issue #4**: Write and send an inline reply from home
- **Issue #5**: Write and send a reply from post details

## Implementations

### Issue #4: Inline reply from home
- **Entry & Layout**: Replaced the temporary Comment-to-detail route from the home post action menu with the approved `#tv-composer-dialog` within `#tv-action-overlay` matching approved Figma frames `75-2`, `75-44`, `75-94`, `84-2`, `84-44`, and `91-12` in 1920 × 1080 coordinate space.
- **Account & Target Identity**: Dynamically populates signed-in identity (`SideNav_AccountSwitcher_Button`) and reply target handle/author.
- **Remote Navigation**: Focus cycles predictably between textarea, submit button, and cancel button via D-pad and Tab without trapping. Remote Confirm triggers editing via installed TV input method.
- **Validation & Duplicate Protection**: Empty or whitespace-only submissions are disabled. In-flight requests lock the submit button with `aria-busy` and suppress repeated activations. Drafts are preserved across dismissals and failures.
- **Real X Submission**: Drives the real X reply flow for the selected post via native DOM selectors without direct API/GraphQL calls. Sent feedback is displayed only upon observable confirmation.
- **State Reconciliation**: Returns cleanly to the originating home post, preserving its like state and reconciling the reply count.

### Issue #5: Reply from post details
- **Entry & Layout**: Activated `#tv-detail-entry button` in `detail.js` and `detail.css`, opening the approved detail composer modal (`68-5`, `68-86`, `84-86`).
- **Remote IME & Navigation**: Supports remote D-pad cycling between textarea, submit, and cancel. Empty submission is blocked.
- **Submission Flow**: Populates native X composer inputs (`tweetTextarea_0`) and triggers `tweetButtonInline`. Shows sent simulation upon confirmed success, updates comment count in `#tv-detail-comments-title`, and preserves independent post/comments column scroll positions upon return.
- **Failure & Retry**: Preserves draft on error/timeout, renders error status banner, and provides an immediate retry path.

## Automated Validation

- **Playwright Suite**: All 42 tests passed (32 baseline + 5 actions regression + 5 detail regression).
- **Android Build & Lint**: `./gradlew lintDebug assembleDebug` passed (0 errors, 8 baseline warnings).
- **DOM Boundary**: Native DOM nodes and React trees are preserved; no unauthorized API/GraphQL requests are introduced.
