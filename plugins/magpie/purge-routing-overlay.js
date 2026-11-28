// Purge 原生路由增量叠加层：非侵入式挂载于 Magpie 原版「模型 → 路由」(#rt) 之上，
// 与设计原型完全对齐：悬浮 PURGE 胶囊、双击液态分裂、靠近磁吸合并、4 套皮肤（默认奶小蛙）吃豆人吞噬、
// 发光包裹外壳（扫光+咬合闪光）、脉冲寄生连线、待命历史 Agent 块与 404px 右键菜单，
// 并直接通过 Magpie API 读写 magpie-purge 插件的 options.routing。
;(() => {
  'use strict';
  if (window.__FISH_PURGE_ROUTING_OVERLAY__) return;
  window.__FISH_PURGE_ROUTING_OVERLAY__ = true;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DRAG_THRESHOLD = 5;
  const MERGE_ATTRACT_DIST = 110;
  const MERGE_LOCK_DIST = 72;
  const PACMAN_LOCK_GAP = 78;
  const PEEL_THRESHOLD = 20;
  const MAX_CAPSULES = 8;

  const GENERIC_AGENT_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <rect x="4" y="5" width="16" height="14" rx="4" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.7"/>
    <polyline points="8.5 9.5 11.5 12 8.5 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="13" y1="14.5" x2="16.5" y2="14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;

  const MAGPIE_PALETTE = ['#d97757', '#bd8638', '#a59234', '#849e4a', '#5aa66c', '#25a98f', '#00a6b0', '#2e9fc9', '#5e95d7', '#858ad7', '#a47fca', '#bb77b1'];
  const MAGPIE_HUES = {
    claude: 0, codex: 9, gemini: 7, copilot: 10, cursor: 5, opencode: 2, crush: 11, goose: 3, pi: 4, omp: 11, omo: 10, dsh: 6,
    commandcode: 1, mimocode: 8, deveco: 7,
  };

  const AGENT_ALIASES = {
    claude: ['claude', 'claude-code', 'claudecode', 'claude code'],
    codex: ['codex', 'openai-codex', 'codex-cli'],
    opencode: ['opencode', 'open-code', 'open code'],
    dsh: ['dsh', 'deepseek-harness', 'deepseek harness'],
    zcode: ['zcode', 'z-code', 'z code'],
    'obsidian-memory': ['obsidian-memory', 'obsidian', 'obsidian 记忆 agent'],
    gemini: ['gemini', 'gemini-cli', 'gemini cli'],
    agy: ['agy', 'antigravity-cli', 'antigravity cli'],
    antigravity: ['antigravity'],
    cursor: ['cursor'],
    cline: ['cline'],
    workbuddy: ['workbuddy', 'workbuddy-ai'],
    qoder: ['qoder', 'qoder-cn'],
  };

  const BASELINE_AGENTS = [
    {
      id: 'claude',
      name: 'Claude Code',
      aliases: AGENT_ALIASES.claude,
      route: 'group/deepseek',
      color: '#ea8c55',
      icon: 'claudecode-color',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="5" y="7" width="14" height="10" rx="2.5" fill="#e67e45"/>
        <rect x="3" y="10" width="2" height="5" rx="1" fill="#e67e45"/>
        <rect x="19" y="10" width="2" height="5" rx="1" fill="#e67e45"/>
        <rect x="7.5" y="17" width="2.2" height="3" rx="0.8" fill="#e67e45"/>
        <rect x="14.3" y="17" width="2.2" height="3" rx="0.8" fill="#e67e45"/>
        <rect x="8.2" y="10" width="2.2" height="2.6" rx="0.6" fill="#211612"/>
        <rect x="13.6" y="10" width="2.2" height="2.6" rx="0.6" fill="#211612"/>
      </svg>`,
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      aliases: AGENT_ALIASES.opencode,
      route: 'group/deepseek',
      color: '#60a5fa',
      icon: 'opencode',
      iconSvg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="8.5" stroke="#60a5fa" stroke-width="1.8" fill="#3b82f6" fill-opacity="0.18"/>
        <path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5" stroke="#bfdbfe" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
    },
    {
      id: 'dsh',
      name: 'DeepSeek Harness',
      aliases: AGENT_ALIASES.dsh,
      route: 'group/deepseek',
      color: '#00a6b0',
      icon: 'deepseek-color',
      iconSvg: GENERIC_AGENT_SVG,
    },
    {
      id: 'zcode',
      name: 'ZCode',
      aliases: AGENT_ALIASES.zcode,
      route: '',
      color: '#5aa66c',
      icon: 'zcode',
      iconSvg: GENERIC_AGENT_SVG,
    },
    {
      id: 'obsidian-memory',
      name: 'Obsidian 记忆 Agent',
      aliases: AGENT_ALIASES['obsidian-memory'],
      route: 'group/deepseek',
      color: '#a78bfa',
      icon: 'obsidian',
      iconSvg: GENERIC_AGENT_SVG,
    },
    {
      id: 'codex',
      name: 'Codex',
      aliases: AGENT_ALIASES.codex,
      route: 'group/deepseek',
      color: '#34d399',
      icon: 'codex-color',
      iconSvg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="4" fill="#10b981" fill-opacity="0.22" stroke="#34d399" stroke-width="1.8"/>
        <polyline points="8 9 11.5 12 8 15" stroke="#6ee7b7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="13" y1="15" x2="17" y2="15" stroke="#6ee7b7" stroke-width="2" stroke-linecap="round"/>
      </svg>`,
    },
    {
      id: 'cursor',
      name: 'Cursor',
      aliases: AGENT_ALIASES.cursor,
      route: 'group/claude-code',
      color: '#a78bfa',
      icon: 'cursor',
      iconSvg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <polygon points="12 3 20 8 20 16 12 21 4 16 4 8" fill="#8b5cf6" fill-opacity="0.22" stroke="#a78bfa" stroke-width="1.8"/>
        <polygon points="10.5 8 16.5 13 12.2 13.8 10.5 17.5" fill="#ede9fe"/>
      </svg>`,
    },
    {
      id: 'cline',
      name: 'Cline',
      aliases: AGENT_ALIASES.cline,
      route: 'deepseek-v4.1-flash',
      color: '#fbbf24',
      icon: 'cline',
      iconSvg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="6" width="16" height="12" rx="5" fill="#f59e0b" fill-opacity="0.20" stroke="#fbbf24" stroke-width="1.8"/>
        <circle cx="9.5" cy="12" r="1.4" fill="#fde68a"/>
        <circle cx="14.5" cy="12" r="1.4" fill="#fde68a"/>
      </svg>`,
    },
  ];

  const SKIN_PALETTES = {
    fish: {
      name: '奶小蛙',
      bodyFill: '#fee33e',
      bodyStroke: '#d9a404',
      aura: 'rgba(254, 227, 62, 0.24)',
      bridgeFill: '#facc15',
      pelletFill: '#fef08a',
      pelletStroke: '#ca8a04',
      ripple: '#fee33e',
      particle: '#fef08a',
      pktGlow: 'rgba(254, 227, 62, 0.88)',
      curtainFill: 'rgba(254, 227, 62, 0.16)',
      curtainStroke: '#fee33e',
      morphFillRgb: '254, 227, 62',
    },
    crimson: {
      name: '绯红',
      bodyFill: '#f4284e',
      bodyStroke: '#ff9eb2',
      aura: 'rgba(255, 59, 92, 0.20)',
      bridgeFill: '#f4284e',
      pelletFill: '#ffd1dc',
      pelletStroke: '#ff4d6d',
      ripple: '#ff4d6d',
      particle: '#ff859d',
      pktGlow: 'rgba(255, 59, 92, 0.88)',
      curtainFill: 'rgba(244, 40, 78, 0.16)',
      curtainStroke: '#ff4d6d',
      morphFillRgb: '244, 40, 78',
    },
    classic: {
      name: '经典',
      bodyFill: '#ffda29',
      bodyStroke: '#d97706',
      aura: 'rgba(255, 218, 41, 0.22)',
      bridgeFill: '#f59e0b',
      pelletFill: '#fef3c7',
      pelletStroke: '#d97706',
      ripple: '#ffda29',
      particle: '#fde68a',
      pktGlow: 'rgba(251, 191, 36, 0.88)',
      curtainFill: 'rgba(245, 158, 11, 0.16)',
      curtainStroke: '#fbbf24',
      morphFillRgb: '255, 218, 41',
    },
    cyber: {
      name: '赛博',
      bodyFill: '#22d3ee',
      bodyStroke: '#a5f3fc',
      aura: 'rgba(34, 211, 238, 0.22)',
      bridgeFill: '#06b6d4',
      pelletFill: '#cffafe',
      pelletStroke: '#22d3ee',
      ripple: '#22d3ee',
      particle: '#67e8f9',
      pktGlow: 'rgba(34, 211, 238, 0.88)',
      curtainFill: 'rgba(6, 182, 212, 0.16)',
      curtainStroke: '#38bdf8',
      morphFillRgb: '34, 211, 238',
    },
  };

  const state = {
    enabled: false,
    pluginSpec: '',
    pluginOptions: {},
    skin: 'fish',
    active: false,
    hubInject: false,
    wrappedAgents: [],
    standbyAgents: [],
    wrappedTargets: [],
    capsules: [],
    nextCapsuleSeq: 1,
    shells: new Map(), // shellKey -> { shellKey, el, kind, targetId, shellEl, targetMeta }
    swallowingKeys: new Set(),
    drag: null,
    lastCapTap: { id: null, time: 0, x: 0, y: 0 },
    lastShellTap: { key: null, time: 0 },
    loadingPlugins: false,
    saving: false,
    pendingSync: false,
    lastTurnSig: '',
    didAutoActivate: false,
    animatingStandbyIds: new Set(),
    magpieAgents: [],
    magpieAgentOrder: [],
    magpieStateLoaded: false,
    magpieWiredSig: '',
  };

  const dom = {
    rt: null,
    stage: null,
    srcs: null,
    hub: null,
    list: null,
    wiresSvg: null,
    fxSvg: null,
    layer: null,
    ctxMenu: null,
    ro: null,
    viewObs: null,
    stageObs: null,
    navHooked: false,
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function getSkinPalette() {
    return SKIN_PALETTES[state.skin] || SKIN_PALETTES.fish;
  }

  function isPurgeSpec(spec) {
    return /@fish-under-sea\/magpie-purge(?:@|$)|(^|[\\/])magpie-purge(?:[@#\\/]|$)/i.test(String(spec || ''));
  }

  function magpieHueColor(id) {
    const key = String(id || '').trim().toLowerCase();
    let h = MAGPIE_HUES[key];
    if (h == null) {
      h = 0;
      for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    }
    return MAGPIE_PALETTE[h % MAGPIE_PALETTE.length];
  }

  function agentKeys(raw, extraAgents = state.magpieAgents) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return [];
    const compact = s.replace(/[\s_]+/g, '-');
    const squashed = s.replace(/[\s_-]+/g, '');
    const set = new Set([s, compact, squashed]);
    for (const [id, aliases] of Object.entries(AGENT_ALIASES)) {
      if (id === s || id === compact || aliases.includes(s) || aliases.includes(compact)) {
        set.add(id);
        for (const al of aliases) set.add(al);
      }
    }
    if (Array.isArray(extraAgents)) {
      for (const a of extraAgents) {
        if (!a || typeof a !== 'object') continue;
        const aid = String(a.id || '').trim().toLowerCase();
        const aname = String(a.name || '').trim().toLowerCase();
        const nameCompact = aname.replace(/[\s_]+/g, '-');
        if (aid === s || aid === compact || (aname && (aname === s || nameCompact === compact))) {
          if (aid) set.add(aid);
          if (aname) {
            set.add(aname);
            set.add(nameCompact);
          }
        }
      }
    }
    return [...set];
  }

  function sameAgent(a, b) {
    const ka = agentKeys(a);
    if (!ka.length) return false;
    const kb = new Set(agentKeys(b));
    return ka.some((k) => kb.has(k));
  }

  function canonicalAgentId(raw, extraAgents = state.magpieAgents) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (Array.isArray(extraAgents)) {
      const keys = agentKeys(s, extraAgents);
      const hit = extraAgents.find((a) => a && keys.some((k) => String(a.id || '').trim().toLowerCase() === k));
      if (hit?.id) return String(hit.id).trim().toLowerCase();
    }
    for (const id of Object.keys(AGENT_ALIASES)) {
      if (sameAgent(id, s)) return id;
    }
    return s.toLowerCase();
  }

  function extractAgentRoute(agentObj) {
    if (!agentObj || typeof agentObj !== 'object') return '';
    const fields = Array.isArray(agentObj.fields) ? agentObj.fields : [];
    const modelField = fields.find((f) => f && (f.key === 'model' || f.key === 'default') && String(f.value || '').trim());
    const rawVal = String(modelField?.value || '').trim();
    if (rawVal) {
      return stripEffortAndAlias(rawVal.replace(/^magpie\//i, ''));
    }
    const firstModel = Array.isArray(agentObj.models?.names) ? String(agentObj.models.names[0] || '').trim() : '';
    return firstModel;
  }

  function getStandbyMeta(idOrName) {
    const cid = canonicalAgentId(idOrName);
    const liveAg = state.magpieAgents.find((a) => a && sameAgent(a.id, cid || idOrName));
    const base = BASELINE_AGENTS.find((a) => a.id === cid || sameAgent(a.id, idOrName)) || null;
    if (liveAg) {
      const id = canonicalAgentId(liveAg.id) || cid;
      return {
        id,
        name: String(liveAg.name || base?.name || id),
        icon: String(liveAg.icon || base?.icon || ''),
        iconSvg: base?.iconSvg || GENERIC_AGENT_SVG,
        route: extractAgentRoute(liveAg) || base?.route || '已接入 magpie',
        color: base?.color || magpieHueColor(id),
      };
    }
    if (base) return base;
    if (!cid) return null;
    return {
      id: cid,
      name: String(idOrName || cid),
      icon: '',
      iconSvg: GENERIC_AGENT_SVG,
      route: 'group/default',
      color: magpieHueColor(cid),
    };
  }

  function buildAgentCatalog(magpieAgents, agentOrder, visibleAgentsMap) {
    const order = Array.isArray(agentOrder) ? agentOrder : [];
    const rankOf = (a) => {
      const idx = order.indexOf(a?.id);
      return idx < 0 ? order.length : idx;
    };
    const wired = (Array.isArray(magpieAgents) ? magpieAgents : [])
      .filter((a) => a && a.wired === true)
      .map((a, idx) => ({ a, idx }))
      .sort((x, y) => rankOf(x.a) - rankOf(y.a) || x.idx - y.idx)
      .map((x) => x.a);

    const visible =
      visibleAgentsMap && typeof visibleAgentsMap.get === 'function' && typeof visibleAgentsMap.entries === 'function'
        ? visibleAgentsMap
        : new Map();
    const catalog = [];
    const seen = new Set();

    for (const a of wired) {
      const cid = canonicalAgentId(a.id, magpieAgents);
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const live = visible.get(cid) || [...visible.entries()].find(([k]) => sameAgent(k, cid))?.[1] || null;
      const base = BASELINE_AGENTS.find((b) => b.id === cid || sameAgent(b.id, cid));
      const route = live?.route || extractAgentRoute(a) || '';
      catalog.push({
        id: cid,
        name: String(live?.name || a.name || base?.name || cid),
        icon: String(a.icon || base?.icon || ''),
        iconSvg: base?.iconSvg || GENERIC_AGENT_SVG,
        route,
        color: base?.color || magpieHueColor(cid),
        wired: true,
        onStage: Boolean(live),
        standby: Boolean(live?.standby),
        el: live?.el || null,
      });
    }

    for (const [cid, live] of visible.entries()) {
      if (catalog.some((c) => sameAgent(c.id, cid))) continue;
      const meta = getStandbyMeta(cid);
      catalog.push({
        id: cid,
        name: live?.name || meta?.name || cid,
        icon: meta?.icon || '',
        iconSvg: meta?.iconSvg || GENERIC_AGENT_SVG,
        route: live?.route || meta?.route || '',
        color: meta?.color || magpieHueColor(cid),
        wired: Boolean(state.magpieAgents.some((a) => a && a.wired === true && sameAgent(a.id, cid))),
        onStage: true,
        standby: Boolean(live?.standby),
        el: live?.el || null,
      });
    }

    return catalog;
  }

  function isPlaceholderAgentName(name) {
    const s = String(name || '').trim().toLowerCase();
    return !s || s === 'your agent' || s === '你的 agent' || s === '你的agent';
  }

  function stripEffortAndAlias(model) {
    let s = String(model || '').trim();
    for (let i = 0; i < 4; i++) {
      const next = s
        .replace(/\s*\((?:minimal|low|medium|high|xhigh|max)\)\s*$/i, '')
        .replace(/\s*\[[^\]\s]{1,16}\]\s*$/, '')
        .trim();
      if (next === s) break;
      s = next;
    }
    return s;
  }

  function readUnmaskedText(el) {
    if (!el) return { text: '', maskedOpaque: false };
    let maskedOpaque = false;
    function walk(node) {
      if (!node) return '';
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1) return '';
      if (node.classList?.contains('pii')) {
        const raw = node.dataset?.raw;
        if (typeof raw === 'string' && raw.trim()) return raw;
        maskedOpaque = true;
        return '';
      }
      let out = '';
      for (const child of node.childNodes || []) out += walk(child);
      return out;
    }
    return { text: walk(el).trim(), maskedOpaque };
  }

  function isBrokenProviderTarget(t) {
    if (!t || typeof t !== 'object') return true;
    return !String(t.providerId || '').trim() && !String(t.providerName || '').trim() && !String(t.preset || '').trim();
  }

  function getProviderMetaFromEl(el) {
    return {
      groupId: String(el.dataset.purgeGroupId || '').trim(),
      providerId: String(el.dataset.purgeProviderId || '').trim(),
      providerName: String(el.dataset.purgeProviderName || '').trim(),
      preset: String(el.dataset.purgePreset || '').trim(),
      account: String(el.dataset.purgeAccount || '').trim(),
      model: stripEffortAndAlias(el.dataset.purgeModel || ''),
    };
  }

  function sameProviderTarget(a, b) {
    if (!a || !b) return false;
    if (a.groupId && b.groupId && a.groupId.toLowerCase() !== b.groupId.toLowerCase()) return false;
    const mA = stripEffortAndAlias(a.model).toLowerCase();
    const mB = stripEffortAndAlias(b.model).toLowerCase();
    if (mA && mB && mA !== mB) return false;
    const pidA = String(a.providerId || '').trim().toLowerCase();
    const pidB = String(b.providerId || '').trim().toLowerCase();
    const nameA = String(a.providerName || '').trim().toLowerCase();
    const nameB = String(b.providerName || '').trim().toLowerCase();
    const acctA = String(a.account || '').trim().toLowerCase();
    const acctB = String(b.account || '').trim().toLowerCase();

    if (pidA && pidB) {
      if (pidA !== pidB) return false;
    } else if (pidA || pidB) {
      if (!nameA || !nameB || nameA !== nameB) return false;
    } else if (nameA || nameB) {
      if (!nameA || !nameB || nameA !== nameB) return false;
    } else {
      if (!acctA || !acctB || acctA !== acctB) return false;
    }

    if (acctA && acctB && acctA !== acctB) return false;
    return Boolean(pidA || pidB || nameA || nameB || acctA);
  }

  async function magpieApi(path, body) {
    try {
      const fn = typeof window.api === 'function' ? window.api : typeof api === 'function' ? api : null;
      if (fn) return await fn(path, body);
    } catch (e) {
      if (body === undefined && /404|405/.test(String(e?.message || ''))) throw e;
      if (typeof window.api === 'function') throw e;
    }
    const init = body === undefined
      ? { credentials: 'same-origin' }
      : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
    const res = await fetch('/api/' + path, init);
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function refreshMagpieAgentsState() {
    try {
      const st = await magpieApi('state');
      if (!st || !Array.isArray(st.agents)) return false;
      const nextOrder = Array.isArray(st.settings?.agentOrder) ? st.settings.agentOrder.filter((x) => typeof x === 'string') : [];
      const sig = JSON.stringify({
        order: nextOrder,
        agents: st.agents
          .filter((a) => a && a.wired === true)
          .map((a) => [a.id, a.name, a.icon, extractAgentRoute(a)]),
      });
      const changed = sig !== state.magpieWiredSig || !state.magpieStateLoaded;
      state.magpieAgents = st.agents;
      state.magpieAgentOrder = nextOrder;
      state.magpieStateLoaded = true;
      state.magpieWiredSig = sig;
      return changed;
    } catch {
      return false;
    }
  }

  async function refreshPluginState() {
    if (state.loadingPlugins || state.saving) return;
    state.loadingPlugins = true;
    try {
      const agentsFetch = refreshMagpieAgentsState();
      let entry = null;
      try {
        const res = await magpieApi('plugins');
        const list = Array.isArray(res?.plugins) ? res.plugins : Array.isArray(res) ? res : [];
        entry = list.find((p) => p && isPurgeSpec(p.spec)) || null;
      } catch {
        entry = null;
      }

      if (!entry) {
        try {
          const pages = await magpieApi('plugin-pages');
          const p = Array.isArray(pages) ? pages.find((x) => x && isPurgeSpec(x.spec)) : null;
          if (p) {
            const optsRes = await magpieApi('plugin-pages/options', { spec: p.spec });
            const opts = optsRes?.options && typeof optsRes.options === 'object' ? optsRes.options : optsRes || {};
            entry = { spec: p.spec, off: false, options: opts };
          }
        } catch {}
      }

      await agentsFetch;

      if (!entry || entry.off === true) {
        disableOverlay();
        return;
      }

      state.enabled = true;
      state.pluginSpec = String(entry.spec || '');
      state.pluginOptions = entry.options && typeof entry.options === 'object' ? { ...entry.options } : {};
      const r = state.pluginOptions.routing && typeof state.pluginOptions.routing === 'object' ? state.pluginOptions.routing : {};
      const manualOff = r.manualOff === true;
      const needsActivate = !manualOff && r.active !== true;
      state.skin = SKIN_PALETTES[r.skin] ? r.skin : 'fish';
      state.active = !manualOff;
      state.hubInject = Boolean(r.hubInject);
      state.wrappedAgents = Array.isArray(r.agents) ? r.agents.filter((x) => typeof x === 'string' && x.trim()) : [];
      state.standbyAgents = Array.isArray(r.standbyAgents)
        ? [...new Set(r.standbyAgents.filter((x) => typeof x === 'string' && x.trim()).map(canonicalAgentId))]
        : [];
      state.wrappedTargets = Array.isArray(r.targets) ? r.targets.filter((x) => x && typeof x === 'object') : [];

      ensureMounted();
      syncAll();
      if (needsActivate && !state.didAutoActivate) {
        state.didAutoActivate = true;
        queueMicrotask(() => { void persistRoutingState(); });
      }
    } finally {
      state.loadingPlugins = false;
    }
  }

  async function persistRoutingState(calloutText = '') {
    if (!state.pluginSpec) return;
    state.active = true;

    const prevOpts = state.pluginOptions && typeof state.pluginOptions === 'object' ? state.pluginOptions : {};
    const prevRouting = prevOpts.routing && typeof prevOpts.routing === 'object' ? prevOpts.routing : {};
    const nextRouting = {
      ...prevRouting,
      active: true,
      manualOff: false,
      hubInject: state.hubInject,
      skin: state.skin,
      agents: [...state.wrappedAgents],
      standbyAgents: [...state.standbyAgents],
      targets: state.wrappedTargets.map((t) => ({ ...t })),
    };
    const nextOptions = { ...prevOpts, routing: nextRouting };
    state.pluginOptions = nextOptions;
    state.saving = true;

    try {
      try {
        await magpieApi('plugins/options', { spec: state.pluginSpec, options: nextOptions });
      } catch {
        await magpieApi('plugin-pages/options', { spec: state.pluginSpec, options: nextOptions });
      }
      if (calloutText && dom.hub && dom.rt) {
        const hb = rectRel(dom.hub, dom.rt);
        if (hb) spawnFloatingCallout(hb.cx, Math.max(24, hb.y - 12), calloutText);
      }
    } catch {
      // ignore network transient failure cleanly
    } finally {
      state.saving = false;
    }
  }

  function disableOverlay() {
    state.enabled = false;
    closeContextMenu();
    for (const rec of state.shells.values()) rec.shellEl?.remove();
    state.shells.clear();
    for (const cap of state.capsules) cap.el?.remove();
    state.capsules = [];
    if (dom.srcs) {
      dom.srcs.querySelectorAll('.purge-standby-agent').forEach((n) => n.remove());
    }
    if (dom.stage) {
      dom.stage.querySelectorAll('.rt-wires path[data-purge-standby-wire]').forEach((p) => p.remove());
    }
    if (dom.rt) {
      dom.rt.querySelectorAll('.purge-is-wrapped, .purge-hungry-target').forEach((el) => {
        el.classList.remove('purge-is-wrapped', 'purge-hungry-target');
      });
      dom.rt.querySelector('.purge-rt-stat')?.remove();
      dom.rt.classList.remove('purge-rt-host');
    }
    if (dom.wiresSvg) dom.wiresSvg.innerHTML = '';
    if (dom.fxSvg) dom.fxSvg.innerHTML = '';
    if (dom.layer) dom.layer.innerHTML = '';
    requestNativeLayout();
  }

  function ensureMounted() {
    const rt = document.getElementById('rt');
    if (!rt) return false;
    if (dom.rt !== rt) {
      dom.rt = rt;
      dom.stage = rt.querySelector('.rt-stage');
      dom.srcs = rt.querySelector('.rt-srcs');
      dom.hub = rt.querySelector('.rt-hub');
      dom.list = rt.querySelector('.rt-accts');

      if (dom.stage) {
        let wiresSvg = document.getElementById('purge-wires-svg');
        if (!wiresSvg) {
          wiresSvg = svgEl('svg', { id: 'purge-wires-svg', 'aria-hidden': 'true' });
          if (dom.srcs && dom.srcs.parentNode === dom.stage) dom.stage.insertBefore(wiresSvg, dom.srcs);
          else dom.stage.appendChild(wiresSvg);
        }
        dom.wiresSvg = wiresSvg;
      }

      let fx = document.getElementById('purge-fx-svg');
      if (!fx) {
        fx = svgEl('svg', { id: 'purge-fx-svg', 'aria-hidden': 'true' });
        rt.appendChild(fx);
      }
      let layer = rt.querySelector('.purge-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'purge-layer';
        rt.appendChild(layer);
      }
      dom.fxSvg = fx;
      dom.layer = layer;

      if (!dom.ctxMenu) {
        const menu = document.createElement('div');
        menu.className = 'purge-ctx-menu';
        menu.id = 'purge-ctx-menu';
        menu.setAttribute('role', 'menu');
        document.body.appendChild(menu);
        dom.ctxMenu = menu;
      }

      rt.addEventListener('contextmenu', (e) => {
        if (!state.enabled) return;
        e.preventDefault();
        const hitShell = e.target.closest('.purge-shell');
        const hitTarget = e.target.closest('[data-purge-target-kind]');
        openContextMenu(e.clientX, e.clientY, {
          shellKey: hitShell?.dataset.shellKey || '',
          targetEl: hitTarget,
        });
      });

      if (typeof ResizeObserver !== 'undefined') {
        if (dom.ro) dom.ro.disconnect();
        dom.ro = new ResizeObserver(() => scheduleSync());
        dom.ro.observe(rt);
        if (dom.stage) dom.ro.observe(dom.stage);
      }

      if (dom.stage && typeof MutationObserver !== 'undefined') {
        if (dom.stageObs) dom.stageObs.disconnect();
        dom.stageObs = new MutationObserver((muts) => {
          const relevant = muts.some((m) => {
            const tgt = m.target instanceof Element ? m.target : null;
            if (!tgt) return false;
            if (tgt.closest('#purge-wires-svg, #purge-fx-svg, .purge-layer, .purge-standby-agent')) return false;
            const touched = [...(m.addedNodes || []), ...(m.removedNodes || [])];
            if (
              touched.length > 0 &&
              touched.every((n) => n instanceof Element && n.classList.contains('purge-standby-agent'))
            ) {
              return false;
            }
            return true;
          });
          if (relevant) scheduleSync();
        });
        dom.stageObs.observe(dom.stage, { childList: true, subtree: true });
      }

      const view = document.getElementById('view-routing');
      if (view && typeof MutationObserver !== 'undefined') {
        if (dom.viewObs) dom.viewObs.disconnect();
        dom.viewObs = new MutationObserver(() => {
          if (!view.hidden) refreshPluginState();
        });
        dom.viewObs.observe(view, { attributes: true, attributeFilter: ['hidden'] });
      }

      if (!dom.navHooked) {
        dom.navHooked = true;
        window.addEventListener('hashchange', () => refreshPluginState());
        window.addEventListener('popstate', () => refreshPluginState());
        document.addEventListener('click', (e) => {
          const btn = e.target instanceof Element ? e.target.closest('nav a, nav button, .nav button, .nav a, [data-view]') : null;
          if (btn) setTimeout(() => refreshPluginState(), 80);
        });
      }
    } else {
      dom.stage = rt.querySelector('.rt-stage');
      dom.srcs = rt.querySelector('.rt-srcs');
      dom.hub = rt.querySelector('.rt-hub');
      dom.list = rt.querySelector('.rt-accts');
    }

    hydrateDomTargets();
    rt.classList.add('purge-rt-host');
    rt.dataset.purgeSkin = state.skin;
    return true;
  }

  function inferGroupIdFromStage() {
    if (!dom.rt) return '';
    for (const a of dom.rt.querySelectorAll('.rt-src')) {
      const route = String(a.dataset.purgeRoute || a.querySelector('small')?.textContent || '').trim();
      const m = route.match(/^group\/([^\s[\]()]+)/i);
      if (m) return stripEffortAndAlias(m[1]);
    }
    const subCode = dom.rt.querySelector('.rt-accts > li.rt-sub.rt-route code.mdl')?.textContent || '';
    const sm = subCode.trim().match(/^group\/([^\s[\]()]+)/i);
    if (sm) return stripEffortAndAlias(sm[1]);
    return '';
  }

  function hydrateDomTargets() {
    if (!dom.rt) return;

    if (dom.hub && !dom.hub.dataset.purgeTargetKind) {
      dom.hub.dataset.purgeTargetKind = 'hub';
      dom.hub.dataset.purgeTargetId = 'hub-magpie';
    }

    // 左侧 Agent 来源卡片兜底打标（自动剔除空闲占位卡片 "your agent"）
    if (dom.srcs) {
      for (const node of dom.srcs.querySelectorAll('.rt-src')) {
        if (node.classList.contains('purge-standby-agent')) continue;
        const nameText = String(node.querySelector('b')?.textContent || node.dataset.purgeAgentName || '').trim();
        const routeText = String(node.querySelector('small')?.textContent || node.dataset.purgeRoute || '').trim();
        if (isPlaceholderAgentName(nameText) && !routeText) {
          delete node.dataset.purgeTargetKind;
          delete node.dataset.purgeTargetId;
          delete node.dataset.purgeStageKey;
          delete node.dataset.purgeAgentName;
          delete node.dataset.purgeRoute;
          continue;
        }
        if (!node.dataset.purgeTargetKind) {
          const cid = canonicalAgentId(nameText);
          node.dataset.purgeTargetKind = 'agent';
          node.dataset.purgeTargetId = cid || nameText;
          node.dataset.purgeStageKey = cid || nameText;
          node.dataset.purgeAgentName = nameText || cid;
          node.dataset.purgeRoute = routeText;
        }
      }
    }

    // 右侧供应商/模型行兜底打标 + groupId 补全
    const fallbackGroup = inferGroupIdFromStage();
    if (dom.list) {
      let lastFoldProvId = '';
      let lastFoldProvName = '';
      let lastFoldPreset = '';
      for (const li of dom.list.querySelectorAll(':scope > li')) {
        if (li.classList.contains('idle') || li.classList.contains('rt-sub')) continue;
        if (li.classList.contains('rt-fold') && li.dataset.purgeProviderId) {
          lastFoldProvId = String(li.dataset.purgeProviderId || '').trim();
          lastFoldProvName = String(li.dataset.purgeProviderName || '').trim();
          lastFoldPreset = String(li.dataset.purgePreset || '').trim();
        }
        if (!li.dataset.purgeTargetKind) {
          const isFold = li.classList.contains('rt-fold');
          const model = stripEffortAndAlias(li.querySelector('code.mdl')?.textContent || '');
          const provText = readUnmaskedText(li.querySelector('.prov')).text;
          const whoInfo = readUnmaskedText(li.querySelector('.who'));
          const whoText = whoInfo.text;
          const seatId = String(li.dataset.piiTitle || li.title || '').trim();
          const seatPrefix = seatId.includes('/') ? seatId.split('/')[0] : seatId.includes(':') ? seatId.split(':')[0] : '';
          let provName = provText || (isFold ? whoText : '');
          let provId = /^[a-z0-9._-]+$/i.test(seatPrefix) ? seatPrefix : '';
          let preset = '';
          if (!provId && !isFold && lastFoldProvId) {
            provId = lastFoldProvId;
            if (!provName) provName = lastFoldProvName;
            preset = lastFoldPreset;
          }
          if (!provId && provName && Array.isArray(window.providers?.providers)) {
            const matched = window.providers.providers.find(
              (p) =>
                p &&
                (String(p.name || '').trim().toLowerCase() === provName.toLowerCase() ||
                  String(p.id || '').trim().toLowerCase() === provName.toLowerCase()),
            );
            if (matched) {
              provId = String(matched.id || '').trim();
              if (!provName) provName = String(matched.name || '').trim();
              preset = String(matched.preset || '').trim();
            }
          }
          if (!provId && /^[a-z0-9._-]+$/i.test(provName)) provId = provName;
          const account = isFold || whoInfo.maskedOpaque ? '' : whoText;
          if (!model && !provId && !provName && !account) continue;

          li.dataset.purgeTargetKind = 'provider';
          li.dataset.purgeGroupId = fallbackGroup;
          li.dataset.purgeProviderId = provId;
          li.dataset.purgeProviderName = provName || provId;
          if (preset) li.dataset.purgePreset = preset;
          li.dataset.purgeSeatId = seatId;
          li.dataset.purgeModel = model;
          li.dataset.purgeAccount = account;
          if (isFold) li.dataset.purgeFold = '1';
          li.dataset.purgeTargetId = `${isFold ? 'fold' : 'prov'}:${fallbackGroup}:${provId}:${model}:${seatId || account || provName}`;
        } else if (!li.dataset.purgeGroupId && fallbackGroup) {
          li.dataset.purgeGroupId = fallbackGroup;
        }
      }
    }
  }

  function requestNativeLayout() {
    try {
      window.dispatchEvent(new CustomEvent('fish:routing-layout'));
    } catch {}
  }

  function createAgentIconNode(iconName, fallbackSvg = GENERIC_AGENT_SVG) {
    if (iconName && typeof window.icon === 'function') {
      try {
        const el = window.icon(iconName);
        if (el) return el;
      } catch {}
    }
    const span = document.createElement('span');
    span.className = 'ic';
    span.innerHTML = fallbackSvg || GENERIC_AGENT_SVG;
    return span;
  }

  function buildStandbyAgentCard(meta, animate = false) {
    const card = document.createElement('div');
    card.className = 'rt-node rt-src standby purge-standby-agent' + (animate ? ' purge-is-emerging' : '');
    card.dataset.purgeStandbyId = meta.id;
    card.dataset.purgeTargetKind = 'agent';
    card.dataset.purgeTargetId = meta.id;
    card.dataset.purgeStageKey = `standby:${meta.id}`;
    card.dataset.purgeAgentName = meta.name;
    card.dataset.purgeRoute = meta.route;
    card.style.setProperty('--agent', meta.color);
    card.innerHTML = `
      <span class="rt-ic"></span>
      <b>${escapeHtml(meta.name)}</b>
      <small>${escapeHtml(meta.route || '已接入 magpie')}</small>
      <span class="purge-standby-pill">待命 · 预注入</span>
    `;
    const icWrap = card.querySelector('.rt-ic');
    if (icWrap) icWrap.appendChild(createAgentIconNode(meta.icon, meta.iconSvg));
    if (animate) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        card.classList.remove('purge-is-emerging');
        requestNativeLayout();
        scheduleSync();
      };
      card.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 420);
    }
    return card;
  }

  function syncStandbyAgents() {
    if (!dom.srcs) return;
    const nativeIds = new Set();
    for (const el of dom.srcs.querySelectorAll('.rt-src:not(.purge-standby-agent)')) {
      if (!el.dataset.purgeTargetKind) continue;
      const cid = canonicalAgentId(el.dataset.purgeTargetId || el.dataset.purgeAgentName || '');
      if (cid) nativeIds.add(cid);
    }

    const wantStandby = new Set(state.standbyAgents.map(canonicalAgentId).filter((id) => id && !nativeIds.has(id)));
    let changed = false;

    for (const el of dom.srcs.querySelectorAll('.purge-standby-agent')) {
      const sid = el.dataset.purgeStandbyId || '';
      if (!wantStandby.has(sid)) {
        el.remove();
        changed = true;
      }
    }

    for (const sid of wantStandby) {
      if (dom.srcs.querySelector(`.purge-standby-agent[data-purge-standby-id="${CSS.escape(sid)}"]`)) continue;
      const meta = getStandbyMeta(sid);
      if (!meta) continue;
      const shouldAnimate = state.animatingStandbyIds.has(sid);
      if (shouldAnimate) state.animatingStandbyIds.delete(sid);
      dom.srcs.appendChild(buildStandbyAgentCard(meta, shouldAnimate));
      changed = true;
    }

    const prevMany = dom.srcs.classList.contains('many');
    const nextMany = dom.srcs.children.length > 1;
    dom.srcs.classList.toggle('many', nextMany);
    if (prevMany !== nextMany) changed = true;

    if (changed) {
      requestNativeLayout();
      requestAnimationFrame(() => {
        requestNativeLayout();
        drawPurgeWires();
      });
    }
  }

  function makeWireCurve(x1, y1, x2, y2, stacked = false) {
    if (stacked) {
      const my = (y1 + y2) / 2;
      return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${my.toFixed(1)}, ${x2.toFixed(1)} ${my.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    const mx = (x1 + x2) / 2;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${mx.toFixed(1)} ${y1.toFixed(1)}, ${mx.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  function drawPurgeWires() {
    if (!dom.wiresSvg || !dom.stage) return;
    dom.wiresSvg.innerHTML = '';
    if (!state.enabled || !dom.hub || !dom.hub.isConnected) return;

    const stageRect = dom.stage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return;
    dom.wiresSvg.setAttribute('viewBox', `0 0 ${stageRect.width} ${stageRect.height}`);

    const hubBox = rectRel(dom.hub, dom.stage);
    if (!hubBox) return;

    const hubPurged = state.active && state.hubInject;

    if (dom.srcs) {
      for (const el of dom.srcs.querySelectorAll('.rt-src[data-purge-target-kind="agent"]')) {
        const box = rectRel(el, dom.stage);
        if (!box) continue;
        const stacked = hubBox.x <= box.right + 4;
        const d = stacked
          ? makeWireCurve(box.cx, box.bottom, hubBox.cx, hubBox.y, true)
          : makeWireCurve(box.right, box.cy, hubBox.x, hubBox.cy, false);
        const agentPurged = isElementWrapped(el) || hubPurged;
        if (agentPurged) {
          dom.wiresSvg.appendChild(svgEl('path', { d, class: 'purge-wire-path' }));
          dom.wiresSvg.appendChild(svgEl('path', { d, class: 'purge-flow-path' }));
        }
      }
    }

    if (dom.list) {
      for (const li of dom.list.querySelectorAll(':scope > li[data-purge-target-kind="provider"]')) {
        const box = rectRel(li, dom.stage);
        if (!box) continue;
        const provPurged = isElementWrapped(li);
        if (!provPurged && !hubPurged) continue;
        const stacked = box.x <= hubBox.right + 4;
        const d = stacked
          ? makeWireCurve(hubBox.cx, hubBox.bottom, box.cx, box.y, true)
          : makeWireCurve(hubBox.right, hubBox.cy, box.x, box.cy, false);
        dom.wiresSvg.appendChild(svgEl('path', { d, class: 'purge-wire-path' }));
        const isPicked = li.classList.contains('win') || li.classList.contains('hit') || li.classList.contains('on') || li.classList.contains('picked');
        if (provPurged || isPicked) {
          dom.wiresSvg.appendChild(svgEl('path', { d, class: 'purge-flow-path' }));
        }
      }
    }
  }

  function syncStatsBadge() {
    if (!dom.rt) return;
    const stats = dom.rt.querySelector('.rt-stats');
    if (!stats) return;
    let item = stats.querySelector('.purge-rt-stat');
    if (!item) {
      item = document.createElement('span');
      item.className = 'purge-rt-stat';
      item.title = 'Purge 当前路由已包裹的目标数（Agent / 总路由 / 指定模型）';
      const b = document.createElement('b');
      const label = document.createElement('span');
      label.textContent = '已包裹';
      item.append(b, label);
      stats.insertBefore(item, stats.firstChild);
    }
    const count = (state.hubInject ? 1 : 0) + state.wrappedAgents.length + state.wrappedTargets.length;
    const bEl = item.querySelector('b');
    if (bEl && bEl.textContent !== String(count)) bEl.textContent = String(count);
    item.classList.toggle('is-zero', count === 0);
  }

  function flashShellBite(shellKey) {
    const rec = state.shells.get(shellKey);
    if (!rec?.shellEl) return;
    rec.shellEl.classList.remove('is-bite-flash');
    void rec.shellEl.offsetWidth;
    rec.shellEl.classList.add('is-bite-flash');
    setTimeout(() => rec.shellEl?.classList.remove('is-bite-flash'), 420);
  }

  function checkLiveTurnBiteFlash() {
    if (!dom.rt || !state.active) return;
    const reqText = String(dom.rt.querySelector('.rt-stats > span:not(.purge-rt-stat) b')?.textContent || '');
    const pickedEl = dom.list?.querySelector(':scope > li.win, :scope > li.picked, :scope > li.hit');
    const sig = `${reqText}|${pickedEl?.dataset.purgeTargetId || ''}`;
    if (!reqText || reqText === '0' || sig === state.lastTurnSig) return;
    const firstSeen = state.lastTurnSig === '';
    state.lastTurnSig = sig;
    if (firstSeen) return;

    for (const [key, rec] of state.shells) {
      if (rec.kind === 'hub' || rec.kind === 'agent' || rec.el === pickedEl) {
        flashShellBite(key);
      }
    }
  }

  function scheduleSync() {
    if (state.pendingSync) return;
    state.pendingSync = true;
    requestAnimationFrame(() => {
      state.pendingSync = false;
      if (state.enabled) syncAll();
    });
  }

  function rectRel(el, relEl) {
    if (!el || !relEl || !el.isConnected) return null;
    const a = el.getBoundingClientRect();
    const b = relEl.getBoundingClientRect();
    if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return null;
    const x = a.left - b.left;
    const y = a.top - b.top;
    return { x, y, w: a.width, h: a.height, right: x + a.width, bottom: y + a.height, cx: x + a.width / 2, cy: y + a.height / 2 };
  }

  function clientToRt(clientX, clientY) {
    const r = dom.rt.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function distToBox(px, py, box) {
    const dx = Math.max(box.x - px, 0, px - box.right);
    const dy = Math.max(box.y - py, 0, py - box.bottom);
    return Math.hypot(dx, dy);
  }

  function shellKeyForEl(el) {
    const kind = el.dataset.purgeTargetKind;
    if (kind === 'hub') return 'hub-magpie';
    if (kind === 'agent') return `agent::${el.dataset.purgeStageKey || el.dataset.purgeTargetId}`;
    return `prov::${el.dataset.purgeTargetId}`;
  }

  function isElementWrapped(el) {
    if (!state.active || !el) return false;
    const kind = el.dataset.purgeTargetKind;
    if (kind === 'hub') return state.hubInject;
    if (kind === 'agent') {
      const aid = el.dataset.purgeTargetId || '';
      return state.wrappedAgents.some((a) => sameAgent(a, aid));
    }
    if (kind === 'provider') {
      const meta = getProviderMetaFromEl(el);
      return state.wrappedTargets.some((t) => sameProviderTarget(t, meta));
    }
    return false;
  }

  function getVisibleTargetEls() {
    if (!dom.rt) return [];
    const list = [...dom.rt.querySelectorAll('[data-purge-target-kind]')];
    return list.filter((el) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect();
      return r.width > 12 && r.height > 12;
    });
  }

  function getSkinCapsuleIconSvg(skin) {
    if (skin === 'fish') {
      return `<svg class="purge-cap-ic" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10.2" fill="#fee33e" stroke="#141416" stroke-width="1.3"/>
        <circle cx="12" cy="11.4" r="4.6" fill="#6ecf6b"/>
        <circle cx="12" cy="11.4" r="2.7" fill="#080808"/>
        <path d="M12.3 9.7 A 1.7 1.7 0 0 1 13.7 10.9" stroke="#ffffff" stroke-width="0.95" stroke-linecap="round"/>
        <circle cx="13.7" cy="12.1" r="0.48" fill="#ffffff"/>
        <line x1="4.4" y1="17.8" x2="10.6" y2="17.8" stroke="#080808" stroke-width="2.3" stroke-linecap="round"/>
      </svg>`;
    }
    if (skin === 'classic') {
      return `<svg class="purge-cap-ic" viewBox="0 0 24 24" fill="none">
        <path d="M12 12 L20.6 7.4 A9.8 9.8 0 1 0 20.6 16.6 Z" fill="#ffda29" stroke="#1c1917" stroke-width="1.2" stroke-linejoin="round"/>
        <circle cx="13.2" cy="7.2" r="1.3" fill="#1c1917"/>
      </svg>`;
    }
    if (skin === 'cyber') {
      return `<svg class="purge-cap-ic" viewBox="0 0 24 24" fill="none">
        <path d="M12 12 L20.6 7.4 A9.8 9.8 0 1 0 20.6 16.6 Z" fill="#22d3ee" stroke="#ecfeff" stroke-width="1.2" stroke-linejoin="round"/>
        <rect x="10.5" y="6.2" width="5.2" height="2" rx="1" fill="#ecfeff"/>
      </svg>`;
    }
    return `<svg class="purge-cap-ic" viewBox="0 0 24 24" fill="none">
      <path d="M12 2.8L19.5 6.2V11.8C19.5 16.4 16.2 20.1 12 21.4C7.8 20.1 4.5 16.4 4.5 11.8V6.2L12 2.8Z" fill="#fff5f7" fill-opacity="0.94"/>
      <path d="M9 10.2L10.9 13.6L12 11.4L13.1 13.6L15 10.2" stroke="#c8103a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function refreshCapsuleSkinIcons() {
    const html = `${getSkinCapsuleIconSvg(state.skin)}<span>PURGE</span>`;
    for (const c of state.capsules) {
      if (c.el.dataset.purgeSkinRendered === state.skin) continue;
      const hint = c.el.querySelector('.purge-cap-hint');
      c.el.innerHTML = html;
      c.el.dataset.purgeSkinRendered = state.skin;
      if (hint) c.el.appendChild(hint);
    }
  }

  function setCapsulePos(cap, x, y, tiltDeg = 0, sx = 1, sy = 1) {
    if (!dom.rt) return;
    const r = dom.rt.getBoundingClientRect();
    const w = Math.max(220, r.width || 600);
    const h = Math.max(180, r.height || 320);
    cap.x = clamp(x, 54, w - 54);
    cap.y = clamp(y, 24, h - 24);
    cap.el.style.left = `${cap.x.toFixed(1)}px`;
    cap.el.style.top = `${cap.y.toFixed(1)}px`;
    cap.el.style.transform = `rotate(${tiltDeg.toFixed(2)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
  }

  function createCapsule(x, y, opts = {}) {
    if (!dom.layer) return null;
    const id = `cap-${state.nextCapsuleSeq++}`;
    const el = document.createElement('div');
    el.className = 'purge-capsule';
    el.dataset.capsuleId = id;
    el.dataset.purgeSkinRendered = state.skin;
    el.title = '拖向 Agent / Magpie / 右侧模型以吞噬注入；双击液态分裂';
    el.innerHTML = `${getSkinCapsuleIconSvg(state.skin)}<span>PURGE</span>`;
    dom.layer.appendChild(el);
    const cap = { id, x, y, el };
    state.capsules.push(cap);
    setCapsulePos(cap, x, y, opts.tilt || 0, opts.scaleX || 1, opts.scaleY || 1);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      closeContextMenu();
      beginCapsuleDrag(cap, e, false);
    });
    return cap;
  }

  function removeCapsule(capId) {
    const idx = state.capsules.findIndex((c) => c.id === capId);
    if (idx === -1) return;
    const [cap] = state.capsules.splice(idx, 1);
    cap.el?.remove();
  }

  function placeInitialCapsule() {
    if (!dom.rt || !dom.layer || state.capsules.length > 0) return;
    const rtRect = dom.rt.getBoundingClientRect();
    if (rtRect.width < 120 || rtRect.height < 120) return;
    const hubBox = rectRel(dom.hub, dom.rt);
    let x = rtRect.width * 0.36;
    let y = rtRect.height * 0.72;
    if (hubBox) {
      x = hubBox.cx;
      y = clamp(hubBox.bottom + 36, 36, rtRect.height - 32);
    }
    createCapsule(x, y);
  }

  function spawnMicroParticles(cx, cy, color = '#fee33e', count = 6) {
    if (!dom.fxSvg) return;
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const dist = 20 + Math.random() * 24;
      const r = 2.4 + Math.random() * 2.4;
      const dot = svgEl('circle', { cx, cy, r, fill: color, opacity: 0.95 });
      dom.fxSvg.appendChild(dot);
      const t0 = performance.now();
      const dur = 320 + Math.random() * 140;
      function step(now) {
        const t = Math.min(1, (now - t0) / dur);
        const ease = 1 - Math.pow(1 - t, 3);
        dot.setAttribute('cx', (cx + Math.cos(ang) * dist * ease).toFixed(1));
        dot.setAttribute('cy', (cy + Math.sin(ang) * dist * ease).toFixed(1));
        dot.setAttribute('r', (r * (1 - t * 0.8)).toFixed(2));
        dot.setAttribute('opacity', (1 - t).toFixed(2));
        if (t < 1) requestAnimationFrame(step);
        else dot.remove();
      }
      requestAnimationFrame(step);
    }
  }

  function spawnRipple(cx, cy, maxR = 64, color = '#fee33e') {
    if (!dom.fxSvg) return;
    const ring = svgEl('circle', { cx, cy, r: 10, fill: 'none', stroke: color, 'stroke-width': 2.5, opacity: 0.85 });
    dom.fxSvg.appendChild(ring);
    const t0 = performance.now();
    const dur = 380;
    function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - t, 3);
      ring.setAttribute('r', (10 + (maxR - 10) * ease).toFixed(1));
      ring.setAttribute('stroke-width', (2.6 * (1 - t)).toFixed(2));
      ring.setAttribute('opacity', (0.85 * (1 - t)).toFixed(2));
      if (t < 1) requestAnimationFrame(step);
      else ring.remove();
    }
    requestAnimationFrame(step);
  }

  function spawnFloatingCallout(x, y, text) {
    if (!dom.layer) return;
    const node = document.createElement('div');
    node.className = 'purge-callout';
    node.style.left = `${x.toFixed(1)}px`;
    node.style.top = `${y.toFixed(1)}px`;
    node.textContent = text;
    dom.layer.appendChild(node);
    setTimeout(() => node.remove(), 1600);
  }

  function buildMetaballBridgePath(x1, y1, x2, y2, r1, r2, waistFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    if (d < 4) return '';
    const nx = -dy / d;
    const ny = dx / d;
    const mx = (x1 + x2) * 0.5;
    const my = (y1 + y2) * 0.5;
    const w = Math.max(2, Math.min(r1, r2) * waistFactor);
    return [
      `M ${(x1 + nx * r1).toFixed(1)} ${(y1 + ny * r1).toFixed(1)}`,
      `Q ${(mx + nx * w).toFixed(1)} ${(my + ny * w).toFixed(1)} ${(x2 + nx * r2).toFixed(1)} ${(y2 + ny * r2).toFixed(1)}`,
      `L ${(x2 - nx * r2).toFixed(1)} ${(y2 - ny * r2).toFixed(1)}`,
      `Q ${(mx - nx * w).toFixed(1)} ${(my - ny * w).toFixed(1)} ${(x1 - nx * r1).toFixed(1)} ${(y1 - ny * r1).toFixed(1)}`,
      'Z',
    ].join(' ');
  }

  function drawFishPacManSvg(g, cx, cy, radius, angleRad, mouthHalfRad, opacity = 0.96) {
    g.innerHTML = '';
    const facingLeft = Math.cos(angleRad) < 0;
    const flipX = facingLeft ? -1 : 1;
    const pitchRad = facingLeft
      ? Math.atan2(Math.sin(angleRad), -Math.cos(angleRad))
      : Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
    const pitchDeg = clamp((pitchRad * 180) / Math.PI, -26, 26);
    const openRatio = clamp((mouthHalfRad - 0.05) / 0.95, 0, 1);

    const wrap = svgEl('g', {
      transform: `translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) scale(${flipX}, 1) rotate(${pitchDeg.toFixed(1)})`,
    });
    g.appendChild(wrap);
    wrap.appendChild(svgEl('circle', { cx: 0, cy: 0, r: (radius * 1.16).toFixed(1), fill: 'rgba(254, 227, 62, 0.24)' }));

    if (openRatio <= 0.02) {
      wrap.appendChild(
        svgEl('circle', {
          cx: 0,
          cy: 0,
          r: radius.toFixed(1),
          fill: '#fee33e',
          'fill-opacity': opacity.toFixed(2),
          stroke: '#e5b814',
          'stroke-width': 1.8,
          filter: 'drop-shadow(0 0 14px rgba(254, 227, 62, 0.55))',
        }),
      );
      wrap.appendChild(
        svgEl('line', {
          x1: (0.24 * radius).toFixed(1),
          y1: (0.5 * radius).toFixed(1),
          x2: (0.85 * radius).toFixed(1),
          y2: (0.5 * radius).toFixed(1),
          stroke: '#080808',
          'stroke-width': Math.max(3, 0.115 * radius).toFixed(1),
          'stroke-linecap': 'round',
        }),
      );
    } else {
      const hx = (0.24 - 0.32 * openRatio) * radius;
      const hy = (0.5 - 0.22 * openRatio) * radius;
      const aUpper = 0.5 - openRatio * 1.08;
      const aLower = 0.5 + openRatio * 0.92;
      const ux = Math.cos(aUpper) * radius;
      const uy = Math.sin(aUpper) * radius;
      const lx = Math.cos(aLower) * radius;
      const ly = Math.sin(aLower) * radius;

      wrap.appendChild(
        svgEl('path', {
          d: `M ${hx.toFixed(1)} ${hy.toFixed(1)} L ${ux.toFixed(1)} ${uy.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${lx.toFixed(1)} ${ly.toFixed(1)} Z`,
          fill: '#181214',
          opacity: (0.86 * opacity).toFixed(2),
        }),
      );
      if (openRatio > 0.35) {
        wrap.appendChild(
          svgEl('circle', {
            cx: (hx + (lx - hx) * 0.48).toFixed(1),
            cy: (hy + (ly - hy) * 0.48).toFixed(1),
            r: Math.max(4, radius * 0.22 * openRatio).toFixed(1),
            fill: '#fb7185',
            opacity: (0.72 * opacity).toFixed(2),
          }),
        );
      }
      const largeArc = 2 * Math.PI - (aLower - aUpper) > Math.PI ? 1 : 0;
      wrap.appendChild(
        svgEl('path', {
          d: `M ${hx.toFixed(1)} ${hy.toFixed(1)} L ${lx.toFixed(1)} ${ly.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 ${largeArc} 1 ${ux.toFixed(1)} ${uy.toFixed(1)} Z`,
          fill: '#fee33e',
          'fill-opacity': opacity.toFixed(2),
          stroke: '#eab308',
          'stroke-width': 1.8,
          'stroke-linejoin': 'round',
          filter: 'drop-shadow(0 0 14px rgba(254, 227, 62, 0.55))',
        }),
      );
      wrap.appendChild(
        svgEl('path', {
          d: `M ${ux.toFixed(1)} ${uy.toFixed(1)} L ${hx.toFixed(1)} ${hy.toFixed(1)} L ${lx.toFixed(1)} ${ly.toFixed(1)}`,
          fill: 'none',
          stroke: '#080808',
          'stroke-width': Math.max(2.6, 0.095 * radius).toFixed(1),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    }

    const ex = (-0.02 - 0.12 * openRatio) * radius;
    const ey = (-0.02 - 0.18 * openRatio) * radius;
    const rIris = (0.42 - 0.06 * openRatio) * radius;
    const rPupil = rIris * 0.58;
    const px = ex + 0.04 * openRatio * radius;
    const py = ey;
    wrap.appendChild(svgEl('circle', { cx: ex.toFixed(1), cy: ey.toFixed(1), r: rIris.toFixed(1), fill: '#6ecf6b' }));
    wrap.appendChild(svgEl('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: rPupil.toFixed(1), fill: '#080808' }));

    const specR = rPupil * 0.58;
    const arcStart = (-82 * Math.PI) / 180;
    const arcEnd = (-20 * Math.PI) / 180;
    wrap.appendChild(
      svgEl('path', {
        d: `M ${(px + Math.cos(arcStart) * specR).toFixed(1)} ${(py + Math.sin(arcStart) * specR).toFixed(1)} A ${specR.toFixed(1)} ${specR.toFixed(1)} 0 0 1 ${(px + Math.cos(arcEnd) * specR).toFixed(1)} ${(py + Math.sin(arcEnd) * specR).toFixed(1)}`,
        fill: 'none',
        stroke: '#ffffff',
        'stroke-width': Math.max(1.6, 0.21 * rPupil).toFixed(1),
        'stroke-linecap': 'round',
      }),
    );
    const dotAng = (14 * Math.PI) / 180;
    wrap.appendChild(
      svgEl('circle', {
        cx: (px + Math.cos(dotAng) * specR).toFixed(1),
        cy: (py + Math.sin(dotAng) * specR).toFixed(1),
        r: Math.max(1.1, 0.115 * rPupil).toFixed(1),
        fill: '#ffffff',
      }),
    );
  }

  function drawPacManSvg(g, cx, cy, radius, angleRad, mouthHalfRad, opacity = 0.94, showHighlight = true) {
    if (state.skin === 'fish') {
      drawFishPacManSvg(g, cx, cy, radius, angleRad, mouthHalfRad, opacity);
      return;
    }
    const pal = getSkinPalette();
    g.innerHTML = '';
    const clampedMouth = Math.max(0.02, Math.min(1.22, mouthHalfRad));
    g.appendChild(svgEl('circle', { cx, cy, r: radius * 1.18, fill: pal.aura }));

    if (clampedMouth > 0.08) {
      const a1 = angleRad - clampedMouth * 0.92;
      const a2 = angleRad + clampedMouth * 0.92;
      const mawFill = state.skin === 'cyber' ? '#1e1b4b' : state.skin === 'classic' ? '#451a03' : '#4c0519';
      g.appendChild(
        svgEl('path', {
          d: `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${(cx + Math.cos(a1) * radius * 0.9).toFixed(1)} ${(cy + Math.sin(a1) * radius * 0.9).toFixed(1)} A ${(radius * 0.9).toFixed(1)} ${(radius * 0.9).toFixed(1)} 0 0 1 ${(cx + Math.cos(a2) * radius * 0.9).toFixed(1)} ${(cy + Math.sin(a2) * radius * 0.9).toFixed(1)} Z`,
          fill: mawFill,
          opacity: (0.78 * opacity).toFixed(2),
        }),
      );
    }

    let bodyPathD;
    if (clampedMouth <= 0.04) {
      bodyPathD = `M ${(cx - radius).toFixed(1)} ${cy.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 1 0 ${(cx + radius).toFixed(1)} ${cy.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 1 0 ${(cx - radius).toFixed(1)} ${cy.toFixed(1)} Z`;
    } else {
      const startA = angleRad + clampedMouth;
      const endA = angleRad - clampedMouth;
      const largeArc = 2 * Math.PI - 2 * clampedMouth > Math.PI ? 1 : 0;
      bodyPathD = `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${(cx + Math.cos(startA) * radius).toFixed(1)} ${(cy + Math.sin(startA) * radius).toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 ${largeArc} 1 ${(cx + Math.cos(endA) * radius).toFixed(1)} ${(cy + Math.sin(endA) * radius).toFixed(1)} Z`;
    }

    g.appendChild(
      svgEl('path', {
        d: bodyPathD,
        fill: pal.bodyFill,
        'fill-opacity': opacity.toFixed(2),
        stroke: pal.bodyStroke,
        'stroke-width': 2.2,
        'stroke-linejoin': 'round',
        filter: `drop-shadow(0 0 14px ${pal.pktGlow})`,
      }),
    );

    if (showHighlight && radius > 16) {
      g.appendChild(
        svgEl('path', {
          d: `M ${(cx - radius * 0.45).toFixed(1)} ${(cy - radius * 0.56).toFixed(1)} A ${(radius * 0.72).toFixed(1)} ${(radius * 0.72).toFixed(1)} 0 0 1 ${(cx + radius * 0.28).toFixed(1)} ${(cy - radius * 0.68).toFixed(1)}`,
          fill: 'none',
          stroke: 'rgba(255,255,255,0.45)',
          'stroke-width': Math.max(2, radius * 0.08).toFixed(1),
          'stroke-linecap': 'round',
        }),
      );
    }

    const eyeSign = Math.cos(angleRad) < 0 ? 1 : -1;
    const eyeAng = angleRad + eyeSign * 0.92;
    const ex = cx + Math.cos(eyeAng) * (radius * 0.46);
    const ey = cy + Math.sin(eyeAng) * (radius * 0.46);
    if (state.skin === 'cyber') {
      g.appendChild(
        svgEl('rect', {
          x: (ex - radius * 0.14).toFixed(1),
          y: (ey - radius * 0.06).toFixed(1),
          width: Math.max(6, radius * 0.28).toFixed(1),
          height: Math.max(3, radius * 0.12).toFixed(1),
          rx: 2,
          fill: '#ecfeff',
          stroke: '#0e7490',
          'stroke-width': 1,
        }),
      );
    } else if (state.skin === 'classic') {
      g.appendChild(svgEl('circle', { cx: ex.toFixed(1), cy: ey.toFixed(1), r: Math.max(2.6, radius * 0.11).toFixed(1), fill: '#18181b' }));
    } else {
      g.appendChild(svgEl('circle', { cx: ex.toFixed(1), cy: ey.toFixed(1), r: Math.max(2.6, radius * 0.11).toFixed(1), fill: '#fff5f7', stroke: '#880e2f', 'stroke-width': 1 }));
    }
  }

  function addWrapTarget(targetEl) {
    const kind = targetEl.dataset.purgeTargetKind;
    if (kind === 'hub') {
      state.hubInject = true;
      return 'Magpie 总路由';
    }
    if (kind === 'agent') {
      const aid = canonicalAgentId(targetEl.dataset.purgeTargetId || '');
      if (aid && !state.wrappedAgents.some((x) => sameAgent(x, aid))) {
        state.wrappedAgents.push(aid);
      }
      return targetEl.dataset.purgeAgentName || aid || 'Agent';
    }
    if (kind === 'provider') {
      const meta = getProviderMetaFromEl(targetEl);
      if (!state.wrappedTargets.some((t) => sameProviderTarget(t, meta))) {
        state.wrappedTargets.push(meta);
      }
      return meta.model || meta.providerName || meta.providerId || '指定模型';
    }
    return '';
  }

  function removeWrapForShell(rec) {
    if (rec.kind === 'hub') {
      state.hubInject = false;
      return 'Magpie 总路由';
    }
    if (rec.kind === 'agent') {
      const aid = rec.targetId;
      state.wrappedAgents = state.wrappedAgents.filter((a) => !sameAgent(a, aid));
      return rec.el?.dataset.purgeAgentName || aid || 'Agent';
    }
    if (rec.kind === 'provider') {
      const meta = rec.targetMeta;
      state.wrappedTargets = state.wrappedTargets.filter((t) => !sameProviderTarget(t, meta));
      return meta?.model || meta?.providerName || '指定模型';
    }
    return '';
  }

  function createOrUpdateShell(el, opts = {}) {
    if (!dom.layer || !dom.rt) return null;
    const shellKey = shellKeyForEl(el);
    const kind = el.dataset.purgeTargetKind;
    const box = rectRel(el, dom.rt);
    if (!box) return null;

    let rec = state.shells.get(shellKey);
    if (!rec) {
      const shellEl = document.createElement('div');
      shellEl.className = 'purge-shell' + (opts.silent ? '' : ' is-gulp-settle') + (kind === 'provider' ? ' is-provider-shell' : '');
      shellEl.dataset.shellKey = shellKey;
      const targetMeta = kind === 'provider' ? getProviderMetaFromEl(el) : null;
      let crestText = 'PURGE · 下次对话生效';
      if (kind === 'hub') crestText = 'PURGE · 全局总路由';
      else if (kind === 'provider') crestText = `PURGE · ${targetMeta.model || targetMeta.providerName || '指定模型'}`;

      shellEl.innerHTML = `
        <div class="purge-shell-ring"></div>
        <div class="purge-shell-hit top" data-shell-hit="1"></div>
        <div class="purge-shell-hit bottom" data-shell-hit="1"></div>
        <div class="purge-shell-hit left" data-shell-hit="1"></div>
        <div class="purge-shell-hit right" data-shell-hit="1"></div>
        <div class="purge-shell-crest" data-shell-hit="1">
          <span>${escapeHtml(crestText)}</span>
          <button type="button" class="purge-shell-x" title="剥离释放 Purge 胶囊">×</button>
        </div>
      `;
      dom.layer.appendChild(shellEl);
      rec = { shellKey, el, kind, targetId: el.dataset.purgeTargetId || '', shellEl, targetMeta };
      state.shells.set(shellKey, rec);
      if (!opts.silent) setTimeout(() => shellEl.classList.remove('is-gulp-settle'), 360);

      const closeBtn = shellEl.querySelector('.purge-shell-x');
      closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        releaseShell(shellKey);
      });
      shellEl.querySelectorAll('[data-shell-hit="1"]').forEach((hit) => {
        hit.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target === closeBtn) return;
          e.stopPropagation();
          closeContextMenu();
          state.drag = {
            type: 'shell-peel',
            shellKey,
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            peeled: false,
          };
        });
      });
    } else {
      rec.el = el;
    }

    const padX = kind === 'provider' ? 6 : 7;
    const padY = kind === 'provider' ? 4 : 7;
    rec.shellEl.style.left = `${(box.x - padX).toFixed(1)}px`;
    rec.shellEl.style.top = `${(box.y - padY).toFixed(1)}px`;
    rec.shellEl.style.width = `${(box.w + padX * 2).toFixed(1)}px`;
    rec.shellEl.style.height = `${(box.h + padY * 2).toFixed(1)}px`;
    return rec;
  }

  function releaseShell(shellKey, spawnX = null, spawnY = null, pointerEvent = null) {
    const rec = state.shells.get(shellKey);
    if (!rec) return null;
    const box = rectRel(rec.el, dom.rt);
    const label = removeWrapForShell(rec);
    rec.shellEl?.remove();
    state.shells.delete(shellKey);
    persistRoutingState(`已剥离 ${label}`);

    let x = spawnX;
    let y = spawnY;
    if (x == null || y == null) {
      if (box) {
        x = rec.kind === 'provider' ? Math.max(64, box.x - 54) : box.cx;
        y = rec.kind === 'provider' ? box.cy : box.bottom + 34;
      } else {
        x = 200;
        y = 200;
      }
    }
    const cap = createCapsule(x, y, { scaleX: 1.18, scaleY: 0.86 });
    const pal = getSkinPalette();
    if (cap) {
      setTimeout(() => setCapsulePos(cap, cap.x, cap.y, 0, 1, 1), 60);
      spawnRipple(cap.x, cap.y, 48, pal.ripple);
      spawnMicroParticles(cap.x, cap.y, pal.particle, 5);
      if (pointerEvent) beginCapsuleDrag(cap, pointerEvent, true);
    }
    syncAll();
    return cap;
  }

  function syncAll() {
    if (!state.enabled || !dom.rt) return;
    dom.rt.classList.add('purge-rt-host');
    dom.rt.dataset.purgeSkin = state.skin;
    hydrateDomTargets();
    syncStandbyAgents();
    refreshCapsuleSkinIcons();

    const targets = getVisibleTargetEls();
    const validKeys = new Set();

    for (const el of targets) {
      const wrapped = isElementWrapped(el);
      el.classList.toggle('purge-is-wrapped', wrapped);
      if (wrapped) {
        const key = shellKeyForEl(el);
        validKeys.add(key);
        createOrUpdateShell(el, { silent: true });
      }
    }

    for (const [key, rec] of state.shells) {
      if (!validKeys.has(key)) {
        rec.shellEl?.remove();
        state.shells.delete(key);
      }
    }

    drawPurgeWires();
    syncStatsBadge();
    checkLiveTurnBiteFlash();

    if (!state.capsules.length) {
      placeInitialCapsule();
    } else {
      for (const c of state.capsules) setCapsulePos(c, c.x, c.y, 0, 1, 1);
    }
  }

  function splitCapsule(capId) {
    const pal = getSkinPalette();
    if (state.capsules.length >= MAX_CAPSULES) {
      const cap = state.capsules.find((c) => c.id === capId);
      if (cap) spawnRipple(cap.x, cap.y, 44, pal.ripple);
      return Promise.resolve(null);
    }
    const orig = state.capsules.find((c) => c.id === capId);
    if (!orig || !dom.rt) return Promise.resolve(null);

    const r = dom.rt.getBoundingClientRect();
    const ox = orig.x;
    const oy = orig.y;
    const canHoriz = ox > 125 && ox < r.width - 125;
    const sepX = canHoriz ? 58 : 0;
    const sepY = canHoriz ? 0 : oy > r.height * 0.55 ? -44 : 44;

    const twin = createCapsule(ox, oy);
    const bridge = svgEl('path', { fill: pal.bridgeFill, opacity: 0.9, filter: `drop-shadow(0 0 8px ${pal.aura})` });
    dom.fxSvg.appendChild(bridge);

    const dur = 380;
    const t0 = performance.now();
    let snapped = false;

    return new Promise((resolve) => {
      function step(now) {
        const p = Math.min(1, (now - t0) / dur);
        const ease = p < 1 ? 1 + Math.pow(2, -10 * p) * Math.sin(((p * 10 - 0.75) * (2 * Math.PI)) / 3) * 0.22 - Math.pow(1 - p, 2.5) : 1;
        const offset = Math.min(1.12, Math.max(0, ease));
        const stretch = p < 0.65 ? 1 + 0.18 * Math.sin((p * Math.PI) / 0.65) : 1 - 0.08 * Math.sin(((p - 0.65) * Math.PI) / 0.35);
        setCapsulePos(orig, ox - sepX * offset, oy - sepY * offset, 0, stretch, 1 / Math.sqrt(stretch));
        setCapsulePos(twin, ox + sepX * offset, oy + sepY * offset, 0, stretch, 1 / Math.sqrt(stretch));

        if (p < 0.68) {
          const waist = Math.max(0.06, 0.78 * (1 - p / 0.68));
          bridge.setAttribute('d', buildMetaballBridgePath(orig.x, orig.y, twin.x, twin.y, 13, 13, waist));
          bridge.setAttribute('opacity', (0.92 * (1 - p * 0.45)).toFixed(2));
        } else if (!snapped) {
          snapped = true;
          bridge.remove();
          spawnMicroParticles((orig.x + twin.x) / 2, (orig.y + twin.y) / 2, pal.particle, 5);
        }

        if (p < 1) requestAnimationFrame(step);
        else {
          bridge.remove();
          setCapsulePos(orig, orig.x, orig.y, 0, 1, 1);
          setCapsulePos(twin, twin.x, twin.y, 0, 1, 1);
          resolve(twin);
        }
      }
      requestAnimationFrame(step);
    });
  }

  function mergeCapsules(sourceCapId, targetCapId) {
    const pal = getSkinPalette();
    const src = state.capsules.find((c) => c.id === sourceCapId);
    const dst = state.capsules.find((c) => c.id === targetCapId);
    if (!src || !dst || src.id === dst.id) return Promise.resolve();
    const startX = src.x;
    const startY = src.y;
    const dur = 170;
    const t0 = performance.now();
    src.el.style.pointerEvents = 'none';

    return new Promise((resolve) => {
      function step(now) {
        const t = Math.min(1, (now - t0) / dur);
        const ease = t * t * (3 - 2 * t);
        setCapsulePos(src, startX + (dst.x - startX) * ease, startY + (dst.y - startY) * ease, 0, 1 - t * 0.45, 1 - t * 0.45);
        src.el.style.opacity = String(1 - t * 0.6);
        if (t < 1) requestAnimationFrame(step);
        else {
          removeCapsule(sourceCapId);
          dst.el.classList.remove('is-merge-magnet', 'is-squish-merge');
          void dst.el.offsetWidth;
          dst.el.classList.add('is-squish-merge');
          setTimeout(() => dst.el.classList.remove('is-squish-merge'), 450);
          spawnRipple(dst.x, dst.y, 58, pal.ripple);
          spawnMicroParticles(dst.x, dst.y, pal.particle, 7);
          resolve(dst);
        }
      }
      requestAnimationFrame(step);
    });
  }

  function startPacManSwallow(capId, targetEl, dropX, dropY) {
    const pal = getSkinPalette();
    if (!targetEl || !dom.rt || !dom.fxSvg) return Promise.resolve();
    const shellKey = shellKeyForEl(targetEl);
    if (isElementWrapped(targetEl) || state.swallowingKeys.has(shellKey)) return Promise.resolve();

    const cap = state.capsules.find((c) => c.id === capId);
    if (!cap) return Promise.resolve();
    const cardBox = rectRel(targetEl, dom.rt);
    if (!cardBox) return Promise.resolve();

    state.swallowingKeys.add(shellKey);
    removeCapsule(capId);

    const kind = targetEl.dataset.purgeTargetKind;
    const fromLeft = dropX <= cardBox.cx;
    const isWideCard = kind === 'provider' || cardBox.w > cardBox.h * 1.8;

    if (isWideCard) {
      const pacR = clamp(cardBox.h * 0.72, 34, 54);
      const startX = fromLeft ? cardBox.x - 16 : cardBox.right + 16;
      const endX = fromLeft ? cardBox.right - 8 : cardBox.x + 8;
      const angle = fromLeft ? 0 : Math.PI;
      const fracs = fromLeft ? [0.12, 0.27, 0.42, 0.58, 0.73, 0.88] : [0.88, 0.73, 0.58, 0.42, 0.27, 0.12];
      const pellets = fracs.map((f) => {
        const px = cardBox.x + cardBox.w * f;
        const p = svgEl('circle', {
          cx: px.toFixed(1),
          cy: cardBox.cy.toFixed(1),
          r: 4.2,
          fill: pal.pelletFill,
          stroke: pal.pelletStroke,
          'stroke-width': 1.5,
          filter: `drop-shadow(0 0 6px ${pal.pktGlow})`,
        });
        dom.fxSvg.appendChild(p);
        return { el: p, x: px, eaten: false };
      });

      const curtainRect = svgEl('rect', {
        x: (fromLeft ? cardBox.x - 6 : cardBox.right + 6).toFixed(1),
        y: (cardBox.y - 4).toFixed(1),
        width: 0,
        height: (cardBox.h + 8).toFixed(1),
        rx: 13,
        ry: 13,
        fill: pal.curtainFill,
        stroke: pal.curtainStroke,
        'stroke-width': 2.2,
        opacity: 0,
        filter: `drop-shadow(0 0 12px ${pal.aura})`,
      });
      dom.fxSvg.appendChild(curtainRect);
      const pacGroup = svgEl('g');
      dom.fxSvg.appendChild(pacGroup);

      const totalDur = 720;
      const t0 = performance.now();
      let bite1 = false;
      let bite2 = false;

      return new Promise((resolve) => {
        function step(now) {
          const p = Math.min(1, (now - t0) / totalDur);
          if (p < 0.17) {
            const k = p / 0.17;
            const ease = 1 - Math.pow(1 - k, 3);
            drawPacManSvg(pacGroup, dropX + (startX - dropX) * ease, dropY + (cardBox.cy - dropY) * ease, 28 + (pacR - 28) * ease, angle, 0.42 + 0.62 * ease, 0.9);
          } else if (p < 0.78) {
            const k = (p - 0.17) / 0.61;
            const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            const cx = startX + (endX - startX) * ease;
            drawPacManSvg(pacGroup, cx, cardBox.cy, pacR, angle, 0.08 + 0.88 * Math.abs(Math.sin(k * Math.PI * 4.5)), 0.86);
            const leftEdge = cardBox.x - 6;
            const rightEdge = cardBox.right + 6;
            const curSpan = fromLeft ? clamp(cx - leftEdge, 0, cardBox.w + 12) : clamp(rightEdge - cx, 0, cardBox.w + 12);
            curtainRect.setAttribute('opacity', '1');
            curtainRect.setAttribute('x', (fromLeft ? leftEdge : rightEdge - curSpan).toFixed(1));
            curtainRect.setAttribute('width', curSpan.toFixed(1));
            if (k > 0.25 && !bite1) { bite1 = true; targetEl.classList.add('purge-chomp-squish'); }
            if (k > 0.68 && !bite2) { bite2 = true; targetEl.classList.remove('purge-chomp-squish'); void targetEl.offsetWidth; targetEl.classList.add('purge-chomp-squish'); }
            for (const pel of pellets) {
              if (!pel.eaten && ((fromLeft && cx >= pel.x - 8) || (!fromLeft && cx <= pel.x + 8))) {
                pel.eaten = true;
                pel.el.remove();
                spawnMicroParticles(pel.x, cardBox.cy, pal.particle, 4);
              }
            }
          } else {
            for (const pel of pellets) pel.el.remove();
            const k = (p - 0.78) / 0.22;
            const ease = 1 - Math.pow(1 - k, 3);
            curtainRect.setAttribute('opacity', '1');
            curtainRect.setAttribute('x', (cardBox.x - 6).toFixed(1));
            curtainRect.setAttribute('width', (cardBox.w + 12).toFixed(1));
            const alpha = 0.86 * (1 - ease);
            if (alpha > 0.04) drawPacManSvg(pacGroup, endX, cardBox.cy, pacR * (1 - ease * 0.45), angle, 0.04, alpha, false);
            else pacGroup.innerHTML = '';
          }
          if (p < 1) requestAnimationFrame(step);
          else {
            curtainRect.remove();
            pacGroup.remove();
            for (const pel of pellets) pel.el.remove();
            targetEl.classList.remove('purge-chomp-squish');
            state.swallowingKeys.delete(shellKey);
            const name = addWrapTarget(targetEl);
            createOrUpdateShell(targetEl, { silent: false });
            spawnRipple(endX, cardBox.cy, 62, pal.ripple);
            persistRoutingState(`已寄生包裹 ${name}`);
            syncAll();
            resolve();
          }
        }
        requestAnimationFrame(step);
      });
    }

    const startX = fromLeft ? cardBox.x - 30 : cardBox.right + 30;
    const angle = fromLeft ? 0 : Math.PI;
    const giantR = Math.max(cardBox.w, cardBox.h) * 0.68;
    const pelletXs = fromLeft ? [cardBox.x + cardBox.w * 0.25, cardBox.cx, cardBox.x + cardBox.w * 0.75] : [cardBox.x + cardBox.w * 0.75, cardBox.cx, cardBox.x + cardBox.w * 0.25];
    const pellets = pelletXs.map((px) => {
      const p = svgEl('circle', { cx: px.toFixed(1), cy: cardBox.cy.toFixed(1), r: 4.5, fill: pal.pelletFill, stroke: pal.pelletStroke, 'stroke-width': 1.5, filter: `drop-shadow(0 0 6px ${pal.pktGlow})` });
      dom.fxSvg.appendChild(p);
      return { el: p, x: px, eaten: false };
    });
    const pacGroup = svgEl('g');
    dom.fxSvg.appendChild(pacGroup);
    const totalDur = 560;
    const t0 = performance.now();
    let b1 = false;
    let b2 = false;

    return new Promise((resolve) => {
      function step(now) {
        const p = Math.min(1, (now - t0) / totalDur);
        if (p < 0.24) {
          const k = p / 0.24;
          const ease = 1 - Math.pow(1 - k, 3);
          drawPacManSvg(pacGroup, dropX + (startX - dropX) * ease, dropY + (cardBox.cy - dropY) * ease, 28 + (giantR - 28) * ease, angle, 0.45 + 0.63 * ease, 0.88);
        } else if (p < 0.66) {
          const k = (p - 0.24) / 0.42;
          const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const cx = startX + (cardBox.cx - startX) * ease;
          drawPacManSvg(pacGroup, cx, cardBox.cy, giantR, angle, 0.08 + 0.94 * Math.abs(Math.sin(k * Math.PI * 2)), 0.84);
          if (k > 0.22 && !b1) { b1 = true; targetEl.classList.add('purge-chomp-squish'); }
          if (k > 0.68 && !b2) { b2 = true; targetEl.classList.remove('purge-chomp-squish'); void targetEl.offsetWidth; targetEl.classList.add('purge-chomp-squish'); }
          for (const pel of pellets) {
            if (!pel.eaten && ((fromLeft && cx >= pel.x - 10) || (!fromLeft && cx <= pel.x + 10))) {
              pel.eaten = true;
              pel.el.remove();
              spawnMicroParticles(pel.x, cardBox.cy, pal.particle, 4);
            }
          }
        } else {
          for (const pel of pellets) pel.el.remove();
          const k = (p - 0.66) / 0.34;
          const ease = 1 - Math.pow(1 - k, 3);
          const curW = giantR * 2 + (cardBox.w + 14 - giantR * 2) * ease;
          const curH = giantR * 2 + (cardBox.h + 14 - giantR * 2) * ease;
          const curRx = giantR + (17 - giantR) * ease;
          const fillAlpha = 0.78 * (1 - ease * 0.78);
          pacGroup.innerHTML = '';
          pacGroup.appendChild(
            svgEl('rect', {
              x: (cardBox.cx - curW / 2).toFixed(1),
              y: (cardBox.cy - curH / 2).toFixed(1),
              width: curW.toFixed(1),
              height: curH.toFixed(1),
              rx: curRx.toFixed(1),
              ry: curRx.toFixed(1),
              fill: `rgba(${pal.morphFillRgb}, ${fillAlpha.toFixed(2)})`,
              stroke: pal.curtainStroke,
              'stroke-width': (2.5 - 0.5 * ease).toFixed(2),
              filter: `drop-shadow(0 0 16px ${pal.pktGlow})`,
            }),
          );
        }
        if (p < 1) requestAnimationFrame(step);
        else {
          pacGroup.remove();
          for (const pel of pellets) pel.el.remove();
          targetEl.classList.remove('purge-chomp-squish');
          state.swallowingKeys.delete(shellKey);
          const name = addWrapTarget(targetEl);
          createOrUpdateShell(targetEl, { silent: false });
          spawnRipple(cardBox.cx, cardBox.cy, Math.max(cardBox.w, cardBox.h) * 0.78, pal.ripple);
          persistRoutingState(`已寄生包裹 ${name}`);
          syncAll();
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  let livePacGroup = null;
  let liveBridgePath = null;
  let targetCueEl = null;

  function ensureDragHelpers() {
    const pal = getSkinPalette();
    if (!liveBridgePath && dom.fxSvg) {
      liveBridgePath = svgEl('path', { fill: pal.bridgeFill, opacity: 0.88, filter: `drop-shadow(0 0 8px ${pal.aura})` });
      dom.fxSvg.appendChild(liveBridgePath);
    }
    if (!livePacGroup && dom.fxSvg) {
      livePacGroup = svgEl('g');
      dom.fxSvg.appendChild(livePacGroup);
    }
    if (!targetCueEl && dom.layer) {
      targetCueEl = document.createElement('div');
      targetCueEl.className = 'purge-target-cue';
      targetCueEl.style.display = 'none';
      dom.layer.appendChild(targetCueEl);
    }
  }

  function clearDragHelpers() {
    liveBridgePath?.remove();
    liveBridgePath = null;
    livePacGroup?.remove();
    livePacGroup = null;
    targetCueEl?.remove();
    targetCueEl = null;
    for (const el of getVisibleTargetEls()) el.classList.remove('purge-hungry-target');
    for (const c of state.capsules) {
      c.el.classList.remove('is-merge-magnet', 'is-hidden-for-pacman');
      c.el.querySelector('.purge-cap-hint')?.remove();
    }
  }

  function findNearestTarget(x, y) {
    let best = null;
    let bestDist = Infinity;
    let bestYDelta = Infinity;
    for (const el of getVisibleTargetEls()) {
      if (isElementWrapped(el)) continue;
      const key = shellKeyForEl(el);
      if (state.swallowingKeys.has(key)) continue;
      const box = rectRel(el, dom.rt);
      if (!box) continue;
      const dist = distToBox(x, y, box);
      const maxGap = el.dataset.purgeTargetKind === 'provider' ? 32 : PACMAN_LOCK_GAP;
      const yDelta = Math.abs(y - box.cy);
      if (dist <= maxGap && (dist < bestDist - 2 || (Math.abs(dist - bestDist) <= 2 && yDelta < bestYDelta))) {
        bestDist = dist;
        bestYDelta = yDelta;
        best = { el, kind: el.dataset.purgeTargetKind, box, dist };
      }
    }
    return best;
  }

  function beginCapsuleDrag(cap, e, alreadyMoved = false) {
    const pt = clientToRt(e.clientX, e.clientY);
    state.drag = {
      type: 'capsule',
      capId: cap.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastX: pt.x,
      offsetX: cap.x - pt.x,
      offsetY: cap.y - pt.y,
      moved: alreadyMoved,
      mergeTargetId: null,
      hoverTarget: null,
      pacRaf: 0,
    };
    if (alreadyMoved) {
      cap.el.classList.add('is-dragging');
      ensureDragHelpers();
      runDragPacLoop();
    }
    try { cap.el.setPointerCapture(e.pointerId); } catch {}
  }

  function runDragPacLoop() {
    const d = state.drag;
    if (!d || d.type !== 'capsule') return;
    const cap = state.capsules.find((c) => c.id === d.capId);
    if (!cap) return;
    if (d.hoverTarget && livePacGroup) {
      const box = d.hoverTarget.box;
      const maxGap = d.hoverTarget.kind === 'provider' ? 32 : PACMAN_LOCK_GAP;
      const prox = 1 - clamp(d.hoverTarget.dist / maxGap, 0, 1);
      const rad = 26 + prox * 8;
      let aimX = box.cx;
      if (d.hoverTarget.kind === 'provider') {
        aimX = cap.x <= box.cx ? Math.min(box.right - 20, Math.max(cap.x + 48, box.x + 36)) : Math.max(box.x + 20, Math.min(cap.x - 48, box.right - 36));
      }
      const angle = Math.atan2(box.cy - cap.y, aimX - cap.x);
      const mouth = 0.22 + 0.72 * Math.abs(Math.sin(performance.now() * 0.011));
      drawPacManSvg(livePacGroup, cap.x, cap.y, rad, angle, mouth, 0.96);
    } else if (livePacGroup) {
      livePacGroup.innerHTML = '';
    }
    d.pacRaf = requestAnimationFrame(runDragPacLoop);
  }

  function findAgentElById(agentId) {
    for (const el of getVisibleTargetEls()) {
      if (el.dataset.purgeTargetKind === 'agent' && sameAgent(el.dataset.purgeTargetId || '', agentId)) {
        return el;
      }
    }
    return null;
  }

  function surfaceHistoricalAgent(agentId, withSwallow = false, originPt = null) {
    const cid = canonicalAgentId(agentId);
    if (!cid) return;
    if (!state.standbyAgents.some((x) => sameAgent(x, cid))) {
      state.standbyAgents.push(cid);
      state.animatingStandbyIds.add(cid);
    }
    syncAll();

    const targetEl = findAgentElById(cid);
    if (!withSwallow || !targetEl || isElementWrapped(targetEl)) {
      persistRoutingState(`已显示待命块 ${cid}`);
      return;
    }

    const box = rectRel(targetEl, dom.rt);
    const cap = state.capsules[0] || createCapsule(
      originPt ? originPt.x : box ? Math.min((dom.rt?.getBoundingClientRect().width || 600) - 60, box.right + 76) : 220,
      originPt ? originPt.y : box ? box.cy : 180,
    );
    if (cap) {
      setTimeout(() => startPacManSwallow(cap.id, targetEl, cap.x, cap.y), 90);
    }
  }

  function hideStandbyAgent(agentId) {
    const cid = canonicalAgentId(agentId);
    const targetEl = findAgentElById(cid);
    if (targetEl && isElementWrapped(targetEl)) {
      const sk = shellKeyForEl(targetEl);
      const rec = state.shells.get(sk);
      if (rec) {
        removeWrapForShell(rec);
        rec.shellEl?.remove();
        state.shells.delete(sk);
      }
    }
    state.standbyAgents = state.standbyAgents.filter((a) => !sameAgent(a, cid));
    persistRoutingState(`已隐藏待命块 ${cid}`);
    syncAll();
  }

  function navigateToAgentsPage() {
    if (document.body?.classList?.contains('gateway-mode')) {
      if (dom.hub && dom.rt) {
        const hb = rectRel(dom.hub, dom.rt);
        if (hb) spawnFloatingCallout(hb.cx, Math.max(24, hb.y - 12), '当前为独立网关模式，请在宿主客户端打开 Agent 页');
      }
      return false;
    }
    if (typeof window.show === 'function') {
      try {
        void window.show('agents');
        return true;
      } catch {}
    }
    const navBtn = document.querySelector('#nav button[data-view="agents"], [data-view="agents"]');
    if (navBtn && typeof navBtn.click === 'function') {
      navBtn.click();
      return true;
    }
    return false;
  }

  function openContextMenu(clientX, clientY, ctx = {}, skipRefresh = false) {
    if (!dom.ctxMenu || !dom.rt) return;
    hydrateDomTargets();
    const rtPt = clientToRt(clientX, clientY);
    const visibleAgents = new Map();
    for (const el of getVisibleTargetEls()) {
      if (el.dataset.purgeTargetKind === 'agent') {
        const cid = canonicalAgentId(el.dataset.purgeTargetId || '');
        if (!cid) continue;
        visibleAgents.set(cid, {
          el,
          standby: el.classList.contains('purge-standby-agent'),
          name: el.dataset.purgeAgentName || cid,
          route: el.dataset.purgeRoute || '',
        });
      }
    }

    const catalog = buildAgentCatalog(state.magpieAgents, state.magpieAgentOrder, visibleAgents);
    const wiredCount = catalog.filter((a) => a.wired).length;

    const recordsHtml = catalog.length
      ? catalog
          .map((a) => {
            const wrapped = state.active && state.wrappedAgents.some((x) => sameAgent(x, a.id));
            const statusText = wrapped
              ? a.onStage
                ? a.standby
                  ? '待命块 · 已吞噬注入'
                  : '活跃中 · 已吞噬注入'
                : '已预注入'
              : a.onStage
                ? a.standby
                  ? '已在画布待命 · 未注入'
                  : '当前活跃 · 未注入'
                : '已接入 · 未在画布显示';
            let btns = '';
            if (!a.onStage) {
              btns = `
                <button type="button" class="purge-ctx-btn primary" data-act="preinject" data-agent="${escapeHtml(a.id)}">预注入并显示</button>
                <button type="button" class="purge-ctx-btn" data-act="show-only" data-agent="${escapeHtml(a.id)}">仅显示块</button>
              `;
            } else if (!wrapped) {
              btns = `
                <button type="button" class="purge-ctx-btn primary" data-act="preinject" data-agent="${escapeHtml(a.id)}">立刻注入</button>
                ${a.standby ? `<button type="button" class="purge-ctx-btn" data-act="hide-agent" data-agent="${escapeHtml(a.id)}">隐藏</button>` : ''}
              `;
            } else {
              btns = `<button type="button" class="purge-ctx-btn" data-act="release-agent" data-agent="${escapeHtml(a.id)}">释放注入</button>`;
            }
            return `
              <div class="purge-ctx-rec">
                <div class="purge-ctx-rec-info">
                  <span class="purge-ctx-rec-ic" data-agent-id="${escapeHtml(a.id)}" data-agent-icon="${escapeHtml(a.icon || '')}"></span>
                  <div class="purge-ctx-rec-meta">
                    <div class="purge-ctx-rec-name">${escapeHtml(a.name)}</div>
                    <div class="purge-ctx-rec-sub">${escapeHtml(a.route || '已接入 magpie')} · ${statusText}</div>
                  </div>
                </div>
                <div class="purge-ctx-rec-btns">${btns}</div>
              </div>
            `;
          })
          .join('')
      : `<div class="purge-ctx-empty">${state.magpieStateLoaded ? '暂未检测到已接入 Magpie 的 Agent，请前往 Agent 页面开启接入' : '正在同步已接入的 Agent 列表…'}</div>`;

    const hitTarget = ctx.targetEl && !isElementWrapped(ctx.targetEl) ? ctx.targetEl : null;
    const hitShellKey = ctx.shellKey || (ctx.targetEl && isElementWrapped(ctx.targetEl) ? shellKeyForEl(ctx.targetEl) : '');
    const hitStandbyId = ctx.targetEl?.classList.contains('purge-standby-agent') ? ctx.targetEl.dataset.purgeStandbyId || '' : '';

    const actions = [];
    if (hitTarget) {
      const kind = hitTarget.dataset.purgeTargetKind;
      const label =
        kind === 'hub'
          ? '吞噬注入 Magpie 总路由'
          : kind === 'provider'
            ? `吞噬注入指定模型 · ${hitTarget.dataset.purgeModel || hitTarget.dataset.purgeProviderName || ''}`
            : `吞噬注入 ${hitTarget.dataset.purgeAgentName || 'Agent'}`;
      actions.push(`<button type="button" class="purge-ctx-action" data-act="swallow-hit"><span>${escapeHtml(label)}</span><span>●</span></button>`);
    }
    if (hitShellKey) {
      actions.push(`<button type="button" class="purge-ctx-action" data-act="bud-shell" data-shell="${escapeHtml(hitShellKey)}"><span>从此注入外壳分裂出新胶囊</span><span>+1</span></button>`);
      actions.push(`<button type="button" class="purge-ctx-action" data-act="release-shell" data-shell="${escapeHtml(hitShellKey)}"><span>剥离此目标的 Purge 注入</span><span>×</span></button>`);
    }
    if (hitStandbyId) {
      actions.push(`<button type="button" class="purge-ctx-action" data-act="hide-agent" data-agent="${escapeHtml(hitStandbyId)}"><span>移除预注入待命块</span><span>⌫</span></button>`);
    }
    actions.push(`<button type="button" class="purge-ctx-action" data-act="spawn-cap"><span>在当前位置生成新 Purge 胶囊</span><span>●</span></button>`);
    const brokenCount = state.wrappedTargets.filter(isBrokenProviderTarget).length;
    if (brokenCount > 0) {
      actions.push(`<button type="button" class="purge-ctx-action" data-act="prune-broken"><span>清理 ${brokenCount} 条失效/打码残留目标</span><span>⌫</span></button>`);
    }
    const hasAnyWrap = state.hubInject || state.wrappedAgents.length > 0 || state.wrappedTargets.length > 0;
    if (hasAnyWrap) {
      actions.push(`<button type="button" class="purge-ctx-action" data-act="clear-all"><span>清空全部路由包裹</span><span>⌫</span></button>`);
    }
    actions.push(`<button type="button" class="purge-ctx-action purge-ctx-guide" data-act="goto-agents"><span>前往「Agent」页面添加 / 接入其他 Agent</span><span class="purge-ctx-guide-go">前往 →</span></button>`);

    const subTitle = state.magpieStateLoaded
      ? `${getSkinPalette().name}皮肤 · 同步自 Agent 页 (${wiredCount} 个已接入)`
      : `${getSkinPalette().name}皮肤 · 可提前显示并预注入`;

    dom.ctxMenu.dataset.purgeSkin = state.skin;
    dom.ctxMenu.innerHTML = `
      <div class="purge-ctx-title"><span>已接入的 Agent · 预注入</span><small>${escapeHtml(subTitle)}</small></div>
      <div class="purge-ctx-records">${recordsHtml}</div>
      <div class="purge-ctx-divider"></div>
      <div class="purge-ctx-actions">${actions.join('')}</div>
    `;

    const iconByAgentId = new Map(catalog.map((a) => [a.id, a]));
    dom.ctxMenu.querySelectorAll('.purge-ctx-rec-ic').forEach((slot) => {
      const a = iconByAgentId.get(slot.dataset.agentId || '');
      slot.appendChild(createAgentIconNode(slot.dataset.agentIcon || '', a?.iconSvg || GENERIC_AGENT_SVG));
    });

    dom.ctxMenu.classList.add('is-open');
    const rect = dom.ctxMenu.getBoundingClientRect();
    dom.ctxMenu.style.left = `${clamp(clientX, 10, window.innerWidth - (rect.width || 404) - 10)}px`;
    dom.ctxMenu.style.top = `${clamp(clientY, 10, window.innerHeight - (rect.height || 360) - 10)}px`;

    dom.ctxMenu.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const agent = btn.dataset.agent || '';
        const shellKey = btn.dataset.shell || '';
        closeContextMenu();
        if (act === 'goto-agents') {
          navigateToAgentsPage();
        } else if (act === 'preinject' && agent) {
          surfaceHistoricalAgent(agent, true, rtPt);
        } else if (act === 'show-only' && agent) {
          surfaceHistoricalAgent(agent, false, rtPt);
        } else if (act === 'hide-agent' && agent) {
          hideStandbyAgent(agent);
        } else if (act === 'release-agent' && agent) {
          const el = findAgentElById(agent);
          if (el) releaseShell(shellKeyForEl(el));
          else {
            state.wrappedAgents = state.wrappedAgents.filter((x) => !sameAgent(x, agent));
            persistRoutingState(`已取消 ${agent} 预注入`);
            syncAll();
          }
        } else if (act === 'swallow-hit' && hitTarget) {
          const cap = state.capsules[0] || createCapsule(rtPt.x, rtPt.y);
          if (cap) startPacManSwallow(cap.id, hitTarget, cap.x, cap.y);
        } else if (act === 'bud-shell' && shellKey) {
          const rec = state.shells.get(shellKey);
          if (rec?.el && state.capsules.length < MAX_CAPSULES) {
            const box = rectRel(rec.el, dom.rt);
            if (box) {
              const bx = rec.kind === 'provider' ? Math.max(64, box.x - 54) : box.cx;
              const by = rec.kind === 'provider' ? box.cy : clamp(box.bottom + 34, 36, (dom.rt?.getBoundingClientRect().height || 320) - 32);
              createCapsule(bx, by, { scaleX: 1.18, scaleY: 0.86 });
              spawnRipple(bx, by, 44, getSkinPalette().ripple);
            }
          }
        } else if (act === 'release-shell' && shellKey) {
          releaseShell(shellKey);
        } else if (act === 'spawn-cap') {
          if (state.capsules.length < MAX_CAPSULES) {
            createCapsule(rtPt.x, rtPt.y);
            spawnRipple(rtPt.x, rtPt.y, 40, getSkinPalette().ripple);
          }
        } else if (act === 'prune-broken') {
          const before = state.wrappedTargets.length;
          state.wrappedTargets = state.wrappedTargets.filter((t) => !isBrokenProviderTarget(t));
          const removed = before - state.wrappedTargets.length;
          persistRoutingState(`已清理 ${removed} 条失效路由目标`);
          syncAll();
        } else if (act === 'clear-all') {
          state.hubInject = false;
          state.wrappedAgents = [];
          state.wrappedTargets = [];
          persistRoutingState('已清空全部路由定向包裹');
          syncAll();
        }
      });
    });

    if (!skipRefresh) {
      void refreshMagpieAgentsState().then((changed) => {
        if (changed && dom.ctxMenu?.classList.contains('is-open')) {
          openContextMenu(clientX, clientY, ctx, true);
        }
      });
    }
  }

  function closeContextMenu() {
    dom.ctxMenu?.classList.remove('is-open');
  }

  window.addEventListener('pointermove', (e) => {
    const d = state.drag;
    if (!d) return;
    if (d.type === 'shell-peel') {
      const rec = state.shells.get(d.shellKey);
      if (!rec) return;
      const dist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
      if (!d.peeled) {
        const px = clamp((e.clientX - d.startClientX) * 0.45, -10, 10);
        const py = clamp((e.clientY - d.startClientY) * 0.45, -10, 10);
        rec.shellEl.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) scale(1.03)`;
        if (dist > PEEL_THRESHOLD) {
          d.peeled = true;
          rec.shellEl.style.transform = '';
          const pt = clientToRt(e.clientX, e.clientY);
          releaseShell(d.shellKey, pt.x, pt.y, e);
        }
      }
      return;
    }

    if (d.type !== 'capsule') return;
    const cap = state.capsules.find((c) => c.id === d.capId);
    if (!cap) return;
    const distMoved = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
    if (!d.moved && distMoved > DRAG_THRESHOLD) {
      d.moved = true;
      cap.el.classList.add('is-dragging');
      ensureDragHelpers();
      runDragPacLoop();
    }
    if (!d.moved) return;

    const pt = clientToRt(e.clientX, e.clientY);
    const nx = pt.x + d.offsetX;
    const ny = pt.y + d.offsetY;
    const vx = clamp((nx - d.lastX) * 0.7, -14, 14);
    d.lastX = nx;
    setCapsulePos(cap, nx, ny, vx, 1, 1);

    const hit = findNearestTarget(cap.x, cap.y);
    for (const el of getVisibleTargetEls()) el.classList.toggle('purge-hungry-target', Boolean(hit && hit.el === el));

    if (hit) {
      d.hoverTarget = hit;
      d.mergeTargetId = null;
      cap.el.classList.add('is-hidden-for-pacman');
      if (liveBridgePath) liveBridgePath.setAttribute('d', '');
      for (const other of state.capsules) {
        if (other.id !== cap.id) {
          other.el.classList.remove('is-merge-magnet');
          other.el.querySelector('.purge-cap-hint')?.remove();
        }
      }
      if (targetCueEl) {
        targetCueEl.style.display = 'block';
        targetCueEl.style.left = `${hit.box.cx.toFixed(1)}px`;
        targetCueEl.style.top = `${Math.max(18, hit.box.y - 10).toFixed(1)}px`;
        targetCueEl.textContent =
          hit.kind === 'hub'
            ? '松手吞噬 Magpie 总路由'
            : hit.kind === 'provider'
              ? `松手吞噬注入模型 · ${hit.el.dataset.purgeModel || hit.el.dataset.purgeProviderName || ''}`
              : `松手吞噬注入 ${hit.el.dataset.purgeAgentName || 'Agent'}`;
      }
      return;
    }

    d.hoverTarget = null;
    cap.el.classList.remove('is-hidden-for-pacman');
    if (targetCueEl) targetCueEl.style.display = 'none';

    let bestOther = null;
    let bestDist = Infinity;
    for (const other of state.capsules) {
      if (other.id === cap.id) continue;
      const dist = Math.hypot(other.x - cap.x, other.y - cap.y);
      if (dist < bestDist) { bestDist = dist; bestOther = other; }
    }
    for (const other of state.capsules) {
      if (other.id === cap.id) continue;
      const close = Boolean(bestOther && other.id === bestOther.id && bestDist <= MERGE_ATTRACT_DIST);
      other.el.classList.toggle('is-merge-magnet', close);
      const hint = other.el.querySelector('.purge-cap-hint');
      if (bestOther && other.id === bestOther.id && bestDist <= MERGE_LOCK_DIST) {
        if (!hint) {
          const h = document.createElement('span');
          h.className = 'purge-cap-hint';
          h.textContent = '松手合并';
          other.el.appendChild(h);
        }
      } else {
        hint?.remove();
      }
    }
    if (bestOther && bestDist <= MERGE_LOCK_DIST && liveBridgePath) {
      d.mergeTargetId = bestOther.id;
      const waist = Math.max(0.28, 0.85 * (1 - bestDist / (MERGE_LOCK_DIST * 1.4)));
      liveBridgePath.setAttribute('d', buildMetaballBridgePath(cap.x, cap.y, bestOther.x, bestOther.y, 14, 14, waist));
    } else {
      d.mergeTargetId = null;
      if (liveBridgePath) liveBridgePath.setAttribute('d', '');
    }
  });

  window.addEventListener('pointerup', (e) => {
    const d = state.drag;
    if (!d) return;
    if (d.type === 'shell-peel') {
      const rec = state.shells.get(d.shellKey);
      if (rec) rec.shellEl.style.transform = '';
      if (!d.peeled) {
        const now = performance.now();
        if (state.lastShellTap.key === d.shellKey && now - state.lastShellTap.time < 320 && rec && state.capsules.length < MAX_CAPSULES) {
          state.lastShellTap = { key: null, time: 0 };
          const box = rectRel(rec.el, dom.rt);
          if (box) {
            const sx = rec.kind === 'provider' ? Math.max(64, box.x - 54) : box.cx;
            const sy = rec.kind === 'provider' ? box.cy : clamp(box.bottom + 34, 36, (dom.rt?.getBoundingClientRect().height || 320) - 32);
            const spawned = createCapsule(sx, sy, { scaleX: 1.2, scaleY: 0.85 });
            if (spawned) {
              setTimeout(() => setCapsulePos(spawned, spawned.x, spawned.y, 0, 1, 1), 60);
              spawnRipple(spawned.x, spawned.y, 44, getSkinPalette().ripple);
            }
          }
        } else {
          state.lastShellTap = { key: d.shellKey, time: now };
        }
      }
      state.drag = null;
      return;
    }

    if (d.type !== 'capsule') return;
    if (d.pacRaf) cancelAnimationFrame(d.pacRaf);
    const cap = state.capsules.find((c) => c.id === d.capId);
    const hoverTarget = d.hoverTarget;
    const mergeTargetId = d.mergeTargetId;
    const moved = d.moved;
    state.drag = null;
    clearDragHelpers();
    if (!cap) return;

    cap.el.classList.remove('is-dragging');
    setCapsulePos(cap, cap.x, cap.y, 0, 1, 1);

    if (!moved) {
      const now = performance.now();
      const dt = now - state.lastCapTap.time;
      const dist = Math.hypot(e.clientX - state.lastCapTap.x, e.clientY - state.lastCapTap.y);
      if (state.lastCapTap.id === cap.id && dt < 320 && dist < 10) {
        state.lastCapTap = { id: null, time: 0, x: 0, y: 0 };
        splitCapsule(cap.id);
      } else {
        state.lastCapTap = { id: cap.id, time: now, x: e.clientX, y: e.clientY };
      }
      return;
    }

    if (hoverTarget) startPacManSwallow(cap.id, hoverTarget.el, cap.x, cap.y);
    else if (mergeTargetId) mergeCapsules(cap.id, mergeTargetId);
  });

  window.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#purge-ctx-menu')) closeContextMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });

  window.addEventListener('fish:routing-render', () => {
    if (!state.enabled) {
      refreshPluginState();
      return;
    }
    ensureMounted();
    scheduleSync();
  });

  window.addEventListener('focus', () => refreshPluginState());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshPluginState();
  });
  window.addEventListener('resize', () => scheduleSync());

  window.__FISH_PURGE_OVERLAY_UTILS__ = {
    readUnmaskedText,
    isBrokenProviderTarget,
    sameProviderTarget,
    makeWireCurve,
    extractAgentRoute,
    buildAgentCatalog,
    canonicalAgentId,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => refreshPluginState(), { once: true });
  } else {
    refreshPluginState();
  }
})();
