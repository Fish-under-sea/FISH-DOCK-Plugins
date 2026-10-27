# Issue #3：Magpie 内部插件交接（2026-10-27，未发布）

## 结论与证据边界

已经修复并用正式原生二进制验证了一个确定的适配问题：Magpie 内部页面返回 `frame-ancestors 'self'`，其父页面是 Magpie，但更上层是 Dock 的 `http://tauri.localhost`。浏览器检查整个祖先链，原策略拒绝这一嵌套结构。修复只在 `/_magpie/plugin/<32位小写十六进制 token>/…` 响应中，把确切的 `frame-ancestors 'self'` 扩展为 `'self' http://tauri.localhost`。

这不是对用户原截图的唯一根因断言。未读取其真实内部插件包/配置，未启动其 Dock、Magpie 或 Agent 服务。实际截图也可能有独立的依赖、端口、URL 或 WebView2 问题；下面明确分开已验与待验。

已验的端到端场景：正式原生 Magpie，独立的中文/空格资料目录，合成 `magpie-usage-glance@0.1.0` 页面插件，已安装的 Edge 无头浏览器，模拟 Dock 的准确 origin 与 iframe sandbox。管理页、菜单、内部 page/bridge.js、Cookie 和读取 API 都来自原生服务。测试将内部页面响应头恢复为上游原策略时，捕获 `frame-ancestors` 控制台错误且页面不能加载；不恢复时原生消息桥读取用量成功，DOM 为 `0 calls`。**这不等同于真实 Dock/WebView2 实机验收，也未复现用户资料中的插件安装过程。**

## 版本与本地材料

| 项目 | 本轮使用的材料 |
|---|---|
| 正式适配包基线 | `v1.0.0/magpie.fish-plugin`，由主 agent 下载并逐资源核验；当前仓库适配层已包含 1.0.1 的真实 HOME/便携资料修复 |
| 原生二进制 | `D:/Fish-code/Codex/FISH-DOCK-Plugins/.tools/baseline-v1.0.0/runtimes/magpie.exe` |
| 原生 SHA-256 | `ea2ceec71757a5e8a9a892055e773506b8c046603bad09ade4d6f4499b876918` |
| 上游源码基准 | `yetone/magpie`，`ef3b9f85a46769713d55d21c6c3259fe70b69acd`（维护文档记录的正式二进制对应提交；原生显示版本须实机再记录） |
| 只读调查副本 | `plugins/magpie/.tools/upstream`，固定到上述提交 |
| 内部插件 | 按上游 page-only 示例机制生成的 `magpie-usage-glance@0.1.0`，合成数据，无真实账号 |
| Node | 24.14.0 |
| 未另下载 | 适配包 1.0.1、Bun、浏览器 |

`.tools/upstream` 是被 Git 忽略的调查材料。`tools/stage-development.mjs` 只复制插件顶层普通文件并排除 `.test.`；`.tools/` 和 `fixtures/` 均不会进入发行包。测试在源码仓运行。最终未发布包路径、完整逐资源摘要由主线交接文档给出。

## 原生启动与内部插件机制

源码位置均相对上述上游提交：

1. `internal/appdir/appdir.go`：原生 `.portable`/相邻 `data` 定位 Magpie 自有资料；不改变 Agent 的 HOME/XDG。适配层运行 `credentials/magpie-runtime/magpie.exe`，资料在相邻 `data/`，CWD 是宿主给出的插件数据根，TEMP/TMP 是其 `tmp/`。
2. `internal/plugin/store.go`：`data/plugins.json` 记录 `spec/off/options`，npm 安装目录是 `data/plugins/`。路径插件可直接以本地绝对目录为 spec。启用状态与 `package.json` 中 `magpie.page/panels/permissions` 决定页面是否出现。
3. `internal/plugin/page.go`：只有页面/面板而没有脚本入口的插件不加载进 Bun host。上游 `internal/gui/testdata/page-plugin` 的“用量速览”就是此类；不能把缺少 Bun 直接视为这个页面拒绝连接的原因。
4. `internal/gui/pluginpage.go`：`GET /api/plugin-pages` 返回相对 URL `/_magpie/plugin/<本次运行HMAC token>/index.html`。同一管理 HTTP 服务直接提供文件；这里没有第四个“用量速览端口”。每次原生进程重启产生新 token，旧地址返回 404。关闭的插件不再供应其页面文件。
5. `internal/gui/assets/pluginpages.js`、`internal/gui/pagebridge.js`：内层 iframe 仅 `sandbox="allow-scripts"`，页面通过 `postMessage` 请求允许的读取；父管理页再调用 `POST /api/plugin-pages/read`。`usage:summary` 是原生本地用量汇总，空资料下返回 0；页面不能直接 fetch API。
6. `internal/gui/web.go`：管理 API 要 Cookie 登录；token 页面文件不要求 Cookie，因为其 opaque-origin sandbox 无法使用管理页 Cookie。token 由已鉴权 API 提供，仍不可猜测。外层代理保留请求 Host（因此资源 CSP 路径使用外层端口）、相对 URL、状态码和跳转；保持已有分区 Cookie 适配。
7. `internal/plugin/bun.go`、`bunupdate.go`、`host.go`：需要脚本 host 的插件使用显式 `MAGPIE_BUN`，否则由 Magpie 下载并校验托管 Bun；该提交 Bun 最低版本/默认版本是 **1.4.2**，默认 Windows x64 baseline 包。托管位置是 `data/cache/bun/<version>/magpie-bun.exe`，安装缓存也属 Magpie cache。host 以数据目录为 CWD 执行 `bun run <原生生成的host脚本>`，stdio RPC，非独立用量页面 HTTP 服务。Bun 本身及第三方插件额外依赖不随当前 Dock Magpie 包提供。npm/git 安装依赖下载、网络和上游运行时兼容性。

三个端口各自用途：用户配置端口（默认 3425）是嵌入代理；动态管理端口用于 `web --addr 127.0.0.1:<port> --no-open`；另一动态端口通过 `MAGPIE_ADDR` 提供模型网关。动态端口探测后到监听之间仍存在竞态，不宣称彻底消除了端口占用风险。页面 URL 不应指向模型网关。

## 本地改动

- `embed-proxy.mjs`：仅上述 token 路径、仅已有精确 `'self'` 的 `frame-ancestors` 添加正式 Windows Dock origin。未加入 `*`、任意 localhost 端口、开发服务器或 Origin/Referer 动态反射；未删除 CSP/X-Frame-Options，也未改变 `sandbox`、`connect-src 'none'`、资源目录约束。第三方显式 `'none'` 或其他策略原样保留。
- `environment.mjs`：保留原有真实 HOME/USERPROFILE/APPDATA/XDG 与 Agent 目录白名单；新增上游支持的 `MAGPIE_BUN` 显式路径，含中文/空格。仍不透传任意宿主环境、密钥或 `NODE_OPTIONS`。没有自动设置代理或透传代理凭据。
- `runtime.mjs`：透传共享 `startChild` 的取消 signal；代理创建前后检查取消；代理停止异常时也尝试回收自身子进程；文件不存在、路径无效、数据根不可写使用共享脱敏 typed error。原生未就绪/提前退出由共享 child 返回错误。
- `backend.mjs`：采用主线 `defaultExecutable`，删除启动时自动 save 绝对资源路径；`gateway.stop` 即时返回状态，后台完成停止，避免协议超时；停用仍 await 停止。
- 回归：CSP 精确范围、流/WS upgrade、Cookie、环境、迁移、取消、启动前失败，以及 opt-in 正式二进制/浏览器夹具。没有修改 shared、tools 或其他插件。

## 测试命令与已验结果

在 `D:/Fish-code/Codex/FISH-DOCK-Plugins`，PowerShell：

```powershell
node --test --test-isolation=none 'plugins/magpie/*.test.mjs'
```

默认不运行原生服务。完整测试含一个显式跳过的 native 项，其余使用合成文件/回环服务器。无效文件、不可写根、已占用端口会产生明确错误，且不产生服务副本。

原生 HTTP/生命周期测试（不装浏览器也能执行）：

```powershell
$env:FISH_TEST_MAGPIE='D:/Fish-code/Codex/FISH-DOCK-Plugins/.tools/baseline-v1.0.0/runtimes/magpie.exe'
$env:FISH_TEST_TMP='D:/Fish-code/Codex/FISH-DOCK-Plugins/plugins/magpie/.tools'
Remove-Item Env:FISH_TEST_PLAYWRIGHT -ErrorAction SilentlyContinue
node --test --test-isolation=none 'plugins/magpie/*.test.mjs'
```

启用浏览器验证使用本机现成模块和 Edge：

```powershell
$env:FISH_TEST_PLAYWRIGHT='C:/Users/Fish/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:FISH_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node --test --test-isolation=none 'plugins/magpie/*.test.mjs'
```

Windows `taskkill /T /F` 回收测试进程树需要有足够权限；本机沙箱会拒绝，最终原生回归在获批沙箱外执行。测试会生成独立 worker，先将全部 HOME/XDG/Agent 变量指向新合成目录，再导入适配层；**这种隔离只发生在测试 worker，生产环境保持真实目录发现**。原生设置关闭自动更新/账号发现，出站代理指向本地拒绝服务器；浏览器也拦截非测试地址，不调用真实模型。测试资料留在指定临时目录便于检查，不导入真实账号。

最后通过的原生/浏览器运行记录：

```text
PASS native: token files + relative bridge/app 200; unauthenticated API 401;
allowed read 0 calls; undeclared/framed read 403
PASS browser: original CSP rejects Dock nesting; scoped fix renders 0 calls;
network/storage/parent access still blocked; unrelated origin rejected
PASS lifecycle: stop releases listener; restart invalidates old token (404),
returns new working URL, retains plugin settings
```

普通 Edge 对跨来源回环访问有本地网络权限检查，最初夹具出现 `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`。夹具只给临时浏览器 context 的精确测试来源授予该权限；**生产代码没有关掉此检查**。无头环境的鼠标可见性/截图等待不稳定，测试通过 DOM dispatch 触发真实菜单，并验证真实 DOM/网络/控制台。`FISH_TEST_EVIDENCE` 可选保存截图，但本轮没有可交付的有效前后截图；不要将无头 DOM 通过表述为截图或真实 Dock 验收通过。

## 生命周期及尚未覆盖边界

正常停止/停用/宿主 EOF 走共享 runtime.stop；Windows 主线 child 在父进程还存在时按其 PID `taskkill /T /F`，防止先杀父再丢失子进程。没有扫描或结束同名进程，没有停止用户独立服务。代理关闭会销毁自身持有的 HTTP/WS 连接。便携迁移保留旧目录、后续启动保留新目录；正式资源摘要不被原生自更新改变。

仍待实机或进一步专项验证：

- 真实 Dock v1.1.0 的 WebView2 祖先链、Cookie 分区、侧栏切换、关闭重开、宿主退出/重启、插件停用启用、升级与迁移。实机确认宿主 origin 确为 `http://tauri.localhost`；非此 origin 不应临时扩成通配。
- 用户已安装的“用量速览”的实际包名、版本、声明、依赖、旧 URL 与数据。不能以本轮合成同名示例代替其身份确认。
- 真实账号为空时，宿主 UI 出现原生正常空状态；用真实资料只做识别，不点击接管、写回、切换模型、自动导入或外发。
- Bun 依赖缺失/不兼容/启动提前退出/初始化超时、下载失败及第三方额外服务。此修复只保证 `MAGPIE_BUN` 不被误丢弃；没有替原生实现所有插件的依赖管理、健康检查或独立重启器。主服务“运行中”仍只代表管理服务就绪；内部插件状态与错误需查看 Magpie 插件页。
- **父 Magpie 意外崩溃或自更新脱离原父进程后**，共享 child 已失去可遍历的存活根 PID；本轮没有添加 Windows Job Object。不能保证这类情况全部后代无孤儿。需要记录进程树并单独评估宿主 Job Object 支持；不要按名字批量 kill。

主线补充：本轮参考宿主 commit 的 `plugin_job.rs` 已将插件 backend 绑定 Windows Job，`plugin_process.rs` 在停止/销毁 backend 时关闭该 Job；这为停用/退出提供额外回收边界。尚未实测原生 Magpie 崩溃后、backend 仍运行时的依赖残留，以及子进程自更新/breakaway 行为，仍须记录和验证。
- 模型网关端口被外部服务抢占、管理端口抢占，以及 Bun/自建外部服务的归属与残留；不要把管理页返回 200 当成这些服务通过。
- 真实用户及自定义 DSH/Claude/Codex 发现尚未实机运行；白名单回归已通过。1.0.1 正式适配包本轮没有重新下载比对。

## 下一位 agent 的具体实机流程

1. 用主线提供的本地未发布包；记录 Dock、适配清单版本/摘要、原生显示版本/摘要、内部插件包名/版本，以及 WebView2 版本。先运行上面的隔离 native 测试；浏览器部分可按环境开启。
2. 在新的中文且含空格的数据根测试，安装合成 page-only 插件或确认过的本地安全页面插件。保留其 `package.json`、`plugins.json` 的脱敏副本。首次页面菜单出现不算通过。
3. 打开开发者工具，记录外层、管理页、内部 iframe 三层 origin；捕获 `GET /api/plugin-pages` 返回的 URL、页面/bridge.js/app.js 请求及响应头。记录 token 时用 `<token>` 替换，绝不导出带 `?k=`、Cookie、Authorization 的完整 HAR。
4. 对照修复前包和本地修复包，打开用量页：预期原 CSP 出现祖先拒绝；修复后静态文件 200，`POST /api/plugin-pages/read` 200，显示数据或明确空状态。截取隐藏密钥和用户内容的前后图。若仍拒绝，首先区分 TCP refused、CSP、LNA、Cookie/API 401 与原生插件错误，不继续扩大 CSP。
5. 切换标签、关闭重开，再停止/启动 Magpie：旧 token URL 应 404，新菜单 URL 应更新且页面恢复，设置/options 保留。对外层端口做占用测试，看到明确错误后释放并重试。验证停用启用、Dock 正常退出重启及本地升级。
6. 使用安全自编的脚本插件和受控 Bun 做依赖专项：缺失 MAGPIE_BUN、无效二进制、过旧版本、初始化超时、提前退出。记录原生插件页错误、重试入口、父子 PID/端口及停止前后状态。只结束本次启动且归属明确的进程。
7. 在用户批准的资料副本中复测真实内部插件和 Agent 发现；保持生产真实 HOME 和自定义路径白名单，禁止为了“发现成功”把所有 HOME 指向插件目录。不要调用真实模型或改写真实 Agent 配置。
8. 回报逐项通过/失败/未验、脱敏网络记录和截图。本轮不要发布、推送或更新远程 issue。
