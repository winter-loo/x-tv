# Google 登录回跳修复（2026-09-13）

> 历史记录：下面是第一轮局部修复，未解决后续实机按键失效。
> 当前实现已经移除自定义登录页，见 [原生登录架构验收](native-authentication.md)。

## 已复现的问题

`npx playwright test tests/reading.spec.mjs --grep 'Google return'` 在修复前失败：
Google 交接后，X 从 `/i/flow/login` 切换到 `/i/jf/onboarding/web?mode=login`，
`mountCustomTvLogin` 再次设置 `tv-custom-login-active`，导致原生登录内容透明。
Google 窗口关闭不代表 X 完成认证，原生账号确认必须继续可见。

启动还存在独立的错误判断：`XReadClient.available()` 仅表示已捕获首页请求模板，
不能证明 Gecko 是否保存有效登录 Cookie。缺少模板时强制打开登录流程会跳过首页恢复。

## 修复

- Google 交接期间不重新启用自定义登录遮罩；同一标签页刷新后继续原生认证。
- 临时交接标记仅存时间戳，有效期 10 分钟，不保存账号、密码或认证令牌；
  检测到已登录导航或明确取消时清除。标记本身不被当作登录成功。
- 原生后续验证页面可释放启动遮罩，方向键不被阅读适配器吞掉。
- 返回取消后重新绑定自定义登录按钮；已经认证后不重新显示登录界面。
- 启动先访问 `/home`，由 X 判定是否需要认证；启动提示显示正在恢复状态。
- 内置扩展版本升为 1.6.5，覆盖安装时触发扩展更新。

## 自动验证

- 登录、阅读与手机辅助登录 21 项 Playwright 测试通过。
- Google 回归另补测模块重新加载、后续验证页面释放遮罩与按键、返回取消后按钮绑定，通过。
- `node scripts/check-login-state.mjs` 通过。
- Java 单元测试 45 项通过；`lintDebug`、`assembleDebug` 通过。

## 实机边界

设备为 DBD5X Pro（192.168.10.100:5555），覆盖安装 debug 包，未清除应用数据。
修复前设备停在 X 登录流程，无已登录导航。修复后启动首先打开 `/home`，
X 随后返回未登录根页面。此结果验证启动路径，不能证明真实账号登录已成功，
也不能单凭 DOM 判定 Cookie 是否缺失、过期或被服务端拒绝。
真实账号授权及登录后冷启动仍需完成后验收；自动测试不代替 Google/X 账号认证。

最终修复包再次覆盖安装后，`node scripts/check-google-popup.mjs` 通过：
真实 Google 授权窗口已打开并加载成功，没有会话打开异常。窗口保留供用户完成账号认证。
