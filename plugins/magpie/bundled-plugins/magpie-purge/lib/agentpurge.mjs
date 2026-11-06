// agent-purge 的原生语义：`~/.agent-purge/state.json`。
//
// 上游 agent-purge 用这份 state 决定「现在用哪个人设、什么模式、哪个 harness 关掉」：
//
//   state.default.mode     默认模式（off / strict / replace / append）
//   state.persona          当前人设 id
//   state.overrides[agent] 单个 harness 的覆盖：{ mode, persona }
//   state.disabledHarnesses[]  整个关掉的 harness 列表
//
// 本插件认这份语义，但**不接管它**：页面里显式选过的 mode/persona 优先，
// 没选过才回落到这里。这样两件事都成立——
//   - 在 agent-purge 里换人设，下一个请求立刻换（用户原来怎么用，现在还怎么用）；
//   - 在插件页里点「设为当前人设」立刻生效，不需要去改 state.json。
//
// state.json 坏掉或缺失时返回 bound=false：没有 state 就当「没装过 agent-purge」，
// 走插件自己的设置，绝不让一份坏 JSON 把请求改坏。
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { MODES } from './rewrite.mjs'

/** purgeHome 是 agent-purge 的数据目录：AGENT_PURGE_HOME 优先，否则 ~/.agent-purge。 */
export function purgeHome(env = process.env) {
  const raw = String(env.AGENT_PURGE_HOME || env.PURGE_HOME || '').trim()
  if (!raw) return join(homedir(), '.agent-purge')
  return isAbsolute(raw) ? raw : resolve(raw)
}

/** statePath 是 agent-purge 的状态文件。 */
export const statePath = (env) => join(purgeHome(env), 'state.json')

/**
 * readState 读 agent-purge 的状态。
 * @returns {{ bound: boolean, mode: string, persona: string, disabled: string[], overrides: object, error: string }}
 */
export function readState(env = process.env) {
  const empty = { bound: false, mode: '', persona: '', disabled: [], overrides: {}, error: '' }
  const file = statePath(env)
  let st
  try {
    st = statSync(file)
  } catch {
    return empty // 没装过 agent-purge：不是错
  }
  if (!st.isFile()) return { ...empty, error: 'state.json 不是文件' }
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { ...empty, error: `state.json 坏了：${error?.message || error}` }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...empty, error: 'state.json 不是一个对象' }
  }
  const mode = typeof raw.default?.mode === 'string' && MODES.includes(raw.default.mode) ? raw.default.mode : ''
  const persona = typeof raw.persona === 'string' ? raw.persona.trim() : ''
  const disabled = Array.isArray(raw.disabledHarnesses)
    ? raw.disabledHarnesses.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : []
  const overrides = raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? raw.overrides : {}
  return { bound: true, mode, persona, disabled, overrides, error: '' }
}

/**
 * forAgent 取某个 agent 在这里生效的设置。
 *
 * 上游的顺序是：override 的 mode/persona 盖住全局；disabledHarnesses 里的一律不做；
 * default.mode 为 off 时全局关掉。这里照抄，但把「为什么不做」写进 blocked。
 * @returns {{ mode: string, persona: string, blocked: string }}
 */
export function forAgent(state, agent) {
  if (!state?.bound) return { mode: '', persona: '', blocked: '' }
  const name = typeof agent === 'string' ? agent : ''
  if (name && state.disabled.includes(name)) return { mode: '', persona: '', blocked: 'agent-purge 里关掉了这个 harness' }
  const o = name && state.overrides && typeof state.overrides[name] === 'object' ? state.overrides[name] : null
  const mode = (o && typeof o.mode === 'string' && MODES.includes(o.mode) ? o.mode : '') || state.mode
  if (mode === 'off') return { mode: 'off', persona: '', blocked: 'agent-purge 的 default.mode 是 off' }
  const persona = (o && typeof o.persona === 'string' && o.persona.trim() ? o.persona.trim() : '') || state.persona
  return { mode, persona, blocked: '' }
}