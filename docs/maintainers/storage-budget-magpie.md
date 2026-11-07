# Magpie 插件的磁盘占用会怎样长（2026-11-07 评估，同日 #46 复核）

> 问题：magpie 插件长期运行、反复升级，会不会无上限地堆积，把用户的盘撑爆。
> 结论写在最后一节；结论依据是代码里的写入点与清理逻辑，不是估算。
> 本版已按 #46 把无界项逐个修掉，表里的数字是**修完后的上界**。

## 1. 会长的东西，逐个看

| 位置 | 谁写 | 增长来源 | 上界 / 清理 |
| --- | --- | --- | --- |
| `<data>/magpie.log` + `.1` | 插件容器 `runtime.mjs` 的 `createTailLog` | magpie 的 stdout（供应商掉出、模型数突变这类时间线） | **1 MB 滚动，保留上一份** → 稳态约 2 MB；滚动前先删 `.1` |
| `<data>/gateway-error.log` + `.1` | `runtime.mjs` 的 `recordGatewayError` | 每次启动失败一行（含 code / 阶段 / 端口 / 时间，message 截到 300 字符） | **1 MB 滚动 + `.1`** → 约 2 MB；滚动前先删 `.1`（#46，Windows 上 rename 到已存在文件会失败） |
| `<data>/usage.jsonl` + `.1` | magpie `internal/usage` | 每次请求一行 | **128 MB 滚动，保留上一份**（#46）→ 约 256 MB；索引按文件身份自动重建，花销上限与「从某天起算」仍能补读 `.1` |
| `data/routing/*.jsonl(.gz)` | magpie `internal/gateway/history.go` | 每条完成的路由 | **30 天 + 已完成日 200 MB**（上游既有）；启动时再扫一遍（`PruneHistory`），当天文件不占总量、不删 |
| `data/masking/*.jsonl` | magpie `internal/maskrec` | 每条脱敏记录 | **30 天 + 100 MB**（上游既有）；启动时再扫一遍（`maskrec.Prune`），当天文件不删；只存占位符/种类/提示，不存原值 |
| `credentials/magpie-runtime/magpie.exe`、`.exe.new`、`.before-*.exe` | 旧版自更新 | 旧名二进制 | `pruneRuntime`：**一天宽限后清掉**（#46） |
| `<data>/tmp/*`（TEMP/TMP 指向这里） | magpie 子进程 / 旧版 bun 缓存 | 下载残片、`tmp/magpie` | 启动前 `pruneCache`：**超过一天的条目清掉**（#46） |
| `data/cache/bun/<version>/` | magpie `bunupdate.go` | 每次 Bun 升级一份 | `pruneBuns`：**只留 current + previous**（上游既有） |
| `data/cache/bun/install-cache` | bun | 每个「拿过」的插件版本 | `pruneInstallCache`（`internal/plugin/installcache.go`，每次安装后）删掉 `plugins/` 已不再安装的版本（上游 #1988 的修复） |
| `credentials/magpie-runtime/.binary-*` | 插件容器 `portable-runtime.mjs` | 每次 magpie 升级换一份二进制 | `pruneRuntime`：保留上一版（`KEEP_PREVIOUS=1`），staging 目录 10 分钟宽限后清 |
| `credentials/magpie-runtime/.data-*` | 同上 | 首次迁移/复制的暂存 | 同上（宽限后清） |
| `data/config/*.json`（settings / providers / plugins / plugin-providers / plugin-auth） | magpie | 配置与供应商，随条目数线性 | 有界（KB 级）；凭据不随包分发 |
| `data/config/preinstall-state.json` | 预装登记 | 固定 | 有界 |
| `data/config/plugin-install-errors.json` | 2.3.2 新增 | 每个失败的 spec 一条 | 装好即清；单条错误截断 2,000 字符 |
| 模型/价格缓存 | `catalog` | 供应商列表、价格 | 覆盖写 + TTL 刷新；大小随模型数（百 KB 级） |
| clash `credentials/*.json` / `*.yaml` | clash 插件 | 每条订阅两份文件 | 删订阅时**两份一起删**（#46，不再写空串）；单文件是加密凭据，KB 级 |
| clash `tmp/import-*`、`tmp/mihomo-runtime.next.json` | clash 插件 | 订阅导入的临时目录、热切换候选 | 正常路径在 `finally` 里删；强杀残留由启动时 `pruneTmp` 清（10 分钟宽限） |
| `packages/fish.magpie/<version>/`（宿主侧） | FISH Dock 宿主 | 每次插件升级一份 ≈36.9 MB | 宿主 `plugin_install` 的「删净旧版本」逻辑（#f3）；**不在本仓，需真机确认** |

## 2. 结论

1. **magpie 自己的数据目录不会随运行时间线性膨胀**：日志全部有滚动上限（约 6 MB），用量日志两份共约 256 MB，路由/脱敏各按 30 天与总量封顶，配置 KB 级，缓存按 TTL 覆盖写。
2. **真正占盘的是「包」而不是「数据」**：`magpie.fish-plugin` 36.9 MB/版，`node_modules` 随装的插件数增长，这两块由宿主与 bun 管理，不是 magpie 的数据。
3. **#46 修掉的四处**：
   - `usage.jsonl` 原来只追加（实测 12 天 36 MB，一年 3–4 GB）→ 128 MB 轮转；
   - `credentials/magpie-runtime/` 里旧名二进制（`magpie.exe` / `.before-*.exe`）永不匹配 `magpie-<sha>.exe` 的清理规则 → 一天宽限后清；
   - `<data>/tmp/magpie`（旧版 bun 缓存留在 TEMP，实测 202 MB）→ 启动时清一天前的条目；
   - `gateway-error.log` 滚动时没先删 `.1`，Windows 上 rename 失败后继续 append → 先删再滚。
4. **路由与脱敏不需要新写保留期**：上游 v0.1.3240 已有 30 天 + 总量上限；本次只补两处——masking 不再把当天文件算进总量（满了会删掉刚写的记录），以及 `magpie web` 启动时各扫一遍（此前只有「再写一条」才会触发清理）。
5. **仍未证实的一处**：FISH Dock 宿主 `packages/` 下旧版本插件包是否只留 1–2 版。本仓看不到那段代码，建议真机升级一两次后看一眼该目录。

## 3. 交易与代价（如实写下）

- `usage.jsonl` 轮转后，**Usage 页只读实时日志**：超过 128 MB 的旧明细（这台机器约 40 天）进 `usage.jsonl.1`，页面不展示。这是「有界」换来的；key 的花销上限（日/月/总额）跨轮转仍然正确（`readSpent` 在窗口早于实时日志第一条时补读 `.1`）。
- 补读 `.1` 是整文件解析（最坏 128 MB，约 1–2 秒），只在花销上限的缓存过期（5 分钟）且窗口跨过轮转时发生，不在请求热路径上重复。
- 路由历史启动清理会把「昨天」的文件 gzip，跑在 goroutine 里，占一点启动后的 CPU，不挡服务。

## 4. 建议（都不是必须）

- 宿主侧确认 `packages/fish.magpie/` 的保留策略（1–2 版即可）；
- 卸载插件后如果 `node_modules` 留了空目录或残留，bun remove 之外再兜一次清理（当前代码只在安装失败时清残留）；
- 如果以后把日志级别调高，`magpie.log` 的 1 MB 滚动阈值要跟着看一眼。
