#!/usr/bin/env node
// 离线清点：不装进 magpie、不开 magpie，也能把 purge 目录扫一遍并写出快照。
//
//   node tools/scan.mjs                       # 用默认来源（~/.agent-purge、~/.magpie/purge）
//   node tools/scan.mjs --sources "D:\pa,D:\pb" --mode strict --persona anima
//   node tools/scan.mjs --json                # 只把条目表打到 stdout，不写文件
//
// 预览（preview/serve.mjs）用的就是它：同一条扫描路径，避免「预览一套、真跑另一套」。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS } from '../lib/inventory.mjs'
import { sync } from '../lib/state.mjs'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = { sources: [], mode: '', persona: '', json: false, force: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a === '--sources') out.sources.push(...String(argv[++i] || '').split(';').map((s) => s.replace(/^,+|,+$/g, '').trim()).filter(Boolean))
    else if (a === '--mode') out.mode = String(argv[++i] || '').trim()
    else if (a === '--persona') out.persona = String(argv[++i] || '').trim()
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const options = {
  sources: args.sources,
  mode: args.mode || 'off',
  persona: args.persona,
  imports: [],
  refreshAt: Date.now(),
}
const { catalog, snapshot } = sync(here, options, { force: args.force })

if (args.json) {
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n')
  process.exit(0)
}

const lines = []
lines.push(`# Purge in Magpie · 清点 ${new Date(catalog.generatedAt).toLocaleString('zh-CN')}`)
lines.push('')
lines.push('## 来源')
for (const s of snapshot.sources) lines.push(`- ${s.path}${s.ok ? `：${s.count} 条` : `：${s.error}`}`)
lines.push('')
lines.push('## 条目（' + snapshot.entries.length + '）')
for (const e of snapshot.entries) {
  const size = e.size >= 1048576 ? `${(e.size / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(e.size / 1024))} KiB`
  lines.push(`- [${e.kind}] ${e.name} · ${size} · v${e.version} · ${e.source.rel}`)
}
if (snapshot.rejected.length) {
  lines.push('')
  lines.push('## 拒绝（' + snapshot.rejected.length + '）')
  for (const r of snapshot.rejected) lines.push(`- ${r.name}：${r.reason}`)
}
lines.push('')
lines.push(`快照：${join(here, 'page', 'catalog.js')}`)
lines.push(`条目表：${join(here, 'state', 'catalog.json')}`)
console.log(lines.join('\n'))

const kinds = new Map()
for (const e of snapshot.entries) kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1)
console.log('\n类型分布：' + [...kinds].map(([k, n]) => `${KINDS[k] || k} ${n}`).join(' · '))