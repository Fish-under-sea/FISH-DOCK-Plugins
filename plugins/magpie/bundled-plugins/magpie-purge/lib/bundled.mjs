// 插件自带的专家技能包与人设。
//
// 为什么要有这一层：用户装个插件，不该先去别处找一堆 .md 再一个个导入。
// `skills/` 与 `personas/` 随包分发，永远在场；它们不是「来源目录」，而是插件的一部分——
// 删不掉、改不坏，但可以被停用（停用写进 options.enabled，不碰文件）。
//
// 判定优先级：内置条目属于「来源里的一条」，但页面要能分开显示，所以扫描时
// 给每个条目加上 `builtin: true`，并让它的 root 指向包内目录。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digestOf, frontmatter, slug } from './inventory.mjs'

/** bundledDir 是包内某个内置目录的绝对路径（skills/ 或 personas/）。 */
export const bundledDir = (root, sub = 'skills') => join(root, sub)

/** 内置目录与它产出的类型：skills/ 是专家技能，personas/ 是完整人设。 */
const BUNDLED = [
  { sub: 'skills', kind: 'skill' },
  { sub: 'personas', kind: 'persona' },
]

/**
 * readBundled 读包内专家技能与人设。
 *
 * 只认 `skills/*.md`、`personas/*.md`（一级，不递归）：一层目录就是「一位专家一个文件」，
 * 递归会让内部参考文件混进专家列表。
 * @returns {{ entries: object[], dir: string, ok: boolean, error: string }}
 */
export function readBundled(root) {
  const out = { entries: [], dir: bundledDir(root), ok: false, error: '' }
  let any = false
  for (const { sub, kind } of BUNDLED) {
    const dir = bundledDir(root, sub)
    let names
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') out.error = `读不到内置目录 ${sub}/：${error?.message || error}`
      continue
    }
    any = true
    for (const dirent of names) {
      if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue
      const file = join(dir, dirent.name)
      try {
        const st = statSync(file)
        if (st.size > 256 * 1024) continue
        const raw = readFileSync(file, 'utf8')
        const { fields, body } = frontmatter(raw)
        if (!body.trim()) continue
        out.entries.push({
          id: String(fields.id || slug(fields.name || dirent.name)),
          name: String(fields.name || dirent.name.replace(/\.md$/, '')),
          // 人设文件里显式写了 kind 就听它，否则按目录定
          kind: fields.kind === 'persona' || fields.kind === 'skill' ? fields.kind : kind,
          status: 'ok',
          reason: '',
          source: { root: dir, rel: dirent.name },
          size: st.size,
          digest: digestOf(Buffer.from(raw)),
          importedAt: 0,
          meta: {
            format: 'bundled',
            description: String(fields.description || ''),
            version: String(fields.version || ''),
            whenToUse: String(fields.whenToUse || ''),
            source: String(fields.source || ''),
          },
          chars: body.trim().length,
          injectable: true,
          text: body.trim(),
          builtin: true,
        })
      } catch {
        /* 单个坏文件不该让整包读不出来 */
      }
    }
  }
  out.ok = any
  out.entries.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'persona' ? -1 : 1))
  return out
}

/** here 是 lib/ 的上级（包根）。 */
const here = dirname(fileURLToPath(import.meta.url))

export const bundled = (root = join(here, '..')) => readBundled(root)