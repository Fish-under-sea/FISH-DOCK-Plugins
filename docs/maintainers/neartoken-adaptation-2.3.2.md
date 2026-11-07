# NearToken 侧需要为 magpie 2.3.2 做的事

> 结论：**要适配**，三件，都不大。magpie 2.3.2（补丁 `fish.28`）把设置页的模型区拆成
> 识图 / 生图 / 视频 / 语音 / 向量 五类，并把 MCP 出口从「生图」扩成「素材」
> （`/mcp/magpie/materials`，工具 `generate_image` / `generate_video` / `generate_audio` /
> `generation_result`）。NearToken 的模型要出现在这些分区里，才有得选。

## 1. 模型 kind 标注（必须）

magpie 按模型自己声明的 kind 分区，不猜。NearToken 提供的非对话模型，需要标对：

| NearToken 的模型 | kind | 落到 magpie 哪里 |
| --- | --- | --- |
| 生图（如 `gpt-image-2.5-flare`） | `image` | 设置 › 图像 › 生图模型 |
| 视频（如 `sd2.5`） | `video` | 设置 › 图像 › **视频模型** |
| 语音合成 / 转写 / **音乐** | `audio`（分区显示为语音） | 设置 › 图像 › 语音模型 |
| 向量 / 重排 | `embedding` | 设置 › 图像 › 向量模型 |

怎么标（按 NearToken 现在的清单写法选其一）：

- 插件清单里模型的 `kind` 字段；
- 或 provider 返回模型时带 `kind`；
- 或走 magpie 编辑器里的「其他模型」手动标（这只解决单机，不解决分发）。

**验收**：magpie 2.3.2 的设置 › 图像里，NearToken 的视频模型只出现在「视频模型」行、
生图模型只出现在「生图模型」行（两边不重叠）；语音/向量同理。

## 2. 音乐模型归到 audio

`generate_audio` 音一个工具，出的是**语音或音乐**，走 magpie 的 `/v1/audio/speech` 那条路
（模型由设置 › 图像 › 语音模型决定）。

- 如果 NearToken 的音乐模型就是 OpenAI 兼容的 `/audio/speech`：标 `audio` 即可，magpie 不用改；
- 如果音乐走**独立 API**（比如自己的 `/music/generations`）：先在 magpie 侧开个 issue 说明
  请求体与返回格式，magpie 需要在 `generate_audio` 里分流，NearToken 这边先别标成 `speech`。

## 3. （可选）页面调 `neartoken:relist`

magpie 2.3.2 加了一个专用恢复钩子 `neartoken:relist`：插件页在启动/登录后调一次，宿主把
「被 setAside 的供应商记录」放回并触发重列（用户不用再点「加回来」）。**用户显式移除的不会恢复。**

- NearToken 页面如果要自愈：在 `package.json` 的 `magpie.calls` 里加 `"neartoken:relist"`，
  登录成功后调一次，失败静默重试一次；
- 不接也不影响其它功能。

## 4. 不需要 NearToken 改的

- 四个响应超时（生图/视频/语音/向量）是 magpie 设置页里的**本机设置**，插件不用读也不用传；
- 素材 MCP 的端点路径由 magpie 提供，旧 `/mcp/magpie/image` 仍可用（只改名，不断旧接入）。

## 5. 版本

- NearToken 需要的最低 magpie：**2.3.2**（`v0.1.3240+fish.28`）。
- 抬 `magpie.min` 到 2.3.2 之后，再启用视频模型与 `generate_audio` 的说明。

---

## 6. NearToken 侧回填：实际核对结果（2026-11-07，插件 1.3.0）

### 6.1 kind 取值：是 `audio`，不是 `speech`

上面第 1 节的表格把语音写成 `kind: speech`，那是**分区名**。`internal/provider/plugins.go` 的 `pluginKind` 认的字段值仍是：

```go
case "image":     c.Draws = true
case "video":     c.Films = true
case "audio":     c.Serves = speechKindOf(m.ID)
case "embedding": c.Serves = embedKindOf(m.ID)
```

NearToken 从 1.1.8 起发的就是 `image` / `video` / `audio` / `embedding`（`chat` 时不写该字段），与 2.3.2 一致，**这一项不需要改**。文档表格建议改成 `audio`，免得下一个人按 `speech` 写反。

### 6.2 音乐模型不存在「独立 API」分支

第 2 节预设了「音乐可能走 `/music/generations` 之类的独立 API」。实测本站不是这样：

- `suno_lyrics` / `suno_music` / `suno_sound` / `suno_timing` / `suno_stems_by_url` 的 `supported_endpoint_types` 都是 `["openai"]`；
- 分组是 `[满血] Suno`；
- `POST /v1/music/generations` 返回 **404** `Invalid URL`。

所以音乐模型和 TTS 一样，只挂 chat 端点，不涉及 `generate_audio` 的分流问题。

### 6.3 关键实测：站点没有可用的 `/audio/*` 渠道

拿宿主凭据直连站点探测（带 `x-neartoken-group` 走正确分组）：

| 端点 | 结果 |
| --- | --- |
| `POST /v1/audio/speech`（`gemini-3.8-flash-tts`） | **500** `not implemented` / `convert_request_failed` |
| `POST /v1/audio/transcriptions`（`gemini-3.5-transcribe`） | **503** `No available channel for model whisper-1` |
| `POST /v1/music/generations` | **404** `Invalid URL` |

站点自己声明的端点类型全集（`/api/pricing` 全量统计）：

```
anthropic, gemini, image-generation, openai, openai-response, openai-video
```

**没有 `audio`。** 也就是说 `/v1/audio/speech` 这条路由在站点上存在（返回 500 而不是 404），但没有渠道能接——TTS 模型实际挂在 `gemini` 与 `openai` 端点上，new-api 无法把它转换成 audio 请求。

带上分组头后请求确实到了渠道（`group=#35`），失败在转换那一步，不是路由或鉴权问题。

### 6.4 这带来的实际后果

NearToken 的 TTS / 转写 / 音乐模型现在会：

1. 按 `kind: audio` 正确进入 magpie 的「语音模型」分区（分类没问题）；
2. 用户选中后，`generate_audio` 走 `/v1/audio/speech` → **上游 500**。

对用户是「选得到但用不了」的迷惑状态。

### 6.5 需要宿主决策的两条路

- **A. 支持 gemini 原生 TTS**：`generate_audio` 遇到这类只挂 `gemini` 端点的模型时，改走 Gemini 的 `generateContent`（`responseModalities: ["AUDIO"]`），而不是 OpenAI 的 `/audio/speech`；
- **B. 暂不接收这种 `audio`**：在 `pluginKind` 里加一道判据——模型只挂 chat 端点、又没有 audio 端点时，不把它当 `Serves=speech`，让它留在对话列表，等站点开了 audio 渠道再说。

在宿主决定之前，NearToken 保持现状（标 `audio`），因为分类语义是对的；如果倾向 B，我们这边可以把 `kind` 改成不带，代价是这些模型不再出现在语音分区。

### 6.6 已经做完的两项

| 文档条目 | 状态 |
| --- | --- |
| 第 3 节 `neartoken:relist` | **已接**（1.3.0）：已连接时调一次，失败静默隔 3 秒重试一次，每会话最多两次；老宿主没这条通道直接跳过 |
| 第 5 节 `magpie.min` | **已抬到 2.3.2**（1.3.0） |

`neartoken:relist` 的实际效果目前还没在真机上等到「掉出后再自愈」的场景验证——需要一次插件重载触发掉出，再开插件页看是否自动恢复。这条等有实例时补。
### 6.7 宿主决策（2026-11-07，magpie 维护侧）

两条路里**暂取 B 的变体**，A 另排期：

- **`pluginKind` 保持认 `audio`**（分类语义对，不改）；不额外加"只挂 chat 端点就不算语音"的判据——magpie 拿不到插件声明的端点能力，硬加判据会把语义判断塞进宿主，且 NearToken 的声明本身没错。
- **`generate_audio` 失败时给明确文案**：走 `/v1/audio/speech` 返回 500/503 时，工具结果写「该模型所属供应商没有可用的音频渠道（站点未开 audio 终点）」，别让用户以为是 magpie 的问题。这一条属于宿主侧收尾，随 2.3.2 一起。
- **A（Gemini 原生 TTS）单独排期**：要走 `generateContent` + `responseModalities: ["AUDIO"]`，请求体、返回（base64 PCM）、时长与额度都不是 OpenAI 协议；等 NearToken 站点开出 audio 渠道、或用户明确要 Gemini TTS 再立项，不阻塞 2.3.2。

NearToken 侧在 A 落地前保持 `kind: audio` 与现状即可；用户选中 NearToken 的 TTS 后会看到上面那条明确文案，而不是空白失败。

---

### 6.8 请求体与返回样例（2026-11-07 实测，站点侧当前全部不可用）

宿主要「这两个模型真实调用的请求体 + 返回样例」。**请求体拿到了，成功样例没有**——站点侧这些模型此刻没有任何可用上游。下面是完整过程，可复核。

#### 尝试范围

`/api/pricing` 里所有语音/音乐类模型共 **11 个**，逐个用宿主凭据 + 正确分组头发了一次请求；TTS 另外试了 **3 种 gemini 原生端点路径**。

#### 请求体 A：OpenAI 兼容 chat（插件与 magpie 都在用）

```http
POST https://neartoken.cc/v1/chat/completions
authorization: Bearer <token>
content-type: application/json
x-neartoken-group: #35          # 取自 pricing 的 group_refs
```

```json
{"model":"gemini-3.8-flash-tts","messages":[{"role":"user","content":"say hello"}],"max_tokens":32}
```

suno 同形，`x-neartoken-group: #67`（`[满血] Suno`），`model` 换成 `suno_music` 等。

#### 请求体 B：Gemini 原生 generateContent

```http
POST https://neartoken.cc/v1beta/models/gemini-3.8-flash-tts:generateContent
authorization: Bearer <token>
content-type: application/json
x-neartoken-group: #35
```

```json
{
  "contents": [{ "parts": [{ "text": "Say: hello from NearToken" }] }],
  "generationConfig": { "responseModalities": ["AUDIO"] }
}
```

`/v1/models/...:generateContent` 与 `?alt=json` 两种变体也试了，结果相同。

#### 真实返回（三类，均非成功）

**TTS 5 个模型（chat 与 gemini 原生都是）→ 503**

```json
{"error":{"message":"No eligible account is currently available for this model.","type":"upstream_error","param":"","code":503}}
```

**suno 5 个模型 → 404**

```json
{"error":{"message":"No available channel for this model on the current token (request id: …)","type":"new_api_error","param":"","code":"model_not_found"}}
```

**`gemini-3.5-transcribe` → 400，但这条信息很有用**

```json
{"error":{"message":"use the native generateContent endpoint with inline audio for this transcription model (request id: …)",…}}
```

也就是说 ASR 的形态是明确的：**`generateContent` + `inline_data`（音频内联在请求里）**，不是 `/audio/transcriptions` 的 multipart。

#### 结论

- 请求能到站点、能路由到分组（`group=#35` / `#67`），失败在**上游没有可用账号/渠道**这一层，与端点形态无关；
- 所以「从回复里取音频」需要的成功样例，**这次取不到**。suno 是否返回 `{"data":[{"url":…}]}` 这种自有格式，暂时无从判断；
- 站点恢复后我会立刻补一次真实响应。到时候按 6.7 的 B 方案，宿主只需要在 `generate_audio` 失败文案上兜住；若 suno 果然是自有格式，再按样例加分支。

#### 附：可复现的最小命令

```bash
curl -sS https://neartoken.cc/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'x-neartoken-group: #35' \
  -d '{"model":"gemini-3.8-flash-tts","messages":[{"role":"user","content":"hi"}],"max_tokens":16}'
```
