# 0.2.0 发布准备验收（2026-09-12）

范围：仓库文档、构建与签名入口、调试功能隔离、现有阅读功能回归。渠道已确认 GitHub Release / APK 直接下载。未上传 Release，未创建 tag，长期签名已配置于仓库外。

## 本地结果

- `npm test`：255 项 Playwright 回归通过，登录状态脚本通过。
- `./gradlew testDebugUnitTest assembleDebug assembleRelease lintDebug lintRelease --offline --max-workers=2 --console=plain`：通过。
- Java：36 项测试，0 失败、0 错误。
- Debug Lint：0 错误、11 警告；Release Lint：0 错误、8 警告。
- compileSdk 37.1 下 Debug / Release AAR 元数据检查通过，移除了原先全局跳过该检查的配置。
- `aapt dump badging`：Debug 为 `0.2.0-debug` 且可调试；Release 为 `0.2.0` 且不可调试；包名及 versionCode 2 一致。
- APK ZIP 检查：mock_timeline.html、probe.html 存在于 Debug，未进入 Release。
- Release AppLog 字节码检查：不含 Android Log 调用。
- `package-release.py --help` 通过；缺少签名变量时明确失败，不生成分发产物。长期签名路径已端到端执行，见下方补充。
- `git diff --check` 通过；有限的已跟踪文本凭据模式扫描未发现命中，此项不等同于全面安全审计。

## 真机

更新 Debug APK 至当贝 DBD5X Pro 后，运行 `node scripts/check-fullscreen-reading.mjs` 通过：

1. 冷启动恢复登录时间线。
2. 在真实长帖上第一次确认进入普通详情，返回直接恢复原时间线位置。
3. 详情再次确认进入居中的全屏阅读，返回恢复详情及评论，再返回恢复原时间线。
4. 测试期间未记录 X 写入请求。

包含具体时间线内容的本地证据位于 `.scratch/fullscreen-reading-samples.json`，不纳入公开仓库。

## 边界

- 已生成长期签名 Release APK（约 159 MiB），未安装签名 Release。Debug 真机通过不能替代最终 Release 安装验收。
- AGP 9.2.1 对 compileSdk 37.1 的未测试版本提示仍可见，未用 suppress 配置隐藏。
- 已加入 GitHub CI，但尚未在远端执行。
- 保留限制、签名迁移、许可证、隐私材料与最终设备验收见 [发布清单](../release.md)。

## 长期签名与试用包补充

- `python3 scripts/package-release.py --offline` 通过：Java 单元测试、Release Lint、签名构建及产物核验全部成功（未变更测试输入的任务使用 Gradle 缓存）。
- RSA 3072 位长期密钥位于仓库外，目录 700、密钥与配置 600；外部备份尚待维护者完成。
- APK 证书与 `signing-certificate.sha256` 固定指纹一致，非 Debug 签名；版本 0.2.0 / code 2，ARM32，调试页面未进入分发包。
- 分发目录 `dist/0.2.0/` 包含 APK、INSTALL.md、SHA256SUMS 和 build-info.json；当前工作区未提交，元数据标记 dirty。
- 未上传、未替换投影仪应用。最终签名包首次安装、登录及升级仍待测试设备验证。
