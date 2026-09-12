# X TV

为 Android TV 和投影仪设计的 X 阅读客户端：用遥控器浏览时间线、阅读长帖和评论、查看图片及播放视频。采用本地大屏阅读器与 GeckoView 浏览器，登录使用 X 网页。

## 设备范围

- Android 9（API 28）及以上，设备须支持 `armeabi-v7a`（32 位 ARM）应用。
- 已验证设备：当贝 DBD5X Pro，1920×1080，系统 WebView Chromium 66。
- 纯 64 位 ARM、x86 和非 Android 系统不支持当前包；其他 Android TV 设备尚未实测。需要可访问 X 的网络和 X 账号。

## 遥控器操作

| 页面 | 操作 |
| --- | --- |
| 时间线 | 上下切换帖子；顶部按上刷新；正文按 OK / Enter 直接进入详情 |
| 时间线媒体区 | 右键选择媒体；确认查看图片或播放视频 |
| 帖子详情 | 上下阅读正文；右键进入评论；正文确认进入全屏阅读；评论确认进入该评论详情 |
| 全屏阅读 | 上下翻页；返回恢复详情；详情再返回恢复时间线原帖 |
| 作者简介 | 左侧资料、右侧已加载帖子；左右切换区域；确认打开帖子或操作关注按钮 |
| 图片 | 确认循环整图 / 2× / 4×；放大后方向键平移；返回先恢复整图 |
| 视频 | 确认播放 / 暂停；左右快退 / 快进；返回退出播放 |
| 菜单键 / 右键菜单 | 喜欢、写评论、查看作者以及当前帖子的链接；关注入口位于作者简介页 |

作者页目前汇总已加载的帖子，并非完整作者历史。X 的网页和接口变化可能影响登录、读取和操作。

## 安装与发布

**[安装方法、支持设备和已知问题](docs/install.md)**（0.2.0 小范围试用）。

维护者的签名、构建、升级规则见 [发布指南](docs/release.md)。当前版本由 [version.properties](version.properties) 管理；发布候选变更见 [CHANGELOG.md](CHANGELOG.md)。

下载 APK 后通过设备的安装器安装，或使用：

```sh
adb -s <设备地址> install -r <已签名的APK路径>
```

升级要求包名和签名一致。现有开发安装使用 debug 签名，不能直接被另一份正式签名覆盖；迁移安排见发布指南。

## 开发与验证

需要 JDK 17 或更新版本（本机使用 JDK 21）、Android SDK 37.1 / Build Tools 36.0.0、Node.js 22 或更新版本。Gradle 通过仓库中的 wrapper 运行。在 `local.properties` 配置 `sdk.dir`，不要提交本机 SDK 路径。

```sh
npm ci
TMPDIR=/var/tmp npx playwright install firefox
npm test
./gradlew testDebugUnitTest assembleDebug assembleRelease lintDebug lintRelease --console=plain
```

未设置签名时 `assembleRelease` 仅生成不可直接安装的 unsigned APK，供构建检查。分发包使用 `python3 scripts/package-release.py`，该脚本自动读取仓库外的本机长期签名配置，并核对固定的证书指纹。

Debug APK：`app/build/outputs/apk/debug/app-debug.apk`。系统 WebView 的本地阅读器脚本需要兼容 Chromium 66；GeckoView 扩展是另一个运行环境，不应混用语法基线。

## 项目结构

- `app/src/main/java/`：Android 生命周期、会话、网络客户端与遥控器桥接。
- `app/src/main/assets/reader/`：本地 TV 阅读器、数据模型和媒体交互。
- `app/src/main/assets/tv-extension/`：GeckoView 内置扩展、X 登录和网页适配。
- `app/src/debug/assets/`：仅开发构建使用的模拟时间线与探针页。
- `tests/`：Playwright 回归；`app/src/test/`：Java 单元测试。
- `scripts/`：真机验收与发布打包工具。
- `docs/validation/`：历史实测证据；[测试说明](tests/README.md)描述测试边界。
- [历史开发记录](docs/history/development-log.md)、[早期体验方案](docs/history/early-ux-plan.md)：保留作参考，不作为当前发布待办。

## 反馈与数据

问题请提交到 [GitHub Issues](https://github.com/winter-loo/x-tv/issues)，附设备型号、Android 版本、应用版本和复现步骤。分享截图、录屏及日志前删除账号和私人内容。

数据处理说明见 [PRIVACY.md](PRIVACY.md)。本项目不是 X 官方应用。
