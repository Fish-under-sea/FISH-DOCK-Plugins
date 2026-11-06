// Purge in Magpie 的网关请求钩子（Bun，每请求一次）。
//
// 它做两件事：
//   1. 把本地 purge 目录清点成条目表（state/catalog.json + page/catalog.js 快照）；
//   2. 按页面选的 mode / 人设 / agents 改写经过 magpie 网关的 agent 请求的 system 段。
//
// 为什么是 hook 而不是 middleware：hook 跑在 Bun 侧，能读本地文件（清点目录要用它）；
// middleware 跑在网关进程的 moejs 里，只适合纯文本改写。上游 agent-purge 的 magpie 插件
// 也是这个形状，我们沿用并把「清点」做成自动的。
//
// 失败一律 fail-open：改不动就原样放行，绝不把 agent 的请求弄挂。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compose, rewrite, supported } from './lib/rewrite.mjs'
import { readState } from './lib/agentpurge.mjs'
import { resolve as resolvePlan } from './lib/plan.mjs'
import { loadCatalog, ownOptions, paths, sync } from './lib/state.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** inlineEntries 把页面直接贴进来的人设/技能（存在 options.inline 里）并进候选。 */
export function inlineEntries(options = {}) {
  const list = Array.isArray(options.inline) ? options.inline : []
  return list
    .filter((e) => e && typeof e.id === 'string' && typeof e.text === 'string' && e.text.trim())
    .slice(0, 8)
    .map((e) => ({
      id: e.id,
      name: String(e.name || e.id),
      kind: e.kind === 'skill' ? 'skill' : 'persona',
      status: 'ok',
      injectable: true,
      text: String(e.text).slice(0, 64 * 1024),
      digest: String(e.digest || ''),
      history: [],
      meta: { format: 'inline' },
    }))
}

/** pick 选出这一次要注入的文本：人设一条，显式启用的技能若干。 */
export function pick(catalog, options = {}, state = null, agent = '') {
  const entries = [...(Array.isArray(catalog?.entries) ? catalog.entries : []), ...inlineEntries(options)]
  const usable = entries.filter((e) => e.status === 'ok' && e.injectable && typeof e.text === 'string' && e.text.trim())
  const pinned = options.pinned && typeof options.pinned === 'object' ? options.pinned : {}

  /** resolve 按 pinned 取版本：固定到某一版时用那一版的正文，找不到就如实报告。 */
  const missingPin = []
  const resolveEntry = (entry) => {
    const pin = pinned[entry.id]
    if (!pin || !entry.digest || pin === entry.digest) return entry
    const old = (entry.history || []).find((v) => v.digest === pin && v.text)
    if (old) return { ...entry, text: old.text, digest: old.digest }
    missingPin.push(entry.id)
    return entry
  }
  const resolved = usable.map(resolveEntry)
  const byId = new Map()
  for (const e of resolved) if (!byId.has(e.id)) byId.set(e.id, e)

  // 三层优先级（页面 > agent-purge state.json > 默认）都在 plan.resolve 里判定
  const plan = resolvePlan({ options, state, entries: resolved, agent })
  const persona = plan.personaId ? byId.get(plan.personaId) ?? null : null
  const skills = plan.skills.map((s) => byId.get(s.id)).filter(Boolean)
  const text = plan.ready ? compose({ persona: persona?.text || '', skills }) : ''
  return { persona, personaId: plan.personaId, skills, text, missingPin, plan }
}

/**
 * createHook 造一组绑定到某个插件目录的钩子：生产用模块末尾那个默认实例，
 * 测试用临时目录，避免把本机真实 state 写脏。
 *
 * 关键约束：magpie 给每个网关钩子的预算是 gatewayTimeoutMs（默认 1000 ms），
 * 超时就把这次请求当作失败放行。扫描目录 + 读 ZIP 很容易超预算，所以：
 *   - 进程起来（模块加载）就先在后台扫一遍，不等任何请求；
 *   - 请求里只等一个「已经好了」的 Promise，最多等 deadlineMs；
 *   - 等不到就跳过这次注入（report skipped），扫描继续在后台跑完，下个请求就有。
 */
export function createHook(root = here, { deadlineMs = 400, rescanMs = 30_000, warmUp = true } = {}) {
  const P = paths(root)
  let cached = { at: 0, catalog: loadCatalog(P), key: '' }
  /** 每个配置键各跑各的扫描：一个键在扫不挡另一个键（默认来源慢的时候尤其重要）。 */
  const scans = new Map()
  let lastWrite = 0

  /** keyOf 是「这次配置要不要重扫」的粗指纹：来源目录 + 刷新戳。 */
  const keyOf = (options = {}) => {
    const sources = Array.isArray(options.sources) ? options.sources.filter((s) => typeof s === 'string' && s.trim()) : []
    return [sources.join('|') || 'default', String(options.refreshAt ?? 0)].join('@')
  }

  /** scanOnce 按配置键去重：同一份配置同时只扫一次，不同配置并行。 */
  function scanOnce(options) {
    const key = keyOf(options)
    const running = scans.get(key)
    if (running) return running
    const job = Promise.resolve()
      .then(() => sync(root, options))
      .then(({ catalog }) => {
        cached = { at: Date.now(), catalog, key }
        return catalog
      })
      .catch(() => null)
      .finally(() => { scans.delete(key) })
    scans.set(key, job)
    return job
  }

  /** warm 在模块加载时就起：读回自己的 options（页面要能无流量也显示条目），再扫一遍。 */
  const own = ownOptions(root)
  const warm = warmUp ? scanOnce(own || {}) : Promise.resolve(null)

  /** ensureCatalog 拿条目表，最多等 deadlineMs；等不到就返回 null，让这次请求放行。 */
  async function ensureCatalog(options) {
    const now = Date.now()
    const key = keyOf(options)
    const fresh = cached.key === key && now - cached.at < rescanMs && cached.catalog?.version
    if (fresh) return cached.catalog
    const wait = scanOnce(options)
    const deadline = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), deadlineMs)
      if (typeof timer.unref === 'function') timer.unref()
    })
    const got = await Promise.race([wait, deadline])
    return got || null
  }

  function remember(record) {
    const now = Date.now()
    if (now - lastWrite < 5000) return
    lastWrite = now
    try {
      mkdirSync(P.stateDir, { recursive: true })
      writeFileSync(P.lastFile, JSON.stringify(record, null, 2), 'utf8')
    } catch {
      /* 写不进去不影响请求 */
    }
  }

  /**
   * onRequest 是 magpie 的异步网关钩子：返回改过的 body 就用它，返回 undefined 表示原样放行。
   * ctx: { protocol, model, stream, agent, options, report(code, bytes), state }
   */
  async function onRequest(body, ctx) {
    const options = ctx?.options && typeof ctx.options === 'object' ? ctx.options : {}
    const report = (code, bytes = 0) => {
      try {
        ctx?.report?.(code, bytes)
      } catch {
        /* report 自己失败不能影响放行 */
      }
    }
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return
      // 页面只限定范围；真正「这次要不要改」由 plan 判定（页面设置 > agent-purge state > 默认）
      const agents = Array.isArray(options.agents) ? options.agents.filter((a) => typeof a === 'string') : []
      if (agents.length && !agents.includes(ctx?.agent)) {
        report('skipped', 0)
        return
      }
      if (!supported(ctx?.protocol)) {
        report('unavailable', 0)
        return
      }

      const catalog = await ensureCatalog(options)
      if (!catalog) {
        // 扫描还没跑完（超时预算）：这次放行，不阻塞 agent 请求。
        report('skipped', 0)
        return
      }
      // state.json 每请求读一次（很小的文件），这样在 agent-purge 里换人设立刻生效
      const state = readState()
      const picked = pick(catalog, options, state, ctx?.agent)
      if (!picked.text) {
        report('skipped', 0)
        rememberSkip(catalog, picked, ctx)
        return
      }
      rewrite(body, ctx.protocol, picked.text, picked.plan.mode)
      remember({
        at: Date.now(),
        agent: ctx?.agent || '',
        protocol: ctx.protocol,
        model: ctx?.model || '',
        mode: picked.plan.mode,
        modeFrom: picked.plan.modeFrom,
        persona: picked.personaId,
        personaFrom: picked.plan.personaFrom,
        skills: picked.skills.map((s) => s.id),
        chars: picked.text.length,
        missingPin: picked.missingPin,
        catalogVersion: catalog?.version ?? 0,
      })
      report('ready', picked.text.length)
      return body
    } catch {
      report('invalid', 0)
      return
    }
  }

  /** rememberSkip 把「为什么没注入」也写下：页面要能回答这个问题，而不是只显示空。 */
  function rememberSkip(catalog, picked, ctx) {
    remember({
      at: Date.now(),
      agent: ctx?.agent || '',
      protocol: ctx?.protocol || '',
      model: ctx?.model || '',
      mode: picked.plan?.mode || 'off',
      modeFrom: picked.plan?.modeFrom || '',
      persona: '',
      personaFrom: picked.plan?.personaFrom || '',
      skills: [],
      chars: 0,
      missingPin: [],
      skipped: picked.plan?.blocked || '',
      catalogVersion: catalog?.version ?? 0,
    })
  }

  return { onRequest, pick, ensureCatalog, warm }
}

const hook = createHook(here)

export async function onRequest(body, ctx) {
  return hook.onRequest(body, ctx)
}