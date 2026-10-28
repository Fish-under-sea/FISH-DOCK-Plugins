<div align="center">

<p>
  <a href="README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-zh-zh-dark.png"><img src="assets/readme/key-zh-zh-light.png" alt="中文" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/FISH-Dock/blob/main/README.en.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-en-zh-dark.png"><img src="assets/readme/key-en-zh-light.png" alt="English" height="40"></picture></a>
  <a href="#get-started"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-start-zh-dark.png"><img src="assets/readme/key-start-zh-light.png" alt="入门指南" height="40"></picture></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/config-hero-zh-dark.png">
  <img src="assets/readme/config-hero-zh-light.png" alt="FISH 插件配置仓：官方插件、配置说明与版本下载" width="1448">
</picture>

<p>
  <a href="https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v1.1.1"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/config-stat-version-zh-dark.png"><img src="assets/readme/config-stat-version-zh-light.png" alt="VERSION：Magpie 1.1.1，其余插件 1.0.2" width="23%"></picture></a>
  <a href="#plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/config-stat-desktop-zh-dark.png"><img src="assets/readme/config-stat-desktop-zh-light.png" alt="PLUGINS：四个独立插件" width="23%"></picture></a>
  <a href="#packages"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/config-stat-mail-zh-dark.png"><img src="assets/readme/config-stat-mail-zh-light.png" alt="PACKAGES：四个 npm 单包" width="23%"></picture></a>
  <a href="https://github.com/Fish-under-sea/FISH-Dock"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/config-stat-channels-zh-dark.png"><img src="assets/readme/config-stat-channels-zh-light.png" alt="HOST API：1，兼容 FISH Dock 1.1.0+" width="23%"></picture></a>
</p>

<p><img src="https://img.shields.io/badge/Node.js-24.14%2B-8fd6a0?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white&amp;labelColor=5a544a" alt="Node.js 24.14+"> <img src="https://img.shields.io/badge/Adapter%20License-MIT-8fd6a0?style=flat-square&amp;labelColor=5a544a" alt="插件适配代码许可 MIT"> <img src="https://img.shields.io/badge/mihomo-GPL--3.0-f08a5d?style=flat-square&amp;labelColor=5a544a" alt="随包 mihomo 许可 GPL-3.0"> <img src="https://img.shields.io/badge/Magpie-1.1.0-8fd6a0?style=flat-square&amp;labelColor=5a544a" alt="Magpie 插件 1.1.0"> <img src="https://img.shields.io/badge/Other%20Plugins-1.0.2-ffd84a?style=flat-square&amp;labelColor=5a544a" alt="其他插件 1.0.2"></p>
<p><strong>FISH Plugins &amp; Configuration · 插件配置仓</strong><br>官方插件、配置说明与发行入口；按需安装，独立运行。</p>

<p>
  <a href="#get-started"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-download-zh-dark.png"><img src="assets/readme/key-download-zh-light.png" alt="下载 / Releases" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v1.1.1"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-release-zh-dark.png"><img src="assets/readme/key-release-zh-light.png" alt="更新记录" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/FISH-DOCK-Plugins/issues"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-issues-zh-dark.png"><img src="assets/readme/key-issues-zh-light.png" alt="反馈 / Issues" height="40"></picture></a>
</p>

</div>

<h2 id="intro"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-intro-dark.png"><img src="assets/readme/section-intro-light.png" alt="INTRO · 简介" width="100%"></picture></h2>

这里是 FISH Dock 的插件配置仓，集中提供四个官方插件的功能介绍、配置说明、安装包和更新记录。下载标准 `.fish-plugin` 包后，可在 Dock 的「插件」页导入；也可以通过 npm 获取对应插件归档。

每个插件独立保存配置与凭据，按需启动，不共享业务密钥。插件仓只发布插件资源，桌面安装包请前往 [FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock)。

最新补丁：[Clash 1.3.0](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v1.3.0)：节点页改为 Clash Verge 风格分组（节点选择／自动选择／广告拦截／Telegram／AI 服务／微软／苹果／全球直连／漏网之鱼，组卡网格 + 节点网格 + 延迟色阶），规则按类别分流、国内直连；订阅卡新增流量额度条（解析 `subscription-userinfo`，显示已用／总量／剩余／到期）。内置 GeoSite/GeoIP 数据，首启不联网下载。Magpie、飞书与 OFM 版本见下方包列表。

> ⚠️ npm 上 `@fish-under-sea/fish-dock-plugin-clash@1.1.0` 为误发版本（基于旧基线，缺少 1.0.4 的多订阅修复），请勿使用；请安装 `1.3.0`（当前 `latest`）。

<h2 id="plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-features-dark.png"><img src="assets/readme/section-features-light.png" alt="PLUGINS · 四个插件" width="100%"></picture></h2>

### 飞书通知

群机器人通知、事件筛选和签名配置。Webhook 与签名密钥保存在插件自己的加密凭据空间。

<p align="center"><img src="assets/readme/feishu.png" width="760" alt="飞书通知插件界面"></p>

### Clash 代理

基于 mihomo 的代理管理，提供订阅、节点、规则和系统代理控制。代理内核只绑定回环地址。

<p align="center"><img src="assets/readme/clash.png" width="760" alt="Clash 代理插件界面"></p>

### Magpie 网关

独立模型网关与原生管理页。管理页、模型网关和 Dock 嵌入代理使用独立回环端口，避免相互占用。网关页可直接开关「自启动」，决定服务是否随 Dock 启动；签到页随包内置，按厂商分组、支持一键签到与积分刷新。

<p align="center"><img src="assets/readme/magpie.png" width="760" alt="Magpie 网关插件界面"></p>

### OFM 本地模型（自 2026-10-25 起暂停维护）

本地模型渠道和 API 工作台。**自 2026 年 10 月 25 日起暂停维护**：不再跟进功能与兼容性更新，已安装的版本可继续使用，配置与数据保留；需要模型网关时请迁移到 Magpie。此前的灰度限制（完整登录、项目绑定与模型调用流程）保持原状。

<p align="center"><img src="assets/readme/ofm.png" width="760" alt="OFM 本地模型插件界面"></p>

<h2 id="get-started"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-install-dark.png"><img src="assets/readme/section-install-light.png" alt="INSTALL · 安装使用" width="100%"></picture></h2>

1. 安装 [FISH Dock 1.2.2](https://github.com/Fish-under-sea/FISH-Dock/releases/tag/v1.2.1)；网关页的自启动开关需要 1.2.2 及以后的宿主。
2. 在「插件」页检查更新、选择插件并确认安装；或按下表下载对应版本的 `.fish-plugin`，核对同版 `SHA256SUMS.txt` 后导入。
3. 安装后进入插件页确认运行状态；需要账号或订阅的插件，再进入对应页面完成配置。

| 插件 | GitHub 包 | npm 单包 |
| --- | --- | --- |
| 飞书 | [`feishu.fish-plugin`](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/download/v1.0.2/feishu.fish-plugin) | [`@fish-under-sea/fish-dock-plugin-feishu`](https://www.npmjs.com/package/@fish-under-sea/fish-dock-plugin-feishu/v/1.0.2) |
| Clash 1.3.0 | [`clash.fish-plugin`](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/download/v1.3.0/clash.fish-plugin) | [`@fish-under-sea/fish-dock-plugin-clash`](https://www.npmjs.com/package/@fish-under-sea/fish-dock-plugin-clash/v/1.3.0) |
| Magpie 1.1.1 | [`magpie.fish-plugin`](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/download/v1.1.1/magpie.fish-plugin) | [`@fish-under-sea/fish-dock-plugin-magpie`](https://www.npmjs.com/package/@fish-under-sea/fish-dock-plugin-magpie/v/1.1.0) |
| OFM（暂停维护） | [`ofm.fish-plugin`](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/download/v1.0.2/ofm.fish-plugin) | [`@fish-under-sea/fish-dock-plugin-ofm`](https://www.npmjs.com/package/@fish-under-sea/fish-dock-plugin-ofm/v/1.0.2) |

<h2 id="packages"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-install-dark.png"><img src="assets/readme/section-install-light.png" alt="PACKAGES · npm 单包" width="100%"></picture></h2>

每个 npm 包只包含一个对应的插件归档和下载 CLI，不运行安装后脚本，不修改 Dock 或系统设置。

```powershell
npm install @fish-under-sea/fish-dock-plugin-magpie@1.1.1
npx @fish-under-sea/fish-dock-plugin-magpie --out C:/work/plugins
```

四个包分别是 `@fish-under-sea/fish-dock-plugin-feishu`、`@fish-under-sea/fish-dock-plugin-clash`、`@fish-under-sea/fish-dock-plugin-magpie` 和 `@fish-under-sea/fish-dock-plugin-ofm`。

<h2 id="development"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-develop-dark.png"><img src="assets/readme/section-develop-light.png" alt="DEVELOP · 开发验证" width="100%"></picture></h2>

需要 Node.js 24 和相邻 Dock 仓的 SDK。开发暂存、正式插件包和 npm 单包使用不同输出目录。

```powershell
node tools/stage-development.mjs --out C:/work/preview-plugins --sdk ../FISH-Dock/sdk --ofm ../FISH-Dock/dsh-our-free-model --magpie C:/work/runtimes/magpie.exe --mihomo C:/work/runtimes/mihomo.exe
node tools/build-release.mjs --out C:/work/release-1.0.0 --sdk ../FISH-Dock/sdk --ofm ../FISH-Dock/dsh-our-free-model --magpie C:/work/runtimes/magpie.exe --mihomo C:/work/runtimes/mihomo.exe
node tools/build-npm-packages.mjs --dist C:/work/release-1.0.0/dist --out C:/work/npm-plugin-packages-1.0.0
node --test --test-isolation=none 'plugins/feishu/*.test.mjs' 'plugins/clash/*.test.mjs' 'plugins/magpie/*.test.mjs' 'plugins/ofm/*.test.mjs' 'plugins/relay-probe/*.test.mjs' 'shared/*.test.mjs' 'tools/*.test.mjs'
```

<h2 id="source"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-intro-dark.png"><img src="assets/readme/section-intro-light.png" alt="SOURCE · 来源许可" width="100%"></picture></h2>

本仓的插件适配层与发布工具采用 MIT。发行包同时包含第三方运行时：Clash 使用 GPL-3.0 许可的 mihomo，Magpie 使用其随包许可证，OFM 基于 [Our Free Model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 的 standalone 构建与渠道能力。因此“适配层 MIT”不等于“包含的全部二进制均为 MIT”，第三方许可以 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和各插件包内的 `licenses` 目录为准。

<p align="center"><sub>FISH Dock Official Plugins · Four independent packages · Host API 1</sub></p>
