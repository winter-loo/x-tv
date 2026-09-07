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
