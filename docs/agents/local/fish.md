# 本机环境档案 · Fish

> 机器：Fish（`$env:USERNAME`），用户目录 `C:\Users\Fish`。
> 本文件只写环境事实；规则以仓库根 `AGENTS.md` 为准。凭据只写位置，不写内容。

## 一、工作区与仓库

| 项 | 值 |
| --- | --- |
| 本仓路径 | `D:\Fish-code\DSH-NEXT\插件\插件维护\FISH-Dock-1109\FISH-Dock-Plugins` |
| 同级仓库（宿主仓）路径 | `D:\Fish-code\DSH-NEXT\插件\插件维护\FISH-Dock-1109\FISH-Dock` |
| 一次性产物目录 | 同级 `.work\` |
| 可复用脚本索引 | `D:\Fish-code\DSH\可复用脚本与经验\README.md` |

## 二、工具链

| 工具 | 路径或版本 | 备注 |
| --- | --- | --- |
| PowerShell | PowerShell 7（`pwsh`） | 默认命令行 |
| Node（常规） | 24.14 | `tools/` 下脚本日常可用 |
| Node（发 npm 专用） | 22.23.4 便携版 | 本机 24.14 的 zlib 对大 buffer 坏，发包与 CRC 校验必须用 22 |
| Go | `D:\Fish-code\DSH\工具\Go`（go1.26.8 windows/amd64） | 上游 `yetone/magpie` 要求 1.26.8 |
| 7-Zip | `C:\Program Files\7-Zip\7z.exe` | 工具栏位那份不存在 |
| 下载脚本 | `D:\Fish-code\DSH\可复用脚本与经验\FISH Dock\fetch-file.mjs`、`fetch-asset-resume.mjs` | 本机 schannel 坏，走 Node TLS |

## 三、环境变量

| 变量 | 建议值 | 原因 |
| --- | --- | --- |
| `npm_config_cache` | `D:\Fish-code\DSH-NEXT\插件\插件维护\FISH-Dock-1109\.work\npm-cache` | 默认缓存在用户目录，被拒写 |
| `GOROOT` | `D:\Fish-code\DSH\工具\Go` | |
| `GOPATH` | `<工作区>\.work\go\gopath` | 默认 `%USERPROFILE%\go` 写不进 |
| `GOCACHE` | `<工作区>\.work\go\gocache` | 默认 `%LOCALAPPDATA%\go-build` 写不进 |
| `GOTMPDIR` | `<工作区>\.work\go\tmp` | 同上 |
| `GOPROXY` | `https://goproxy.cn,direct` | 本机 schannel 坏，走镜像 |

## 四、凭据位置（只写位置，不写内容）

| 凭据 | 文件路径 | 备注 |
| --- | --- | --- |
| npm 令牌 | 待补（下次发 npm 时核实实际位置后填写） | 本机令牌缺 2FA 绕过权限，`npm unpublish` 会被 403 拒，发布前先本地校验 |
| GitHub 认证 | `gh auth token` 现取 | 拼临时 URL 推送，用完即弃 |

## 五、本机特有现象

| 现象 | 处置 |
| --- | --- |
| `npm pack` / `verify-release` 报 `Z_DATA_ERROR` 或 CRC 不符 | 本机 Node 24.14 zlib 坏；换 22.23.4 便携版，或用 `tools/crc32.mjs` |
| `go` 报 build cache / GOPATH 拒绝访问 | 三个 Go 环境变量都指到工作区（见上节） |
| HTTPS 报 `schannel: AcquireCredentialsHandle failed` | 下载统一走 Node TLS 脚本 |
| `npm publish` 后 tarball 404 | `PUT 202` 传播延迟，等两分钟再 `HEAD`，别重发 |

## 六、最近一次核对

- 日期：2026-11-12
- 核对人：Fish
