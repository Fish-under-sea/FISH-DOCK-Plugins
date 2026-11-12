# FISH-DOCK-Plugins 插件仓 · Agent 必读

> 本文件是本仓的**跨机器口径**：任何人克隆本仓都适用，只写「改这里一定会踩到的坑」。
> 涉及本机路径、工具链位置、凭据文件的内容**不写在这里**，见第零节。
> 提交 issue / PR 的规则在 `.github/CONTRIBUTING.md`，不与本文件重复。

## 零、先认出当前用户，再读你的本机覆盖

本仓把「跨机器规则」与「本机事实」分成两层：本文件是前者，`docs/agents/local/<用户名>.md` 是后者，**两者都入库**，每个作者维护自己那份。

开工前按顺序做：

1. 取当前用户名：PowerShell 里 `$env:USERNAME`（同时可看 `$env:USERPROFILE` 确认用户目录）。
2. 转成小写、空格与非 ASCII 字符替换为 `-`，得到文件名，读 `docs/agents/local/<该名>.md`。
   - 本机 `USERNAME=Fish` → 读 `docs/agents/local/fish.md`。
3. 文件不存在：复制 `docs/agents/local/_template.md` 为 `<你的名字>.md`，填完随你的一次正常提交一起入库，**不要只留在本地**。
4. 两层冲突时的优先级：**路径、工具链、凭据、缓存位置以本机覆盖为准；规则、契约、发布口径以本文件为准。**
5. 拿不准用户名的规范写法，看 `docs/agents/README.md`。

不要凭猜测套用别人的本机文件：别人的盘符、Go 工具链和令牌位置在你的机器上不成立。

## 一、仓库边界与模块位置

| 目录 | 是什么 |
| --- | --- |
| `catalog/` | 商店目录，`stable.json` 是插件**版本与摘要的唯一权威** |
| `plugins/` | 三个官方插件：`magpie/`、`clash/`、`feishu/`；OFM 与 `relay-probe/` 已退役，历史代码在 `docs/archive/` |
| `shared/` | 插件共用运行时：`gateway.mjs`、`child.mjs`、`errors.mjs`、`dock.css` 与各自的测试 |
| `tools/` | 构建、打包、校验、渲染脚本（`build-release.mjs`、`build-npm-packages.mjs`、`verify-release.mjs`、`crc32.mjs`、`stage-development.mjs`、`render-readme.mjs`） |
| `docs/` | 开发者指南、维护者指南、计划、规格、发行说明、预览图与退役档案（见第二节） |
| `assets/`、`licenses/` | README 图与第三方许可 |

宿主（桌面 Dock 本身）的问题与代码不在本仓，在 `Fish-under-sea/FISH-Dock`。

## 二、文档导航（改之前先读对应那份）

| 你要做的事 | 先读 |
| --- | --- |
| 第一次写插件、接 SDK / 页面 / 行为钩子 | `docs/developers/README.md` |
| 改构建链、补丁链、上游跟随 | `docs/developers/README.md` 与 `docs/maintainers/README.md` |
| 发版、对版本与兼容口径 | `docs/maintainers/README.md`（发行顺序那节） |
| 看本轮改动计划 | `docs/plans/plan-*.md` |
| 追溯 OFM 适配层历史 | `docs/archive/ofm/README.md` |
| 写发行说明 | `docs/releases/<ver>.md`（模板照抄上一版，与 `catalog/stable.json` 同版） |
| 设计语言与视觉 | `docs/developers/design-language.md`、`docs/developers/native-window-hook.md` |
| 提 issue / PR | `.github/CONTRIBUTING.md` |
| 本机环境 | `docs/agents/local/<用户名>.md` |

## 三、摘要与版本权威

- **插件**：摘要权威是 `catalog/stable.json` 的三字段（`sha256` / `bytes` / `url`）加 Release 的 `SHA256SUMS`；**不要**给 `.fish-plugin` 造单个 `.sha256`。
- **目录只能由脚本写**：版本、摘要、字节数都由 `tools/build-release.mjs` 产出并经 `tools/verify-release.mjs` 校验，不要手改 `stable.json`。
- 各插件独立发版，版本以 `catalog/stable.json` 为准，不强求同版；`ofm` 已退役，不再补发。
- 校验 CRC 与 ZIP 一致性**必须用本仓 `tools/crc32.mjs`**，不要用 `node:zlib` 的 `crc32`（原因见第五节）。
- 宿主侧的资源清单与 `<exe>.sha256` 属于宿主仓，本仓不重复定义。

## 四、打包与发布

1. 构建：`node tools/build-release.mjs`，产物落到 `.work/` 之类的临时目录，不进库。
2. 校验：`node tools/verify-release.mjs`，它同时核对 ZIP CRC、长度与 `stable.json` 三字段。
3. npm 补包：`node tools/build-npm-packages.mjs --only <id> --version <ver>`，输入是 Release 里的 `<id>.fish-plugin`。
4. 发行：GitHub Release 附 `<id>.fish-plugin` 与 `SHA256SUMS`，并同步 `catalog/stable.json`、`README.md`、`docs/releases/<ver>.md`。
5. **npm 与 GitHub 必须同版本**：历史上出现过 `stable.json` 已写新版本而 npm 源落后两个版本，导致「三源里两源必失败」。补包后确认 npm 官方源与 npmmirror 的 `latest` 都到位。
6. **发布后几十秒内 tarball 可能仍 404**（`PUT 202` 的传播延迟），等两分钟再 `HEAD` 一次，别急着判失败。本机令牌若缺 2FA 绕过权限，`npm unpublish` 会被 403 拒，发出去撤不回来。

## 五、环境坑

| 现象 | 真相 | 处置 |
| --- | --- | --- |
| `npm pack` / `npm publish` 报 `Z_DATA_ERROR: zlib: incorrect data check`；`verify-release` 报「ZIP CRC 或长度错误」 | 部分机器的 Node 24 zlib 对大 buffer 是坏的，与代理、文件本身无关（实测 36 MB 文件往返即报错，`zlib.crc32()` 同一个 Buffer 前后算出不同值；sha256 与长度全程稳定，能证明文件没坏） | ① 打包与校验统一用 `tools/crc32.mjs`；② 发 npm 换用 Node 22 便携版（`=22.23.4` 实测正常），下载 `https://registry.npmmirror.com/-/binary/node/v22.23.4/node-v22.23.4-win-x64.zip`，解压后跑它的 `npm-cli.js` |
| `npm view` / `npm publish` 报 `EPERM ... open '<用户目录>\AppData\Local\npm-cache\...'` | npm 默认缓存目录在工作区外，被拒写 | 先设 `$env:npm_config_cache='<工作区>\.work\npm-cache'` |
| `go` 报 `failed to initialize build cache` / `mkdir <GOPATH>: Access is denied` | Go 默认 `GOCACHE`、`GOPATH` 落在用户目录下，被拒写 | `GOPATH`、`GOCACHE`、`GOTMPDIR` 三个变量都指到工作区（见下节） |
| `node --test` 报 `spawn EPERM` | 沙箱禁管道 stdio | 用 `node --test --test-isolation=none "<glob>"`；真子进程用例恒失败记环境不记缺陷 |
| Chromium/Edge 无头起不来（`mojo … 拒绝访问 (0x5)`） | 沙箱禁命名管道 | `tools/render-readme.mjs` 用 `danger-full-access` 跑一次 |
| `git push` 报 `TLS connect error: error:0A000126 ... unexpected eof` | git 默认 TLS 通道在部分机器不稳 | 加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1`；别用 `schannel` |
| `git push` 要凭据时 credential helper 起不来 | 沙箱禁命名管道 | 用 `gh auth token` 拼**临时 URL** 推送，用完即弃；**不写进 remote/config**，推完 `git fetch` 对齐 |
| `gh` 报 `fatal: not a git repository` | `gh` 要在仓库目录执行 | 一律显式 `--repo <owner>/<repo>` |

`node --test` 里若断言涉及子进程，优先把断言改成可直接执行的形式，不要靠 `--test-threads` 硬凑。

### Go 工具链（magpie 自编译用）

上游 `yetone/magpie` 的 `go.mod` 要求 go 1.26.8，本地版本要与它对齐（本机实际安装路径写在你的 `docs/agents/local/<用户名>.md`）。

```powershell
$env:GOROOT  = '<Go 根>'
$env:GOPROXY = 'https://goproxy.cn,direct'
$env:GOPATH  = '<工作区>\.work\go\gopath'
$env:GOCACHE = '<工作区>\.work\go\gocache'
$env:GOTMPDIR= '<工作区>\.work\go\tmp'
& '<Go 根>\bin\go.exe' version
```

- 安装包可用 `https://mirrors.ustc.edu.cn/golang/go1.26.8.windows-amd64.zip`（**74,957,586 字节**，sha256 `b92c3b2adae85a11ba71fe7216daf0d84e82af4c8ab6c5625807f28622043a59`），解压后把 `go\*` 放到工具目录。
- 放在工作区外时需要 `danger-full-access`；大批量搬移用 `robocopy /MOVE`，`Move-Item <src>\* <dst>` 会因上万个文件逐个失败。
- `plugins/magpie/tools/build-magpie.ps1` 期望工具链在 `<构建根>\toolchain\go`：用 `-UpstreamRoot` 指向 `<构建根>\upstream-<tag>`，或把 Go 目录链到该相对位置（它只认这个路径）。

## 六、Gitee 与下载源

- Gitee 仓 `https://gitee.com/Fish-under-sea/FISH-DOCK-Plugins` **没有发行版本**，**不作为 `.fish-plugin` 的下载源**；插件包只认 `catalog/stable.json` + npm 双源 + GitHub Release。
- **不要把 Gitee 路径写进 `catalog/stable.json` 或插件下载的三源**：没有发行版本时写进去等于制造「目录抢跑」故障。
- 若 Gitee 将来提供插件发行版，应作为**第四来源**接入「版本候选 + 摘要可信链」，而不是直接塞进现有三源。
- 本仓可见性曾出现匿名 API 时而 200、时而 404/403 的情况；引用「Gitee 下载」前先用 Node TLS 重跑 `https://gitee.com/api/v5/repos/<owner>/<repo>/releases` 探测（接口按 id 升序返回，取末条才是最新），不要沿用旧结论。

## 七、提交与交付

- 命令行默认 PowerShell 7。
- 提交用中文 conventional（`feat(magpie): …` / `fix(clash): …` / `docs(release): …` / `chore(catalog): …`），一个提交只做一件事。
- `.work/`、`node_modules/`、`dist/`、构建产物不进库；`.work/` 只放一次性产物。
- **禁用 `git clean -fdx`**，删东西按白名单逐项删。
- 改本文件或 `docs/agents/` 下的内容，随**改动它的那次功能提交**一起带上，不为文档单独开一个空转提交。
- `AGENTS.local.md` 这种只在本机生效、不入库的写法已废弃；本机事实一律写进 `docs/agents/local/<用户名>.md` 并入库。
