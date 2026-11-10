# Dock 外部原生窗口 Hook

适用目标：FISH Dock 2.2.0 及以后。2.1.9 及更早宿主不提供这些接口。协议仍为 v1。该能力来自 [PR #77 的后续通用 Hook 改造](https://github.com/Fish-under-sea/FISH-Dock/pull/77)。原生窗口焦点、混合 DPI 与真实拖入尚未在隔离机器完成验收，见 [#84](https://github.com/Fish-under-sea/FISH-Dock/issues/84)。

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
| `width` / `height` | 逻辑像素，宽 32 至 2400，高 32 至 1600 |
| `anchor` | `dock-left`、`dock-bottom`、`screen` |
| `align` | 2.2.2：窗口哪条边/角贴锚点，八种取值；缺省按 `anchor` 取 2.2.1 的等价对齐 |
| `anchorBase` | 2.2.2：`window`（缺省，2.2.1 行为）或 `capsule`（贴可见胶囊） |
| `width: 'dock'` | 2.2.2：跟随胶囊当前宽度；配合 `maxWidth` 表达可增长上限 |
| `zOrder` | 2.2.2：`normal`（缺省）或 `above-dock`（置顶，压在主岛之上） |
| `offsetX` / `offsetY` | 有限数，范围 ±20000；`screen` 下表示逻辑屏幕坐标 |
| `transparent` | 默认 `false`；`true` 使用无原生标题栏的透明浮窗，插件自行绘制外观 |

位置由宿主限制在显示器工作区内。附着 Dock 的窗口随 Dock 移动、换屏和 DPI 变化重排；全局隐藏时隐藏仍存在的窗口，恢复时不复活已关闭的窗口。窗口初次显示不抢焦点，用户点击后可输入。

### 3.1 锚点的精确语义

**`dock-left` 与 `dock-bottom` 锚的是主岛窗口，不是可见的胶囊。** 这两个矩形不是一回事，按胶囊估算位置会偏，务必先看清：

- 主岛窗口在非任务栏形态下**铺满整个工作区宽**，高度固定 132 逻辑像素，贴工作区左上角。可见胶囊只是这个窗口内的一小块：顶部内缩 8 逻辑像素、高 36，按 `islandPos` 居中或靠边。
- `dock-left` 按 `dx - width - offsetX` 算出的原始 X 是**负值**（主岛窗口左缘在主岛 x=0，再往左一个窗口宽），随后被工作区约束夹回 `x = 工作区左缘`。**所以 `dock-left` 的实际效果是把窗口贴在工作区最左边**，与胶囊在哪个位置无关。
- `dock-left` 的 `offsetX` 符号与直觉相反：**正值继续往左（被夹住，看不出变化），负值才把窗口往右推**。例：1920 宽工作区、窗口 160 宽，`offsetX: -200` 把窗口放到 `x=40`。
- `dock-bottom` 落在**主岛窗口底边**（默认 y=132）下方 `offsetY`，与胶囊底边（y≈44）之间还有约 88 逻辑像素的空隙；水平方向 `x = dx + offsetX`，`dx` 是主岛窗口左缘，同样在工作区最左。

垂直方向两者都按 132 高的主岛窗口居中，不是按 36 高的胶囊居中：窗口高 80 时 y 起点为 26，胶囊在 y 8–44，两者并不对齐。

换句话说，「窗口右缘贴住胶囊左缘」用 `dock-left` 做不到——不是 `offset` 调不出来，而是基准点本身在工作区边缘，且算出的位置还会被夹回去。需要这类对齐时，只能自行在页面内用负 margin / `transform` 把内容推到窗口边缘，并接受窗口尺寸一变就要重算。见 §8 的 C1–C5。

### 3.2 重排的触发条件

`anchorChanged` 在宿主检测到主岛窗口矩形变化时发出，触发源是主岛的 `Moved`、`Resized`、`ScaleFactorChanged` 三类窗口事件。

**胶囊变长/变短、展开/收起、被唤醒滑出，都不会触发重排**——这些变化全部发生在主岛窗口的页面内部，宿主窗口本身不动。所以锚定窗口在胶囊形态变化后会停在原处，需要插件自己处理（同样见 §8）。


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

**命中区包含插件自己的窗口。** 拖入落在哪个目标上，按真实的原生 z 序取最上层：插件窗口盖在主岛胶囊上时，落点归那个窗口的所有者；被其他应用遮住时不截获，也不转给别人。

从资源管理器拖文件时，按下点落在命中区之外，松开即生效。只有当按下点本来就在主岛窗口区域内时，宿主才用「按住超过 260 ms」区分真实拖拽与一次点击，避免普通点击被拖入通道抢走。

`drop` 载荷目前**不含落点坐标**，插件无法得知文件被丢在哪个屏幕位置。需要按落点做动画或二次判定时，只能用窗口自身中心或固定点近似。见 §8 的 E1。

每批最多 4096 个文件，宿主在分配路径缓冲区前校验 UTF-16 总量，并为 JSON 转义和协议帧预留空间；超限整批拒绝，不交付截断结果。宿主到后端的队列最多 32 帧，过载会使拖入交付失败，日志不包含路径。当前没有可靠重试或持久化；窗口生命周期与拖入的 `enter`/`leave` 通知也可能丢失，可用 `windows.list()` 核对状态。Node SDK 按序等待事件监听器，业务异步操作应返回或等待 Promise，避免停用后迟到结果重写业务状态。

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
| `dock.rect()` | 2.2.2：主岛几何与状态快照 | `dock.dock.rect` / `host.dock.rect` |
| `dock.onEvent(listener)` | 2.2.2：返回取消监听函数 | 主岛几何/指针事件桥 |

事件用 `event.event` 区分：

| 事件 | 主要载荷 | 含义 |
| --- | --- | --- |
| `ready` | `handle` | 外部页面就绪 |
| `closed` | `handle`、`reason` | 窗口已销毁 |
| `anchorChanged` | `handle`、`x`、`y`、`width`、`height` | 锚点、位置或 DPI 发生变化，坐标为物理像素 |
| `fileDrop` | `scope`、`handle`、`phase`、`paths`、`position` | 定向拖入，只有 `drop` 带路径与落点 |
| `dock` | 2.2.2：`type` + 载荷 | `type:'geometry'` 带 `rect`；`type:'pointer'` 带 `action: enter/leave` |
| `focus` / `blur` | 2.2.2：`handle` | 本窗口的焦点变化（不是「点了窗口外面」） |

`fileDrop` 的 `scope` 取 `dock` 或 `window`；`handle` 对 `dock` 是订阅句柄，对 `window` 是窗口句柄。`phase` 取 `enter`、`leave`、`drop`，只有 `drop` 带 `paths`。

**没有 `blur`、`deactivated` 或「点击窗口外部」事件。** 独立原生窗口收不到窗口外的指针事件，所以「点外部收起」这类交互目前无法实现。见 §8 的 E2。

原生协议使用 `plugin.windowEvent` 通知当前插件；不要求额外声明 `events` 能力，窗口事件和拖入事件分别按 `windows`、`file-drop` 授权。`events` 能力只约束通用业务事件通道 `plugin.event`，与窗口、拖入无关。

## 6. 关闭、权限与验收

宿主提供原生关闭按钮、Escape 和托盘「关闭插件窗口」出口，透明浮窗同样可关闭。插件可提供自己的关闭按钮并调用 `windows.close()`。关闭销毁窗口、释放票据与 WebView，不保留隐藏小球。停用、卸载、更新、进程崩溃、上下文切换及 Dock 退出时，宿主回收该实例窗口和订阅。

宿主从页面票据或后端会话推导身份，校验能力、包摘要、实例代次和句柄归属。跨插件句柄、过期票据、未登记页面、越界资源均拒绝。每插件最多 4 个外部窗口，全局最多 16 个；页面就绪等待上限 8 秒，创建失败、超时或创建期间被停用会释放预留资源。

**层级：** 插件窗口是普通顶层窗口，不置顶、不占任务栏。主岛窗口本身置顶且点击穿透，视觉上不会遮住插件窗口；但两者重叠的区域由主岛绘制在上。需要严格压在主岛之上或之下时，目前没有 `zOrder` 选项。见 §8 的 E6。

接入时至少验证：

1. 没有 `open()` 调用时，没有第二窗口、常驻小球或隐藏插件 WebView。
2. 插件显式请求后，界面出现在 Dock 外部的独立原生窗口；内部设置页仍独立工作。
3. 相同 `key` 重复调用复用窗口；关闭后恢复 Dock 不复活窗口。
4. 关闭、Escape、托盘、停用、卸载和崩溃都能清理窗口与拖入区域。
5. 无拖入订阅时不捕获；冲突明确报错；路径只到目标插件，不写日志。
6. 在真实 Windows WebView 中检查页面输入、焦点、透明窗口关闭及多屏 DPI，不能仅凭协议单测宣称这些行为已验证。

## 7. 更新插件内的 SDK 副本

插件包里的 `sdk.mjs` 是 **Dock 的 `sdk/node/plugin.mjs` 的拷贝**，不会随宿主升级自动更新。宿主换了 SDK 而插件没换，就会出现「文档说有的接口，插件里没有」这类问题——症状通常是 `context.windows` 或 `context.fileDrop` 上找不到 `onEvent`，或收不到 `plugin.windowEvent`。

官方插件由 `tools/stage-development.mjs` 处理：`:56` 把 `sdk/node/plugin.mjs` 拷成 `plugins/<key>/sdk.mjs`，`:65` 再把整棵资源树连同它一起算进 `files`。第三方插件按同样方式手工替换，**替换后必须重算 `plugin.json` 里 `sdk.mjs` 的 SHA-256**，否则宿主摘要校验会拒绝整个包。

各版本的基准值：

| 版本 | 字节数 | SHA-256 |
| --- | --- | --- |
| 2.2.0 / 2.2.1 | 12,675 | `bf303681c790df2c581789a28126754c9382caf5b6032023eca2dfabd0b2dbab` |
| 2.1.9（无 `windows`/`fileDrop`） | 9,469 | `91b2eb3b86a06068ad0b89441e446bb636284c211dd685d691014ed2b70a034a` |

用 `git hash-object sdk/node/plugin.mjs` 可以拿到 git blob 值做交叉核对：2.2.0/2.2.1 为 `e8399600201583b1b915b70041d01513028727d2`，2.1.9 为 `d775549d18789f8277bc5b15f5bbaa7dbc0c203b`。注意 blob 与 `files` 里的 SHA-256 是两套哈希，不能互换。

## 8. 版本能力对照

按缺口编号对照上游跟踪 [issue #87](https://github.com/Fish-under-sea/FISH-Dock/issues/87)。

### 8.1 2.2.2 已补齐

以下能力在 **2.2.2 起**可用，不再列为缺口：

| 编号 | 能力 | 用法 |
| --- | --- | --- |
| C1 | 读主岛几何与状态 | `dock.rect()` → `{window, capsule, state, scale}`；需声明 `dock` 能力 |
| C2 | 订阅主岛几何/状态 | `dock.onEvent(listener)`，`type:'geometry'` |
| C3 | 锚定窗口随胶囊重排 | 自动；改动锚点基准后由宿主重排 |
| C4 | 宽度跟随主岛 | `width:'dock'` + `maxWidth` |
| C5 | 主岛指针事件 | `dock.onEvent` 的 `type:'pointer'`，`action: enter/leave` |
| B1 | 更小窗口 | 下限降到 32×32 |
| B2 | 锚点对齐 | `align` 八种 + `anchorBase:'capsule'` |
| E1 | 拖入落点坐标 | `drop` 载荷的 `position.screen` / `position.client` |
| E2 | 窗口焦点事件 | `windows.onEvent` 的 `focus` / `blur` |
| E3 | 完整状态枚举 | `rect().state.view` + `stowed`/`hidden`/`fullscreen` |
| E6 | 窗口层级 | `zOrder:'above-dock'` |

`anchorBase` 与 `align` **缺省都保持 2.2.1 的行为**，不写这两项时位置逐像素一致。

### 8.2 仍然没有

| 编号 | 缺口 | 影响 |
| --- | --- | --- |
| B3 | 无 drag-out 接口 | 无法把窗口内的文件拖回资源管理器；只能自建原生服务 |
| B4 | 无逐像素命中 / 点击穿透 | `transparent:true` 的透明像素仍拦截鼠标 |
| B5 | 无 `fitContent` | 高度要插件自己算好再 `windows.update` |
| D1/D2 | 无 `openPage(pageId)` | 外部窗口里的按钮无法请求宿主打开本插件的内部插件页 |
| E4 | 无动画期间逐帧胶囊矩形 | 滑出是页面内 CSS `transform`；宿主只在 `stowed` 切换时推一次状态 |
| E7 | 无跨窗口动画层 | 动画起点在窗口外会被裁剪，建议改为窗口内动画 |

E5（长条宽度跟随主岛）与 C4 是同一项，已随 C4 解决。

页面桥仍然只放行 `dock.open_external`、`dock.autostart`、`dock.windows.*`、`dock.fileDrop.*`、`dock.dock.*` 与 `gateway.open`。

### 8.3 对上表的补充说明

- **B4 现在是 B1 的替代路径**：2.2.2 已把窗口下限降到 32×32，能缩到实际大小的插件不再需要逐像素命中。只有坚持用大窗口装小内容时才会撞上 B4。
- **E4 的实际影响有限**：滑出动画期间宿主窗口不移动，插件拿到的是 `stowed` 的状态切换而非逐帧位置。需要「跟手」的场景建议改用窗口内动画。

宿主侧规格、SDK 与最小协议示例见 [Dock 开发说明](https://github.com/Fish-under-sea/FISH-Dock/blob/main/app/docs/plugin-windows-2.2.0.md) 和 [window-file-drop 示例](https://github.com/Fish-under-sea/FISH-Dock/tree/main/sdk/examples/window-file-drop)。发布前将本文与最终实现逐项复核。
