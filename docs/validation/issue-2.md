# Issue #2 — post detail and comments

Implementation uses the approved Figma nodes `31:2` and `97:2` in file
`ojFk7rTIxIg7PVqRs4UmzI`. No post/reply content is generated or copied: the
presentation annotates existing X articles and their semantic child nodes.

At a 1920 × 1080 CSS viewport, the post scroll viewport is 1008 × 716 at
(96, 160). The comments column starts at x=1152 and is 672 wide: a 48 px gap.
The native post engagement remains at y=896. The native reply document scrolls
behind fixed header/footer chrome, retaining X's document-scroll pagination.
Left/right changes the visible column outline; up/down scrolls only that column.
The comment entry is disabled until issue #5 supplies the reply flow.

## Automated acceptance

`tests/detail.spec.mjs` exercises the user-approved public adapter seam
(`init`, `move`, `activate`, `handleBack`) against independently supplied native
DOM fixtures:

- Reference geometry, native reply text/identity alignment, disabled comment entry.
- Independent scrolling, fixed engagement/entry, and incremental replies without
  changing the active column or selecting reply articles as timeline posts.
- Loading, no loaded replies, and unavailable selected post states.
- Native overlay dismissal before route Back and restoration of the original
  home post at its reading position.

The shared fixture loads presentation scripts from the bundled manifest so the
existing reading tests also exercise the detail integration. Its native router
and WebExtension boundary are simulated; production presentation code is loaded
unchanged. These checks cannot prove live X selector compatibility or virtual
list behavior on the projector.

Verification run: `npm test` passed both login-state probes and all 13 Firefox
DOM tests. `./gradlew assembleDebug testDebugUnitTest lintDebug` passed; the Java
unit-test task has no source tests, and lint reports 0 errors / 8 baseline warnings.

## Device acceptance — pending

The coordinating agent owns the shared projector. Before closing #2, verify the
APK against a real post with replies, scroll enough replies to trigger native
pagination, switch columns repeatedly, and return to the originating home post.
Inspect native detail identity/time and engagement DOM, long post/media geometry,
loading/unavailable behavior, and the persistent native root during reply
virtualization. No physical-remote acceptance has been claimed by this branch.
