// 本地预览：把真实插件页放进一个 mock 宿主帧里，只为人工看界面。
//
// 不实现网关、不跑 hooks、不碰真实 options；主题跟随 magpie 的变量名，
// 明暗由 ?theme=dark|light 决定。
//
//   node preview/serve.mjs                 → http://127.0.0.1:55133
//   node preview/serve.mjs --demo          → 用 preview/catalog.demo.js 顶替真实快照
//   node preview/serve.mjs --demo=blocked  → 只有素材、没选模式那一屏
//
// 真机里 page/catalog.js 由 hooks.js 扫描后写出；预览里要么用它，要么用演示快照。
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = normalize(join(here, '..'))
const demoArg = process.argv.find((a) => a === '--demo' || a.startsWith('--demo='))
const demoFile = demoArg ? (demoArg.includes('=') ? `catalog.${demoArg.split('=')[1]}.js` : 'catalog.demo.js') : ''
const port = Number(process.env.PREVIEW_PORT || 55133)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = decodeURIComponent(url.pathname)
  const send = (body, type, code = 200) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  try {
    if (pathname === '/' || pathname === '/host.html') {
      return send(await readFile(join(here, 'host.html'), 'utf8'), mime['.html'])
    }
    // 页面加载的 _magpie/bridge.js：真机由 magpie 提供，预览用 mock
    if (pathname.endsWith('/_magpie/bridge.js')) {
      return send(await readFile(join(here, 'bridge.js'), 'utf8'), mime['.js'])
    }
    if (pathname.endsWith('/catalog.js') && demoFile) {
      return send(await readFile(join(here, demoFile), 'utf8'), mime['.js'])
    }
    const file = pathname.startsWith('/page/') ? join(root, 'page', pathname.slice(6)) : join(root, pathname)
    if (!file.startsWith(root)) return send('forbidden', 'text/plain', 403)
    return send(await readFile(file), mime[extname(file)] || 'application/octet-stream')
  } catch {
    return send('not found', 'text/plain', 404)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`purge preview: http://127.0.0.1:${port}  （?theme=light 切浅色${demoFile ? `，演示快照 ${demoFile}` : ''}）`)
})