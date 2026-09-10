# #13 — 外链返回后的真实写入准备恢复

## 根因与现场

2026-09-10，投影仪实际显示“喜欢状态未能提交，请稍后重试。”。日志里每轮四次喜欢均在约 4–8 ms 返回 `not_ready`，没有进入点赞 HTTP 请求；同期原生帖子读取仍然成功。Gecko 调试器显示唯一页面为 `about:blank`，扩展心跳正常。

`closeHandoff()` 为停止外部网页而加载空白页，但喜欢提交只调用 `initializeBrowser()`，引擎存在时直接返回。扩展的 `prepareWrite()` 找不到 X 页面，因此无法取得查询定义和事务签名。此前合成桥验收覆盖了本地反馈与协调逻辑，却漏掉了此真实依赖。

## 修复

- 外链关闭后，复用同一 Gecko 会话在后台加载 X 首页；喜欢准备时也按需恢复页面。
- `WritePreparation` 等待页面和真实元数据，串行进行只读探测，每次失败后间隔 500 ms，不发送或重放任何写入。
- 活跃外链、登录或帖子 handoff 期间不导航抢占会话；账号变化和 Activity 销毁会取消准备，迟到回调无效。
- 后台加载不显示前台遮罩，也不响应抢走阅读器焦点的请求。
- 每次准备最多 20 秒。外层既有四次 `not_ready` 重试仍保留，因此持续无法准备时，整个操作最坏约 85.6 秒才回滚；20 秒不是整个喜欢操作的总预算。

## 实际安装与真机验收

安装：`adb -s 192.168.10.100:5555 install -r app/build/outputs/apk/debug/app-debug.apk`，成功。

- 设备：当贝投影仪 `192.168.10.100:5555`。
- 版本：`0.2.0`；设备包更新时间 `2026-09-10 10:05:25`。
- 已安装 APK 与本地产物 SHA256 一致：`a5a3d91d9b2048485b75e0f5e403d9ed0dfcf79aa38364a91d4c8799a0dc4872`。
- 命令：`node scripts/check-write-recovery.mjs`。
- 原始证据：[issue-13-write-recovery-samples.json](issue-13-write-recovery-samples.json)。

脚本使用 debug 构建的 `check_write_preparation` intent，直接执行 `XWriteClient` 共用的 `WritePreparation` → `NavigationBridge` → 扩展 → 真实 X 页面的元数据链路。仅记录就绪布尔值和耗时，不打印元数据或凭据，不调用提交接口。它没有替换合成桥。

| 场景 | 结果 |
| --- | --- |
| 首次真实准备 | `ready=true`，6257 ms |
| 外链占用期间 | 请求等待，外链仍在前台 |
| 返回后恢复准备 | `ready=true`，8509 ms，包含等待外链结束的时间 |
| 后续再次准备 | `ready=true`，1248 ms |
| 阅读器状态 | 帖子、统计、滚动位置保留，reader=V、loading=G |
| 提交写入次数 | 0 |

此验证证明本次故障所在的真实准备链路已恢复，不声称在用户账号上执行了成功点赞。投影仪保留新构建并回到正常阅读器。

## 回归与审查

`WritePreparationTest` 新增 5 项：超过旧重试预算的慢恢复、外链占用、无重叠元数据探测、有限超时、取消与迟到回调。Java 编译及全量 JVM 测试通过（30 项）。`npm test` 登录检查和完整浏览器套件通过：140 项，2.4 分钟。

Standards 和 Spec 独立审查均无阻塞问题；Spec 审查要求区分单次 20 秒预算和整个操作预算，已在上文说明。
