// prepack：打包前把本机产物还原成空壳。
//
// page/catalog.js 里带着这台机器的目录与条目名，state/ 里是完整正文——
// 两样都不该跟着 npm 包发出去。装好之后第一次打开插件页会重新生成。
// catalog.js 不删而是写回空壳：页面用 <script> 加载它，文件缺失会变成一条
// 404 噪音，空壳能让页面直接画「还没有快照」。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')

rmSync(join(here, 'state'), { recursive: true, force: true })
console.log('cleaned state/')

const stub = {
  version: 0,
  generatedAt: 0,
  sources: [],
  entries: [],
  rejected: [],
  imports: [],
  options: {},
  last: null,
}
mkdirSync(join(here, 'page'), { recursive: true })
writeFileSync(join(here, 'page', 'catalog.js'), `window.PURGE_CATALOG = ${JSON.stringify(stub, null, 2)};\n`, 'utf8')
console.log('reset page/catalog.js')