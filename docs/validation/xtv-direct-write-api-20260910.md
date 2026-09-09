# X 直接写接口实机可行性验证

日期：2026-09-10。关联 [RFC-001](../rfcs/rfc-001-direct-session-native-messaging.md)。

## 结论

当前登录会话可以直接调用 X 网页内部 GraphQL，完成喜欢、取消喜欢和文本回复；喜欢测试的两种执行方式均成功，回复通过原生 Java HTTP 完成，无需导航到原帖、等待原帖 DOM 或模拟按钮点击。

Android Java HTTP 探针中，喜欢请求 901 ms，取消喜欢 767 ms；分别再花 321 ms 和 348 ms 重新读取帖子，确认 `favorited` 的真实服务端状态。已恢复为测试前的未喜欢状态。

用户随后指定帖子并确认测试文案及删除安排。原生回复请求 458 ms，读回确认 302 ms，删除请求 305 ms；评论已发布、确认归属和内容后删除。

这证明直接接口是可行的提速方向，不表示生产 APK 已接入，也不表示冷启动或所有操作已达到 5 秒。

## 方法与边界

- 设备：当贝 DBD5X Pro，Android 9。型号、ROM `4.0.1.9`、增量构建 `TVOS-04.16.031.01.12` 与基线一致。
- 保持现有 APK、登录会话、网络代理与当前阅读位置，没有重新安装或清除数据。
- 选取当前已打开且未喜欢的一个帖子。每条路径只执行一次“读取 → 喜欢 → 读取确认 → 取消喜欢 → 读取确认”，两轮均恢复原状态。中间额外读取用于确认是否需要恢复。
- Gecko 路径：通过调试连接在当前 X 文档内执行 `fetch`。认证、接口定义和逐次生成的 `x-client-transaction-id` 使用已加载网页的信息。
- 原生路径：在投影仪运行独立 `app_process` Java 探针，通过 `HttpURLConnection`、已有 HTTP 代理向 `https://x.com/i/api/graphql/…` 发请求。执行身份为 shell，不是生产 APK 进程；没有验证 APK UI、生命周期、错误提示或 Android Keystore 接入。
- 原生探针所需会话参数经本机调试连接和 ADB stdin 在内存中传递，未落盘；未输出凭据或提交到报告。原生请求不调用 DOM，但事务标识与接口元数据仍由**已经就绪的 Gecko**准备。不能据此声称已摆脱冷启动时对 Gecko 的依赖。
- 喜欢测试的读取使用当前网页 `TweetResultByRestId`，校验目标 ID 与 `legacy.favorited`。该轮探针给 feature switches 传 true、field toggles 传 false，足以验证本帖喜欢状态，不代表生产查询参数或完整正文加载已验证。回复轮改为读取当前网页初始化状态的功能配置，按 override → user config → default config 取布尔值，field toggles 仍为 false。
- 喜欢成功判据包含 HTTP 200、无 GraphQL errors、写响应 `Done` 和独立读取后的状态变化；不以 HTTP 200 或喜欢总数单独判定。喜欢总数可能被其他用户改变。回复与删除的判据见下节。

## 测量结果

[脱敏逐次样本](xtv-direct-write-api-samples-20260910.json)。

| 执行路径 | 喜欢请求 | 喜欢后读回 | 取消喜欢请求 | 取消后读回 |
| --- | ---: | ---: | ---: | ---: |
| Gecko fetch | 800 ms | 418 ms | 984 ms | 546 ms |
| Android HttpURLConnection | 901 ms | 321 ms | 767 ms | 348 ms |

表格为请求开始到 JSON 响应完成的耗时；网页事务标识准备另需约 2–4 ms（最初只读预热为 6 ms），不含 ADB/RDP 往返、页面首次加载、遥控器输入或 UI 合成帧。Gecko 样本的 `totalMs` 包含其准备时间。Java 使用设备单调时钟，JS 使用文档 `performance.now()`；未跨时钟相减。

以请求加确认读取计，原生喜欢约 1.22 秒、取消约 1.12 秒。仅各一个写样本，不能计算有意义的 P95 或成功率保障。原生探针启动时先做只读请求，写请求不代表进程冷启动首请求。

两轮喜欢测试结束后，当前 Gecko 文档的 pathname、timeOrigin 与开始相同，且服务端状态恢复为未喜欢。之后单独执行了下述已授权的回复/删除测试。

## 开源库与当前网页的差异

参考 [Twikit 请求实现](https://github.com/d60/twikit/blob/main/twikit/client/gql.py)（本次查阅 main，未固定提交，不能作为永久版本基准）：

| 操作 | 本次网页 queryId | 查阅的 Twikit queryId | 结果 |
| --- | --- | --- | --- |
| FavoriteTweet | `lI07N6Otwv1PhnEgXILM7A` | 相同 | 实测成功 |
| UnfavoriteTweet | `ZYKSe-w7KEslx3JhSIk5LA` | 相同 | 实测成功 |
| CreateTweet | `CUWCG7oBfrG71ZUXUtpwbw` | `SiM_cAu83R0wnrpmKQQSEw` | 使用网页当前定义发布成功 |
| TweetResultByRestId | `snmujSvB_9WXyd8yjvZ24Q` | `Xl5pC_lBk_gcO2ItU39DQw` | 使用网页当前定义读回成功 |

因此 Twikit 的调用形式可作为实现参考，但不能把其固定 queryId 当作本应用长期可用的常量。本次没有安装或执行 Twikit，也没有测其旧编号是否仍被服务器接受；编号不同不等于旧编号必然失效。

当前网页 CreateTweet 定义声明 36 个 feature switches 和 8 个 field toggles。本次回复使用当前网页配置，其中 28 个 feature switches 为 true；8 个 field toggles 为 false。单个纯文本回复已通过，不代表所有媒体、线程、功能组合或其他账户均可用。

## 文本回复与删除验证

用户指定目标并明确确认测试文案及测试后删除。目标帖作者与当前登录账号相同，因此这里只证明回复自己帖子可用，尚未验证其他作者或受限制的会话。

原生探针先读取目标，接着发送一次成功的 CreateTweet 请求。返回的新帖子 ID 用于独立读取，核对全文等于已授权文案、`in_reply_to_status_id_str` 等于指定目标、作者 ID 等于当前登录账号。全部匹配后才删除这条新评论。

| 步骤 | HTTP 请求与响应解析 | 请求元数据准备 | 结果 |
| --- | ---: | ---: | --- |
| 读取目标（原生预热） | 714 ms | 3 ms | 目标存在，作者为当前账号 |
| 发布测试回复 | 458 ms | 3 ms | 无 errors，返回新 ID，作者/正文/父帖匹配 |
| 读取新回复 | 302 ms | 2 ms | 三项匹配再次确认 |
| 删除新回复 | 305 ms | 85 ms | 返回 delete_tweet 且无 errors |
| 删除后第一次读取 | 308 ms | 3 ms | HTTP 200、有 data、目标不存在 |
| 间隔 1 秒后再次读取 | 289 ms | 6 ms | 仍不存在 |
| 再读原帖作对照 | 416 ms | 4 ms | 原帖仍存在，会话读取正常 |

成功的发布加读回 HTTP 耗时共 760 ms，另有 5 ms 元数据准备；不含 ADB、探针启动、用户输入和 UI 渲染。删除准备的 85 ms 单列，不能声称整个实验每次准备都仅需 2–4 ms。全程未导航，结束时原文档 pathname 与 timeOrigin 不变。

### 首次请求被拒绝及修正

成功发布之前，探针曾发送一个错误请求，返回 HTTP 422（677 ms），无 data、未获得新帖子 ID。初版错误地把 `batch_compose` 传为 `false`。核对当前网页请求构造函数发现此字段是批量发帖枚举（BatchFirst/BatchSubsequent），单条回复应省略。仅移除这个字段后再提交成功，未自动重放同一错误请求。

这是探针构造参数的错误，不应归因于 X 网络速度或账号不可写。首次探针未保存错误 message，原始 error code 缺失时被 optInt 写成 0，因此脱敏样本将其标为未知，不把 0 宣称为服务器错误码。HTTP 422、无 data、网页构造函数的枚举证据及单变量修正后的成功共同支持以上判断；未再发错误请求来获取缺失 message。

共两次 CreateTweet 请求：一次参数校验拒绝，一次成功发布；确认成功的唯一测试评论已删除。DeleteTweet 使用本次网页定义 `nxpZCY2K-I6QoFHAHeojFQ`，没有尝试删除原帖或其他内容。

## 对后续实现的建议

1. 优先接入原生喜欢/取消喜欢执行器，目标用帖子 ID 与期望状态表达，避免依赖详情页 DOM。仅向阅读 WebView 返回必要状态，会话凭据保持在可信层。
2. 保留 Gecko 的登录与请求元数据更新职责；补验证元数据初始化、失效更新、退出/切换账号后的撤销，以及冷启动可用时间。本次逐次生成事务标识成功，但未证明它必须存在、可以复用或可以长期缓存。
3. 写请求需要区分成功、明确失败和结果不明。超时后先查询状态；不能把“没收到结果”当作“没执行”，也不能自动切到 DOM 再发一遍。回复更需要防重复提交。
4. Port 只承担 App 与执行层的消息传递。已验证的性能收益来自省掉原帖加载；本次未实现或验收 RFC 的 Port 仲裁和请求生命周期。
5. 纯文本回复已具备纳入原生执行器的实机依据；正式接入仍需验证不同作者和回复限制、错误/超时处理、输入草稿保留及防重复提交。

## 实验材料与清理

本地调试源码和脱敏输出保留在 `.scratch/x-api-validation/`，不作为产品代码：`rdp.py`、`eval.py`、`init.js`、`read.js`、`like-roundtrip.js`、`NativeApiProbe.java`、`native.py`、`reply-prepare.js`、`reply-read.js`、`NativeReplyProbe.java`、`reply-native.py`。这些原型按本次网页模块编号工作，不应无检查重跑；`native.py` 和 `like-roundtrip.js` 会执行真实喜欢/取消喜欢；`reply-native.py` 会按本次授权的固定目标与文案发布并删除真实评论，不能未经新的授权重跑。

验证结束移除页面探针对象、临时 webpack 回调、本次 ADB 转发和设备上的 dex 文件；删除本地编译产物。没有修改产品代码。报告与样本不含账号、帖子 ID、正文、Cookie 或认证值。
