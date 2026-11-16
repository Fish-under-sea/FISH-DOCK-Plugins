#!/usr/bin/env node
// 生成「液态玻璃覆盖」清单：把上游所有 CSS 里「用实色令牌铺底」的规则找出来，
// 一次性给它们换成半透底，避免手写选择器清单漏项（漏一个就是一个不通透的块）。
//
// 用法：node plugins/magpie/tools/glass-surfaces.mjs <上游源码根> [--write]
//   不带 --write 只打印统计，方便先看命中面；带 --write 会把
//   fish-glass.css 里 gen:glass-surfaces 两行标记之间的整段替换掉。
//
// 只改背景色，绝不动布局属性（position/display/flex/overflow/padding/margin…），
// 这是 2.4.3 的教训：玻璃化不该改变版式。对话、编辑器正文与表单控件不在覆盖范围，
// 它们要保持自己的实底才读得清。
//
// 2.4.5 起扫全部样式表：库、插件市场、路由、会话、上下文各有自己的 css，
// 只扫 app.css 会让这些页面的卡片与页内工具条永远是实底（用户看到的「这边没做到玻璃」）。

import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const write = process.argv.includes('--write');
if (!root) {
  console.error('用法：node glass-surfaces.mjs <上游源码根> [--write]');
  process.exit(2);
}

const assets = path.join(root, 'internal/gui/assets');
const glassCssPath = path.join(assets, 'fish-glass.css');

// 全部样式表，除了玻璃自己（会自我覆盖）与 omarchy 主题（那是另一套外观）
const SKIP = new Set(['fish-glass.css', 'omarchy.css']);
const sheets = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.css') && !SKIP.has(e.name)) sheets.push(p);
  }
})(assets);

// 实色令牌：卡片/次级卡片，以及页面自己的底色（页内工具条、页脚、单据常在用 --bg）
const TOKENS = ['--card', '--card-2', '--bg'];
// 保持在实底上的：对话正文、编辑器写作区、表单控件本身
// 只留真正的表单控件与代码块：对话框、编辑器正文、展开的卡片一律跟页面同一套
// 玻璃，否则「外层全透、里层实底」会像拼起来的两块（用户看到的「中间缺失玻璃」）。
const KEEP_SOLID = ['input', 'textarea', 'select', 'button', 'checkbox', 'radio', 'range', 'kbd', 'code'];

/** 逐条规则：选择器 + 声明串（顶层花括号，够用且不误伤 @media 内的规则） */
function rules(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const head = css.slice(i, open).trim();
    const body = css.slice(open + 1, j - 1);
    if (!head.startsWith('@')) out.push([head, body]);
    i = j;
  }
  return out;
}

const found = new Map(); // selector -> token
for (const sheet of sheets) {
  const stripped = fs.readFileSync(sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [selector, body] of rules(stripped)) {
    if (selector.includes('@')) continue;
    // 结尾的分号可有可无：很多规则的最后一条声明不写分号，漏掉它就会漏一整类块
    const m = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*var\((--[a-z0-9-]+)\)\s*(?:!important\s*)?(?:;|$)/i);
    if (!m) continue;
    const token = m[1];
    if (!TOKENS.includes(token)) continue;
    for (let sel of selector.split(',')) {
      sel = sel.trim();
      if (!sel || sel.includes('::')) continue;
      // :is()/:where() 包起来的分组选择器照收：它们正是「一组卡片共用一种底」的写法，
      // 之前整条丢掉，库与插件市场的大块因此永远是实底。
      if (/:hover|:focus|:active|:checked|\.on\b|\.sel\b|\.open\b|\.drag\b/.test(sel)) continue;
      const lower = sel.toLowerCase();
      if (KEEP_SOLID.some((k) => lower.includes(k))) continue;
      // 页面与根节点不接管：墙纸与遮罩由 lookCSS 负责，这里再刷一层会互相打架
      if (/^(body|html|:root)([ .:#\[]|$)/.test(sel)) continue;
      // 侧栏与顶栏各有自己的区域变量（sidebar / header），交给显式规则
      if (/^\.sidebar$|^header\.top$/.test(sel)) continue;
      if (!found.has(sel)) found.set(sel, token);
    }
  }
}

const byToken = new Map(TOKENS.map((t) => [t, []]));
for (const [sel, token] of found) byToken.get(token).push(sel);
for (const list of byToken.values()) list.sort();

const lines = [];
lines.push('/* gen:glass-surfaces:begin ------------------------------------------------');
lines.push('  由 plugins/magpie/tools/glass-surfaces.mjs 从上游样式表生成，请勿手改。');
lines.push('  扫的是 app.css 与各插件页自己的 css；命中 = 「background 用实色令牌铺底」');
lines.push('  且不是交互态、表单控件或正文区。只改 background-color，不碰布局属性。*/');
// 一条选择器一条规则：某条写坏了只丢它自己，不会像逗号列表那样连累整块。
// 同时做一次语法校验，把不像选择器的（末尾悬空组合符、括号不配平等）剔掉。
const SEL_OK = /^[A-Za-z0-9_.#>+~:\[\]()*=\s,'"-]+$/;
const balanced = (s) => {
  let d = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') d += 1;
    else if (ch === ')' || ch === ']') d -= 1;
    if (d < 0) return false;
  }
  return d === 0;
};
let skipped = 0;
for (const token of TOKENS) {
  for (const sel of byToken.get(token)) {
    if (!SEL_OK.test(sel) || !balanced(sel) || /[>+~]\s*$/.test(sel)) { skipped += 1; continue; }
    lines.push(`:root[data-fish-glass] body ${sel} {`);
    lines.push(`  background-color: color-mix(in srgb, var(${token}) var(--fish-glass-content-fill), transparent);`);
    // 只给底色，不再给内描边：里层与父层都描边时，圆角处会缺一截，
    // 看起来像「玻璃边缘丢了」。玻璃边只留给最外层的面（.list/.card/.sheet/.pop）。
    lines.push('}');
  }
}
if (skipped) console.log(`踢掉 ${skipped} 条可疑选择器`);
lines.push('/* gen:glass-surfaces:end */');
const gen = lines.join('\n');

const glass = fs.readFileSync(glassCssPath, 'utf8');
const begin = '/* gen:glass-surfaces:begin';
const endMark = '/* gen:glass-surfaces:end */';
let next;
if (glass.includes(begin)) {
  const a = glass.indexOf(begin);
  const b = glass.indexOf(endMark, a) + endMark.length;
  next = glass.slice(0, a) + gen + glass.slice(b);
} else {
  next = glass.replace(/\s*$/, '\n\n') + gen + '\n';
}

const total = [...byToken.values()].reduce((n, l) => n + l.length, 0);
console.log(`扫描 ${sheets.length} 个样式表，命中 ${total} 条：` + TOKENS.map((t) => `${t}=${byToken.get(t).length}`).join(' '));
for (const token of TOKENS) {
  for (const s of byToken.get(token).slice(0, 5)) console.log(`  ${token}  ${s}`);
  if (byToken.get(token).length > 5) console.log(`  ${token}  …共 ${byToken.get(token).length} 条`);
}

if (write) {
  fs.writeFileSync(glassCssPath, next);
  console.log(`已写入 ${glassCssPath}`);
} else {
  console.log('（未写入；加 --write 落盘）');
}