// mock 的 magpie 页面桥（真品是 magpie 的 internal/gui/pagebridge.js）。
// 只实现插件页用到的那几样：ready / theme / options.get/set / onVisibility。
// 主题走 URL 参数：?theme=dark|light，默认 dark。
;(() => {
  const q = new URLSearchParams(location.search)
  const dark = (q.get('theme') || 'dark') !== 'light'
  const tokens = dark
    ? {
        bg: '#15171c', fg: '#e6e7ea', muted: '#8d93a0', card: '#1c1f26', line: '#2c313b',
        accent: '#7c8cff', 'accent-soft': '#232844', code: '#a9b1c6',
        font: '-apple-system, "Segoe UI", "Noto Sans SC", system-ui, sans-serif',
      }
    : {
        bg: '#fbfbf9', fg: '#1c1d21', muted: '#6b7280', card: '#ffffff', line: '#e3e3e6',
        accent: '#3563e9', 'accent-soft': '#e6edfd', code: '#4b5162',
        font: '-apple-system, "Segoe UI", "Noto Sans SC", system-ui, sans-serif',
      }

  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty('--magpie-' + k, v)

  // 预览里 options 只活在内存：刷新页面就回到默认值。
  // 第一次 get 时用演示快照的 options 打底——bridge 先于 catalog.js 加载，所以只能惰性取。
  const store = {
    mode: '',
    persona: '',
    agents: [],
    enabled: {},
    pinned: {},
    imports: [],
    refreshAt: 0,
    inline: [],
  }
  let seeded = false

  const api = {
    theme: { dark, lang: 'zh-CN', tokens },
    context: {},
    service: '',
    visible: true,
    ready: Promise.resolve({ dark, lang: 'zh-CN', tokens }),
    onTheme() {},
    onVisibility(fn) {
      api._vis = fn
    },
    onAction() {},
    options: {
      async get() {
        if (!seeded) {
          seeded = true
          const snapshot = window.PURGE_CATALOG?.options
          if (snapshot && typeof snapshot === 'object') Object.assign(store, snapshot)
        }
        return JSON.parse(JSON.stringify(store))
      },
      async set(next) {
        seeded = true
        Object.assign(store, JSON.parse(JSON.stringify(next || {})))
        return JSON.parse(JSON.stringify(store))
      },
    },
    read: async () => ({}),
  }
  window.magpie = api
})()