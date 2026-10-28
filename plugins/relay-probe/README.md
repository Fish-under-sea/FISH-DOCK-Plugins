# 中转站探针

这是 FISH Dock 的一个开发中插件，用三组行为探针检查 Anthropic 兼容中转站是否像原生实现：

- **B1 thinking 签名**：请求返回 `thinking` 块后，先做一次原样重放（对照），再把 `signature` 改一个字符重放。原生 Claude 应接受原样块、拒绝篡改块；篡改后仍成功是强异常信号。重放返回 2xx 但内容不是 Anthropic Message 时只记 `invalid_response`；如果重放成功、但 `usage.input_tokens` 与“删掉 thinking 块”的控制组完全相同，说明块可能被中转层丢弃，记 `block_dropped`，不当作篡改被接受。
- **C1 token 计数一致性**：对同一段文本比较 `POST /v1/messages/count_tokens` 与生成响应里的 `usage.input_tokens`。原生接口应逐 token 一致；允许 ±1 的边界差异，超过即 `mismatch`。
- **C2 跨代 tokenizer 比例**：分别用 `claude-sonnet-5-5` 和 `claude-sonnet-4-6` 计同一段文本。Claude 4.7 及以后使用新 tokenizer，4.6 及以前使用旧 tokenizer，两代计数应呈现稳定比例；完全相同或几乎相同是单后端/单 tokenizer 的可疑信号。若两个模型属于同一 tokenizer 家族（例如 `claude-sonnet-5` 与 `claude-sonnet-5-5`，Opus 4.7/4.8 与 5.x，或 Sonnet 4.5 与 4.6），计数相同是预期，记 `same_tokenizer`，不加伪造分。

判定口径是保守的：只有 **B1 篡改签名后仍被接受**，并且 **C1 计数与生成 usage 明显不一致**，才会输出“该中转站极大概率伪造了模型”。C2 的 tokenizer 相同可以加强证据，但如果 C1 一致、只有 C2 相同，会降为“疑似”——对照模型可能只是选到了同代 tokenizer。只有 C1/C2 异常，或只有 B1 无签名，最多输出“疑似非原生或翻译层”。“与原生一致”必须同时满足 B1 验签通过、C1 精确一致、C2 符合预期（同代 tokenizer 或跨代比例正常）；缺任何一项都只报“证据不足”，不会因为 B1 单点通过就退出码 0。

## 它不能做什么

- 不能证明“官方直连”。中转站可以伪造签名格式、重写计数、翻译协议，甚至按模型名返回不同计数。
- 不能单凭 `model` 字段、`msg_` 响应 ID 或 `system_fingerprint` 验真；这些都可以被回显或重写。
- B1 依赖目标返回 `thinking` 块。目标关闭 thinking、剥离 thinking 或只支持 OpenAI 形状时，B1 只能给“无法判断”。
- 结论是行为证据，不是司法鉴定。报告中的 `likely_forged` 表示多项异常同时出现，不代表已经抓到上游模型。

## 独立运行

不安装 Dock 也能直接跑 CLI（Node.js 24+）。

推荐把 Key 写进只有本人可读的文件（例如 `C:/work/relay.key`），用 `--key-file` 读取：

```powershell
node plugins/relay-probe/cli.mjs --base https://<REDACTED>/v1 --key-file C:/work/relay.key
```

环境变量 `FISH_RELAY_KEY` 仍受支持，但不要在交互式 shell 里直接赋值：PowerShell 的 PSReadLine 和 bash 都会把整行含 Key 的命令写进历史。请优先用 `--key-file` 并把文件 ACL 限制为本人可读；如果必须用环境变量，请在启动器或服务配置里注入，而不是在命令行里输入。

Key 的读取顺序是 `--key-file` > `--key` > `FISH_RELAY_KEY`；`--key` 只用于临时调试，会进入 shell 历史，CLI 会给出警告。输出不会包含 Key。

退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 未发现伪造证据（行为与原生一致） |
| 1 | 疑似非原生/翻译层，但证据不足以判定极大概率伪造 |
| 2 | 极大概率伪造了模型（B1 篡改签名仍被接受，且 C1 计数不一致） |
| 3 | 无法判断、认证失败、网络失败或目标不是 Anthropic Messages API |

## 作为 Dock 插件开发

源码目录不含 `sdk.mjs`，它由 Dock 仓的 `sdk/node/plugin.mjs` 在暂存时复制；这与仓内其他插件一致。把相邻 Dock 仓准备好后：

```powershell
node tools/stage-development.mjs --out C:/work/preview-plugins --sdk ../FISH-Dock/sdk
```

然后在 Dock 调试版里通过 `FISH_DOCK_DEV_PLUGINS` 加载输出目录。插件清单由 `stage-development.mjs` 生成，不要手写 `plugin.json` 的摘要。

## 测试

```powershell
node --test --test-isolation=none "plugins/relay-probe/*.test.mjs"
```

测试全部使用合成响应，不访问网络。

## 安全边界

- 仅允许 HTTPS；本机回环地址可用 HTTP。
- 禁止 URL 内嵌用户名/密码、查询串和 `#` 片段；重定向一律拒绝，避免 Key 被带到其他主机。
- Key 在插件中写入 `credentials` 加密分类，页面和 `relay.view` 只返回“是否已保存”，不回显内容。
- 探针只向用户填写的 Base URL 发送请求，不上传到第三方。
