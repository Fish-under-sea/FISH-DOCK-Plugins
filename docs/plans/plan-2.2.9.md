# 2.2.9 任务表（issue #36 / #37 + 内置件收编）

> 版本：magpie **2.2.9**（`v0.1.3140 + fish.24`）。窗口：2026-11-06 夜。
> 状态列只有三种：完成 / 未开始 / 不做（写明原因）。「落点」是主要文件，不是全部改动。

| ID | 任务 | 落点 | 验收 | 状态 |
| --- | --- | --- | --- | --- |
| T1 | **#37 回复**：回答 `usage.rows` 来源、宿主通道、magpie 日志位置 | issue #37 评论 | 三条问题各有明确结论 | 完成 |
| T2 | **#36 拆任务**：四项（重列钩子 / 交接防抖 / 分组语义 / 旧 options）落成可验收条目 | issue #36 评论 | 每项有验收口径与落点 | 完成 |
| T3 | **#36-1 重列钩子**：插件页刷新触发 `plugin.Providers` | `internal/neartoken/manager.go` | 刷新后 models 数跟着重列 | 完成 |
| T4 | **#36-2 交接防抖**：只认 `Listed()` 同名且 `signedIn`；删除不再清 catalog | `internal/neartoken/handoff.go` | 未登录不删；`deleted[]` 不再增长；新增测试 | 完成 |
| T5 | **#36-3 分组语义**：宿主无分组维度，口径钉在插件契约 | `internal/neartoken/prefs.go` + 测试 | `ModelIDs` 只看 model，测试固定 | 完成 |
| T6 | **#36-4 旧 options 迁移**：清三键，只动 neartoken 包 | `internal/plugin/store.go`、`internal/gateway/gateway.go` + 测试 | `plugins.json` 不再含三键；二次调用无写入 | 完成 |
| T7 | **合并插件包**：签到 + 中转站探针收成一个页面插件（页内两页切换，图标沿用签到） | 新仓库 `magpie-checkin-relay-probe`、npm 同名包 | 真窗口两页切换均渲染；两页代码原样 | 完成 |
| T8 | **内置件收编**：`page-plugins/` → `bundled-plugins/`，旧条目升级时删除 | `plugins/magpie/page-seed.mjs`、`runtime.mjs` + 测试 | 旧两条被删、新条目写入；无三条并存 | 完成 |
| T9 | **破甲内置**：`@fish-under-sea/magpie-purge` 随包分发 | `plugins/magpie/bundled-plugins/magpie-purge/` | 包内实物齐全、首启登记 | 完成（内置 0.3.1；0.3.2 发版期间才出，下一版同步） |
| T10 | **页面帧支撑**：frame-src 放行自身目录、bridge 任意深度、ACAO、frame-ancestors | `internal/gui/pluginpage.go` + 测试 | 真窗口子帧加载、两页数据正常 | 完成 |
| T11 | **#37 落实**：`magpie.exe` stdout/stderr 落 `magpie.log`（1 MB 滚动） | `plugins/magpie/runtime.mjs`、`shared/child.mjs` + 测试 | 滚动用例通过；启动落分隔行 | 完成 |
| T12 | **补丁与出包**：fish.24、重编 exe、`magpie.fish-plugin` | `patches/`、`.work/magpie-build` | 补丁可干净应用；包内无 `page-plugins` 残留；sha 与 catalog 一致 | 完成 |
| T13 | **发行**：catalog、npm、GitHub Release、发行说明 | `catalog/stable.json`、`docs/releases/2.2.9.md` | npm `latest=2.2.9`；Release 资产 200 且摘要一致 | 完成 |
| T14 | **#36 / #37 收口** | issue 评论 | 逐项对照 + 验证记录，随后 close | 完成 |

## 依赖与顺序

```
T1 ─┐
T2 ─┴→ T3,T4,T5,T6 ┬→ T12 → T13 → T14
T7 → T8 → T10 ─────┘
T9 ─────────────────┘
T11 ────────────────┘
```

T7/T8/T10 与 T3–T6 互不重叠（新包 + 内置结构 / Go 宿主），可以并行；T12 必须等两边都定稿。

## 口径与取舍

- **一个插件、两个页面**：magpie 的一个插件只能声明一个 `magpie.page`，所以「合并」落在页面内部：
  标签栏 + 两个子帧，两页各自在自己的帧里跑，`relay.js` 负责把子帧消息转发给 magpie 窗口。
  页面代码、图标、样式原样不动。
- **页面帧安全**：子帧是不透明源，`frame-ancestors` 的匹配在 Chromium 里对不透明祖先不成立，
  只能从页面响应里去掉该指令；补偿是页面 URL 自带一次性 token、页面无表单/导航/网络。
- **分组语义**：宿主模型平面没有分组维度，按插件契约（只在全组停用时写 disabled）固定，
  不引入宿主不可验证的推断。

## 验证记录

见 [2.2.9 发行说明](../releases/2.2.9.md) 第六节。
