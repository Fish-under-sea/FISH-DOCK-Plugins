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