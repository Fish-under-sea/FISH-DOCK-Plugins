# 插件维护者指南

本版为 1.0.0，配套 FISH Dock 1.1.0+。发行工具生成标准 ZIP 插件包、逐资源 SHA-256、商店目录及总摘要；桌面安装器与业务插件分别在各自仓库发布。

## 固定来源与资源

| 资源 | 当前开发验证来源 | 处理方式 |
| --- | --- | --- |
| Magpie | `yetone/magpie`，commit `ef3b9f85a46769713d55d21c6c3259fe70b69acd` 对应 Windows 资源 | 独立进程；逐文件摘要记录于插件清单 |
| mihomo | v1.19.15，`mihomo-windows-amd64-compatible-v1.19.15.zip` | 校验下载后暂存可执行文件，首次按需启动 |
| OFM | 本机明确指定的 `dsh-our-free-model` 源码目录 | 按所需运行文件暂存，保留自身管理页及渠道逻辑 |
| Node SDK | 同版 Dock 仓的 `sdk/node/plugin.mjs` | 复制到各插件，与宿主 API 1 联调 |

当前验证的 mihomo ZIP SHA-256：`e9251191e459816c1aca55d495eabd50d525e83aff0cd445608d69da7e0f470c`。发行前重新核对上游版本、资源名、来源、许可证与真实摘要，切勿用开发目录的文件名替代上游证据。

Windhawk 属于 Dock 宿主。其固定下载、安装、提权和源码编译的实现不在业务插件仓重复维护。自动回归使用合成安装与编译夹具；真实系统安装或应用仍需要用户在界面确认。

## 开发暂存

`tools/stage-development.mjs` 只生成新的开发目录：四个资源根、`plugin.json`、逐文件摘要、版本 README 及 `development.json`。它不制作 ZIP、不包含账号、不写线上索引。

```powershell
node tools/stage-development.mjs --out C:/work/preview-plugins --sdk ../FISH-Dock/sdk --ofm ../FISH-Dock/dsh-our-free-model --magpie C:/work/runtimes/magpie.exe --mihomo C:/work/runtimes/mihomo.exe
```

用新的绝对输出目录保留上一次结果。Dock 调试版通过 `FISH_DOCK_DEV_PLUGINS` 装载，发行版忽略该变量。默认正式安装集合不预装四插件。

## 版本与兼容

插件业务版本、宿主 API 版本与数据 schema 分别维护。安装清单声明平台与相对入口，资源摘要覆盖实际发布文件。官方 ID 和命名空间映射固定；第三方 ID 使用 `.plugin.<publisher>.<name>`。

数据根在运行时解析。复制导出包到其他盘符或账号后，以目标根和插件身份重新定位。`credentials`、`roster`、`keys`、`config` 为核心业务分类；`exports`、`backups`、`tmp` 分别保存导出、恢复点与临时资源。版本切换会更新说明 README，避免将临时目录当作持久配置。

宿主更新流程先备份业务分类，再切换资源并激活。激活失败会恢复旧版资源和原始分类；恢复异常时保留备份并提示重试。停用和卸载保留资料。破坏性清理需单独确认，不能作为升级或卸载的隐含步骤。

## 回归与验收

- 四插件业务回归：通知筛选、签名、配置事务、Clash 控制、系统代理租约恢复、网关端口与就绪检测。
- 真实进程：Magpie、OFM 的启动、停止、重新启动及异常退出；以独立测试数据运行。
- 宿主：清单与摘要准入、文件限额、命名空间、页面来源、协议边界、启停、卸载保留、更新失败回滚。
- 桌面：真实设置页、首次配置、业务错误后继续操作、标签排序、Clash 单／双栏、Windhawk 的缺失与恢复状态。
- 数据：跨根恢复、凭据与名册归属、README 的实际版本，以及备份恢复失败后的原资料保留。

Webhook 测试、系统代理切换、Windhawk 系统安装与应用均为实际外部动作，自动测试只使用替身。明确记录已执行和待用户验证的项目，不以静态检查替代真实服务验证。

## 发行顺序

1. 用户查阅开发版并确认进入打包阶段。
2. 固定 Dock、SDK、四插件版本与所需上游资源，核对第三方归属和许可证。
3. 从干净资源树制作 `.fish-plugin`，按实际 ZIP 字节计算摘要，再由宿主重新检查。
4. 在干净数据根完成安装、首次配置、升级、停用、卸载、跨根恢复及回滚验收。
5. 上传对应 GitHub Release 资源，验证最终 HTTPS 下载地址、平台、大小与摘要。
6. 资源实际可下载后再更新商店索引；索引失败时宿主保留已安装插件的管理能力。
7. 桌面安装包在 Dock 仓单独制作与发布；npm 为四个插件分别生成单包，进入各输出目录使用 `npm pack --dry-run` 检查后运行 `npm publish --access public`。

正式打包使用 `tools/build-release.mjs` 生成四个 `.fish-plugin`，再使用 `tools/build-npm-packages.mjs` 生成 `npm-plugin-packages-1.0.0/{feishu,clash,magpie,ofm}` 四个单包目录。每个 npm 包只包含一个对应归档、安装命令和所需许可证；发布前执行 `npm pack --dry-run`，确认没有其他插件、用户数据或构建缓存。GitHub Release 仍使用 `dist/*.fish-plugin`、`dist/stable.json` 和 `dist/SHA256SUMS.txt`。

对外开发入口见 [开发者指南](../developers/README.md)，使用与数据目录见 [项目 README](../../README.md)。
