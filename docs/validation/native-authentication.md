# 原生登录架构（2026-09-13，开发版）

替代此前的 DOM 登录代理和登录遮罩，不包含在已发布的 0.2.0 APK 中。

## 为什么重做

此前登录入口、启动遮罩、阅读适配器、真实 X 表单及 Google 弹窗同时参与输入和页面状态。
第一轮回跳修复后，实机仍出现 ADB 方向键未进入 DOM、但 DOM 合成按键正常的情况。
这不是只增加一次焦点请求就可以证明解决的问题。

## 当前职责

- `LoginActivity`：Android 原生按钮入口、一个专用 X 认证会话及其 Google 子窗口。
  入口使用 Android 原生焦点；网页方向键映射 Tab/Shift+Tab，通过当前显示会话的
  `SessionTextInput` 送入 Gecko。菜单键进入原生工具栏，返回键取消当前尝试。
- `LoginFlow`：唯一流程状态，ENTRY → WEB → POPUP → WEB → VERIFYING → COMPLETE。
  Popup 关闭本身不是登录成功。取消和新尝试递增 generation，旧回调不能夺回界面。
- `auth-page.js`：只报告真实导航和 Google iframe 就绪，关联当前尝试；不创建表单、不操作密码。
  专用认证页不运行阅读适配器、阅读启动遮罩及阅读快捷键。
- `NavigationBridge`：连接就绪后才加载认证页；关闭的桥接不能重新接管扩展。
  认证命令按当前尝试和标签页路由，不依赖可能变化的 active tab。
- `XReadClient`：当前尝试捕获可用请求、真实账号导航出现且首页读取成功后，才保存
  `verifiedAccount`。模板存在不再等于登录完成；旧版本模板在首次升级时重新验证，浏览器 Cookie 保留。
  账号变化和退出会使完成标记失效。

没有收到认证成功时保持真实网页并提供重试/返回，不静默跳回伪登录页。
Google iframe 加入 DOM 与 iframe 加载完成是两个事件，原生快捷入口只在后者发生后点击。

## 使用

- 原生入口选择「使用 Google 账号登录」「使用 X 账号登录」或「用手机辅助登录」。
- 网页上下选择、确认继续；菜单键打开重新加载、手机辅助输入及返回工具。
- 阅读页菜单中选择「退出 X 登录」，经过原生确认后清除此设备的 X/Twitter Cookie、站点存储、
  认证会话和加密阅读会话；保留 Google 账号，便于再次登录。
- 返回登录方式只取消尝试，不清除已经完成的浏览器账号认证。

## 验收命令

```sh
./gradlew testDebugUnitTest lintDebug assembleDebug --console=plain
npm test
node scripts/check-login-state.mjs
python3 scripts/check-auth-input.py --serial 192.168.10.100:5555
node scripts/check-google-popup.mjs
# 已打开真实 X 空白登录表单时：
python3 scripts/check-auth-web-input.py
```

`check-auth-input.py` 使用实际 Android 按键，验证三次上下焦点移动、三次进入/取消、
旧回调不夺屏及返回桌面后重开。仅用于未登录设备，不输入凭据，也不主动退出账号。

本轮结果：Java 53 项通过，`lintDebug`/`assembleDebug` 通过；全量 Playwright 263 项通过，
之后补充 Google 页面内确认及延迟显示回归：Google 先加载隐藏 iframe，稍后通过样式显示确认框，
必须监听可见性变化。延迟显示回归修复前稳定失败。
修复后认证套件 6 项全部通过。

DBD5X Pro 实机已通过：三轮原生方向键焦点、三次认证进入/取消、返回桌面后重开；
真实 X 表单上六次 ADB 上下键全部到达 DOM，记录为可信的 Tab/Shift+Tab，探针随后移除。
1.7.2 实机 Google 路径通过：原生 Google 按钮 → 真实页面内账号确认（`google-inline`）→
返回取消 → 原生入口。这验证确认界面可达与返回路径，不代表账号已认证。
重复进入时 Google 也走过独立 popup 路径，返回同样通过。
父页的超时提示不得覆盖 popup 的加载结果；最终脚本还要求 popup 加载成功后才通过。
首次全量测试中的 5 项旧菜单数量/浏览器 mock 断言已更新，随后全量复跑全部通过。

内置扩展为 1.7.2，覆盖安装使用版本升级触发 Gecko 更新，不能仅修改扩展资源后以相同版本判断实机结果。

## 真实账号边界

2026-09-13 实机账号验收已完成：用户明确授权使用当前 Google 账号后，点击 Google 确认，
X 首页验证请求返回 HTTP 200 / `result=ok`，应用自动从 `LoginActivity` 进入 `BrowserActivity` 阅读页。
随后连续两次 force-stop 并重新启动应用，均直接显示「时间线／刚刚更新」，未返回认证页。
最终保留已登录阅读页，未执行退出登录；此次不等同于设备断电重启或长期登录有效性验证。

模拟测试不代表 Google/X 已接受真实账号；授权、后续挑战、进入阅读页及登录后冷启动必须实机验收。
不得将弹窗打开、弹窗关闭、URL 改变或页面可见单独报告为登录成功。
