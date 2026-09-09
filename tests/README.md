# Reading regression tests

Run `npm ci`, `npx playwright install firefox`, then `npm test`.
`npm run test:reading -- --grep '<test title>'` runs one behavior while developing.

These tests drive the production `TvXAdapter.init/move/activate/handleBack` public
interfaces in Firefox. The production reading module, navigation runtime and CSS
also execute unchanged. Only x.com's page/router and the WebExtension host API are
simulated. All fixture content is synthetic; no cookies, account data or live
responses are committed. External requests are intercepted, so tests are offline
once Firefox is installed.

Expected geometry comes from approved Figma frame `2:2`: 96px side margins,
824px columns, 80px gutter, 192px content top at 1920×1080. Rectangle comparisons
round to CSS pixels to tolerate Firefox's fractional layout units. A 980×551
case covers the physical projector's CSS viewport.

Fixtures cover article cover/title/excerpt/counts, long-content scrolling, missing
attachments, changing native tabs/account, empty/loading/unrecognized content,
virtual row recycling, late native row measurement and detail/Back restoration.
They reproduce relevant DOM contracts; they do not emulate React's entire list
virtualizer or establish live Google OAuth success.

For the separate native PNG decoder regression, install the debug APK and run:

```
python3 scripts/check-png-decoder.py --serial <adb-device>
```

The device probe restarts the app into a local HTTP page. It creates and removes
its own ADB forwarding rules and server. It preserves app data but leaves the PNG
page open; launch the app's `/home` URL afterward. The probe uses the existing URL
intent and Gecko remote debugger; it needs a debug build and does not load X.

`tests/ux.spec.mjs` additionally covers native-port outages, edited home timestamps,
startup masking until a real TV post is ready, image viewing, same-post DOM replacement, recycled media, and real Firefox
video play/pause/seek/fullscreen/Back without replacing the video element.
`remote-video.webm` is a 14-second, silent, synthetic blue frame generated with:

```sh
ffmpeg -f lavfi -i color=c=steelblue:s=160x90:d=14:r=10 -an -c:v libvpx -b:v 20k tests/fixtures/remote-video.webm
```

For live remote acceptance, start the debug APK on its signed-in home timeline and
run `python3 scripts/check-projector-ux.py --serial <adb-device>`. It opens and returns
from five real posts, verifies a separate detail document and restoration of the retained home document and focus, and looks for a real
image and video within 45 posts. The final report explicitly identifies media types
not encountered. Optional `--screenshots .scratch/ux` keeps private captures local.
The script does not like, reply, submit forms, or change account data.

Nested comment navigation is covered in `tests/detail.spec.mjs`, including own-post
identity, recycled rows, long-comment pagination, ancestor exclusion and the write
entry. `scripts/check-projector-comments.py --serial <adb-device>` verifies three
retained detail levels and restoration of each parent's focus/scroll on live X.
Select a home post with a populated discussion first; no content is published.

`tests/external-links.spec.mjs` drives the local reader's own document
(`app/src/main/assets/reader/`) rather than the X adapter: link extraction from real
GraphQL shapes, the action menu, the link cards, and the opening/cancel/failure state
machine against a stubbed `ReaderHost`. Reader assets must stay ES5 — the projector's
system WebView is Chromium 66.

`scripts/check-external-links.mjs` is the real-device counterpart. It restarts the
installed debug build, fetches one post through the app's own client, replays it, and
drives the remote through open, scroll, return, cancel, t.co redirect and failure,
writing `docs/validation/issue-20-samples.json`. Read-only against X.

`scripts/check-reader-foreground.mjs` covers issue #22 on the device: it compares the
cold-start foreground with the one after an external return, restores timeline, scroll,
detail and comment focus, hammers cancel/repeat with an unroutable target, exercises the
explicit X and login handoffs, and records the reading budget and Gecko session count into
`docs/validation/issue-22-samples.json`. Read-only against X.
