# RFC-001 实施前技术可行性研究

日期：2026-09-09。对象：当贝 DBD5X Pro（Android 9，1920×1080，ADB 192.168.10.100:5555）及 [RFC-001](../rfcs/rfc-001-direct-session-native-messaging.md)。

## 研究方法与证据边界

本研究同时使用现场 APK、保留旧中继行为的观测构建、受控本地页面、真实 X 页面，以及固定版本 GeckoView 源码。观测构建增加独立的 `rfc_probe` Port，用于验证 Session 来源和生命周期；它不接管生产 ready、不调用展示回调、不替代旧中继。观测行为可能影响时序，因此不把观测构建的通过率当成原 APK 的故障率。

.scratch 中保存实验原始日志与页面状态；APK 临时备份用于恢复后删除。工作目录为 `.scratch/rfc001-feasibility/`。受控日志不收集账号凭据；可能包含真实页面 URL 的原始日志不进入版本控制。正文引用的样本和日志已筛选，不包含帖子正文、Cookie、认证令牌或 OAuth 参数。

本次不清空应用数据，不执行点赞、回复、发帖或登录授权。设备恢复记录在文末。公开 API 保证与设备有限样本分开陈述，后者不构成全局时序保证。

## 1. APK 身份与基线

| 项目 | 结果 |
| --- | --- |
| 包名 / 版本 | `cn.deeloo.tvxbrowser` / versionCode 1 / versionName 0.1.0 |
| 现场 APK SHA-256 | `c0f561b015ddf3b3143ce8ea38108ebecf802f059f5fec7068e6d38d1abb8341` |
| 设备更新记录 | 2026-09-08 21:40:01（设备记录） |
| 本地 APK | 与原有 `app/build/outputs/apk/debug/app-debug.apk` 字节哈希相同 |
| 扩展来源 | APK 的 27 个扩展资产逐文件匹配提交 `d0a4d7e9f648` |
| 与研究时 HEAD 的差异 | HEAD `d65349ce587a` 的 reading/media JS/CSS 共 4 个资产不同；不属于 Native 通信改动 |
| GeckoView | `155.0.20260903215306`；APK 的 omni.ja 和 libxul.so 与本地该版本 AAR 字节完全相同 |
| 网络条件 | 使用已有代理 192.168.10.104:6780，保留已有登录及浏览器数据 |
| 观测 APK SHA-256 | `bfb27f3c7ccb468f9f550f1213853eb70d9bd4354a83969e3dc6e29d8c638659` |

APK 未嵌入源码提交标识，因此“扩展文件匹配 d0a4d7e”不能扩写成已证明整个 APK 的 Java 构建来源。观测构建从该提交导出，叠加 [研究补丁](rfc-001-probe.patch)，没有修改工作区生产源码。固定 GeckoView 的版本、源码 revision 与 API 证据见 [源码研究](rfc-001-geckoview-source-evidence.md)。

## 2. 原生遮罩与冷启动

### 现场事实

研究开始时原 APK 正处于超时遮罩，画面显示“加载较慢，请检查网络；按确认重试，返回退出”。同一现场 RDP 读取到 x.com/home 的 readyState=complete、3 个 article、2 个适配卡片、已聚焦卡片，且 DOM 的 `tv-x-boot` 类已移除。这支持“Web 展示条件已达成，Native 遮罩仍在”的判断。

最早故障发生阶段已不在保存的日志窗口中，无法补出当次 ready 在哪层丢失。证据：[初始画面](rfc-001-initial-cover.png)、[初始页面状态](rfc-001-initial-state.json)。RDP 页面主世界读不到扩展隔离世界的全局变量，不能据其 `window.TvXBoot` 不存在判断脚本未注入；观测构建改用 DOM 标记和独立 Port 取证。

### 重复样本

- 原 APK：2 次 force-stop 后进程冷启动，均在检查结束时解除遮罩。
- 观测 APK：10 次同条件进程冷启动，全部正常揭幕；10 次均见直连 probe 到主 Session，旧中继的 sender.session 均为 null。
- 10 次观测冷启动未见 active=false 丢弃或 Port 为空，不能据此认定它们解释了原始现场，也不能宣称它们不会发生。
- 第 10 次在采样结束时页面仍为 interactive、loadEventEnd=0，但 DOM 已就绪且 Native 已揭幕；该样本不纳入 load→ready 统计。

| 指标 | 样本数 | 最小 | 中位数 | 最大 |
| --- | ---: | ---: | ---: | ---: |
| 文档 timeOrigin→DOM ready | 10 | 13.123 s | 13.647 s | 18.868 s |
| Web loadEventEnd→DOM ready | 9 | 5.690 s | 6.289 s | 9.637 s |
| Native onPageStop→收到 ready | 9 | 5.680 s | 6.233 s | 9.626 s |
| Native 收到 ready→View.GONE 回调 | 10 | 14 ms | 25 ms | 30 ms |

Web 耗时在同一文档 performance 时钟内计算；Native 耗时在同一日志时钟内计算，未直接相减未经校准的 Web/Native 时间。View.GONE 回调不是最终合成帧或投影光学画面的证明，不能用最后一行宣称已经通过 ready→实际可见 300 ms 验收。

证据：[逐次样本](rfc-001-cold-start-samples.json)、[分段日志摘录](rfc-001-cold-start-evidence.log)。

**实施判断：** 取消固定 3 秒错误提示有设备依据；ready 确认、独立恢复和来源过滤仍有价值。原始 25 秒故障根因仍未闭合，应保留观测，不把直连迁移当成已经证明的根因修复。

## 3. 按键与 TvKeyRouter

真实 X 页面执行了 5 轮确认打开详情、返回主页面：每次 detail 的文档时间原点不同，返回后 main 的原文档保留。另测试了 MENU/BACK 与方向键。对应日志中没有 Native 下行 move/activate/menu/back 命令；输入由可信键盘路径处理。样本见 [真实导航记录](rfc-001-real-navigation-samples.json)。

实体遥控器已在独占操作窗口采集到上/下/左/右为 19/20/21/22、确认为 23、菜单为 82。Native 分别转发 ArrowUp/Down/Left/Right、Enter、m，Content 事件均为 isTrusted=true；长按产生递增 repeatCount，不是按一下就结束的命令。本窗口共记录 251 个 Native 按键事件、251 个 Content 按键事件（全部可信）；两端事件数不作为逐个对应证明。未录到实体 BACK，自动 BACK 结果不能代替实体验证。见 [实体样本](rfc-001-physical-key-samples.json) 与 [按键日志](rfc-001-physical-key-evidence.log)。

后续已在恢复后的原 APK 上补测一次实体短按 BACK，用户确认“回到时间线了”。底层 Dangbei 输入设备录到 KEY_ESC 的 DOWN/UP，间隔 140.855 ms；设备实际使用的 Generic.kl 将扫描码 1 映射为 Android BACK。RDP 确认窗口数从 2 变为 1，主页面由 hidden 恢复 visible，timeOrigin 与测试前完全相同，卡片焦点保留。原生日志随后收到 pageType=timeline、hasOverlay=false 的 state。该场景通过，见 [实体 BACK 样本](rfc-001-physical-back-samples.json) 和 [日志摘录](rfc-001-physical-back-evidence.log)。

本次原 APK 的页面监听器没有捕获到 Web 键事件，因此不声称测得该次 Escape 的 isTrusted 或完整 Web 按下/抬起对；也未验证实体 BACK 的长按、加载遮罩、mock 或 popup 分支。返回时另出现 Gecko 内部 ext-tabs / SessionStore 的空对象错误，但未阻止本次页面恢复；不能把功能通过扩写为没有错误。未重新安装 APK，已移除临时监听器和 ADB 转发并停止采集。

非 X 页面有两个不同结果：

- 普通本地 HTML 的 BACK：Native 发出 `back`，Content 因无 adapter 返回 `handled:false`，进入原生历史返回。
- mock asset 的 BACK：Native 发出 `back`，收到 `handled:true`，页面未导航。但这还不能当作合理产品需求：额外检查发现 mock 存在 display:none 的 `#tv-modal[role=dialog]` 及不可见的 aria-label=Close 按钮；当前 handleBack 的通用关闭选择器不判断可见性。随后做了单变量对照：两次均先滚动至约 500 px；保留隐藏关闭按钮时，BACK 后仍约 500 px；仅删除该隐藏按钮时，BACK 后约 89 px，文档未更换。这证明隐藏按钮会抢先消费 BACK 并阻止后面的滚动返回分支。见 [对照样本](rfc-001-mock-back-samples.json)。应先修正或明确这项旧行为，不能把“返回 true”直接当成确实关闭了可见界面。

**实施判断：** 方向键/确认/MENU 的 KeyRouter 分支可在调用点核对后清理；BACK 路径已证实可达，不能按死代码删除。优先将 Native 的“页面使用 adapter”判断与 Content 注册表对齐，并为测试资产明确返回契约；若统一到可信 Escape 路径，先验证其覆盖 mock/probe 的行为。若保留 Web BACK，才为这一实际请求补单次关联和不明结果处理，不需要因此建立通用 RPC 配额。

## 4. 文档身份、导航与 Port

固定版本的 Content → SessionController 直连 API 在投影仪上可用。冷启动 probe 的 Java sender 指向主 Session、environmentType=2、isTopLevel=true；不同真实 detail 获得不同 Session 的直连 Port。

Java MessageSender 不提供浏览器文档 ID。固定版本的 Content 可以同步调用 `browser.runtime.getDocumentId(window)`，Background 可以用 `webNavigation.getFrame({documentId, tabId, frameId:0})` 查询该文档是否仍为 current；此路径需要 webNavigation 权限。源码确实检查 WindowGlobal 是否 current，但新导航尚未提交时旧文档仍可能 current。详见 [固定源码与方案边界](rfc-001-geckoview-source-evidence.md)。

因此，`port.sender.session` 可以证明 Session，不能单独证明属于最新一次导航。自建随机 documentId、URL 相等、最后建立 Port 或查询时 current，均不足以独立完成 RFC 的导航归属约束。

受控服务器延迟响应 5 秒，直接复现了关键反例（同一 Session、同 URL reload）：

| Native 单调时间 | 事件 |
| ---: | --- |
| 69,804,379 ms | 新导航 onPageStart |
| 69,805,435 ms | 旧文档重新 connectNative，Java 收到新 Port（connection 23） |
| 69,805,448 ms | 新 Port 上收到旧 documentId `7c5616bd-…` 的 connected 消息，旧 timeOrigin 未变 |
| 69,805,816 ms | 该旧文档的 getFrame 查询返回 current=true |
| 69,809,503 ms | 新文档建立 connection 24，documentId 变为 `f8674073-…` |

这不是抽象风险：旧文档能在 Native 已报告新导航开始后建立合法、顶层、同 Session 的新连接，并且仍是 Gecko 当前文档。因此 Native 为“刚连进来的 Port”分配当前 navigationGeneration 会误认归属；额外加一次 getFrame current 查询也不能独自解决 pending 导航。

另外已观察：

- 同文档重连保留浏览器 documentId，Port 改变；旧 Port 晚断开时记录 current=false，新连接继续响应。
- 同 URL reload 产生新文档 ID，重定向后的文档也重新建立连接。
- 在 pagehide 中故意连一次的旧文档，仍可能产生 Java onConnect 随后 onDisconnect；不能只把 onConnect 当成业务已就绪。

**实施判断：** Session 直连可行；RFC 当前“Java 自行判断完整导航归属”的实现条件未通过。建议使用浏览器真实 documentId，并选择一个文档生命周期权威。源码研究给出的最小候选是 Background 统一仲裁提交、撤销和许可，Native 用一次性 challenge 绑定原 Port/Session；业务数据仍可直连。这个方案需要修改 RFC 的 Background 职责和导航代次定义，尚未实现、未通过端到端验收。它能承诺 Native 已见撤销后拒绝旧消息，不能承诺浏览器内部导航刚发生、任何回调尚未送达时 Native 已经知道。详见 [方案比较](rfc-001-geckoview-source-evidence.md#补充最小文档仲裁方案与必须修改的保证)。

受控状态和时序见 [生命周期样本](rfc-001-lifecycle-samples.json) 与 [筛选日志](rfc-001-lifecycle-evidence.log)。

## 5. 可见性、Activity 与恢复

真实 X 的 5 轮主/详情切换中，主文档在详情展示时均为 document.hidden=true，返回后恢复 false，文档身份未变。这是本设备当前 View 切换路径的正面证据。源码中 releaseSession 保持 active、setTabActive 与 setActive 并非同一职责，仍不能仅依赖 API 名称推出任意挂载方式下的 visibility 行为。

受控双 Session 也得到同样的 hidden/visible 变化；显式 setActive(false/true) 改变 document.hidden，回桌面和恢复应用保留文档并切换可见性。实现应以 Native 可见 Session 为准，校验实际通知，而不盲目给所有保留文档启动定时器。

Activity.recreate 的同进程样本中：

- 旧 Activity 的 destroy 日志为 69,626,535 ms，新 Activity create 为 69,626,571 ms。
- 旧 Session 的 visibilitychange/pagehide/Port disconnect 直到 69,626,723～724 ms 才到达，已经晚于新 Activity 创建。
- 当前关闭路径下，旧 direct probe 最终正常断开，未观测到它持续半开。
- Background Native 连接在重建后约 1.27 秒内建立两次。源码的断开重连 timer 与周期心跳都可调用 connectToNative，且没有统一的连接去重；该观测支持后续合并恢复入口，不能误称为“详情 Port 覆盖主 Port”。

BFCache 也真实发生：data probe 页面 pagehide.persisted=true，后来 pageshow.persisted=true，documentId 和 timeOrigin 均保留。研究 probe 故意不在 pagehide 主动断开，其旧 Port 可随页面恢复继续发送，因此新协议的显式停止、重新校验与重连规则确有必要。

**实施判断：** 必须保留旧回调隔离和生命周期清理。源码支持半开连接风险模型，但本轮正常重建没有证明必需 2 秒周期心跳；应先统一连接恢复和清理，再对故障注入与长期运行结果决定心跳。现有数据不支持量化 CPU 开销或删除 onDisconnect。

## 6. data: 资产与 OAuth popup

Firefox 的 <all_urls> 包含 data；“data 必须依赖 executeScript”不成立为通用前提。观测样本中 X 页已出现两次 probe 注入入口、仅一个有效初始化和直连 Port，说明静态与动态路径确实重叠；asset 上的结果须单独验证。

mock 与 probe asset 均在 readyState=loading 时运行了 probe 并直连，随后才 DOMContentLoaded/load；两者注入计数均为 1，Content 内的 host 初始化也成功。由此确认：本设备、固定依赖和当前 manifest 下，顶层 data 资产能通过静态 document_start 注入，不依赖 complete 后动态注入才开始运行。这足以否定“data 没有静态注入”的前提，但动态链是否能全局删除仍需覆盖其余恢复路径。

受控本地 popup 和打开 accounts.google.com 后的 Google 页面（已有会话自动导航至 myaccount.google.com）均完成加载，原生 BACK 关闭窗口并恢复相同父文档。两种 popup 均注入 probe，但没有 Native probe ACK；主/详情注册的 delegate 没有让 popup 成为受管理的业务连接。没有实际执行账号授权，也没有修改登录状态。该结果验证的是窗口打开、关闭与恢复边界，不是完整 OAuth 成功流程。

本地页的 iframe 没有 probe 标记，与 all_frames=false 一致。首轮 popup 脚本因历史返回落到 asset 而不满足按钮前置条件，所得同名状态不计为通过；重新加载、断言按钮存在和窗口数量后，完成上述两次有效 popup 测试。

**实施判断：** 保留“Content 先筛选支持范围、Native 再筛选受管理 Session”；不要让所有注入页面都启动业务连接。没有 ACK 不等于立刻收到永久拒绝，超时和恢复预算仍须有界。没有设备证据要求为 OAuth popup 注册 TV Bridge。

## 对 RFC 的决策与后续工作

**允许继续最小协议实验；不建议按当前 RFC 直接进入完整生产迁移。** 两项前置决策尚需回写：

1. **文档身份权威。** 接受 Background 保留小型身份仲裁职责并收敛导航代次，或更换能够暴露原生当前文档身份的方案；不能继续假设 Java sender 已足够。还需验证导航取消、重定向、旧仲裁回执延迟以及撤销/许可顺序。
2. **资产返回语义。** KeyRouter BACK 确实可达，mock 还存在隐藏关闭按钮导致的误报消费。先定义并验证预期行为，再决定统一可信键盘还是保留单个 BACK 请求。

其余有证据支持的方向：保留 ready 确认、按 Session 隔离和迟到回调拒绝；3 秒仅作状态检查；缩减通用 ACK/请求框架；不支持页面不启动连接；data 静态注入可用，动态注入去留按实测范围决定。原始遮罩故障仍需捕获完整失败链，不能用本轮成功样本替代根因结论。

## 复现与设备恢复

研究补丁以 d0a4d7e9f648 为基线，仅用于隔离实验构建；新增的宽范围 probe、测试 intent 和详细日志不得进入生产 APK。研究构建执行 assembleDebug 成功。生产源码未变；本轮不把 JS mock 单测作为设备协议的证明。

已用 `adb install -r` 恢复原 APK，设备端 SHA-256 与实验前完全一致；未清空应用数据，原有代理保持不变。恢复后额外冷启动一次：x.com/home 加载完成，已有 3 个 article、2 个适配卡片且聚焦正常，DOM 与 Native 遮罩均已消失，实验 probe 标记不存在。见 [恢复验收](rfc-001-restoration.json)。这一次恢复验收未混入前述 10 次观测构建统计。

已停止日志采集和本地测试服务器，移除本次创建的 ADB forward/reverse 与设备临时截图、UI 文件；删除隔离实验源码/构建目录和 APK 临时备份，原有本地 app-debug.apk 保留。研究补丁已通过 `git apply --check`，JSON、文档本地链接与代码块配对检查通过。工作区应用生产源码未修改；RFC 顶部已添加研究结论和实施阻塞提示。

复现时从 `d0a4d7e9f648` 导出独立源码目录，应用研究补丁并使用项目现有 Android SDK 配置构建；仅在明确的测试设备上覆盖安装并保留原 APK。核心反例是：本地 HTTP 响应延迟 5 秒，同 URL reload 后、响应提交前通过实验 intent `rfc=reconnect` 让旧文档重连，再发送 `rfc=query_current`；比较 page_start、Port、浏览器 documentId 与 timeOrigin。其他测试 intent 及观测字段均在补丁中，探针不等同于目标协议实现。

**尚未验证的边界：** 实体 BACK 的长按及其他页面分支（详情返回时间线的短按已补测通过）；整机休眠/唤醒与断电重启；完整 OAuth 授权；媒体播放的新回归；长期运行和真实/注入半开故障下的恢复；投影画面的光学呈现耗时；新文档仲裁方案的完整端到端行为。原始遮罩故障的首次失败链也尚未捕获。这些限制不改变本轮已经复现的身份反例及 BACK 误消费，但不能据本报告宣称 RFC 全部验收通过。
