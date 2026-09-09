# Issue #20 — 从本地阅读器打开外链卡片和正文链接

**验收构建**：`app-debug.apk`（`versionName 0.2.0`，`versionCode 2`），本地 `assembleDebug` 产出并 `adb install -r` 安装到当贝 DBD5X Pro（`192.168.10.100:5555`，系统 WebView `com.android.webview 66.0.3359.158`，GeckoView `155.0.20260903215306`）。
**指定样例**：https://x.com/idoubicc/status/2097620728610963675
**复现脚本**：`node scripts/check-external-links.mjs`（只读 X：抓取一条帖子并回放，不点赞、不评论、不改账号）
**原始证据**：`docs/validation/issue-20-samples.json`

## 问题定位（先复现，再改）

用指定样例在安装版上取真实数据，逐段记录：

| 阶段 | 观测 |
| :--- | :--- |
| 真实目标 URL | `entities.urls[0]`：`t.co = https://t.co/mp7haBGUWd`，`expanded = https://termany.sh` |
| 卡片/正文提取 | 修复前 `links` 只有 `{label: display_url, url: expanded_url}`，卡片标题与域名完全没有进入数据层 |
| 用户确认 | `ReaderHost.browser(url, 'external')` 走的是帖子操作通道，`FastReader` 立刻 `setVisibility(GONE)` |
| 目标可读 | 阅读器被隐藏后按键不再进入 `FastReader.handleKey`，返回键落到 `TvKeyRouter` 的兜底分支 `mExitHandler` → `finish()`，即**退出整个应用**而不是回到帖子 |

即：不是 Gecko 故障，也不是接口故障，而是外链走了为「回 X 原帖」设计的通道，缺少自己的加载、取消、失败与返回状态。

## 各验收项与证据

### 卡片与操作菜单列出可辨认的外链标题和域名

两个入口都建了。正文下方每条链接一张 `.link-card`（时间线与详情共用 `postHtml` 的 `.body`，评论不渲染卡片）；同一批链接同时出现在菜单里，带 `.external` 类。两处都是标题一行、域名一行。

菜单实测（`menu` 记录）：

```
写评论 / 取消喜欢 / [external] label="termany.sh" domain="termany.sh"
```

卡片实测（`card-tapped` 记录）：在卡片中心 `(510, 408)` 发 `adb shell input tap`，直接进入「正在打开 termany.sh」，`stages` 为 `open token=1 url=https://termany.sh/`。这是真实的鼠标路径证据，不是「和遥控器共用一个分支」的推断。遥控器路径则是菜单里确认（`opening` 记录）。

标题与域名的来源：有 `card.legacy.binding_values` 时取其 `title` 与 `domain`，否则用 `display_url` 与目标主机名。**指定样例这条帖子没有 card**，所以真机跑到的是后一条分支（`title == domain == termany.sh`）；卡片标题分支只由 `tests/external-links.spec.mjs` 覆盖，未在真机上跑到。正文多链接同理，只有自动化覆盖。

### 不再停在 X 原帖

`data.js` 丢弃任何解析后落在 `x.com`/`twitter.com` 的目标（引用推文的永久链接就属于这类），Java 侧 `ExternalTarget.normalize` 再挡一次。两层都有回归测试。

### t.co 与目标站重定向

t.co 返回的是 **HTTP 200 的 HTML 中转页**（不是 301），它的 JS 跳转会把上一次加载打断成 `onPageStop(success=false)`。最初把这个当失败处理，实测直接判成「未能打开」。现在只有 `onLoadError` 与超时算失败。实测跳转链路：

```
open token=5 url=https://t.co/mp7haBGUWd
loading   url=https://t.co/mp7haBGUWd
loading   url=https://termany.sh/
readable  token=5 url=https://termany.sh/
```

中转页本身没有触发首次内容绘制，所以不会闪出空白中转页。

### 加载期间立即有反馈，返回可取消

确认后阅读器**不隐藏**，就地压一层 `.external-status`：域名 + 标题 + `正在打开…　返回 取消`。实测按键到读到该层 955ms，其中含 adb 按键往返与脚本 400ms 轮询间隔，属上限而非渲染耗时——该层是 `openExternal()` 里同步渲染的，先于任何跨进程调用。

对不可达目标 `https://10.255.255.1/hangs` 按返回（`cancelled` 记录）：阅读器立即回到原帖，`stages` 为 `open → loading → closed`，随后静置 8 秒无任何迟到回调改写界面（`after-late-callbacks` 为空）。

### 失败有明确提示与重试

`https://unreachable.invalid/page`（`failed` 记录）：

```
open → loading → failed token=7 reason=error-147 → closed
```

`error-147` 即 GeckoView 的未知主机。界面回到阅读器并显示 `未能打开这个链接　确认 重试　返回 回到帖子`；按确认重新发起（`retried` 记录回到「正在打开…」），按返回回到帖子。

### 迟到页面回调不能覆盖已恢复的阅读器

两道闸门：

1. `mExternalToken` 让取消/失败之后的回调全部作废。
2. `mExternalLoading` 只在 `onLocationChange` 里赋值，且必须通过 `ExternalTarget.normalize`——也就是**已经提交（committed）的、非 X 的外部文档**。`revealExternal()` 要求它非空，所以「当前文档是 x.com 或 about:blank」时任何绘制回调都无法让阅读器让位。

第二道是真机证据逼出来的。最初它挂在 `onPageStart` 上，只能保证「有某次加载开始了」，日志里出现过 `open → readable → loading`：阅读器为**上一张页面**（`endExternal` 之后回载的 x.com）的绘制让了位，用户会看到一瞬的 X 首页。改成按提交文档判定后，`failed` 记录里那次连 `loading` 都不会出现（域名解析失败，从未提交），自然也就 `readable` 不了。脚本对整段日志断言 `readable` 之前必须有本次的 `loading`，回归会直接失败。

### 普通外链在内置浏览界面打开，可阅读并能回到发起的帖子

`revealExternal()` 之后阅读器 `View.GONE`，外链页独占屏幕。上下键在原生层走 `PanZoomController.scrollBy(±0.72 视口高, SCROLL_BEHAVIOR_SMOOTH)`，不依赖页面自身的按键处理——实测连按三次下键屏幕指纹从 `b9bdf66d…` 变为 `c6f9f870…`（`scrolled` 记录）。返回键回到发起的那条帖子（`returned` 记录，`posts=1`、`external=null`）。更广的启动/返回界面统一留给 #22。

## 回归测试

- `tests/external-links.spec.mjs`（17 项）：卡片数据合并、X 自链剔除、多链接顺序、`unwound_url` 优先、未解析 t.co 仍可打开、无可用数据不给入口、长文 `entity_set`、菜单标题/域名、正文卡片渲染与点击、评论不渲染卡片、打开/取消/失败/重试、迟到回调、加载期间吞按键。
- `app/src/test/.../ExternalTargetTest.java`（4 项）：只放行 https、拒绝回 X 的目标、拒绝畸形与超长 URL。
- `scripts/check-external-links.mjs`：真机遥控器全流程验收，可重复运行。

全量：Playwright 113 项通过，JVM 单测通过。
