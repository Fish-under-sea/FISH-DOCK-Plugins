// 「这一次请求会注入什么」的判定：钩子拿它决定改不改，页面拿它显示状态。
//
// 三层，先到先得：
//   1. 插件页显式选过的（options.mode / options.persona）；
//   2. agent-purge 的 state.json（全局 mode/persona，或该 agent 的 override）；
//   3. 兜底：mode 视为 off，人设取第一个启用的人设。
//
// 这样两件事同时成立：在 agent-purge 里换人设，下一个请求立刻跟着换；
// 在插件页里点一下，也立刻生效，不必去改 state.json。
import { MODES } from './rewrite.mjs'
import { forAgent } from './agentpurge.mjs'

/**
 * resolve 判定这次注入。
 * @param {object} p
 * @param {object} p.options 插件 options（plugins.json）
 * @param {object} p.state agent-purge 的 readState() 结果；没有就传 null
 * @param {object[]} p.entries 可注入的条目（带 text 的）
 * @param {string} [p.agent] 当前请求的 agent 名；页面判定全局时不传
 * @returns {{mode: string, modeFrom: string, personaId: string, personaName: string, personaFrom: string, skills: object[], blocked: string, ready: boolean}}
 */
export function resolve({ options = {}, state = null, entries = [], agent = '' } = {}) {
  const ap = forAgent(state, agent)
  if (ap.blocked) {
    return blank('agent-purge', ap.mode || '', ap.blocked, ap.mode === 'off' ? 'ap-off' : 'ap-disabled')
  }

  // ---- 模式 ----
  const pageMode = MODES.includes(options.mode) ? options.mode : ''
  const mode = pageMode || ap.mode || 'off'
  const modeFrom = pageMode ? 'page' : ap.mode ? 'agent-purge' : 'default'
  if (mode === 'off') {
    return {
      ...blank(modeFrom, mode, '', modeFrom === 'default' ? 'no-mode' : 'mode-off'),
      blocked: modeFrom === 'default'
        ? '还没选模式：模式是 off，请求原样放行。选一个模式（比如 replace）就开始注入'
        : '当前模式是 off，请求原样放行',
    }
  }

  // ---- 人设 ----
  const byId = new Map()
  for (const e of entries) if (e && typeof e.id === 'string' && !byId.has(e.id)) byId.set(e.id, e)
  const personas = entries.filter((e) => e.kind === 'persona')

  let personaId = ''
  let personaFrom = ''
  let missingPersona = ''
  const pagePersona = typeof options.persona === 'string' ? options.persona.trim() : ''
  if (pagePersona && byId.has(pagePersona)) {
    personaId = pagePersona
    personaFrom = 'page'
  } else if (ap.persona && byId.has(ap.persona)) {
    personaId = ap.persona
    personaFrom = 'agent-purge'
  } else if (pagePersona || ap.persona) {
    // 指名要谁却找不到，就不偷偷换一个人设顶上：那会让「明明选了 A，注入的却是 B」
    missingPersona = pagePersona || ap.persona
  } else {
    // 自动只挑用户自己的人设：内置人设（Prompt Forge 这类）是工具，不该在用户没选的时候
    // 悄悄接管请求——那会让人以为「我什么都没配，怎么 system 被换了」。
    const auto = personas.find((e) => e.builtin !== true && options.enabled?.[e.id] !== false)
    if (auto) {
      personaId = auto.id
      personaFrom = 'auto'
    }
  }

  if (!personaId) {
    if (missingPersona) {
      return {
        ...blank(modeFrom, mode, '', 'persona-missing'),
        blocked: `指定的「${missingPersona}」不在当前来源里：把它放进来源目录，或在这里挑一个`,
      }
    }
    const why = personas.length
      ? '还没有选人设：左边挑一条「人设」点“设为当前人设”'
      : '来源里还没有人设（.md）：导入一份，或把 agent-purge 的 personas 目录加进来源'
    return { ...blank(modeFrom, mode, '', personas.length ? 'no-persona' : 'no-persona-file'), blocked: why }
  }

  const persona = byId.get(personaId)
  const skills = entries
    .filter((e) => e.kind !== 'persona' && options.enabled?.[e.id] === true)
    .map((e) => ({ id: e.id, name: e.name, text: e.text }))

  return {
    mode,
    modeFrom,
    personaId,
    personaName: persona?.name || personaId,
    personaFrom,
    skills,
    blocked: '',
    blockedCode: '',
    ready: true,
  }
}

function blank(modeFrom, mode, blocked, blockedCode = '') {
  return { mode: mode || 'off', modeFrom, personaId: '', personaName: '', personaFrom: '', skills: [], blocked, blockedCode, ready: false }
}