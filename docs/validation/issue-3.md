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

`npm test` passed all 19 Firefox tests (10 actions, 9 reading), plus the login-state checks. `assembleDebug` and `lintDebug` passed; lint reports 0 errors and 8 existing warnings. `testDebugUnitTest` is NO-SOURCE. Runtime dispatcher syntax and `git diff --check` also passed.

The menu screenshot from the synthetic fixture was inspected against the Figma reference. Screenshots and build artifacts remain ignored locally.

## Remaining target-device acceptance

The parent agent coordinates the shared projector. This branch has not installed an APK, navigated the live account, or liked/unliked a live post. Before closing #3, verify the native Menu bridge, actual GeckoView response-filter availability, current X response contract, successful like/unlike and count synchronization, cancellation/failure behavior, and focus restoration on the target device. Restore the original like state of the chosen test post.
