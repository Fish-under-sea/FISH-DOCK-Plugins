# Purge in Magpie

把**本地 purge 目录**当成 magpie 的「自由插件与技能源」：清点、校验、分类、去重、回滚，
再按模式把选中的人设与技能写进经过 magpie 网关的 agent 请求。

它是 magpie 的**页面插件 + 网关钩子**单包，不是 FISH Dock 插件，不依赖任何宿主补丁。

## 致谢

- **[ZiChuanLan/agent-purge](https://github.com/ZiChuanLan/agent-purge)** — 作者 **ZiChuanLan**，MIT。
  本插件的四种 protocol 落点、`off`/`strict`/`replace`/`append` 模式语义、块结构保留、
  `stripIdentity` 去身份策略都来自它；`magpie-plugin/` 子目录是这条链的起点。没有它就没有这个包。
- **[yetone/magpie](https://github.com/yetone/magpie)** — 页面插件与异步网关钩子的宿主契约
  （`magpie.page` / `magpie.options` / `page/_magpie/bridge.js` / `onRequest(body, ctx)`）由 magpie 提供。
- **本机 `dsh-purge` 红队技能库** — 内置的 9 位专家由它的 23 份原子技能（`skills/redteam/`）提炼而来，
  逐条注明原文件；`DSH\purge` 会话导出包里的 Prompt Forge 人设也一并内化为 `personas/prompt-forge.md`。

完整来源与改动范围见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)；上游 MIT 原文原样保留在
[`LICENSE`](LICENSE) 里（Copyright (c) 2026 ZiChuanLan）。

## 内置专家技能包

装好就有，不用去别处找 md 再导入。`skills/` 里是 9 位专家，`personas/` 里是 1 份人设，随包分发、
随包更新；它们在页面里带「内置」标，可启用可停用，但删不掉（不是用户导入的）。

| 专家 | 管什么 | 原文来源 |
| --- | --- | --- |
| **交战指挥** `engagement-lead` | 开工前置、资源要齐、降级口径、按阶段调度其余八位 | `redteam-setup` |
| **侦察测绘专家** `recon-specialist` | 被动源 + FOFA 测绘 + ProjectDiscovery 流水线 → 资产全景 | `passive-recon`、`active-scan`、`web-fingerprint`、`asset-correlation`、`recon-pipeline`、`fofa-recon` |
| **入口猎手** `entry-hunter` | 目录爆破找后台/备份/泄露，浏览器自动化抓 SPA 与接口 | `dir-bruteforce`、`browser-automation`、`kimi-webbridge` |
| **漏洞打击专家** `vuln-striker` | nuclei 模板化检测：按指纹选模板、按回显判真伪 | `nuclei-scan` |
| **凭据攻坚专家** `credential-breaker` | 在线爆破（含锁号风险控制）与离线破解、字典策略 | `credential-attack` |
| **隧道工程专家** `tunnel-engineer` | suo5 / chisel / frp / 代理池的选型与落地 | `suo5-tunnel`、`chisel-tunnel`、`frp-tunnel`、`cn-proxy-pool` |
| **载荷投送专家** `payload-delivery` | 反弹 shell 选型、VPS 中转、加密 WebShell | `shell-handler`、`vps-reverse-shell`、`webshell-toolkit` |
| **内网横向专家** `intranet-pivot` | fscan / gogo / Impacket，低噪与发包可控 | `fscan-intranet`、`gogo-intranet`、`lateral-movement` |
| **成人提示词专家** `nsfw-prompt-smith` | 出图给参数头 + 标签栈 + 变体，出文给场景卡 + 节拍表（角色一律成年） | `nsfw-prompt-gen`（收窄为成年） |
| **Prompt Forge**（人设） | Danbooru 风格标签编译器，固定正向/负向/三档变体 | `DSH\purge` 会话导出包里的人设 |

用法：页面上挑一条，点「启用」，它就会按你的模式拼进 system（人设在前，技能按
`## 技能：<名字>` 分段）。内置人设**不会**被自动选中——不点名就注入工具，等于偷偷改你的 system。

提炼原则：不复制原文，按「一条作业线一位专家」重写——每位只留**判据、命令骨干、交接边界、纪律**四块，
把散在 23 份文件里的同名坑收成一处。

## 它解决什么

`agent-purge` 的 magpie 插件只认 `~/.agent-purge/` 的人设，页面也不能读盘。
本插件把这条链补成三件事：

1. **来源可以是任意目录**：默认 `~/.agent-purge` 与 `~/.magpie/purge`，也能在页面里改成多个目录；
2. **认得四种东西**：DSH 会话导出包（`dsh-session-archive`）、DSH cordis 插件包、
   人设 / 技能 markdown、裸文本与 JSON 清单——坏包给出具体拒绝原因，不半途落盘；
3. **页面能调配**：条目列表、检查器、模式、启用、版本回滚、校验记录、最近一次生效记录。

## 安装

```bash
# 从 npm
magpie plugin add @fish-under-sea/magpie-purge

# 或从本仓目录
magpie plugin add "/path/to/Purge in Magpie"
magpie plugin list
```

装好后 magpie 的侧栏会多出一页「破甲 · Purge」；插件页第一次打开时，后端会扫一遍来源目录，
写出 `state/catalog.json` 与 `page/catalog.js` 两份快照，页面读的是后者。

## 配置

设置写进 magpie 的 `plugins.json`（`magpie.options`），页面上改，别手改文件也行：

| 字段 | 作用 |
| --- | --- |
| `mode` | `off` / `strict` / `replace` / `append`；**留空 = 跟随 `agent-purge` 的 `state.json`**，两边都没有就是 off |
| `persona` | 用哪条人设的 id；留空取 `agent-purge` 的人设，再留空取第一个启用的人设 |
| `agents` | 只对这些 magpie agent 生效，如 `["claude","codex"]`；空数组 = 全部 |
| `enabled` | `{条目id: true/false}`：技能必须显式为 `true` 才注入；人设默认启用 |
| `pinned` | `{条目id: 摘要}`：固定到某一版，网关用那一版的正文 |
| `sources` | 来源目录列表；空数组用默认的两个 |
| `imports` | 页面写的导入请求（`{op, path, at}`），后端处理后复制进 `state/imports` |
| `inline` | 页面里直接贴进来的人设/技能正文，不进磁盘 |
| `gatewayTimeoutMs` | 钩子预算，默认 1500 ms（magpie 侧 100–10000） |

### 与 agent-purge 自己的设置怎么合并

本插件认 agent-purge 的原生语义（读 `AGENT_PURGE_HOME` 或 `~/.agent-purge/state.json`）：

```json
{ "default": { "mode": "replace" }, "persona": "anima",
  "overrides": { "codex": { "mode": "strict", "persona": "other" } },
  "disabledHarnesses": ["grok"] }
```

按三层取，先到先得：

| 层 | `mode` | `persona` |
| --- | --- | --- |
| 1 | 插件页选过的值 | 插件页选过的人设 |
| 2 | `state.json` 的 `override[agent].mode` → `default.mode` | `override[agent].persona` → `state.persona` |
| 3 | 兜底 `off` | 第一个启用的人设 |

**所以两件事同时成立**：在 agent-purge 里换人设，下一个请求立刻跟着换；在插件页点一下，也立刻生效，
不必去改 `state.json`。agent-purge 里 `disabledHarnesses` 含这个 agent、或 `default.mode` 是 `off` 时，
本插件一样不做——页面的状态条会写明「agent-purge 里关掉了这个 harness」。

指向的人设不在来源里时，**不会偷偷换成别人**：状态条直接说「指定的 X 不在当前来源里」。

模式语义与上游一致：

- `off`：不动请求；
- `strict`：整段可控 system 换成人设——**原 system 里的工具说明文本也会一起没了**；
- `replace`：人设放最前，宿主 system 里「自称 + 点名模型/厂商」的行删掉（近似）；
- `append`：人设放最前，宿主 system 原样保留。

## 页面怎么告诉你「到底注不注」

页面顶部那条状态就是答案，三种样子：

- **绿点**「下一次 agent 请求会注入「Anima」」+ 模式与人设的来源（本页设置 / agent-purge / 自动）；
- **红点**「现在不会注入：请求原样放行」+ 具体原因 + 一个能点的下一步（「用 replace 开始注入」/「去看人设」/「导入一份人设」）；
- 底部「最近一次生效」：真跑过就写人设、技能、字符数；被放行就写**为什么**放行。

导入的 `.zip` 是素材（会话导出包、DSH 插件包），**不会进 system**——检查器里会直说，别把素材当人设。

## 边界（照实说，不含糊）

- 只处理**经过 magpie 网关**的 agent 请求；客户端自己写死的行为、不经过网关的流量改不到。
- `strict` 只换可控的 system 文本；结构化工具定义不在网关这一层，改不动也不假装改动。
- 页面**不读磁盘**：所有扫描与读盘都在插件后端（`hooks.js`）里做，页面只显示快照。
- 不执行导入件里的任何脚本：DSH 插件包与导出包只被**判型与登记**，不当代码跑。
- 坏包（缺 manifest、路径带 `..`、超大文件）整个拒绝，同目录其它条目不受影响。

## 目录

```text
Purge in Magpie/
├── package.json           插件清单：magpie.hooks / magpie.page / magpie.options
├── hooks.js               网关钩子：清点 + 改写（Bun 侧，能读盘）
├── skills/                9 位内置专家（随包分发，一位专家一个 .md）
├── personas/              内置人设（Prompt Forge，内化自 DSH\purge 的导出会话）
├── lib/
│   ├── zip.mjs            极简 ZIP 只读解析（store + deflate，拦路径越界）
│   ├── inventory.mjs      判型、校验、摘要、去重与版本
│   ├── rewrite.mjs        四种 protocol × 四种模式的 system 改写
│   ├── agentpurge.mjs     读 agent-purge 的 state.json（原生语义）
│   ├── plan.mjs           三层优先级：这次注不注、注谁、为什么没注
│   ├── bundled.mjs        读包内 skills/ 与 personas/，标 builtin
│   └── state.mjs          快照落盘（state/catalog.json + page/catalog.js）
├── page/                  插件页：index.html / app.js / style.css / icon.*
├── preview/               本地预览：mock 宿主 + 演示快照 + 单文件 purge-preview.html
├── tools/
│   ├── scan.mjs           离线清点（预览与真机同一条路径）
│   └── build-preview.mjs  把整页压成单文件 HTML（双击就能看）
└── tests/                 node --test：判型、校验、改写、选人、快照、内置包
```

## 预览整个界面

两种，看你要给谁看。

**① 单文件，双击就开**（给人看界面时用这个）：

```bash
node tools/build-preview.mjs      # → preview/purge-preview.html
```

生成物是**一个 HTML 文件**，CSS、JS、mock 桥、演示快照全部内联，没有任何外部依赖——
双击直接打开，不用起服务、不用开端口。顶部有主题与状态两个开关：

| 参数 | 作用 |
| --- | --- |
| `#theme=dark` / `#theme=light` | 深色 / 浅色 |
| `#snap=ready` / `#snap=blocked` | 就绪那一屏 / 什么都没就绪那一屏 |
| `#row=0` | 直接打开第几条的详情（0 起） |

例：`preview/purge-preview.html#theme=light&snap=blocked`

**② 起服务，看真实文件**（改完 `page/` 后自查用这个）：

```bash
node preview/serve.mjs --demo     # http://127.0.0.1:55133
```

用 mock 宿主把真实的 `page/index.html` 放进一个帧里，主题跟随 magpie 的变量名：
`?theme=dark`（默认）/ `?theme=light`。
默认**不预选任何条目**——右栏默认显示「注入组装」，那是最该看的一屏；
要检查详情用 `?row=0` 指定第几条（0 起）。
不带 `--demo` 时读的是真机生成的 `page/catalog.js`；`--demo=blocked` 是「什么都没就绪」那一屏。

单文件是**派生文件**：改完 `page/` 要重新跑一次 `build-preview`，别手改它。
`npm run prepack` 会顺手重建，所以发布包里那份总是最新的。

## 页面怎么排的

一屏三段，按「先看结论、再动手、最后翻细节」：

1. **顶部一行状态条**：绿点 / 红点 + 「这次注不注、注谁」+ 一个能点的下一步，最该被看见的放最上面；
2. **左列表 / 右组装**：左边按「内置专家」与「我的来源」分组；右栏平时显示**注入组装**——
   把这次会拼成的 system 摊成按顺序的积木（人设 → 技能 → 宿主原文），选中条目时切成详情；
3. **底部四块折叠**：导入与来源 / 校验记录 / 最近一次生效 / 边界。平时只占一行，
   不把「声明」和「导入表单」顶在首屏。

样式只吃 magpie 的主题变量（`--magpie-*`），跟随宿主明暗；语义色只留三类
（人设 / 技能 / 素材），其余交给墨色与分隔线。

## 开发

```bash
# 测试（68 个用例：判型/校验/改写/选人/快照/钩子端到端/options 回读/agent-purge 语义/注入判定/控制面过滤/内置专家包）
node --test --test-isolation=none "tests/*.test.mjs"

# 离线清点，看看本机 purge 目录里都认得什么
node tools/scan.mjs --sources "D:\purge" --sources "~/.agent-purge"

# 只打条目表到 stdout（不写文件）
node tools/scan.mjs --json
```

> `npm test` 用 `--test-isolation=none`：Windows 沙箱下 `node --test` 默认要开子进程管道，
> 会被拦成 `spawn EPERM`。

## 与上游的差别

| 项 | agent-purge 的 `magpie-plugin/` | 本插件 |
| --- | --- | --- |
| 来源 | 只读 `~/.agent-purge/` | 可配多个目录 + `state/imports` + 内置专家包 |
| 判型 | 只有人设 markdown | 导出包 / DSH 插件包 / 人设 / 技能 / 文本 / 清单 |
| 注入 | 一个人设 | 人设 + 显式启用的技能（含 9 位内置专家） |
| 页面 | 人设选择 + 导入 | 条目列表 + 检查器 + 模式 + 回滚 + 校验记录 |
| 快照 | 生成脚本写 `personas.js` | 后端每次扫描写 `catalog.js`，页面不读盘 |
| 版本 | 无 | 同 id 新摘要算新版本，留两版可回滚 |
| 与 agent-purge 的关系 | 读 `state.json` 但页面改不了模式 | **认它的 state.json**（mode/persona/overrides/disabledHarnesses），同时页面设置优先，两边都能改 |
| 状态可见性 | 无 | 顶部状态条直接回答「注不注、注谁、为什么没注」 |

## 版本

| 版本 | 要点 |
| --- | --- |
| `0.3.0` | 内置 9 位专家技能包（由本机 `dsh-purge` 的 23 份原子技能提炼）+ 内化 Prompt Forge 人设；内置条目带「内置」标、可停用不可删、不参与自动选中 |
| `0.2.0` | 认 agent-purge 的 `state.json`（原生语义）；页面加「当前注入」状态条与可点的下一步；导入素材后不再一头雾水 |
| `0.1.2` | README 版本表 |
| `0.1.1` | 修掉「没流量时插件页是空的」：钩子模块加载时先从 `plugins.json` 读回自己的 options 再预热扫描 |
| `0.1.0` | 首个版本 |

## 许可

MIT。上游 agent-purge 的 MIT 文本与版权行原样保留在 [`LICENSE`](LICENSE) 与
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 里。