# 2.2.2 批次：issue 29–34 落实计划（探测结论 + 实施路径）

> 状态：**待批准**。批准后按本文件批次执行。
> 探测时间：2026-11-06。所有结论都来自当前工作区代码实测，不是推测。

## 一、六条 issue 的真实边界（先分清哪些能立刻做）

| # | 标题 | 侧 | 触碰面 | 是否需 Go 工具链 |
| --- | --- | --- | --- | --- |
| 29 | Kiro 移出预装基线 | 插件 Node | `preinstall.mjs` + `preinstall.test.mjs` | 否 |
| 30 | 网关端口固定 | 插件 Node | `network.mjs` / `runtime.mjs` / `shared/gateway.mjs` + 测试 | 否 |
| 31 | 跟随上游、不写死版本 | 工具链 | `tools/build-magpie.ps1`、新增 follow 脚本、`tools/README.md`、`patches/upstream.json` | **是**（且要真追平） |
| 32 | 内置插件更名 `@fish-under-sea/<名>` | 插件 Node | `page-seed.mjs`、`runtime.mjs`、两个 `package.json`、测试 | 否 |
| 33 | `neartoken:prefs` + `neartoken:usage` 逐条流水 | **宿主 Go（补丁内）** | `internal/neartoken/*`（dispatch / Manager / client.readUsage） | **是** |
| 34 | 探针页不铺满 | 插件 CSS | `page-relay-probe/page/style.css`（51 行） | 否 |

**结论**：#29 / #30 / #32 / #34 是纯 Node 与 CSS，可立即实现并用现有 `node --test` 验收；#31 与 #33 落在 Go 侧，本机当前**没有 Go 工具链**（全盘搜 `go.exe` 无结果，`D:\Fish-code\DSH\工具` 下只有 Rust / 浏览器 / npm-cache），必须先解决工具链。

## 二、逐条探测：路径、坑与最优解

### #29 Kiro 移出预装

**现状**：`preinstall.mjs:23-44` 的 `BASELINE` 共 13 家，`:28` 是 `['kiro', 'Kiro']`；`preinstall.test.mjs:17-27` 断言 `PREINSTALLED.length === 13` 且逐项列名（`:23` 命中 kiro），每条 spec 必须 `<package>@latest`。

**改动**：删 `BASELINE` 那行 + 注释（照 zen-free 的写法说明「已装用户不动、素材保留」）；测试 13→12、名单去 kiro、新增「基线不含 kiro」的负向断言。

**坑（必须处理）**：
1. **已装用户不能被卸载** —— 现有 `seedPreinstalled()` 只按 marker 差集补登记（`preinstall.mjs:229-242`），从基线删项天然不会卸载，符合要求；但 `pendingStems` 会少一家，页面「还差几家」随之变化，属预期。
2. **素材不能删** —— 签到页 `page-checkin/page/app.js:98` 有 `kiro: 1, "kiro-color": 1` 缩放项、`page/` 下有 `kiro.svg` / `kiro-color.svg`；宿主补丁有 `brandicons/kiro.svg` 与 `brandVendors` 允许表。已装用户 provider 还在，删素材会让老用户掉图标 → **全部保留**。
3. **与 #20 有交集** —— #20 要把 Meoo 换掉（同样动 `BASELINE`）。**顺序上 #29 先做**（纯删项、零迁移风险），#20 后做（要换包 + 迁移）。

### #30 网关端口固定

**现状**：`runtime.mjs:110-112`

```js
let listeningPort
if (prefs.lan) listeningPort = await lanGatewayPort({configured: gatewayPort, prefs, port, upstreamPort})
else do { listeningPort = await freePort() } while (...)
```

LAN 关闭（默认）走随机；LAN 开启才走 `gatewayPortCandidates()`。而且**挑到的端口从不写回**：`shared/gateway.mjs:41` 的 `save()` 在 `running` 时直接 `throw '请先停止服务再修改启动参数'`，所以「启动成功后自己回写」走不通。

**最优解（三步，都不改对外语义）**：
1. `runtime.mjs`：把 `lanGatewayPort` 重命名为 `gatewayPortFor`，**两条分支都走它**（LAN 只影响 `gatewayHost()`，不影响端口值）；返回 `{port, fellBack}` 以便页面说明「首选被占、已用 N」。
2. `runtime.start()` 的返回值加上 `gatewayPort`（现有返回 `{alive,url,runtime,stop}`，只加字段，不改签名）。
3. `shared/gateway.mjs`：新增内部 `persist(patch)`（复用 `validate` + `context.storage.write`），在 `start()` 成功、`state='running'` 之前调用一次把 `gatewayPort` 落盘；**`save()` 的 running 守卫一字不动**。`view()` 自然带上新端口。

**坑**：
- `gateway.mjs:60` 的 `Number(url.port) !== config.port` 校验的是**服务端口**（3425），与 `gatewayPort` 无关，不能一起改。
- 端口被占回退后要**记住回退值**（下次仍用 3427 而不是跳回 3426），所以 persist 写的是实际监听值。
- `upstreamPort`（`runtime.mjs:96`）是插件内部代理上游，保持随机，不动。

### #31 跟随上游（最重的一条）

**实测差距**：我们基线 `v0.1.2799`（2026-11-03T04:47Z），上游最新 `v0.1.3070`（2026-11-05T18:57Z），约 **271 个 tag**；上游 2 小时 12 分发过 8 个 release（含相隔 42 秒的两个）。

**写死位置**：`tools/README.md:3`、构建示例 `:67-78`（`fetch --depth=1 origin tag v0.1.2799`、`-VersionTag v0.1.2799+fish.15`）、补丁文件名、`build-magpie.ps1:11` 默认 `-VersionTag = 'v0.1.2336+fish.3'`。

**现状阻碍（关键）**：
- **本机无 Go 工具链**（`build-magpie.ps1:24-27` 要求 `<构建根>\toolchain\go\bin\go.exe`）。
- 可达性已实测：`mirrors.ustc.edu.cn` 的 `go1.26.8.windows-amd64.zip` **200 / 74,957,586 字节**；`codeload.github.com/yetone/magpie/tar.gz/refs/tags/v0.1.3070` **200**；`goproxy.cn` **200**。所以「下载 Go + 取上游」这条链是通的，只是没做。
- 补丁体量：`fish.15` 触碰 **111 个文件 / 12,223 行**，其中 `internal/` 占 107 个。跨 271 个 tag 重放，**大冲突几乎必然**。

**方案（分两步，别一次做到底）**：
1. **工具链**：按 `tools/download-go.py` 的既有口径（Go 1.26.8，USTC/阿里/Google 三源）装到 `<构建根>\toolchain\go`，并用 `goproxy.cn` 走模块。
2. **追平脚本** `tools/follow-upstream.ps1`：
   - 解析最新 tag（`releases/latest` 或 `ls-remote --tags` 取最大），`-Tag` 可覆盖；
   - `fetch --depth=1` + `worktree` 到 `<构建根>\upstream-<tag>`；
   - `git apply -3` 现有补丁 → **冲突分三档**（0 冲突 / 小冲突（预算常量、版本串、文档，按规则自动改并留 diff）/ 大冲突（停下交人工，列文件与 hunk））；
   - 编译 + `stage-development.mjs` + 生成 `patches/upstream.json`（tag / sha / 抓取时间 / 补丁名 / exe 版本串，**生成物不手维护**）。
3. **落后闸门**：发布前检查「落后 ≤ 24 小时 或 ≤ 10 个 tag」，超了拒绝并打印差距。

**诚实结论**：第 2 步是**有真实失败风险**的活（111 文件跨 271 tag）。我的判断是**先跑一次「只诊断不合并」**：把最新 tag 拉下来、`git apply --check` 现有补丁、把冲突清单打出来。拿到真实冲突规模后再决定是「逐段重放」还是「按上游新结构重写某几段」。**不在没有冲突清单的情况下承诺一次追平**。

### #32 内置插件更名

**现状**：`page-checkin` 的 `package.json` 是 `@magpie-community/page-checkin`（**第三方 scope**）；`page-relay-probe` 是裸名 `page-relay-probe`（还带 `private: true`）；标题一个 `Check-in`、一个 `中转站探针`。

**改动点（含真实坑）**：
1. 两个 `package.json`：`name` 改成 **全小写** `@fish-under-sea/page-checkin` / `@fish-under-sea/page-relay-probe`（npm 规范，大写 scope 发包会被拒；`@Fish-under-sea/…` 只用于显示）。
2. `page-seed.mjs:6` `seedDirectoryName`、`runtime.mjs:121` 同步名单 —— 目录名保持不变（`<data>/plugins/page-checkin`），**只改包名身份**，减少迁移面。
3. **`isSeedSpec()`（`page-seed.mjs:76-83`）里硬编码 `@magpie-community/${name}`**：不改成「新旧都认」，升级后旧条目识别不出来 → `rewriteSeedSpec` 追加新条目 → **新旧并存**。必须改成同时匹配 `@magpie-community/<name>`、`@fish-under-sea/<name>`、绝对路径。
4. 测试：`page-seed.test.mjs` 里 5 处 `@magpie-community/page-checkin`（`:17/75/76/82/200`）与「别的插件不受影响」用例（`:86`）要一起改，并新增「旧 scope 也能命中、且只留一条」。
5. **`repository` 字段也要一起改**：`page-checkin/package.json:8` 现在指向 `git+https://github.com/magpie-community/plugins.git`（第三方仓），改成 `git+https://github.com/Fish-under-sea/FISH-DOCK-Plugins.git` 并补 `directory`；`license: MIT` 保留。
6. **误伤排查结论**：宿主补丁 `:1469`、`:6420` 里的 `"name":"page-checkin"` / `"page-relay-probe"` 是 **Go 测试夹具**（`pack()` 造的临时 package.json），不是生产代码 —— 不需要改。顶层 `plugins/relay-probe/`（无 `package.json`、`fish.relay-probe` 开发预览件）与内置 `page-relay-probe` 是**两套东西**，不要混改。

### #33 `neartoken:prefs` + `neartoken:usage` 逐条流水
**现状（补丁内实测）**：
- `dispatch()`（补丁 `:3844-3864`）只认 8 个调用：`state / connect / cancel / open / disconnect / refresh / usage / topup`，**没有 `neartoken:prefs`**。
- `usage()`（`:3860` 起）调 `client.readUsage()`；`readUsage` 只解析站点 `/usage-logs/` 的 `models` 与 `buckets`（按模型汇总），**没有逐条 rows**。
- 白名单里也没有 prefs（`:6483-6484`、`:6576-6577` 的 calls 清单）。

**实现路径**：
1. **prefs**：新增 `internal/neartoken/prefs.go` —— `prefsPath()` 落 `<data>/config/neartoken-prefs.json`（与 `preinstall-state.json` 同层），`dispatch` 加 `case "neartoken:prefs"`（`get`/`set` 两形），写入**不触 provider 重建**（它不经过 `plugin` 的 options 通道）。白名单同步加一条。
2. **usage rows**：`readUsage` 增加第二个请求（站点逐条日志路径），解析成 `rows` 数组并按契约输出（`time/kind/tokenName/group/model/effort/tps/input/output/bytes/cost/ttft/dur/detail`）；站点不支持时返回空数组而不是编数据（沿用现有 `Available:false` 的诚实口径）。

**依赖与风险（关键）**：
- 这是 **Go 侧改动**，落在补丁里，需要 Go 工具链。
- **与 #31 强耦合**：如果先做 #33、再追平 #31，那 #33 的 Go 代码要在新基线上重打一遍，**白做一次**。**最优顺序是 #31 追平落地后，在追平后的基线上做 #33**。
- 站点逐条日志的**真实接口未验证**（`/usage-logs/common` 是插件侧描述，补丁里 `usagePath` 只有汇总路径）。因此 #33 第二步要先做一次真实探测；拿不到就只落 prefs，把 rows 留到探测有结论再补。

### #34 探针页不铺满

**现状**：`page-relay-probe/page/style.css` 共 51 行，**只有** `#relay { max-width: 880px }`（`:4`），没有 `body` 规则；`index.html` 是 `<main id="relay">` + 四个 `section.card`，`table { width: 100% }`（`:38`）相对 880 计算。签到页 `page-checkin/page/style.css:4` 只有 `body { padding: … }`、无上限 —— 所以**这是探针页自己加的限制**。

**方案**：删 `max-width` 或改 `none`；≥1200px 给栅格（「结论」与「三组探针」并排 或 `#probes` 列宽比例）；长串 `overflow-wrap: anywhere`；窄面板 360/420 不横向滚动。

**最优解补充**：与其只删一行，**建议同时给 `body` 内衬**（现在探针页靠 magpie 基础样式给内衬，宽屏会贴边）。这是 #34 里唯一需要判断的点，我按「加 `body { padding: 18px 20px 28px }` 与签到页对齐」处理。

## 三、批次与顺序（关键结论）

**批 A：纯 Node / CSS，可立即实现（今天就能落）**
1. #29 Kiro 移出预装（最小、零风险）
2. #34 探针页铺满（纯 CSS）
3. #32 内置插件更名（含 `isSeedSpec` 兼容与迁移测试）
4. #30 端口固定（含内部 persist，避开 `save()` 守卫）

**批 B：需要 Go 工具链，先诊断后决定**
5. #31 第一步：装 Go 工具链（镜像已实测 200）+ 拉最新 tag + `git apply --check` 打出**真实冲突清单**；**此时停下汇报**，不承诺一次追平。
6. #31 第二步（拿到冲突清单后）：逐段重放 / 局部重写，落新基线。
7. #33（依赖 #31 落地）：prefs 一定做；usage rows 先探测站点真实接口，拿不到就只落 prefs。

**为什么这个顺序**：#30 / #32 / #34 都不碰 Go 补丁，不会被上游追平推翻；#29 先于 #20 避免同一份 `BASELINE` 两次返工；#33 必须在 #31 之后，否则 Go 改动白做。

## 四、验收口径（每条都写成可执行）

| # | 验收命令 / 判据 |
| --- | --- |
| 29 | `node --test --test-isolation=none "plugins/magpie/preinstall.test.mjs"` 全绿；新增「基线不含 kiro」；已装用户路径（marker 有 kiro）不被卸载 |
| 30 | `network.test.mjs` + `gateway.test.mjs` + `runtime.test.mjs` 全绿；新增「非 LAN 也走固定候选」「回退值被持久化」「重启沿用回退值」 |
| 32 | `page-seed.test.mjs` 全绿；新增「旧 scope 命中且只留一条」；`grep '@magpie-community/page-checkin'` 只剩旧补丁 |
| 34 | `page-relay-probe/page/app.test.mjs` 全绿；三档宽度无横向滚动（`scrollWidth <= innerWidth`） |
| 31 | 诊断：冲突清单（文件 + hunk 数）；追平后：`stage-development` + `catalog` + 页面实测通过，`grep 'v0\.1\.2799'` 只剩历史记录 |
| 33 | prefs：`get/set` 往返 + 不触发 provider 重建（Go 单测）；rows：站点支持时字段齐全、不支持时空数组 |

## 五、明确不做 / 不承诺

- **不承诺一次追平 271 个 tag**：先出冲突清单，再定策略。
- 不改 12 家第三方 `@magpie-community/opencode-*-auth` 的名字。
- 不删 Kiro / Meoo 的品牌素材（服务已装用户）。
- 不为了「端口固定」把 `save()` 的 running 守卫去掉（用户仍要能改端口，只是改成走内部 persist）。
- 不在批 A 里动任何 Go 补丁；批 B 的 #33 rows 若探测不到真实接口，只落 prefs 并如实标注。
---

## 六、追加需求（2026-11-06 后加）：Meoo 改由 `@fish-under-sea/opencode-meoo-auth` 承担

> 归属 **#20 的 ②**（原「Meoo 换模型直连」）。范围收窄、结论更明确：
> **彻底移除上游的建站 Agent（`magpie-plugin-meoo-agent` / provider id `meoo-agent`），
> 换成我们自己的 `@fish-under-sea/opencode-meoo-auth`（provider id `meoo`），
> 品牌图标美化也跟着挪到这个包上。不再支持建站 Agent 形态的 Meoo。**

### 依据（实测）

| 事实 | 值 |
| --- | --- |
| 新包 | `@fish-under-sea/opencode-meoo-auth`，npm `latest` = **1.2.0**（7 个版本：1.0.0 → 1.2.0） |
| provider id | 包内 `index.mjs:26` `const PROVIDER_ID = "meoo"` |
| 显示名 | `package.json` 的 `magpie.name` = **`Meoo`**，带 `magpie.summary`（中英）与 `data:` 图标 |
| 登录 | 浏览器 PKCE 授权 → 项目服务 AK → OpenAI 兼容网关；可复用本机 `dsh-meoo-connect` 的 `state.json` |
| 旧包 | `magpie-plugin-meoo-agent`（`github:RexVane/magpie-plugin-meoo-agent`），npm 上 404，只能 git spec 装；provider id `meoo-agent` |

两者是**两个不同的 provider id**（新包 README 明写「`meoo` 与 `meoo-agent` 可以并存」），所以这是一次**替换**而不是升级。

### 改动清单

**A. Node 侧（本仓）**
1. `plugins/magpie/preinstall.mjs` 的 `BASELINE`：把
   `['meoo-agent', 'Meoo 秒悟（建站 Agent）', {package:'magpie-plugin-meoo-agent', spec:'github:RexVane/magpie-plugin-meoo-agent'}]`
   换成 `['meoo', 'Meoo 秒悟', {package:'@fish-under-sea/opencode-meoo-auth', spec:'@fish-under-sea/opencode-meoo-auth@latest'}]`。
   基线总数仍是 12 家（一进一出）。
2. `preinstall.test.mjs`：名单里 `magpie-plugin-meoo-agent` → `@fish-under-sea/opencode-meoo-auth`；
   「Meoo 走显式规格」的用例保留（新包同样不走 `@magpie-community/opencode-<stem>-auth` 拼名）；
   新增「不再登记 meoo-agent」的负向断言。
3. **已装用户**：从基线删项不会触发卸载（`seedPreinstalled` 只按 marker 差集补登记），
   旧 `meoo-agent` 插件与它的数据/凭据原样保留——与 zen-free、Kiro 同一套处置。

**B. Go 侧（补丁）**
1. `internal/provider/brandicons/meoo-agent.png` → **`meoo.png`**（素材改名，内容不变）。
2. `brandVendors` 允许表里 `"meoo-agent"` → **`"meoo"`**，否则新 provider 拿不到我们的美化。
3. 断言 `github:RexVane/magpie-plugin-meoo-agent` 的图标那条测试（`fish.10/11`）改成新包 spec，
   并保留「`meoo` 命中 `file:` 值」的校验。
4. 补丁序号 **fish.16**，基线仍是 `v0.1.2799`（#31 追平后再一并重放）。

### 验收

1. 干净数据根：`plugins.json` 里有 `@fish-under-sea/opencode-meoo-auth@latest`，**没有** `magpie-plugin-meoo-agent`；`pendingStems` 仍按 12 家算。
2. 已装 `meoo-agent` 的用户：旧条目保留、不被卸载；两个 provider 并存时页面能看出来是两个。
3. 图标：装上新包后，`meoo` provider 的图标是我们 `brandicons/meoo.png` 那套（`file:` 值），四处（插件列表 / 供应商页 / 侧边栏 / 路由卡片）一致。
4. `node --test` 与 `go test ./internal/provider/` 针对本次改动全绿。
---

## 七、追平上游（#31 的第二步）：v0.1.2799 → v0.1.3140，26 个冲突全部消化

> 2026-11-06。基线跨 **337+ 个 tag**（上游 24h loop，实测 2 小时 12 分发过 8 个 release）。

### 结论：分类统一到上游 `Serves`，不再自己造字段

诊断出的 26 个冲突 hunk 里，**12 个是「我们另造了一套模型分类」**造成的。核查干净基线（未打补丁的 `v0.1.3140`）后确认上游早就有：

| 上游原生 | 位置 | 我们的重复实现 | 处置 |
| --- | --- | --- | --- |
| `Model.Draws` / `Model.Films` | `catalog.go:124/128` | 一致（复用） | 保留上游 |
| `Model.Serves` + `ServesEmbedding/ServesRerank/ServesSpeech/ServesTranscription` + `ServesOf(id)` | `catalog.go:134/1939-1967` | `Model.Audio` / `Model.Embedding` 两个布尔 | **删我们的，改用 Serves** |
| `provider.HiddenVideomakers` + `OfferedVideomakers` | `provider.go:582`、`video.go:106` | `hiddenFilms` | **删我们的，改用上游** |
| `/v1/models` 的 `kind: image/video` | `gateway.go:1441/1470` | — | 复用；我们补 speech/transcription/embedding/rerank |

保留的（上游没有）：`HiddenAudios` / `HiddenEmbeddings` 两份取消勾选集合、设置页 `SpeechModel`/`EmbedModel`、`gateway.Speakers`/`Embedders`、`/v1/models` 的 `X-Magpie-Speakers` / `X-Magpie-Embedders` 两类。

### 逐处改法

| 文件 | 冲突 hunk | 处理 |
| --- | --- | --- |
| `catalog/catalog.go`、`catalog/live.go`、`gateway/video.go` | 1+4+1 | **整份回退到上游**（我们的分类代码作废） |
| `provider/plugins.go` | —（干净应用但会编译不过） | 插件 `capabilities.output` 改成写 `Serves`；声明优先、`ServesOf` 兜底 |
| `gui/providers.go` | 4 | `chatOnly` 改用 `!Draws && !Films && Serves == ""`（与 `catalog.Chat` 同一判据）；新增 `Audios/AudioIDs/HiddenAudios`、`Embeddings/EmbeddingIDs/HiddenEmbeddings`；保存路由与「未传即沿用」补齐 |
| `provider/provider.go` | 2 | 只保留 `HiddenAudios`/`HiddenEmbeddings` + `accountSettings` 复制 |
| `provider/group.go` | 1 | 保留 `Group.Images`（`*bool`）深拷贝——上游缺 |
| `settings/settings.go` | 1 | 保留 `SpeechModel`/`EmbedModel` 形状校验 |
| `gui/assets/app.js` | 5 | 上游已有 `renderDrawers`/`renderVideomakers`；补 `renderSpeakers`/`renderEmbedders`，两个保存体加 `hiddenAudios`/`hiddenEmbeddings` |
| `gui/assets/i18n.js` | 1 | 补 14 条中文（语音/向量两栏、图片输入三态） |
| `gui/assets/plugins/routing/client.js` | 2 | 上游有「图片输入」UI 但**保存体没发** `images`/`imagesSaid`——补上 |
| `gui/assets/plugins.js` | 1 | 已装行先用自己的图（FISH 专有），并修掉原补丁里的缩进错位 |
| `gui/core_budget_test.go` | 1 | 实测 1,539,633（上游 1,533,802 + 5,831），按上游规矩按实测数上调、不留余量 |

### 验收（本机 Go 1.26.8）

- `git apply --check` 在干净 `v0.1.3140` 上通过，应用后 59 项改动；
- `go build ./...` exit 0；
- `gofmt -l` 无输出；
- `go test ./internal/catalog ./internal/settings` 通过；`./internal/gui` 只余环境性失败（`%AppData% is not defined`、symlink 需特权、网关容器用例），**在干净基线上同样失败**；
- 分组预览（真实 `providerInfoWith` 跑出来的 HTML）：LLM 3 / 图像 2 / 视频 2 / 语音 3（speech+transcription 一栏）/ 向量 2（embedding+rerank 一栏）；取消勾选 `tts-1` 后**供应商仍在列表**、其它四类一个不少、可挑选列表 3→2。

### 还没做的

- **#33**（`neartoken:prefs` + usage 逐条 rows）：现在追平落地了，可以在 `v0.1.3140` 基线上动 Go 了；
- 落后闸门（≤24h 或 ≤10 tag）还没接进发布脚本；
- 没出包（用户明确「暂时不打包发版」）。
---

## 八、#33 与落后闸门（2026-11-06 落实）

### 8.1 落后闸门（#31 第二节第 5 条 + 验收第 4 条）

新增 `plugins/magpie/tools/check-upstream-freshness.ps1`：

- 判据：**记录的基线 ≤24 小时内抓的** 或 **基线之上上游只多了 ≤10 个 tag**，两项都超才算落后（任一满足即放行）；
- 数据源：`patches/upstream.json` 的 `baseTag`/`fetchedAt` + 现场 `gh api repos/yetone/magpie/tags`（不读缓存记录，缓存本身可能就是旧的）；
- 退出码：`0` 新鲜 / `2` 落后（`-RequireLatest` 时）/ `3` 判不了（记录缺失、取不到上游）；
- 离线可复现：`-LatestTag` 覆盖最新 tag、`-Now` 覆盖时钟、`-Record` 指向别的记录。

接进构建：`build-magpie.ps1` 开头调它 `-RequireLatest`，**跟不上直接 throw 不编**（`-SkipFreshness` 才跳过）。

验收演练（#31 要求的那次）：

```
pwsh tools\check-upstream-freshness.ps1 `
  -Record .work\preview\fake-behind.json -LatestTag v0.1.3140 `
  -Now '2026-11-06T17:50:00+08:00' -RequireLatest

  基线      v0.1.3110（11-03 17:46 抓的，72.1 小时前）
  上游最新  v0.1.3140
  落后      30 个 tag
  结论      落后：72.1 小时前抓的基线，上游已多 30 个 tag
  → exit 2
```

现状是「新鲜」：基线 0.3 小时前抓的，上游已到 v0.1.3148，只多 8 个 tag（≤10）。

一个踩到的坑记在这里：局部变量不能叫 `$now`——PowerShell 变量名**不区分大小写**，会和参数 `$Now` 撞名，赋值时又被转回 `[string]`，报的却是「无法把日期转成 Int32」。改用 `$clockNow` / `$recordedAt`。

### 8.2 #33 neartoken 设置界面通道 + 用量逐条流水

**① `neartoken:prefs`（已落，fish.18）**

- 新增 `internal/neartoken/prefs.go`：`Prefs{disabled, hiddenGroups, pinned, updatedAt}` 落 `<config>/neartoken-prefs.json`，先写 `.tmp` 再改名；
- `manager.go` 的 `dispatch` 加 `case "neartoken:prefs"`，三种动作 `get`（缺省）/ `set` / `clear`，参数形状不对报 `INVALID_PARAM`；
- **不经插件 options 通道**：只写这个文件与内存缓存，插件不重建 ⇒ 供应商列表不进不出。用例 `TestPrefsLeaveProvidersAlone` 直接比对 `providers.json` 字节不变。
- 页面侧还要在插件自己的 `package.json` 的 `magpie.calls` 里加一条 `neartoken:prefs`（宿主白名单），那在社区插件仓，不在本仓。

**② `neartoken:usage` 逐条 rows（已落契约，等站点）**

- `UsageWindow` 加 `Rows []UsageRow`（`time/timestamp/kind/tokenName/group/model/effort/tps/input/output/bytes/cost/costText/ttft/dur/detail`）；
- `readUsage` 解析应答里的 `rows`（站点自己的下划线字段名），**没有这层数据时给空数组而不是 nil**，`Available` 仍为 true——页面据此说「这个窗口没有逐条记录」，不把「站点没这功能」说成「查询失败」；
- 站点逐条日志的真实路径仍未验证（现有只有一个汇总端点 `/api/dsh/device/usage`），所以这一步是**契约先行**：站点一旦在同一个应答里给出 `rows`，页面立即可用；不给就一直是空数组。