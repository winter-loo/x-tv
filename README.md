# TV X Browser

当贝投影仪上的 X 浏览器原型：GeckoView + 内置 WebExtension，提供大屏登录界面和遥控器时间线导航。

## TV Reading（GitHub #1）

首页采用 [Figma 的等宽双列设计](https://www.figma.com/design/ojFk7rTIxIg7PVqRs4UmzI?node-id=2-2)：1920×1080 参考画面中，左右留白 96px、列宽 824px、列间距 80px；按 GeckoView 的 CSS 视口比例缩放。作者、正文、图片/视频、文章附件和计数保留为真实 X DOM 节点，布局标记不移动或复制 React 内容。页面顶栏显示当前时间线和真实登录头像。

- 上 / 下：上一条 / 下一条帖子；到边界时由 X 继续加载。
- 右：选中图片或视频；确认查看图片或播放视频。视频控制栏用左右选择播放 / 暂停、全屏、快退 / 快进、声音和关闭。
- 左：含媒体的长帖翻阅正文；纯文字 / 文章附件仍用左右翻页。图片放大后用方向键移动。
- 确认：打开当前帖子的原生详情。
- 返回：先退出视频全屏，再关闭媒体控制 / 查看器，再退出媒体选择；详情回到原帖，首页回到顶部，再次返回退出。

焦点使用帖子链接标识，避免虚拟列表回收或插入帖子后误打开另一条。无法识别的帖子不执行猜测点击；未加载、空时间线和登录页面分别处理。菜单、点赞与回复等后续交互在其他 tickets 中实现。

## UX 修复（2026-09-08）

启动先显示深色加载提示，扩展注册和 TV 布局就绪后展示内容；加载过慢可确认重试。遥控器按下 / 松开统一进入页面控制，媒体播放保留真实用户手势；原生消息连接增加存活检测。重开桌面图标保留当前页面，详情在独立会话中打开，首页及各层原帖保留；返回关闭当前详情并恢复上一层。

回归与投影仪复测见 [UX 验收记录](docs/validation/ux-startup-navigation-media.md)。真机复测脚本只浏览和控制媒体，不点赞或发布：

```sh
python3 scripts/check-projector-ux.py --serial 192.168.10.100:5555
```

## 评论详情

在帖子详情中按右键进入评论栏，上下键选择评论；长评论会先滚动正文，再移动到下一条。确认打开该评论的帖子详情，可以继续打开它下面的评论。返回逐层恢复上一页，并保留评论焦点、正文和评论栏的滚动位置。评论文字也可直接点击。

在评论栏再按右键选中“写评论”；确认打开输入框，返回取消（系统键盘显示时先收起键盘）。上级帖子不会被当作当前评论的子评论。

验证记录见 [评论详情验收](docs/validation/comment-details.md)。

## 当前进度（2026-09-07）

#1 平衡阅读布局已完成验收：9 项 Firefox DOM 回归、150 条真实帖子连续导航、真实 X Article 显示、详情往返、返回顶部、Google 登录与冷启动登录保持均通过。GeckoView 已更新至 `155.0.20260903215306`，修复真机 RGB PNG 解码崩溃。详见 [验收记录](docs/validation/issue-1.md)。

## 原型阶段记录（2026-09-06）

Google 登录链路已完成本次真机验收：手机两步验证后进入真实 X 首页；强制停止应用进程并重新启动，仍保持 X 登录，无需再次输入账号或验证。

- 大屏登录界面、用户名/密码代理输入、Google/Apple 入口已有实现；Apple 未验收。
- Google 官方登录页已在 DBD5X Pro（Android 9、1920×1080）打开，显示“继续前往 X”和邮箱输入框。
- 修复原生登录根节点 `display:none` 导致 Google iframe 尺寸为零的问题。
- 使用 `GeckoSession.getClientToSurfaceMatrix` 将网页点击坐标转换成投影画面坐标。
- Google 登录入口只点击实际 Google iframe，并显示原生授权界面；删除批量模拟点击和整页 Google 诊断输出。
- `onNewSession` 返回未打开的会话，由 GeckoView 建立 opener；弹窗退出恢复主会话及大屏登录界面。
- 删除用户名/密码值的控制台日志。
- 仅在提交用户名后允许自动切换到密码步骤，避免后台密码字段让 Google 取消流程误入密码页。
- 补齐 TV 桌面横幅；移除吞掉未捕获异常的调试处理，恢复 Android 默认崩溃处理。

验证：`assembleDebug lintDebug` 成功（仍有 8 条警告）；Google 弹窗检查已通过，并目视确认官方账号输入页。

最终真机复测：Google 弹窗打开通过；按一次返回恢复用户名登录页且焦点落在 Google 按钮；后台密码字段误判的 Node 回归检查通过。

账号实测补充：此前过期后重试的 Google 授权页在手机确认后出现过 HTTP 400。关闭该弹窗、从 X 重新进入 Google 入口后，已登录 Google 账号可直接选择，授权弹窗自动关闭，X 随后加载真实时间线。未修改请求参数、未清除应用数据；400 的具体原因尚未定位。

登录保持实测：执行 `am force-stop cn.deeloo.tvxbrowser` 后启动应用，等待首页加载完成，账号头像与真实时间线恢复。未测试投影仪重启及长期会话过期。

首页显示修复已安装并在真机验证：加载中保留原生加载状态，不再把 `/home`、空时间线或普通弹窗当成登录页；从 X 主容器的祖先节点到内容列统一宽度约束，使真实时间线居中；统一深色页头、正文和操作区，修正文字对比度及固定页签栏透底。保留图片和视频本身的颜色。

验证：扩展登录状态检查覆盖加载中首页、空时间线、普通弹窗、未登录落地页；`assembleDebug lintDebug` 通过；真机冷启动保持登录，首页加载无登录覆盖层，向下键能移动帖子焦点，滚动时固定页签栏背景不透底。

后续待验收：Apple 登录、用户名/密码全流程及完整遥控器浏览体验。

## 构建与检查

阅读界面的 Firefox DOM 回归：

```sh
npm ci
TMPDIR=/var/tmp npx playwright install firefox
npm test
```

测试边界和真机 PNG 解码复现见 [tests/README.md](tests/README.md)，#1 的验收证据见 [docs/validation/issue-1.md](docs/validation/issue-1.md)。

```sh
./gradlew assembleDebug lintDebug --console=plain
adb -s 192.168.10.100:5555 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s 192.168.10.100:5555 shell am start -n cn.deeloo.tvxbrowser/.BrowserActivity --es url https://x.com/i/flow/login
```

等 X 登录页和 Google 按钮加载完成，执行：

```sh
node scripts/check-google-popup.mjs
node scripts/check-login-state.mjs
```

脚本点击 Google 入口，检查是否创建弹窗、是否发生会话异常、是否完成页面加载；不输入账号，不输出原始 OAuth URL。页面内容仍需观察真机确认。可通过 `TVX_ADB_SERIAL` 指定其他设备。

手动验收：在大屏登录页按下键选中 Google，确认进入官方登录页；返回一次应恢复大屏 Google 按钮焦点；再次确认应能重新打开官方登录页。

截图请先在设备保存再拉取，投影仪 `exec-out screencap` 的标准输出可能混入厂商日志：

```sh
adb -s 192.168.10.100:5555 shell screencap -p /sdcard/tvx-check.png
adb -s 192.168.10.100:5555 pull /sdcard/tvx-check.png /tmp/tvx-check.png
```

此目录已初始化 Git（`main` 分支），远程仓库为 [winter-loo/x-tv](https://github.com/winter-loo/x-tv)。项目仍有原型级配置（旧 targetSdk、开启远程调试、广泛扩展权限），正式发布前需要另做发布检查。
