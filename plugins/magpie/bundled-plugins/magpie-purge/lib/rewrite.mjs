// system 段的改写：把选定的人设/技能按模式写进请求。
//
// 这段逻辑与上游 agent-purge 的 magpie 插件同一个思路（四种 protocol 的落点、块结构原样保留、
// 行级去身份），这里重写并补了两件事：
//   - 技能条目按顺序拼在人设后面（多段 system 内容）；
//   - strict 只换「可控的 system 文本」，结构化工具定义不在网关这一层，改不动也不假装改动。
//
// 模式语义（与上游一致，页面照抄这份说明）：
//   off      不动请求
//   strict   整段可控 system 换成人设（工具说明文本也会一起没了，harness 可能变笨）
//   replace  人设放最前，宿主 system 里「自称 + 点名模型/厂商」的行删掉（近似）
//   append   人设放最前，宿主 system 原样保留
export const MODES = ['off', 'strict', 'replace', 'append']

export const SEP = '\n\n'

const SELF = /^\s*(?:You are|You're|你是|您是|我(?:是|现在扮演|就是))/i
const NAMED =
  /(Claude|ChatGPT|GPT-?[45]|Gemini|Codex|Copilot|DeepSeek|Qwen|Kimi|GLM|Cursor|Windsurf|AI (?:assistant|model)|语言模型|助手)/i

/** stripIdentity 只删「一行里同时有自称 + 点名模型/厂商」的行，宁少删不错杀。 */
export function stripIdentity(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => !(SELF.test(line) && NAMED.test(line)))
    .join('\n')
    .trim()
}

/** compose 把选中的人设与技能拼成一段：人设在前，技能按 id 顺序用标题隔开。 */
export function compose({ persona = '', skills = [], limit = 64 * 1024 } = {}) {
  const parts = []
  if (persona && persona.trim()) parts.push(persona.trim())
  for (const skill of skills) {
    const body = String(skill?.text ?? '').trim()
    if (!body) continue
    parts.push(`## 技能：${skill.name || skill.id || 'skill'}\n\n${body}`)
  }
  return parts.join(SEP).slice(0, limit)
}

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
  return ''
}

/** Anthropic：system 可以是字符串或块数组；块结构（含 cache_control）原地保留。 */
function anthropic(body, text, mode) {
  const cur = body.system
  const blocks =
    typeof cur === 'string'
      ? cur
        ? [{ type: 'text', text: cur }]
        : []
      : Array.isArray(cur)
        ? cur.filter((b) => b && typeof b === 'object').map((b) => ({ ...b }))
        : []
  if (mode === 'strict') {
    body.system = [{ type: 'text', text }]
    return
  }
  if (mode === 'replace') for (const b of blocks) if (typeof b.text === 'string') b.text = stripIdentity(b.text)
  body.system = [{ type: 'text', text }, ...blocks]
}

/** Chat Completions / Responses 之外的通用 chat：system|developer 消息。 */
function chat(body, text, mode) {
  if (!Array.isArray(body.messages)) body.messages = []
  const msgs = body.messages
  const i = msgs.findIndex((m) => m?.role === 'system' || m?.role === 'developer')
  if (mode === 'strict') {
    const first = i >= 0 ? { ...msgs[i], content: text } : { role: 'system', content: text }
    body.messages = msgs.filter((m) => m?.role !== 'system' && m?.role !== 'developer')
    body.messages.splice(i < 0 ? 0 : Math.min(i, body.messages.length), 0, first)
    return
  }
  if (i < 0) {
    msgs.unshift({ role: 'system', content: text })
    return
  }
  const m = msgs[i]
  const host = mode === 'replace' ? stripIdentity(textOf(m.content)) : textOf(m.content)
  m.content = host ? text + SEP + host : text
}

/** Responses API：instructions 是唯一落点。 */
function responses(body, text, mode) {
  const host = typeof body.instructions === 'string' ? body.instructions : ''
  if (mode === 'strict') {
    body.instructions = text
    return
  }
  const keep = mode === 'replace' ? stripIdentity(host) : host
  body.instructions = keep ? text + SEP + keep : text
}

/** Gemini：systemInstruction（或 system_instruction）的 parts。 */
function gemini(body, text, mode) {
  const key = body.systemInstruction ? 'systemInstruction' : body.system_instruction ? 'system_instruction' : 'systemInstruction'
  const cur = body[key]
  const parts = Array.isArray(cur?.parts) ? cur.parts.filter((p) => p && typeof p === 'object').map((p) => ({ ...p })) : []
  if (mode === 'strict') {
    body[key] = { parts: [{ text }] }
    return
  }
  if (mode === 'replace') for (const p of parts) if (typeof p.text === 'string') p.text = stripIdentity(p.text)
  body[key] = { ...(cur ?? {}), parts: [{ text }, ...parts] }
}

const BY_PROTOCOL = { anthropic, chat, responses, gemini }

/** supported 说这个 protocol 能不能改：说不出的就不动请求，报告 unavailable。 */
export const supported = (protocol) => Boolean(BY_PROTOCOL[protocol])

/**
 * rewrite 按 protocol 与 mode 改写 body，原地修改并返回它。
 * mode 非法时按 off 处理——宁可不动，也不要把请求改成半截。
 */
export function rewrite(body, protocol, text, mode) {
  const fn = BY_PROTOCOL[protocol]
  if (!fn || !MODES.includes(mode) || mode === 'off' || !text) return body
  fn(body, text, mode)
  return body
}

/** 网关手里只有文本，没有各家的启动参数：如实告诉页面这条边界。 */
export const BOUNDARY =
  '只处理经过 magpie 网关的 agent 请求；客户端自己写死的行为、不经过网关的流量改不到。' +
  'strict 会连原 system 里的工具说明文本一起换掉——结构化工具定义不在网关这一层。' +
  '页面不读磁盘，条目由插件后端扫描后写成快照，页面只显示它。'