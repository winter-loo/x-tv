# Issue #6 — Projector Remote-Only Complete Journey Validation

## Build and Device Identity
- **Repository Commit**: `412d525`
- **Target Device**: Dangbei DBD5X Pro
- **Platform**: Android 9 (API 28), 1920 × 1080 Physical Display
- **GeckoView CSS Viewport**: 980 × 551 (100vw = 980px, scale factor = 0.51)
- **Target Package**: `cn.deeloo.tvxbrowser`

## Full Journey Validation

### 1. Reading → Menu → Inline Reply → Reading
- Initial timeline post focused at top=99, left=49, width=882 (conforming to 980 × 0.9 TV reading specifications).
- Native Menu key opens `#tv-action-overlay` with dialog title "帖子操作", interactive count badges ("评论 · 喜欢"), and buttons "评论" (initially focused) and "喜欢".
- Confirm key on "评论" transitions overlay into `#tv-composer-dialog` (inline reply mode):
  - Populates account identity avatar and reply target handle.
  - Textarea is focused for TV IME input.
  - Submit button is disabled (`aria-disabled="true"`) for empty text.
  - Remote D-pad navigates between textarea, submit, and cancel without trapping.
- Back key cancels composer without publishing and returns predictably to originating home post and reading position.

### 2. Reading → Detail → Column Navigation → Reply → Comments → Home
- Remote Confirm on focused timeline post navigates to canonical post detail route (`/[user]/status/[id]`).
- Detail chrome (`#tv-detail-chrome`) mounts with approved equal proportions: 1008px post column, 48px gap, 672px comments column (normalized to 980 CSS-pixel viewport).
- Default active column is `post` (`data-tv-detail-column="post"`).
- D-pad Right switches active focus highlight to comments column (`data-tv-detail-column="comments"`).
- Independent scrolling verified:
  - Scrolling comments down advanced `window.scrollY` to 472px while post column remained pinned at 0px.
  - Switching to post column and scrolling advanced `root.scrollTop` to 293px while comments column remained pinned at 472px.
- Comment entry button `#tv-detail-entry button` opens approved `#tv-detail-composer-dialog`.
- Back key cancels detail composer without publishing and restores comments column focus.
- Back key returns to home timeline at the exact originating post and focus position.

### 3. Continuous 50-Post Reading Stress Test
- Remote D-pad Down traversed across 50 consecutive distinct real timeline posts.
- Every post consistently aligned to focus line (top ≈ 98, width ≈ 882).
- Zero focus loss, zero trapped navigation, and zero unexpected login overlays during virtualization and DOM list rebuilding.

### 4. Process Restart & Login Preservation
- Force-stopped app (`am force-stop cn.deeloo.tvxbrowser`) and relaunched (`am start`).
- App resumed directly on `https://x.com/home` with X session and authentication intact.
- No unexpected login dialog or overlay appeared over restored timeline content.

## Automated Evidence
- All 10 journey screenshots captured and preserved in `.scratch/issue-6/`:
  - `01_home_reading.png`
  - `02_action_menu.png`
  - `03_inline_reply_composer.png`
  - `04_home_after_cancel.png`
  - `05_detail_post_column.png`
  - `06_detail_comments_column.png`
  - `07_detail_reply_composer.png`
  - `08_home_returned.png`
  - `09_50th_post.png`
  - `10_relaunch_preserved.png`
- Automated test suite passed 42/42 Playwright/Firefox tests.
- Android Gradle lint and debug build passed with 0 errors.
