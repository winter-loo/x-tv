# Issue #3 — Post action menu and native like/unlike

## Implementation

The remote Menu key opens the approved menu; F1 remains the mock-timeline shortcut. The content dispatcher and adapter route Menu, up/down, Confirm and Back. Keyboard M is available for desktop testing. The menu begins on Comment, traps focus and page shortcuts, and returns to the same native post. Comment uses the selected post's existing status link; it does not depend on ticket #2 or enable reply submission.

The 640 × 452 menu is positioned at (640, 314) in the 1920 × 1080 reference viewport. Its scrim, panel, spacing, buttons and confirmation match Figma nodes `19:2`, `19:41`, `19:80`, `19:133`, `97:82`, and `102:2` in file `ojFk7rTIxIg7PVqRs4UmzI`. The filled heart is the exact exported Figma asset. Native post identity, counts and event handlers remain owned by X; no React node is moved or replaced.

## Confirmation boundary

An optimistic DOM heart toggle is insufficient evidence of success. The extension first arms a narrowly scoped passive observer, then clicks the actual selected native Like/Unlike control. The observer watches only native `FavoriteTweet` / `UnfavoriteTweet` POST requests on x.com, correlating the tab, top-level frame, selected post ID, operation and request ID. It passes every response byte through unchanged. It never sends, replays or modifies an X API request, and does not read or log request headers.

A 2xx native response with the expected `data.favorite_tweet` / `data.unfavorite_tweet` value `Done`, without errors, confirms the operation. HTTP rejection, response errors and changed/unknown response shapes cannot trigger success. Confirmation also waits for the selected native control to show the matching state. Only then does a like show its confirmation and close after 800 ms. Unlike stays in the menu with the native state/count reflected.

Firefox's documented [StreamFilter API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData) requires `webRequest` and `webRequestBlocking` permissions; these are added to the bundled manifest. The observer buffers at most 64 KiB for parsing and retains no response body after processing. An unsupported observer refuses to initiate a like. A UI timeout does not release an in-flight request's duplicate-action fence; a later native response or transport failure settles it. Closing the menu never cancels or reverses a native action already sent.

## Automated and visual checks

The action suite exercises the production adapter and passive observer through the existing public remote/keyboard and WebExtension-host boundaries, with synthetic X DOM and native responses:

- Approved menu geometry, initial Comment focus, remote and Tab trapping, Back restoration, and selected-post Comment routing.
- Delayed confirmed like, duplicate suppression, untouched response bytes, matching native state/count, and the 800 ms return.
- Optimistic rejection and retry, followed by confirmed unlike.
- Back during a request and late success without focus theft or reopening.
- Unknown response protection and refusal to act on a recycled row.
- Cancellation while arming, before any native click, with immediate retry after reopening.
- Unrelated native response isolation and HTTP failure handling.
- Long-running request protection after the UI timeout, with late confirmation.
- Native keyboard shortcuts cannot escape the menu.
- A native like-state change while arming cannot invert the intended action.

`npm test` passed all 23 Firefox tests (14 actions, 9 reading), plus the login-state checks. `assembleDebug` and `lintDebug` passed; lint reports 0 errors and 8 existing warnings. `testDebugUnitTest` is NO-SOURCE. Runtime dispatcher syntax and `git diff --check` also passed.

The menu screenshot from the synthetic fixture was inspected against the Figma reference. Screenshots and build artifacts remain ignored locally.

## Remaining target-device acceptance

The parent agent coordinates the shared projector. This branch has not installed an APK, navigated the live account, or liked/unliked a live post. Before closing #3, verify the native Menu bridge, actual GeckoView response-filter availability, current X response contract, successful like/unlike and count synchronization, cancellation/failure behavior, and focus restoration on the target device. Restore the original like state of the chosen test post.

## Review fixes

Comment routing is independent of another post's in-flight like. Mutations retain the single-request fence, with an explicit explanation when another post's request is still pending. A shared pending-state predicate and explicit `{ id, path }` post identity keep these decisions consistent. Uncertain results are retained per post rather than lost when another post is opened.

A settled but unconfirmed optimistic toggle offers **重新载入帖子**. This performs a full-document navigation to the canonical native status URL, discarding X's in-memory optimistic state. It does not send an inverse mutation or claim the previous request succeeded. The fresh native detail supports the menu using the shared `TvXPostIdentity` lookup, including expanded timestamps outside User-Name while excluding quotes. The original home anchor and scroll position are saved for return; a recovered home document cannot reuse stale bfcache state. Actual in-flight requests keep their fence and are not offered this settled-result recovery path.

The menu shows native comment and like counts. The like count remains at its previous known value with a pending indicator until the native response and control agree, then updates from X's actual count. Added regressions cover independent Comment, full-document recovery with fresh detail and home-anchor restoration, and pending/confirmed count synchronization. The parent's shared-projector investigation remains the source of live observer validation; these fixture results do not substitute for it.

## Service-worker fallback lifecycle fix

The parent reproduced `ServiceWorker fallback redirection` from the response filter on the projector. Mozilla's [HttpChannelChild source](https://github.com/mozilla/gecko-dev/blob/master/netwerk/protocol/http/HttpChannelChild.cpp) explicitly detaches existing filters during this fallback; [StreamFilterParent](https://github.com/mozilla/gecko-dev/blob/master/toolkit/components/extensions/webrequest/StreamFilterParent.cpp) forwards the disconnect reason as an error. It is not a rejection from X.

The observer now correlates the native request at `onBeforeRequest` but creates its filter only in blocking `onHeadersReceived`, after the fallback and before the response body. Mozilla exercises this attachment point in [test_filter_301](https://github.com/mozilla/gecko-dev/blob/master/toolkit/components/extensions/test/xpcshell/test_ext_webRequest_filterResponseData.js), and the [event documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onHeadersReceived) describes the blocking header stage. The original bytes, selected-post correlation, duplicate fence, and strict confirmation predicate remain unchanged. No request or service-worker bypass is introduced.

The regression reproduces detachment of any pre-response filter, repeats the native request event, verifies duplicate suppression, then delivers headers and the successful native response. It failed against the old observer and passes with the late attachment. This does not claim to solve [Mozilla bug 1817450](https://bugzilla.mozilla.org/show_bug.cgi?id=1817450), where a service worker can produce a separate request ID without usable tab correlation; such an uncorrelated response must not be treated as confirmation. The parent owns final live verification of this patch.
