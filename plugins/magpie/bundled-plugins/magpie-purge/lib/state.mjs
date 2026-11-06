// 扫描结果的落盘与刷新：把「本地 purge 目录」变成两份产物。
//
//   state/catalog.json  ← 完整条目表（含正文），只给 hooks.js 读
//   page/catalog.js     ← 页面快照（window.PURGE_CATALOG，不含正文），页面用 <script> 读
//
// 页面在沙箱帧里，不能 fetch、不能读盘；所以「后端 → 页面」的唯一通道就是 page/ 下这份脚本。
// 页面侧的「导入」也走同一条思路：把要导入的路径写进 options.imports，宿主重启插件后
// 这里（Bun 侧）把文件复制进 state/imports，再重新扫描，页面下次刷新就看到结果。
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, normalize } from 'node:path'
import {
  LIMITS,
  defaultSources,
  expandHome,
  mergeEntries,
  scan,
  snapshotOf,
} from './inventory.mjs'
import { readState } from './agentpurge.mjs'
import { bundled as bundledScan } from './bundled.mjs'
import { resolve as resolvePlan } from './plan.mjs'

const IMPORT_EXT = new Set(['.zip', '.md', '.markdown', '.txt', '.json'])

export function paths(here) {
  return {
    here,
    stateDir: join(here, 'state'),
    importsDir: join(here, 'state', 'imports'),
    catalogFile: join(here, 'state', 'catalog.json'),
    lastFile: join(here, 'state', 'last.json'),
    snapshotFile: join(here, 'page', 'catalog.js'),
  }
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

const sha = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

/** sourceSignature 是「这次要不要重扫」的判断依据：目录 mtime + 导入请求 + 强制刷新戳 + 包内专家。 */
function sourceSignature(sources, imports = [], refreshAt = 0, bundledEntries = []) {
  const stamps = []
  for (const dir of sources) {
    try {
      const st = statSync(dir)
      stamps.push(`${dir}:${st.mtimeMs}`)
    } catch {
      stamps.push(`${dir}:missing`)
    }
  }
  const own = bundledEntries.map((e) => `${e.id}:${e.digest}`).join(',')
  return sha([...stamps, imports.map((i) => `${i.path}@${i.at}`).join(','), refreshAt, own].join('|'))
}

/**
 * loadCatalog 读上一次的完整条目表；没有就当成空的。
 */
export function loadCatalog(p) {
  return readJson(p.catalogFile, { version: 0, generatedAt: 0, entries: [], sources: [], rejected: [], imports: [] })
}

/** lastApplied 是 hooks 记下的最近一次改写记录；页面用它回答「上一次生效是什么时候」。 */
export function loadLast(p) {
  return readJson(p.lastFile, null)
}

/**
 * ownOptions 从 magpie 自己的 plugins.json 里读回「这个插件」的 options。
 *
 * 为什么需要它：网关钩子的 onRequest 只有真的来了请求才会被调用，而插件页要能
 * 在没有任何流量时也显示条目。宿主在改 options 后会重建插件宿主进程（我们的
 * 模块随之重新加载），所以模块加载时读一次 plugins.json 就能拿到最新设置。
 *
 * 找不到就返回 null，让调用方退回默认来源；读不到不算错。
 */
export function ownOptions(here, env = process.env) {
  const dirs = []
  const xdg = String(env.XDG_CONFIG_HOME || '').trim()
  if (xdg) dirs.push(join(xdg, 'magpie'))
  dirs.push(join(homedir(), '.config', 'magpie'))
  const want = normalize(here).toLowerCase()
  for (const dir of dirs) {
    const file = join(dir, 'plugins.json')
    if (!existsSync(file)) continue
    const data = readJson(file, null)
    const rows = Array.isArray(data?.plugins) ? data.plugins : []
    for (const row of rows) {
      if (!row || typeof row.spec !== 'string') continue
      const spec = expandHome(row.spec, dir).toLowerCase()
      if (spec !== want) continue
      return row.options && typeof row.options === 'object' ? row.options : {}
    }
  }
  return null
}

/**
 * sync 重新清点来源目录，必要时处理导入请求，然后写两份产物。
 * @returns {{ catalog: object, changed: boolean, snapshot: object }}
 */
export function sync(here, options = {}, { force = false, limits = LIMITS, now = Date.now() } = {}) {
  const p = paths(here)
  mkdirSync(p.stateDir, { recursive: true })
  mkdirSync(p.importsDir, { recursive: true })

  const configured = Array.isArray(options.sources) ? options.sources.filter((s) => typeof s === 'string' && s.trim()) : []
  const sources = configured.length ? configured : defaultSources()
  const imports = Array.isArray(options.imports) ? options.imports.filter((i) => i && typeof i.path === 'string') : []
  const previous = loadCatalog(p)
  // 包内专家技能先读出来：它们随包走，签名也要算进它们，
  // 否则插件更新后（新增/改写专家）会因为「来源没变」而一直用旧表。
  const bundledRows = bundledScan(here)
  const signature = sourceSignature(sources, imports, options.refreshAt ?? 0, bundledRows.entries)

  if (!force && previous.signature === signature) {
    return { catalog: previous, changed: false, snapshot: snapshotFrom(p, previous, options, now) }
  }

  const importRows = applyImports(p, imports, previous, now)
  // 导入的副本本身就是一个来源目录：放在最前面，页面能看到「来源：导入」。
  const scanned = scan([p.importsDir, ...sources], { limits, now })
  const { entries: scannedEntries, duplicates } = mergeEntries(scanned.entries, previous.entries)
  // 包内专家技能永远在场：不参与「来源」的增删，也不吃版本号（它随包走，不是用户导入的）。
  const entries = [...bundledRows.entries, ...scannedEntries]
  // 重复不算「拒绝」：同一个目录每次重扫都会碰上它们，写进拒绝记录会把真正的问题埋掉。
  const rejected = scanned.rejected

  const catalog = {
    version: (previous.version || 0) + 1,
    generatedAt: now,
    signature,
    sources: [...(bundledRows.ok ? [{ path: bundledRows.dir, ok: true, count: bundledRows.entries.length, error: '', bundled: true }] : []), ...scanned.sources],
    entries,
    rejected,
    duplicates: duplicates.map((d) => ({ name: d.name, rel: d.source.rel, root: d.source.root })),
    imports: importRows,
  }
  writeFileSync(p.catalogFile, JSON.stringify(catalog, null, 2), 'utf8')
  const snapshot = snapshotFrom(p, catalog, options, now)
  writeSnapshot(p, snapshot)
  return { catalog, changed: true, snapshot }
}

/** snapshotFrom 合成页面快照：条目元数据 + 当前设置 + 「这次会注入什么」的判定。 */
export function snapshotFrom(p, catalog, options, now = Date.now()) {
  const snap = snapshotOf(catalog.entries, catalog.sources, catalog.rejected, {
    version: catalog.version,
    now: catalog.generatedAt || now,
    options: pickOptions(options),
  })
  snap.imports = catalog.imports || []
  snap.duplicates = catalog.duplicates || []
  snap.last = loadLast(p)
  // 页面要能回答「现在到底注不注入、注谁、为什么没注」：这里就把答案算好
  const usable = (catalog.entries || []).filter((e) => e.status === 'ok' && e.injectable && typeof e.text === 'string' && e.text.trim())
  const state = readState()
  snap.purge = { bound: state.bound, mode: state.mode, persona: state.persona, disabled: state.disabled, error: state.error }
  snap.plan = resolvePlan({ options, state, entries: usable })
  return snap
}

function pickOptions(options) {
  const out = {}
  for (const key of ['mode', 'persona', 'agents', 'enabled', 'pinned', 'sources', 'gatewayTimeoutMs']) {
    if (options?.[key] !== undefined) out[key] = options[key]
  }
  return out
}

function writeSnapshot(p, snapshot) {
  const body = `window.PURGE_CATALOG = ${JSON.stringify(snapshot, null, 2)};\n`
  try {
    writeFileSync(p.snapshotFile, body, 'utf8')
  } catch {
    /* 装到只读目录时写不进去：页面会显示「快照缺失」，不要让请求跟着挂 */
  }
}

/**
 * applyImports 处理 options.imports 里的请求：复制进 state/imports 或删除副本。
 * 只认白名单后缀，复制前再判一次大小；失败把原因留在结果里，页面显示，不静默吞掉。
 */
export function applyImports(p, imports, previous, now) {
  const done = new Set((previous.imports || []).map((r) => `${r.path}@${r.at}`))
  const rows = Array.isArray(previous.imports) ? previous.imports.filter((r) => r && r.keep) : []
  for (const req of imports) {
    const key = `${req.path}@${req.at}`
    if (done.has(key)) continue
    const op = req.op === 'delete' ? 'delete' : 'import'
    const row = { path: req.path, at: req.at, op, ok: false, error: '', file: '', keep: false }
    try {
      if (op === 'delete') {
        row.ok = removeImport(p, req.path)
        row.error = row.ok ? '' : '没有找到这条导入的副本'
      } else {
        row.file = importFile(p, req.path)
        row.ok = Boolean(row.file)
        row.error = row.ok ? '' : `只接受 ${[...IMPORT_EXT].join(' / ')} 文件`
        row.keep = row.ok
      }
    } catch (error) {
      row.error = error?.message || String(error)
    }
    rows.push(row)
  }
  return rows
}

function importFile(p, rawPath) {
  const src = String(rawPath).trim()
  if (!src) throw new Error('空路径')
  const ext = extname(src).toLowerCase()
  if (!IMPORT_EXT.has(ext)) return ''
  const st = statSync(src)
  if (!st.isFile()) throw new Error('不是文件')
  if (st.size > LIMITS.fileBytes) throw new Error(`文件超过 ${LIMITS.fileBytes / 1024} KiB 上限`)
  const digest = sha(`${st.size}:${st.mtimeMs}:${src}`)
  const target = join(p.importsDir, `${digest}${ext}`)
  if (!existsSync(target)) copyFileSync(src, target)
  return target
}

function removeImport(p, rawPath) {
  const base = basename(String(rawPath).trim())
  const target = join(p.importsDir, base)
  if (!existsSync(target)) return false
  if (!readdirSync(p.importsDir).includes(base)) return false
  rmSync(target, { force: true })
  return true
}