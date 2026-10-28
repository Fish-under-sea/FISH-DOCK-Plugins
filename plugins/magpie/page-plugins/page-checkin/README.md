# 自动签到 · page-checkin

magpie 窗口里的一个页面：按厂商分组显示每个已登录账号今天的签到结果、实得积分与连续天数，可逐厂商 / 逐账号开关，可一键手动签到。

- 包名：`@magpie-community/page-checkin`
- 页面标题：`自动签到`（`en`：Check-in）
- 版本：0.2.3（配合 magpie 1.2.1 的 `checkin:state` 读取）

## 宿主需要提供什么

| 能力 | 用途 |
| --- | --- |
| 读 `checkin:state` | `{providers, accounts, today, credits, running}` |
| 写 `checkin:set-provider` | 落到 `settings.pluginCheckins`（与设置页「每日自动签到」同一个开关） |
| 写 `checkin:set-account` | 落到 `settings.checkinOff`（账号级排除） |
| 写 `checkin:run` | 调 `provider.CheckInPlugins`；`provider` 省略表示全部账号 |
| 写 `checkin:refresh` | 重新读取额度与今日积分 |

页面不缓存开关状态：每次进入与每 60 秒重新读取一次，因此和设置页永远同源。宿主没有 `magpie.act` 时，写动作退回同源的 `/api/settings/plugin-checkin`、`/api/settings/checkin-account`、`/api/usage/plugin-checkin`、`/api/usage/quotas/refresh`，行为一致。

## 装在哪

- magpie 的插件页 → 添加插件 → 填 `@magpie-community/page-checkin`；
- 或随 FISH Dock 的 Magpie 插件内置：目录放在 Dock 的 `plugins/magpie/page-plugins/page-checkin`，打包时 `stage-development.mjs` 递归复制进产物，Dock 启动 Magpie 时用 `MAGPIE_SEED_EXTRA` 指向它，首启装进插件清单（装的是目录副本，不依赖 npm）。没带这份目录的普通 magpie 则退回 `DefaultSpecs` 里的 `@magpie-community/page-checkin@latest`。

写动作（`checkin:set-provider` 等）声明在 `package.json` 的 `magpie.calls` 里 —— 这是 magpie 1.2 起的「页面可写动作」白名单字段（1.1 及更早用的是 `magpie.actions`）。

## 边界

签到是厂商侧动作：Qoder 需要本机存在 Qoder 客户端提供的设备标识，Trae 可能回 `9074`，WorkBuddy 的国内版与国际版各自独立。页面把厂商返回的原因**原样**显示，不把它翻译成"已修复"。跨机同步登录态之后，这类与设备绑定的厂商仍可能不符合条件 —— 这是厂商侧的规则，不是页面能绕过的。

## 测试

```powershell
node --test --test-isolation=none test/view.test.mjs
```

`page/view.js` 不碰 DOM（只挂 `globalThis.CheckinView`），分组、状态文案、今日积分汇总都可直接测。