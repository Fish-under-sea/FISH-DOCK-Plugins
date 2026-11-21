# FISH-DOCK-Plugins 插件仓 · Agent 必读

> 本文件是本仓的**跨机器口径**，所有克隆者通用，聚焦开发与发布的关键契约。
> 本机路径、工具链与凭据文件位置见第零节；issue / PR 规范见 `.github/CONTRIBUTING.md`。

## 零、先识别当前用户，再读取本机档案

本仓将「跨机器规则」与「本机事实」分成两层：本文件承载前者，`docs/agents/local/<用户名>.md` 承载后者，**两者均入库**，由各自作者维护。

开工前按顺序执行：

1. 读取当前用户名：PowerShell 中取 `$env:USERNAME`（可结合 `$env:USERPROFILE` 确认主目录）。
2. 将用户名转小写，空格与非 ASCII 字符替换为 `-`，仅读取对应的 `docs/agents/local/<规范化用户名>.md`（例如 `Fish` → `docs/agents/local/fish.md`）。
3. 档案缺失时，复制 `docs/agents/local/_template.md` 为 `docs/agents/local/<规范化用户名>.md`，填完后随提交入库。
4. 两层边界：**路径、工具链、凭据位置、缓存位置以个人档案为准；规则、契约、发布口径以本文件为准。**
5. 用户名规范写法见 `docs/agents/README.md`。

## 一、仓库边界与模块位置

| 目录 | 说明 |
| --- | --- |
| `catalog/` | 商店目录，`stable.json` 是插件**版本与摘要的唯一权威** |
| `plugins/` | 三个官方插件：`magpie/`、`clash/`、`feishu/`（历史归档见 `docs/archive/`） |
| `shared/` | 插件共用运行时：`gateway.mjs`、`child.mjs`、`errors.mjs`、`dock.css` 与对应测试 |
| `tools/` | 构建、打包、校验、渲染脚本（`build-release.mjs`、`build-npm-packages.mjs`、`verify-release.mjs`、`crc32.mjs`、`stage-development.mjs`、`render-readme.mjs`） |
| `docs/` | 开发者指南、维护者指南、计划、规格、发行说明与个人环境档案 |
| `assets/`、`licenses/` | README 头图与第三方许可 |

桌面宿主（FISH Dock）的源码与问题归属 `Fish-under-sea/FISH-Dock`。

## 二、文档导航

| 任务 | 对应文档 |
| --- | --- |
| 编写插件、接入 SDK / 页面 / 行为钩子 | `docs/developers/README.md` |
| 液态玻璃与主题联动 Hook | `docs/developers/liquid-glass-hooks.md` |
| 外部原生窗口与视觉设计语言 | `docs/developers/native-window-hook.md`、`docs/developers/design-language.md` |
| 维护构建链、补丁链与上游同步 | `docs/developers/README.md`、`docs/maintainers/README.md` |
| 发版流程、版本与兼容口径 | `docs/maintainers/README.md` |
| 查看阶段计划 | `docs/plans/plan-*.md` |
| 编写发行说明 | `docs/releases/<ver>.md`（沿用上一版结构，与 `catalog/stable.json` 同版） |
| 提交 issue / PR | `.github/CONTRIBUTING.md` |
| 查询本机环境 | `docs/agents/local/<用户名>.md` |

## 三、摘要与版本权威

- 插件摘要统一由 `tools/build-release.mjs` 生成并经 `tools/verify-release.mjs` 校验，权威落点为 `catalog/stable.json` 三字段（`sha256` / `bytes` / `url`）与 GitHub Release 的 `SHA256SUMS`。
- 各插件独立发版，版本以 `catalog/stable.json` 为准。
- ZIP CRC 与归档一致性校验统一使用本仓 `tools/crc32.mjs`（原因见第五节）。
- 宿主侧资源清单与 `<exe>.sha256` 归属宿主仓 `Fish-under-sea/FISH-Dock`。

## 四、打包与发布

1. 构建：`node tools/build-release.mjs`，输出到新的临时目录（如 `.work/` 下独立子目录）。
2. 校验：`node tools/verify-release.mjs`，核对 ZIP CRC、文件长度、`.mjs` 语法门与 `stable.json` 三字段。
3. npm 单包：`node tools/build-npm-packages.mjs --only <id> --version <ver>`，输入为当次构建的 `<id>.fish-plugin`。
4. 发行：上传 `<id>.fish-plugin` 与 `SHA256SUMS` 至 GitHub Release，同步更新 `catalog/stable.json`、`README.md`、`README.en.md` 与 `docs/releases/<ver>.md`。
5. 下载源与版本一致：插件下载源限定为 `catalog/stable.json`、GitHub Release 与 npm 双源；GitHub Release 与 npm 同版本发布，发布后确认 npm 官方源与 npmmirror 的 `latest` 到位。
6. 发布传播期：大包发布返回成功后处于异步入库期，间隔约 2 分钟再校验远端元数据；因令牌通常无 2FA 撤回权限，发布前以本地 `verify-release` 为最终闸门。

## 五、环境坑与处置

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| `npm pack` / `npm publish` 报 `Z_DATA_ERROR: zlib: incorrect data check`；`verify-release` 报 ZIP CRC 错误 | 部分机器的 Node 24 zlib 处理大 buffer 异常（sha256 与文件长度稳定） | 打包校验统一走 `tools/crc32.mjs`；发 npm 切换至 Node 22 便携版（`v22.23.4` 实测稳定） |
| `npm view` / `npm publish` 报缓存目录 `EPERM` | 默认 npm 缓存位于用户目录受限区 | 设置 `$env:npm_config_cache='<工作区>\.work\npm-cache'` 或本机档案指定的缓存根 |
| `go` 报 `build cache` / `GOPATH` 权限拒绝 | 默认 Go 缓存落在用户目录 | 将 `GOPATH`、`GOCACHE`、`GOTMPDIR` 统一指向工作区 `.work\go\` |
| `node --test` 报 `spawn EPERM` | 沙箱限制管道 stdio | 常规环境用默认进程隔离 `node --test`；沙箱受限时改用 `node --test --test-isolation=none "<glob>"`，真实子进程被拒时申请原命令单次授权重跑 |
| Chromium / Edge 无头启动报 `mojo … 拒绝访问 (0x5)` | 沙箱限制命名管道 | 实际被拒后申请原命令单次授权执行 |
| `git push` 报 `TLS connect error: unexpected eof` | 默认 TLS 通道波动 | 追加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1` |
| `git push` 无法拉起 credential helper | 沙箱限制命名管道 | 用 `gh auth token` 构造当次临时推送 URL（用完即弃），推完执行 `git fetch` 对齐 |
| `gh` 报 `fatal: not a git repository` | 未在仓库目录执行 | 显式传入 `--repo <owner>/<repo>` |

测试保持真实协议与子进程覆盖；因权限受阻的失败单独标注为环境阻塞，授权重跑通过后再计入通过数。

### Go 工具链（Magpie 自编译）

上游 `yetone/magpie` 的 `go.mod` 要求 `go 1.26.8`（本机安装路径见个人档案）：

```powershell
$env:GOROOT  = '<Go 根>'
$env:GOPROXY = 'https://goproxy.cn,direct'
$env:GOPATH  = '<工作区>\.work\go\gopath'
$env:GOCACHE = '<工作区>\.work\go\gocache'
$env:GOTMPDIR= '<工作区>\.work\go\tmp'
& '<Go 根>\bin\go.exe' version
```

- 上游安装包：`https://mirrors.ustc.edu.cn/golang/go1.26.8.windows-amd64.zip`（`74,957,586` 字节，SHA-256 `b92c3b2adae85a11ba71fe7216daf0d84e82af4c8ab6c5625807f28622043a59`）；大批量搬移使用 `robocopy /MOVE`。
- `plugins/magpie/tools/build-magpie.ps1` 支持以 `-UpstreamRoot` 指定上游源码树，工具链默认读取 `<构建根>\toolchain\go` 或通过参数指定。

## 六、提交与交付

- 默认命令行使用 PowerShell 7（`pwsh`）。
- 提交遵循中文 Conventional Commits（`feat(magpie): …` / `fix(clash): …` / `docs(release): …` / `chore(catalog): …`），保持单次提交单一职责。
- 仅提交源码与文档，一次性实验产物放在 `.work/`；清理临时产物时按精确白名单路径逐项删除（如 `Remove-Item <精确路径>`）。
- 规则类变更随对应功能提交一起入库；纯个人环境档案更新按 `docs/agents/README.md` 单独提交。
- 本机路径、工具链与凭据位置统一维护在 `docs/agents/local/<用户名>.md` 并入库。
