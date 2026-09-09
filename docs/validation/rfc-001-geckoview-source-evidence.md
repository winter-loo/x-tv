# RFC-001：固定 GeckoView 版本的源码可行性证据

日期：2026-09-09。范围：公开 API、固定版本 Java 源码与 APK 依赖 AAR 中实际打包的 Gecko JS；本笔记不声称完成投影仪实测。设备结果应与主可行性报告合读。

## 结论

**Content → Session Native Port 可行，会话身份足够明确；“同一个 Session 的当前导航文档身份”尚不能只靠 Java Port API 闭环。** 固定版本已有浏览器生成的 `documentId` 和权威“是否仍为当前已提交文档”查询，可做身份仲裁实验；但它们在扩展 API 层，Java `MessageSender` 没有暴露它们。新导航开始而尚未提交时，旧文档仍可能是 current。不能把随机 UUID、URL 相等、最后连接、心跳响应或一次 current 查询等同于新导航归属。

建议 RFC 将这项写成实施门槛：先验证一个完整的文档仲裁协议，再批准纯直连迁移；若坚持完全不保留 Background 身份仲裁，需要补 Gecko API 或明确接受/规避该限制，不能写成已有保证。

## 版本与取证范围

- Maven 坐标：`org.mozilla.geckoview:geckoview-omni-armeabi-v7a:155.0.20260903215306`。
- AAR SHA-256：`538c6fb1f6fe01b41b29bf7505297011780b792700276c1697a1dc6fa0a5d769`。
- 官方同版本 [sources.jar][sources] SHA-256：`2209619bbe5014f2d60c33cc65c467be1b347c6eb7f0de99d82147ad17494a88`。
- AAR 的 `assets/omni.ja` → `chrome/toolkit/content/global/buildconfig.html` 标明源码 revision：`5fdfd0092780e85643e2cddc0e1b590c8b9ef860`，仓库 `releases/mozilla-release`。下文固定源码链接均指此 revision。
- 用 `javap` 核对同版 `classes.jar` 的 `MessageSender` / `SessionController`，与 sources.jar 一致。在线 mozilla-central JavaDoc 调查时是 **157**，仅作辅助，不把它当成 155 的证明。
- 本次只读源码；原始资料可从 Maven 重取。未改 App、未运行 adb、未自行建立故障复现结论。

## 1. Session 来源与 Port

**固定源码事实：** `GeckoViewConnection.dispatcher` 将 `content_child` 路由到对应页面的 dispatcher；Java `WebExtensionController.getDelegate` 在 `sender.session != null` 时选择该 Session 的 delegate。Background 使用全局 dispatcher，`sender.session == null`。因此 `Map<GeckoSession, Connection>` 能解决直连后的跨 Session 归属。[GeckoViewWebExtension 201–246][gvext]；[WebExtensionController 1658–1740][controller]。

Content 需要 `nativeMessaging`、`nativeMessagingFromContent`、`geckoViewAddons`，并通过 SessionController 注册 delegate。现有 manifest 已声明这些权限。官方同时说明：注册 delegate 前的消息会排队，故“晚注册就一定丢连接”不是文档支持的结论。[官方通信说明][guide]。

**限制：** `MessageSender` 公开字段仅 `webExtension`、`session`、`environmentType`、`url`，另有 `isTopLevel()`。内部 `frameId` 仅转成顶层布尔值；没有 Java 可用的 `documentId`、inner window ID 或 navigation ID。`Port.sender` 是该连接的固定字段，不是每次消息重新采样的页面身份。[WebExtension 476–508、1168–1247][extension]；[WebExtensionController 1686–1713][controller]。

## 2. 当前文档身份：可用原语与尚缺闭环

**已验证打包实现存在：**

```js
// Content document_start：捕获一次，后续连接/重连复用。
const geckoDocumentId = browser.runtime.getDocumentId(window); // 同步 string

// Background：另需 manifest 的 webNavigation 权限。
// tabId 必须取该 content 消息的 sender.tab.id，不能取 active tab。
const current = await browser.webNavigation.getFrame({
  tabId: sender.tab.id,
  frameId: 0,
  documentId: message.geckoDocumentId,
}); // 对应文档已不是 current 时为 null
```

`getDocumentId(window)` 同步读取目标 BrowsingContext 的 `currentWindowContext.innerWindowId`，经运行期间稳定的 keyed mapper 转 UUID；目标不可用会抛错。必须传 `window`，不是无参调用；应在启动时保存，避免后续对 WindowProxy 重新取值混入新文档。[固定 ext-runtime 139–148][runtime]；[官方 getDocumentId][getdoc]。

`getFrame({documentId,...})` 在 Gecko 父进程调用 `getBrowsingContextForDocumentId`，后者确实检查 `WindowGlobalParent.getByInnerWindowId(id).isCurrentGlobal`；失效返回 null，再检查 tabId/frameId 相符。这比内容自造 UUID 或 URL 判断更强。[固定 ext-webNavigation 270–300][webnav]；[ExtensionDocumentId 94–115][docid]。

**仍然存在的边界：**

- “current”指当前文档，不代表 Native 最新一次 `onPageStart` 所加载的未来文档。新请求尚未提交时旧页面仍可 current。
- 查询与 Java 接收回复是异步的，其间可能再次导航。结果必须绑定一次查询 nonce、具体 Port、Session 与 Native 导航 epoch；任一变化都丢弃旧结果。
- 浏览器生成 UUID 是身份，不是时间序列，不可按 UUID 比较新旧。
- `SessionState` / `flushSessionState()` 用于异步保存会话历史与状态；公开接口没有与 `MessageSender` 可关联的当前文档 token。解析内部序列化字段也不形成 API 保证。[GeckoSession 2817–2825、2894–3200][session]。

**推荐实验方案，尚非已验证完整协议：** 文档启动时捕获真实 UUID；Native 新导航进入 pending 并使旧绑定失效；Background 记录顶层 `onBeforeNavigate` / `onCommitted` 和当前文档 UUID，只在已提交的目标文档上仲裁连接；Native 接受前核对本次 nonce/epoch/Port，再允许 ready 揭幕。必须用同 URL 刷新、慢响应、重定向、导航取消、旧查询延迟、新连接后旧 disconnect 验证 pending→eligible 的关联规则。**一次 getFrame 查询加上随机 epoch 回显，不能独自证明这个转移正确。**

若实验无法证明跨回调关联，应继续保留实施门槛：考虑将生命周期仲裁也统一到有真实 documentId 的扩展层，或补充 Gecko Native 身份 API。独立 Session 可隔离 App 主动导航，但单独使用它并不解决 Session 内网页自行导航和重定向。

## 3. onPageStart 与 document_start 的次序

Java `onPageStart` 契约是开始网络加载，只传 Session/URL。固定 JS `StateTracker.onStateChange` 根据顶层 `STATE_START` 发 `GeckoView:PageStart`；content script 的 `document_start` 由另一套注入路径执行，源码还说明异步编译等因素可能改变实际注入时点。[GeckoSession 3903–3920][session]；[GeckoViewProgress 451–510][progress]；[ExtensionContent 565–659][content]。

**在上述 API 契约和已检查实现中，没有跨 Java 回调与 content 消息的、可作协议前提的总排序保证。** 可以统计观测次序，不能从数次“PageStart 总先到”推导不变量。延迟注入、delegate 排队以及旧消息在不同 dispatcher 中等待，应显式进入故障注入用例。

## 4. 隐藏与恢复

| 操作 | 固定版含义 | 实施影响 |
| --- | --- | --- |
| `GeckoView.releaseSession()` / 切换 Session | 文档明确 release 后 Session 保持 active；`setSession()` 实现调用 release | 脱离 View 不等于 hidden/停止运行 |
| `GeckoSession.setActive(false)` | API 表示不可见；内部发送 `GeckoView:SetActive`，JS 设置 `browser.docShellIsActive` | 隐藏主 Session 应明确处理 active，而非仅换 View |
| `WebExtensionController.setTabActive` | 修改扩展 tab active 状态、产生激活事件 | 不等价于 setActive，更不能据此断言 document.hidden |

来源：[GeckoView 478–486、560–581][view]；[GeckoSession 2828–2858][session]；[GeckoViewContent 251–253][gvcontent]；[WebExtensionController 1639–1651][controller]；[GeckoViewWebExtension 909–929][gvext]。

建议心跳开关采用 **Native 当前展示 Session/Activity 可见性为主、content visibility 为辅**。`setActive` 到 `visibilitychange` 的具体实机时延、熄屏回调顺序以及音视频副作用属于设备验证项；源码映射不替代实测。

## 5. data: 静态/动态注入与 OAuth

MDN 明确 Firefox `<all_urls>` 的匹配方案包含 `data`；`match_about_blank` 不应被解释为“为 data 开权限”。`match_origin_as_fallback` 是基于来源回退的另一机制，不等于所有顶层原生加载的 data 都需要它。[Match patterns][patterns]；[content_scripts][scripts]。

当前 manifest 同时存在 `<all_urls>` 的 document_start 静态脚本和 background 在 tab complete 后的 `executeScript` 补注入。因此“data 绝不能静态注入”和“动态注入肯定可删”都没有足够依据。固定 `ExtensionContent.handleActorExecute` 对动态注入检查目标 WindowGlobal 仍 current 和脚本匹配权限；不是绕过权限的万能入口。[ExtensionContent 1461–1520][content]。

应在 mock/probe 的脚本最早入口标记一次执行来源与文档 UUID，同时记录动态链是否实际执行、是否重复 bootstrap、adapter 是否匹配。OAuth 是否应建立 TV 通道是业务选择：先辨别 X 登录页面、外部授权页、App 自建 popup Session，而不是仅以“没有 adapter”为由断言不会注入。

## 6. Activity、Runtime 与半开 Port

固定 `Port` 通过 `EventDispatcher.byName("port:" + id)` 独立注册监听；`disconnect()` 主动发断开并注销，`setDelegate(null)` 只注销 Java listener。没有 Activity 参数，也没有由 Activity destroy 自动触发 disconnect 的机制。扩展端 Port 绑定 extension context 的 conduit；context/actor 关闭有对应断开清理。[WebExtension 476–610][extension]；[ExtensionChild 233–281][child]；[GeckoViewWebExtension 147–192][gvext]。

由此可推导：**Activity 销毁而 Runtime/扩展仍在，并不保证旧 Background Port 同时死亡。** 清除应用中的 `mPort` 引用或替换 MessageDelegate，也不等于主动断开旧 Port。相反，正常文档卸载的自动断开不能被笼统当成不可用。应对比“显式 disconnect + Session close + delegate 注销”与旧行为，再判定业务心跳是否需要。源码支持这个风险模型，尚未证明投影仪曾发生半开，也不支持无实测就宣称 `onDisconnect` 足以替代所有恢复机制。

[sources]: https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview-omni-armeabi-v7a/155.0.20260903215306/geckoview-omni-armeabi-v7a-155.0.20260903215306-sources.jar
[extension]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/mobile/android/geckoview/src/main/java/org/mozilla/geckoview/WebExtension.java
[controller]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/mobile/android/geckoview/src/main/java/org/mozilla/geckoview/WebExtensionController.java
[session]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/mobile/android/geckoview/src/main/java/org/mozilla/geckoview/GeckoSession.java
[view]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/mobile/android/geckoview/src/main/java/org/mozilla/geckoview/GeckoView.java
[gvext]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/mobile/android/modules/geckoview/GeckoViewWebExtension.sys.mjs
[gvcontent]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/mobile/android/modules/geckoview/GeckoViewContent.sys.mjs
[progress]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/mobile/android/modules/geckoview/GeckoViewProgress.sys.mjs
[content]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/toolkit/components/extensions/ExtensionContent.sys.mjs
[child]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/toolkit/components/extensions/ExtensionChild.sys.mjs
[runtime]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/toolkit/components/extensions/child/ext-runtime.js
[webnav]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/toolkit/components/extensions/parent/ext-webNavigation.js
[docid]: https://hg.mozilla.org/releases/mozilla-release/file/5fdfd0092780e85643e2cddc0e1b590c8b9ef860/toolkit/components/extensions/ExtensionDocumentId.sys.mjs
[guide]: https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
[getdoc]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/getDocumentId
[patterns]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns
[scripts]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts

## 补充：最小文档仲裁方案与必须修改的保证

本节为设计推导，不是已实现协议或新增实机结论。比较目标是避免“旧文档迟到连接被盖上新导航代次”，而不是增加一个通用请求框架。

### 先区分两种保证

- **应用可实现的因果保证：** Native 已处理文档撤销或 Session 切换后，旧文档许可、旧 Port、旧异步回复不能再产生 UI 副作用。
- **当前公开 API 不足以证明的瞬时保证：** Gecko 内部只要开始/提交了导航，即使任何相关回调尚未到达 Native，Native 也绝不执行旧文档操作。

后者有一个直接反例：t0，Gecko 查询确认文档 A 仍 current；t1，A 的许可消息进入发往 Java 的队列；t2，Gecko 提交 B；t3，Java 先收到 A 的许可并执行；t4，Java 才收到 B 的导航/撤销。若不假定跨通道总排序，t3 的 Java 所见输入与“B 从未发生”的运行相同，无法区分。再加一次查询，只会把 t0 后移；最后一次查询与副作用之间仍有同一窗口。

因此，若 RFC 要求第二种保证，应更换能力边界：在引擎侧用当前 WindowGlobal 身份原子验证/执行，或提供带文档身份且有明确因果语义的 Native 回调。仅把随机 ID 换成浏览器 UUID，不能补出这项保证。[固定 Java 身份字段][extension]、[当前文档检查实现][docid]提供了上述推导的前提。

### A. Background 作为唯一文档权威：建议的最小可实现版本

保留 Content ↔ Native 专属 Port。Background 增加一个范围很小的职责：**文档仲裁与揭幕许可**；业务 `state` 不再由它猜 active tab 转发。Native 负责 Session 对象与可见性，Background 负责浏览器文档身份。此方案是 RFC 的架构修订建议，不能当作符合现有“Background 仅点赞/webRequest”的实现细节。

最少状态：

| 所在层 | 状态 |
| --- | --- |
| Background | 本次运行 `authorityId`；每个 tab 的 `revision`、`pending`、当前已确认 `documentId`；尚未完成的连接仲裁 |
| Native | 每个受管理 Session 的候选/有效 Port、一次性 `claimNonce`、已绑定 authority/tab/document/revision、可见性代次 |
| Content | document_start 保存的 `runtime.getDocumentId(window)`、当前 Port 与本次 claim |

具体流程：

1. **建立 Session ↔ tab 关系，而非相信 JSON Session ID。** Native 收到 direct Port 后校验 `port.sender`，生成一次性 `claimNonce`，保存 `nonce → 原 Port → sender.session`，通过该 Port 发 challenge。Content 用 `runtime.sendMessage` 将 nonce 和保存的真实 documentId 发给 Background。Background 使用此消息的 `sender.tab.id`、`sender.frameId`，不查询 active tab。[Session 路由源码][controller]。
2. **Background 仲裁当前文档。** 对该 tab 做 `getFrame({tabId, frameId:0, documentId})`；只接受 current、顶层、受支持文档。查询开始时捕获 tab revision；查询结果回来后若 revision 改变或进入 pending，丢弃。认可结果通过专用 Background Native 控制通道发送，包含 nonce、authorityId、tabId、documentId、revision。Native 只匹配仍存活的原候选 Port；一次性消费 nonce，不把许可套到后来连入的 Port。
3. **所有文档撤销来自同一个权威。** Background 在观察到顶层 `onBeforeNavigate` 时同步推进该 tab revision、进入 pending、撤销揭幕资格；在 `onCommitted` 后查询当前文档，确认匹配才退出 pending。不要按 URL 或最后一个迟到事件自报的 documentId 直接覆盖当前文档；查询结果仍受 revision 守卫。[固定 webNavigation 实现][webnav]。
4. **揭幕也经过同一权威。** Content 的 ready 携带已关联的 claim/documentId 向 Background 请求许可；Background 检查当前状态和文档，再发送带完整 authority/tab/document/revision 的 `presentationPermit`。Native 只有在匹配有效 Session/Port、首次 state 已到且 Session 当前可见时才揭幕。重复许可幂等，旧 revision 被拒绝。若要求其他副作用达到同等级别，触摸/退出也必须走同类仲裁；仅对握手做一次检查不能替它们提供持续当前性。
5. **控制流自己定义顺序。** 文档撤销和揭幕许可共用一个控制通道，携带 authorityId 和 revision；Native 始终保留已见的最新 revision。通道重建先作新的运行握手并撤销旧许可；旧 authority 的消息不能恢复旧绑定。不能只靠“Port 大概 FIFO”解释正确性，也不能让 direct ready 绕过许可直接揭幕。
6. **移除跨层 navigationGeneration 猜测。** Native `onPageStart` 可继续显示加载 UI/记耗时，但不能同时作为一套独立文档身份时钟，再让下一条 connection/ready 自动继承其代次。文档有效性以 Background 仲裁为准。若仍要求“每次 Native PageStart 一发生，只有它对应的新文档才能揭幕”，本方案也尚未满足，必须继续研究明确的提交关联，不能通过命名字段掩盖缺口。

这不是无代价折中：揭幕许可需要保留 Background Native 控制路径，减少的主要是业务传输与目标猜测。若实际消息量很小，单一 Background 传输加上同样的显式 Session/tab/document 绑定，可能比“直连业务 + 仲裁控制”更简单；应比较实现总量后再选，不以直连为必须达成的目标。

**A 可证明的状态机不变量：**

- 连接身份来自 Native challenge 对应的原 Port/Session，tab 身份来自扩展的真实 sender；不会把“最近活动 tab”当来源。
- Native 已观察 revision N+1 后，N 的迟到许可不能恢复有效性；旧 disconnect 也不能移除新 Port。
- Background 已观察 pending 后，在新的 commit/当前文档证据到达前不发揭幕许可。
- 候选查询期间一旦 Background 状态变化，旧查询结果被 revision 守卫丢弃。

这些都是本程序可以定义并测试的规则。它们**不证明尚未送达的导航事实不存在**，也不证明引擎 current 查询与 Java 揭幕原子执行。

**A 必须实测的部分：** 固定版本 webNavigation 对 HTTP 重定向、同 URL reload、BFCache、取消/失败、初始 data 页面分别发送什么事件；迟到/合并事件是否导致 pending 永久不退出；Background 重启后能否安全重新发现已提交文档；首次 content script、onCommitted 和 Java PageStart 的观测序列。BFCache 恢复可能保留同一 documentId，不能规定所有恢复都必须产生新 UUID。失败恢复必须显式确认当前已提交文档并走新仲裁，不能简单计时后无条件清 pending。

### B. 每次完整导航新建 Session

对于 **App 自己掌握且改写入口的导航**，可以在调用 loadUri 之前先创建并注册新 Session，把可见 Session 身份换过去，同时永久撤销旧 Session 的 UI 权限。此时旧 Port 的 `sender.session` 永远是旧对象；无需比较相同 URL 或判断哪条连接更新，即可拒绝它影响新 Session。

这是强而简单的跨 Session 隔离，但不是通用文档方案：网页自己的 `location`/链接/表单导航、自动 reload、重定向链仍可能在新 Session 内发生；除非全面拦截并重新调度，否则同 Session 问题仍在。全面拦截还会涉及 POST、导航历史、认证、窗口关系与 BFCache，超出首版传输改造。保留父 Session 返回时仍需恢复其文档状态；不能只因它是旧 Session 就永久禁止。

**建议用途：** 保持主页面/详情页的现有独立 Session 结构，在 App 发起的新页面入口使用；不把“每次新建 Session”当成替代所有文档仲裁的证明。额外创建开销、内存峰值、历史恢复与媒体状态必须在设备验证。

### C. 去掉 navigationGeneration，仅按原 Port + 当前查询校验

最少实现是：握手捕获浏览器 documentId；处理 ready 时经 Background 按原 tab/documentId 查询；回复绑定一次 nonce 和原 Port，Native 执行前校验原 Port 仍为当前连接且 Session 可见。

它能拒绝 **查询时已过期** 的文档，也能阻止旧异步回复应用到新 Port；工程上适合作为直连探针。它不能拒绝“新导航 pending 时仍 current 的旧文档”，也不能消除上文 t0→t3 的 TOCTOU。若没有 Background 提交序列/撤销状态，Native 连“已经接收了更新文档撤销后不能接受旧许可”也缺少对应的文档状态依据；Port 没换不代表文档没有开始导航。

**推荐决策：** A 是值得做的最小完整仲裁实验，B 是可独立保留的页面隔离措施，C 仅能声称尽力校验。RFC 应先选择并明确承诺“已观察到撤销后的因果隔离”，还是需要引擎级瞬时当前性；后一要求在现有公开 Java API 下尚无证明。设备测试通过能证实实现行为与恢复能力，不能创造 API 没有承诺的跨通道总排序。
