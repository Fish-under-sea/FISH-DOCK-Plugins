# 自编译 magpie：构建与上游同步

插件包里的 `service/magpie.exe` 由本目录的脚本编译，基线是上游 `v0.1.2336`，加上 `patches/magpie-v0.1.2336+fish.8.patch`。

## 为什么要自己编

插件页面跑在 CSP `connect-src 'none'` 的沙箱帧里，一条 fetch 都发不出去。上游的页面桥只有读（`magpie.read`）与页面选项，没有调用通道，所以：

- 签到页的「关 / 开」「立即签到」点了发不出请求；
- 中转站探针需要 magpie 本体代为出站。

补丁补了继续读：页面调用通道（`magpie.call` → `POST /api/plugin-pages/call`，按 `package.json` 的 `magpie.calls` 白名单分派）与 `internal/relay` 的探测实现。CSP 一行未改。

`fish.4`→`fish.6` 补了一条厂商口径：**讯飞（Loom / Loomy）每个账号都签，每号一次按 400 积分记**（`internal/provider/plugin_checkin.go` 的 `loomyCredit`，`internal/provider/checkin_view.go` 的读取侧同样补正）。**不要做成「只签一个号」**——账号列表与签到都必须全量，用户登了几个就列几个、签几个（`fish.4`/`fish.5` 期间一度把账号裁成一个，页面上就只剩「1 个账号」）；插件不报积分时页面会一直显示「0 今日」，所以没报就按 400 记，插件自己报了就用它报的。判定用 provider id 前缀 `loomy`，`loomy` 与 `loomy-plugin` 两种写法都认。

`fish.7` 接管了**预装插件的图标**：插件页、供应商页、侧边栏、路由与用量卡片上，只要是预装插件注册的 provider，画面里用的都是我们这套素材（`internal/provider/brandicons/`），插件市场给的名字、插件自带的 `data:` URI 都不再决定画面。三条约束：

- **素材编在 exe 里，不进插件包**。社区插件一更新，`magpie.icon` 就回到原样——那正是「用户更新完全掉」的成因，所以这层不能挂在插件包上。
- **开关只是一个标记文件** `<data>/icons/brand/on`（`provider.SetBrand`），删掉立刻回到原版，不删用户任何数据；页面那两颗按钮是 `brand:status` / `brand:set`（`internal/gui/pluginpagecall.go`）。`pruneIcons` 会把已落盘的品牌图标当成「有人用」而留下。
- **一份素材一个文件，深浅自带**：`<provider id>.svg` 里 `.l` / `.d` 两组用 `@media (prefers-color-scheme: dark)` 切换。窗口本来就跟着系统配色走（`app.js` 问的是同一个媒体查询），所以服务端不必猜主题。**实测过**（Chromium 156 headless + CDP `Emulation.setEmulatedMedia`）：`<img src=x.svg>` 里的媒体查询生效，SVG 里的 `<image href="data:image/png;base64,…">` 也渲染得出——位图两套因此也能塞进同一个文件。

`fish.8` 补上这一层漏掉的两个地方，并把图标画大：

- **「扩展 → 插件 → 已安装」也认这套素材**。它读的是包自己的 `magpie.icon`（`plugin.InstalledIcon`），与上一版接管的四处不是同一条路。列表里一行说的是「包」，一个包可能注册好几家（`trae-cn` 与 `trae-global`），取其中第一个命中素材的（`brandIconsBySpec`）。
- **包内的相对路径图也读得出来**。`magpie.icon` 写成 `page/icon.png` 时 `InstalledIcon` 不认——它只收 `https://` 与 `data:` 这两种页面自己加载得了的形式。`LocalIcon`（`internal/gui/plugin_icon_local.go`）在窗口这边读文件、按内容存成 `file:` 值再画，于是「自动签到 / 中转站探针」不再是灰书页。越界路径（`../`）与绝对路径一律不读。
- **图标画大**：列表行 18 → 23px、卡片 20 → 24px、大头图 25 → 30px（`assets/plugins.css`）。缩到 18px 的插画认不出是什么。
- **两个页面插件的图标各归各位**：2.0.5 把品牌立绘塞进了 `magpie.page.icon`（那是侧边栏的），这一版挪回 `magpie.icon`（包级，只出现在插件列表），`magpie.page.icon` 恢复各自的 `page/icon.svg`。

素材是拿签到页那批已定稿的图合成的，合的是**根 `<svg>` 上的绘图属性也一起搬**（`fill="currentColor"`、`fill="#CF0A2C"` 这类）。只搬 innerHTML 而不搬根属性，图标会一律变黑——`currentColor` 在 `<img>` 里没有父级可继承，本来恒等于黑，浅色组还要把它落成 `#111111`。

## 构建

```powershell
# 1) Go 1.26.8（winget 在本机是坏的，走 zip；不要用 curl/IWR，Schannel 坏）
python tools\download-go.py

# 2) 取上游基线（用独立 worktree，别搅动已打补丁的那棵树）
git clone --filter=blob:none --no-checkout https://github.com/yetone/magpie.git upstream
git -C upstream fetch --depth=1 origin tag v0.1.2336
git -C upstream worktree add ..\upstream-2336 v0.1.2336
git -C ..\upstream-2336 apply --check patches\magpie-v0.1.2336+fish.7.patch
git -C ..\upstream-2336 apply patches\magpie-v0.1.2336+fish.7.patch

# 3) 编（本机没有 make，手跑 release-windows 的两段式）
#    -WinresJson 必须指向补丁带进 upstream 的那份：go-winres 按 json 所在目录
#    解析图标路径，指向别处会报 "open ...\icon-256.png: cannot find the file"。
pwsh -File tools\build-magpie.ps1 `
  -UpstreamRoot ..\upstream-2336 `
  -VersionTag 'v0.1.2336+fish.8' -FileVersion '0.1.2336.8' -ProductName 'magpie fish' `
  -WinresJson ..\upstream-2336\build\windows\fish-winres.json `
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
| `magpie version` | `magpie v0.1.2336+fish.8` |
| FileVersion | `0.1.2336.8`（四段数字，Windows 资源要求） |
| ProductName | `magpie fish` |
| FileDescription | `magpie fish (FISH Dock build)` |
| manifest identity | `ai.usemagpie.magpie.fish` |

这样用户装的是官方版还是我们的构建，一眼能分。

## 上游升级

1. `git -C upstream fetch --depth=1 origin tag <新 tag>` + `worktree add <新目录> <新 tag>`；
2. `git apply -3 patches\...` —— `-3` 比 `--check` 有用：能三点合并的部分自己合掉，只剩真冲突；
3. 冲突点（1709 → 2336 的实测记录，下次大概率还是这几处）：
   - `internal/gui/pagebridge.js`：`read:` 那一行后面补 `call:`，注释按新文件的行文重排；
   - `internal/gui/pluginpage.go`：`pluginPage` / `pluginPanel` 结构体加了新字段（`Icon`、`Replaces`、`hosted`、`options`、`service`），把 `Calls []string` 并进去而不是覆盖整块；`pluginPageRoutes` 的签名新带 `web bool`，补丁里的 `pluginCallRoutes(mux)` 要接在它后面；
   - `internal/gui/core_budget_test.go`：预算常量一定冲突——**以上游的数为准**，因为补丁只多几字节，跑 `go test ./internal/gui/ -run TestCoreScriptBudget` 看是否仍在上游预算内，超了再按上游注释的规矩上调并写明原因；
4. 编出新 exe，跑 `go test ./internal/relay/ ./internal/plugin/ ./internal/gui/ ./internal/provider/ -skip TestRestartSwitchedCodexAppReal -count=1`（那条 Real 用例要真实的 Codex app 与可用的 `ps`，本机与干净上游一样 panic，与环境无关）；
5. 导出新补丁：`git -C <新目录> add -A && git -C <新目录> diff HEAD --binary > patches/magpie-<新tag>+fish.<n>.patch`，旧补丁留在目录里备查。

**跟进节奏**：上游每个大版本跟一次，中间我们自己只发插件补丁包，不为小改动重编。

## 本机已知坑

- **Schannel 坏**：curl / `Invoke-WebRequest` / winget 对任何 HTTPS 都返回 `000`（`SEC_E_NO_CREDENTIALS 0x8009030E`）。下载一律用 Python 的 urllib 或 git。
- **没有 make**：`make release-windows` 跑不了，`build-magpie.ps1` 里是等价的两条 `go build`。
- **`node --test` 在受限沙箱里不可用**（spawn EPERM，禁管道 stdio）；页面测试直接 `node <file>` 跑。
- Windows 打包是 `CGO_ENABLED=0`，MSVC 用不上；`wails` 的 webview 走系统 WebView2。