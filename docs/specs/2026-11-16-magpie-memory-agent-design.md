# Magpie 记忆「Agent 化」设计（内置版 · 定稿）

> 状态：**定稿（内置实现）**。回到最初方向：执行器内置进 magpie，不拆插件；不依赖 GitHub Copilot（`~/.copilot` 已删除）。
> 保留此前所有已定决策，并把 Obsidian 插件 `fish-magpie-memory` 一起纳入。

## 0. 目标
把共享记忆里「从对话学习 / 每晚整理 / 做梦」的执行主体从「选模型」改成「选 Agent」：
Agent 是 magpie 里**我们自己的一个一等 Agent**（instruction = 记忆体系维护 AGENTS.md，可配 MCP/skills），
由 **magpie 内置受限执行器**按该 Agent 跑；UI 不暴露模型；产物经 Memory MCP 写回记忆、按白名单写进 vault；
工作目录/缓存 20MB 上限自动清理，权限只关在记忆相关目录。Obsidian 插件作触发/观察端，同样受约束。

## 1. 现状与 Copilot
- 记忆核心（存储/字段/MCP 四工具/`memory_save` 幂等/`memory_context`/digest/learn-organize-dream/语义搜索/Tidy-Prunes-Sync/删除确认/origin=user 不被覆盖）**均已在源码实现**，不重写。
- **Copilot 与我们无关**：本机 `~/.copilot` 是 magpie 因 `library.json` 勾了 `copilot` 目标而写出，且无 Copilot 本体。**已删除 `~/.copilot`**；迁移从 `library.json.agents` 移除 `copilot`、不再写它。
- 本机 `distill.json`：`model=group/deepseek`、`days=-1`、`effort=high`、`dream=true`（=现在的「选模型」）。

## 2. 概念与数据模型
### 2.1 我们自己的 Agent（magpie 一等 agent）
`internal/agent` 新增内置 Agent（与 obsidian/codex 平级）：`ID:"memory-agent"`、`Name:"记忆体系维护 Agent"`、内置（恒检测）、`ListsModels:false`。
配置家目录 `<magpie config>/memory-agent/`：`AGENTS.md`（=那份 md，可编辑）、`mcp.json`（默认挂 `magpie-memory`，可再加）、`skills/`。可在 Agents/Library 里被装备 MCP、skills、instructions。

### 2.2 角色绑定
`<magpie config>/memory-agents.json`（lastgood 原子写 + filelock，坏文件不覆盖）：
```json
{ "version": 1,
  "agents": [
    { "id":"memory-curator","name":"记忆整理 Agent","agent":"memory-agent","role":"learn|organize",
      "model":"group/deepseek","effort":"high","schedule":"daily 22:00 | manual","scopes":["global","project:*"] },
    { "id":"dreamer","name":"做梦 Agent","agent":"memory-agent","role":"dream","model":"group/deepseek","effort":"high","schedule":"daily 03:00 | manual" }
  ],
  "defaults": { "learn":"memory-curator","organize":"memory-curator","dream":"dreamer" } }
```
`model` 是内部路由（不在下拉展示）。

## 3. 执行器（内置，新包 `internal/memagent`）
```
magpie GUI（cookie）/ Obsidian 插件（配对 token）
  │ POST /api/memory/agents/<role>/run | /stop
  ▼
memagent.Runner（单实例 .run 锁 + 取消 + 进度/转录，复用 memdistill 范式）
  ▼
AgentLoop（模型经 magpie 网关：model=group/deepseek、effort；system = 该 Agent 的 AGENTS.md）
  │ 工具 = magpie-memory（记忆）+ vault 白名单读写 + 该 Agent mcp.json 增配的 MCP 工具 + skills
  ▼
Scratch <data>/cache/memory-agent/work/<run-id>/（>20MB GC）
  ▼
转录/进度：distill.json.progress + 内存转录 → GET /api/memory/agents/status（GUI/插件轮询）
```
- 模型经 `gateway`（`/v1/messages` 或 `/v1/chat/completions`），Usage 记 agent id `memory`。
- 工具集固定：`memory_save/search/forget/context` + `vault_list/read`（只读白名单）+ `vault_write`（写白名单）+ `mcp.json` 里增配的 MCP 工具 + skills。
- 循环：模型返回工具调用→执行→回填→至终态或步数/时间上限；失败中止、记错误、下次重试；一次 run 一个 role/Agent。
- role：learn（复用 memdistill 到期会话 + transcript→候选）；organize（AGENTS.md §4，先出摘要）；dream（§5，产物写 DREAMS）。

### 3.1 执行依赖
gateway+`group/deepseek` 可用；`<config>/memory-agent/AGENTS.md`；`magpie-memory` MCP；vault（`.fish-import.json` 校验）；`sessions` 转录；scratch；`distill.json`/`memory-agents.json` 锁；触发面（GUI/Obsidian）；`mcp.json`+`skills/`；`memory-audit.jsonl`。

## 4. 沙箱与缓存
- scratch `<data>/cache/memory-agent/work/<run-id>/`；run 结束与每小时 GC，>20MB 最旧 run 整目录删至 ≤20MB；**只清此处、前缀校验、永不进 vault/memories/其它 data**。
- 写白名单：`inspirations/ _digests/ candidates/ dreams/ logs/`；读白名单：`wiki/ inspirations/ memories/`；`os.OpenRoot(vault)` 限定，拒 `..`/绝对/软链。
- 绝不直写 Magpie 存储、绕 `filelock`、碰 settings/providers/logins；白名单外报错不静默。
- Obsidian 插件侧同样自律（§10）。

## 5. 派发与调度
`distill.json` 增 `Agent`/`OrgAgent`/`DreamAgent`（缺省回退 defaults 再回退按 role 首个）。`memdistill.Keep`：`On` 按 learn、`Dreams` 按 dream、每晚按 organize。手动 `POST /api/memory/agents/<role>/run|stop`。老 `distill.json` 只有 `model` 时自动建默认 Agent 并迁移。

## 6. GUI / API
- `GET /api/memory/distill`：`models[]`→`agents[]`（按 role 过滤 `{id,name}`）。
- `POST /api/memory/distill`：`{on,model,...}`→`{on,agent,...}`。
- `/api/memory/agents`（CRUD + 设默认）。
- `GET /api/memory/agents/status?role=`：`{running,phase,doing,of,messages[],error}`。
- 前端 `internal/gui/assets/plugins/library/client.js`：模型下拉→Agent 下拉（只显示 name）+ Agent 管理面板；受 `core_budget_test.go` 预算约束。
- Obsidian 插件见 §10。

## 7. digest / 写入指令
复用 `library.PublishMemory`；`Instructions` 增 per-agent digest 开关（现状 `NoMemory` 全局；当前 `noMemory=true` 不改默认）。Library 列表出现 `memory-agent`，可勾选把 digest 追加进其 `AGENTS.md`。

## 8. 审计 / 冲突
`memory-audit.jsonl`（append-only）：机器 `save/forget/remove/promote/status` 记 时间/动作/id/role/结果。`origin=user`/`Edited` 永不被覆盖；冲突追加 `logs/memory-conflicts.md`。审计失败只记日志。

## 9. 已定决策
1. 内置实现（不拆插件）；新增 `memory-agent` 一等 agent；剔除 Copilot（`~/.copilot` 已删）。
2. vault：执行器可在白名单子目录写。
3. 计费 `memory`；模型 `group/deepseek`。
4. 独立 worktree 开发 → 合并外观改动出 `fish.37` → 发 **magpie 2.4.0 + clash 2.4.0 双包**。

## 10. Obsidian 插件 `fish-magpie-memory`
选 Agent 取代选模型；「整理/做梦」触发 run；轮询 `status` 显示逐条聊天/进度/状态；只写专用目录（`Magpie 对话/`）+ 前缀校验 + >20MB GC（只删自己笔记）；仍走私有配对令牌 + 仅本机回环。

## 11. 里程碑
- **M-A** 我们的 Agent + 注册表 + 选 Agent：`memory-agent` 出现在 magpie（带 AGENTS.md/MCP/skills）、`/api/memory/agents` CRUD、下拉选 Agent、模型不在下拉、Copilot 目标移除。
- **M-B** 执行器 + 派发：learn/organize/dream 经所选 Agent 跑；进度/停止；失败重试。
- **M-C** MCP/skills 装备 + digest 按 Agent + 沙箱 GC：mcp.json 增配工具与 skills 可用；per-agent digest 生效；scratch >20MB GC 不碰记忆；白名单外拒绝。
- **M-D** 审计/冲突。
- **M-E** Obsidian 插件：选 Agent、进度/聊天/状态、目录 sandbox + 20MB GC。
- 每项 Go 单测（沙箱/GC 负向用例）、前端 cjs 测试、不改上游既有断言。

## 12. 非目标
不拆插件；不依赖 Copilot；不扩 `Kinds`；不改 Memory MCP 对外语义；不做手机 App/潮汐看板/Bridge；不重写存储/sync/prune/tidy。

## 13. 下一步
定稿即开工：独立 worktree（基于 `fish.36 baseline`）→ M-A 最小闭环 → M-B..M-E → 合并外观改动出 `fish.37` → 双包发版。
