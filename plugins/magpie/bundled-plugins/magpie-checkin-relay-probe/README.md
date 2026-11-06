# 签到&探针 · magpie-checkin-relay-probe

magpie 的一个页面插件，**页内两页切换**：左边「签到」，右边「中转站探针」。
两页的页面代码、图标与样式原样来自内置件，只多一层切换壳与一桥转发；由此
两个内置页面插件收成一个包，单独在这个仓库与 npm 上维护，magpie 再把它重新
内置。

## 两页是什么

| 页 | 做什么 | 读 / 调用 |
| --- | --- | --- |
| **签到** | 每家厂商的账号、今日积分与连签、按厂商或账号的开关、手动签到，以及「预装插件美化」那一条 | 读 `checkin:state`；调用 `checkin:set-provider` / `checkin:set-account` / `checkin:run` / `checkin:refresh` / `brand:status` / `brand:set` |
| **中转站探针** | 填中转站的 Base URL 与 Key，由 magpie 本体发出三组行为指纹探针（签名重放、计数对账、跨代 tokenizer），给出三档结论 | 调用 `relay:view` / `relay:save` / `relay:start` / `relay:status` / `relay:stop` / `magpie:open-external` |

页面本身连不到网络（宿主给页面帧的 CSP 是 `connect-src 'none'`），一切动作都经
`magpie.call` 交给 magpie 本体执行。

## 结构与「为什么是帧」

```
page/
  index.html      标签栏 + 两个帧
  app.js          标签切换、懒加载、桥转发（转发逻辑在 relay.js）
  relay.js        子帧 ↔ magpie 窗口的消息转发（纯逻辑，可单测）
  style.css       只有标签栏与帧的布局，颜色取 --magpie-*
  icon.png/svg    侧边栏与插件列表的图标（沿用签到那套，未改）
  checkin/        签到页，原样
  relay/          中转站探针页，原样
```

两页的脚本都按「整个文档就是我」写：`document.getElementById`、全局 id、各自的
样式表。塞进同一个文档必然互相踩 id 与样式，所以每页在自己的帧里跑。帧里的
`_magpie/bridge.js` 连的是 `parent`（也就是本页），因此 `relay.js` 把消息换成新
id 转发给 magpie 的窗口，回程换回原 id；主题与可见性事件广播给两个帧；
`size`（面板的活）与页面 `error` 各按原样处置。

## 宿主需要什么

- 页面帧的 CSP 放行**自己目录**里的帧（`frame-src` 为自己的页面目录），
  否则两个子帧加载不起来；
- `_magpie/bridge.js` 在页面目录的**任意深度**都能取到（子帧在 `checkin/`、
  `relay/` 下）；
- `magpie.calls` 里的 12 条都在 `PageCalls` 白名单里（`checkin:*` 5 条、
  `relay:*` 5 条、`brand:*` 2 条、`magpie:open-external`）。

以上三条由 FISH Dock 的 magpie 内置件（补丁 `v0.1.3140+fish.24` 起）提供。

## 安装

- magpie 插件页 → 添加插件 → 填 `@fish-under-sea/magpie-checkin-relay-probe`；
- 或随 FISH Dock 的 Magpie 插件内置：目录放在 Dock 的
  `plugins/magpie/bundled-plugins/magpie-checkin-relay-probe`，Dock 启动 Magpie
  时同步到 magpie 数据目录下的 `plugins/magpie-checkin-relay-probe`，并以绝对
  路径写进 `plugins.json`，首启即装、离线可用。

## 测试

```
node --test --test-isolation=none "test/*.test.mjs"
node --test --test-isolation=none "page/relay/app.test.mjs"
```

`test/relay.test.mjs` 是这层壳自己的；`page/relay/app.test.mjs` 与
`page/checkin/test/view.test.mjs` 是两页各自的，原样保留。

## 许可

MIT。页面代码与图标来自 FISH Dock 的 magpie 内置件（同为本仓作者作品）。