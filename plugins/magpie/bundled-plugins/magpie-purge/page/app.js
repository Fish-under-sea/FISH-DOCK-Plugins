// 破甲 · Purge 的页面逻辑。
//
// 页面在 magpie 的沙箱帧里：不能 fetch、读不到磁盘，只有三样东西可用——
//   1. window.PURGE_CATALOG：后端扫描后写下的快照（page/catalog.js）；
//   2. magpie.options.get/set：这个插件在 plugins.json 里的设置；
//   3. magpie.ready / onVisibility：主题与可见性。
// 所以页面只做「显示 + 改设置」，真正的清点与改写都在 hooks.js 那一侧。
;(() => {
  'use strict'

  const bridge = window.magpie
  const $ = (id) => document.getElementById(id)
  const KINDS = {
    'session-archive': { label: '会话导出包', cls: 'material' },
    'cordis-plugin': { label: 'DSH 插件包', cls: 'material' },
    persona: { label: '人设', cls: 'persona' },
    skill: { label: '技能', cls: 'skill' },
    manifest: { label: '清单', cls: 'material' },
    text: { label: '文本', cls: 'skill' },
  }
  /** 三类语义色：人设 / 技能 / 素材。六种类型各给一色会变成彩虹，信息量却没增加。 */
  const kindClass = (kind) => KINDS[kind]?.cls || 'material'
  /** builtinFolder 从内置条目的 root 里取出它所在的目录名（skills / personas）。 */
  const builtinFolder = (e) => String(e.source?.root || '').split(/[\\/]/).filter(Boolean).pop() || 'skills'
  const MODE_HELP = {
    off: '请求原样放行，什么也不改。',
    strict: '整段可控 system 换成人设；原 system 里的工具说明文本也会一起没了。',
    replace: '人设放最前，宿主 system 里「自称 + 点名模型/厂商」的行删掉。',
    append: '人设放最前，宿主 system 原样保留。',
  }
  /** NOT_INJECTABLE 说清「这条为什么不会进 system」，并指出下一步：导入的是素材，不是人设。 */
  const NOT_INJECTABLE =
    '素材条目：可查、可归档，不会写进 system。要注入请导入人设或技能（.md / .markdown / .txt），' +
    '或在下方「从本机选文件」里挑一个 md。'

  let options = {}
  let catalog = window.PURGE_CATALOG ?? null
  let selected = ''
  let filter = ''
  let query = ''
  let saveTimer = 0
  let pendingSave = null
  let busy = false

  // ---------- 小工具 ----------

  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(n / 1024))} KiB`)
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—')
  const short = (digest) => (digest ? String(digest).slice(0, 12) : '—')

  function say(text, tone = '') {
    const el = $('status')
    el.textContent = text
    el.dataset.tone = tone
    el.hidden = !text
    if (!text) return
    clearTimeout(say.timer)
    say.timer = setTimeout(() => { el.hidden = true }, 6000)
  }

  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue
      if (k === 'class') node.className = v
      else if (k === 'text') node.textContent = v
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
      else node.setAttribute(k, v === true ? '' : String(v))
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
    }
    return node
  }

  const entries = () => (Array.isArray(catalog?.entries) ? catalog.entries : [])
  const inlineEntries = () => (Array.isArray(options.inline) ? options.inline : [])
  const findEntry = (id) => entries().find((e) => e.id === id) || inlineEntries().find((e) => e.id === id) || null
  const isEnabled = (id) => (options.enabled?.[id] !== undefined ? options.enabled[id] : findEntry(id)?.kind === 'persona')

  // ---------- 与宿主说话 ----------

  /** save 把整份 options 写回magpie；options.set 每秒只收一次，这里攒 1.1 秒再发。 */
  function save(patch, note) {
    options = { ...options, ...patch }
    if (pendingSave) Object.assign(pendingSave, patch)
    else pendingSave = { ...patch }
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 1100)
    if (note) say(note)
    render()
  }

  async function flush() {
    if (!pendingSave || !bridge?.options?.set) return
    const body = { ...options }
    pendingSave = null
    try {
      const saved = await bridge.options.set(body)
      if (saved && typeof saved === 'object') options = { ...body, ...saved }
    } catch (error) {
      say(`保存失败：${error?.message || error}`, 'bad')
    }
  }

  // ---------- 渲染 ----------

  function renderFilters() {
    const host = $('filters')
    const kinds = [...new Set(entries().map((e) => e.kind))]
    host.replaceChildren(
      el('button', { type: 'button', class: 'chip', 'aria-pressed': filter === '', onclick: () => { filter = ''; render() } }, `全部 ${entries().length}`),
      ...kinds.map((kind) => {
        const n = entries().filter((e) => e.kind === kind).length
        return el('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': filter === kind,
          onclick: () => { filter = filter === kind ? '' : kind; render() },
        }, `${KINDS[kind]?.label || kind} ${n}`)
      }),
    )
  }

  function visible() {
    const q = query.trim().toLowerCase()
    return entries()
      .filter((e) => (filter ? e.kind === filter : true))
      .filter((e) => (q ? `${e.name} ${e.id} ${e.source?.rel ?? ''} ${KINDS[e.kind]?.label ?? ''}`.toLowerCase().includes(q) : true))
      .concat(
        inlineEntries()
          .filter((e) => (filter ? e.kind === filter : true))
          .filter((e) => (q ? `${e.name} ${e.id}`.toLowerCase().includes(q) : true))
          .map((e) => ({
            ...e,
            status: 'ok',
            source: { rel: '页面导入（options）', root: 'inline' },
            size: 0,
            meta: { format: 'inline', description: '' },
            version: 1,
            chars: String(e.text || '').length,
            injectable: true,
            digest: '',
          })),
      )
  }

  function renderList() {
    const host = $('list')
    const rows = visible()
    if (!catalog) {
      host.replaceChildren(el('p', { class: 'empty', text: '还没有快照：后端没跑过扫描。点右上角「重新扫描」。' }))
      return
    }
    if (!rows.length) {
      host.replaceChildren(el('p', { class: 'empty', text: '没有匹配的条目。清掉搜索，或往来源目录里放点东西再扫一次。' }))
      return
    }
    // 分组比逐行挂「内置」胶囊干净：内置是「这一整组都随包来」，说一次就够。
    const groups = [
      { key: 'builtin', label: '内置专家与技能', rows: rows.filter((e) => e.builtin) },
      { key: 'mine', label: '我的来源', rows: rows.filter((e) => !e.builtin) },
    ].filter((g) => g.rows.length)

    const nodes = []
    for (const group of groups) {
      nodes.push(el('div', { class: 'group-head' },
        el('span', { text: group.label }),
        el('span', { class: 'n', text: String(group.rows.length) }),
      ))
      for (const e of group.rows) nodes.push(rowOf(e))
    }
    host.replaceChildren(...nodes)
  }

  /** rowOf 画一行条目；状态只用「未启用 / 已启用 / 拒绝」三种胶囊，不再叠「内置」。 */
  function rowOf(e) {
    const kind = KINDS[e.kind] || { label: e.kind }
    const badge = e.status === 'rejected'
      ? el('span', { class: 'badge reject', text: '拒绝' })
      : !e.injectable ? null
        : isEnabled(e.id) ? null : el('span', { class: 'badge off', text: '未启用' })
    return el('button', {
      type: 'button',
      class: 'row',
      role: 'option',
      'aria-selected': selected === e.id,
      onclick: () => { selected = selected === e.id ? '' : e.id; render() },
    },
      el('span', { class: 'spine', style: `--spine:var(--kind-${kindClass(e.kind)})` }),
      el('span', {},
        el('span', { class: 'title' }, e.name, badge || null),
        el('span', { class: 'meta', text: `${kind.label} · ${e.builtin ? '随插件' : e.source?.rel ?? ''}` }),
      ),
      el('span', { class: 'side' }, e.version > 1 ? `v${e.version} ` : '',
        el('span', { class: 'meta', text: e.injectable ? `${e.chars || 0} 字` : fmtSize(e.size || 0) })),
    )
  }

  /**
   * renderAssembly 是右栏默认内容：把「这次会拼成什么」按顺序摊开。
   *
   * 为什么值得占这一整栏：这个插件的产物就是一段被拼起来的 system 文本，
   * 但它平时在请求里，用户看不见。摊开成积木（人设 → 技能 → 宿主原文），
   * 一眼能看出顺序对不对、谁没启用、总量吃不吃得下预算。
   */
  function renderAssembly() {
    const host = $('assembly')
    const plan = catalog?.plan
    const last = catalog?.last
    if (!plan) {
      host.replaceChildren(el('h2', {}, '注入组装'))
      host.append(el('p', { class: 'empty', text: '还没有判定：等后端第一次扫描。' }))
      return
    }
    const personaEntry = findEntry(plan.personaId)
    const skills = (plan.skills || []).map((s) => findEntry(s.id) || s)
    const total = (personaEntry?.chars || 0) + skills.reduce((n, s) => n + (s.chars || 0), 0)

    const rows = []
    if (plan.ready && personaEntry) {
      rows.push(stackRow('01', 'persona', personaEntry.name, personaEntry.meta?.description || '人设正文', `${personaEntry.chars || 0} 字`))
      skills.forEach((s, i) => rows.push(stackRow(String(i + 2).padStart(2, '0'), 'skill', s.name, s.meta?.description || '技能正文', `${s.chars || 0} 字`)))
      rows.push(el('div', { class: 'stack-row is-host' },
        el('span', { class: 'ord', text: String(skills.length + 2).padStart(2, '0') }),
        el('span', { class: 'body' },
          el('span', { class: 'name', text: '宿主自己的 system' }),
          el('span', { class: 'desc', text: plan.mode === 'strict' ? 'strict：整段换掉，不会保留' : '原样保留，接在上面这些之后' }),
        ),
        el('span', { class: 'size', text: plan.mode === 'strict' ? '—' : '保留' }),
      ))
    } else {
      rows.push(el('div', { class: 'stack-row is-empty' },
        el('span', { class: 'ord', text: '—' }),
        el('span', { class: 'body' },
          el('span', { class: 'name', text: '还没有可组装的内容' }),
          // 具体原因在顶部状态条里已经说过一遍，这里只说「这里将来会显示什么」，不重复。
          el('span', { class: 'desc', text: '按上面的提示处理后，这段会显示人设与技能的拼装顺序' }),
        ),
        el('span', { class: 'size', text: '' }),
      ))
    }

    host.replaceChildren(...[
      el('h2', {}, '注入组装',
        el('span', { class: 'h2-sub', text: plan.ready ? '下一次请求会拼成这段' : '这次放行，下面是原因' })),
      el('div', { class: 'stack-view' }, ...rows),
      el('div', { class: 'stack-foot' },
        el('span', { text: plan.ready ? `合计 ${total.toLocaleString('zh-CN')} 字符 · 预算 65,536` : `模式 ${plan.mode}` }),
        last?.at ? el('span', { text: last.skipped ? `上次 ${fmtTime(last.at)} · 未注入` : `上次 ${fmtTime(last.at)} · ${last.agent || '—'}` }) : null,
      ),
      renderExpertPicker(),
    ].filter(Boolean))
  }

  /**
   * renderExpertPicker 是「一键启用专家」：这里是每天重复最多的动作。
   * 不用逐条点开再点启用——九个专家的开关摊在同一行，点一下就切。
   * 只列技能：人设是「谁来写」，走另一条路（详情里的「设为当前人设」）。
   */
  function renderExpertPicker() {
    const skills = entries().filter((e) => e.injectable && e.kind === 'skill' && e.builtin)
    const mine = entries().filter((e) => e.injectable && e.kind === 'skill' && !e.builtin)
    const all = [...skills, ...mine]
    if (!all.length) return null
    const chip = (e) => {
      const on = isEnabled(e.id)
      return el('button', {
        type: 'button',
        class: `pick${on ? ' is-on' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        title: on ? `停用「${e.name}」` : `启用「${e.name}」`,
        onclick: () => save({ enabled: { ...(options.enabled || {}), [e.id]: !on } }, on ? `已停用「${e.name}」` : `已启用「${e.name}」`),
      }, on ? '✓ ' : '', e.name)
    }
    return el('section', { class: 'picker', 'aria-label': '启用专家' },
      el('h3', {}, '启用的专家',
        el('span', { class: 'h2-sub', text: '点一下即生效，不必逐条打开' })),
      el('div', { class: 'picks' }, ...all.map(chip)),
    )
  }

  /** stackRow 是组装里的一层：序号 + 名字 + 一句描述 + 体积。 */
  function stackRow(ord, cls, name, desc, size) {
    return el('div', { class: `stack-row is-${cls}` },
      el('span', { class: 'ord', text: ord }),
      el('span', { class: 'body' },
        el('span', { class: 'name', text: name }),
        el('span', { class: 'desc', text: desc }),
      ),
      el('span', { class: 'size', text: size }),
    )
  }

  function renderInspector() {
    const host = $('inspect')
    const e = findEntry(selected)
    if (!e) {
      // 没选中时让位给「组装预览」：右栏不留一片空白，那是最浪费的一屏。
      host.replaceChildren()
      return
    }
    const kind = KINDS[e.kind] || { label: e.kind }
    const kindCls = kindClass(e.kind)
    const inline = e.source?.root === 'inline' || e.meta?.format === 'inline'
    // 只有复制进插件自己的 state/imports 的副本才谈得上「删副本」：来源目录里的原件不动。
    const imported = Boolean(e.source?.root && /[\\/]state[\\/]imports\/?$/.test(e.source.root))
    const enabled = isEnabled(e.id)
    const pinned = options.pinned?.[e.id]
    const history = Array.isArray(e.history) ? e.history : []
    const text = inline ? String(e.text || '') : ''

    const actions = []
    // 人设才有「设为当前人设」；技能是「启用/停用」。混着写会让人以为技能能当人设用。
    if (e.injectable && e.kind === 'persona') {
      actions.push(el('button', {
        type: 'button',
        class: options.persona === e.id ? 'primary' : '',
        onclick: () => save({ persona: e.id }, `已把「${e.name}」设为当前人设`),
      }, options.persona === e.id ? '当前人设' : '设为当前人设'))
    }
    if (e.injectable) {
      actions.push(el('button', {
        type: 'button',
        onclick: () => save({ enabled: { ...(options.enabled || {}), [e.id]: !enabled } }, enabled ? `已停用「${e.name}」` : `已启用「${e.name}」`),
      }, enabled ? '停用' : '启用'))
    }
    if (pinned) {
      actions.push(el('button', {
        type: 'button',
        class: 'quiet',
        onclick: () => {
          const next = { ...(options.pinned || {}) }
          delete next[e.id]
          save({ pinned: next }, '已回到最新版本')
        },
      }, '取消版本固定'))
    }
    if (inline) {
      actions.push(el('button', {
        type: 'button',
        class: 'danger',
        onclick: () => {
          const kept = inlineEntries().filter((x) => x.id !== e.id)
          const enabledNext = { ...(options.enabled || {}) }
          delete enabledNext[e.id]
          save({ inline: kept, enabled: enabledNext, persona: options.persona === e.id ? '' : options.persona }, '已从页面导入里删掉')
          if (selected === e.id) selected = ''
        },
      }, '删除'))
    } else if (imported) {
      actions.push(el('button', {
        type: 'button',
        class: 'danger',
        onclick: () => importRequest({ op: 'delete', path: e.source.rel }, `已请求删除「${e.name}」的副本（只删插件自己的 state/imports）`),
      }, '删除副本'))
    }

    const versionPicker = history.length
      ? el('label', { class: 'note' },
        '回滚到：',
        el('select', {
          onchange: (ev) => {
            const digest = ev.target.value
            const next = { ...(options.pinned || {}) }
            if (digest) next[e.id] = digest
            else delete next[e.id]
            save({ pinned: next }, digest ? '已固定到旧版本' : '已回到最新版本')
          },
        },
          el('option', { value: '', selected: !pinned }, `最新 v${e.version ?? 1}`),
          ...history.map((h) => el('option', { value: h.digest, selected: pinned === h.digest }, `v${h.version ?? '?'} · ${fmtTime(h.at)}`)),
        ),
      )
      : null

    // replaceChildren 会把 null 变成 "null" 字符串，所以先过滤。
    host.replaceChildren(...[
      el('div', {},
        el('h2', {}, e.name, el('span', { class: `kind ${kindCls}` }, kind.label)),
        el('p', { class: 'sub-note', text: e.meta?.description || (e.injectable ? '可写进 system 段的人设/技能文本。' : NOT_INJECTABLE) }),
      ),
      // 内置专家：说清它是随包来的，不是用户导入的，所以没有「删除」只有「停用」。
      // 「何时用」与「提炼自」分两行：一行里塞两件事读起来像免责声明。
      e.builtin && e.meta?.whenToUse
        ? el('p', { class: 'sub-note', text: `何时用：${e.meta.whenToUse}` })
        : null,
      e.builtin && e.meta?.source
        ? el('p', { class: 'sub-note', text: `提炼自 ${e.meta.source}` })
        : null,
      el('dl', { class: 'facts' },
        el('dt', { text: '来源' }), el('dd', { text: e.source?.root === 'inline' ? '页面导入（存在 options 里）' : e.builtin ? `插件内置 ${builtinFolder(e)}/` : e.source?.root || '—' }),
        el('dt', { text: '路径' }), el('dd', {}, el('code', { text: e.source?.rel || '—' })),
        el('dt', { text: '大小' }), el('dd', { text: e.injectable ? `${e.chars || 0} 字符（上限 64 KB）` : fmtSize(e.size || 0) }),
        el('dt', { text: '摘要' }), el('dd', {}, el('code', { text: short(e.digest) })),
        el('dt', { text: '版本' }), el('dd', { text: `v${e.version ?? 1}${history.length ? ` · 保留 ${history.length} 个旧版` : ''}` }),
        el('dt', { text: '导入于' }), el('dd', { text: e.builtin ? '随插件' : fmtTime(e.importedAt) }),
        e.meta?.sessions !== undefined ? el('dt', { text: '会话数' }) : null,
        e.meta?.sessions !== undefined ? el('dd', { text: String(e.meta.sessions) }) : null,
        e.meta?.turns !== undefined ? el('dt', { text: '选定轮次' }) : null,
        e.meta?.turns !== undefined ? el('dd', { text: String(e.meta.turns) }) : null,
      ),
      e.injectable
        ? el('div', { class: 'budget' },
          el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${Math.min(100, Math.round((e.chars || 0) / 65536 * 100))}%` })),
          el('div', { class: 'label', text: `${(e.chars || 0).toLocaleString('zh-CN')} / 65,536 字符会进入 system` }),
        )
        : null,
      el('div', { class: 'actions' }, ...actions),
      versionPicker,
      pinned ? el('p', { class: 'note', text: `当前固定到 ${short(pinned)}：网关用那一版的正文，不是最新的。` }) : null,
      inline && text ? el('pre', { class: 'text', text: text.slice(0, 3200) + (text.length > 3200 ? '\n…' : '') }) : null,
    ].filter(Boolean))
  }

  function renderRejects() {
    const host = $('rejects')
    const rows = Array.isArray(catalog?.rejected) ? catalog.rejected : []
    const badge = $('rejects-count')
    if (badge) badge.textContent = rows.length ? `${rows.length}` : ''
    if (!rows.length) {
      const n = entries().length
      host.replaceChildren(el('li', {
        text: n
          ? '没有拒绝项：来源目录里每个文件都认得出来。'
          : '还没有扫描结果。先确认来源目录里放了东西，再点右上角「重新扫描」。',
      }))
      return
    }
    host.replaceChildren(...rows.slice(0, 24).map((r) => el('li', {}, el('strong', { text: r.name }), `：${r.reason}`)))
  }

  function renderLast() {
    const host = $('last')
    const last = catalog?.last
    if (!last) {
      host.replaceChildren(el('p', { class: 'note', text: '还没有请求经过网关。改完模式后，下一次 agent 请求会写下这一行。' }))
      return
    }
    if (last.skipped) {
      // 放行了也要说清为什么：只显示「没注入」等于什么也没说
      host.replaceChildren(
        el('p', { class: 'note', text: `${fmtTime(last.at)} · ${last.agent || '未知 agent'} · ${last.protocol || '—'}` }),
        el('p', { class: 'warn', text: `这次没有注入：${last.skipped}` }),
      )
      return
    }
    host.replaceChildren(
      el('p', { class: 'note', text: `${fmtTime(last.at)} · ${last.agent || '未知 agent'} · ${last.protocol} · ${last.mode}` }),
      el('p', { class: 'note', text: `人设 ${last.persona || '（无）'} · 技能 ${(last.skills || []).length} 条 · 注入 ${last.chars} 字符` }),
      ...(last.missingPin?.length ? [el('p', { class: 'warn', text: `固定的版本不在当前表里：${last.missingPin.join('、')}` })] : []),
    )
  }

  function render() {
    if (!catalog) {
      $('count').textContent = '没有快照'
    } else {
      const shown = visible().length
      $('count').textContent = `${shown} / ${entries().length + inlineEntries().length} 条 · 快照 v${catalog.version} · ${fmtTime(catalog.generatedAt)}`
    }
    $('mode').value = MODES().includes(options.mode) ? options.mode : ''
    $('mode-help').textContent = modeHelp($('mode').value)
    renderPlan()
    renderFilters()
    renderList()
    // 选着条目就看详情，没选就回组装预览：右栏永远有东西，不留空屏。
    renderAssembly()
    renderInspector()
    const picked = Boolean(findEntry(selected))
    $('assembly').hidden = picked
    $('inspect').hidden = !picked
    renderRejects()
    renderLast()
    renderSources()
  }

  /** MODES 是模式下拉的全部取值：空串 = 跟随 agent-purge。 */
  const MODES = () => ['', 'off', 'strict', 'replace', 'append']

  /** modeHelp 说清当前值到底意味着什么，尤其是「跟随 agent-purge」时用的是它的什么值。 */
  function modeHelp(value) {
    if (value) return MODE_HELP[value] || ''
    const p = catalog?.purge
    if (!p?.bound) return '没装 agent-purge 或读不到它的 state.json：等价于 off，不会改请求。'
    if (p.error) return `agent-purge 的 state.json 有问题：${p.error}；等价于 off。`
    return `跟随 agent-purge：当前 ${p.mode || '未设置'}${p.persona ? ` · 人设 ${p.persona}` : ''}`
  }

  /**
   * renderPlan 是「现在到底注不注、注谁、为什么没注」那一行。
   * 判定由后端算好放在快照的 plan 里（页面不能读 agent-purge 的 state.json）。
   */
  function renderPlan() {
    const host = $('plan')
    const plan = catalog?.plan
    if (!plan) {
      host.dataset.state = 'idle'
      host.replaceChildren(
        el('span', { class: 'dot' }),
        el('span', { class: 'empty', text: '还没有判定：等后端第一次扫描' }),
      )
      return
    }
    const ready = Boolean(plan.ready)
    const fromText = { page: '本页设置', 'agent-purge': 'agent-purge', auto: '自动（第一个启用的人设）', default: '默认' }
    host.dataset.state = ready ? 'ready' : 'blocked'

    // 没就绪时给一个能点的下一步：光说「不会注入」等于把问题丢回给人。
    // 每个按钮都顺带 refreshAt：宿主重建插件进程后按新设置重扫，plan 才会跟着变。
    const fix = []
    const fixed = (patch, note) => {
      save({ ...patch, refreshAt: Date.now() }, note)
      pollSnapshot('等后端按新设置重扫…', 25)
    }
    if (!ready) {
      if (plan.blockedCode === 'no-mode' || plan.blockedCode === 'mode-off') {
        fix.push(el('button', { type: 'button', class: 'primary', onclick: () => fixed({ mode: 'replace' }, '模式改为 replace') }, '用 replace 开始注入'))
      }
      if (plan.blockedCode === 'no-persona' || plan.blockedCode === 'persona-missing') {
        fix.push(el('button', {
          type: 'button',
          class: 'primary',
          onclick: () => { filter = 'persona'; query = ''; render() },
        }, '去看人设'))
      }
      if (plan.blockedCode === 'no-persona-file') {
        fix.push(el('button', {
          type: 'button',
          class: 'primary',
          onclick: () => { $('import-file')?.focus(); $('import-file')?.click?.() },
        }, '导入一份人设'))
      }
    }

    const rows = [
      el('span', { class: 'dot' }),
      el('span', { class: ready ? 'who' : 'who is-empty' }, ready
        ? `下一次 agent 请求会注入「${plan.personaName || plan.personaId}」`
        : '现在不会注入：请求原样放行'),
      el('span', { class: 'actions' },
        el('span', { class: 'tag', text: `模式 ${plan.mode} · ${fromText[plan.modeFrom] || plan.modeFrom || '默认'}` }),
        ready && plan.skills?.length ? el('span', { class: 'tag', text: `技能 ${plan.skills.length} 条` }) : null,
        ...fix,
        el('button', { type: 'button', class: 'quiet', onclick: () => refresh() }, '重扫确认'),
      ),
      el('span', { class: 'why', text: ready
        ? `人设来源：${fromText[plan.personaFrom] || plan.personaFrom}${catalog?.purge?.bound ? '；agent-purge 的 state.json 已读到' : '；没读到 agent-purge 的 state.json'}`
        : `${plan.blocked}${catalog?.purge?.bound ? '' : '（没读到 agent-purge 的 state.json）'}` }),
    ]
    host.replaceChildren(...rows.filter(Boolean))
  }

  function renderSources() {
    const el2 = $('sources')
    if (!el2 || document.activeElement === el2) return
    const list = Array.isArray(options.sources) && options.sources.length
      ? options.sources
      : (catalog?.sources || []).filter((s) => s.path && !/[\\/]state[\\/]imports\/?$/.test(s.path)).map((s) => s.path)
    el2.value = list.join('\n')
  }

  // ---------- 动作 ----------

  function importRequest(req, note) {
    const imports = Array.isArray(options.imports) ? options.imports.slice(-19) : []
    imports.push({ ...req, at: Date.now() })
    save({ imports, refreshAt: Date.now() }, note)
    pollSnapshot(`等待后端处理：${req.path}`, 25)
  }

  /** pollSnapshot 每隔 1.2 秒重新加载 catalog.js（加时间戳绕缓存），版本变了就重画。 */
  function pollSnapshot(reason, seconds = 12) {
    const before = catalog?.version ?? 0
    const until = Date.now() + seconds * 1000
    say(reason)
    const tick = () => {
      const script = document.createElement('script')
      script.src = `catalog.js?t=${Date.now()}`
      script.onload = () => {
        script.remove()
        const next = window.PURGE_CATALOG
        if (next && next.version !== before) {
          catalog = next
          render()
          say('快照已更新', 'good')
          return
        }
        if (Date.now() < until) setTimeout(tick, 1200)
        else say('后端还没写出新快照：magpie 里插件可能没重启，或来源目录没权限。', 'bad')
      }
      script.onerror = () => {
        script.remove()
        if (Date.now() < until) setTimeout(tick, 1200)
      }
      document.head.append(script)
    }
    setTimeout(tick, 900)
  }

  async function refresh() {
    if (busy) return
    busy = true
    $('refresh').disabled = true
    try {
      save({ refreshAt: Date.now() })
      await flush()
      pollSnapshot('正在让后端重新扫描…', 25)
    } finally {
      busy = false
      $('refresh').disabled = false
    }
  }

  function wire() {
    $('mode').addEventListener('change', (e) => {
      const value = e.target.value
      save({ mode: value }, value ? `模式改为 ${value}` : '改为跟随 agent-purge')
    })
    $('refresh').addEventListener('click', refresh)
    $('q').addEventListener('input', (e) => { query = e.target.value; render() })

    $('import-run').addEventListener('click', () => {
      const path = $('import-path').value.trim()
      if (!path) return say('先填一个文件路径', 'bad')
      importRequest({ op: 'import', path }, '已请求导入')
      $('import-path').value = ''
    })

    $('import-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const raw = await file.text()
        if (raw.length > 64 * 1024) throw new Error('超过 64 KB：这么大的正文不该塞进 options')
        const id = (file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'inline').slice(0, 48)
        const kept = inlineEntries().filter((x) => x.id !== id)
        const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const name = fm?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, '') || file.name.replace(/\.[^.]+$/, '')
        save({ inline: [...kept, { id, name, kind: 'persona', text: body }] }, `已把「${name}」存进 options`)
        e.target.value = ''
      } catch (error) {
        say(`导入失败：${error?.message || error}`, 'bad')
      }
    })

    const sources = $('sources-save')
    sources?.addEventListener('click', () => {
      const list = $('sources').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      save({ sources: list, refreshAt: Date.now() }, '来源目录已保存')
      pollSnapshot('等待后端按新来源扫描…', 25)
    })
  }

  async function boot() {
    if (bridge?.ready?.then) {
      try {
        await Promise.race([bridge.ready, new Promise((r) => setTimeout(r, 1500))])
      } catch {
        /* 宿主没答也要能画 */
      }
    }
    if (bridge?.onVisibility) bridge.onVisibility((visible) => { if (visible && !busy) refreshFromDisk() })
    try {
      options = (await bridge?.options?.get?.()) || {}
    } catch (error) {
      say(`读不到 options：${error?.message || error}`, 'bad')
      options = {}
    }
    wire()
    render()
    if (!catalog) pollSnapshot('还没有快照，等后端第一次扫描…', 20)
  }

  /** 页面被切回来时顺手换一份快照：宿主可能在背后扫过一次。 */
  function refreshFromDisk() {
    const script = document.createElement('script')
    script.src = `catalog.js?t=${Date.now()}`
    script.onload = () => {
      script.remove()
      const next = window.PURGE_CATALOG
      if (next && next.version !== catalog?.version) {
        catalog = next
        render()
      }
    }
    script.onerror = () => script.remove()
    document.head.append(script)
  }

  boot()
})()