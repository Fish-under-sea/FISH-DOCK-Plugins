# Dock 外部原生窗口 Hook

适用目标：FISH Dock 2.2.0。宿主实现目前正在验收；本文随该版本正式发布，2.1.9 及更早宿主不提供这些接口。协议仍为 v1。该能力来自 [PR #77 的后续通用 Hook 改造](https://github.com/Fish-under-sea/FISH-Dock/pull/77)。

## 1. 创建与绘制的分工

第三方插件调用 Hook 后，Dock 创建位于主 Dock 外部的第二个原生窗口。该窗口是 Dock 进程中的独立 Tauri/WebView2 顶层窗口，拥有独立 HWND。插件用自己的 HTML、CSS、JavaScript 绘制业务界面，决定何时申请、更新和关闭窗口。

**没有插件请求创建时，Dock 不创建、不绘制这个第二窗口，不预建隐藏 WebView，不显示常驻小球。** 声明 `windows` 能力、加载设置页或订阅文件拖入，都不等于请求创建窗口；只有显式调用 `windows.open()` 才申请窗口。宿主也不会固定轮询某个文件管理插件或替它实现暂存条。

| 展示方式 | 创建方式 | 内容与位置 |
| --- | --- | --- |
| Dock 内部插件页 | 既有插件页面入口 | 页面显示在 Dock 设置面板内部 |
| Dock 外部原生窗口 | 插件显式调用 `windows.open()` | Dock 创建独立原生窗口，插件在其中绘制页面 |

这两个入口可引用插件清单中已登记的页面，使用同一套浏览器桥，但拥有各自的承载关系与页面票据。插件不能借此加载其他插件资源、任意外部网页或启动任意原生程序。

## 2. 清单与 SDK

在完整插件清单中登记能力和页面：

```json
{
  "capabilities": ["storage", "windows", "file-drop"],
  "pages": [{"id": "panel", "title": "我的面板", "entry": "panel.html"}]
}
```

这是清单片段。完整格式见 [开发者指南](README.md#清单)。页面、后端及其依赖文件仍须列在 `files` 中，写入真实 SHA-256；`page` 传页面 ID，不传文件路径或网址。

- `windows`：申请和管理本插件的外部窗口。
- `file-drop`：订阅文件拖入并接收路径；不需要拖入就不声明、不订阅。
- `storage`：独立的持久化能力；开窗本身不要求存储权限。

Node 后端使用 2.2.0 随附的 [Node SDK](https://github.com/Fish-under-sea/FISH-Dock/blob/main/sdk/node/plugin.mjs)，按既有方式放入插件资源并登记摘要。浏览器页面使用宿主注入的 `window.FishDock`，不直接调用 Tauri 管理命令，也不手动指定插件 owner。

## 3. 浏览器页面按需申请

将申请动作绑定到插件自己的按钮或业务事件：

```javascript
// 此函数仅在插件确实需要展示面板时调用。
async function showPanel() {
  return window.FishDock.windows.open({
    key: 'panel',
    page: 'panel',
    title: '我的面板',
    width: 420,
    height: 260,
    anchor: 'dock-bottom',
    offsetX: 0,
    offsetY: 8,
    transparent: false,
  });
}

const stopEvents = window.FishDock.windows.onEvent(event => {
  if (event.event === 'closed') {
    // 清理插件自身保存的页面状态；不要在这里自动重新开窗。
  }
});

// 在业务确实需要更新或关闭时：
// await window.FishDock.windows.update(handle, {height: 300});
// await window.FishDock.windows.close(handle);
// stopEvents();
```

`open()` 等页面就绪后返回不透明句柄。同插件的相同 `key` 重复申请复用同一实例。句柄由宿主分配，不能自行构造或从中推导所有者。关闭后再次显式 `open()` 才重新创建。

| 参数 | 契约 |
| --- | --- |
| `key` | 本插件内复用键，小写字母、数字、`-`、`_`，最长 64 字符 |
| `page` | 本插件 `pages[].id` |
| `title` | 可选标题，1 至 80 字符 |
| `width` / `height` | 逻辑像素，宽 160 至 2400，高 80 至 1600 |
| `anchor` | `dock-left`、`dock-bottom`、`screen` |
| `offsetX` / `offsetY` | 有限数，范围 ±20000；`screen` 下表示逻辑屏幕坐标 |
| `transparent` | 默认 `false`；`true` 使用无原生标题栏的透明浮窗，插件自行绘制外观 |

位置由宿主限制在显示器工作区内。附着 Dock 的窗口随 Dock 移动、换屏和 DPI 变化重排；全局隐藏时隐藏仍存在的窗口，恢复时不复活已关闭的窗口。窗口初次显示不抢焦点，用户点击后可输入。

## 4. 后端收到拖入后再开窗

以下示例在激活时只订阅拖入，收到真实文件拖入后才请求窗口。订阅本身不创建第二窗口：

```javascript
import {createPlugin} from './sdk.mjs';

let subscription;
let stopDrop;
let stopWindow;
let handle;
let latestPaths = [];

createPlugin({
  id: 'acme.notes',
  async activate(context) {
    stopWindow = context.windows.onEvent(event => {
      if (event.event === 'closed' && event.handle === handle) handle = undefined;
    });
    stopDrop = context.fileDrop.onEvent(async event => {
      if (event.scope !== 'dock' || event.phase !== 'drop') return;
      // 路径保留在本插件业务状态，不写 stdout 或日志。
      latestPaths = [...event.paths];
      try {
        // SDK 按序等待监听器：开窗完成后才处理停用，避免迟到结果复活状态。
        handle = await context.windows.open({
          key: 'panel', page: 'panel', title: '我的面板',
          width: 420, height: 260, anchor: 'dock-bottom',
        });
      } catch {
        // 用插件自己的状态显示错误，不盲目循环申请。
        handle = undefined;
        console.error('外部面板打开失败');
      }
    });
    subscription = await context.fileDrop.subscribe({scope: 'dock'});
  },
  async deactivate() {
    // 宿主在停用通知之前已撤销窗口、订阅和 Hook 会话；这里只清本地状态。
    stopDrop?.();
    stopWindow?.();
    subscription = undefined;
    handle = undefined;
    latestPaths = [];
  },
  commands: {
    // panel.html 通过 FishDock.call('panel.state') 获取本插件业务数据。
    'panel.state': async () => ({paths: latestPaths}),
  },
});
```

主 Dock 拖入订阅为独占；别的活动插件占用时调用返回错误，插件应向用户解释并允许稍后重试。若仅需自己的窗口接收拖入，可在开窗后订阅：

```javascript
const sub = await context.fileDrop.subscribe({scope: 'window', handle});
// 窗口关闭后宿主撤销对应命中；也可提前退订。
await context.fileDrop.unsubscribe(sub);
```

拖入事件按所有者定向交付，`enter`、`leave` 不带路径，只有 `drop` 带 `paths`。不广播给其他插件；无订阅时不启用这套拖入捕获。窗口隐藏、关闭、插件停用或换版时撤销对应区域；在途事件失效后丢弃。

每批最多 4096 个文件，宿主在分配路径缓冲区前校验 UTF-16 总量，并为 JSON 转义和协议帧预留空间；超限整批拒绝，不交付截断结果。宿主到后端的队列最多 32 帧，过载会使拖入交付失败，日志不包含路径。当前没有可靠重试或持久化；窗口生命周期与 hover 通知也可能丢失，可用 `windows.list()` 核对状态。Node SDK 按序等待事件监听器，业务异步操作应返回或等待 Promise，避免停用后迟到结果重写业务状态。

## 5. 接口与事件

浏览器入口为 `FishDock`，Node 后端入口为 `context`：

| 接口 | 返回值/用途 | 页面协议 / 后端协议 |
| --- | --- | --- |
| `windows.open(options)` | 就绪后返回窗口句柄 | `dock.windows.open` / `host.windows.open` |
| `windows.update(handle, options)` | 调整自身窗口 | `dock.windows.update` / `host.windows.update` |
| `windows.close(handle)` | 关闭结果，重复关闭幂等 | `dock.windows.close` / `host.windows.close` |
| `windows.list()` | 本插件的窗口列表 | `dock.windows.list` / `host.windows.list` |
| `windows.onEvent(listener)` | 返回取消监听函数 | 受控窗口事件桥 |
| `fileDrop.subscribe(options)` | 返回订阅句柄 | `dock.fileDrop.subscribe` / `host.fileDrop.subscribe` |
| `fileDrop.unsubscribe(handle)` | 返回退订结果 | `dock.fileDrop.unsubscribe` / `host.fileDrop.unsubscribe` |
| `fileDrop.onEvent(listener)` | 返回取消监听函数 | 受控拖入事件桥 |

事件用 `event.event` 区分：

| 事件 | 主要载荷 | 含义 |
| --- | --- | --- |
| `ready` | `handle` | 外部页面就绪 |
| `closed` | `handle`、`reason` | 窗口已销毁 |
| `anchorChanged` | `handle`、位置及尺寸 | 锚点、位置或 DPI 发生变化，坐标为物理像素 |
| `fileDrop` | `scope`、`handle`、`phase`、`paths` | 定向拖入，只有 `drop` 带路径 |

原生协议使用 `plugin.windowEvent` 通知当前插件；不要求额外声明 `events` 能力，窗口事件和拖入事件分别按 `windows`、`file-drop` 授权。

## 6. 关闭、权限与验收

宿主提供原生关闭按钮、Escape 和托盘「关闭插件窗口」出口，透明浮窗同样可关闭。插件可提供自己的关闭按钮并调用 `windows.close()`。关闭销毁窗口、释放票据与 WebView，不保留隐藏小球。停用、卸载、更新、进程崩溃、上下文切换及 Dock 退出时，宿主回收该实例窗口和订阅。

宿主从页面票据或后端会话推导身份，校验能力、包摘要、实例代次和句柄归属。跨插件句柄、过期票据、未登记页面、越界资源均拒绝。每插件最多 4 个外部窗口，全局最多 16 个；创建失败、超时或创建期间被停用会释放预留资源。

接入时至少验证：

1. 没有 `open()` 调用时，没有第二窗口、常驻小球或隐藏插件 WebView。
2. 插件显式请求后，界面出现在 Dock 外部的独立原生窗口；内部设置页仍独立工作。
3. 相同 `key` 重复调用复用窗口；关闭后恢复 Dock 不复活窗口。
4. 关闭、Escape、托盘、停用、卸载和崩溃都能清理窗口与拖入区域。
5. 无拖入订阅时不捕获；冲突明确报错；路径只到目标插件，不写日志。
6. 在真实 Windows WebView 中检查页面输入、焦点、透明窗口关闭及多屏 DPI，不能仅凭协议单测宣称这些行为已验证。

宿主侧规格、SDK 与最小协议示例见 [Dock 开发说明](https://github.com/Fish-under-sea/FISH-Dock/blob/main/app/docs/plugin-windows-2.2.0.md) 和 [window-file-drop 示例](https://github.com/Fish-under-sea/FISH-Dock/tree/main/sdk/examples/window-file-drop)。发布前将本文与最终实现逐项复核。
