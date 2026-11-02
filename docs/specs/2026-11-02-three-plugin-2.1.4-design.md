# 三插件 2.1.4 设计规格（飞书跟随重构 · Clash 微调与订阅热切换 · Magpie 后端落地）

> 状态：待用户审查。批准后进入实现计划（AgentTeams DAG），不批准不动代码。
> 工作目录：`FISH-Dock-1103`（`FISH-Dock-Plugins` @ `7cfeed7` 的快照）。主仓 `FISH-Dock` 不在本次范围。
> 分类：架构级（跨三插件 + 新增 `fish.9` 补丁与 exe 重编路径 + Clash 新增「运行中热切换配置」能力 + 统一发版）。

## 1. 目标与范围

**三个交付物，一个版本号 `2.1.4`**：

| 插件 | 起始 | 目标 | 内容 |
| --- | --- | --- | --- |
| `fish.feishu` | 2.1.0 | **2.1.4** | UI/UX 跟随 2.1.3 的设计语言（token、层级、按钮语义、状态与文案），**单栏与双栏两套布局分别设计** |
| `fish.clash` | 2.1.3 | **2.1.4** | ① disabled 胶囊按钮被压成竖排圆块；② **订阅点按热切换（单选、不重启内核）**；③ 移除详情卡「复制」按钮并统一左右两栏行高基线 |
| `fish.magpie` | 2.1.3 | **2.1.4** | ① **追上游**：自编译基线 `v0.1.2336` → 上游最新；② issue #18 五项落地（`fish.9` 补丁 + 重编 exe）；③ 页面侧接线（`preinstall-state` / `pendingPlugins`） |

**不做**（明确排除，避免范围蔓延）：
- 不改 `fish.ofm`（2.0.1，暂停维护）；
- 不改任何插件的 RPC **方法名**与既有参数语义（`subscriptionToggle` 语义会扩展，见 §3.3，但不改签名）；
- 不重构 `shared/`（`dock.css` 的浅色盲区仍由各页自带 token 绕开）；
- 不做 2.1.3 遗留的「Clash 下拉两处记录不修」细节（`pop.focus()` 顺序、`.lb-option:focus-visible`），留作 #17 后续。

## 2. 现状与证据

### 2.1 Clash 的按钮错位（截图已确认）

`.switch-row`（`plugins/clash/page.css:120`）是 `display:flex; justify-content:space-between`；按钮沿用 `shared/dock.css` 的胶囊（`border-radius:999px; padding:4px 14px`），**既无 `flex` 约束也无 `white-space:nowrap`**。左侧文案一长（本次还叠了「· 内核未运行，无法接管系统代理」），按钮被压到 min-content 宽度，「开启」两字折行 → 视觉上成了圆块；`disabled` 只降透明度，看起来仍像可点。

### 2.2 订阅点按切换为什么失效（三处叠加，全部有据）

| 层 | 事实 | 后果 |
| --- | --- | --- |
| 服务端 | `service.mjs:413 editable()`：`if(alive()\|\|operation) throw KERNEL_RUNNING_LOCK`；而 `subscriptionToggle`（`:465`）第一行就是 `editable()` | **内核运行中切换启用被直接拒绝** |
| 运行时 | 配置只在 `runtime.start({...subscriptions: enabled})` 里生成（`runtime.mjs:83` 拼 `proxy-providers`），随后 spawn mihomo | 换启用集只能「停内核 → 再启动」，没有热路径 |
| 页面 | 2.1.3 的 #17 把「点卡 = 启用」改成「点卡 = 只高亮选中」（`page.js:772` 注释 H5、`onCardClick:773` 只改 `activeSub` 再重绘） | 点卡片只变高亮、不动启用态，观感就是「点按切换失效」 |
| **两套状态没同步** | `activeSub`（高亮，`page.js:15`）与 `s.enabled`（真实启用）是两个变量，点卡只更新前者 | 高亮与「已启用/已停用」标签可以同时互相打脸；从别处改启用态时高亮也不跟随 |

**复核结论**：`subscriptionToggle` 本身没有坏——内核**关闭**时点卡内的「已停用/已启用」按钮是能生效的（`locked()` 此时为 false，`editable()` 也放行）。失效的是**点卡片**这个主入口：它从 2.1.3 起只做高亮、不做切换，与内核是否运行无关。

需求方口径（本次确认，**现有逻辑全部保留，只做修复**）：**点按 = 高亮该卡 + 切换启用；同时只允许一条启用，启用一条自动关掉其余；内核运行中也热切换，不关内核。**

### 2.3 详情卡左右两栏行高不齐（截图已确认）

`.kv`（`page.css:115`）是 `min-height:22px; align-items:center`。而带「复制」按钮的三行（系统代理地址 / 混合代理端口 / 控制器端口）里塞的是 `dock.css` 的胶囊按钮（`padding:4px 14px`），实际行高被撑到约 26–28px；不带按钮的行仍是 22px。左卡「Clash 信息」有 3 行带按钮、右卡「系统信息」一行都没有 → 两卡行距基准不同，同一 `align-items:stretch` 行里左右文字基线错开，观感「一个高一个低」。

需求方口径：**复制按钮没用，移除**。

### 2.4 飞书页现状

`plugins/feishu/` 是「表单 + 布局切换 + 最近发送」的静态页：`page.html`（2.4 KB）、`page.js`（18 行，无轮询、无局部更新）、`page.css`（890 B，仅覆盖 header/双栏/布局切换）。风格依赖 `shared/dock.css`，因此天然带着它的浅色盲区与旧的圆角/描边语义。

### 2.5 Magpie 后端五项（#18）

B1 删 `loomyCheckinCredit = 400` 与读取侧改写；B2 `CheckinViewState` 增 `RefreshedAt`/`Source`；B3 `CheckinProviderState` 增 `Collector`；B4 `brand:status` 增 `pendingPlugins` **且把 Node 侧 state 落盘接上线**（`feat/2.1.4-magpie-backend` @ `65549f0` 已有实现，但 `runtime.mjs` 无调用点）；B5 `brandIconNames()` 扫目录 + `pruneIcons` 同锁。

工具链现状：`go` **不在 PATH**；仓库有 `plugins/magpie/tools/download-go.py`（约 75 MB）与 `build-magpie.ps1`；补丁基线 `fish.8` 必须原样保留，新增 `fish.9` 累积。

## 3. 设计决定

### 3.1 版本与发布

- 三插件统一 **2.1.4**；`render-readme` 要求三插件版本一致，正好满足。
- 发布顺序：三插件出包 → `verify-release` → 回填 `catalog` 的 `sha256`/`bytes` → commit → push → tag `v2.1.4` → GitHub Release（三包 + `SHA256SUMS`）→ npm 三个单包。
- **版本位清单（8 处，必须一次改齐）**：`catalog/stable.json`（三行）、根 `README.md`（发版段/tag 链接×2/badge/npm 段/下载表）、`assets/readme/header.html` 静态兜底、`shared/errors.mjs` 两处「请更新插件到 2.1.4」、`plugins/clash/page.js` 同两处、`docs/maintainers/README.md` 当前版本行、`docs/developers/README.md` 已发布行、`page-checkin/package.json`（页面自身 0.2.6 → 0.2.7，若页面有改动）。

### 3.2 Clash：按钮折行与禁用语义

1. `.switch-row>button{flex:0 0 auto; white-space:nowrap}`，并给全局 `button` 补 `white-space:nowrap`（胶囊按钮不应折行）；
2. 禁用原因从同一句里拆出：`由 Dock 写入，停止内核时还原` 保持主说明，`内核未运行，无法接管系统代理` 落到按钮下方 `--dock-muted` 小字（同时进 `title`）；
3. 复核 `.switch-row` 在 560 宽下不溢出、八态齐全。
4. **移除详情卡的「复制」按钮**（`page.js:474` 的 `copyBtn()` 及其三处调用：系统代理地址 / 混合代理端口 / 控制器端口；IP 卡的「显示/隐藏」保留，只去掉其后的复制按钮），并一并清掉 `copyText()`、`if(a==='copy')` 分支与「已复制到剪贴板」文案，不留死代码；
5. **统一详情卡行高与基线**：`.kv` 改 `min-height:26px; align-items:baseline`，`.kv>.k` 与 `.kv>.v` 同一 `line-height`，值右对齐 + `tabular-nums`；两卡（Clash 信息 / 系统信息）共用同一行组件，保证左右文字逐行对齐。**这一条是 2.1.3 里新增「复制」按钮的反向决定，要写进 2.1.4 发行说明**（原因：按钮撑高行距，导致两栏不齐）。
6. **下拉滚轮误关闭（回归）**：`page.js:231` 的 `onWheel` 挂了 `window` 的 **capture** 监听（`:247`），只要收到 `wheel` 就 `closeListbox(false)` ——**包括在弹层内部滚列表**，于是"往下滑两下弹层就没了"。修法：`onWheel` 加 `if(pop.contains?.(e.target)) return`（外部滚动仍收起），并给 `.lb-list` 加 `overscroll-behavior:contain`，避免滚动链继续传给外层。
7. **下拉箭头视觉对齐**：箭头现在是文本字形 `<span class="chev">⌄</span>`（`page.js:401`），字体的基线与行高随回退字体漂移，两个触发器的箭头会一高一低。改成内联 SVG（12×12、`stroke:currentColor`、`flex:none`），两个触发器用同一个盒子 + `align-items:center`，不靠 `translateY` 凑。
8. **读数行右侧数值不被裁**：实测确认「当前节点延迟 … 94 ms」是否被容器切掉（截图右侧疑似裁切）；若存在，给 `.kv`/读数行的值列 `min-width:0; flex:none` 并允许整体换行。
9. **下拉选项尺寸与对齐（代理组弹层尤其明显）**：代理组的选项行带 emoji 图标（组名本身含 emoji），emoji 的字形高度把行撑到约 46px，且图标与文字基线不齐，视觉上"又大又散"。建立统一尺寸刻度并在两个弹层都执行：
   - 行：`.lb-option{min-height:28px; padding:2px 8px; font-size:12.5px; line-height:18px}`
   - 图标：新增 `.lb-ico{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:16px}`，emoji 一律包进这个盒子（否则字形高度不可控）
   - 选中标记：`inset 2px 0 0` 的 accent 条与 `.check`（12px）在行内垂直居中，位置固定不随文字长度漂移
   - 弹层容器：`padding:4px`、选项之间不加额外 margin，保证"行距 = 行高"
10. **尺寸刻度表（全局统一，不许逐处手调）**：字号 13 / 12.5 / 12 三档；行高 28（列表项/紧凑行）与 26（详情卡 `.kv`）；图标 16 盒子；圆角 14 与 999 两档；间距只用 4 的倍数。Clash 的弹层、卡片、按钮、`.kv` 全部按这张表对齐，飞书那边沿用同一张表（§3.4）。

### 3.3 Clash：订阅点按热切换（本次新增能力）

**语义（按需求方口径重定，**保留全部现有逻辑，只补缺失的联动**）**：

- 同时只允许一条启用（`subscriptionToggle` 里既有的互斥逻辑原样保留：启用一条即把其余置 `false`）；
- **点按订阅卡 = 高亮该卡 + 切换启用**（两个动作同一次点击完成）。`activeSub` 与 `data-active` 高亮逻辑**保留**，卡内「已启用/已停用」按钮也保留（点它等价于同一动作）；
- **两套状态必须同步**：切启用成功后 `activeSub = id`；切换失败回滚时高亮一并回滚；从别的入口（如卡内按钮）改启用态时，高亮跟随到新的启用项。不得出现「卡片高亮 + 标签写着已停用」的组合；
- 内核运行中也直接生效：**热重载配置，不 stop/start 内核**；内核未运行时点按直接就落盘启用集（现状已支持，补测试固定住）；
- 失败则回滚启用集、高亮与配置文件，并明确报错，绝不停在「UI 说切了、内核还是旧配置」的中间态。

**实现三步**：

1. **抽出配置生成**：把 `runtime.start` 里拼 `proxy-providers` 与落盘的那段（`runtime.mjs:83` 附近）提成可独立调用的 `writeConfig({settings, subscriptions, secret, dataDirectory})`，`start` 复用它，不改变 start 的行为与产物；
2. **运行中热应用**：`subscriptionToggle` 增加运行分支——持久化新启用集 → `writeConfig` 生成到候选路径 → `PUT /configs?force=true`（body 带 `path`）让 mihomo 就地换配置 → 成功后把候选文件 rename 成正式配置；失败则把启用集和配置文件都回滚，抛 `SUBSCRIPTION_SWITCH_FAILED`（新错误码，需同步两份码表：`shared/errors.mjs` 与 `page.js`）；
3. **页面**：移除「运行中置灰开关」的逻辑（`:30` 那条注释对应的禁用要按新语义改写），点卡触发 `subscriptionToggle`，运行中只显示「切换中…」的局部 busy，不整页禁用。

**边界与回退**：热重载会重建 provider，已建立的连接可能瞬断（可接受，本次不承诺零断流）；若目标内核不支持 `PUT /configs`，退化为「提示需重启内核」，并在页面写明原因——**不许静默失败**。

### 3.4 飞书跟随重构

只动 `plugins/feishu/page.{html,css,js}`：

1. **token 化**：页面自带 `--layer-1/2`、`--line-hair`/`--line-control`、`--c-ok/warn/bad`、`--c-*-bg`、`--hi`，通过 `:root[data-dock-theme=light]` 覆盖浅色档；不再依赖 `dock.css` 的裸色；
2. **层级**：布局切换器改成与 clash 同款 `.segmented`；`fieldset` 与卡片统一 14px 圆角 + 1px `--line-control`；间距回 4px 网格；字号沿用 13 / 12.5 / 12 三档；
3. **单栏与双栏两套布局都要正经设计**（不是一套挤成两列）：
   - **单栏**（默认）：`表单` → `最近发送` 顺序流，每块一张卡（`--layer-1` + 1px `--line-control` + 14px 圆角），块间 16px；字段按语义分两组（`群机器人` 的地址/密钥 与 `通知范围` 的三个筛选），组内 12px、行距 26px；
   - **双栏**：左列 `minmax(0,2fr)` 放表单（`600px` 以上保持两列字段：地址与密钥同排），右列 `minmax(220px,1fr)` 放 `最近发送` 与说明；两列顶部对齐（`align-items:start`）、列间 16px；`720px` 以下自动降回单栏；
   - 两套布局都必须复用到同一套 `.field` / `.card` / `.segmented` 原子样式，避免两套 CSS 各写一遍导致再次跑偏；
4. **按钮语义**：`保存配置` = primary；`发送测试通知` / `刷新` = 默认；`清除机器人配置` = 危险色 + 现有两步确认（`#clear-confirm` 保留，补 `Esc` 取消与焦点回退）；
5. **状态**：`#status` 保留 `role=status`；成功/失败改成同行 banner（成功 `--c-ok-bg`、失败 `--c-bad-bg`）；「最近发送」空态给可行动引导；
6. **文案**：长说明拆行（限额与去重分两句）；「留空保留现有地址和密钥」降为 muted 小字；
7. **无障碍**：`focus-visible` 统一 outline；布局切换补 `role=group` + `aria-label`；`prefers-reduced-motion`、`forced-colors` 自留；
8. **不动**：`backend.mjs`、`service.mjs`、`page.test.mjs` 断言的 RPC 契约。

### 3.5 Magpie 后端与工具链（含追上游）

**本版 Magpie 有两件事，一起做**：① 把自编译基线从上游 `v0.1.2336` **追到上游最新**；② 在这条新基线上落地 #18 五项，产出 `fish.9` 补丁与重编 exe。

**补丁链现状**：`patches/` 已有 `v0.1.1709+fish.1/.2`、`v0.1.2336+fish.3…fish.8`（`fish.8` 311,807 B）。补丁内容分两类：页面调用通道（`magpie.call` → `POST /api/plugin-pages/call` + `magpie.calls` 白名单）与 `internal/relay` 探针实现；以及 `fish.4→fish.6` 的讯飞 400 口径（**这批要让位给 #18 的 B1**：B1 正是删掉 400 补偿与读取侧改写，所以新补丁里不再带这段）。

**追上游的步骤（Phase 2，时间盒 90 分钟，含网络）**：

0. **目标已钉死：上游 `v0.1.2732`**（2026-11-02 的最新 release；`v0.1.2733` 只是 tag、无 release）。上游发布极快（约每 10 分钟一个 tag，总数 2732 个），所以**不许追"latest tag"**，只认这个钉住的版本，否则 t7 期间上游又会往前跑。基线核对：`v0.1.2336^{}` = `847f0c47`（与 `docs/maintainers` 记录一致）；跨度约 397 个 tag。
1. 查 `v0.1.2732` 与 `v0.1.2336` 之间的 commit/文件 diff，重点是 `internal/provider/*`（checkin、icon）、`internal/relay`、`internal/api`（页面调用相关）；
2. clone 目标 tag，把 Phase 1 的补丁以 `git apply --3way` 重放，**统计冲突文件与 hunk 数**；
3. 冲突可控 → 逐条解冲突，产出 `magpie-<新上游tag>+fish.9.patch`（对外只发这一次，序号仍用 `fish.9`）；顺带检查 #18 的五项是否已被上游自行实现（若上游已加 `RefreshedAt`/`Collector`，顺着上游走，不重复造）；
4. 冲突不可控 → **停下来把冲突清单报给 captain/用户**，按 §3.5.1 的硬约束处理（两个都要，不许降级），不硬凑一个能编译但行为不明的 exe。

**门禁（比 2.1.3 严，因为换了基线也换了二进制）**：
- `git apply --check` 对新基线干净通过；补丁文件命名与基线版本对齐（`magpie-<上游tag>+fish.9.patch`）；
- `build-magpie.ps1` 出 exe，核对版本资源（FileVersion / ProductVersion = 新上游版本 + `.9`、ProductName `magpie fish`）；
- 真机四态冒烟（有台账/无台账/有采集/无采集）+ 冷启 5 次看 `<data>/icons/brand` 是否抖动 + `preinstall-state.json` 首启后存在；
- 随包 exe 与 2.1.3 **不再逐字节相同**（换了基线），发行说明要写明「本版 magpie.exe 已换上游基线 <tag>」，并给出新旧体积与 sha256 对照。

**B4 先接线**：`runtime.mjs` 在 `seedPreinstalled(...)` 之后调 `recordPreinstallState`，并把 `readPreinstallState` 接进 `pendingPlugins` 计算（实现已在 `feat/2.1.4-magpie-backend` @ `65549f0`，未接线）。

**B5 前置取证**：先取上游 `internal/provider/icon.go` 全文 + 一次 `<data>/icons/` 快照；`pruneIcons` 的 keep 集合假设不成立就关掉 B5 并写明。

### 3.5.1 两者的顺序（已确认：两个都要，不许落下任何一个）

**先 #18，再追上游**，最终产物只有一份：基于新上游基线、同时含 #18 五项的补丁与 exe。

| 阶段 | 基线 | 内容 | 产出 |
| --- | --- | --- | --- |
| **Phase 1** | `v0.1.2336`（不变） | B1–B5 五项 + B4 接线；删掉 `fish.8` 里 400 口径那段 | `fish.9`（中间态，**不出包**），结构冒烟 + 单测通过 |
| **Phase 2** | 上游最新 | 把 Phase 1 的整条补丁链重放到新基线，解冲突 | `magpie-<新上游tag>+fish.9.patch`（最终），重编 exe |

**为什么这个顺序**：Phase 1 只在旧基线上做「逻辑改动」，不掺上游 diff —— 冲突归因清楚、测试能立刻跑；Phase 2 只做「机械重放 + 解冲突」，出问题时能一眼区分「是我改错了」还是「上游挪了代码」。

**硬约束**：两者都必须在 2.1.4 里。若 Phase 2 的冲突确实解不动，我要停下来把冲突清单报给你，不能自行降级成「只发 #18」或「只追上游」。

**网络前置**：追上游与 `download-go.py` 都要联网。当前环境 `HTTP_PROXY=http://127.0.0.1:7895`（就是 Clash 的混合端口）指向的代理**没在运行**，`github.com:443` 与 `api.github.com` 均不可达，直连也不通——**开工前需要先把代理/内核起来**。

### 3.6 工作方式

三插件分 worktree 并行（文件集合互不重叠：`plugins/clash/`、`plugins/magpie/`、`plugins/feishu/`），合并后统一升版；`shared/`、`catalog/`、`README` 三处由收尾成员独占，避免同一文件两边改。Clash 的热切换会同时动 `service.mjs`、`runtime.mjs`、`page.js`、两份错误码表，因此**独占 clash worktree**，不与 feishu 的页面改动混。

## 4. 验收与门禁

| 项 | 判据 |
| --- | --- |
| 单元测试 | `plugins/clash/*.test.mjs`、`plugins/magpie/*.test.mjs` + `shared/*.test.mjs`、`plugins/feishu/*.test.mjs`、`page-checkin/test/view.test.mjs` 全绿（`--test-isolation=none`） |
| Clash 热切换 | 内核运行中点另一条订阅 → 启用集切换且其余自动关闭 → 触发 `writeConfig` + `PUT /configs` → 视图与内核一致；人为让 reload 失败 → 启用集与配置文件回滚 + 明确报错 |
| Clash 订阅联动（**双向都要测**） | ① 点卡片 → 该条启用、其余关闭、卡内按钮变「已启用」、卡片高亮；② 点卡内按钮 → 启用态变化、卡片高亮跟随；③ 内核运行中点另一条 → 热重载生效且视图与内核一致；④ 内核未运行 → 直接落盘启用集，下次启动用的是新集 |
| Clash 下拉（**重点回归**） | 打开弹层后在列表内**滚轮上下滑**不关闭、不"回归原点"；在弹层外滚动才收起；箭头与两个触发器垂直居中一致；`Esc` / 外侧点击 / 选中项回填焦点 三条不变 |
| Clash 按钮 | 内核未运行时「系统代理」为横排胶囊 + 明确禁用原因；560 宽不折行、不溢出 |
| 视觉实拍 | Clash 4 张（dark/light × 900/560）；**飞书 8 张（单栏/双栏 × dark/light × 900/560）**；Edge headless + 静态夹具，产物落仓外 `reports/visual-2.1.4/`；captain 逐张看图，单栏与双栏都要逐项点评 |
| Magpie 专项 | `fish.9` 对新上游基线 `git apply --check` 干净；补丁命名与基线版本对齐；exe 版本资源 = 新上游版本 + `.9`（ProductName `magpie fish`）；真机四态冒烟；冷启 5 次 `icons/brand` 不抖；`preinstall-state.json` 首启后存在；**随包 exe 与 2.1.3 不再逐字节相同，发行说明给出新旧体积与 sha256 对照** |
| 包一致性 | 解包比对：包内页面文件与仓库 HEAD 逐字节相同 |
| 目录 | `catalog` 三行 `sha256`/`bytes` 为真实值；`verify-release` 退出 0 |
| 发布 | tag `v2.1.4` 指向含最终 catalog 的提交；Release 三包 + `SHA256SUMS`；npm 三个包 `latest` = 2.1.4 |

## 5. 风险与回退

| 风险 | 处置 |
| --- | --- |
| 热重载造成连接瞬断 | 接受并在发行说明写明；不做零断流承诺；失败必须回滚 |
| 目标内核不支持 `PUT /configs` | 退化为「请重启内核生效」的明确提示，不静默 |
| spike 不通（工具链/网络） | 停在当场上报；本版只出前端三件，`#18` 与追上游顺延 2.1.5，发行说明如实写 |
| 追上游冲突不可控 | 停在上报冲突清单，按 §3.5.1 的优先级取舍（默认追上游优先），不硬凑 exe |
| 网络/代理不可用 | 当前 `127.0.0.1:7895` 代理未运行，`github.com` 与 `api.github.com` 均不可达；追上游与 `download-go.py` 都依赖它，**开工前先把内核/代理起来** |
| 新 exe 无法真机验证 | 只做结构冒烟 + 冷启观察，发行说明标明「签到行为未经真实账号验证」 |
| 三插件版本不一致 | `render-readme` 会直接抛错，正好是门禁；不许手改 PNG |
| 飞书页改动破坏别人的维护约定 | 只动页面三文件，不碰 `backend/service/test` 断言的契约；改动写进 `docs/releases/2.1.4.md` 供其维护者复核 |
| 渲染/截图需 full-access | 由 captain 代跑并留输出；成员会话弹不出审批 |

## 6. 交付物

1. 三插件代码改动（各 worktree → merge 回 main）；
2. `plugins/magpie/patches/magpie-<新上游tag>+fish.9.patch`（重放到新基线、含 #18 五项、不再带 400 补偿）；
3. `docs/releases/2.1.4.md`（承接 #18 与本次三条 Clash 改动、追上游记录，含实际列、设计取舍、视觉验收、已验证/未验证）；
3. `catalog/stable.json` 三行版本位与真实摘要；
4. README 发版段 + 重渲染的头部版本卡（2.1.4）；
5. tag `v2.1.4` + GitHub Release（三包）+ npm 三个包；
6. `reports/visual-2.1.4/` 的实拍图与夹具。