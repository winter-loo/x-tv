# Issue #1 acceptance — 2026-09-07

Implementation through `2dc4e4c`, on `main`. The remaining acceptance work is now
covered by browser fixtures, a native decoder regression, and physical-device
checks. No direct X API or private GraphQL integration was introduced.

Design: [Figma TV Reading, frame 2:2](https://www.figma.com/design/ojFk7rTIxIg7PVqRs4UmzI?node-id=2-2).
Device: DBD5XPro, Android 9, 1920×1080 output; Gecko CSS viewport 980×551.

## Automated acceptance

`npm test` passes the existing login-state checks and **9 Firefox tests**. Tests
execute production adapter, reading and navigation modules through the agreed
`TvXAdapter.init / move / activate / handleBack` public interfaces.

- Approved geometry: 96px margins, 824px columns, 80px gutter and 192px content top.
- Supplied author/text, article cover/title/excerpt, and engagement counts.
- Remote scrolling of long text and article excerpts, with scroll reset on post change.
- Missing attachments and native account/tab changes.
- Loading, empty and unrecognized content without false login or uncertain activation.
- Equal-count virtual-row replacement and protection against activating recycled content.
- Detail return, home reconstruction, and return to top.
- Late native row measurement at the projector's scaled viewport.
- Current X login route and rootless signed-out landing page.

The initial seven reading tests also passed three consecutive repetitions. After
subsequent login fixes, the complete nine-test suite passed on the final source.
`assembleDebug`, Java compilation and `lintDebug` pass: **0 errors, 8 existing
warnings**. All six extension JavaScript files pass syntax checks.
`testDebugUnitTest` is **NO-SOURCE**, so it supplies no Android unit-test coverage.

Three browser failures were reproduced before their fixes: delayed reading CSS
left the first card at y=117 instead of y=192; the rootless landing page failed to
show TV login; and a background timeline suppressed an explicit login route.

## Physical reading acceptance

The final `2dc4e4c` APK passed continuous navigation through **150 distinct real
posts**, including **89 attachments and one X Article**. The observations check
stable post identity, visible focus, reading position/width and absence of a false
login overlay. The real Article's cover, title and excerpt were also visually
inspected on the device. No native crash occurred during this run.

After the 150-post run, native Confirm opened the selected status, Back restored
that same home post, a further Back returned to the top after virtual-list eviction,
and a cold app restart recovered the signed-in timeline. Startup probes retry
while Gecko is still creating the X tab; a missing startup tab is not counted as a pass.

## Native PNG crash: reproduced and fixed

The previous `SIGBUS / BUS_ADRALN` was minimized to an ordinary **69×80 RGB PNG**
rendered at 20×24 on a local page without X or the WebExtension adapter. Mozilla
symbols for the old library identify PC `023ebcd4` as
`mozilla::gfx::UnpackRowRGB24_NEON<true>`. Its instruction was a 32-bit-aligned NEON
load from an unaligned address; the callers were the PNG decoder/swizzle pipeline.

The checked-in probe waits for actual `HTMLImageElement.decode()` completion for
15 image widths and checks the device crash log:

```sh
python3 scripts/check-png-decoder.py --serial <adb-device>
```

A version-only comparison produced:

| GeckoView armeabi-v7a version | Same PNG probe |
| --- | --- |
| `155.0.20260826195058` | FAIL — reproduced content-process SIGBUS |
| `155.0.20260903215306` | PASS — all 15 widths decoded |

The newer patch is pinned in `app/build.gradle.kts`. No image rewriting, suppressed
crash handling, disabled SIMD or cookie clearing was used as a workaround.
Version provenance: [Mozilla Maven metadata](https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview-omni-armeabi-v7a/maven-metadata.xml).
Symbols: [Mozilla symbol server documentation](https://firefox-source-docs.mozilla.org/toolkit/crashreporter/crashreporter/Using_the_Mozilla_symbol_server.html).

## Google sign-in and persistence

On the final `2dc4e4c` APK, X was explicitly signed out; its account control was
absent. The rootless landing page displayed the TV login overlay. Two native Down
keys selected Google and Confirm opened a real `accounts.google.com` account
chooser. Selecting the
existing Google account closed the popup, returned to `/home`, and restored the
native account control, real posts and reading focus. The separate existing
`check-google-popup.mjs` check passed as well.

This exercised fresh X authentication using Google's already authenticated account
chooser. Account selection used a native ADB tap; no password or MFA challenge was
requested in this run. The installed final APK retained that X session across
installation and cold restart, including the restart after the 150-post run.
After the final-APK sign-in was repeated, another cold restart also restored the
account control and reading focus without a login overlay.

## Review and reproducibility

Standards and Spec reviewers independently reviewed follow-up changes against
`75f14a0`. The stylesheet listener cleanup finding was fixed and re-reviewed.
Both axes report **0 remaining source findings**.

See [test instructions](../../tests/README.md). Fixtures contain synthetic data and
intercept their X/extension requests; they do not reproduce every future X DOM
variant. Device probes and screenshots stay under ignored `.scratch/issue-1/`.
No account identifiers, cookies, OAuth URLs or live post snapshots are committed.
Apple login, password entry, phone verification and later ticket interactions are
outside this issue's completed acceptance scope.
