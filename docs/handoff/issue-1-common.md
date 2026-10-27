# Issue #1：通用链路、飞书、OFM 与打包交接

日期：2026-10-27。此文记录本地实现与可复查验证，不作为正式发行或实机全通过声明。

## 已确认的问题和实现

| 问题 | 修改 | 回归证据 |
| --- | --- | --- |
| 网关启动过程中 `stop()` 直接拒绝，停用/EOF 可能遗留刚启动的服务 | 启停 promise 去重；AbortSignal 取消就绪等待；停用等待同一实例清理；页面停止命令立即返回 stopping | gateway、child 合成子进程测试 |
| Windows 先 kill 父进程后再 taskkill，无法可靠定位其子树 | 非协议停止先对持有的 PID 使用 `/T /F`；仍校验退出，不按名称扫描用户进程 | 合成子进程停止与取消测试；原生进程树留实机验证 |
| 损坏 gateway.json 会使插件激活失败，无法打开设置修复 | 返回脱敏 error 状态，保留文件至用户保存 | gateway 测试 |
| 默认服务绝对路径被持久化，版本摘要变化/搬迁后指向旧包 | 默认路径每次从 `import.meta.url` 解析；保存 bundled 标记；识别宿主 packages/fish.ID/version/hash/service 旧格式；自定义路径原样保留 | 跨 C:/D:/E: 的合成路径迁移测试 |
| 网关失败只有笼统错误，运行状态不复核 | 仅显示固定错误码对应说明；轮询 running/starting/stopping；不回显子进程输出 | gateway、页面行为测试 |
| 刷新和保存失败会覆盖正在输入的服务路径 | 表单 dirty 状态保留输入 | vm 中的页面事件回归 |
| 飞书配置损坏无法打开，清除凭据没有页面入口 | 可恢复视图；重新保存/清除；页内异步确认；失败保留原始凭据；禁止重复提交 | service 测试；真实页面待验 |
| OFM 接受含协议/用户名异常的 ready URL，目录未完整创建，TEMP/TMP 仍指向宿主临时目录 | 限定 HTTP/回环/端口/无用户信息；启动前创建分类目录；TEMP/TMP 跟随插件 tmp；明确依赖错误 | 源码审查和回归；原生服务留实机 |
| OFM 相对路径未全面拒绝 Windows ADS/设备名 | 拒绝冒号、控制符、设备名、末尾点/空格 | 分类路径测试 |
| 正式构建可无运行时，`--only` 仍暂存其他插件 | 必需资源预检、只暂存所选插件 | build-release 测试 |
| npm 构建递归删除已有输出目录 | 要求新目录，已有内容不改 | build-npm-packages 测试 |
| 缺少整包核验命令 | `tools/verify-release.mjs` 校验 ZIP/CRC、清单逐资源 SHA-256、入口、本地页面依赖、目录与总摘要、npm 字节一致性 | 篡改包/副本会失败的回归 |

## 数据与资源路径表

以下 `R` 是**已安装插件资源根**，`D` 是宿主提供的**当前插件命名空间数据根**。所有 SDK 文本写入由宿主按 category/name 解析，不依赖 shell 当前目录。

| 插件 | 资源 | 持久资料 | 临时/运行资料 |
| --- | --- | --- | --- |
| 飞书 `.fishplugin-feishu` | `R/plugins/feishu/*`、`R/shared/dock.css`、宿主注入桥 | 宿主 secrets：`credentials/robot.json`；storage：`config/notifications.json`、`config/layout.json` | 发送状态/限流仅内存；未新增导出/备份功能 |
| Clash `.fishplugin-clash` | `R/plugins/clash/*`、`R/service/mihomo.exe` | 见 issue-2-clash.md 的多订阅、缓存和代理租约表 | 见专项文档；运行 YAML 可能含订阅节点凭据，禁止附入日志 |
| Magpie `.fishplugin-magpie` | `R/plugins/magpie/*`、`R/service/magpie.exe`、共享网关页面 | `D/credentials/magpie-runtime/data`、keys 中的 web-key、`config/gateway.json`；见专项文档 | `D/tmp`；服务副本/便携 marker 在 `credentials/magpie-runtime` |
| OFM `.fishplugin-ourfreemodel` | `R/service/packages/desktop/service-host.mjs`；Node 使用宿主 `process.execPath` | `keys/settings.json`；credentials 中的 channel-credentials/eac-user/gemini-sigs；roster 中的 channel-pack/state；其余受控 config | `D/tmp/service.lock`、cache；隔离 `tmp/profile` |

Magpie 必须保留真实用户目录与显式 Agent 目录发现。OFM 按独立产品的显式 `--data-dir` 运行，其 HOME 隔离是自有服务语义；不得照搬给 Magpie。导出与备份由宿主及原生 OFM 下载机制负责，未新增无关功能。

## 已执行与未执行

- 下载并核验 v1.0.0 的四个 GitHub 正式归档：全量资源摘要、入口、HTML 依赖均通过。Magpie 新基线另见专项文档。
- Node 24.14.0 自动回归；完整最终计数和日志位置见总交接文档。
- 当前真实 Dock SDK 与四个暂存 backend 完成独立子进程握手、激活、读取视图和停用，运行目录为带中文空格的另一目录；不启动原生服务或发送消息。
- 使用本地 OFM 源码成功执行 `stageOfm`，其逐项补丁与资源文件均匹配。未把暂存成功当作服务成功。
- Windows 沙箱拒绝 `taskkill /T`，最初合成停止测试失败；在允许进程管理的环境重跑通过，原测试子进程已按记录 PID 清理。后续测试夹具增加自动结束期限。
- 未发送真实飞书消息，未读取真实订阅或账号，未切换系统代理，未验证 OFM 登录/项目绑定/模型调用。灰度未开放流程不可写成通过。
- 未做正式安装、升级、卸载、跨盘资料恢复或真实 WebView 视觉验收。远端 npm 已发布包与 GitHub 旧包的一致性也未验证；本地产物的 npm 一致性已由新工具验证。

## 接手实验步骤

1. 在独立数据根安装总文档列出的本地四包。先保留原数据根和原包，不直接替换日用实例。
2. 按默认根、`D:\实验 资料\插件根`、另一盘符、新启动工作目录、自定义安装目录分别记录解析结果。检查资源根无新资料写入。
3. 飞书：专用合成/测试机器人配置保存、关开、清除、重启恢复、错误地址、错误签名、网络失败、损坏配置恢复。真实发送须使用专用测试机器人和用户授权。
4. OFM：给 `FISH_TEST_OFM` 指定源码目录后运行其 runtime.test；确认仅回环监听、ready URL、CSP、管理页、重复启停、未就绪停用、端口冲突、异常退出、数据保留。不要将灰度限制判成已修功能。
5. Magpie/Clash 按各自专项表执行；安装后核对每个插件 backend/page 资源均来自本次包，避免仍运行旧摘要。
6. 测试 gateway.json 损坏后打开设置修复；在服务启动立即停止/停用，再核对自身进程与端口；确认无关进程仍在。
7. 记录宿主停用时限及实际退出：若宿主在原生清理完成前强制终止 backend，应继续跟踪宿主生命周期问题，不仅凭 adapter 单测判定完成。
8. 页面票据过期、宿主隐藏/重开原生 iframe、真实 CSP/Cookie/浏览器外链由宿主与服务联调验收；本仓无权仅靠页面 mock 保证。

每个场景记录：插件/版本/包 SHA-256、Dock 版本、Windows 版本、数据根（脱敏）、操作、预期、实际、截图/日志位置、结果（通过/失败/跳过/不适用/灰度未开放）。不要在截图中暴露 Webhook、URL token、Cookie 或用户内容。
