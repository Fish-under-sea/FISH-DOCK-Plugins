# 本机环境档案 · Fish

> 机器：Fish（`$env:USERNAME`），用户目录 `C:\Users\Fish`。
> 通用工具根（`D:\Fish-code\工具\`）、包缓存根、`.work\` 清理与长期记忆规范见全局 `C:\Users\Fish\.gemini\config\GEMINI.md`；跨机器规则见仓库根 [AGENTS.md](../../../AGENTS.md)。

## 一、工作区与仓库

| 项 | 值 |
| --- | --- |
| 本仓路径 | `D:\Fish-code\AGY\FISH-DOCK-Plugins` |
| 宿主 SDK | 从 `Fish-under-sea/FISH-Dock` `main` 拉取 `sdk/{browser/bridge.js,node/plugin.mjs}` 暂存于本仓 `.work\`（如 `.work\sdk-2.5.0`），发版前核对与宿主最新钩子同步 |

## 二、本仓工具链

| 工具 | 路径或版本 | 用途 |
| --- | --- | --- |
| PowerShell | `pwsh 7.6.6` | 默认命令行 |
| Node（常规 / 测试） | `C:\Program Files\nodejs\node.exe`（`v24.14.0`） | 默认 PATH 入口 |
| Node（发 npm 专用） | `D:\Fish-code\工具\可复用工具集\Node22`（`v22.23.4` / `npm 10.9.9`） | 发 npm 前置入 `PATH` 最前 |
| Go（Magpie 自编译） | `D:\Fish-code\工具\可复用工具集\Go`（`go1.26.8 windows/amd64`） | 对齐上游 `yetone/magpie` |
| mihomo（Clash 内核） | `D:\Fish-code\工具\可复用工具集\mihomo\v1.19.34\mihomo.exe` | Clash 2.5.0 随包内核 |
| Edge + Playwright | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` + `D:\Fish-code\工具\可复用工具集\magpie-browser-1.64.1\node_modules\playwright-core` | 浏览器回归与 `tools/render-readme.mjs` 渲染 |
| Git / GitHub CLI | `git 2.52.0`、`gh 2.89.0` | `C:\Program Files\Git\cmd\git.exe`、`C:\Program Files\GitHub CLI\gh.exe` |
| 7-Zip | `C:\Program Files\7-Zip\7z.exe` | 归档完整性校验 |
| Node TLS 辅助脚本 | `D:\Fish-code\工具\可复用脚本与经验\FISH Dock\`（`fetch-file.mjs`、`fetch-asset-resume.mjs` 等） | 需走 Node TLS 传输时调用 |

## 三、Go 编译环境变量

| 变量 | 建议值 | 说明 |
| --- | --- | --- |
| `GOROOT` | `D:\Fish-code\工具\可复用工具集\Go` | 指向本机 Go 1.26.8 |
| `GOPATH` / `GOCACHE` / `GOTMPDIR` | `<本仓>\.work\go\{gopath,gocache,tmp}` | 将 Go 缓存与临时目录落在本仓 `.work\go\` |
| `GOPROXY` | `https://goproxy.cn,direct` | 国内代理加速拉取 Go 模块 |

## 四、凭据文件位置

| 凭据 | 文件路径 | 说明 |
| --- | --- | --- |
| npm 令牌 | `C:\Users\Fish\.npmrc` | 报 `401` / `404` 时由用户刷新写入令牌 |
| Git 凭据 | `C:\Users\Fish\.git-credentials` | 唯一权威凭据文件 |
| GitHub CLI | `C:\Users\Fish\AppData\Roaming\GitHub CLI\hosts.yml` | 直接使用 `gh` 或 `gh auth token` |

## 五、本机特有现象

| 现象 | 处置 |
| --- | --- |
| Clash 开启 TUN 时再叠加 `HTTP_PROXY` / `HTTPS_PROXY=http://127.0.0.1:7895` | 命令行清除 `HTTP_PROXY` / `HTTPS_PROXY`，直接走原生 TUN 满速上传 GitHub Release 与 npm |
| 全仓运行 `node --test --test-isolation=none` 结束后偶发句柄挂起 | 优先使用默认进程隔离 `node --test` |
| 本机 `schannel` 偶发 HTTPS 握手或 `SEC_E_NO_CREDENTIALS` 异常 | 下载与上传改走 Node TLS（`FISH Dock\fetch-file.mjs` 或 OpenSSL） |

## 六、最近一次核对

- 日期：2026-11-22
- 核对人：Fish
