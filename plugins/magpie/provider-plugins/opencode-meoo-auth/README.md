# opencode-meoo-auth

OpenCode & Magpie provider plugin for **Meoo 秒悟**（`meoo.com`）。

由 [dsh-meoo-connect](https://github.com/2239058652/dsh-meoo-connect)（DeepSeek Harness 的 dsh 插件）迁移而来：同一套 Meoo 官方「AI 服务」链路（OAuth 登录 → 项目服务 AK → OpenAI 兼容网关），换到 Magpie / OpenCode 的 provider 插件平面上。装好并登录后，Meoo 的模型会出现在 Magpie 的模型选择器里，也作为 OpenCode 的一个 provider。

本包随 FISH Dock 的 Magpie 插件内置分发（`plugins/magpie/provider-plugins/opencode-meoo-auth`），Dock 启动 Magpie 时同步进插件清单，不需要单独安装；以下手动安装方式供普通 Magpie / OpenCode 使用。

```
Qwen3.8-Flash · Qwen3.8-Max · Qwen3.7-Max · Qwen3.7-Plus
DeepSeek V4.1 Flash · DeepSeek V4 Pro · DeepSeek V4 Flash
GLM-5.2 · GLM-5.2-Fast
```

## 思考强度

模型默认带三档思考强度，对应会话 UI 里的 **快速 / 适中 / 极致**（`reasoning_effort: low / medium / high`）。网关实测该参数真实生效（low 档思考 tokens 约为 high 档的 60%~70%，`enable_thinking:false` 可完全关闭，但为避免不可控行为未暴露「关闭」档）。不选档位时走上游默认思考。

## 它是怎么做的

不自己做 LLM 适配器、不加会掉流式的中间代理——插件只准备「凭证 + 模型目录」，
真正的转发交给宿主的 `@ai-sdk/openai-compatible` SDK 直连 Meoo 网关：

```
opencode-meoo-auth
  ├─ OAuth(PKCE) 登录 meoo            → access/refresh token 存宿主账号记录
  ├─ /open/v1/cli-compat/...          → 身份、项目列表、项目服务 AK（自动开通云服务）
  ├─ GET {gateway}/models             → 当前可用模型目录（10 分钟缓存）
  └─ loader                            → baseURL + apiKey(项目服务 AK) 交给宿主 SDK
                                          ↓
                        Magpie 的模型选择器 / OpenCode 的 provider 列表
```

## 登录方式（三选一）

| 方式 | 适合谁 | 要人工做什么 |
| --- | --- | --- |
| **浏览器授权**（PKCE，本机 loopback 自动收回调） | 大多数人 | 浏览器里点一次「授权」；身份、项目、云服务 AK 之后全自动 |
| **复用本机登录态** | 已在用 dsh-meoo-connect 或 meoo-proxy 的人 | 无——只读 `$DSH_HOME/meoo/state.json` 或 `~/.meoo-proxy/config.json`，不会写这两个文件 |
| **手填项目服务 AK** | 不想走 OAuth / 账号下多项目想精确指定的人 | 在 meoo.com 打开项目 → 云服务，复制 `meoo_project_service_v1.` 开头的 AK 粘贴；保存前会用网关 `/models` 校验一次 |

自动链路的细节：

- access token 过期前 5 分钟自动单飞续期（并发共享一次刷新请求），续期结果写回宿主的账号记录。
- 项目没开通「云服务」时，授权登录会自动开通一次再取 AK；仍失败会提示在 meoo.com 项目的对话框里让 AI 开启（平台的设计是会话触发自动开通，没有手动按钮）。
- 账号下一个项目都没有时，授权登录会**自动创建一个项目**（默认名「AI 服务」，可在 meoo.com 改名），再继续取 AK。
- 账号下有多个项目且没设默认时，浏览器登录会拒绝并**列出可选项**（项目间计费归属不同，不替你做主）；想精确指定就用「手填 AK」方式。
- 手填了 `meoo_ak_` 开头的用户 Key 会被明确拒绝——那是用户 Key，不是项目服务 AK。

## 安装

### Magpie

Magpie 的插件装在它的数据目录里。把本目录放到 Magpie 数据目录的 `plugins/` 下，并在 `plugins.json` 里加一条本地路径 spec：

```json
{
  "plugins": [
    { "spec": "C:\\<magpie 数据目录>\\plugins\\opencode-meoo-auth" }
  ]
}
```

FISH Dock 的 magpie 插件数据目录在 `~/.fish-dock/.fishplugin-magpie/credentials/magpie-runtime/data`。改完重启 magpie（或从 FISH Dock 的 Magpie 页停/启一次），Magpie 的模型来源里就会出现 **Meoo 秒悟**，点进去选一种方式登录。

### OpenCode

```bash
# npm 发布后
opencode auth login   # 选 Meoo 秒悟

# 本地目录
# 在 opencode.json 的 plugin 里加本目录的绝对路径，或
# 把目录放进 ~/.config/opencode/plugin/
```

## 配置（可选）

环境变量（Magpie 的插件进程只透传白名单变量，这两个主要用于 OpenCode/裸跑调试）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MEOO_MAIN_SITE_URL` | `https://meoo.com` | OAuth/控制面站点（测试环境可换） |
| `MEOO_GATEWAY_BASE_URL` | `https://api.meoo.host/meoo-ai/compatible-mode/v1` | OpenAI 兼容网关 |
| `MEOO_PROXY_HOME` | `~/.meoo-proxy` | meoo-proxy 登录态目录（复用方式） |

## 排错

| 现象 | 处理 |
| --- | --- |
| 授权页 404 / unsupported_response_type | 用插件生成的授权链接，别手拼；redirect_uri 必须是本机 loopback |
| `账号下有多个项目…` | 浏览器登录要求账号有默认项目；或改用「手填 AK」方式指定项目 |
| `项目 xxx 还没开通 Meoo AI 服务` | 云服务/AK 没有手动按钮：在 meoo.com 打开该项目，**对话框里发「帮我开启云服务」**（或让 AI 加个带后端/AI 的功能），平台自动开通并签发 AK 后重试；若带 `QUOTA_EXCEEDED（实例数已达上限）`，先释放不用的全栈项目/实例（Free 可部署 1 个全栈项目），或升级套餐 |
| `AK 被网关拒绝 (401/403)` | 填的是用户 Key 或项目没开云服务；确认是 `meoo_project_service_v1.` 开头 |
| `401（登录态已失效）` | refresh token 失效，重新登录一次 |
| 模型列表是兜底清单 | 网关 `/models` 暂时拉不到（断网/AK 失效），恢复后会自动同步 |

## 状态与凭证

- 凭证（token、AK）只存在宿主的账号记录里：Magpie 的 `plugin-auth.json`、OpenCode 的 `auth.json`。本插件自己不落地任何文件。
- 「复用本机登录态」是严格只读的，不会写 dsh-meoo-connect / meoo-proxy 的文件，也不消耗它们的 refresh token 之外的东西（续期结果只写回 Magpie 自己的记录）。
- 调用消耗 Meoo 账号自身额度，插件不绕过任何计费；与 Meoo 官方无关联，是第三方集成。

## 开发

```bash
node --check index.mjs && node --check opencode.mjs
node --test test/offline.test.mjs   # 19 项：假 fetch + 假 client，含浏览器 PKCE loopback 全流程
```

## 派生声明

本项目是 [2239058652/dsh-meoo-connect](https://github.com/2239058652/dsh-meoo-connect)（MIT，基线 [sangonomiya249/dsh-meoo](https://github.com/sangonomiya249/dsh-meoo) `cf77e92` 衍生）向 Magpie/OpenCode 插件平面的迁移移植；`opencode2.mjs` 适配层整份取自 [magpie-community/plugins](https://github.com/magpie-community/plugins) 的同名字节（MIT）。详见 `THIRD_PARTY_NOTICES.md`。

## License

MIT
