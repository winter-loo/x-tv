# Issue #22 — 统一启动与外链返回的阅读界面，并恢复原阅读位置

**验收构建**：`app-debug.apk`（`versionName 0.2.0`，`versionCode 2`），本地 `assembleDebug` 产出并 `adb install -r` 安装到当贝 DBD5X Pro（`192.168.10.100:5555`，系统 WebView `com.android.webview 66.0.3359.158`，GeckoView `155.0.20260903215306`）。
**指定样例**：https://x.com/pepeller/status/2091922092543402349
**复现脚本**：`node scripts/check-reader-foreground.mjs`（只读 X：抓取帖子并回放，不点赞、不评论、不改账号）
**原始证据**：`docs/validation/issue-22-samples.json`

## 一、是否存在两条渲染路径：结论

**曾经有，根因在返回键的兜底路径，不在启动路径。**

启动一直只有一条：登录可用时 `BrowserActivity.onCreate` 先建 `FastReader`，Gecko 延后到首屏渲染后 1.5 秒才预热。本轮冷启动实测 `surfaces = {reader: V, gecko: absent}` —— 时间线出现时 GeckoView 甚至还不在视图树里，所以「启动显示 X 时间线」是本地阅读器，没有第二条启动路径。

「外链返回显示为你推荐」来自返回键：修复前外链一打开就把阅读器 `setVisibility(GONE)`，此后按键不再进 `FastReader.handleKey`，BACK 落到 `TvKeyRouter.performFallbackBack()` → `mCanGoBack` 为真 → `mSession.goBack()`，于是退回到 Gecko 里那张 x.com/home，也就是用户看到的「为你推荐」。这条路径已在 #20 关闭（外链有了自己的返回分支）。

本工单在此之上把**三种交接**（外链 / 打开原帖 / 登录）收进一个协调对象，堵住剩下的前台抢占：

| 修复前的抢占来源 | 现在 |
| :--- | :--- |
| `exit_requested` 在阅读器前台时也会 `finish()` | 只有交接正在占屏时才处理；没有阅读器（纯登录启动）才退出 |
| `presentation_ready` 无条件 `showPresentation()`，抢走阅读器 WebView 的焦点 | 阅读器在前台时只收起加载层，不改 alpha、不抢焦点 |
| 后台页面先清掉加载层，之后的交接会卡在 alpha=0 的透明 GeckoView | 揭示改为幂等，不再因加载层已隐藏而提前 return |
| 外链关闭后急切回载 x.com/home，凭空多一次网页加载和一批回调 | 关闭时只 `about:blank`；X 由下一次交接按需加载 |
| 登录交接一交出就清掉失败计时器，导航丢失后无法恢复 | 计时器保留到 X 自己的文档提交为止（`Handoff.settled()`） |

## 二、协调对象

`Handoff`（`app/src/main/java/cn/deeloo/tvxbrowser/Handoff.java`）只保存「同时最多一次交接」的身份，不持有任何 View 或 Session，因此可以在纯 JVM 下单测：

- `begin(kind, target, action)` 返回代次，任何异步回调都要用它换取受理；`end()` 推进代次，让在途回调全部作废。
- 等待期间前台仍属于阅读器；只有 `show()` 移交前台。
- `commit(url)` 记录引擎已提交的文档，只有**本次交接持有的那一类**文档才算数：外链认任何非 X 的 https 页面（t.co 会跳到未知域名，不能拿目标 URL 逐字比对），打开原帖与登录只认 X 文档。
- `announce(path)` 是 X adapter 报告自己所在帖子，只有打开原帖采信，且要求路径与本次目标一致。
- `closedBy(path)` 决定页面是否有资格关掉这次交接：必须已经占屏，且报的是它自己那条帖子——上一份文档的迟到 return 因此关不掉新开的交接。

14 项 JVM 单测覆盖这些规则，包括「结束后到达的绘制不得显示任何东西」「新交接不继承旧交接的武装状态」「登录在 X 真正到达前不许熄灭失败计时器」「迟到的 return 关不掉取代它的那次交接」。

## 三、各验收项与证据

### 启动与返回具有一致标题、工具栏及帖子展示

冷启动 `title = "X · 时间线"`，工具栏为 `help: ↑↓ 切换帖子 确认 帖子详情 → 查看媒体 菜单 更多操作`。外链返回后标题与工具栏底部提示逐字一致（脚本对二者都做断言）；`position` 与作者回到打开链接的那条帖子（`timeline-return` 的 before/after 完全一致）。

需要说清楚比较对象：**标题与工具栏**是拿冷启动和返回后对比；**帖子与位置**是拿同一条时间线上「打开外链前 / 返回后」对比。返回用的时间线是把指定样例回放进阅读器得到的（`1 / 35`），不是冷启动那份真实时间线（`1 / 36`），因为脚本需要确保当前帖子确实带外链。

显式选择原网站仍与正常返回区分：`explicit-x-handoff` 记录里 `surfaces = {reader: G, gecko: V}`，屏幕确实交给了 X；`explicit-x-return` 按 2 次返回（第一次关掉 X 上的操作菜单）回到阅读器，标题仍为 `X · 时间线`。

### 从首页、详情或评论打开外链再返回，恢复原列表、目标帖子、滚动位置和焦点

- 首页：`timeline-return`，作者与 `position` 均还原。
- 滚动：指定样例正文很短，滚不动，所以滚动维度用一条足够长的帖子单独证（`timeline-scroll-return`：滚到 600，返回后仍是 600）。
- 详情与评论：`detail-return`，返回后仍在详情，选中的评论仍是 `Petr @pepeller@nbrempel`。

### 取消加载、重复打开、迟到回调不能抢占前台

`cancel-and-repeat` 用不可路由目标 `https://10.255.255.1/hangs` 连做三轮「打开—仍在加载—返回」，每一轮打开后都确认等待层在、前台仍是阅读器，六次取样全部为 `reader`；三轮 `stages` 都是 `open → closed`，从未 `shown`。随后静置 8 秒，前台仍是阅读器、等待层已消失。

外链内部重定向：`scripts/check-external-links.mjs` 在**本构建**上重跑通过，其 `redirected` 一步走的正是新的 `Handoff` 代码，链路为 `open → loading t.co → loading 发布页 → shown`，证据在 `docs/validation/issue-20-samples.json`。

「历史返回后最终退出」这一条按设计退化了：外链页上的返回键不走站内历史，一次返回直接回到发起的帖子（#20 的取舍，避免上一次外链的历史残留把返回引到别处）。因此没有「逐层退历史」的可控网页用例；可控网页覆盖的是取消与竞态（`https://10.255.255.1/hangs`），站内历史返回本轮不适用。

### 不重新建立多套会话，不把网页加载放回阅读首屏依赖链

整轮运行中 `Opening session with runtime` 仅出现 1 次（`geckoSessionsOpened: 1`，OAuth popup 未触发）。冷启动记录里 `surfaces.gecko` 为 `absent` —— 时间线可读时 GeckoView 还没进入视图树，首屏不依赖任何 Gecko 加载或握手。

登录路径：`login-handoff` 交出屏幕并加载 `https://x.com/home`，`login-return` 按 1 次返回回到阅读器。**OAuth 弹窗本身本轮未重跑** —— 设备处于已登录状态，触发真实 OAuth 需要先登出，会破坏账号状态；验的是登录所用的同一套交接与返回机制。

### 性能预算

本轮冷启动命中**上次时间线缓存**（`freshness` 为「上次时间线 … · 正在更新」，脚本记为 `cache: warm`），家庭宽带经代理访问 X：

| 指标 | 实测 | 预算 |
| :--- | :--- | :--- |
| 时间线可读（`home cached`） | 1180 ms | 5 s |
| 启动到脚本读到时间线 | 3394 ms（含 adb 拉起与 500 ms 轮询间隔，是上限不是渲染耗时） | — |
| 详情渲染（`detail reused`） | 45 ms | 5 s |

原始数值见 `docs/validation/issue-22-samples.json` 的 `reading-budget` 一条。

## 四、回归测试

- `app/src/test/.../HandoffTest.java`（14 项）：代次受理、结束后作废、交接互相取代、只有本类文档武装屏幕、adapter 报告只对打开原帖生效、登录计时器规则、迟到 return 的资格判定。
- `app/src/test/.../ExternalTargetTest.java`（5 项）：含新增的 `isX` 判定。
- `tests/external-links.spec.mjs`（20 项）：新增卡片与正文链接去重（真实 `card_url` 放的是 t.co 包装）、返回时间线还原选中帖子与滚动、返回详情还原评论焦点与滚动。
- `scripts/check-reader-foreground.mjs`：真机全流程验收，可重复运行。

全量：Playwright 116 项通过，JVM 单测 25 项通过。

## 五、本轮发现并修掉的缺陷

1. **同一目标被列两次**：`summary_large_image` 卡片的 `card_url` 绑定放的是 t.co 包装而不是发布页，卡片分支因此又追加了一条 t.co 条目。改为按包装 URL 一并去重。
2. **卡片点击不保存阅读位置**：`openExternal` 现在统一先 `saveScroll()`。
3. **透明交接**：后台页面先清掉加载层后，之后的交接会停在 alpha=0 的 GeckoView 上（黑屏）。揭示改为幂等。
4. **登录交接丢失导航后无法恢复**：失败计时器改为保留到 X 文档真正提交。
5. **打开原帖依赖 SPA 的 `onPageStop`**：x.com 的加载事件不一定按时到，改由内容脚本的 `content_ready` 驱动 —— 那才是「能接收命令」的真实前提。
6. **迟到的 return 能关掉新交接**：`reader_browser_return` 原本不带身份，任何一条到达都会关掉当前交接。扩展现在把帖子路径一并带回，Java 侧用 `Handoff.closedBy(path)` 校验「已占屏 + 是它自己那条帖子」。

## 六、本轮未覆盖

- **OAuth 弹窗**：需要先登出才能触发，会破坏账号状态，本轮只验了登录所用的同一套交接与返回机制。
- **外链站内历史返回**：按 #20 的设计，外链页的返回键一次回到发起的帖子，不走站内历史，因此没有对应用例。
- **卡片标题分支**：本工单的样例有 card，走到了 `card.legacy.binding_values`；#20 的样例没有 card。两条分支各由一个真实样例覆盖到，多链接仍只有自动化覆盖。
