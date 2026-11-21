# 液态玻璃与主题联动 Hook（Liquid Glass Hooks）

> 面向插件作者。包含两套一脉相承的机制：**① FISH Dock 宿主全局主题与玻璃联动（`window.FishDock.theme`）**，供所有 Dock 内部插件页与外部原生窗口使用；**② Magpie 宿主扩展页专用液态玻璃钩子（`magpie.onGlass`）**，供跑在 Magpie 沙箱帧里的页面插件使用。

---

## 第一部分：FISH Dock 宿主玻璃与主题联动（`window.FishDock.theme`）

适用目标：FISH Dock 2.3.x 及以后（随 `sdk/browser/bridge.js` 自动注入）。无论插件页嵌入 Dock 设置面板还是运行在独立外部原生窗口，宿主都会在就绪及外观变更时下发 `fish:theme` 消息。

### 1.1 最省事的接入：`FishDock.theme.follow()`

如果你的页面使用常见卡片容器（`.card` / `.panel` / `.grp`）与原生控件（`button` / `input` / `select`），只需在入口 JS 调一次：

```js
// 开启自动跟随：宿主处于玻璃模式时自动注入透明底与毛玻璃规则；传 false 可关闭
window.FishDock.theme.follow(true)
```

开启后，桥接脚本会在 `<head>` 注入 `<style data-fish-dock-follow="1">`，在 `:root[data-dock-glass="1"]` 时自动把 `body` 设为透明底，并为 `.card` / `.panel` / `.grp` 与表单控件应用 `--dock-glass-card`、`--dock-glass-card-blur`、`--dock-glass-control` 与 `--dock-glass-border`。

### 1.2 `<html>` 状态属性

宿主每次下发主题时会在 `<html>` 上同步三个属性，供 CSS 条件选择器使用：

| 属性 | 取值 | 含义 |
| --- | --- | --- |
| `data-dock-theme` | `'light'` \| `'dark'` | 当前明暗色彩模式 |
| `data-dock-mode` | `'light'` \| `'dark'` \| `'glass'` \| … | 当前宿主外观模式 |
| `data-dock-glass` | `'1'` \| `'0'` | 液态玻璃是否开启（`appearance.glass.enabled` 为真或 `dockMode === 'glass'` 时为 `'1'`） |

```css
:root[data-dock-glass="1"] .my-surface {
  background: var(--dock-glass-card, rgba(28, 30, 42, 0.22));
  -webkit-backdrop-filter: blur(var(--dock-glass-card-blur, 12px)) saturate(1.35);
  backdrop-filter: blur(var(--dock-glass-card-blur, 12px)) saturate(1.35);
  border: 1px solid var(--dock-glass-border, rgba(255, 255, 255, 0.16));
}
```

### 1.3 宿主注入的 CSS 变量

桥接脚本会在 `:root` 上写入经过校验的宿主样式变量：

- **基础调色板**：`--dock-bg`、`--dock-card`、`--dock-control`、`--dock-line`、`--dock-muted`、`--dock-text`、`--dock-accent`
- **四区域玻璃参数**（`surface` 主面板 / `card` 卡片 / `overlay` 浮层 / `control` 控件）：
  - 合成底色（玻璃开启时下发）：`--dock-glass-surface`、`--dock-glass-card`、`--dock-glass-overlay`、`--dock-glass-control`、`--dock-glass-border`
  - 精确数值（`0`–`1` 小数不透明度与 `px` 模糊半径）：
    - `--dock-glass-surface-op` / `--dock-glass-surface-blur`
    - `--dock-glass-card-op` / `--dock-glass-card-blur`
    - `--dock-glass-overlay-op` / `--dock-glass-overlay-blur`
    - `--dock-glass-control-op` / `--dock-glass-control-blur`
- **宿主壁纸变量**（若已配置壁纸）：`--dock-wallpaper-url`（`url("...")` 或 `none`）、`--dock-wallpaper-dim`（`0`–`1` 遮罩浓度）

### 1.4 JS 监听接口

```js
// 读取当前快照：{ mode, dockMode, colors, appearance } | null
const snap = window.FishDock.theme.current()

// 订阅变更（若已有快照会立即回调一次）；返回取消订阅函数
const off = window.FishDock.theme.onChange(theme => {
  console.log(theme.mode, theme.dockMode, theme.appearance?.glass)
})
```

---

## 第二部分：Magpie 插件页液态玻璃钩子（`pagebridge.js`）

> 目标：**一个 Magpie 页面插件接上这里的钩子，就自动跟 Magpie 主界面的液态玻璃、壁纸遮罩与字体调色一致**——不用自己实现模糊、不用猜配色，Magpie 改预设时页面跟着变。

### 2.1 四区域坐标模型

Magpie 的「设置 › 外观」把液态玻璃拆成**四个区域**，各有一组数字：

| 区域 | `region` | 管到的元素 |
| --- | --- | --- |
| 侧边栏与标题栏 | `sidebar` | 导航、顶栏 |
| 主界面 | `content` | 卡片、列表这类阅读面 |
| 浮层与对话框 | `overlay` | 菜单、对话框、确认条 |
| 控件 | `control` | 按钮、输入框、下拉 |

每个区域是一对坐标：

- `fill`：0–100 的**不透明度百分比**，`100` = 完全不透明（实底）；
- `blur`：0–40 的**模糊半径（px）**，`0` = 不模糊。

「关闭」不是一个布尔开关，而是 `fill=100 / blur=0` 这个坐标点。预设（关闭 / 轻透 / 均衡 / 全透 / 自定义）只是往这组数字里写值。

### 2.2 页面拿到的 CSS 变量、属性与 JS 钩子

插件页跑在 Magpie 沙箱帧里，通过 `pagebridge.js` 拿到以下能力：

#### CSS 变量（最省事）

主题下发时，`<html>` 上已经写好四区域玻璃与扩展外观变量：

```
--magpie-glass-sidebar-fill   --magpie-glass-sidebar-blur
--magpie-glass-content-fill   --magpie-glass-content-blur
--magpie-glass-overlay-fill   --magpie-glass-overlay-blur
--magpie-glass-control-fill   --magpie-glass-control-blur
--fish-glass-tint             /* 2.4.5+：独立玻璃色调（与强调色解耦，未设时回退中性玻璃） */
--wall-veil                   /* 2.4.4+：壁纸底图遮罩色/浓度（随内容区不透明度动态重算） */
--ctl-fg                      /* 2.4.7+：控件与占位符前景文字色（配合 --fg / --fg-2 等使用） */
```

`fill` 是百分比（`82%`），`blur` 是长度（`18px`）。直接用就能跟主界面同一套数字：

```css
.my-card {
  background: color-mix(in srgb, var(--card) var(--magpie-glass-content-fill, 100%), transparent);
  -webkit-backdrop-filter: blur(var(--magpie-glass-content-blur, 0px));
  backdrop-filter: blur(var(--magpie-glass-content-blur, 0px));
}
```

带上回退值（`var(--x, 100%)`），这样没接主题的宿主上也照常是实底。

#### `<html data-magpie-glass>`

任何一个区域真的在「玻璃」状态（`fill < 100` 或 `blur > 0`）时，`<html>` 上会有 `data-magpie-glass` 布尔属性（存在即开启，移除即关闭）。用它做**条件增强**：

```css
html[data-magpie-glass] .my-panel { /* 只在玻璃开着时加高光边 */ }
```

#### JS 钩子

```js
// 当前值：{on: boolean, regions: {sidebar:{fill,blur}, content:{...}, overlay:{...}, control:{...}}}
magpie.glass()

// 主题变化时回调（切深浅色、改任一区域、换预设都会触发）；返回取消订阅函数
const off = magpie.onGlass((glass) => { /* 重新上色 / 重算布局 */ })
```

两者都在 `magpie` 命名空间下，与 `magpie.onTheme` 同级；页面卸载时调用返回的函数取消订阅。

### 2.3 三条硬约束（不遵守就会跟主界面打架）

1. **不要自己写死模糊值**。`blur(18px)` 写死在 CSS 里，用户把「模糊」拖到 0 时你的页面还糊着，看起来就像 Magpie 没生效。一律走变量。
2. **`fill` 为 0 时不要什么都不要**。0% 只是「底色全透」，玻璃的高光边与柔光应当还在；否则用户看到的是一个洞。注意也不要把纯黑 `#000` 残留底色写死在背景层上（2.4.6 已修主界面 `0%` 全透无黑底残余）。
3. **文字要留在实底上**。区域透明度低的时候，控件胶囊（按钮、输入框）仍然建议保留一层自己的底——这是 `docs/developers/design-language.md` 的既有规矩，玻璃化不等于把可读性一起透掉。

### 2.4 降级（必须写）

```css
/* 环境不支持背景模糊：回落实底 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .my-card { background: var(--card); backdrop-filter: none; }
}

/* 用户要求减弱透明：回落实底 */
@media (prefers-reduced-transparency: reduce) {
  .my-card { background: var(--card); backdrop-filter: none; }
}

/* 高对比度模式 */
@media (forced-colors: active) {
  .my-card { background: Canvas; border: 1px solid CanvasText; }
}
```

### 2.5 一个可用的最小实现

```css
.panel {
  background: color-mix(in srgb, var(--card) var(--magpie-glass-content-fill, 100%), transparent);
  -webkit-backdrop-filter: blur(var(--magpie-glass-content-blur, 0px)) saturate(180%) brightness(1.06);
  backdrop-filter: blur(var(--magpie-glass-content-blur, 0px)) saturate(180%) brightness(1.06);
  border-radius: 14px;
  box-shadow: inset 0 1px 0 var(--line-2);
}
```

`saturate`/`brightness` 是「折射观感」的关键：只做 `blur` 会像一块毛玻璃板，加上去才像玻璃。真正的折射位移（`backdrop-filter: url(#filter)`）目前只有 Safari 支持，Chromium 下用这组近似即可。

### 2.6 现状与参考实现

- 宿主侧 `FishDock.theme` 随 FISH Dock 2.3.x `sdk/browser/bridge.js` 下发；Magpie 侧 `magpie.onGlass` 自 2.4.0（`fish.36`）下发，至 2.4.9（`fish.49`）已完成 163 条静态表面规则覆盖（由 `plugins/magpie/tools/glass-surfaces.mjs` 扫描生成）及 `--fish-glass-tint`、`--wall-veil`、`--ctl-fg` 等多层级调色解耦。
- 参考实现：本仓 `plugins/clash/page.css` 的 `@supports` 段与 `plugins/magpie` 的 `fish-glass.css`——同一套变量与降级写法，可以直接对照抄。
