<img align="right" width="176" src="assets/readme/DSH-model-broker.png" alt="FISH Dock">

# FISH Dock 官方插件

**1.0.0 · FISH Dock 1.1.0+ · Windows x64 · 宿主 API 1**。业务功能以独立插件形式按需安装，桌面宿主负责生命周期、清单校验、存储身份和插件页面。

[下载插件](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v1.0.0) · [桌面宿主](https://github.com/Fish-under-sea/FISH-Dock) · [开发者指南](docs/developers/README.md) · [维护和发行指南](docs/maintainers/README.md)

## 本版变化

- 飞书、Clash、Magpie、OFM 分离为四个独立 `.fish-plugin` 包，按需安装和更新。
- npm 分发改为四个独立单包；安装一个 npm 包只带对应插件，不下载其他插件。
- 宿主校验固定下载来源、插件清单、平台、资源摘要和存储身份。
- 插件服务按需启动，停用和卸载保留插件资料。

| 插件 | 功能 | GitHub 包 | npm 单包 |
| --- | --- | --- | --- |
| 飞书 | 群机器人通知、事件筛选、签名测试 | `feishu.fish-plugin` | `@fish-under-sea/fish-dock-plugin-feishu` |
| Clash | mihomo、订阅、节点、模式和系统代理 | `clash.fish-plugin` | `@fish-under-sea/fish-dock-plugin-clash` |
| Magpie | 独立网关、模型网关和原生管理页 | `magpie.fish-plugin` | `@fish-under-sea/fish-dock-plugin-magpie` |
| OFM | 渠道账号、模型目录和原生管理页 | `ofm.fish-plugin` | `@fish-under-sea/fish-dock-plugin-ofm` |

## 安装与更新

1. 安装 FISH Dock 1.1.0。
2. 打开「插件」页，刷新官方商店，选择需要的插件并确认安装。
3. 也可以从 [GitHub Release](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v1.0.0) 下载对应 `.fish-plugin`，对照 `SHA256SUMS.txt` 后在「插件」页导入。

插件包是标准 ZIP，根内包含 `plugin.json` 和资源。下载或导入不会启动服务。飞书需要填写 Webhook；Clash 需要导入订阅；Magpie 和 OFM 默认停止，在各自页面保存配置后手动启动。

## npm 单包

四个 npm 包分别提供一个已校验的对应插件归档和安装命令。不会运行安装后脚本，也不会修改 Dock、系统代理或其他系统设置。

| npm 包 | 安装命令 |
| --- | --- |
| `@fish-under-sea/fish-dock-plugin-feishu` | `npx @fish-under-sea/fish-dock-plugin-feishu --out C:/work/plugins` |
| `@fish-under-sea/fish-dock-plugin-clash` | `npx @fish-under-sea/fish-dock-plugin-clash --out C:/work/plugins` |
| `@fish-under-sea/fish-dock-plugin-magpie` | `npx @fish-under-sea/fish-dock-plugin-magpie --out C:/work/plugins` |
| `@fish-under-sea/fish-dock-plugin-ofm` | `npx @fish-under-sea/fish-dock-plugin-ofm --out C:/work/plugins` |

示例：

```powershell
npm install @fish-under-sea/fish-dock-plugin-magpie@1.0.0
npx @fish-under-sea/fish-dock-plugin-magpie --out C:/work/plugins
```

命令会校验 npm 包内归档的 SHA-256，并使用新文件方式写入目标目录；目标文件已存在时停止，避免覆盖已有版本。

## 致谢与第三方核心

以下插件调用或分发上游项目的核心能力，感谢相关项目维护者：

- Clash 插件使用 [mihomo](https://github.com/MetaCubeX/mihomo)，固定版本为 v1.19.15，遵循 GPL-3.0。
- Magpie 插件使用 [Magpie](https://github.com/yetone/magpie)，固定 Windows 资源对应 commit 为 `ef3b9f85a46769713d55d21c6c3259fe70b69acd`，遵循 MIT。
- OFM 插件基于 [Our Free Model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 的 standalone 构建与渠道能力。

第三方版权、许可证原文和固定资源摘要见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 及各 npm 单包内的 `licenses` 目录。


插件服务、凭据、配置和数据互相独立。宿主启动时解析完整数据根：`--data-root` → `FISH_DOCK_HOME` → 当前用户目录下 `.fish-dock`。

| 归属 | 根内目录 |
| --- | --- |
| 宿主 | `host` |
| OFM | `.fishplugin-ourfreemodel` |
| 飞书 | `.fishplugin-feishu` |
| Clash | `.fishplugin-clash` |
| Magpie | `.fishplugin-magpie` |
| 第三方插件 | `.plugin.<publisher>.<name>` |

各目录按 `credentials`、`roster`、`keys`、`config`、`exports`、`backups`、`tmp` 分类。备份可能包含账号和密钥，请作为个人资料保存。独立进程是生命周期边界，不等于操作系统权限隔离。

## 开发与验证

需要 Node.js 24 和相邻 Dock 仓的 SDK。开发暂存与正式发行采用不同输出目录，原生服务由开发者明确提供。

```powershell
node tools/stage-development.mjs --out C:/work/preview-plugins --sdk ../FISH-Dock/sdk --ofm ../FISH-Dock/dsh-our-free-model --magpie C:/work/runtimes/magpie.exe --mihomo C:/work/runtimes/mihomo.exe
node tools/build-release.mjs --out C:/work/release-1.0.0 --sdk ../FISH-Dock/sdk --ofm ../FISH-Dock/dsh-our-free-model --magpie C:/work/runtimes/magpie.exe --mihomo C:/work/runtimes/mihomo.exe
node tools/build-npm-packages.mjs --dist C:/work/release-1.0.0/dist --out C:/work/npm-plugin-packages-1.0.0
node --test --test-isolation=none 'plugins/feishu/*.test.mjs' 'plugins/clash/*.test.mjs' 'plugins/magpie/*.test.mjs' 'plugins/ofm/*.test.mjs' 'shared/*.test.mjs' 'tools/*.test.mjs'
```

每个 npm 单包位于输出目录的对应子目录，进入该目录执行 `npm publish --access public`。发布前使用 `npm pack --dry-run` 检查文件清单，不把其他插件、用户数据或构建缓存带入包内。

## 来源和许可

适配代码采用 MIT。mihomo v1.19.15 和 Magpie 0.1.1549 的许可及源码链接见 [第三方清单](THIRD_PARTY_NOTICES.md) 与随包 `licenses` 目录。
