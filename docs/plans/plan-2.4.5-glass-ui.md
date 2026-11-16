# 2.4.5 液态玻璃 UI：现状、坏在哪、怎么接手

> 这份是给接手的人看的：**现状、已改了什么、哪里是坏的、怎么复现**。
> 上一手把界面弄坏了，用户要求停手，未发版。以下按事实记录，不做辩解。

## 一、当前状态

| 项 | 值 |
| --- | --- |
| 分支 | `.work/magpie-dev`（`mem-dev`），HEAD `fcbbe61` |
| 基线 | 上游 `v0.1.4262` + `fish.37` → `fish.43`（`patch` 已重出，链式重放与 dev 树逐字节一致） |
| 已发布 | Magpie **2.4.4**（= `fish.41` 的 tip `261677b`），Clash **2.4.4** |
| 未发布 | `fish.42`、`fish.43` 的全部改动（未提交到插件仓、未出包、未发 npm） |
| 已撤销 | `ad1a22f`（`!important` 硬去框那一版）已从历史删除 |

回退到已发布形态：`git -C .work/magpie-dev reset --hard 261677b`，再把
`plugins/magpie/patches/magpie-v0.1.4262+fish.42/43.patch` 删掉即可。

## 二、已改动清单（按提交）

| 提交 | 内容 | 评价 |
| --- | --- | --- |
| `9ef2e5f` fix | 玻璃规则不再改 `position`/`backdrop-filter` | **必要修复**。之前 `position: relative` 把 `fixed` 的侧栏与 `.pop` 打成普通流，侧栏位移、所有下拉跑位 |
| `24bf362` fix | 搜索框等并入控件区 | 中性 |
| `2ad0912` feat | 玻璃覆盖改为扫描全部样式表生成；选中态改凸起高光 | **生成器思路是对的**，但「选中态」插入大量视觉变化，可能是"UI 全坏"的来源之一 |
| `23fe818` feat | 新增「顶栏」「页内工具条」两个刻度；取消 modal/editor/prose 排除 | 概念上符合用户要求（可单独调），但取消排除后对话框/编辑器内部也变透，观感风险高 |
| `1e46811` fix | 去实色边框、去强调色描边 | 与 `ad1a22f` 同方向，用户反馈"黑框还在/蓝圈没去掉" |
| `b37ee4a` feat | Agent 页新增「Obsidian 记忆 Agent」控制行 | 功能新增，与玻璃无关，可单独保留 |
| `d264076` feat | 记忆 Agent 面板收成一条 | 用户明确要求过（"最后只留一个 agent"），可保留 |
| `85e78ab` fix | 底条不绘制底板、图标去实底黑框 | 用户仍反馈"底部没透明"，说明**没压过上游优先级** |
| `fcbbe61` fix | 里层不再各自描边，玻璃边只留最外层 | 针对"边缘缺失"，未验证到位 |

## 三、已知坏掉的地方（用户原话）

1. **展开卡片上下全透明、中间实底**——嵌套层级没有统一，仍未修好。
2. **底部（供应商页「添加供应商」条、库的安装条）依旧没透明**。
3. **图标方块、复选框仍有黑框**（`.lib-glyph` 用 `--pill` 铺底）。
4. **聚焦时外围蓝圈仍在**（`outline`/`box-shadow` 由上游更具体的选择器给出）。
5. **嵌套玻璃的圆角处边缘缺失**。

## 四、我定位到但没做完的事实

用无头 Edge 读**计算样式**（`.work/locate.mjs`，可复用）：

```
.lib-glyph   bg=rgba(0,0,0,0)  border=0px 阴影 none     ← 硬去框那版生效了
.lib-tag     bg=rgba(0,0,0,0)  border=0px 阴影 none
.lib-switch  bg=rgba(0,0,0,0)  border=0px 阴影 none
#view-providers .list  bg=transparent border=1px 透明    ← 容器只剩外层玻璃边
```

即：**这些元素在当时那版构建里其实已经不再画底板**，但用户看到的仍是黑框——说明他看到的是**未重建的旧构建**，或坏的是另一处（上下文里他没有给出元素级证据）。这是交接里最需要先澄清的一点：**先确认为什么"改了但看不到效果"**，再动样式。

## 五、复现与调试环境（已搭好，可直接用）

```
.work/magpie-preview/
  magpie-preview.exe     fish.43 构建（含 profile 里一份真实数据副本）
  xdg\magpie\            配置（玻璃已开：侧栏82/12 页面62/26 浮层86/10 控件92/8，遮挡55）
  cache\                 缓存（插件页 Bun 运行时需要）
  start-preview.cmd      双击启动
```

- 启动方式：`XDG_CONFIG_HOME=<dir>\xdg`、`XDG_CACHE_HOME=<dir>\cache`，
  然后 `magpie-preview.exe web --addr 127.0.0.1:4399 --no-open`；
- 控制台会打印带 key 的链接，形如 `http://127.0.0.1:4399/?k=…`；
- **不要用 GUI 模式**：这台机器上拉起窗口进程会被宿主管控取消。

调试脚本（都在 `.work/`，可复用）：

| 脚本 | 用途 |
| --- | --- |
| `glass-audit.mjs <url> <outDir>` | 逐页遍历所有元素，列出「仍不透明且无模糊」的面，按类名聚合 |
| `locate.mjs <url>` | 对指定选择器读计算样式（背景/边框/阴影/outline/位置），输出 JSON |
| `cssom-check.mjs <url>` | 读 CSSOM，确认规则**有没有被浏览器解析**（当初就是靠它发现整条逗号规则作废） |
| `preview-q.mjs <url>` | 读页面拿到的设置与 `--fish-glass-*` 变量 |

依赖：Edge 无头（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`），
需要在**完整访问**下跑（它要在系统临时目录建 profile）。

## 六、建议的接手顺序

1. **先解释"改了看不到"**：确认用户看的构建就是最新构建（预览 key 会变；旧标签页会缓存 CSS `?v=`）。
2. **只改一处并立刻用 `locate.mjs` 验证**，不要一次改十几个选择器——上一手就是成批改，坏了大片又说不清哪条导致的。
3. 具体待办（按用户原话）：
   - 供应商页底条、库安装条：**默认不绘制底板**，只留文字与按钮；
   - `.lib-glyph` / 复选框：未点亮时无底无框；
   - 聚焦/选中：不要蓝色描边，改成玻璃凸起；
   - 展开卡片：把里层与最外层归到**同一套玻璃**，别出现"外透内实"；
   - 嵌套玻璃圆角缺边：内层不加描边。
4. 改完按既有流程出包：`fish.44` → `build-magpie.ps1` → `build-release.mjs` → `verify-release.mjs` → 目录 → Release → npm。

## 七、工程约定（别踩）

- 补丁链：`patches/magpie-v0.1.4262+fish.N.patch`，每版从**上一版 tip** 到 HEAD 的 `git diff --binary`；
  改完必须链式重放校验与 dev 树逐字节一致（`.work/magpie-build-*` 可复用）。
- `app.js` 有**核心脚本字节预算**（`internal/gui/core_budget_test.go`），加代码要同步提额并写理由。
- 不要把 `position` / `backdrop-filter` 加在 `fixed` 元素或它们的触发器上——会改变定位语义。
- 幂等生成：`fish-glass.css` 里 `gen:glass-surfaces` 两段之间由
  `plugins/magpie/tools/glass-surfaces.mjs` 生成，别手改。
