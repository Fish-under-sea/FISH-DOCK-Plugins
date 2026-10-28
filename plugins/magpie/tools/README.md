# 自编译 magpie：构建与上游同步

插件包里的 `service/magpie.exe` 由本目录的脚本编译，基线是上游 `v0.1.1709`，加上 `patches/magpie-v0.1.1709+fish.1.patch`。

## 为什么要自己编

插件页面跑在 CSP `connect-src 'none'` 的沙箱帧里，一条 fetch 都发不出去。上游 0.1.1709 的页面桥只有读，没有调用通道，所以：

- 签到页的「关 / 开」「立即签到」点了发不出请求；
- 中转站探针需要 magpie 本体代为出站。

补丁补了两件事：页面调用通道（`magpie.call` → `POST /api/plugin-pages/call`，按 `package.json` 的 `magpie.calls` 白名单分派）与 `internal/relay` 的探测实现。CSP 一行未改。

## 构建

```powershell
# 1) Go 1.26.8（winget 在本机是坏的，走 zip；不要用 curl/IWR，Schannel 坏）
python tools\download-go.py

# 2) 取上游基线
git clone --filter=blob:none --no-checkout https://github.com/yetone/magpie.git upstream
git -C upstream fetch --depth=1 origin tag v0.1.1709
git -C upstream checkout -f v0.1.1709
git -C upstream apply --check patches\magpie-v0.1.1709+fish.1.patch
git -C upstream apply patches\magpie-v0.1.1709+fish.1.patch

# 3) 编（本机没有 make，手跑 release-windows 的两段式）
#    -WinresJson 必须指向补丁带进 upstream 的那份：go-winres 按 json 所在目录
#    解析图标路径，指向别处会报 "open ...\icon-256.png: cannot find the file"。
pwsh -File tools\build-magpie.ps1 `
  -VersionTag 'v0.1.1709+fish.1' -FileVersion '0.1.1709.1' -ProductName 'magpie fish' `
  -WinresJson <上述 upstream 目录>\build\windows\fish-winres.json `
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
| `magpie version` | `magpie v0.1.1709+fish.1` |
| FileVersion | `0.1.1709.1`（四段数字，Windows 资源要求） |
| ProductName | `magpie fish` |
| FileDescription | `magpie fish (FISH Dock build)` |
| manifest identity | `ai.usemagpie.magpie.fish` |

这样用户装的是官方版还是我们的构建，一眼能分。

## 上游升级

1. `git -C upstream fetch origin tag <新 tag>` + `checkout -f <新 tag>`；
2. `git apply --check patches\...` —— 冲突就在这里暴露；
3. 冲突大多在 `internal/gui/pluginpage.go`、`internal/plugin/page.go`（calls 字段）、`internal/gui/pagebridge.js`，按新版本的结构重排；
4. 编出新 exe，跑 `go test ./internal/relay/ ./internal/gui/ ./internal/plugin/ ./internal/provider/ -count=1`；
5. 导出新补丁：`git -C upstream diff > patches/magpie-<新tag>+fish.<n>.patch`，旧补丁留在目录里备查。

**跟进节奏**：上游每个大版本跟一次，中间我们自己只发插件补丁包，不为小改动重编。

## 本机已知坑

- **Schannel 坏**：curl / `Invoke-WebRequest` / winget 对任何 HTTPS 都返回 `000`（`SEC_E_NO_CREDENTIALS 0x8009030E`）。下载一律用 Python 的 urllib 或 git。
- **没有 make**：`make release-windows` 跑不了，`build-magpie.ps1` 里是等价的两条 `go build`。
- **`node --test` 在受限沙箱里不可用**（spawn EPERM，禁管道 stdio）；页面测试直接 `node <file>` 跑。
- Windows 打包是 `CGO_ENABLED=0`，MSVC 用不上；`wails` 的 webview 走系统 WebView2。