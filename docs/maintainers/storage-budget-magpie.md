# Magpie 插件的磁盘占用会怎样长（2026-11-07 评估）

> 问题：magpie 插件长期运行、反复升级，会不会无上限地堆积，把用户的盘撑爆。
> 结论写在最后一节；结论依据是代码里的写入点与清理逻辑，不是估算。

## 1. 会长的东西，逐个看

| 位置 | 谁写 | 增长来源 | 上界 / 清理 |
| --- | --- | --- | --- |
| `<data>/magpie.log` + `.1` | 插件容器 `runtime.mjs` 的 `createTailLog` | magpie 的 stdout（供应商掉出、模型数突变这类时间线） | **1 MB 滚动，保留上一份** → 稳态约 2 MB |
| `<data>/gateway-error.log` | `runtime.mjs` 的 `recordGatewayError` | 每次启动失败一行（含 code / 阶段 / 端口 / 时间，message 截到 300 字符） | **原来只追加、没有上界**；本次加 1 MB 滚动 + `.1`（与 magpie.log 同口径） → 约 2 MB |
| `data/plugins/node_modules` | bun（`install`） | 插件包本身；同名包升级是替换 | 与插件数相关（每个几 MB~20 MB），不随运行时间增长；`pruneInstallCache` 清 bun 缓存里不再安装的版本 |
| `<cache>/bun/install-cache` | bun | 每个「拿过」的插件版本 | `pruneInstallCache`（`store.go:839`，每次安装后）删掉 `plugins/` 已不再安装的版本（上游 #1988 的修复） |
| `credentials/magpie-runtime/.binary-*` | 插件容器 `portable-runtime.mjs` | 每次 magpie 升级换一份二进制 | `pruneRuntime`：保留上一版（`KEEP_PREVIOUS=1`），staging 目录 10 分钟宽限后清 |
| `credentials/magpie-runtime/.data-*` | 同上 | 首次迁移/复制的暂存 | 同上（宽限后清） |
| `data/config/*.json`（settings / providers / plugins / plugin-providers / plugin-auth） | magpie | 配置与供应商，随条目数线性 | 有界（KB 级）；凭据不随包分发 |
| `data/config/preinstall-state.json` | 预装登记 | 固定 | 有界 |
| `data/config/plugin-install-errors.json` | 本次新增 | 每个失败的 spec 一条 | 装好即清；单条错误截断 2,000 字符 |
| 用量/请求记录 | magpie `usage` | 请求流水 | 有缓存修剪（`TestRequestChunksTrimmedWhenIdle`、`TestUsageLargeSummaryIsCompleteAndKeptTrimmed`） |
| 模型/价格缓存 | `catalog` | 供应商列表、价格 | 覆盖写 + TTL 刷新；大小随模型数（百 KB 级） |
| `packages/fish.magpie/<version>/`（宿主侧） | FISH Dock 宿主 | 每次插件升级一份 ≈36.9 MB | 宿主 `plugin_install` 的「删净旧版本」逻辑（#f3）；**不在本仓，需真机确认** |

## 2. 结论

1. **magpie 自己的数据目录不会随运行时间线性膨胀**：日志全部有滚动上限（约 4 MB），配置 KB 级，缓存按 TTL 覆盖写，用量记录有修剪。
2. **真正占盘的是「包」而不是「数据」**：`magpie.fish-plugin` 36.9 MB/版，`node_modules` 随装的插件数增长，这两块由宿主与 bun 管理，不是 magpie 的数据。
3. **本次评估发现的唯一无界项已修**：`gateway-error.log` 原为 append-only；现在 1 MB 滚动 + `.1`。触发条件是「插件反复启动失败」（例如宿主重启风暴），修之前一天几百次失败能到几百 MB 而无回收。
4. **仍未证实的一处**：FISH Dock 宿主 `packages/` 下旧版本插件包是否只留 1–2 版。本仓看不到那段代码，建议真机升级一两次后看一眼该目录。

## 3. 建议（都不是必须）

- 宿主侧确认 `packages/fish.magpie/` 的保留策略（1–2 版即可）；
- 卸载插件后如果 `node_modules` 留了空目录或残留，bun remove 之外再兜一次清理（当前代码只在安装失败时清残留）；
- 如果以后把日志级别调高，`magpie.log` 的 1 MB 滚动阈值要跟着看一眼。
