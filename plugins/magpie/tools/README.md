# 自编译 magpie：构建与上游同步

插件包里的 `service/magpie.exe` 由本目录的脚本编译：**基线 tag 由 `follow-upstream.ps1` 现场解析**（上游是 24h loop，写死必然过期），再加上 `patches/` 里序号最大的那份补丁。当前补丁链：**`fish.47`**（插件 `2.4.7`，基线 **`v0.1.4344`**：在 `fish.46` 之上补全 `.rt`、`.lib-card`、`.msk-*`、`.pr-*`、`.pu-*` 等外圈卡片与内层液态玻璃规则，清除 `.rt-hub` 4px 黑环及路由组/请求列表等黑块选中悬浮态、统一全站按钮玻璃样式，在 `appearance.go` / `app.js` / `appearance.js` / `app.css` 补全 `--ctl-fg`、暗色字体权重与全局 `::placeholder` 调色命中，并加入紫色晶石 `icons/obsidian-color.svg`；`fish.46` 为追平上游 `v0.1.4344` 并合入 Obsidian 记忆 Agent 单一入口、`.lib-memrun` 常驻全汉化与启停开关、修复 `menuButton` 二次点击关闭、重写记忆提示词与 `Sandbox.Write`、`#000000` 玻璃 `0%` 全透明与 `.ag-obs-detail` 排版；`fish.41` 补上设置页「外观」页签的图标、撤回 2.4.3 里改坏的侧栏内滚、把壁纸遮罩改成 `--wall-veil` 变量并让外观表在滑块松手后重画（此前遮罩从未真正生效）、玻璃覆盖改由 `tools/glass-surfaces.mjs` 从 `app.css` 生成、字体颜色「清空」改「重置」、吸顶页头不再留深色唇边；`fish.40` 并入底图遮挡（`fishGlassVeil`）、字体颜色实时生效与记忆 Agent 面板中文化；`fish.39` 让壁纸遮罩随内容区不透明度自适应；`fish.38` 是插件 2.4.0 在 `fish.37` 之上并入 M-A3 派发接线、M-D 审计与冲突记录、M-E 的 magpie 侧 fish-vault 记忆 Agent 路由；`fish.37` 是记忆「Agent 化」的 M-A/M-B/M-C 并入 `fish.36` 外观；`fish.36` 是设置 › 外观独立分页、液态玻璃按区域调节并随主题下发给插件页、知识库链接改由适配层直接拉起、`fishvault` 链接空格改 `%20`；`fish.35` 是 2.3.8/2.3.9 的形态；`fish.34` 是插件 2.3.7；`fish.33` 是插件 2.3.6 在 v0.1.3596 上的形态；`fish.32` 是 2.3.6 修复版在 v0.1.3383 上的形态，`fish.31` 是 2.3.5）；旧补丁留在 `patches/` 备查：`fish.16`/`fish.15` 是 v0.1.2799 那条线（2.2.1/2.2.2 前半），`fish.13` 用于 2.1.9–2.2.0，`fish.12` 用于 2.1.8，2.1.4–2.1.7 是 `v0.1.2732` + `fish.9`–`fish.11`，2.1.3 及更早是 `v0.1.2336` + `fish.1`–`fish.8`。

## 2.4.0 / fish.37 + fish.38：记忆 Agent 化（内置，M-A 到 M-E）

两个补丁都打在 `fish.36` 的外观形态之上、同基线 v0.1.4262，按序号**链式**应用：`fish.37` 是 M-A/M-B/M-C（注册表、执行器、沙箱、`/api/memory/agents`），`fish.38` 叠上 M-A3（distill 模型下拉改 Agent、`status/run/stop`、定时派发）、M-D（`memory-audit.jsonl` 审计与 `<vault>/logs/memory-conflicts.md` 冲突记录）与 M-E 的 magpie 侧路由（`/api/fish-vault/memory/agents…`）。链式口径：干净 v0.1.4262 → `apply fish.37` → `apply fish.38`，结果与 `mem-dev` 树逐字节一致。

`fish.38` 增量 21 文件 / 44 hunk，主要是 `internal/memagent/audit.go`、`internal/memagent/tools.go`（记忆工具与审计/冲突接线）、`internal/gui/memory_distill.go`（models→agents 与派发）、新增 `internal/gui/memory_agents_run.go` 的 status/run/stop 与 fish-vault 共享 handler，以及插件页 `client.js` 的 Agent 下拉/管理面板/轮询。

**基线口径（重要）**：`fish.38`/`fish.37`/`fish.36` 同基线 **v0.1.4262**。出 `fish.38` 时的落后闸门结论是「差 70 个 tag」（11-15 16:12 抓的基线，11-17 00:xx 再看上游已到 `v0.1.4332`），因此构建按 `-SkipFreshness` 出包，理由是 2.4.0 的 Release 内容与这两个补丁的语义都锁定在这条基线上；**追平上游是另一次「上游升级」动作**（见下文那节的 1–6 步），不在本次发版里。

**夹具里不要写形似真实密钥的字面量**：`fish.38` 首版把一条 OpenAI 形状的密钥字符串（`sk-` 开头、48 字符）写进了 `internal/memagent/audit_conflict_test.go` 的脱敏用例（本机配置里并无对应凭据，是编的），GitHub secret scanning 仍按公开仓库里的密钥告警。补丁会把这类字面量带进仓库，扫描器无法分辨真假。脱敏、鉴权这类用例请**运行时拼接**（例如前缀与正文分成几段用 `+` 连起来），效果一样而源码里不留密钥形状的字面量。

局部验收（`fish.38` 链式重放后实测）：`go build ./...` 通过；资产 `node --check` 无错；`check-assets-refs.mjs` 悬空引用闸门 OK；`go test ./internal/memagent ./internal/memory -count=1` 全绿（memagent 含 M-D 的 13 个审计/冲突用例）；`go test ./internal/gui -run 'Memory|Distill|Dream|FishVault'` 全绿；Obsidian 插件 `rules.test.cjs` + `prune.test.cjs` 14 条全通过。`internal/gui -run TestPluginPage` 的 19 条失败在**纯净上游 v0.1.4262**、重放补丁后的树上名单与条数完全一致，属本机沙箱（要真实子进程与插件宿主）环境问题，不是本次引入。

`fish.37` 那一层（M-A/M-B/M-C）的能力细节：

- `internal/memagent`：`memory-agents.json` 的原子读写（lastgood + filelock + 校验，坏文件不读成空）、`memory-curator`（learn|organize）与 `dreamer`（dream）两个内置预设及 `Restore`、按角色派发（`Dispatch`，用 Agent 自己的 model/effort，角色不符即拒绝）、工具循环（记忆四工具 + vault 白名单三工具 + scratch 两工具 + Agent `mcp.json` 里的 MCP）与步数/时间上限、结果与进度落 `memory-agent-runs.json`。
- 沙箱与缓存：`os.OpenRoot` 限定 vault，读 `wiki/ inspirations/ memories/`、写 `inspirations/ _digests/ candidates/ dreams/ logs/`，拒绝对路径、`..`、符号链接与 junction；scratch 每 run 一目录、结束即删，超 20MB 按最旧整目录回收到 ≤20MB，且只对 `cache/memory-agent/work` 生效。
- GUI：`/api/memory/agents`（GET 列表/按 `role=` 过滤 + POST 新增/update/remove/default/restore），启动时 `memagent.Ensure()` 首次写出两个预设。
- 子系统说明在源码树 `docs/subsystems/memagent.md` 与 `docs/subsystems/memory.md`（「Memory agents」一节）；设计定稿见本仓 [记忆 Agent 化设计](../../../docs/specs/2026-11-16-magpie-memory-agent-design.md)。

**基线口径（一以贯之）**：`fish.37` 与 `fish.36` 同基线 **v0.1.4262**（落后闸门当时是 69 tag、上游 v0.1.4331），构建同样按 `-SkipFreshness` 出包；`fish.38` 沿用这条基线与同样的处理。

局部验收（`fish.37` 合并时实测）：`go build ./...` 通过；`go vet ./internal/gui ./internal/settings ./internal/settingsapi ./internal/fishvault ./internal/memagent` 无输出；`go test ./internal/memagent ./internal/memory ./internal/settingsapi ./internal/fishvault -count=1` 全绿（memagent 142 通过 / 1 跳过）；`go test ./internal/gui -run 'TestMemoryAgent|TestFishGlass|TestAccent|TestWallpaper|TestLook'` 全绿；`node --test internal/gui/tests/fish-glass.test.cjs` 5/5。

## 2.3.7：共享知识库与 Obsidian

`fish.34` 将完整 Fish 补丁移植到固定上游 `v0.1.4262`，并新增插件内独立库 `data/knowledge/github-capability-vault/`。短记忆放 `memories/`，沿用原生锁、journal、手改保护和 digest；长知识笔记递归只读检索，MCP 与 Obsidian 共用同一份文件。专用桌面插件通过独立回环端口和库外配对令牌接入，不需要 Copilot，不写入供应商密钥。

首次准备会校验复制旧知识内容；已建立的新库不会再次被旧源覆盖，旧源不会被删除。Obsidian 的社区插件安全开关由用户在应用内确认，必要时重载/重启 Obsidian 后打开新库。

本轮媒体设置移到按需加载的 `fishmedia.js`，没有提高上游核心脚本预算。新上游与 Fish 测试辅助函数重名已合并；流验收保留两次独立保活、只发一次上游请求的断言。

复用已安装工具链和工作区缓存可向构建脚本传 `-GoRoot <Go安装根> -CacheRoot <缓存根>`；不传时保留原 `toolchain/go` 布局。

## 为什么要自己编

插件页面跑在 CSP `connect-src 'none'` 的沙箱帧里，一条 fetch 都发不出去。上游的页面桥只有读（`magpie.read`）与页面选项，没有调用通道，所以：

- 签到页的「关 / 开」「立即签到」点了发不出请求；
- 中转站探针需要 magpie 本体代为出站。

补丁补了继续读：页面调用通道（`magpie.call` → `POST /api/plugin-pages/call`，按 `package.json` 的 `magpie.calls` 白名单分派）与 `internal/relay` 的探测实现。CSP 一行未改。

**2.1.4（`fish.9`，基线换到上游 `v0.1.2732`）**：讯飞的 400 口径整段撤销——`loomyCheckinCredit = 400` 与读取侧改写全部删除，`plugin_checkin.go` 回到与上游逐字节相同，插件不报积分时页面显示「未告知」而不是编一个 400；签到视图补「数据截至 / 来源」与「能不能自动采集」字段；`brand:status` 带上「正在准备 N 个供应商插件」（Node 侧 `preinstall-state.json` 落盘接线）；品牌图标算名与 `StoreIcon` 同源，`pruneIcons` 持同一把锁，修掉「冷启时品牌图标被当没人用清掉」的抖动。`fish.4→fish.6` 的 400 口径段不再存在于新补丁里。

`fish.4`→`fish.6`（仅 2.1.3 及更早的补丁链）补过一条厂商口径：**讯飞（Loom / Loomy）每个账号都签，每号一次按 400 积分记**。**2.1.4 起这条已废弃**——`fish.9` 删除了 400 补偿与读取侧改写，页面读不到真实积分就说「未告知」，不再编 400。判定用 provider id 前缀 `loomy`，`loomy` 与 `loomy-plugin` 两种写法都认——这一条沿用。

`fish.7` 接管了**预装插件的图标**：插件页、供应商页、侧边栏、路由与用量卡片上，只要是预装插件注册的 provider，画面里用的都是我们这套素材（`internal/provider/brandicons/`），插件市场给的名字、插件自带的 `data:` URI 都不再决定画面。素材清单跟着预装基线走（2.1.4 为 22 份，覆盖 13 个插件注册的 22 个 provider id——含已移出预装但素材保留的 `opencode-zen-free` 与新增的 `meoo-agent`）。三条约束：

- **素材编在 exe 里，不进插件包**。社区插件一更新，`magpie.icon` 就回到原样——那正是「用户更新完全掉」的成因，所以这层不能挂在插件包上。
- **开关只是一个标记文件** `<data>/icons/brand/on`（`provider.SetBrand`），删掉立刻回到原版，不删用户任何数据；页面那两颗按钮是 `brand:status` / `brand:set`（`internal/gui/pluginpagecall.go`）。`pruneIcons` 会把已落盘的品牌图标当成「有人用」而留下。
- **一份素材一个文件，深浅自带**：`<provider id>.svg` 里 `.l` / `.d` 两组用 `@media (prefers-color-scheme: dark)` 切换。窗口本来就跟着系统配色走（`app.js` 问的是同一个媒体查询），所以服务端不必猜主题。**实测过**（Chromium 156 headless + CDP `Emulation.setEmulatedMedia`）：`<img src=x.svg>` 里的媒体查询生效，SVG 里的 `<image href="data:image/png;base64,…">` 也渲染得出——位图两套因此也能塞进同一个文件。

`fish.8`（2.1.3 及更早的补丁链）补上这一层漏掉的两个地方，并把图标画大：

- **「扩展 → 插件 → 已安装」也认这套素材**。它读的是包自己的 `magpie.icon`（`plugin.InstalledIcon`），与上一版接管的四处不是同一条路。列表里一行说的是「包」，一个包可能注册好几家（`trae-cn` 与 `trae-global`），取其中第一个命中素材的（`brandIconsBySpec`）。
- **包内的相对路径图也读得出来**。`magpie.icon` 写成 `page/icon.png` 时 `InstalledIcon` 不认——它只收 `https://` 与 `data:` 这两种页面自己加载得了的形式。`LocalIcon`（`internal/gui/plugin_icon_local.go`）在窗口这边读文件、按内容存成 `file:` 值再画，于是「自动签到 / 中转站探针」不再是灰书页。越界路径（`../`）与绝对路径一律不读。
- **图标画大**：列表行 18 → 23px、卡片 20 → 24px、大头图 25 → 30px（`assets/plugins.css`）。缩到 18px 的插画认不出是什么。
- **两个页面插件的图标各归各位**：2.0.5 把品牌立绘塞进了 `magpie.page.icon`（那是侧边栏的），这一版挪回 `magpie.icon`（包级，只出现在插件列表），`magpie.page.icon` 恢复各自的 `page/icon.svg`。

素材是拿签到页那批已定稿的图合成的，合的是**根 `<svg>` 上的绘图属性也一起搬**（`fill="currentColor"`、`fill="#CF0A2C"` 这类）。只搬 innerHTML 而不搬根属性，图标会一律变黑——`currentColor` 在 `<img>` 里没有父级可继承，本来恒等于黑，浅色组还要把它落成 `#111111`。

**2.1.7（`fish.11`）让出了 NearToken 的供应商**（issue #22）：`@fish-under-sea/magpie-neartoken` 从 0.1.7 起自己就是 provider 插件（`auth` 设备授权 / `provider.models` / `auth.usage` / `auth.icon`），provider id 仍是 `neartoken`。宿主侧那条 key+URL 供应商还挂在同一个 id 上，就成了盖住插件的那一条——模型表是旧的、卡片是灰立方体、「重新获取模型」还去问站点 `/v1/models`（按令牌分组过滤，很多账号回空）。`internal/neartoken/handoff.go` 的处理：

- 插件在场（`plugin.Listed()` 里有 id 为 `neartoken` 的 provider）时，宿主不再 `provider.Save`、也不再 `catalog.SaveLive`；
- 登录拿到的令牌交给插件自己的 auth（`plugin.Import`，形状 `type/access/refresh`），页面那八条 `neartoken:*` 改从 `plugin.Auths` 读令牌；
- 老用户升级时把 `providers.json` 里那条的钥匙搬进插件 auth，搬成功才删那一条；搬不动就留着，钥匙不丢；
- 断开时撤令牌 + `plugin.SignOut` + 删宿主侧那条与它的模型表；
- 插件不在场时走老路（一条 key+URL 供应商），页面照旧能用。

判定与迁移都在 `internal/neartoken/handoff.go`，单测在 `handoff_test.go`（5 条，盯住「钥匙归插件」「宿主侧那条会被让出」「插件不在场时保持原样」「断开两处都不留」）。

**2.1.8（`fish.12`）追上游到 `v0.1.2799`，并补 NearToken 的分组墙契约**：

- 基线 `v0.1.2732` → `v0.1.2799`。`git apply -3` 只剩一处冲突：`internal/gui/core_budget_test.go` 的预算常量。按上游注释的规矩取实测值 **1,534,429**（上游 cap 1,533,802，多出的 627 字节是我们补丁加进核心脚本的 `plugins.js` + `pluginpages.js`），写明为什么上调，不留余量。
- `neartoken:state` 多回 `groupList`：站点 `/api/pricing` 的 `enable_groups` 原文（含 emoji，不翻译）+ `group_ratio` 倍率 + 这一组能聊的模型数 + `group_refs` 的 `ref`，顺序按分组首次出现；没读过目录时是**空数组**而不是 `null`。
- `neartoken:state` 的 `tokenName`：自己连的时候用站点回的名字（`keepWithPlugin` 现在把它一起写进插件 auth），之后从插件凭据里读。
- 页面按 `disabledGroups` 走 `magpie.options.set`，插件自己的 `provider.models` 过滤——这一半不需要宿主改动。

**2.1.9（`fish.13`）#24：供应商页原生区分四类模型**：

- `catalog.Model` 增加 `Audio`（TTS / 转写）与 `Embedding`（embedding / rerank）；站点列表 `kind` 是 `audio`/`speech`/`tts`/`transcription`、`embedding`/`rerank` 的各自归位，只给模态不给 `kind` 的按输出模态认。
- `catalog.Chat()` 四类都不算「能聊的」；供应商列表与 Agent 的模型列表只留对话模型（`providerInfoWith` 里统一过滤）。
- 插件侧 `capabilities.output` 的 `image`/`video`/`audio`/`embedding` 在 `pluginCatalog` 直接映射到 `Draws`/`Films`/`Audio`/`Embedding`，插件不用再改。
- 供应商编辑页：原「图像模型」一块扩成**图像 / 视频 / 语音 / 向量四块**（`renderModelKinds`），各自一份取消勾选集合（`hiddenFilms`/`hiddenAudios`/`hiddenEmbeddings`）随保存进 `providers.json`。
- 核心脚本预算随实测上调到 **1,535,469**（`app.js` +1,040 字节），理由写在常量注释里。
- **没做**：`设置 → 图像` 那种模型选择入口（视频/语音/向量各一个）与 `/v1/models` 的 `kind` 补值。

## 构建

**基线不写死**：上游是 24h loop（忙时一小时好几个 tag），所以 tag 一律由
`follow-upstream.ps1` 现场解析，仓库里不留「当前基线是 vX」这种常量。

```powershell
# 1) 跟随上游：解析最新 tag → 取源码 → 重放补丁 → 出冲突清单
#    默认只诊断（有冲突就留 .rej、退出码 2），基线记录写 patches/upstream.json
pwsh -File tools\follow-upstream.ps1
#    指定 tag / 指定补丁（临时覆盖用）：
pwsh -File tools\follow-upstream.ps1 -Tag v0.1.3136
pwsh -File tools\follow-upstream.ps1 -Patch patches\magpie-v0.1.2799+fish.16.patch

# 2) 编（本机没有 make，手跑 release-windows 的两段式）
#    -VersionTag / -FileVersion 留空就从**最新补丁的文件名**推导
#    （magpie-v0.1.2799+fish.16.patch → v0.1.2799+fish.16 / 0.1.2799.16），不用手抄；
#    不读 patches/upstream.json——那份是「目标基线」的诊断记录，可能还没追平。
#    -WinresJson 必须指向补丁带进 upstream 的那份：go-winres 按 json 所在目录
#    解析图标路径，指向别处会报 "open ...\icon-256.png: cannot find the file"。
pwsh -File tools\build-magpie.ps1 `
  -UpstreamRoot <构建根>\magpie-<tag> `
  -ProductName 'magpie fish' `
  -WinresJson <构建根>\magpie-<tag>\build\windows\fish-winres.json `
  -Out dist\magpie-windows-amd64.exe
```

产物是 `dist\magpie-windows-amd64.exe`。成品放到 `plugins/magpie/.tools/dist/`，构建插件包时用 `--magpie` 指过去：

```powershell
node tools/stage-development.mjs --out <临时目录> --sdk <Dock SDK> --magpie <上面那个 exe>
```

`stage-development.mjs` 会把它复制成 `service/magpie.exe` 并把 sha256 写进 `plugin.json` 的 `files`，所以 `service/` 与 `.tools/` 都在 `.gitignore` 里——**二进制不进仓库**，靠脚本与补丁复现。

## 版本标识

| 位置 | 值 |
|---|---|
| `magpie version` | `magpie <基线 tag>+fish.<n>`（例：`v0.1.2799+fish.16`） |
| FileVersion | `<基线去掉 v 的前三段>.<n>`（例：`0.1.2799.16`，四段数字，Windows 资源要求） |
| ProductName | `magpie fish` |
| FileDescription | `magpie fish (FISH Dock build)` |
| manifest identity | `ai.usemagpie.magpie.fish` |

这样用户装的是官方版还是我们的构建，一眼能分。

## 上游升级

1. `git -C upstream fetch --depth=1 origin tag <新 tag>` + `worktree add <新目录> <新 tag>`；
2. `git apply -3 patches\...` —— `-3` 比 `--check` 有用：能三点合并的部分自己合掉，只剩真冲突；
3. 冲突点（1709 → 2336 → 2732 两轮实测，大概率还是这几处）：
   - `internal/gui/pagebridge.js`：`read:` 那一行后面补 `call:`，注释按新文件的行文重排；
   - `internal/gui/pluginpage.go`：`pluginPage` / `pluginPanel` 结构体加了新字段（`Icon`、`Replaces`、`hosted`、`options`、`service`），把 `Calls []string` 并进去而不是覆盖整块；`pluginPageRoutes` 的签名新带 `web bool`，补丁里的 `pluginCallRoutes(mux)` 要接在它后面；
   - `internal/gui/core_budget_test.go`：预算常量一定冲突——**以上游的数为准**，因为补丁只多几字节，跑 `go test ./internal/gui/ -run TestCoreScriptBudget` 看是否仍在上游预算内，超了再按上游注释的规矩上调并写明原因；
4. **重放后必须跑悬空引用闸门**：`node tools\check-assets-refs.mjs <源码树> <新补丁>`。它只看一件事——补丁删掉了某个顶格声明、文件里却还在引用它，就是漏搬了配套 hunk。`git apply` 干净、`node --check` 通过、hunk 数与树哈希都对，也拦不住这一类（2.3.5 的 `foldNeeded is not defined` 就这么漏过去的）。`follow-upstream.ps1` 与 `build-magpie.ps1` 都已接上，任一不过都不出包；
5. 编出新 exe，跑 `go test ./internal/relay/ ./internal/plugin/ ./internal/gui/ ./internal/provider/ -skip TestRestartSwitchedCodexAppReal -count=1`（那条 Real 用例要真实的 Codex app 与可用的 `ps`，本机与干净上游一样 panic，与环境无关）；
6. 导出新补丁：`git -C <新目录> add -A && git -C <新目录> diff HEAD --binary > patches/magpie-<新tag>+fish.<n>.patch`，旧补丁留在目录里备查。

**跟进节奏**：上游每个大版本跟一次，中间我们自己只发插件补丁包，不为小改动重编。

## 本机已知坑

- **Schannel 坏**：curl / `Invoke-WebRequest` / winget 对任何 HTTPS 都返回 `000`（`SEC_E_NO_CREDENTIALS 0x8009030E`）。下载一律用 Python 的 urllib 或 git。
- **没有 make**：`make release-windows` 跑不了，`build-magpie.ps1` 里是等价的两条 `go build`。
- **`node --test` 在受限沙箱里不可用**（spawn EPERM，禁管道 stdio）；页面测试直接 `node <file>` 跑。
- **`internal/gui` / `internal/plugin` 有一批用例在本机恒失败**：`symlink ... A required privilege is not held`（要 SeCreateSymbolicLinkPrivilege）、`sh.exe ... couldn't create signal pipe`、并发 `rename ... Access is denied`。**这些在未打补丁的干净上游上失败集一模一样**，不要当成补丁的回归；判断方法是拿同一套 `go test` 在干净 tag 上跑一遍对比。
- Windows 打包是 `CGO_ENABLED=0`，MSVC 用不上；`wails` 的 webview 走系统 WebView2。

## 液态玻璃覆盖清单（glass-surfaces.mjs）

`fish-glass.css` 末尾 `gen:glass-surfaces` 两行标记之间的内容由 `glass-surfaces.mjs` 生成，不要手改：

```powershell
node plugins/magpie/tools/glass-surfaces.mjs <上游源码根>          # 只看命中面与统计
node plugins/magpie/tools/glass-surfaces.mjs <上游源码根> --write  # 写入 fish-glass.css
```

它扫描上游 `internal/gui/assets/app.css`，挑出所有「`background` 用实色令牌（`--card` / `--card-2` / `--layer-*`）铺底」的规则，换成本区域的玻璃变量，并排除交互态、表单控件、对话与编辑器正文。只改 `background-color`，不动任何布局属性——玻璃化不该改变版式。上游 `app.css` 大改后重跑一次即可覆盖新增的块。