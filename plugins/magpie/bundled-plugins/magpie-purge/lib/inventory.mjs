// 本地 purge 目录的「清点」：把目录里的东西逐个判型、校验、算摘要，产出页面与钩子都能用的条目表。
//
// 这里不执行任何导入件里的代码，也不把 ZIP 解压到磁盘：只读、只取需要的文本。
// 判型顺序（第一个命中即为结果）：
//   1. ZIP 里有 manifest.json 且 format=dsh-session-archive → 会话导出包
//   2. ZIP/目录里有 package.json（带 dsh 字段）或 cordis.patch.yml  → DSH 插件包
//   3. ZIP 里有人设/技能清单，或目录里有 *.md                     → 人设 / 技能
//   4. 单文件 .md/.markdown/.txt                                   → 人设 / 技能 / 文本
//   5. 单文件 .json                                                → 清单
// 其余一律记成「拒绝」，并把原因原样交给页面。
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { readZip } from './zip.mjs'

/** 上限：宁可拒绝一个离谱的包，也不让插件在别人机器上吃满内存。 */
export const LIMITS = {
  fileBytes: 8 * 1024 * 1024,
  archiveBytes: 64 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  entryCount: 200,
  depth: 3,
  textBytes: 64 * 1024,
}

export const KINDS = {
  'session-archive': '会话导出包',
  'cordis-plugin': 'DSH 插件包',
  persona: '人设',
  skill: '技能',
  manifest: '清单',
  text: '文本',
}

/** 能写进 system 段的类型。其余类型只做素材登记，不参与改写。 */
export const INJECTABLE = new Set(['persona', 'skill', 'text'])

/** expandHome 把 `~` 展开成本机家目录；其余路径按调用方给的基准解析。 */
export function expandHome(p, base = process.cwd()) {
  const raw = String(p ?? '').trim()
  if (!raw) return ''
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2))
  return isAbsolute(raw) ? normalize(raw) : resolve(base, raw)
}

/** defaultSources 是没配 sources 时看的目录：agent-purge 自己的家，以及 magpie 配置下的 purge。 */
export function defaultSources(env = process.env) {
  const out = []
  const fromEnv = String(env.PURGE_HOME || env.AGENT_PURGE_HOME || '').trim()
  if (fromEnv) out.push(fromEnv)
  out.push(join(homedir(), '.agent-purge'))
  out.push(join(homedir(), '.magpie', 'purge'))
  return out
}

export const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** slug 让名字变成稳定的 id 片段：只留字母数字与 ._-，全非 ASCII 时退回摘要前缀。 */
export function slug(name) {
  const base = basename(String(name ?? '')).replace(/\.[^.]+$/, '')
  const ascii = base
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toLowerCase()
  return ascii || 'item'
}

/** frontmatter 拆出 YAML 头（只认一层 key: value，够人设/技能清单用）。 */
export function frontmatter(raw) {
  const text = String(raw ?? '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const fields = {}
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
      if (!kv) continue
      fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
    }
  }
  return { fields, body: m ? text.slice(m[0].length).trim() : text.trim() }
}

/** kindOfText 决定一份 markdown 是人设、技能还是普通文本。 */
function kindOfText(fields, body) {
  const declared = String(fields.kind || '').toLowerCase()
  if (declared === 'persona' || declared === 'skill') return declared
  if (fields.id) return 'persona'
  if (fields.name && (fields.description || body.includes('\n## '))) return 'skill'
  return 'text'
}

/**
 * scan 清点一组来源目录。
 * @returns {{ entries: object[], sources: object[], rejected: object[] }}
 */
export function scan(sources, { limits = LIMITS, now = Date.now() } = {}) {
  const entries = []
  const rejected = []
  const sourceRows = []
  const seenDirs = new Set()

  for (const raw of sources) {
    const dir = expandHome(raw)
    if (!dir) continue
    const row = { path: dir, ok: false, count: 0, error: '' }
    sourceRows.push(row)
    let st
    try {
      st = statSync(dir)
    } catch {
      row.error = '目录不存在或没有权限'
      continue
    }
    if (!st.isDirectory()) {
      row.error = '不是目录'
      continue
    }
    if (seenDirs.has(dir)) continue
    seenDirs.add(dir)
    try {
      walk(dir, dir, 0, { entries, rejected, limits, now, row })
      row.ok = true
    } catch (error) {
      row.error = error?.message || String(error)
    }
    row.count = entries.filter((e) => e.source.root === dir).length
  }
  return { entries, sources: sourceRows, rejected }
}

function walk(root, dir, depth, ctx) {
  let names
  try {
    names = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    ctx.rejected.push(reject(join(dir, ''), `${dir} 读不动：${error?.message || error}`, ctx.now))
    return
  }
  for (const dirent of names) {
    if (ctx.entries.length >= ctx.limits.entryCount) return
    const name = dirent.name
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(dir, name)
    if (dirent.isDirectory()) {
      const bundle = bundleOf(full)
      if (bundle) {
        ctx.entries.push(entryOfBundle(root, full, bundle, ctx.now))
        continue
      }
      if (depth < ctx.limits.depth) walk(root, full, depth + 1, ctx)
      continue
    }
    if (!dirent.isFile()) continue
    const ext = extname(name).toLowerCase()
    if (ext === '.zip') {
      inspectZip(root, full, ctx)
      continue
    }
    if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
      inspectText(root, full, ctx)
      continue
    }
    if (ext === '.json') {
      inspectJson(root, full, ctx)
      continue
    }
    // 其余后缀不进清单：插件不认得的东西就不要在页面上装成「已导入」。
  }
}

/** bundleOf 判断一个目录是不是「DSH 插件包」形状：package.json 带 dsh 字段，或有 cordis.patch.yml。 */
export function bundleOf(dir) {
  const pkgFile = join(dir, 'package.json')
  let pkg = null
  try {
    pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  } catch {
    pkg = null
  }
  const hasPatch = exists(join(dir, 'cordis.patch.yml')) || exists(join(dir, 'cordis.patch.yaml'))
  if (!pkg?.dsh && !hasPatch) return null
  return {
    name: typeof pkg?.name === 'string' && pkg.name ? pkg.name : basename(dir),
    version: typeof pkg?.version === 'string' ? pkg.version : '',
    description: typeof pkg?.description === 'string' ? pkg.description : '',
    hasClient: Boolean(pkg?.dsh?.client),
    hasPatch,
  }
}

function entryOfBundle(root, dir, bundle, now) {
  const files = listFiles(dir, 0, 2)
  return {
    id: slug(bundle.name || basename(dir)),
    name: bundle.name || basename(dir),
    kind: 'cordis-plugin',
    status: 'ok',
    reason: '',
    source: { root, rel: relOf(root, dir) },
    size: files.reduce((n, f) => n + f.size, 0),
    digest: digestOf(Buffer.from(`${bundle.name}|${bundle.version}|${files.map((f) => f.rel).join(',')}`)),
    importedAt: now,
    meta: { format: 'dsh-plugin', version: bundle.version, description: bundle.description, files: files.length },
    chars: 0,
    injectable: false,
  }
}

function inspectZip(root, file, ctx) {
  let st
  try {
    st = statSync(file)
  } catch (error) {
    ctx.rejected.push(reject(file, `读不到：${error?.message || error}`, ctx.now))
    return
  }
  if (st.size > ctx.limits.archiveBytes) {
    ctx.rejected.push(reject(file, `压缩包 ${(st.size / 1048576).toFixed(1)} MiB，超过 ${ctx.limits.archiveBytes / 1048576} MiB 上限`, ctx.now, { root }))
    return
  }
  const zip = readZip(readFileSync(file))
  if (!zip.ok) {
    ctx.rejected.push(reject(file, zip.error, ctx.now, { root }))
    return
  }
  const names = zip.entries.map((e) => e.name)
  const digest = digestOf(readFileSync(file))

  // ① 会话导出包：manifest.json + 至少一个 .jsonl
  const manifestEntry = zip.entries.find((e) => e.name === 'manifest.json')
  if (manifestEntry) {
    let manifest = null
    try {
      manifest = JSON.parse(manifestEntry.read().toString('utf8'))
    } catch {
      manifest = null
    }
    if (manifest?.format === 'dsh-session-archive') {
      const problem = validateArchive(manifest, names)
      if (problem) {
        ctx.rejected.push(reject(file, problem, ctx.now, { root, digest }))
        return
      }
      ctx.entries.push({
        id: slug(manifest.root?.title || basename(file)),
        name: manifest.root?.title || basename(file),
        kind: 'session-archive',
        status: 'ok',
        reason: '',
        source: { root, rel: relOf(root, file) },
        size: st.size,
        digest,
        importedAt: ctx.now,
        meta: {
          format: 'dsh-session-archive',
          version: manifest.version ?? 1,
          sessions: Array.isArray(manifest.sessions) ? manifest.sessions.length : 1,
          turns: Array.isArray(manifest.selection?.turns) ? manifest.selection.turns.length : 0,
          cwd: manifest.root?.cwd || '',
        },
        chars: 0,
        injectable: false,
      })
      return
    }
  }

  // ② ZIP 形态的 DSH 插件包：<dir>/package.json 带 dsh，或有 cordis.patch.yml
  const pkgEntry = zip.entries.find((e) => /^[^/]+\/package\.json$/.test(e.name))
  if (pkgEntry) {
    let pkg = null
    try {
      pkg = JSON.parse(pkgEntry.read().toString('utf8'))
    } catch {
      pkg = null
    }
    const patch = names.some((n) => /cordis\.patch\.ya?ml$/.test(n))
    if (pkg?.dsh || patch) {
      ctx.entries.push({
        id: slug(pkg?.name || basename(file)),
        name: pkg?.name || basename(file),
        kind: 'cordis-plugin',
        status: 'ok',
        reason: '',
        source: { root, rel: relOf(root, file) },
        size: st.size,
        digest,
        importedAt: ctx.now,
        meta: { format: 'dsh-plugin', version: pkg?.version || '', description: pkg?.description || '', files: names.length },
        chars: 0,
        injectable: false,
      })
      return
    }
  }

  // ③ 人设/技能包：ZIP 里的 *.md，逐个成条
  const mds = zip.entries.filter((e) => /\.(md|markdown)$/i.test(e.name) && e.size <= ctx.limits.fileBytes)
  if (mds.length) {
    for (const e of mds.slice(0, 50)) {
      if (ctx.entries.length >= ctx.limits.entryCount) break
      const bytes = e.read()
      const { fields, body } = frontmatter(bytes.toString('utf8'))
      const kind = kindOfText(fields, body)
      if (!INJECTABLE.has(kind)) continue
      ctx.entries.push(makeTextEntry(root, `${relOf(root, file)}#${e.name}`, kind, fields, body, {
        size: e.size,
        digest: digestOf(bytes),
        now: ctx.now,
        meta: { format: 'zip-markdown', from: basename(file) },
      }))
    }
    return
  }

  ctx.rejected.push(reject(file, 'ZIP 里没有可识别的清单、插件包或人设/技能', ctx.now, { root, digest }))
}

/** validateArchive 只看清单字段与路径安全：不读会话正文，也不校验会话本身。 */
export function validateArchive(manifest, names) {
  if (!manifest || typeof manifest !== 'object') return 'manifest.json 不是对象'
  if (manifest.version !== undefined && typeof manifest.version !== 'number') return 'manifest.version 必须是数字'
  const rootPath = String(manifest.rootPath || '')
  if (!rootPath) return 'manifest 缺少 rootPath'
  if (!names.includes(rootPath)) return `manifest.rootPath 指向的 ${rootPath} 不在包里`
  if (!Array.isArray(manifest.sessions) || manifest.sessions.length === 0) return 'manifest 没有 sessions'
  for (const s of manifest.sessions) {
    if (!s || typeof s.path !== 'string' || !s.path) return 'sessions 里有一条缺 path'
    if (!names.includes(s.path)) return `sessions 指向的 ${s.path} 不在包里`
  }
  return ''
}

function inspectText(root, file, ctx) {
  let st
  try {
    st = statSync(file)
  } catch (error) {
    ctx.rejected.push(reject(file, `读不到：${error?.message || error}`, ctx.now))
    return
  }
  if (st.size > ctx.limits.fileBytes) {
    ctx.rejected.push(reject(file, `文件 ${(st.size / 1024).toFixed(0)} KiB，超过 ${ctx.limits.fileBytes / 1024} KiB 上限`, ctx.now, { root }))
    return
  }
  const bytes = readFileSync(file)
  const { fields, body } = frontmatter(bytes.toString('utf8'))
  const kind = kindOfText(fields, body)
  ctx.entries.push(makeTextEntry(root, relOf(root, file), kind, fields, body, {
    size: st.size,
    digest: digestOf(bytes),
    now: ctx.now,
    meta: { format: 'markdown' },
  }))
}

function inspectJson(root, file, ctx) {
  let st
  try {
    st = statSync(file)
  } catch {
    return
  }
  if (st.size > ctx.limits.fileBytes) {
    ctx.rejected.push(reject(file, '清单超过大小上限', ctx.now, { root }))
    return
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    ctx.rejected.push(reject(file, `JSON 坏了：${error?.message || error}`, ctx.now, { root }))
    return
  }
  if (parsed?.format === 'dsh-session-archive') {
    // 只有清单、没有会话文件：登记但说明它不能单独使用
    ctx.rejected.push(reject(file, '只有会话清单，缺 session.v4.jsonl；请导入完整导出包', ctx.now, { root }))
    return
  }
  // agent-purge 自己的控制面文件不是素材：它决定「注不注、注谁」，已经由 agentpurge 那条路读了。
  // 列进条目表会让页面看起来像「导入了一个清单」，实际什么也不会发生。
  if (basename(file) === 'state.json' && (parsed?.default || parsed?.overrides || parsed?.persona)) {
    return
  }
  ctx.entries.push({
    id: slug(basename(file)),
    name: typeof parsed?.name === 'string' ? parsed.name : basename(file),
    kind: 'manifest',
    status: 'ok',
    reason: '',
    source: { root, rel: relOf(root, file) },
    size: st.size,
    digest: digestOf(readFileSync(file)),
    importedAt: ctx.now,
    meta: { format: 'json' },
    chars: 0,
    injectable: false,
  })
}

function makeTextEntry(root, rel, kind, fields, body, { size, digest, now, meta }) {
  const text = body.slice(0, LIMITS.textBytes)
  return {
    id: slug(fields.id || fields.name || basename(rel)),
    name: String(fields.name || fields.id || basename(rel).replace(/\.[^.]+$/, '')),
    kind,
    status: 'ok',
    reason: '',
    source: { root, rel },
    size,
    digest,
    importedAt: now,
    meta: { ...meta, description: String(fields.description || ''), version: String(fields.version || '') },
    chars: text.length,
    injectable: true,
    text,
  }
}

function reject(file, reason, now, extra = {}) {
  return { name: basename(String(file)), path: String(file), reason, at: now, ...extra }
}

function relOf(root, full) {
  const rel = full.slice(root.length).replace(/^[\\/]+/, '')
  return rel || basename(full)
}

function exists(p) {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

function listFiles(dir, depth, maxDepth) {
  const out = []
  let names
  try {
    names = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const d of names) {
    const full = join(dir, d.name)
    if (d.isFile()) {
      try {
        out.push({ rel: full.slice(dir.length + 1), size: statSync(full).size })
      } catch {
        /* 读不到就当没有 */
      }
    } else if (d.isDirectory() && depth < maxDepth) {
      out.push(...listFiles(full, depth + 1, maxDepth))
    }
  }
  return out
}

/**
 * mergeEntries 把这次扫描的结果与上一次的条目表合并：同摘要算重复，同 id 新摘要算新版本。
 * @param {object[]} fresh 本次扫描到的条目（带 text）
 * @param {object[]} previous 上一次的条目表
 */
export function mergeEntries(fresh, previous = []) {
  const byDigest = new Map(previous.map((e) => [e.digest, e]))
  const byId = new Map()
  for (const e of previous) {
    if (!byId.has(e.id)) byId.set(e.id, [])
    byId.get(e.id).push(e)
  }
  const merged = []
  const duplicates = []
  for (const entry of fresh) {
    const hit = byDigest.get(entry.digest)
    if (hit) {
      duplicates.push({ ...entry, status: 'duplicate', reason: `与已导入的「${hit.name}」内容相同` })
      merged.push({ ...hit })
      continue
    }
    const versions = (byId.get(entry.id) || []).filter((e) => e.digest !== entry.digest)
    const version = versions.length + 1
    // 回滚要能拿回上一版的正文，所以旧版本留正文；只留两版，别把 state 撑大。
    const history = versions.slice(0, 2).map((v) => ({ digest: v.digest, at: v.importedAt, version: v.version, text: v.text ?? '' }))
    const next = { ...entry, version, history }
    byId.set(entry.id, [next, ...(byId.get(entry.id) || [])])
    byDigest.set(next.digest, next)
    merged.push(next)
  }
  return { entries: merged, duplicates }
}

/** snapshotOf 砍掉正文与历史，只留页面要显示的东西（页面是公开的，不该带全文）。 */
export function snapshotOf(entries, sources, rejected, { version = 0, now = Date.now(), options = {} } = {}) {
  return {
    version,
    generatedAt: now,
    sources,
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      status: e.status,
      reason: e.reason,
      source: e.source,
      size: e.size,
      digest: e.digest,
      importedAt: e.importedAt,
      version: e.version ?? 1,
      meta: e.meta,
      chars: e.chars,
      injectable: e.injectable,
      builtin: e.builtin === true,
    })),
    rejected,
    options,
  }
}