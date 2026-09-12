# TvXBrowser 优化与演进计划 (TODO.md)

> 本文档基于实测视频 `demo_with_remote_part2_2.mp4`（实测录屏 14:13 ~ 23:04 区间，当贝投影仪环境）及当前工程源码，系统梳理项目现存的关键体验缺陷、根因剖析、重构优化方案与实施待办清单。

---

## 目录
- [一、 实测视频问题复盘与证据链](#一-实测视频问题复盘与证据链)
- [二、 核心根因剖析 (Root Causes)](#二-核心根因剖析-root-causes)
- [三、 详细优化方案与技术规格](#三-详细优化方案与技术规格)
- [四、 优先级任务排期 (Actionable Checklist)](#四-优先级任务排期-actionable-checklist)

---

## 一、 实测视频问题复盘与证据链

| 视频时间点 | 涉及场景 / 触发动作 | 实测现象与视觉缺陷 | 影响模块 |
| :--- | :--- | :--- | :--- |
| **01:40 ~ 02:00** | 点击推文外链（`en.algorithmica.org`） | 顶部仅显示 `WEB t.co`，**主视口 100% 纯白死屏（#ffffff）**，无法滚动阅读。 | `card.js`, `card.css` |
| **03:20 ~ 03:40** | 帖子菜单内打开 GitHub 外链 | **再次出现纯白屏**，按遥控器上/下键毫无滚动响应。 | `card.js` |
| **05:20 ~ 05:40** | 点击操作菜单中的“喜欢” | 按钮进入 `正在确认…`，状态栏显示 `正在等待 X 确认… 返回 关闭`，卡顿死锁 2~3 秒才更新。外链 Badge 误显为 `t.co`。 | `actions.js`, `like-observer.js` |
| **06:00 ~ 06:30** | 打开推文外链（`uirules.com`） | **第三次出现纯白死屏**。暗室投影仪环境下大面积白屏强烈刺激人眼（Flashbang 效应）。 | `card.css` |
| **06:40 ~ 07:10** | 打开推文进入帖子详情页 | 经历原生 Android 转圈后再出现 Web 骨架屏（`正在加载帖子…`），未见瞬开；视频占位呈现大黑块。 | `detail.js`, `BrowserActivity.java` |
| **07:40 ~ 08:20** | 浏览纯文字长推文；查看评论区 | 纯文本推文右半屏呈现 **50% 宽度的巨大黑色荒漠**；评论区中混入商业广告（Starlink 赞助）。 | `reading.css`, `detail.css` |

---

## 二、 核心根因剖析 (Root Causes)

### 1. 外链阅读内嵌 `<iframe>` 方案的根本缺陷
- **跨域安全沙箱拦截**：
  在 `card.js` 中，外链通过注入 `<iframe src="...">` 到 `x.com` DOM 实现。虽然 `background.js` 中配置了 `onHeadersReceived` 尝试修改 CSP 与 `X-Frame-Options`，但对带严格 `Origin-Agent-Cluster`、重定向链（`t.co` -> 最终目标）以及子资源 CSP 的现代网站（如 GitHub、Substack、技术博客等）依然无效；加之 GeckoView 的跨站 Cookie 与存储分区保护，导致外链频繁直接被拦截白屏。
- **跨域事件阻断导致遥控器无法滚动**：
  `card.js` 中 `frame?.contentWindow?.scrollBy(...)` 在跨域情况下被浏览器引擎直接抛出 `SecurityError` 阻断。同时由于 iframe 自身高度撑满，外层容器无滚动内容，导致遥控器上下滚动完全失效。
- **刺眼白屏缺乏缓冲**：
  `card.css` 中将 `#tv-article-scroll` 和 `#tv-article-frame` 硬编码为 `background: #ffffff;`，在深色 TV/投影模式下（`#090d14`）造成剧烈的眩目白闪。

### 2. 详情页瞬开失效：`sessionStorage` 跨 Session 物理隔离
- commit `b39a2b5` 引入了 `stash()` 与 `renderInstantRoot()`，试图通过 `sessionStorage` 暂存时间线卡片内容并在详情页秒级渲染。
- 但 `BrowserActivity.java` 中的 `openDetail()` 通过 `new GeckoSession(parent.getSettings())` 创建了**全新的独立 GeckoSession**。
- 依据 W3C Storage 标准规范，没有 opener 关联的新独立 Browsing Context 拥有完全独立的 `sessionStorage` 空间。导致新 Session 内读取缓存永远返回 `null`，瞬开机制彻底失效，依然需要从零请求网络并等待 React SPA 水合。

### 3. 硬编码 50/50 分栏机制
- `reading.css` 将时间线推文卡片写死为 `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;`。
- 当推文没有图片/视频/链接卡片时，右半屏纯黑留白，同时左半侧的文字被强行压缩在半屏狭窄空间中，破坏了大屏视觉体验。

### 4. 悲观 UI 状态机导致遥控器交互卡滞
- `actions.js` 的“喜欢”操作依赖 GraphQL 请求全流程握手（`arming -> pending -> waiting -> confirmed`）。在海外网络或代理延迟较高时，导致遥控器按下后界面长时间冻结在“正在确认…”，违背了电视大屏应用即时反馈（Optimistic UI）的基本设计准则。

---

## 三、 详细优化方案与技术规格

### 1. 架构级重构：外链文章原生独立 Session / 阅读模式化
- **弃用 DOM 内嵌 `<iframe>`**：
  将外链点击事件通过 Bridge 通知到 Android 原生层：`tvx://external?url=...`。
- **多 Session 堆栈管理**：
  在 `BrowserActivity.java` 中利用独立 `GeckoSession`（或专设轻量 Web 视口）承载外链，彻底绕过 `x.com` 的 CSP 与 iframe 嵌入限制。
- **引擎级遥控器按键滚动**：
  原生层直接将上下键映射至原生滚动指令（`session.scrollBy(...)`），保证 100% 无论何种网页均能平滑遥控滚动。
- **集成 Readability 极简阅读模式**：
  对技术文档/长文注入 Mozilla Readability 算法，解析出正文内容，自动应用 Dark Theme（`#090d14` 背景，`#e2e8f0` 字体），提升大屏远距离阅读可读性。

### 2. 详情页真·零延迟渲染链路
- **数据通道重构（Bridge 传输 / LocalStorage 兜底）**：
  - **首选**：时间线触发打开详情时，通过 `sendToNative({ event: "open_detail", snapshot, url })` 将卡片 DOM 快照（头像、作者、文本、图片、点赞评论数）发送给 Java 层。Java 层在打开新 Session 且注入 `bootstrap.js` 时，主动将快照下发，立即挂载到 `tv-detail-instant-root`，实现 0 毫秒首屏。
  - **兜底**：若暂不改动 Java 层，将 `sessionStorage` 改为 `localStorage`（同源下跨 GeckoSession 互通），读取后即时消费并清除。

### 3. 自适应动态排版系统 (Adaptive Layout)
- **纯文字推文**：
  检测无媒体附件时标记 `.tv-reading-text-only`：
  - 单列居中排版（`max-width: 1080px; margin: 0 auto;`）；
  - 字号放大至 `32px ~ 36px`，行高设为 `1.6`；
  - 彻底消除右侧大黑洞。
- **图文/多媒体推文**：
  保持左右分栏，并针对 16:9、4:3、竖屏视频自适应高宽比，清除播放器裁剪黑边与鼠标悬停残留。

### 4. 交互层优化：乐观更新与轻量状态机
- **点赞乐观更新（Optimistic UI）**：
  遥控器按下瞬间，UI 立即点亮红心并计数 +1，给用户瞬间正反馈；后台异步静默分发真实点击；若网络严重超时或返回错误，再优雅回滚并 Toast 提示。
- **正确解析卡片真实域名**：
  优化 `card.js` 中对 `t.co` 重定向卡片的实际域名解析，避免在菜单和详情中错误展示 `t.co` Badge。

### 5. 硬件级按键支持与交互细节打磨
- **增加媒体键映射**：
  在 `TvKeyRouter.java` 中增加对 `KEYCODE_MEDIA_PLAY_PAUSE`, `KEYCODE_MEDIA_PLAY`, `KEYCODE_MEDIA_PAUSE`, `KEYCODE_MEDIA_FAST_FORWARD`, `KEYCODE_MEDIA_REWIND` 的分发支持。
- **长按连续平滑滚动（Fling Scroll）**：
  区分单次点击与长按（`event.getRepeatCount() > 0`），长按时触发平滑连续滚动，解决 100ms 硬节流带来的跳跃感。
- **评论区广告净化与二级折叠回复展开**：
  - 过滤拦截带 `placementTracking` 或“赞助/Promoted”的广告推文；
  - 增加对“Show replies”二级回复按钮的遥控获焦与回车展开支持。

---

## 四、 优先级任务排期 (Actionable Checklist)

### 🔴 P0 - 阻断性体验修复（Must-Have）
- [ ] **外链阅读体系改造**
  - [ ] 移除 `card.js` 中的内嵌 iframe 方案，杜绝白屏与跨域无法滚动；
  - [ ] 在 `BrowserActivity.java` 中建立原生外链 Session 栈或阅读器界面；
  - [ ] 全局消除 `#ffffff` 硬编码，外链容器底色统一采用 `#090d14`。
- [ ] **修复详情页瞬开通道**
  - [ ] 废弃不可跨 Session 共享的 `sessionStorage` 暂存方案；
  - [ ] 采用 `NavigationBridge` 预先传输推文快照数据，或接入 `localStorage` 互通缓存，实现 0 秒首屏。

### 🟡 P1 - 核心交互与版面美化（Should-Have）
- [ ] **自适应卡片栅格重构**
  - [ ] 在 `reading.js` 和 `reading.css` 中增加纯文本与图文的动态布局切换；
  - [ ] 纯文本推文采用单列居中舒适排版，消灭右侧半屏黑屏；
  - [ ] 完善卡片真实域名提取规则，杜绝显示 `t.co` 占位徽标。
- [ ] **点赞与菜单乐观更新**
  - [ ] 改造 `actions.js`，按键下发后立即更新视图状态，不再等待 GraphQL 握手；
  - [ ] 增加异常捕获与状态回滚机制，减少用户停滞等待。

### 🟢 P2 - 电视大屏适配与细节完善（Nice-to-Have）
- [ ] **按键路由器（TvKeyRouter）增强**
  - [ ] 支持遥控器专用媒体播放/暂停按键；
  - [ ] 优化长按连续滚动的加速度曲线。
- [ ] **评论区与内容深度阅读**
  - [ ] 识别并过滤评论流中的 Promoted 推广广告；
  - [ ] 支持下级回复（Show replies）的遥控器导航与展开；
  - [ ] 对长文外链提供 Readability TV 排版阅读模式。
