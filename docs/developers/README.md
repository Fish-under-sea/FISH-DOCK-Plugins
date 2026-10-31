# 插件开发者指南

当前协议为 v1，四个已发布官方插件为 2.0.0（作者用数组、不再有维护者字段）；`plugins/relay-probe` 是开发中的中转站行为探针，尚未进入发行目录。源码已接入独立后台、分类存储和业务页面；发行资源与线上索引由插件仓 Release 提供。

## 仓库边界

Dock 仓维护桌面宿主、Node SDK、浏览器桥、安装更新与回滚、Windhawk、「插件」管理页和标签排序。本仓维护 `plugins/feishu`、`plugins/clash`、`plugins/magpie`、`plugins/ofm`，以及开发中的 `plugins/relay-probe`、`shared`、`tools/stage-development.mjs`、商店目录和插件文档。

不要把业务页面重新写入 Dock 设置页，也不要把源码目录当成用户数据目录。正常发行版默认不预装这些插件；调试版通过明确的开发目录装载。

## 清单

每个插件目录包含 `plugin.json`。当前实际字段示例：

```json
{
  "schema": 1,
  "id": "acme.weather",
  "name": "天气",
  "version": "1.0.0",
  "hostApi": 1,
  "platforms": ["windows-x86_64"],
  "storage": {"directory": ".plugin.acme.weather", "dataSchema": 1},
  "behaviors": {"autostart": true},
  "backend": {"runtime": "node", "entry": "backend.mjs"},
  "capabilities": ["storage"],
  "pages": [{"id": "main", "title": "天气", "entry": "page.html"}],
  "files": {"backend.mjs": "<SHA256>", "page.html": "<SHA256>", "README.md": "<SHA256>", "sdk.mjs": "<SHA256>"}
}
```

示例的摘要为占位值，制作资源时替换为真实文件的 SHA-256。`plugin.json` 不把自身列入 `files`。路径使用相对路径与正斜杠，资源树只包含普通文件。官方 ID 与目录映射固定；第三方使用 `.plugin.<publisher>.<name>`，在准入时检查命名冲突与归属。

## 后台 SDK

复制 Dock 的 `sdk/node/plugin.mjs` 到插件中，然后：

```javascript
import {createPlugin} from './sdk.mjs';
let context;
createPlugin({
  id:'acme.weather',
  activate:async value=>{context=value},
  deactivate:async()=>{},
  commands:{
    'weather.view':async()=>({city:await context.storage.read('config','city.txt')}),
    'weather.save':async params=>{
      await context.storage.write('config','city.txt',String(params.city));
      return {saved:true};
    }
  }
});
```

协议是带编号的 JSON 行。stdout 只传协议数据。`host.hello` 绑定协议、插件 ID、版本与命名空间；随后激活，再处理业务方法及事件。SDK 检查帧大小、队列、调用时限和响应编号。停用应关闭自有子进程并完成清理。

`context.storage.read/write(category,name,...)` 处理分类文本。`context.secrets.read/write` 处理 `credentials`、`keys` 的加密文本。SDK 拒绝越级路径、设备名和保留 README 文件名。原生服务需要复杂目录时，插件适配器在自身命名空间分类映射。独立进程由宿主管生命周期，未提供操作系统权限沙箱。

## 行为钩子

清单里的 `behaviors.autostart` 决定这颗开关在 Dock 插件卡上出不出现，也是插件侧唯一要看的钩子（2.0.0 起）：

| 清单值 | 卡面 | 宿主传的环境变量 |
| --- | --- | --- |
| `true` | 「随 Dock 启动 / 已关闭」两态胶囊 | 打开的那次启动传 `FISH_PLUGIN_AUTOSTART=1` |
| `false` | 灰色小字「无需自启动」，不占按钮语义 | 不传 |

规则只有一条：**`FISH_PLUGIN_AUTOSTART=1` 只代表「随 Dock 启动」这一次**。安装、点启用、回滚、手动启动都不传 1，服务等用户自己点。`activate()` 末尾按这个语义拉起本机服务，未配置或已在运行时保持原样：

```javascript
activate:async context=>{
  service=createGateway({context,runtime:createRuntime(context),kind:'acme'});
  await service.load();
  // 只有「随 Dock 启动」这一次把本机服务拉起来。
  if(process.env.FISH_PLUGIN_AUTOSTART==='1'&&service.view().state==='stopped')void service.start().catch(()=>{});
},
```

- 有本机服务的插件（Clash、Magpie、OFM）写 `true`；没有服务的插件（飞书）写 `false`，也不要读这个变量。
- 清单由 `tools/stage-development.mjs` 生成，开关值写在 `definitions` 的 `autostart` 字段上，不要在打包后手改 `plugin.json`。
- 自启动开关只有宿主插件卡一处：插件页里不要再放开关，也不要去调 `dock.autostart`，否则两处状态会打架。
- `view()` 是异步的（如 Clash 要读控制器状态）时，先等它再判断，别把 Promise 当对象读 `.state`。

## 页面 SDK

页面只使用宿主注入的 `window.FishDock.call(method,params)`：

```javascript
const view=await window.FishDock.call('weather.view');
```

宿主用票据绑定插件 ID、活动版本与启用状态。业务页面运行在独立来源的 sandbox iframe；来源和发送窗口需要同时匹配，页面不能指定其他插件身份。停用、卸载与版本切换撤销旧票据。页面需要显示加载、空状态、错误与重试，保留键盘焦点和可访问名称。

Magpie、OFM 的 `gateway.open` 是宿主提供的特定管理页入口，地址只接收当前服务的回环端口。普通插件不借用该入口。网关页面按需加载，其原生账号与用量仍由各自服务处理。

## 事件与数据

声明 `events` 后通过 `onEvent` 接收宿主规范化事件。飞书按配置筛选通知，不接收远程指令。配置变更与 Webhook 测试分别处理；测试按钮会向用户配置的机器人发送消息，自动回归使用替身。

数据根由宿主解析。各命名空间采用 `credentials`、`roster`、`keys`、`config`、`exports`、`backups`、`tmp`，版本 README 由宿主生成。导入导出保留插件身份和相对路径，在目标根重新定位。升级前备份业务分类；激活失败时恢复旧资源与原资料。schema 发生变化时同时提供兼容和恢复说明。

## 开发验证

先按 [项目 README](../../README.md) 暂存开发目录，并用显式 Node、独立 `.fish-dock` 与调试宿主加载。

```powershell
node --test --test-isolation=none 'plugins/feishu/*.test.mjs' 'plugins/clash/*.test.mjs' 'plugins/magpie/*.test.mjs' 'plugins/ofm/*.test.mjs' 'plugins/relay-probe/*.test.mjs' 'shared/*.test.mjs' 'tools/*.test.mjs'
```

`FISH_TEST_MAGPIE` 与 `FISH_TEST_OFM` 启用真实服务验收。验证首次配置、保存失败、业务错误后的继续操作、端口占用、启动就绪、停止、连续启停、卸载保留资料，以及升级失败回滚。前端单测通过后，再用真实 WebView 核对页面加载、布局切换与键盘操作。

发行制作、固定来源与商店更新顺序见 [维护者指南](../maintainers/README.md)。
