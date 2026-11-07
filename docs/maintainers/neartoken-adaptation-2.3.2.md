# NearToken 侧需要为 magpie 2.3.2 做的事

> 结论：**要适配**，三件，都不大。magpie 2.3.2（补丁 `fish.27`）把设置页的模型区拆成
> 识图 / 生图 / 视频 / 语音 / 向量 五类，并把 MCP 出口从「生图」扩成「素材」
> （`/mcp/magpie/materials`，工具 `generate_image` / `generate_video` / `generate_audio` /
> `generation_result`）。NearToken 的模型要出现在这些分区里，才有得选。

## 1. 模型 kind 标注（必须）

magpie 按模型自己声明的 kind 分区，不猜。NearToken 提供的非对话模型，需要标对：

| NearToken 的模型 | kind | 落到 magpie 哪里 |
| --- | --- | --- |
| 生图（如 `gpt-image-2.5-flare`） | `image` | 设置 › 图像 › 生图模型 |
| 视频（如 `sd2.5`） | `video` | 设置 › 图像 › **视频模型** |
| 语音合成 / 转写 / **音乐** | `speech`（音乐也归这类，见下） | 设置 › 图像 › 语音模型 |
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

- 如果 NearToken 的音乐模型就是 OpenAI 兼容的 `/audio/speech`：标 `speech` 即可，magpie 不用改；
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

- NearToken 需要的最低 magpie：**2.3.2**（`v0.1.3240+fish.27`）。
- 抬 `magpie.min` 到 2.3.2 之后，再启用视频模型与 `generate_audio` 的说明。
