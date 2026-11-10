// 补丁重放的静态闸门：补丁**删掉了某个声明**，但同一个文件里**还在引用**它。
//
// 为什么需要它（2026-11-10 实翻）：fish.31 重放时漏搬了一个 hunk——`const foldNeeded = {}`
// 被删掉，而同一补丁里本该把两处用法一起改掉的 `drawFold()` 没跟着改。于是 `foldNeeded`
// 成了悬空引用：
//   - `node --check` 只做语法分析，通过；
//   - `git apply` 干净应用，0 冲突；
//   - `follow-upstream.ps1` 只比对 hunk 数与树哈希，通过；
//   - 真正炸在运行时：点开任一供应商，编辑器一画就 `ReferenceError`，整个 Providers 页
//     停在错误胶囊上（`foldNeeded is not defined`）。
//
// 判据刻意收窄，不做完整作用域分析：
//   只看「补丁的 `-` 行里删掉的顶层声明」，去补丁应用后的文件里找同名标识符。
//   删了又加回来的（改名、挪位置）不算；文件本身被删掉的不算。
// 这样只命中「删了声明、忘了改用法」这一种，误报接近零——闸门天天喊狼来了比没有更糟。
import {readFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';

// 语言内建与宿主全局：补丁里删一个同名局部变量时，同名全局还在用不算悬空。
const GLOBALS = new Set([
  'Object', 'Array', 'Function', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON',
  'Date', 'RegExp', 'Promise', 'Proxy', 'Reflect', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'undefined', 'NaN', 'Infinity',
  'console', 'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
  'fetch', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers',
  'AbortController', 'AbortSignal', 'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver',
  'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone',
  'atob', 'btoa', 'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia',
  'Image', 'Audio', 'Option', 'Worker', 'WebSocket', 'XMLHttpRequest', 'DOMParser',
  'TextEncoder', 'TextDecoder', 'crypto', 'performance', 'self', 'top', 'parent',
  'module', 'exports', 'require', 'process', 'Buffer', '__dirname', '__filename', 'global',
  'FishDock', 'magpie', 'bootPrefs',
]);

// 只关心脚本：Go/文档里的同名标识符与页面运行时无关。
const SCRIPT = /\.(?:m?js|cjs)$/i;

function declarationNames(line) {
  // 只认顶格（缩进 0）的声明：函数体内的 `let y = …` 随函数一起被删，不算悬空。
  if (/^\s/.test(line)) return [];
  const names = [];
  // const|let|var NAME / function NAME / class NAME（可带 export / async / *）
  const simple = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/);
  if (simple) names.push(simple[1]);
  // 解构：const {a, b: c} = / const [x, y] =
  const destructuring = line.match(/^(?:export\s+)?(?:const|let|var)\s*([{[][\s\S]*?[}\]])\s*=/);
  if (destructuring) {
    for (const m of destructuring[1].matchAll(/([A-Za-z_$][\w$]*)\s*(?=[,}\]:]|$)/g)) names.push(m[1]);
    for (const m of destructuring[1].matchAll(/:\s*([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  }
  return names.filter((name) => !GLOBALS.has(name));
}

// 把补丁拆成「每个目标文件删了什么声明、加了什么声明」。
export function patchDeclarations(text) {
  const files = new Map();
  let current = null;
  let inHunk = false;
  let deletedFile = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(raw);
      current = m ? m[1] : null;
      inHunk = false;
      deletedFile = false;
      if (current && !files.has(current)) files.set(current, {removed: new Set(), added: new Set(), deleted: false});
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('deleted file mode')) { deletedFile = true; files.get(current).deleted = true; continue; }
    if (raw.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk) continue;
    if (raw.startsWith('---') || raw.startsWith('+++')) continue;
    if (raw.startsWith('-')) for (const name of declarationNames(raw.slice(1))) files.get(current).removed.add(name);
    else if (raw.startsWith('+')) for (const name of declarationNames(raw.slice(1))) files.get(current).added.add(name);
  }
  return files;
}

const isWord = (text, name) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);

// 返回 [{file, name, hits}]：删了声明、文件还在引用。
export function dangling(tree, patchText) {
  const findings = [];
  for (const [file, info] of patchDeclarations(patchText)) {
    if (info.deleted || !SCRIPT.test(file)) continue;
    const full = join(tree, file);
    if (!existsSync(full)) continue;
    const source = readFileSync(full, 'utf8');
    for (const name of info.removed) {
      if (info.added.has(name)) continue;            // 改名/挪位置：删了又加回来
      if (!isWord(source, name)) continue;           // 用法也一起清干净了
      const hits = (source.match(new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) || []).length;
      findings.push({file, name, hits});
    }
  }
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : b.hits - a.hits));
  return findings;
}

if (process.argv[1] && process.argv[1].endsWith('check-assets-refs.mjs')) {
  const [tree, patch] = process.argv.slice(2);
  if (!tree || !patch) {
    console.error('用法：node check-assets-refs.mjs <补丁应用后的源码树> <补丁文件>');
    process.exit(2);
  }
  const findings = dangling(resolve(tree), readFileSync(resolve(patch), 'utf8'));
  if (!findings.length) {
    console.log('OK：补丁删掉的声明，文件里没有残留引用');
    process.exit(0);
  }
  console.error(`发现 ${findings.length} 处悬空引用（补丁删了声明，文件还在用）：`);
  for (const f of findings) console.error(`  ${f.file}: ${f.name}（${f.hits} 处引用）`);
  console.error('多半是重放时漏搬了 hunk：声明被删了，改它的那段没跟着改。');
  process.exit(3);
}
