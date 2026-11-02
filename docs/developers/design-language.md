# 设计语言（第三方插件页面）

> 面向写插件页面的人：这一页只讲"长什么样、为什么这么定"。协议与钩子见 [插件开发者指南](README.md)。
> 出处：2.1.3 的 Clash 页重构 ＋ 2.1.4 的尺寸刻度收敛。官方插件（Clash / Magpie / 飞书）都按这套写，第三方插件建议对齐——宿主不会强制，但不对齐的页面放在 Dock 面板里会明显"不是一套东西"。

## 1. 主题只有两种来源，别自己猜

宿主在页面文档根上写两个东西，页面只读它们：

| 来源 | 用法 |
| --- | --- |
| `data-dock-theme` 属性（`light` 或缺失表示 dark） | 浅色覆盖的唯一开关 |
| `--dock-*` CSS 变量 | 宿主同步的灰阶、文字、强调色 |

**不要用 `prefers-color-scheme`**。用户可能把系统设成浅色、把 Dock 设成深色，跟系统走就会双主题打架。Clash 页 2.1.3 之后 `prefers-color-scheme` 命中数为 0，这是刻意维持的红线。

```css
:root{color-scheme:dark}
:root[data-dock-theme=light]{color-scheme:light}
```

## 2. 两层 token：宿主的 `--dock-*` ＋ 页面自己的语义层

宿主提供的基础变量（见 `shared/dock.css`）：

```
--dock-bg  --dock-card  --dock-control  --dock-line  --dock-muted  --dock-text  --dock-accent
```

复杂页面在基础层之上再定义一层语义 token，页面里**只引用语义层**，不出现裸色值。Clash 页的这套可以直接抄：

| token | 用途 | 说明 |
| --- | --- | --- |
| `--layer-1` / `--layer-2` | 卡片 / 卡片内的次级面 | dark 上纯黑不可见，靠它们分层 |
| `--hi` | 内高光（`inset 0 1px 0 var(--hi)`） | 纯黑背景上唯一有效的"抬起"手段；投影在 `#000` 上看不见 |
| `--line-hair` | 弱分隔线 | 分组内部 |
| `--line-control` | 控件边界 | 输入框、按钮、下拉触发器，**对比度 ≥ 3:1** |
| `--c-ok` / `--c-warn` / `--c-bad` | 三态文字/图标 | dark 对 `#0f0f11` 实测 9.47 / 13.56 / 6.23，均 ≥ 6 |
| `--c-ok-bg` / `--c-warn-bg` / `--c-bad-bg` | 三态底色 | 标签、banner |
| `--sel-bg` / `--sel-line` | 选中态底 / 左侧强调条 | 列表项 |
| `--glass` | 半透明面 | **必须配 `@supports` 兜底**，见第 7 节 |

浅色档用 `:root[data-dock-theme=light]` 整段覆盖，不要在每个组件里写 `if`。

## 3. 尺寸刻度表（先立表，再逐处套用）

这些"看着不顺"的问题十个里有八个不是审美，而是**孤值**：某处手写 `22px`、某处 `30px`，凑在一起就歪。

| 项 | 取值 | 备注 |
| --- | --- | --- |
| 字号 | 13（标题）/ 12.5（正文、字段、按钮）/ 12（说明、辅助） | 不要出现 11 / 14 |
| 行高 | 28（列表项、紧凑行）/ 26（详情 `.kv` 行） | 行距 = 行高，不额外加 margin |
| 图标 | 16×16 盒子 | emoji 也要包进盒子，见第 6 节 |
| 圆角 | 14 / 999 两档 | 卡片 14，胶囊 999 |
| 间距 | 4 的倍数 | 组内 8–12，块间 16 |
| 控件高度 | 按钮与输入 28–32 | 弹层触发器 32 |

## 4. 控件八态

任何可交互元素都要把八态想清楚，缺一态就会出现"看着能点其实不能点"或"点了没反应"：

| 态 | 表现 | 要点 |
| --- | --- | --- |
| 默认 | 描边 `--line-control` | |
| hover | `filter:brightness(1.15)` | 不新造颜色 |
| active | `translateY(1px)` | 只给触感，不改布局 |
| focus-visible | `outline:2px solid var(--dock-accent); outline-offset:2~3px` | **键盘可达必须有**，不要 `outline:none` |
| disabled | `opacity:.5` ＋ **写明原因** | 只降透明度是不够的，见第 8 节 |
| loading | 局部 busy，按钮文字变进行态 | 不整页禁用 |
| error | 行内 `role=alert` ＋ 可重试入口 | 错误不吞掉 |
| selected / pressed | `aria-pressed` / `aria-selected` ＋ 底色 | 状态要能从 DOM 读出来，不只是颜色 |

## 5. 列表与下拉（选做，但做了就要做对）

原生 `<select>` 的弹层由系统绘制，与页面主题两套，且焦点在它上面时页面不能重绘。要做自绘 listbox 就守这几条：

- 行高统一 28px，`padding:2px 8px`，**选项之间不加 margin**（行距 = 行高）；
- 选中项：左侧 `inset 2px 0 0 var(--sel-line)` 强调条 ＋ 勾，位置固定不随文字长度漂移；
- 弹层是 `position:fixed` 并挂到页面根的 `#popover-root`，避免被 `overflow` 容器裁掉；
- 键盘：`↑ ↓ Enter Esc Tab` ＋ 首字 type-ahead；>12 项出现过滤输入框；
- **只在弹层外部滚动时收起**：`window` 上挂 `wheel` 捕获监听时，必须判 `if(pop.contains(e.target)) return`，否则用户在列表里滚一下就"弹层消失"；
- 弹层底色用不透明 `--layer-1`，不要指望 `backdrop-filter`。

## 6. emoji 与图标：一定包进 16px 盒子

厂商名、分组名里带 emoji 是常态（`🔵 微软服务`、`♻️ 自动选择`）。emoji 的字形高度**不受 `font-size` 约束**，直接把行撑到 40px 以上，还会上下溢，看起来"又大又散"。

```css
.ico{width:16px;height:16px;flex:none;display:inline-flex;
     align-items:center;justify-content:center;font-size:14px;line-height:16px}
```

这是把字形高度关进笼子的唯一可靠办法。2.1.4 之前 Clash 的代理组弹层就是因为没做这一步，被反复投诉"选项太大、很丑"。

## 7. 半透明与模糊：必须有兜底

`backdrop-filter` 在禁 GPU / 远程桌面 / headless 环境**不渲染，但 `@supports` 仍报支持**，于是兜底分支不触发，弹层变成"半透明看穿"。

规则：需要读文字的面板（弹层、抽屉、浮层）**直接用不透明底**；只有纯装饰层才用 `--glass`，并且配：

```css
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .glass{background:var(--layer-1)}
}
```

## 8. 文案与数据口径

| 场景 | 按这个写 |
| --- | --- |
| 数据未知 | 显示「未告知」/「N 项未告知」，**不要显示 `0`**——0 是一个具体结论，未知不是 |
| 数据可能过期 | 表头给「数据截至 HH:MM」，并说明来源（台账 / 实时） |
| 按钮不可用 | 除了置灰，还要写原因（行内 muted 小字或 `title`），例如「内核未运行，无法接管系统代理」 |
| 长时间操作 | 显示进行态 ＋ 可取消；完成后给结果，不留"好像没反应" |
| 破坏性操作 | 两步确认或用 5 秒可撤销；确认条要能 `Esc` 取消并把焦点还回去 |
| 错误提示 | 说清"发生了什么 + 下一步能做什么"，不写裸错误码；错误码表见 `shared/errors.mjs` |

**错误码两份表必须逐字一致**：`shared/errors.mjs` 是权威，页面侧（如 `plugins/clash/page.js` 的 `ERROR_TEXT`）是副本，单测逐码比对。只改一边，测试立刻红——这是故意的。

## 9. 无障碍底线

- 键盘可达全部交互，焦点可见（`focus-visible`）；
- 状态进 DOM（`aria-pressed` / `aria-selected` / `aria-expanded` / `aria-live`），不只用颜色表达；
- 列表键盘走 `aria-activedescendant`，不要让每个选项都 `tabindex=0`；
- 控件边界对比度 ≥ 3:1，正文 ≥ 4.5:1，三态文字对底色 ≥ 6:1；
- `@media (prefers-reduced-motion: reduce)` 关动效，`@media (forced-colors: active)` 不要依赖自定义底色；
- 数字列用 `font-variant-numeric: tabular-nums`（延迟、额度、端口、时间），否则切换数值时字符宽度跳变。

## 10. 反面清单（都是真踩过的）

| 做法 | 后果 |
| --- | --- |
| 在数据行里塞胶囊按钮 | 按钮把行高从 26 撑到 30+，同一网格里左右两栏文字逐行错位（2.1.3 的「复制」按钮，2.1.4 已移除） |
| emoji 不包盒子 | 行高随 emoji 字形失控，列表看起来"又大又散" |
| 面板用半透明 + 模糊但没兜底 | 禁 GPU 环境下文字透出，像坏了 |
| 吸底操作条压在内容上 | 最后一排按钮被遮一半（2.1.3 的 560 宽内核设置页） |
| 用 `resize`/`wheel` 无条件下关闭浮层 | 用户一滚就"弹层消失"，或窗口变化时状态错乱 |
| 卡片等高靠 `height:100%` | 内容超出时被裁切，且不同浏览器下表现不一 |

---

改这套规范时请同步更新本章与 `docs/releases/<版本>.md` 里的「设计取舍」一节：改了要能解释为什么。