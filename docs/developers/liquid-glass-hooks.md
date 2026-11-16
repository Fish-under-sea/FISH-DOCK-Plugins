# 液态玻璃：插件页怎么接（Liquid Glass 钩子）

> 面向插件作者。目标：**一个插件页接上这里的钩子，就自动跟 Magpie 的液态玻璃一致**——不用自己实现模糊、不用猜配色，Magpie 改预设时你的页面跟着变。

## 1. 它是什么

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

## 2. 页面拿到的三种东西

插件页跑在沙箱帧里，通过 `pagebridge.js` 拿到三项：

### 2.1 CSS 变量（最省事）

主题下发时，`<html>` 上已经写好：

```
--magpie-glass-sidebar-fill   --magpie-glass-sidebar-blur
--magpie-glass-content-fill   --magpie-glass-content-blur
--magpie-glass-overlay-fill   --magpie-glass-overlay-blur
--magpie-glass-control-fill   --magpie-glass-control-blur
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

### 2.2 `<html data-magpie-glass>`

任何一个区域真的在「玻璃」状态（`fill < 100` 或 `blur > 0`）时，`<html>` 上会有 `data-magpie-glass` 属性，值是 `true`/`false`。用它做**条件增强**：

```css
html[data-magpie-glass="true"] .my-panel { /* 只在玻璃开着时加高光边 */ }
```

### 2.3 JS 钩子

```js
// 当前值：{on: boolean, regions: {sidebar:{fill,blur}, content:{...}, overlay:{...}, control:{...}}}
magpie.glass()

// 主题变化时回调（切深浅色、改任一区域、换预设都会触发）；返回取消订阅函数
const off = magpie.onGlass((glass) => { /* 重新上色 / 重算布局 */ })
```

两者都在 `magpie` 命名空间下，与 `magpie.onTheme` 同级；页面卸载时调用返回的函数取消订阅。

## 3. 三条硬约束（不遵守就会跟主界面打架）

1. **不要自己写死模糊值**。`blur(18px)` 写死在 CSS 里，用户把「模糊」拖到 0 时你的页面还糊着，看起来就像 Magpie 没生效。一律走变量。
2. **`fill` 为 0 时不要什么都不要**。0% 只是「底色全透」，玻璃的高光边与柔光应当还在；否则用户看到的是一个洞。
3. **文字要留在实底上**。区域透明度低的时候，控件胶囊（按钮、输入框）仍然建议保留一层自己的底——这是 `docs/developers/design-language.md` 的既有规矩，玻璃化不等于把可读性一起透掉。

## 4. 降级（必须写）

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

## 5. 一个可用的最小实现

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

## 6. 现状与已知边界

- 钩子已随 Magpie 2.4.0（`fish.36` 起）下发；本轮 2.4.2 补的是**壁纸遮罩随内容区自适应**，插件侧不需要改。
- 参考实现：本仓 `plugins/clash/page.css` 的 `@supports` 段与 `plugins/magpie` 的 `fish-glass.css`——两边用同一套变量与降级写法，可以直接对照抄。
