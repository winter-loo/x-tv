# Tickets #2 and #3 — integrated review fixes

The two feature branches were reviewed independently against `5ec648b`, then combined. The five reported findings are resolved: expanded-post identification; Comment routing independent of another post's pending mutation; safe recovery from an unknown optimistic result; menu counts; and duplicated pending-state predicates.

Native device checks exposed further cases, now covered by regressions: absolute photo wrappers covering post text, native flex growth widening the reply column, the duplicate sticky Post header, edited-post `/history` timestamps, and service-worker fallback disconnecting a response filter attached before response headers. The observer now attaches at blocking response headers while retaining request identity correlation and passing native response bytes through unchanged. It never initiates or replays an X API request.

## Automated validation

The final combined suite passed all 32 Firefox tests plus the login-state probes at source revision `d8ae534`. It exercises native-shaped DOM and the production extension modules, including rejection, unknown-result recovery, pending cancellation, cross-post isolation, count synchronization, edited/quoted identities, reinjection, column geometry and scroll restoration. `assembleDebug` and `lintDebug` passed (0 errors / 8 baseline warnings); `testDebugUnitTest` has no sources. These fixtures simulate the X page and WebExtension host boundary and do not establish live service behavior by themselves.

## Projector observations

On the DBD5X Pro at 1920 × 1080, native Menu dispatch opens the action overlay. A real post's Like moved its count from 14 to 15 and returned after confirmation; native Unlike displayed confirmation and restored 14, with matching menu counts. All posts used during diagnostics were restored to their original unliked state and inspected after native navigation.

The corrected detail layout measured 1008 pixels for the post and 672 for replies, with photo content below the text and the native sticky header hidden. Measurements are normalized from Gecko's 980 CSS-pixel viewport to the 1920-pixel display. Left/right remote navigation changes the active column without changing the other column's scroll offset. The remote home → detail → switch columns → Back journey returned to the same post at approximately the 192-pixel focus line.

The final APK also passed an edited-post check: the `/history` timestamp resolved to the root, Menu showed its native counts, Comment stayed on the canonical detail, and a long post scrolled independently of the comments (post scroll approximately 292 CSS pixels remained unchanged while comments scrolled approximately 247 CSS pixels).

## Review and limits

Follow-up Standards and Spec reviews found no remaining material source findings. A redundant fallback script injection found during integration was removed. Temporary diagnostic response probes were removed from production source.

The 800 ms interval and injected failure/timeout/recovery sequences are asserted in fixtures. Live confirmation and normal navigation were exercised on the projector; a real server failure, unknown response, or prolonged in-flight request was not deliberately induced on the live account. This record does not claim every possible X DOM variant or network failure has been verified.
