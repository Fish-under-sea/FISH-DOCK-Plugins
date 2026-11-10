# 自编译 magpie：构建与上游同步

插件包里的 `service/magpie.exe` 由本目录的脚本编译：**基线 tag 由 `follow-upstream.ps1` 现场解析**（上游是 24h loop，写死必然过期），再加上 `patches/` 里序号最大的那份补丁。当前补丁链：**`fish.33`**（插件 2.3.6，基线 **v0.1.3596**；`fish.32` 是 2.3.6 修复版在 v0.1.3383 上的形态，`fish.31` 是 2.3.5）；旧补丁留在 `patches/` 备查：`fish.16`/`fish.15` 是 v0.1.2799 那条线（2.2.1/2.2.2 前半），`fish.13` 用于 2.1.9–2.2.0，`fish.12` 用于 2.1.8，2.1.4–2.1.7 是 `v0.1.2732` + `fish.9`–`fish.11`，2.1.3 及更早是 `v0.1.2336` + `fish.1`–`fish.8`。

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