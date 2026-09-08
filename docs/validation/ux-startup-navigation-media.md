# Startup, navigation and media UX — 2026-09-08

Device: DBD5X Pro, Android 9, 1920 × 1080. Existing X login data was preserved.

The subsequent [comment-details change](comment-details.md) extends the retained detail session to a stack, so comments can open further details and Back restores each parent.

## Diagnosed failures

- Physical OK initially stayed on /home. Logcat reported `Bridge not connected, passing ENTER to GeckoView`; the page had no reading-mode key handler.
- Loading status was incorrectly accepted as presentation readiness. A regression that waits beyond the scheduled readiness frames failed with that condition. Sparse screenshots also missed flashes the user observed, so those early screenshots were not acceptance evidence.
- X can insert its composer before posts into a shared wrapper. A stale hiding annotation then concealed the posts too; the regression failed before the annotation was reconciled.
- Launcher `onNewIntent` reloaded home. X's detail routing also repeatedly rebuilt the virtual timeline and reapplied scroll after Back. Restoring an anchor and listening for scroll were insufficient in repeated device journeys. The APK now retains the home document in its session while displaying detail in a separate session.
- Media could be hidden when its parent also contained text. Expanding ancestors for CSS fullscreen disturbed virtual row geometry. Same-post DOM replacement could also discard media selection. These cases have focused regressions.

## Final behavior

- Native dark overlay and transparent TextureView remain until a real focused TV post and its styles are ready. About-blank and page-stop cannot reveal X early. Native composer hiding is reconciled as X inserts posts. Slow loads allow retry or Back.
- Paired trusted remote keys enter a single page handler. Native messaging has heartbeat/reconnection and disconnect cleanup. Native detail navigation uses a validated internal URI after host discovery, so an interrupted messaging port cannot swallow OK.
- Detail opens a separate Gecko session with the same login storage and the existing TV detail layout. The home session remains intact. Back dismisses overlays first, then closes detail and reattaches home. Back during detail loading also restores home. Inactive-page presentation messages are ignored. Only one detail session is retained at a time.
- Right selects photo/video; OK opens the image viewer or video toolbar. The toolbar supports play/pause, browser fullscreen, seek ±10 seconds, mute/unmute, and close. Back unwinds fullscreen, viewer/toolbar, and selection. React's video and MediaSource stay attached.
- Images support gallery directions, zoom, and directional panning. Long media-post text remains readable with Left. Menu and launcher resume preserve the current post.

## Verification

- Latest APK was installed successfully: `app/build/outputs/apk/debug/app-debug.apk`.
- SHA-256: `ce0401d7030b0e2d62c2e367e8a80868b32ced9162e2cd8a8ab338cf612f407b`.
- `./gradlew assembleDebug lintDebug --console=plain`: **BUILD SUCCESSFUL**, lint 0 errors and 8 existing warnings.
- Final `npm test`: **55 of 56 passed** initially. The existing real-time 800 ms Like-dismissal test missed its 400 ms visibility window under load; `npx playwright test --last-failed` then passed that one case without a code change. The two new retained-session dispatch cases passed. Earlier focused regressions demonstrated red-to-green behavior for startup masking, shared-wrapper hiding, media replacement, and delayed scroll.
- Final installed session implementation: **Two runs of 5 consecutive real-post detail round trips passed (10 total)**, preserving home document time origin, canonical post, and reading alignment. Real image viewing and real video play/pause/fullscreen/Back passed in the same run (`.scratch/ux/retained-home/` and `.scratch/ux/final-verified/`). The second run followed the final cold start and explicitly checked that the detail document had a different time origin while Back restored the original home time origin.
- Additional physical key checks passed: Menu/Back, settled launcher resume, Enter opening detail, video forward/back seeking, mute toggle, image zoom/pan/restore and gallery direction, plus **2 immediate cancellations during detail loading**.
- Startup capture: after reconnect, 25 frames across 26.715 seconds showed launcher → dark loading → TV post, with no original composer in the sampled frames. The latest APK cold start captured 24 frames across 26.658 seconds with the same loading-to-post handoff (`.scratch/ux/startup-release/`); no white app surface or native composer appeared in the samples.

Device journey command:

```sh
python3 scripts/check-projector-ux.py --serial 192.168.10.100:5555 --screenshots .scratch/ux/final
```

The tracked script requires a separate detail document and restoration of the retained home document, at least five round trips, and both image and video controls. It requires stable alignment rather than a single successful sample. Screenshots are optional and private; keep them out of version control. No likes, replies or other account mutations were used for device testing.

## Capture limitation

This firmware's screen recorder fails with encoder error `-38`; ADB screenshots take roughly one second. These sequences cannot rule out a sub-second flash between frames. The loading contract and regressions cover the known early-reveal path, but absence of every visible flash is not claimed without the user's on-screen confirmation.
