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
## 8. 2.3.4：断网四层兜底（C1–C8）

现场：2026-11-07 关掉 Clash 后整机断网——注册表 `ProxyEnable=1`、`ProxyServer=127.0.0.1:7895`，
而 7895 已经没有监听。四条路径各自能造成它，这次一起补齐。

1. **C1/C2/C4 停止顺序**：`service.stop()` 的第一件事改成 `runtime.proxy.restore(mixedPort)`，
   之后才收内核；结尾不再重复恢复。宿主给 `deactivate` 的预算（2.1.8 起单独 30 秒）到点就 kill
   插件，排在后面的那一步等于没做——这就是现场那个「内核刚死、注册表还指着它」。
2. **C3 启动失败**：`abandonStart()` 统一收尾（收候选内核 → 清 `run-state.json` → 还代理），
   被取消 / `SPAWN_FAILED` / `CONTROLLER_UNREACHABLE` 三条路都不再留死代理；代理恢复失败只记
   日志，绝不盖掉原错误码。
3. **C5 坏租约**：`schema` 不符、缺 `previous`/`owned`、字段类型不对，全部走同一条「丢弃 + 带 code」
   路径；`recoverStale()` 遇到坏记录返回 `{act:'discard'}`。
4. **C6 半死内核**：停止时的「探活 + 收尾」共享 `KERNEL_STOP_BUDGET_MS=1600` 预算。控制器永不
   回时 `stop()` 1.6 秒返回：代理已恢复、内核状态报 `failed / KERNEL_STOP_UNCONFIRMED`，
   不再把页面挂住。
5. **C7 TUN 宿主看门狗**：插件在 `tun.enable()` 时写 `<home>/host.json`（`{pid,at}`，`home` 就是
   `service.ini` 里那个），`disable()` 删掉；`tun-service.cs` 的 `Tick()` 每 1.5 秒读它，宿主进程
   不在（或 pid 被复用：进程启动时刻晚于租约 5 秒以上）就停内核 + 把 `job.ini` 的 `enabled`
   置 0。服务是 SYSTEM 托管、独立于宿主的 Job，这一步只能由服务自己做。
6. **C8 看门狗改任务计划**：不再 `spawn(detached)`（Windows 上不带 `CREATE_BREAKAWAY_FROM_JOB`，
   宿主一死 Job 关闭，看门狗跟着消失）。`watchdog-task.mjs` 用一次 pwsh 注册
   `FISH Dock clash watchdog-<SID>`（`-Once` + 每 5 分钟重复 + `IgnoreNew` + 13 小时上限）并
   立即启动；只在系统代理被接管期间存在：`proxy.enable()` 成功才建，`restore()` 成功就注销，
   `stop()/shutdown()` 也注销。看门狗自己恢复完用 `schtasks /Delete` 删掉自己的任务。
7. **2.3.5 修 C8 参数名**：`New-ScheduledTaskSettingsSet` 没有 `-DisallowStartIfOnBatteries` /
   `-StopIfGoingOnBatteries`，参数绑定阶段就抛错，`Register-ScheduledTask` 从未执行——
   2.3.4 及以前的 C8 看门狗实际一次都没建起来。改成真实存在的
   `-AllowStartIfOnBatteries` / `-DontStopIfGoingOnBatteries`；`watchdog-task.test.mjs`
   同时断言旧名不得出现。
8. **2.3.5 TUN 服务自退休**：`service.ini` 登记的内核 exe 随插件包卸载/升级换目录消失后，
   `FishClashTun` 不能再每 1.5 秒刷「内核找不到」。`Tick()` 在宿主租约判定前先问
   `ShouldRetire()`：内核路径为空 → 不动；exe 还在 → 不动；**内核进程还活着 → 不动**
   （删除运行中的 exe 不会结束进程，此时撤服务等于断网）；exe 不在且进程也没了 → 停内核、
   把 `job.ini` 置 0、`sc delete`、延迟删除 `%ProgramData%\FishDock\clash-tun`。
   判活只看进程句柄，不读 `job.ini`：插件写 `job.ini` 不是原子的，读到半截会把正在启动的
   内核当成「没在用」。已用 C# 反射夹具验证五个分支（内核在 / 进程活 / 进程死且
   enabled=1 / job 坏 / 无 kernel 路径），旧逻辑在「进程活」与「enabled=1 但已死」两处相反。
   **已有 2.3.4 装过 TUN 服务的机器，要重新点一次「安装 TUN 服务」才会换成新服务 exe**。

### 重新编译 tun-service.exe（C# 5，勿用新语法）

```powershell
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:exe /platform:anycpu /optimize+ `
  /out:"plugins\clash\service\tun-service.exe" /r:System.ServiceProcess.dll `
  "plugins\clash\service\tun-service.cs"
```

**已在用 TUN 的用户要重新点一次「安装 TUN 服务」**：服务 exe 是安装时复制到
`%ProgramData%\FishDock\clash-tun` 的，插件升级不会替你替换正在运行的那一份。

### 单测

- `node --test --test-isolation=none "plugins/clash/*.test.mjs"`：166 条，164 通过、0 失败
  （`page.browser.test.mjs` 需要 Edge + playwright，本机不跑）。
- 新增：C1/C2 顺序、C3 三条失败路径、C6 预算、C7 宿主租约写/删、C8 任务注册/注销与
  自删任务。
