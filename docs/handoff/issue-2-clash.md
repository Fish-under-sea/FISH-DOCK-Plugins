# Issue #2：Clash 多订阅与导入链路交接

日期：2026-10-27。工作区：`D:\Fish-code\Codex\FISH-DOCK-Plugins`。本轮只编辑 `plugins/clash/**` 和本文；未发布、推送、修改远程 issue，未读取真实订阅、用户配置或操作系统代理。整包构建和三个 issue 的统一测试由主线负责。

## 已确认根因

1. 原实现只有一个 `credentials/subscription.json`，运行时 provider 名称和更新路径固定为 `subscription`；再次保存替换旧地址，无法实现多个订阅并存。
2. “保存”只持久化地址，下载被推迟到启动 mihomo 的 HTTP provider 阶段。没有独立导入状态、成功时间、节点数或错误分类，启动等待与下载失败混在一起。
3. 原始节点名直接作为选择身份，多个来源同名节点无法可靠区分。直接展示 provider 原始详情还可能泄露 URL 等敏感数据。
4. 相邻真实 Dock SDK 的命令处理是串行队列，浏览器调用超时为 20 秒。把下载或原生校验直接放进一个命令会阻塞刷新。页面整体重绘也会丢失未保存输入。
5. Windows 内核路径校验直接比较 `realpath()` 与输入，导致 `/` 和 `\` 差异也被当作无效路径。
6. 旧默认内核路径是安装包绝对路径，升级后摘要目录变化会失效。新的 credentials 缓存又位于 mihomo `-d config` 以外，必须处理 SafePath，不能只靠模拟 provider 测试。

## 本地实现

- 独立 UUID：`sub-<UUID>`。订阅列表 schema 2，每项独立名称、启用状态、最近尝试、最近成功、节点数、缓存状态和受控错误码。最多 32 个订阅。
- 多个启用项同时进入 PROXY 组。每个 provider 独立文件；mihomo `override.additional-prefix` 使用 `[sub-ID] `，界面显示原节点名、来源名称及来源 ID；选择命令传完整原生节点身份。
- 订阅管理支持添加、编辑、独立启停、单项/全部启用项更新和页内确认删除。结构变化需先停止内核；普通更新可在运行中进行。
- 保存地址和导入是明确的两步：保存后显示“等待更新”，用户点击更新才请求网络。没有成功缓存的启用项会阻止启动。编辑地址会保留旧缓存，并标为等待更新。
- 地址使用宿主 secrets 按 ID 加密保存。普通配置、状态、错误和 provider 详情不回显地址。规则/连接详情只返回字段白名单摘要；不再返回原始控制器对象。
- HTTPS 下载限 20 秒、4 MiB、UTF-8；不跟随重定向，使用 `clash.meta` User-Agent。HTTP 错误、网络、超时、重定向、空内容/空节点、格式、内核、前缀、应用失败、存储失败和取消分别返回固定中文说明。
- 每次导入在独立 `tmp/import-*` 下用**用户选定的真实 mihomo**启动短暂校验实例，检查可用节点及来源前缀。验证器没有代理监听、TUN、DNS 或健康检查；订阅只作为 file provider 解析，不执行订阅中的完整运行配置。原生诊断只做内存分类，不透传或保存日志正文。
- 校验成功才以同卷 rename 替换缓存；应用到运行中 provider 以及状态持久化均纳入回滚。下载/格式/应用/状态写入失败保留旧缓存，成功时间和节点数不变。
- 下载/校验后台执行；命令立即返回 updating 状态，页面定时轮询。后端重复 URL 提交幂等，按 ID 防重复更新；变更串行提交。页面防重复提交、保留失败输入、切换管理页不阻塞更新，过期轮询结果不能覆盖更新后的状态。
- 启停命令异步返回，启动中可取消；停止状态更新订阅时提供“取消更新”；重复启动不产生第二个进程；停用/EOF 会取消导入并等待自身实例清理。
- 主线整合追加：即使系统代理恢复失败，也尝试停止自有内核；保留恢复失败状态和租约记录供重试，避免注册表错误导致内核继续运行。合成回归覆盖失败后重试。
- 单订阅迁移先写独立凭据及 manifest，再清除旧地址；旧 `config/providers/subscription.yaml` 若存在则复制为新 ID 的缓存，保留旧文件供人工恢复。旧缓存迁移后节点数暂为 0，首次成功更新补齐；不会仅为迁移发起网络请求。
- 默认内核从当前安装资源根推导。精确识别旧 `packages/fish.clash/<semver>/<64 hex>/service/mihomo.exe`；保存 bundled 标记，跨版本/盘符重新定位。用户自定义内核路径保留。

## 文件与数据位置

| 文件 | 职责 |
| --- | --- |
| `plugins/clash/service.mjs` | 数据模型、迁移、去重、后台任务、状态、命令和脱敏 |
| `plugins/clash/subscriptions.mjs` | HTTPS 下载、受控错误分类、原生校验、缓存事务、旧缓存迁移 |
| `plugins/clash/runtime.mjs` | 多 file provider、受限 SAFE_PATHS、内核路径与生命周期 |
| `plugins/clash/backend.mjs` | 新命令注册、bundled 路径、异步启停与停用/EOF 清理 |
| `plugins/clash/page.js` / `page.css` | 多订阅操作、来源展示、状态轮询、草稿保留、确认删除 |
| `plugins/clash/{service,runtime,subscriptions,native,page}.test.mjs` | 状态/事务、HTTP 传输、真实内核与页面事件回归 |

以下 `D` 是宿主传入的**本插件命名空间数据根**。

| 位置 | 内容及注意事项 |
| --- | --- |
| `D/config/clash.json` | 内核、端口、布局、bundled 标记；无订阅 URL |
| `D/config/subscriptions.json` | schema 2 清单及更新状态；无订阅 URL、节点密码 |
| `D/credentials/sub-ID.json` | 宿主 secrets 管理的加密订阅地址 |
| `D/credentials/sub-ID.yaml` | mihomo 必须读取的明文节点缓存，可能含节点密码；不要附入日志或交接材料 |
| `D/keys/controller.key` | 宿主 secrets 加密的主实例控制器密钥 |
| `D/config/cache.db` | mihomo 选择状态；`-d` 仍为 `D/config` |
| `D/config/system-proxy.json` | 原有代理租约；本轮未改变租约行为或操作真实注册表 |
| `D/tmp/mihomo-runtime.json` | 主实例配置，停止后清空；含控制器密钥，无订阅 URL |
| `D/tmp/import-*/` | 每次校验独占配置、候选缓存、原生 cache.db；结束后清理 |

主实例只把 `D/credentials` 加入 `SAFE_PATHS`，没有继承宿主可能更宽泛的 SAFE_PATHS。校验实例 home 与 SAFE_PATHS 都限于自己的临时目录。未把整个磁盘加入白名单。

默认规则当前为有启用订阅时 `MATCH,PROXY`，无启用订阅时 `MATCH,DIRECT`；不隐式下载 GeoIP 数据库，也不导入订阅中的 rules、DNS、TUN 或完整代理组配置。原实现的 `GEOIP,CN,DIRECT` 默认规则未保留，接手时应确认产品预期；健康检查当前关闭，页面无历史延迟时显示“未测速”。完整配置导入、分享链接/base64 转换和自动周期刷新不在本轮实现中。

## 已执行验证

2026-10-27，Windows、Node 24.14.0，原生内核：

- `.tools/baseline-v1.0.0/runtimes/mihomo.exe`
- `Mihomo Meta v1.19.15 windows amd64`，Go 1.25.3
- SHA-256：`7f49fdbfc5c5a2a32807fadfeddbcefc61e439165495337a9b72ca090febaaf4`

执行：

```powershell
Set-Location D:\Fish-code\Codex\FISH-DOCK-Plugins
$env:FISH_TEST_MIHOMO = 'D:/Fish-code/Codex/FISH-DOCK-Plugins/.tools/baseline-v1.0.0/runtimes/mihomo.exe'
node --test --test-isolation=none 'plugins/clash/*.test.mjs' shared/page-resources.test.mjs
node --check plugins/clash/backend.mjs
node --check plugins/clash/page.js
git -c safe.directory=D:/Fish-code/Codex/FISH-DOCK-Plugins diff --check -- plugins/clash
```

结果：**22/22 通过，0 跳过、0 失败**，其中 Clash 19 项、公共页面资源检查 3 项。未设置 `FISH_TEST_MIHOMO` 时，2 项真实内核测试会明确 skip，不能把这个结果当作原生内核验证。

验证层次：

1. **真实原生进程与控制器**：中文/空格独立临时根；`-d config` 读取 credentials 下两个 file provider；两来源同名节点加载、选择 B、更新 A 后 B 仍选中；清理自己的进程和运行配置。没有连接测试节点，也没有更改系统代理。
2. **真实原生导入校验**：合成 SS YAML 成功、HTML 失败、`proxies: []` 归类 EMPTY、不存在内核归类 KERNEL；失败后原缓存字节保持，临时导入目录清空。这里的下载响应为合成 Response，原生解析与进程并未 mock。
3. **真实回环 HTTP 传输**：注入 fetch 地址映射到本机 HTTP server，覆盖 User-Agent、403、302、空内容、超限和超时；不声称已验证公网 HTTPS、证书、公司代理或真实供应商。
4. **可控故障注入**：缓存验证、控制器更新、manifest 写入失败回滚；地址回滚；去重、迁移、启用并存、停止取消、恢复中断状态、精确安装路径迁移与自定义路径保留。
5. **实际 page.js 的 VM 事件测试**：草稿保留、防重复提交、轮询、导航、确认删除。DOM 是最小测试适配器；不是浏览器渲染、原生 WebView 或可访问性实机验收。

## 接手 agent 的实机实验

1. 使用主线最终本地包及当前 Dock SDK，独立测试数据根安装。确认 `subscriptions.mjs` 被打包、页面和 backend 来自同一版本，不能继续运行旧资源摘要。
2. 使用两个授权测试 HTTPS 订阅 A/B，各包含一个同名节点。分别保存、更新、同时启用、启动，核对节点来源与完整 ID；选择 B，更新 A 后 B 不受影响。
3. A 成功后改成 403/超时/302/HTML/空节点响应，核对错误分类、最近尝试、最近成功和缓存；B 可继续选择。恢复 A 后再次更新，验证状态和节点数恢复。
4. 编辑名称时留空地址、更新地址但失败、停用后再启用、删除选中的订阅再启动、删除全部后直连启动；确认 ID 不变、其他订阅不被清除、旧选择有可用回退。
5. 旧版本合成单订阅 + 缓存迁移；不联网启动缓存。再测无缓存、迁移写入失败、关开插件、不正常退出时更新中状态恢复。勿使用日用订阅作故障注入。
6. 真实升级和跨盘迁移：旧宿主包路径自动定位新包，自定义 mihomo 路径保留。检查默认/自定义数据根、中文/空格路径、新启动工作目录和 SafePath。
7. 单/双栏、窄窗口、长名称、同名来源、深浅色、键盘操作及焦点；填写地址后刷新/切页/保存失败，检查草稿；更新中反复点击、开始后立刻停止/停用/Dock 退出，核对没有遗留自身进程。
8. 如需验证真实代理连通、Windows 系统代理接管与恢复，使用专用环境和授权；本轮只验证原有租约算法，未操作真实系统代理。
9. 公网 HTTPS/TLS、供应商 User-Agent/重定向需求、代理环境、4 MiB 边界和不同 mihomo 版本兼容性仍需实测。当前固定内核的结果不能外推到所有版本。

对每项记录包摘要、宿主/内核版本、测试步骤、预期/实际、通过/失败/跳过与脱敏证据。禁止附原始 URL token、节点密码、控制器密钥、用户连接目标和明文缓存。

## 边界与后续风险

- 原子缓存替换与 manifest 提交不是跨文件系统崩溃事务。进程断电可能留下 updating 或临时目录，重启显示中断；本轮不宣称完整断电恢复或损坏磁盘保证。
- 运行中 provider 文件有 mihomo 自身监听，替换与显式更新间可能短暂出现新节点；应用/状态写入失败会恢复缓存并再次触发 provider 更新。真实长连接连续性未测。
- 同一 URL 的重复添加返回已有列表，不新增第二项；不同名称但同 URL 也不重复建档。URL 不做激进语义归一化，参数顺序不同可能被视为不同地址。
- 旧缓存复制不删除旧文件，停用/卸载保留资料。删除新订阅清除对应独立地址和缓存，遗留单订阅备份的人工清理应另行确认。
- 真实 SDK 的错误响应会隐藏普通命令异常正文；订阅后台任务用可轮询的白名单状态提供详细分类。普通无效输入仍可能只看到“检查配置和运行状态”。
