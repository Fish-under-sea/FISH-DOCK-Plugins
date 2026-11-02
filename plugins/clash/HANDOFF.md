# clash 2.1.4 交接（收尾成员按条目核对）

> 本文件随 `feat/214-clash` 分支提交，不进插件包。只登记「需要收尾/他人处理」的事项，
> 本分支已经做完的事不在这里重列。

## 1. shared/errors.mjs（本分支已改，不是延后）

- 新增**一行**：`SUBSCRIPTION_SWITCH_FAILED: '订阅切换没能热生效：请重启内核后再试；原启用状态已回滚',`
- 位置：`SUBSCRIPTION_NO_CACHE` 之后。
- 与 `plugins/clash/page.js` 的 `ERROR_TEXT` 同文案、**逐字相同**；`page.test.mjs` 会逐个错误码比对两份表。
- 收尾核对命令：`node --test --test-isolation=none "shared/*.test.mjs"`（本分支实测 19/19 绿）。

## 2. docs/releases/2.1.4.md 要写进去的三件事

1. **「复制」按钮是 2.1.3 新增，本版反向决定移除**：按钮（`padding:4px 14px` 的胶囊）把 `.kv` 行从 22px 撑到 26–28px，
   而右卡（系统信息）一行按钮都没有 → 两卡行距基准不同，同一行里左右文字基线错开。移除后两卡逐行对齐（实测 top 差 0）。
2. **运行中热切换**：provider 会重建，已建立的连接可能瞬断（本版不承诺零断流）；失败时启用集与配置文件一起回滚，
   并提示「重启内核后再试」；目标内核不认 `PUT /configs` 时同样是这条明确提示，不静默失败。
3. **尺寸刻度表**（字号 13 / 12.5 / 12；行高 28 列表项、26 详情卡 `.kv`；图标 16 盒；圆角 14 / 999；间距只用 4 的倍数）
   已写到 `plugins/clash/page.css` 顶部注释，飞书页沿用同一张表。

## 3. 版本位（8 处清单里 clash 相关两处）

- `plugins/clash/page.js` 的 `ERROR_TEXT.UNKNOWN_METHOD` / `CAPABILITY_REQUIRED` 两处「请更新插件到 2.1.3」→ **2.1.4**。
- 本分支**没有**改版本位（施工单边界：统一升版由收尾成员在 main 独占完成），worktree 里仍是 2.1.3。

## 4. 本分支动过的文件

| 文件 | 内容 |
| --- | --- |
| `plugins/clash/page.css` | 尺寸刻度表注释、弹层尺寸（`.lb-option` 28 / `.lb-ico` 16 / `.check` 固定盒）、`.kv` 26 + 基线、按钮不折行、grid 容器 `align-content:start`、描边口径（容器 hair） |
| `plugins/clash/page.js` | 按钮禁用原因拆行、移除复制按钮全链、点卡=高亮+切换、运行中局部 busy、`onWheel` 守卫、箭头 SVG、弹层 emoji 进 `.lb-ico`、`SUBSCRIPTION_SWITCH_FAILED` 码表 |
| `plugins/clash/service.mjs` | `subscriptionToggle` 运行分支（持久化 → 候选配置 → `PUT /configs?force=true` → 转正 / 回滚） |
| `plugins/clash/runtime.mjs` | 抽出 `writeConfig`（`start` 复用）+ `swapConfig`（候选文件只在成功后转正）+ `configPath` |
| `shared/errors.mjs` | 新增 `SUBSCRIPTION_SWITCH_FAILED` 一行 |
| `plugins/clash/{page,service,runtime}.test.mjs` | 增补用例（见 §6） |

## 5. 实测（给 captain 拍图时对照）

- 夹具：`.work/measure/measure.html`；CDP 测量脚本：`.work/measure/measure.mjs`（都是一次性产物，不入仓）。
- 测量方法：Edge headless + CDP `Emulation.setDeviceMetricsOverride`，量同一容器内相邻行的
  `getBoundingClientRect().top` 差值与高度，与 CSS 写死的刻度逐个对。
- 900 / 560 两档结果一致：

| 量 | 实测 |
| --- | --- |
| Clash 信息 6 行 `.kv` 高度 / 行距 | 26 / 26（全一致） |
| 左右两卡逐行 top 差 | 0,0,0,0,0,0（560 单栏时两卡纵向排，不适用） |
| `.lb-option` 5 行高度 / 行距 | 28 / 28 |
| `.lb-ico`、`.check` 盒 | 16px，`.check` margin 0（清掉了 dock.css `.check` 的 28px/8px） |
| `.site-row` 高度 / 行距 | 28 / 28 |
| 卡内 `.combo` | label 18 + gap 4 + trigger 28（没被摊高） |
| `.cards` 两卡高度 | 224 / 224（等高但不摊行距） |

- 说明：测量机**没有 emoji 字体**，旧写法量到 32px；用户机上 emoji 字形更高（约 46px）。修复不依赖这个数字——
  emoji 现在固定关在 16px 盒里，行高由刻度表决定。

## 6. 需要 captain 或后续任务处理的两条

1. **`plugins/clash/page.browser.test.mjs` 的选择器已与当前实现不符**：它用 `#group-pick option` / `selectOption()`，
   而实现早就换成 button + `.listbox` 弹层；该测试还需要 `FISH_TEST_EDGE` 与 `FISH_TEST_PLAYWRIGHT`（本机无 playwright）。
   我没有改它（改了也验证不了），双向联动回归已由 `page.test.mjs` 的四条用例固定（点卡→切换 / 开关→高亮跟随 /
   失败回滚 / 运行中局部 busy）。要跑真实浏览器回归，需单开一条任务在有 playwright 的环境里重写这段。
2. **`.lb-list` 命名**：施工单写「给 `.lb-list` 加 `overscroll-behavior:contain`」，本页的滚动容器叫 `.listbox`
   （弹层自身即滚动容器，已带 `overscroll-behavior:contain`），没有另建 `.lb-list` 元素。

## 7. t14（t5 复审修复）追加登记

1. **行为变化，要写进发行说明**：启用一条**没有缓存**的订阅现在直接拒绝（`SUBSCRIPTION_NO_CACHE`
   「请先更新已启用订阅，获取可用缓存」），内核运行与否都一样。此前内核没跑时允许把它设为启用并落盘，
   下次「启动内核」才失败——用户看到的是「启用成功、启动失败」两个状态。
2. **`page.js` 的 `applyView(next)` 是设置 view 的唯一出口**（同时把 `activeSub` 校正到真实启用项）。
   后续若再加「整体替换视图」的入口，必须走它；否则首屏/刷新会再次出现「标签写已启用、卡片无高亮」。
3. `swapConfig` 的 rename 失败分支现在也删候选文件；`SUBSCRIPTION_SWITCH_FAILED` 的 `cause` 改为
   **原始错误对象**（保留堆栈与 URL），日志侧取原始码请用 `error.cause.code`。