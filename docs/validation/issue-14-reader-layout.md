# Issue #14 — 将时间线工具栏移至左上角，并修复左侧焦点框裁切

**验收构建**：`app-debug.apk`（`versionName 0.2.0`，`versionCode 2`），本地 `assembleDebug` 产出并 `adb install -r` 安装到当贝 DBD5X Pro（`192.168.10.100:5555`，1920×1080，系统 WebView `com.android.webview 66.0.3359.158`）。
**复现脚本**：`node scripts/check-reader-layout.mjs`（只读；`--shots <目录>` 可另存截图）
**原始证据**：`docs/validation/issue-14-samples.json`

截图含已登录时间线，按 README 的约定不入库；脚本把它们写到指定目录，几何数据入库。

## 一、改前的问题

真机量到的旧布局（CSS 像素，视口 960×540，dpr 2）：

| 元素 | 旧位置 |
| :--- | :--- |
| `#freshness` / `#position` / `#refresh` | left 779 / 840 / 887 —— 全在**右上角** |
| `#stage` | left 48，`overflow:hidden`，无内边距 |
| `.post` | left 48，与 stage 左边缘重合，内容也贴着边框 |
| `.focus` | `outline:1px; outline-offset:-1px` —— 画在元素内部 |

焦点框之所以「不被裁切」，是因为它被画在元素**里面**；代价是边框紧贴内容、左边缘正好压在 stage 的裁切边界上，没有任何安全边距。一旦把它改成正常的外描边加阴影，就会被 `overflow:hidden` 切掉。

## 二、改了什么

- 表头改成左对齐两行：标题一行，`更新状态 · 帖子数 · 刷新` 一行，都从 5vw 处起。长状态文案用 `text-overflow:ellipsis` 收口，不换行、不推挤后面的元素。
- `#stage` 外边距收到 4vw，补 `padding:8px 1vw`。stage 在**内边距盒**处裁切，这层内边距就是焦点框的活动空间；帖子内容左边缘仍在 48（5vw），视觉安全边距不变。
- `.post` 自身加 `padding:0 1vw`，正文不再贴着边框。
- `.focus` 改成正常的外描边加柔光：`outline:2px` + `box-shadow:0 0 0 4px`，**用固定像素**——描边宽度本来就是固定像素，如果阴影用 vw，在小一号的 CSS 视口上整圈会相对变粗，反而超出按 vh 算的内边距（这正是第一版在真机上被切掉上边的原因）。
- `#refresh` 加 `cursor:pointer` 与点击处理，鼠标可用；状态文字仍是纯 `span`，不新增焦点站点。遥控器路径仍是顶部上键（#21）。

顺带修掉一个真实缺陷：`.lines` 的纵向排列规则原本只作用于操作菜单（`.action-options .lines`），外链卡片里的标题和域名因此挤在同一行——真机截图里「…Aaron Qian」后面直接跟着「aaronqian.com」。规则改为通用的 `.lines`。

## 三、各验收项与证据

真机 `timeline-top` 记录（CSS 像素）：

```
title    left 48
status   left 48  right 178  bottom 55
  freshness left 48   position left 106   refresh left 153
stage    left 38  right 922  top 70  bottom 475      (margin 4vw + padding 8px/1vw)
focused  left 48  right 478  top 78  bottom 467
ring     6px      clearance {left 4, right 438, top 2, bottom 2}
```

### 更新状态、帖子数与刷新位于左上角，长状态文案不遮挡帖子或相互重叠

三者的 left 分别是 48 / 106 / 153，都在屏幕左半（<480），且 `status` 与 `title` 左边缘同为 48。`long-status` 记录把状态文案换成「上次时间线 2026/9/10 下午12:48:42 · 正在更新 · 网络较慢，正在重试」：整行宽 415，右端 463 仍在屏内，底部 55 仍在 `stage.top - ring`（64）之上。

### 时间线及详情左侧内容都有安全边距，焦点框及阴影不被裁切

`clearance` 是脚本按「焦点框外扩量 = 描边宽 + 描边偏移 + 阴影扩散」现算出来的四边余量，`timeline-top`、`timeline-scrolled`、`detail` 三处全为正值（最紧的一边 2px）。滚动到第三条帖子后左边缘仍是 48，与顶部一致。详情 `focused.left` 同为 48，评论栏在 569 起，不与正文重叠。

### 刷新可通过遥控器和鼠标操作，焦点顺序可预测，状态文字不新增焦点

遥控器：顶部上键刷新（#21）。鼠标：`#refresh` 的点击触发同一个 `refreshHome()`，自动化里断言点击后确实发出了一次请求。`#freshness` / `#position` 没有 `tabindex`，表头里没有 `button` 或 `a`。

### 保留纯文本帖子约 3/4 屏宽与媒体帖子的左右分区

纯文本：`timeline-scrolled` 记录 `focused.width` 为 720，占 960 的 75%。媒体帖：`focused.width` 430 与 `media.width` 410 基本对半，媒体在 502 起、正文右端 478，不重叠。

### 1920×1080 实机截图验收顶部、滚动中及详情，检查长标题和加载/失败文案

`node scripts/check-reader-layout.mjs --shots <目录>` 会在四个节点各存一张 1920×1080 截图（顶部、滚动中、详情、长状态）。本轮人工核对了这四张：焦点框四边完整、左上角状态行与帖子之间留白清楚、外链卡片的标题与域名分两行。截图不入库。

## 四、回归测试

`tests/layout.spec.mjs`（9 项）：状态三件套在左上且与标题对齐、长状态不侵入帖子也不出屏、焦点框四边都不被 stage 裁切、正文不贴边框、纯文本约 3/4 屏宽、媒体帖左右分区、详情与时间线同一左边缘、刷新响应鼠标且状态文字不新增焦点、外链卡片域名不与标题同行。

全量：Playwright 158 项通过，JVM 单测 31 项通过。#20 / #21 / #22 / #13 四份真机脚本在本构建上重跑通过。

## 五、本轮未覆盖

- **加载/失败文案的实机截图**：需要在恰当时机断网才能拍到「加载未完成」「更新未完成」，本轮未构造；这两种文案的排版由 `#stage` 内的 `.loading` 复用同一套边距，自动化未单独断言。
