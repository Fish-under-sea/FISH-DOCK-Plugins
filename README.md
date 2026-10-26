# FISH Dock 官方插件

**1.0.0 · FISH Dock 1.1.0+ · Windows x64 · 宿主 API 1**。

[下载插件](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v1.0.0) · [桌面宿主](https://github.com/Fish-under-sea/FISH-Dock) · [开发者指南](docs/developers/README.md) · [维护者指南](docs/maintainers/README.md)

| 插件 | 功能 | 包名 |
| --- | --- | --- |
| `fish.feishu` | 飞书群机器人通知、事件筛选、签名测试 | `feishu.fish-plugin` |
| `fish.clash` | mihomo、订阅、节点、模式、系统代理、单／双栏 | `clash.fish-plugin` |
| `fish.magpie` | 独立 Magpie 网关与原生管理页 | `magpie.fish-plugin` |
| `fish.ofm` | 独立 OFM 渠道账号、模型目录与原生管理页 | `ofm.fish-plugin` |

## 安装

本版需要 FISH Dock 1.1.0 的插件平台；桌面 1.1.0 当前处于实机验收阶段，公开软件发行仍以桌面仓 Release 为准。

推荐：打开 FISH Dock →「插件」→ 刷新官方商店 → 选择插件并确认安装。宿主校验固定下载来源、包摘要及全部文件；启用后显示业务标签。桌面安装器不预装这四项，Windhawk 属于宿主「外观」，无需在这里安装。

也可从本仓 Release 下载 `.fish-plugin`，对照 `SHA256SUMS.txt`。包是标准 ZIP，根内包含 `plugin.json` 和资源。下载文件本身不启动服务。

首次配置：飞书填写 Webhook 与可选签名；Clash 导入订阅；Magpie、OFM 默认停止，在各自页面保存配置后点击启动。服务、账号、数据和用量互相独立，停用与卸载保留资料。Magpie 内核为 0.1.1549，mihomo 为 v1.19.15；版本和许可见 [第三方清单](THIRD_PARTY_NOTICES.md)。

## npm 分发

`@fish-under-sea/fish-dock-plugins` 提供四个已验证插件包的目录及下载 CLI，不运行安装后脚本，也不自动修改 Dock 或系统代理。桌面内安装仍推荐使用官方商店。

```powershell
npx @fish-under-sea/fish-dock-plugins list
npx @fish-under-sea/fish-dock-plugins download magpie --out C:/work/plugins
```

## 数据

宿主启动时解析完整数据根：`--data-root` → `FISH_DOCK_HOME` → 当前用户目录下 `.fish-dock`。

| 归属 | 根内目录 |
| --- | --- |
| 宿主 | `host` |
| OFM | `.fishplugin-ourfreemodel` |
| 飞书 | `.fishplugin-feishu` |
| Clash | `.fishplugin-clash` |
| Magpie | `.fishplugin-magpie` |
| 第三方插件 | `.plugin.<publisher>.<name>` |

分类为 `credentials`、`roster`、`keys`、`config`、`exports`、`backups`、`tmp`。宿主生成当前版本说明并管理凭据加密。独立进程是生命周期边界，不等于操作系统权限隔离。导入导出按身份和相对路径重新定位目标根；备份可能包含账号、密钥，请作为个人资料保存。

## 开发与验证

需要 Node.js 24 和相邻 Dock 仓的 SDK，原生服务由开发者明确提供。开发暂存与正式发行采用不同输出目录，均须为新绝对路径。

```powershell
node tools/stage-development.mjs --out C:/work/preview-plugins --sdk ../FISH-Dock/sdk --ofm ../FISH-Dock/dsh-our-free-model --magpie C:/work/runtimes/magpie.exe --mihomo C:/work/runtimes/mihomo.exe
node tools/build-release.mjs --out C:/work/release-1.0.0 --sdk ../FISH-Dock/sdk --ofm ../FISH-Dock/dsh-our-free-model --magpie C:/work/runtimes/magpie.exe --mihomo C:/work/runtimes/mihomo.exe
node --test --test-isolation=none 'plugins/feishu/*.test.mjs' 'plugins/clash/*.test.mjs' 'plugins/magpie/*.test.mjs' 'plugins/ofm/*.test.mjs' 'shared/*.test.mjs' 'tools/*.test.mjs'
```

真实服务测试使用 `FISH_TEST_MAGPIE` 和 `FISH_TEST_OFM`。开发宿主通过 `FISH_DOCK_DEV_PLUGINS` 指向暂存目录，并设置 `FISH_DOCK_DEV_NODE`。发行包包含服务所需运行文件，不携带用户账号、订阅或缓存。源码适配代码采用 MIT；mihomo 保留 GPL-3.0，详见随包许可和对应源码链接。

发行时先上传 GitHub Release 并核验下载，最后更新 `catalog/stable.json`。商店故障不影响已安装项的本地管理。
