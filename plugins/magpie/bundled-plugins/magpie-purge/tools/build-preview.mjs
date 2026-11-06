// build-preview：把插件页压成一个能直接双击打开的单文件 HTML。
//
// 为什么要有这个：`preview/serve.mjs` 要起服务、要开端口，给别人看界面时多两步。
// 单文件版把 index.html + style.css + app.js + mock 桥 + 演示快照全部内联，
// 双击就能看，还能切主题、切「就绪 / 未就绪」两种状态。
//
//   node tools/build-preview.mjs
//   → preview/purge-preview.html
//
// 生成物是派生文件：改完 page/ 要重新跑一次，别手改它。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...p) => readFileSync(join(here, ...p), 'utf8')

const html = read('page', 'index.html')
const css = read('page', 'style.css')
const app = read('page', 'app.js')
const bridge = read('preview', 'bridge.js')
const icon = read('page', 'icon.svg')
const ready = read('preview', 'catalog.demo.js')
const blocked = read('preview', 'catalog.blocked.js')

// 图标内联成 data URI：单文件不能有外部依赖，file:// 下取子文件会被拦。
const iconUri = `data:image/svg+xml;base64,${Buffer.from(icon, 'utf8').toString('base64')}`

// 两份快照都把 window.PURGE_CATALOG 改名为各自的变量，文件里的注释原样保留。
const rename = (text, name) => text.replaceAll('window.PURGE_CATALOG', `window.${name}`)

// 单文件里参数走 hash（#theme=light&snap=blocked）：
// file:// 下的 ?query 在部分场合会被当成文件名的一部分，hash 则稳定可用。
const catalogBlock = `
;(() => {
  const pick = () => {
    const q = new URLSearchParams(location.hash.slice(1) || location.search.slice(1))
    return { theme: q.get('theme') === 'light' ? 'light' : 'dark', snap: q.get('snap') === 'blocked' ? 'blocked' : 'ready' }
  }
  const { snap } = pick()
  window.PURGE_CATALOG = snap === 'blocked' ? window.__PURGE_BLOCKED__ : window.__PURGE_READY__
  window.__PURGE_PICK__ = pick
})()
`

// 顶部控制条：单文件里没有 magpie 外壳，给两个开关，免得全靠手改 URL。
const chrome = `
<div class="pv-bar" role="region" aria-label="预览控制">
  <b>破甲 · Purge</b>
  <span class="pv-hint">单文件预览：数据是演示快照，不跑网关、不写设置</span>
  <label>主题
    <select id="pv-theme">
      <option value="dark">深色</option>
      <option value="light">浅色</option>
    </select>
  </label>
  <label>状态
    <select id="pv-snap">
      <option value="ready">就绪</option>
      <option value="blocked">未就绪</option>
    </select>
  </label>
</div>
<script>
;(() => {
  const q = new URLSearchParams(location.hash.slice(1) || location.search.slice(1))
  const theme = document.getElementById('pv-theme')
  const snap = document.getElementById('pv-snap')
  theme.value = q.get('theme') === 'light' ? 'light' : 'dark'
  snap.value = q.get('snap') === 'blocked' ? 'blocked' : 'ready'
  const go = () => {
    const next = new URLSearchParams()
    next.set('theme', theme.value)
    next.set('snap', snap.value)
    location.hash = next.toString()
    location.reload()
  }
  theme.onchange = go
  snap.onchange = go

  // #row=N 直接打开某条的详情，省得每次都手点
  const row = q.get('row')
  if (row !== null) {
    addEventListener('load', () => setTimeout(() => {
      document.querySelectorAll('#list .row')[Number(row)]?.click()
    }, 120))
  }
})()
</script>
`

const out = html
  // 外链资源换成内联
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n/* ---- 预览控制条 ---- */\n.pv-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid var(--line);background:var(--card);font:12px/1.4 var(--magpie-font,system-ui);color:var(--ink)}
.pv-bar b{font-size:13px;font-weight:600}
.pv-hint{color:var(--muted);margin-right:auto}
.pv-bar label{display:flex;align-items:center;gap:6px;color:var(--muted)}
.pv-bar select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 6px}
</style>`)
  .replace('<script src="_magpie/bridge.js"></script>', `<script>\n${bridge.replace(
    'new URLSearchParams(location.search)',
    // 单文件用 hash 传参，桥也跟着读 hash
    "new URLSearchParams(location.hash.slice(1) || location.search.slice(1))",
  )}\n</script>`)
  .replace('<script src="catalog.js"></script>', `<script>\n${rename(ready, '__PURGE_READY__')}\n</script>\n<script>\n${rename(blocked, '__PURGE_BLOCKED__')}\n</script>\n<script>${catalogBlock}</script>`)
  // app.js 原本是 defer：内联到 <head> 里会赶在 DOM 之前跑，什么都取不到。
  // 所以从这个位置摘掉，放到 </body> 前。
  .replace('<script src="app.js" defer></script>', '')
  .replace('</body>', `<script>\n${app}\n</script>\n</body>`)
  .replace('src="icon.svg"', `src="${iconUri}"`)
  .replace('<body>', `<body>\n${chrome}`)
  .replace('<title>破甲 · Purge</title>', '<title>破甲 · Purge（单文件预览）</title>')

writeFileSync(join(here, 'preview', 'purge-preview.html'), out, 'utf8')
console.log(`preview/purge-preview.html  ${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(1)} KiB`)