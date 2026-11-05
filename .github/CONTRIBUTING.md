# 提交 issue 与 PR 的规则（FISH-DOCK-Plugins 插件仓）

> 本仓管官方插件本体与商店目录（`catalog/stable.json` 是插件版本与摘要的唯一权威）。
> **宿主（桌面 Dock 本身）的问题提到 `Fish-under-sea/FISH-Dock`**；插件只在宿主里表现出来的问题，先判断是哪一侧的契约。
> 模板见 `.github/ISSUE_TEMPLATE/`：通用 issue 用 `issue.yml`。两条路都要过下面五关。

## 零、版本用 Milestone 表达

- **版本 = 仓库的 Milestone**（右侧栏 Milestone 里选 `2.2.2` 这种），**不是标签**。
- 插件版本号以 `catalog/stable.json` 为准；Milestone 写的是**计划在哪个插件版本修掉**（三插件同版发布，所以通常就是下一个 `2.x.y`）。
- 一个 issue 只挂**一个** milestone；标签只表达**类型**，不表达版本；不要造「2.2.2 修复」这类版本标签。

## 一、先查重（必做）

1. 按「插件名 + 现象 + 版本号」搜；再用类型标签过滤（`bug`、`performance`、`ui`）。
2. 同问题的证据补到原 issue（评论：插件版本、宿主版本、日志、截图），**不新开**；确实要新开的，正文写清与 #xx 的区别。
3. 模板里的「重复检查」必须填：搜索关键词 + 看过后排除的 issue 编号。

## 二、标签只填类型（必做）

| 类型标签 | 什么时候用 |
| --- | --- |
| `bug` | 可复现的缺陷 |
| `performance` | 内存、启动耗时、包体积、构建时长 |
| `ui` | 插件页/管理页的界面、视觉、交互 |
| `accessibility` | 无障碍（焦点顺序、可访问名、对比度） |
| `enhancement` | 新能力、行为变更（含「内置项加/减」） |
| `documentation` | README、发版说明、页面内文案 |
| `question` | 需要澄清 |

`duplicate`、`invalid`、`wontfix`、`good first issue`、`help wanted` 只由维护者打。

## 三、维护者身份 + Milestone 版本（必做）

1. 「是否维护者」必答。
2. 选 **是**：右侧栏必须挂 **Milestone**，并在正文「预修复版本」写同一个号；定不下来写「待定」并保持 `help wanted`。
3. 选 **否**：写「非维护者」，由维护者分诊时挂 Milestone。
4. 维护者自开的 issue 同规：查重、标签、Milestone 一个都不能省。

## 四、侧边栏六项必须写全（必做）

GitHub 表单填不了右侧栏，**提交后由提出者补齐；不是维护者时由维护者分诊时补齐**：

| 字段 | 要求 |
| --- | --- |
| **Assignees** | 至少一个负责人；维护者自开的挂自己 |
| **Labels** | ≥1 个类型标签 |
| **Projects** | 本仓未启用 → 在正文自查里写「无」 |
| **Milestone** | **版本位**；空着等于没定版本 |
| **Relationships** | 关联/依赖/并入的 issue 编号（跨仓引用写全 `owner/repo#n`） |
| **Development** | 开工后挂分支或 PR；没开工写「未开工」 |

## 五、内容与脱敏

- 不贴令牌、凭据、私钥、他人账号或用量明细；插件日志先脱敏再贴。
- 结构写清：**插件与宿主版本 → 现象 → 复现 → 期望 → 证据**（截图、日志、`catalog/stable.json` 条目、包 sha256）。
- 数字与结论以实测为准；没测到的写「未测」，不估算。
- 涉及第三方（上游 magpie / mihomo / NearToken 等）的问题，写清是**上游缺陷**、**我们的补丁**还是**宿主契约**，别混在一张单里。

## 六、维护者分诊

- 补/改类型标签、挂 Milestone、补 Assignee 与 Relationships。
- 重复的：把内容搬进原 issue 的评论，本条打 `duplicate` 关闭（理由 not planned），并在原 issue 补一行「并入自 #xx」。
- 需要更多信息：打 `question` 并 @ 提出者。