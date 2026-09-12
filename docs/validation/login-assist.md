# LAN login assistance prototype validation

Date: 2026-09-12. Device: Dangbei DBD5X Pro, Android 9, ARMv7, 1920×1080.

## Automated checks

- `testDebugUnitTest`: 40 tests passed, including invitation expiry, retry lockout, single-client pairing and revocation.
- `lintRelease` and signed `assembleRelease`: passed with the existing repository warning baseline.
- `playwright test tests/reading.spec.mjs tests/login-assist.spec.mjs`: 14 tests passed. Includes authenticated state transitions, assisted-login entry, short TV viewport focus, scaled pointer input, text clearing, no browser storage and revoked-frame removal.
- `node scripts/check-login-state.mjs`: passed.

## Device checks

A temporary signed diagnostic APK opens a local input fixture instead of X. This preserves the user's existing X session while exercising the same TLS server and GeckoView controls. The diagnostic startup override is restored in `finally` and is not part of the normal APK or committed source.

- HTTPS handshake succeeds; SHA-256 fingerprint matches the certificate displayed on the projector.
- Unpaired frame access, incorrect pairing, cross-origin pairing and second pairing are rejected.
- Paired capture returns the actual 1920×1080 Gecko page; the native pairing dialog is excluded from the shared frame.
- Remote tap focuses the fixture input; ASCII and Chinese text are visible on the projector. Backspace edits the value and Tab moves focus to the next control.
- Remote close revokes access and closes the TLS listener.
- The final normal-startup release APK was reinstalled with the pinned distribution signature. Its bundled assets match the final source, and the projector returns to its existing authenticated timeline. Temporary diagnostic APK and pairing files were removed.
- The fixture uses the existing data-URL mock adapter, which intercepts Enter; this fixture does not establish Enter-to-submit behavior on an actual Google login form. Clicking a page button was separately observed to execute its handler.

## Platform findings

Android 9 Conscrypt needs `DIGEST_NONE` authorization for its already-hashed TLS signature. This is documented by [Android's KeyGenParameterSpec.Builder](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder#setDigests(java.lang.String...)); the application's APK signing key is never used for TLS.

Gecko text submission must run on `InputConnection.getHandler()`. On this Android version the older view-level `SessionTextInput.getHandler(defaultHandler)` can return the UI handler; submitting there may report success without editing the page. The pinned GeckoView 155 bytecode was inspected to verify this distinction.

## Remaining acceptance

An actual fresh X / Google authentication through the remote page still requires user acceptance. Existing projector login data is retained, so this validation does not claim a fresh account login or bypass of X / Google device checks. The public GitHub 0.2.0 release has not been replaced.


## Real Google popup input regression (2026-09-13)

The user reported that sending an email from the assisted-login page failed on Google's real OAuth popup. Reproduced through the user's existing browser page: submitting text showed the input-error message, while Android key input filled that same visible Google field.

Cause: the helper's session supplier called `BrowserActivity.activeSession()`, which intentionally returns the main X session. The rendered GeckoView had switched to the Google popup. Capture and pointer input reached the popup, but text queried the hidden main session's input connection. The fix obtains the input connection from the displayed GeckoView and removes that separate session supplier; main-page navigation semantics remain intact.

Device acceptance after installing the signed fix: the paired HTTPS `/input` endpoint returned 200 for a tap and test email on the real Google popup. An Android UI hierarchy assertion verified that the visible email field contained the exact test string. The test popup was discarded by restarting the app without submitting the test address to Google's next step. This verifies the email-input failure, not completion of Google authentication.

Browser regression: a 503 response previously erased the draft and the next frame refreshed away the error. A failing Playwright test now passes: the draft remains in memory and the separate action-status message survives subsequent frames. Both helper-page tests, all 40 Java tests, release lint and signed assembly passed.

The browser automation tool encountered Chrome `ERR_BLOCKED_BY_CLIENT` when navigating to the helper's new port. One reload remained blocked. No browser protection was changed. The real-device regression therefore used the same authenticated HTTPS API with its TLS certificate fingerprint matched against the projector, rather than claiming that the updated browser flow was fully accepted.


## 登录后进入 TV 阅读器（2026-09-13）

- 复现：Google 登录成功后仍显示网页适配器的“为你推荐 / 正在关注”。Activity 原来只在启动时创建阅读器，并同时要求已有 HomeTimeline、TweetDetail 请求模板，首次登录无法满足。
- 修复：捕获成功的主页会话后通知 Activity；登录完成、OAuth 弹窗关闭时也重新检查入口。只需主页会话即可进入“X · 时间线 / 我的喜欢”，首次详情查询通过当前 X 页的元数据构建，不要求用户先访问原网页详情。帖子和外链交接不被会话通知打断。
- 实机：保留 Google 登录状态覆盖安装。确认时间线内容和图片、“我的喜欢”列表、详情正文及评论均显示；详情按返回直接恢复原列表。实机首次详情使用 TweetDetail 元数据路径成功，未依赖保存的详情模板。
- 实机还观察到较慢网络下原 4 秒连接 / 5 秒读取限制导致首页超时，重试成功；只读请求已放宽至 10 秒连接 / 15 秒读取。
- 自动检查：44 项相关网页测试通过（阅读、元数据、原生阅读界面、喜欢列表），Java 单元测试、lintRelease、正式签名构建通过。元数据新增用例修改前失败、修改后通过。
- 范围：本轮保留账户，未再次退出登录重走 Google 认证；登录成功由用户先行确认。临时诊断只输出请求耗时和结果，最终 APK 已移除该临时日志。
