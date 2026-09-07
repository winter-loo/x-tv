# Issue #1 validation — 2026-09-07

Implementation: `19a47ba` through `cfafeba`, on `main`. Issue remains open.
Reference: Figma `ojFk7rTIxIg7PVqRs4UmzI`, frame `2:2`.

## Automated checks

- Debug APK assembly, Java compilation and `lintDebug` pass.
- Lint reports 0 errors and 8 existing warnings.
- `testDebugUnitTest` completes with **NO-SOURCE**; it is not unit-test coverage.
- All six bundled extension JavaScript files pass `node --check`.
- Existing `scripts/check-login-state.mjs` regression checks pass: background
  password fields, home loading/empty states, unrelated dialogs and signed-out landing.

## Physical device

DBD5XPro, Android 9, 1920×1080 output; Gecko CSS viewport 980×551.
APK installed with `adb install -r`, preserving the existing signed-in profile.
Checks use actual remote key events and read-only Gecko DOM observations.

- On `f3a17d9`, continuous navigation through 50 distinct real posts passed:
  visible identity-based focus, expected reading position and width, no false login.
  Of these posts, 29 had attachments; none had an X Article cover.
- On `e5059ce`, Confirm opened the selected native status and Back restored that
  same post after home-list reconstruction.
- A cold app restart restored the signed-in home timeline without a login overlay.
- Back-to-top initially failed when native scroll anchoring displaced the page
  after a reset. `1f8212e` retries while waiting for the first row to mount.
- A later intermittent detail-return failure exposed the outgoing detail DOM
  briefly remaining after the URL became `/home`. `cfafeba` waits for the native
  home tab before resolving restoration. On that installed build, opening the
  selected status, returning to the same post, and returning to the top after
  virtual-list eviction passed. Cold-start observation initially ran before the
  X tab existed; a subsequent read confirmed focused home content without login.
- A fresh continuous 50-post run on the final `cfafeba` APK passed the same
  identity, position, width and no-false-login checks. No crash occurred in that
  run; this does not resolve the native crash observed in the preceding run.

## Outstanding acceptance

- A repeated run on `e5059ce` stopped after more than 20 posts with a native
  Gecko content-process crash and a white page. Logcat at 19:44:04 local time:
  `SIGBUS`, `BUS_ADRALN`, thread `TaskController`, process
  `cn.deeloo.tvxbrowser:tab_disable_art_image_7`; first native PC `023ebcd4`.
  Bundled engine: `geckoview-omni-armeabi-v7a:155.0.20260826195058`.
  Root cause and relationship to these adapter changes are undetermined.
  An earlier successful run does not establish final-build stability.
- Representative reading/virtual-list DOM fixtures are not yet added. The TDD
  skill requires user agreement on new test seams; the proposed public adapter
  seam (`init`, `move`, `activate`, `handleBack`) is awaiting a response.
- X Article cover/title/excerpt and overflow behavior need representative fixture
  coverage; the live 50-post sample did not contain an Article cover.
- Full interactive Google OAuth was not repeated. Existing login regression checks
  and persisted-login observations are narrower evidence.

## Review

Standards and Spec were reviewed independently against baseline `863aa50`.
Lifecycle cleanup, shared post recognition, late virtual-row positioning,
detail-return restoration and return-to-top findings were addressed and reviewed.
No remaining source finding in the focused follow-up reviews. Spec acceptance
remains partial because of the validation gaps and unresolved crash above.

Temporary device probes and screenshots are under ignored `.scratch/issue-1/`;
they are not a committed regression suite and contain no evidence of full OAuth.
