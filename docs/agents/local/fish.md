# 本机环境档案 · Fish

> 机器：Fish（`$env:USERNAME`），用户目录 `C:\Users\Fish`。
> 通用本机约定（`D:\Fish-code\工具\可复用工具集\`、可复用脚本根、包缓存根、`.work\` 清理与 `magpie-memory` 长期记忆规范）见全局指令 `C:\Users\Fish\.gemini\config\GEMINI.md`（Magpie Library 共有约定），本文件不重复赘述；跨机器规则见仓库根 [AGENTS.md](../../../AGENTS.md)。凭据只写位置，不写内容。

## 一、工作区与仓库

| 项 | 值 |
| --- | --- |
| 当前活跃本仓路径 | `D:\Fish-code\AGY\FISH-DOCK-Plugins`（另有早期检出 `D:\Fish-code\CC\FISH-DOCK-Plugins`） |
| 宿主 SDK | 从 `Fish-under-sea/FISH-Dock` `main` 拉取 `sdk/{browser/bridge.js,node/plugin.mjs}` 隔离暂存于本仓 `.work\`（如 `.work\sdk-2.5.0`），发版前先核对与宿主最新钩子同步 |
| 一次性产物与通用工具根 | 见 `GEMINI.md`（本仓 `.work\` 与 `D:\Fish-code\工具\`） |

## 二、本仓实际用到的工具链

以下路径均位于系统安装目录或 `GEMINI.md` 约定的 `D:\Fish-code\工具\` 根下：

| 工具 | 路径或版本 | 备注 |
| --- | --- | --- |
| PowerShell | `pwsh 7.6.6` | 默认命令行 |
| Node（常规 / 测试） | `C:\Program Files\nodejs\node.exe`（`v24.14.0`） | 另于 `可复用工具集\Node\24.14.0` 留存同版 |
| Node（发 npm 专用） | `可复用工具集\Node22`（`v22.23.4` / `npm 10.9.9`） | 避开 Node 24.14 大 buffer `Z_DATA_ERROR` |
| Go（Magpie 自编译） | `可复用工具集\Go`（`go1.26.8 windows/amd64`） | 上游 `yetone/magpie` 要求版本 |
| mihomo（Clash 内核） | `可复用工具集\mihomo\v1.19.34\mihomo.exe` | 当前 Clash 2.5.0 随包内核 |
| Edge + Playwright | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` + `可复用工具集\magpie-browser-1.64.1\node_modules\playwright-core` | 浏览器回归与 `tools/render-readme.mjs` 渲染 |
| Git / GitHub CLI | `git 2.52.0`、`gh 2.89.0` | `C:\Program Files\Git\cmd\git.exe`、`C:\Program Files\GitHub CLI\gh.exe` |
| 7-Zip | `C:\Program Files\7-Zip\7z.exe` | 归档完整性校验 |
| Node TLS 下载与发版脚本 | `可复用脚本与经验\FISH Dock\`（含 `fetch-file.mjs`、`fetch-asset-resume.mjs` 等） | 本机 `schannel` 异常时改走 Node TLS |

## 三、本仓构建环境变量

| 变量 | 建议值 | 原因 |
| --- | --- | --- |
| `npm_config_cache` | `D:\Fish-code\工具\可复用工具集\npm-cache`（或本仓 `.work\npm-cache`） | 遵循 `GEMINI.md` 缓存根约定，避开用户目录权限受限 |
| `GOROOT` | `D:\Fish-code\工具\可复用工具集\Go` | 指定本机 Go 1.26.8 |
| `GOPATH` / `GOCACHE` / `GOTMPDIR` | `<本仓>\.work\go\{gopath,gocache,tmp}` | 避免写入用户目录被拒 |
| `GOPROXY` | `https://goproxy.cn,direct` | 加速拉取 Go 模块并避开直连波动 |

## 四、凭据位置（只写位置，不写内容）

| 凭据 | 文件路径 | 备注 |
| --- | --- | --- |
| npm 令牌 | `C:\Users\Fish\.npmrc` | 若发包报 `401` / `404` 需用户刷新令牌；缺 2FA 绕过权限时 `npm unpublish` 会 403，发前务必先跑 `verify-release` |
| Git 凭据 | `C:\Users\Fish\.git-credentials` | 唯一权威源 |
| GitHub CLI | `C:\Users\Fish\AppData\Roaming\GitHub CLI\hosts.yml` | 直接使用 `gh` 或 `gh auth token` |

## 五、本机特有现象

| 现象 | 处置 |
| --- | --- |
| Node 24.14 `npm pack` / `npm publish` 报 `Z_DATA_ERROR` 或 CRC 不符 | 发 npm 前把 `可复用工具集\Node22` 置入 `PATH` 最前；ZIP CRC 统一用 `tools/crc32.mjs` |
| **Clash 开启 TUN 时再叠加 `HTTP_PROXY` / `HTTPS_PROXY=http://127.0.0.1:7895`** | 大文件上传（GitHub Release / npm）会被拖到 ~50 KB/s 甚至 `ECONNRESET`；命令行清空 `HTTP_PROXY` / `HTTPS_PROXY` 直接走原生 TUN 可满速上传 |
| `node --test --test-isolation=none` 全仓混跑结束后偶发句柄挂住不退出 | 优先用默认进程隔离 `node --test`，仅沙箱报 `spawn EPERM` 时退回 `--test-isolation=none` |
| `npm publish` 大包成功后立刻 `npm view` 仍显旧版或 `404` | npm 异步入库（`Your package is being processed`），等几分钟 CDN 刷新即可，切勿重复发布 |
| HTTPS 偶发 `schannel` 握手 / `SEC_E_NO_CREDENTIALS` 异常 | 下载与上传改走 Node TLS 栈（`FISH Dock\fetch-file.mjs` 或 OpenSSL 后端） |

## 六、最近一次核对

- 日期：2026-11-22
- 核对人：Fish（由猫猫实机核实并更新）
