# 任务清单：provider sticky（#41）与上游追平（v0.1.3240）

> 2026-11-07 盘点。**只落清单，不动代码**。
> 本文的行号基于 `.work/magpie-build/magpie-0.1.3240`（上游 v0.1.3240 + 待重放的 fish.26），跨基线后会漂。
> 现状：已发 magpie 2.3.1（exe `v0.1.3207+fish.26`）；上游已到 `v0.1.3240`（落后 33 个 tag）。

## 0. 当前诊断状态（先看清，别误读）

已跑过 `tools/follow-upstream.ps1`（只诊断，未落补丁）：

| 项 | 值 |
| --- | --- |
| 基线 | v0.1.3240 |
| 重放对象 | `magpie-v0.1.3207+fish.26.patch`（123 文件 / 175 hunk） |
| 结果 | 干净 121 文件 / 173 hunk；**冲突 2 文件 / 2 hunk** |
| 冲突 | `[大] internal/gui/providers.go`（1 hunk）、`[小] docs/subsystems/gateway-routing.md`（1 hunk） |
| 产物 | `fish.27` **未生成**；`upstream.json` 目前是诊断记录（`result: conflicts`、`patch` 仍指 fish.26、`versionTag` 写成 `v0.1.3240+fish.27` 只是脚本的「目标」串） |

`.work/magpie-build/magpie-0.1.3240/` 里带 `.rej`，是这次诊断的现场，处理完再清。

## 一、上游追平（U 系列）

| 编号 | 任务 | 落点 / 做法 | 完成判据 |
| --- | --- | --- | --- |
| U1 | 消化 `providers.go` 冲突 | `providerInfoWith` 的 `providerJSON{}` 初始化行：上游在相邻字段继续加（上一轮已见过 `PassErrors` / `TakesPassErrors`），fish.26 加的 `MarksServesKinds: p.MarksServesKinds(),` 没进。手工补齐该字段 | 该行含 `MarksServesKinds`，`.rej` 消失 |
| U2 | 消化 `gateway-routing.md` 冲突 | #42 在「only a provider set up with a base URL can be marked」后加的那段，上游同段已改写。按上游新段落重写这段说明（六类标注 / `MarksServesKinds` / `ServedAs` / `PluginServing` / `PluginUnkinded`） | 文档段落在新基线上可读，内容与代码一致 |
| U3 | 重跑诊断到 clean | `follow-upstream.ps1` 再跑一次 | 输出「冲突 0 文件 / 0 hunk」，`upstream.json` `result: clean` |
| U4 | 生成 `fish.27` 补丁 | 在 3240 树上 `git add -A` → `git diff --cached --binary` → `patches/magpie-v0.1.3240+fish.27.patch`；另建干净 worktree `apply --check` | 补丁落盘、干净基线可应用 |
| U5 | 编译与回归 | `go build ./...`；`internal/provider` 全量；`internal/gateway -run 'Speakers\|Speech\|Embedding\|Video\|Kind\|Plugin'`；`internal/gui -run TestCoreScriptBudget` | 全绿（既有失败单列，需与基线对照） |
| U6 | 收尾 | 更新 `upstream.json`（`baseTag` / `baseSha` / `patch` / counts / `note6`）；删 `.rej`；`fish.26` 留作历史 | 记录与实物一致 |
| U7 | 版本位 | 与 sticky 同版（2.4.0）还是先单独 2.3.2 —— **待拍板**（见第五节） | `catalog/stable.json` 与 Release 一致 |

预估：U1/U2 是两处小改，U3–U6 是流程，合计半天内；主要不确定在 U1 是否只差一个字段（上一轮同类冲突就是这么解的）。

## 二、provider sticky（#41）的 A / B / C

### 已核事实（v0.1.3240 树）

| 事实 | 位置 |
| --- | --- |
| 内存态取供应商 | `internal/plugin/providers.go:311 func Providers(ctx)`（走宿主 RPC） |
| 磁盘快照 | 同文件 `:673 func Cached()`（读 `plugin-providers.json`）、`:560 func UseCached(`（测试注入） |
| 每小时重列与掉件处理 | `internal/provider/plugin_relist.go`：`KeepPluginsListed` / `pluginListedIDs` / `dropGonePluginPicks` / `keptListed` |
| 现状缺口 | `keptListed` 只按 `FellBack`（列表回退）保留，**provider 整个消失不在保留逻辑里** |
| 掉出后的用户可见状态 | `provider.Excluded()`（`internal/provider/account.go:364`）→ `Hidden()`（`internal/provider/provider.go:1051`）→ 前端 `renderExcluded`（`app.js:6626` 起，按钮「Add it back / Don't remind me / Sign out」）与 Add sheet「Removed from magpie」段（`app.js:7319` 起） |
| 已有的恢复原语 | `internal/provider/plugin_left.go:75 setAside`、`:105 takeBackLeft`（插件移除时把记录放一边、装回时放回） |
| 插件清单与 spec | `internal/plugin/store.go:196 Load()`；`plugin.Load().Plugins[].Spec` |
| 插件自定义 calls 通道 | NearToken 的 `package.json` 已有 `magpie.calls` 9 条（`neartoken:*`）；宿主侧白名单见 `internal/plugin/page.go:129` 一带 |

### 方案 A：provider 级 sticky（止住掉落）

- **目标**：`plugins.json` 里仍有该 spec、插件宿主未就绪时，其 provider 与模型留在供应商列表、模型清单、路由里，状态是「更新中 / 暂不可用」。
- **落点**
  1. `internal/plugin/providers.go`：`Providers(ctx)` 的结果与 `Cached()` 做并集；出现在 `Cached()`、这次没返回、且 spec 仍在 `plugins.json` 的，标 `Stale`（复用 `FellBack` 语义即可）。
  2. `internal/provider/plugin_relist.go`：`pluginListedIDs` / `keptListed` 对 stale 的 provider 跳过「掉件」对比（现在 `FellBack` 分支已是这个行为，扩到 provider 级）。
  3. `internal/provider/account.go`：`Excluded()` 不把 stale 的插件 provider 算作「用户移除」。
  4. `internal/gui/providers.go`：`providerJSON` 暴露 stale 标记（若复用 `fellBack` 则无需新字段，只需前端读它）。
  5. 前端：`app.js` 的行文案与「Removed from magpie」段按 stale 显示「更新中」，不出现「加回来」。
- **验收**：issue #41 的 1–5 条（保留在列表/路由、只有显式移除或 spec 不在清单才消失、重载后自动回正常、崩溃同样适用、保留期间用上次成功的模型表）。
- **风险**：`Cached()` 快照可能陈旧（模型表过期）；需明确 stale 期间 `Retrieve` 用哪份表（issue 第 5 条给了口径：上次成功的，空则用 `Cached()`）。

### 方案 B：清单字段 `keepListedUntilRemoved`（决定谁参与 A）

- **目标**：插件在 `package.json` 的 `magpie` 段声明 `keepListedUntilRemoved: true`，宿主只对该插件的 provider 启用 sticky。
- **落点**
  1. `internal/plugin/store.go`（清单结构）与 `load.go`（解析 `magpie` 段）加字段。
  2. `internal/provider/plugins.go`（或 `plugin` 包）暴露 `KeepListedUntilRemoved(spec) bool`。
  3. 方案 A 的并集逻辑按它开关；未声明的插件行为不变。
- **验收**：NearToken 声明后行为同 A；未声明的插件（如 purge）仍按旧逻辑掉出。
- **依赖**：A 先落地；B 只是开关，不改变 A 的语义。
- **NearToken 侧**：`package.json` 加该字段并随插件发版（与 `magpie.min` 一起抬）。

### 方案 C：NearToken 专用恢复钩子（让已经掉的回来）

- **目标**：provider 已经掉了（被记成 removed / 或 `left` 记录）时，NearToken 启动或重连后主动请求宿主「重新确认我的存在」，不需要用户点「加回来」。
- **落点**
  1. `internal/provider/plugin_left.go`：把 `takeBackLeft` 的「放回」能力抽成可被外部调用的 `RestorePluginProvider(id string) error`：清 `Hidden` 记录、放回 `left` 记录、触发一次重列。
  2. 宿主通道二选一（**待拍板**）：
     - 通用：`internal/plugin/page.go` 的 calls 白名单加 `magpie:provider`，`host.go` 分发到上面的函数；
     - 专用：沿 NearToken 已有的 9 条 `neartoken:*` 同一条路，加 `neartoken:relist`。
  3. NearToken 的 `index.mjs`：登录/启动完成后调用一次；失败静默并重试一次（不阻塞页面）。
- **验收**：把 provider 从列表移除后（模拟宿主崩溃窗口），插件重启并调用钩子后，供应商与模型自动回到列表；用户**显式**移除的仍然不回来（钩子不能覆盖用户意图）。
- **风险**：钩子与 A 的「stale 保留」要分清——A 是「保持」，C 是「事后恢复」；C 不得把用户主动移除的再加回来（需要区分 `removed by user` 与 `dropped by crash`，落在 `plugin_left.go` 的记录语义里）。
- **NearToken 侧**：新通道 + 调用时机 + 失败重试，单列在 magpie-neartoken 仓。

### 三者关系

A 止住掉落；B 决定哪些插件参与 A；C 兜底已经掉了的。三条可以同版交付，也可以 A+B 先发、C 随后——**待拍板**。

## 三、依赖与顺序

1. **先 U 后 sticky**：sticky 的补丁若基于 v0.1.3207，追平到 3240 时又要重放一次，多付一遍冲突成本。
2. A → B → C（B 是 A 的开关，C 复用 A 的恢复原语）。
3. C 落地需要 NearToken 同步发版，排在 A/B 之后、与插件版本一起。

## 四、完成判据

- `follow-upstream` clean；`fish.27` 在干净基线上 `apply --check` 通过；
- `go build ./...` 与相关包测试通过（既有失败与基线对照后单列）；
- 手动场景三条：宿主重启窗口内供应商不消失、掉了能自动回来、用户显式移除仍生效；
- 版本位、`catalog/stable.json`、Release 三处一致（沿用 2.3.1 的口径）。

## 五、新增需求：更新后插件包缺失（用户实拍）

**现象**（magpie 插件列表，`.fish-dock\.fishplugin-magpie\credentials\magpie-runtime\data\plugins\node_modules\…`）：

```
@fish-under-sea/magpie-checkin-relay-probe  没有加载成功: Error: no such plugin: …\node_modules\@fish-under-sea\magpie…
@fish-under-sea/opencode-meoo-auth          没有加载成功: Error: no such plugin: …\node_modules\@fish-under-sea\opencode…
```

同一列表里 `@fish-under-sea/magpie-purge` 正常（v0.5.0）。用户动作是「更新」之后出现。

**已核事实**

| 事实 | 位置 |
| --- | --- |
| 报错来源：加载前 `statSync(target)`，不存在就抛 | `internal/plugin/host.js:1405 entries()` |
| `target` 的推导 | `internal/plugin/store.go:422 Target()` = `<数据目录>/plugins/node_modules/<包名>` |
| 「装没装」的判断 | `internal/plugin/market.go:746 Installed()`：读 `<target>/package.json` 的 version，读不到就是没装 |
| 缺失即补装 | `internal/plugin/updates.go:291 InstallMissing()`：清单里有 spec、`Installed()` 为空就 `install()`，成功后 `Restart()` |
| 上游已知同类问题 | `internal/plugin/plugin_missing_test.go`（#2002：更新后每个插件都报同一句，直到卸了重装）——**这个修复 2.3.1 已带**（v0.1.3207 已有 `InstallMissing`） |
| 三个包在 npm 上都存在 | `@fish-under-sea/magpie-checkin-relay-probe@1.0.0`、`@fish-under-sea/opencode-meoo-auth@1.2.1`、`@fish-under-sea/magpie-purge@0.5.0` |

所以**不是包名写错**，而是「`Installed()` 判成没装 → `InstallMissing` 装 → 装完仍不可用，或根本没装成」：

1. `install()` 失败（国内网络直连 registry、包体积大、超时），错误只进 `errors.Join` 返回给调用方，界面上看到的是加载期的 `no such plugin`，不是安装失败的原因；
2. 半装：目录建了、`package.json` 还没落地就被下一次列表读到，或反过来，残留目录让 `Installed()` 与 `host.js` 的 `stat` 判断不一致；
3. `InstallMissing` 的调用时机（`KeepUpdated` 的循环）与用户看到列表的时刻之间有窗口，窗口内一直报错。

**要做**

| 编号 | 任务 | 落点 | 验收 |
| --- | --- | --- | --- |
| P1 | 安装失败可见、可重试 | `updates.go InstallMissing` 的返回要进到插件页（逐条 `spec: 原因`），页面给「重试安装」；不再只显示 `no such plugin` | 断网/超时场景下界面给的是「安装失败：原因」，点重试能成功 |
| P2 | 安装带镜像回退 | `install()` 的 registry 选择：npmmirror 优先、npmjs 兜底（与 npm 包发布口径一致） | 国内网络下三个预装包能装上 |
| P3 | 半装清理与一致性 | 安装失败清残留目录；`Installed()` 与 `Target()` 用同一份判定（别一处看目录、一处看 package.json） | 反复失败后 `InstallMissing` 仍是「未装」，不会卡在「装了但加载不了」 |
| P4 | 失败不阻塞其余插件 | 一个包失败不拖累其他包与宿主启动 | 三个包里坏一个，另外两个照常 |

## 六、新增需求：首装总进度弹窗 + 锁定

**目标**：新用户第一次打开 magpie（中心页）时，所有预装插件在下载/安装期间弹一个模态：一条总进度（已完成 / 总数），未完成前锁住后续点击。

**现状**

- 预装清单由 `preinstall.mjs` 写进 `plugins.json`（只写包名，不下载，见该文件第 10–20 行注释）；
- 装由上游的 `InstallMissing` 循环完成；
- 界面只有一个「还差几个」：`internal/gui/pluginpagecall.go:380 preinstallPending()`（读 `config/preinstall-state.json` 的 registered 列表 + `Installed()` 对比），调用点在 `pluginpagecall.go:365`。

**要做**

| 编号 | 任务 | 落点 | 验收 |
| --- | --- | --- | --- |
| Q1 | 后端给逐包进度 | 把 `preinstallPending()` 扩成「总数 + 每包状态（等待 / 安装中 / 完成 / 失败）」，经页面接口下发 | 接口返回 N 个包与各自状态 |
| Q2 | 首装模态与总进度条 | magpie 管理页（`internal/gui/assets/app.js`）首装时弹模态，轮询 Q1 的进度，显示「已完成 x/N」 | 首次启动能看到总进度 |
| Q3 | 未完成锁定 | **只挡 magpie 管理页内**：模态期间遮罩与禁用都只作用于该页，FISH Dock 的插件入口与其它页面不受影响；完成或全部失败后才放行 | 进度未完成时 magpie 页内点不动后面的东西，宿主侧照常可操作 |
| Q4 | 失败出口 | 全部失败或部分失败时，模态给「重试 / 稍后（跳过） / 以后不再提示」三个出口，不把用户关死；「以后不再提示」落一份本地标记，之后首装不再弹（插件页仍能看到失败项） | 断网时能退出，且插件页能看到失败项（与 P1 同一个展示） |

**注意**：进度只能「轮询 `plugins.json` 与 `Installed()` 的差值」得到（安装是上游 `InstallMissing` 循环做的，没有逐包回调）；如果上游后续提供安装事件，Q1 应改成订阅。

## 七、新增需求：自启动适配（#45，本轮新增）

宿主 2.1.6（`FISH-Dock/app/docs/release-2.1.6.md`）修了「插件 → 宿主」存储回调排队导致的冷启超时（第一次自启失败的根因），并在说明第 67 行留话：插件侧的「准备阶段失败不进重试、`view()` 多次读盘」这轮没改，已记进插件仓。这一单一并做掉，Magpie 与 Clash 同时改。

**现状（已核，2.3.1 / fish.26）**

| 插件 | 问题 |
| --- | --- |
| Magpie `plugins/magpie/backend.mjs` | `FISH_PLUGIN_AUTOSTART==='1' && service.view().state==='stopped'` 把可能异步的 `view()` 当同步读（返回 Promise 时 `.state` 为 undefined，自启那次根本不会起）；`launchGateway` 的重试只认 `isRetryableFailure(lastFailure?.code)`，而 `lastFailure` 只由 `tracked.start` 记——准备阶段（`service.load()`、`repairPackagedExecutable()`）失败不重试；`catch` 里又读一次 `view()` |
| Clash `plugins/clash/backend.mjs` | `autostartKernel` 的退避（0 / 1.5 / 4 秒）只包住 `service.start()`；`service.view()` 与 `repairPackagedKernel` 在重试范围之外，失败只打一行「自启动准备失败」就结束；准备段与 `catch` 各读一次 `view()` |

**任务**

| 编号 | 任务 | 落点 |
| --- | --- | --- |
| R1 | 自启判断先 `await view()` 再读 `.state`，两插件统一 | magpie / clash 的 `backend.mjs` activate |
| R2 | **准备阶段失败也进同一退避序列**（0 / 1.5 / 4 秒），最后一轮才写日志 | magpie `launchGateway` + `startWithBackoff`；clash `autostartKernel` 的 try 范围 |
| R3 | `view()` 每轮自启只读一次，判断/日志/修复复用同一份快照 | 两插件 |
| R4 | 自启失败不抛 `activate()`（插件不能因此被判坏），页面可手动重试 | 两插件 |
| R5 | 官方姿势落 `docs/developers/autostart-hook.md`：第 3 节补「准备阶段失败同样进重试」「`view()` 只读一次且先 await」两条，自测清单加一条「冷启慢盘」用例 | 插件仓开发者文档 |

**验收**：带 `FISH_PLUGIN_AUTOSTART=1` 冷启两插件都能起；人为让准备阶段慢/失败时在退避内恢复且只有一条最终日志；同一轮 `view()` 只读一次；自启失败后插件仍激活、页面能重试；按更新后的文档写法能复现通过。

## 八、已定决策（本轮确认）

| 项 | 结论 |
| --- | --- |
| 版本号 | **2.3.2**；追平上游、sticky、更新失败修复（P）、首装进度（Q）、自启动适配（R）全部同版 |
| Clash | 纳入本次：既要跟着发 2.3.2，也要做自启动适配（#45 的 R1–R5），`catalog/stable.json` 的 clash 条目一起改 |
| 自启动适配 | **#45** 进 2.3.2：Magpie 与 Clash 的 `backend.mjs` 按 R1–R4 改，官方姿势落 `docs/developers/autostart-hook.md`（R5） |
| C 的通道 | **专用** `neartoken:relist`（沿 NearToken 既有 9 条 `neartoken:*` 的口径） |
| B 的默认 | **显式开启**：插件在 `package.json` 的 `magpie` 段声明 `keepListedUntilRemoved: true` 才参与 sticky。理由：未声明的插件（purge、checkin-relay-probe、meoo-auth）行为完全不变，不影响其他使用 |
| NearToken 侧 | 声明 B 的字段 + 调用 C 的钩子 + 抬 `magpie.min`，单列到 magpie-neartoken 仓 |
| Q3 锁定范围 | **只挡 magpie 管理页内**，FISH Dock 的插件入口与其它页面不受影响 |
| Q4 失败出口 | 「重试 / 稍后（跳过） / 以后不再提示」三个出口；最后一项落本地标记，之后首装不再弹 |

## 九、仍待确认

无。清单到此齐了，按「三、依赖与顺序」开工：先 U1（追平冲突），再 A → B → C，P/Q/R 与 sticky 同版 2.3.2。

