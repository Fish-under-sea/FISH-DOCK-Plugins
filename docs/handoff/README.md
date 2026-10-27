# 三个 issue 的本地实验交接

日期：2026-10-27（Asia/Shanghai）。

工作仓库：`D:\Fish-code\Codex\FISH-DOCK-Plugins`。改动保留在该仓库工作区，**不发布、不推送、不关闭 issue**。Issue 的正式构建安装、真实 WebView 和业务实验由接手 agent 执行，不能以本轮自动回归代替全部验收。

## 阅读顺序

1. 本文：环境、材料、命令、统一验收规则。
2. [Issue #1：通用、飞书、OFM](issue-1-common.md)。
3. [Issue #2：Clash 订阅与界面](issue-2-clash.md)。
4. [Issue #3：Magpie 内部插件](issue-3-magpie.md)。

## 固定来源与目录

| 用途 | 来源 |
| --- | --- |
| 插件修改基线 | `7bd1319a2618fddd611e2a3ac9b145c465334b8d` |
| 当前宿主/SDK 参考 | `D:\Fish-code\Codex\FISH-Dock-plugin-host`，commit `8dcc50b74d76931e4e9cfc0e0e29d293fc3d8df5` |
| OFM 原始源码输入 | `D:\Fish-code\Codex\FISH-Dock\dsh-our-free-model`，其父仓基线 `1727872d621a9d06a6ca985ee58d268fc2bfcd63` |
| 正式历史四包基线 | `.tools\baseline-v1.0.0\*.fish-plugin` 与 `SHA256SUMS.txt`，下载后已核验 |
| 原生服务构建输入 | `.tools\baseline-v1.0.0\runtimes\magpie.exe`、`mihomo.exe`，来自上述归档 |
| Node | 本轮使用 24.14.0 |

现有 `FISH-Dock` 是旧代码副本，缺少当前插件 SDK；**不要误用它当本轮宿主/SDK**。仅复用其中的 OFM 源码。当前宿主参考仓用于阅读和提供 SDK，本轮未修改它。

## 已生成的实验材料与最终结果

四个实验包均已生成并通过逐资源校验：

`D:\Fish-code\Codex\FISH-DOCK-Plugins\.tools\local-handoff-20261027\release\dist`

同级材料根为 `.tools/local-handoff-20261027`；有 `npm/`、`artifact-verification.json`、`build-inputs.json`。构建输出核验通过：ZIP CRC、清单全部资源 SHA-256、backend/page 入口、HTML 本地引用、目录/总摘要以及本地 npm 副本字节均一致。

| 实验包（本地 1.0.2） | 字节数 | SHA-256 |
| --- | ---: | --- |
| feishu.fish-plugin | 22856 | `ec9efc89f11fdde866b25c484ac5b63b13a90bd489d1b8913868834bc8aeaef7` |
| clash.fish-plugin | 12207662 | `e8dab233dc7c914b0f38ba12de2d649c054e85514758f144089f2294e8e79785` |
| magpie.fish-plugin | 20616110 | `4a8e064faf8a064d892d08bda34832362f19e9e38c94cd5fc6c90fa328cd12f6` |
| ofm.fish-plugin | 1879716 | `b29ce49e5330ece9f893768a13ff5a68b9ebf5f8d53358da653fa669c08330bb` |

最终整合回归 **62 项：60 通过、0 失败、2 跳过**。日志：`.tools/integration-tests.txt`。已启用真实 mihomo 与真实宿主 SDK 测试。两项跳过分别是 Magpie 原生/浏览器、OFM 原生：Magpie 子任务另行完成正式二进制＋隔离 Edge 验证（详见 #3），OFM 原生运行仍待接手。语法检查与 `git diff --check` 通过。

**接手必须注意的行为与未验项：**

- Clash 默认启用订阅时使用 `MATCH,PROXY`，无启用订阅时 `MATCH,DIRECT`；移除了原默认 `GEOIP,CN,DIRECT`，健康检查关闭。目的在于避免额外地理库下载并明确 provider 导入边界；国内直连策略及测速需求须在实验中确认，不应忽略此变化。
- Clash 接受 mihomo 可解析的代理 YAML/JSON；不提供分享链接/base64 转换，不导入完整配置里的 rules/DNS/TUN。添加/编辑/启停/删除订阅前需停止内核，单项更新允许运行中执行。
- Magpie 已证明精准 CSP 修复有效；不代表用户实际插件、所有 Bun 依赖及真实 WebView2 已验收。
- 正式安装升级、默认/跨盘资料根、真实 WebView 深浅色截图、系统代理、真实飞书与 OFM 业务链路仍交接实验。三项 issue 保持开放。

## 重跑自动回归

在具备结束自身子进程权限的 PowerShell 中执行：

```powershell
Set-Location D:\Fish-code\Codex\FISH-DOCK-Plugins
$env:FISH_TEST_SDK = 'D:/Fish-code/Codex/FISH-Dock-plugin-host/sdk'
$env:FISH_TEST_MIHOMO = 'D:/Fish-code/Codex/FISH-DOCK-Plugins/.tools/baseline-v1.0.0/runtimes/mihomo.exe'
node --test --test-isolation=none 'plugins/feishu/*.test.mjs' 'plugins/clash/*.test.mjs' 'plugins/magpie/*.test.mjs' 'plugins/ofm/*.test.mjs' 'shared/*.test.mjs' 'tools/*.test.mjs'
if ($LASTEXITCODE -ne 0) { throw '回归失败，先处理失败再做实机实验' }
```

默认不设置 `FISH_TEST_MAGPIE`、`FISH_TEST_OFM`：这两组需要真实服务的检查应显示 skip；上面命令设置的 `FISH_TEST_MIHOMO` 启用两项原生 Clash 测试。其余测试包含合成进程、本机 HTTP/代理传输和实际 SDK，不能在禁止子进程回收的沙箱内把权限失败误记为业务失败。真实服务测试的环境变量、隔离要求和可选浏览器证据见专项文档。

## 重新生成本地包

以下输出目录必须尚不存在。可更换 `-Out`，保留上轮结果便于对照：

```powershell
Set-Location D:\Fish-code\Codex\FISH-DOCK-Plugins
./tools/prepare-local-handoff.ps1 `
  -Sdk 'D:/Fish-code/Codex/FISH-Dock-plugin-host/sdk' `
  -Ofm 'D:/Fish-code/Codex/FISH-Dock/dsh-our-free-model' `
  -Magpie 'D:/Fish-code/Codex/FISH-DOCK-Plugins/.tools/baseline-v1.0.0/runtimes/magpie.exe' `
  -Mihomo 'D:/Fish-code/Codex/FISH-DOCK-Plugins/.tools/baseline-v1.0.0/runtimes/mihomo.exe' `
  -Out 'D:/Fish-code/Codex/FISH-DOCK-Plugins/.tools/local-experiment-next' `
  -Version '1.0.2'
```

`1.0.2` 仅是本地候选包版本，用于测试旧版升级。仓库线上 `catalog/stable.json` 未改，构建输出中的 GitHub URL 是模板，**没有上传，不是可下载的新版本**。不要把输出目录的 stable.json 复制到线上商店。

输出含 `release/dist`、`release/staged`、`npm`、`artifact-verification.json`、`build-inputs.json`。核验命令：

```powershell
node tools/verify-release.mjs --dist '<输出>/release/dist' --npm '<输出>/npm'
```

本轮仅核验本地 npm 目录内归档字节；不执行 `npm publish`、`gh release create/upload`、商店更新、git push 或 issue 关闭。

## 接手实验顺序

1. 记录宿主版本、Windows 版本、Node、输入运行时摘要；创建独立数据根，不操作日用数据。
2. 先装历史包创建合成旧配置，再安装本地候选包验证迁移；另做干净根首次安装。不得仅使用开发暂存目录作为最终安装验收。
3. #1：四插件页面资源/目录/生命周期；飞书保存和清除；OFM 灰度边界。
4. #2：两个**独立合成订阅**同时启用、同名节点、单个失败保留、选中订阅删除回退、旧配置迁移、控制器状态。代理真实连通和系统代理租约只在专用测试环境验证。
5. #3：真实内部插件页面与 API、准确 iframe URL/CSP、依赖存在与缺失、服务重启/插件停用、Agent 发现保持。不要拿管理页成功替代内部插件。
6. 分别覆盖单/双栏、小窗口、长名称、深/浅色、键盘/焦点、失败输入保留。截图需隐藏凭据。
7. 安装升级、停止、停用、Dock 退出、重新启用、卸载后保留资料；确认无关服务与其他软件系统代理不受影响。

当前宿主源码 `identity.rs` 确认用 `FISH_DOCK_DATA` 指定绝对身份数据根（优先于兼容的 `DSH_FISH_DATA`）。实验进程可设置例如 `D:\Fish-code\Codex\FISH-DOCK-Plugins\.tools\实验 资料\.fish-dock`；仍需按所用 Dock 构建的说明隔离 WebView/桌面资料与监听端口，不能仅设置一个变量就假定日用实例完全隔离。

## 证据格式与收尾

逐场景填写：

| Issue/插件 | 候选版本及 SHA-256 | 系统/数据根场景 | 操作及预期 | 实际 | 结果 | 证据相对路径 |
| --- | --- | --- | --- | --- | --- | --- |
| 待填 | 待填 | 待填 | 待填 | 待填 | 通过/失败/跳过/不适用/灰度未开放 | 待填 |

保存控制器/HTTP 结果应移除 token、Cookie、订阅地址、节点密码、Webhook、真实用户内容。失败时保留原数据、复现步骤和包摘要，继续修复后重建新输出目录；不要通过关闭检查项、放宽全局 CSP、切换真实 Agent 模型或删除资料来制造通过结果。

只有真实链路与正式安装实验均符合各 issue 的验收标准后，才能向用户报告可结案；本轮明确不替用户执行发布。
