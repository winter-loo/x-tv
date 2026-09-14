# TvXBrowser (X TV) 社区宣发全渠道文案与发布指南

> 适用于 V2EX、X (Twitter)、少数派/掘金/知乎、Reddit (r/AndroidTV) 等海内外极客与大屏用户社区。

---

## 目录
- [一、核心卖点与宣发物料速查](#一核心卖点与宣发物料速查)
- [二、V2EX「分享创造」节点宣发帖](#二v2ex分享创造节点宣发帖)
- [三、X (Twitter) 官方中英双语推文串 (Thread)](#三x-twitter-官方中英双语推文串-thread)
- [四、少数派 / 掘金 / 知乎 深度产品与技术分享文案](#四少数派--掘金--知乎-深度产品与技术分享文案)
- [五、Reddit (r/AndroidTV & r/sideloaded) 英文社区贴](#五reddit-randroidtv--rsideloaded-英文社区贴)
- [六、社区宣发执行清单 (Checklist)](#六社区宣发执行清单-checklist)

---

## 一、核心卖点与宣发物料速查

### 1. 核心定位
**专为 Android TV 与智能投影仪量身定制的开源 X (Twitter) 大屏客户端**。彻底解决在电视大屏上字体过小、排版错乱、缺乏遥控器焦点导航、视频无法倍速/调画质、登录极其折磨等痛点。

### 2. 五大杀手锏功能
1. 🛋️ **遥控器全向盲操导航**：上下滚动推文、左右切媒体与评论、一键快捷点赞与关注。
2. 📱 **局域网手机扫码辅助登录**：告别大屏遥控器打字地狱，手机扫码在局域网内直接键盘打字，毫秒级实时投射到大屏。
3. 📖 **X Article 沉浸全屏阅读**：针对数千字长文与专业资讯重新排版，分段滚动，专为沙发观阅设计的字号与行距。
4. 🎬 **进阶全屏视频播放器**：遥控器左右键 10s 精准快退/快进，上下键多档倍速（0.5x~2.0x），菜单键一键无缝切换画质（360p/720p/1080p），不打断观影。
5. 👤 **双栏作者主页与历史流**：左侧个人资料认证，右侧触底自动加载历史发布，信息一目了然。

### 3. 动图素材引用（已入库 `docs/assets/`）
- **长文沉浸阅读**：`https://raw.githubusercontent.com/winter-loo/x-tv/main/docs/assets/fullscreen_reading.gif`
- **视频播放与倍速/画质**：`https://raw.githubusercontent.com/winter-loo/x-tv/main/docs/assets/video_playback.gif`
- **遥控快捷点赞互动**：`https://raw.githubusercontent.com/winter-loo/x-tv/main/docs/assets/click_like.gif`
- **作者专属个人主页**：`https://raw.githubusercontent.com/winter-loo/x-tv/main/docs/assets/author_profile.gif`

---

## 二、V2EX「分享创造」节点宣发帖

- **节点**：`分享创造` (create)
- **标题**：`[开源] 给电视和投影仪写了个 X (Twitter) 大屏客户端：遥控器盲操、手机扫码登录、沉浸长文与视频倍速`

### 正文内容：

大家好，我是 TvXBrowser 的开发者。

家里有一台当贝智能投影仪，经常想在客厅沙发或者躺在床上看 X（Twitter）上的科技资讯、长文深度分析以及科技博主发布的短视频。然而现实很骨感：
- 官方根本没有 TV 端应用；
- 直接拿电视浏览器或者手机版 APK 强行安装，界面字体奇小无比，没有遥控器 D-pad 焦点系统，得用空鼠费力挪动指针；
- 用遥控器输入密码登录，简直是一场噩梦；
- 原生推文长文（X Article）在电视上直接排版崩溃，视频也没法快进和调倍速。

为了让自己躺着能舒适刷推，我开发并开源了 **TvXBrowser (X TV)**。经过多个版本的真机迭代，现在正式向大家推荐！

### 核心亮点特性：

1. **为大屏而生的遥控器交互体系**
   - 彻底摆脱模拟鼠标指针：上下键切换推文，左右键选图/切评论，OK 键直接进入正文或播放。
   - 顶部按「上」触发刷新，菜单键一键点赞/查看作者/复制链接。

2. **解决最大痛点：手机局域网扫码辅助登录**
   - 不需要在电视遥控器上一个字母一个字母地按密码或验证码。
   - 电视端弹出局域网配对二维码，手机扫码后在手机网页输入，打字毫秒级同步到大屏输入框，支持 Google 账号一键登录。

3. **X Article 沉浸式全屏排版阅读**
   - 针对几千字、上万字的 X Article 深度长文进行大屏排版重构。
   - 自适应两端大屏字号、行距与图片布局，遥控器平滑分段翻页，客厅秒变资讯大屏。

4. **全屏视频播放器进阶控制**
   - 左右方向键 10 秒精准快退/快进，清晰的高对比进度条。
   - 上下方向键直接调倍速（0.5x / 0.75x / 1.0x / 1.25x / 1.5x / 2.0x）。
   - 菜单键无缝切换分辨率（360p 标清 / 720p 高清 / 1080p 超清），保持播放进度与倍速无感续播。

5. **作者主页与历史推文流**
   - 左右双栏大屏布局，清晰展示博主认证资料与历史推文列表，触底自动平滑翻页加载。

### 技术实现亮点：
- 采用 **「GeckoView 认证隔离 + 本地自研轻量阅读器」双引擎架构**：
  - **复杂登录与风控**：底层集成独立的 GeckoView（Firefox 现代内核），完美攻克 X 官方复杂的 Web 登录风控、现代 CSP 与 Google 授权弹窗，彻底解决电视登录难；
  - **日常浏览与极速响应**：主界面采用本地纯静态轻量阅读器（基于系统 WebView），直接解析 GraphQL 本地极速渲染，内存开销极低、秒级冷启动；
  - **老旧电视内核兼容**：基准设备（如当贝投影 Android 9）系统 WebView 停留在老旧的 Chromium 66，项目对阅读器做了严格纯 ES5 语法规范约束与性能剪裁，确保低配老电视不卡顿、不白屏。
- 全套内置 271 项 Playwright 端到端自动化交互测试，覆盖遥控焦点树与媒体播放状态机。

- **GitHub 源码**：https://github.com/winter-loo/x-tv
- **APK 下载与体验**：https://github.com/winter-loo/x-tv/releases
- **硬件支持**：Android 9.0+ 智能电视与投影仪（已在当贝 DBD5X Pro 1080P 真机验证）

欢迎各位 V 友安装尝鲜，提 issue 或 PR！如果你觉得有帮助，欢迎在 GitHub 给个 ⭐️ Star 支持一下！

---

## 三、X (Twitter) 官方中英双语推文串 (Thread)

### 📌 中文版本 Thread

**Tweet 1 (主推文，附带 GitHub 链接与总览动图)**:
> 📺 隆重推出 **TvXBrowser** —— 专为智能电视与投影仪打造的开源 X 大屏客户端！
> 
> 厌倦了在电视上用遥控器笨拙地挪动鼠标指针？
> 现在，你可以躺在沙发上，用普通遥控器丝滑刷推、看深度长文、倍速刷高清视频！
> 
> 🔗 开源项目：https://github.com/winter-loo/x-tv
> ⏬ APK 下载：https://github.com/winter-loo/x-tv/releases
> 
> 展开线程看演示 👇 🧵
> (配图：fullscreen_reading.gif)

**Tweet 2 (手机辅助登录)**:
> 🔑 **痛点终结者：手机扫码辅助登录**
> 
> 别再用电视遥控器在屏幕软键盘上痛苦输入账号密码了！
> 打开 TvXBrowser，手机扫码即可在手机浏览器中输入，字词毫秒级同步上屏，支持 Google 账号一键授权登录。
> 
> (配图：docs/assets/click_like.gif)

**Tweet 3 (长文排版与进阶播放器)**:
> 📖 **X Article 沉浸阅读 & 🎬 视频倍速与画质切换**
> 
> • 深度长文大屏两栏重排，遥控器平滑翻页阅读；
> • 视频左右键 10s 快进快退；
> • 上下键 0.5x~2.0x 随心调倍速；
> • 菜单键循环切换 360p / 720p / 1080p 超清画质，无缝续播！
> 
> (配图：video_playback.gif)

**Tweet 4 (结语 & 社区共建)**:
> 🛠️ **完全开源，纯净无广告**
> 
> 采用轻量化大屏交互架构，适配各类老旧与现代 Android TV 设备。
> 欢迎 Star、Fork 和反馈：https://github.com/winter-loo/x-tv
> 
> #AndroidTV #OpenSource #Twitter #SmartTV #XTV #开源项目

---

### 📌 English Version Thread

**Tweet 1 (Main Announcement)**:
> 📺 Introducing **TvXBrowser** — An open-source, remote-first X (Twitter) client built specifically for Android TV and Smart Projectors!
> 
> Say goodbye to awkward air-mice and tiny web fonts. Browse your timeline, read articles, and watch videos comfortably from your couch.
> 
> 🔗 GitHub: https://github.com/winter-loo/x-tv
> 📥 Download APK: https://github.com/winter-loo/x-tv/releases
> 
> Check out the thread below 👇 🧵
> (Attach: video_playback.gif)

**Tweet 2 (Remote Navigation & QR Login)**:
> 🛋️ **Pure D-Pad Navigation + Mobile Assistant Login**
> 
> • 100% remote D-pad native focus navigation.
> • Avoid the typing nightmare on TV screens: scan the local QR code with your phone to type credentials directly from your mobile keyboard!
> 
> (Attach: click_like.gif)

**Tweet 3 (Articles & Video Power-Controls)**:
> 📖 **Immersive X Articles & 🎬 Advanced Video Player**
> 
> • Large-screen typography optimized for long-form X Articles.
> • Video controls: Left/Right to seek (10s), Up/Down for speed (0.5x ~ 2.0x), and Menu button to switch resolutions (360p / 720p / 1080p) without playback interruption!
> 
> (Attach: fullscreen_reading.gif)

---

## 四、少数派 / 掘金 / 知乎 深度产品与技术分享文案

- **文章标题候选**：
  1. 《在大屏幕上躺着刷 X 是种什么体验？我们开源了 TvXBrowser》
  2. 《给电视和投影仪写了个 X (Twitter) 客户端：从遥控器交互到老旧 WebView 的硬核适配》

### 文章大纲及关键提炼：
1. **背景与初衷**：
   - 客厅大屏（电视/投影）是沉浸消费资讯与视频的绝佳场所。
   - 为什么官方一直没有好的 TV 客户端？手机版/网页版强行投屏移植的“水土不服”（鼠标光标依赖、输入法崩溃、字体太小、焦点丢失）。
2. **产品设计思考：电视大屏该如何看 X？**
   - **少即是多**：过滤嘈杂信息，专注时间线、长文与多媒体。
   - **遥控器心流交互**：不引入复杂光标，所有卡片严格遵循遥控器线性焦点树。
   - **手机与电视的协同**：输入交给手机，呈现留给大屏。
3. **技术挑战与双引擎架构攻坚**：
   - **登录难题与 GeckoView 破局**：电视系统老内核根本跑不动 X 官方现代登录页。我们引入 GeckoView 现代独立内核处理安全登录与 Cookie 提取，安全隔离风控与 Google 授权。
   - **低内存与老旧系统 WebView 的两难解法**：电视端仅有 1~2GB 内存，日常刷推若全量跑 GeckoView 极易 OOM。我们采用轻量本地阅读器，并在代码层面针对系统 Chromium 66 老内核做严格纯 ES5 规范约束与渲染剪裁，实现超低内存占用与秒开体验。
   - **大屏长文排版引擎**：针对 X Article 结构化内容重排，支持等宽两列/自适应阅读视口。
   - **视频播放无缝续播算法**：在分辨率切换与倍速变更时做到进度与状态毫秒级无感知接力。
   - **工程化质量底座**：271 项端到端 Playwright 自动化测试保障。
4. **体验与开源**：
   - 附带 GitHub 链接、Release 下载与真机运行效果展示。

---

## 五、Reddit (r/AndroidTV & r/sideloaded) 英文社区贴

- **Subreddits**: `r/AndroidTV`, `r/sideloaded`, `r/open_source`
- **Title**: `[Show r/AndroidTV] TvXBrowser: An open-source, D-pad native X (Twitter) client for Android TV & Projectors`

### Post Body:

Hi everyone! 👋

I built and open-sourced **TvXBrowser**, a native-feeling X (Twitter) client tailored specifically for Android TV and smart projectors.

If you've ever tried sideloading the mobile X app or browsing x.com using Android TV browsers (Puffin, TV Bro, etc.), you probably know how frustrating it is:
- Tiny text meant for 6-inch phones;
- Requiring an air mouse or tracking pointer to click anything;
- Typing passwords with a remote D-pad is painful;
- Videos don't support quick seeking or playback speed adjustments;
- Long articles are completely broken.

### What TvXBrowser does differently:

1. **100% D-Pad Remote Navigation**: Every action (switching tweets, viewing images, opening replies, liking, following) is controlled smoothly via standard TV remote buttons.
2. **Phone Assistant Login**: Scan a local LAN QR code on your TV with your smartphone to type your username/password using your phone's keyboard. Instant synchronization.
3. **Immersive X Article Reading**: Clean typography specifically formatted for 10-foot living room viewing.
4. **Advanced Video Player**:
   - Left / Right: 10-second seek
   - Up / Down: Adjust playback speed (0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x)
   - Menu Button: Cycle resolutions (360p, 720p, 1080p) without stopping playback!
5. **Author Profile**: Clean two-column split view with bio and paginated history tweets.

### Technical Architecture:
- **Dual-Engine Architecture**:
  - **GeckoView Engine**: An isolated modern Gecko session handles official X authentication, modern web security challenges, and Google sign-in popups reliably.
  - **Native Lightweight Reader**: High-frequency reading and video playback run in an optimized local reader (system WebView), keeping RAM usage ultra-low and startup instantaneous.
  - **Backwards Compatibility**: The reader is strictly baseline-compatible with older TV systems down to Chromium 66 via pure ES5 standards and tailored performance pruning.
- **Requirements**: Android 9.0+ (API 28+), supports `armeabi-v7a`. Tested on 1080p smart projectors (Dangbei DBD5X Pro) and Android TVs.
- **Quality Assurance**: Fully covered by 271 Playwright automated end-to-end regression tests.

- **GitHub Repo**: https://github.com/winter-loo/x-tv
- **Download APK (Releases)**: https://github.com/winter-loo/x-tv/releases

Feedback and contributions are warmly welcomed!

---

## 六、社区宣发执行清单 (Checklist)

| 阶段 | 任务项 | 状态 | 备注 |
| :--- | :--- | :---: | :--- |
| **准备** | 确保 GitHub Release v0.2.1 带有可下载的已签名 `app-release.apk` | ⏳ | 附带校验和及变更说明 |
| **准备** | 检查 README.md 中 4 个动图在 GitHub 网页上能够直接渲染 | ✅ | 已嵌入 README 特色橱窗 |
| **第一波** | 在 V2EX「分享创造」节点发帖 | ⏳ | 黄金时间：工作日上午 10:00 - 11:30 |
| **第一波** | 在 X / Twitter 发布中英双语宣传 Thread | ⏳ | 带上热门标签并艾特相关大屏/开源博主 |
| **第二波** | 发布到 Reddit `r/AndroidTV` 与 `r/sideloaded` | ⏳ | 黄金时间：北京时间 20:00 - 23:00 (美东上午) |
| **长尾** | 投稿到少数派 Matrix 或知乎专栏/掘金 | ⏳ | 附带开发心路与踩坑技术解析 |
| **反馈** | 监控 GitHub Issues 与社区回复，及时解答与收集需求 | ⏳ | 收集不同品牌电视（小米、索尼、TCL等）的适配反馈 |
