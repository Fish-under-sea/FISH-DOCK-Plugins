// 极简 ZIP 读取器：只做「列出条目 + 按需取出一个条目的内容」。
//
// 为什么不引依赖：插件要装进 magpie 的插件目录，依赖越少越不容易在别人的机器上炸。
// 我们只需要读——不写、不解压到磁盘、不执行；压缩方式只覆盖 store(0) 与 deflate(8)，
// 这两种已经覆盖 Windows 资源管理器、7-Zip 与 macOS 归档工具产出的全部 ZIP。
//
// 安全边界（调用方还要再判一次）：条目名不允许绝对路径、盘符、`..` 段与 NUL；
// 单条目、总解压量、条目数的上限由调用方传入，这里只提供结构。
import { inflateRawSync } from 'node:zlib'

const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50
/** EOCD 之后只可能有注释，最多 65535 字节，留 1KB 余量。 */
const EOCD_SEARCH = 0x10000 + 1024

/**
 * unsafeName 判断一个条目名会不会逃出解压根目录。
 * 只读场景下我们并不解压，但仍然要拦住这些名字：它们出现即说明这个包不可信。
 */
export function unsafeName(name) {
  const raw = String(name ?? '')
  if (!raw || raw.includes('\0')) return true
  const posix = raw.replace(/\\/g, '/')
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return true
  return posix.split('/').some((seg) => seg === '..')
}

/**
 * readZip 解析中央目录，返回条目索引；内容按需用 entry.read() 取。
 * 坏包不抛异常，返回 { ok: false, error }，让上层把它记成一条「拒绝」而不是让网关挂掉。
 */
export function readZip(buf) {
  try {
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
    const eocd = findEocd(bytes)
    if (eocd < 0) return { ok: false, error: '不是 ZIP：找不到中央目录结尾' }

    const count = bytes.readUInt16LE(eocd + 10)
    const cenSize = bytes.readUInt32LE(eocd + 12)
    const cenOffset = bytes.readUInt32LE(eocd + 16)
    if (count > 4096) return { ok: false, error: `条目太多（${count}），拒绝解析` }
    if (cenOffset + cenSize > bytes.length) return { ok: false, error: '中央目录越界，ZIP 已损坏' }

    const entries = []
    let p = cenOffset
    let unsafe = ''
    for (let i = 0; i < count; i++) {
      if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== SIG_CEN) {
        return { ok: false, error: '中央目录项签名不对，ZIP 已损坏' }
      }
      const method = bytes.readUInt16LE(p + 10)
      const crc = bytes.readUInt32LE(p + 16)
      const compressedSize = bytes.readUInt32LE(p + 20)
      const size = bytes.readUInt32LE(p + 24)
      const nameLen = bytes.readUInt16LE(p + 28)
      const extraLen = bytes.readUInt16LE(p + 30)
      const commentLen = bytes.readUInt16LE(p + 32)
      const localOffset = bytes.readUInt32LE(p + 42)
      const name = bytes.toString('utf8', p + 46, p + 46 + nameLen)
      p += 46 + nameLen + extraLen + commentLen
      if (!name || name.endsWith('/')) continue // 目录项
      if (unsafeName(name)) {
        unsafe = name
        continue
      }
      entries.push({
        name,
        method,
        crc,
        size,
        compressedSize,
        localOffset,
        read: () => extract(bytes, { method, compressedSize, localOffset, size }),
      })
    }
    if (unsafe) return { ok: false, error: `条目名越界（${unsafe}），拒绝这个包` }
    return { ok: true, entries }
  } catch (error) {
    return { ok: false, error: `ZIP 解析失败：${error?.message || error}` }
  }
}

function findEocd(bytes) {
  const start = Math.max(0, bytes.length - EOCD_SEARCH)
  for (let i = bytes.length - 22; i >= start; i--) {
    if (bytes.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

function extract(bytes, entry) {
  const { localOffset, compressedSize, size, method } = entry
  if (bytes.readUInt32LE(localOffset) !== SIG_LOC) throw new Error('本地文件头签名不对')
  const nameLen = bytes.readUInt16LE(localOffset + 26)
  const extraLen = bytes.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + compressedSize)
  if (raw.length !== compressedSize) throw new Error('压缩数据越界')
  if (method === 0) return Buffer.from(raw)
  if (method === 8) return inflateRawSync(raw)
  throw new Error(`不支持的压缩方式 ${method}`)
}