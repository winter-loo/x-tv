# 发布指南与当前状态

当前阶段：0.2.1 试用版已发布，通过 GitHub Release（Pre-release）分发已签名 APK 与 SHA256SUMS。

本轮验证结果见 [发布准备验收](validation/release-preparation.md)。

## 发布范围

当前只声明 Android 9+、支持 32 位 ARM 应用的设备，实测当贝 DBD5X Pro（1080p）。公开试用版本为 `0.2.1 / versionCode 3`（GitHub Release 包含 `v0.2.0` 与 `v0.2.1`）。

## 已整理

- compileSdk 对齐 GeckoView 要求的 37.1，恢复 AAR 元数据检查；不再全局关闭依赖校验。
- 根 README 面向使用者与开发者，旧开发流水和旧方案移至 `docs/history/`。
- 版本集中在根目录 `version.properties`。
- Debug 版本后缀 `-debug`；Release 显式关闭 debuggable、网页控制台输出和应用诊断日志。
- F1、模拟页面、probe 和命令行调试 intent 仅在 Debug 生效；测试 HTML 只打包到 Debug。
- 保持现有包名，未清除设备数据，未更换投影仪上的签名。
- GitHub CI 自动运行前端回归、Java 单元测试、Debug / unsigned Release 构建与 Lint，不上传产物。
- 长期签名默认读取本机私有配置，也支持环境变量，仓库不保存私钥或密码；无签名时可构建 unsigned APK 供检查。
- 分发脚本核验签名、包名、版本、非 debug 属性、ABI 和测试页面隔离，输出 APK、SHA256SUMS、构建元数据。

## 小范围试用

用户说明见 [安装方法、支持设备和已知问题](install.md)。当前按 0.2.0 小范围 APK 试用整理，不要求先走应用商店发布流程。

长期签名已固定；最终签名包的首次安装、登录和覆盖升级仍需在测试设备验证。当前投影仪保留原开发版及登录数据。第三方组件声明仍需随分发材料整理，项目自身开源许可证暂不替作者选择。

## 保留的兼容性限制

AGP 9.2.1 对 compileSdk 37.1 仍输出未测试版本提示（已测试上限为 37.0），未压制这条警告。已恢复的 AAR 元数据检查通过，不代表构建工具对该小版本的官方支持已确认；发行前需结合最终 APK 实测评估。工具依据见 [Android 构建兼容表](https://developer.android.com/build/releases/about-agp)。

`targetSdk=28`、仅 `armeabi-v7a`、未开启代码压缩，均为当前实测基线；这次不以未经验证的大版本升级替代发布整理。应用商店发布需另行核对目标 SDK、64 位及渠道规则。

应用允许明文网络，扩展仍有全站权限和历史 iframe 响应头适配。这些配置涉及登录/外链与旧网页适配路径，需要专门缩小权限并验证后才能声称完成安全加固。当前整理不等于安全审计通过。

## 构建与签名

准备 JDK、Android SDK 和 Node 环境后：

```sh
npm ci
TMPDIR=/var/tmp npx playwright install firefox
npm test
./gradlew testDebugUnitTest assembleDebug assembleRelease lintDebug lintRelease --console=plain
```

无签名时产物：`app/build/outputs/apk/release/app-release-unsigned.apk`，不能直接安装或作为发行附件。

本机长期密钥：`~/.config/tvx/signing/x-tv-release.p12`；密码与别名配置：同目录 `signing.json`。目录权限 700，文件权限 600。打包脚本自动读取此配置，不需要每次输入密码；直接调用 Gradle 不会自动加载它。

**请将整个 `~/.config/tvx/signing/` 目录备份到安全的离线介质或加密备份中。** 目前只创建了本机副本，尚未完成外部备份。换电脑时恢复该目录，并将配置中的密钥绝对路径改为新路径。丢失密钥后不能用新密钥覆盖升级现有安装；不要重新生成替代。

公开证书 SHA-256 固定在根目录 `signing-certificate.sha256`，这不是密码。打包脚本拒绝不同签名的 APK。

CI 或其他机器也可通过以下四个环境变量完整提供配置（优先于本机配置）。不要把密码粘贴到聊天、提交文件或写进脚本：

| 变量 | 用途 |
| --- | --- |
| `TVX_KEYSTORE_PATH` | keystore 的绝对路径 |
| `TVX_KEYSTORE_PASSWORD` | keystore 密码 |
| `TVX_KEY_ALIAS` | 签名别名 |
| `TVX_KEY_PASSWORD` | 私钥密码 |

配置后运行：

```sh
python3 scripts/package-release.py
# 依赖已缓存时可加 --offline
```

产物在 `dist/<versionName>/`（Git 忽略），包含已验证 APK、INSTALL.md、SHA256SUMS 和 build-info.json。脚本不创建密钥、不安装、不上传。Git 工作区未提交时元数据标注 `dirty: true`；公开分发前应从已提交版本重新打包。

## 安装与升级

Android 升级要求 applicationId 和签名一致。当前投影仪的开发 APK 使用 debug 签名，不能直接覆盖安装不同正式签名的同包名 APK。不要为解决冲突自动卸载或清数据；先安排账号重新登录和迁移。也不要把 debug key 当成正式发行密钥。

最终安装包验收通过后，再创建对应 tag 和 Release，附 CHANGELOG 内容、设备限制、APK 和校验文件。未授权自动发布。

参考：[Android 应用签名](https://developer.android.com/studio/publish/app-signing)、[构建变体](https://developer.android.com/build/build-variants)、[发布准备](https://developer.android.com/studio/publish/preparing)。

## GitHub 远端试用发布

`.github/workflows/release.yml` 通过 Actions 的 **Build trial APK → Run workflow** 手动运行，只允许 main 分支。它运行前端回归、Java 测试与 Release Lint，构建长期签名 APK、核验证书指纹，然后创建 `v<versionName>` 的 GitHub 预发布版本，附 APK、安装说明、校验文件和构建信息。

仓库 Actions Secrets 使用 `TVX_KEYSTORE_BASE64`、`TVX_KEYSTORE_PASSWORD`、`TVX_KEY_ALIAS`、`TVX_KEY_PASSWORD`；密钥只在构建步骤临时恢复并于退出时删除。PR 检查不读取这些签名凭据。已有同名 Release 不覆盖，后续分发先递增版本号。

普通 push / PR 的 Verify 工作流仍只做检查。下载和实机验收必须使用远端 Release 附件，核对 SHA256SUMS 以及 build-info.json 的 commit 后再安装。
