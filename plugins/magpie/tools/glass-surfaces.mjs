#!/usr/bin/env node
// 生成「液态玻璃覆盖」清单：把上游 app.css 里所有「用实色令牌铺底」的规则找出来，
// 一次性给它们换成半透底，避免手写选择器清单漏项（漏一个就是一个不通透的块）。
//
// 用法：node plugins/magpie/tools/glass-surfaces.mjs <上游源码根> [--write]
//   不带 --write 只打印统计，方便先看命中面；带 --write 会把
//   fish-glass.css 里 gen:glass-surfaces 两行标记之间的整段替换掉。
//
// 只改背景色，绝不动布局属性（position/display/flex/overflow/padding/margin…），
// 这是 2.4.3 的教训：玻璃化不该改变版式。对话、编辑器正文与表单控件不在覆盖范围，
// 它们要保持自己的实底才读得清。

import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const write = process.argv.includes('--write');
if (!root) {
  console.error('用法：node glass-surfaces.mjs <上游源码根> [--write]');
  process.exit(2);
}

const appCssPath = path.join(root, 'internal/gui/assets/app.css');
const glassCssPath = path.join(root, 'internal/gui/assets/fish-glass.css');
const app = fs.readFileSync(appCssPath, 'utf8');
const glass = fs.readFileSync(glassCssPath, 'utf8');

const TOKENS = ['--card', '--card-2', '--layer-1', '--layer-2'];
// 保持在实底上的：对话正文、编辑器的写作区、表单控件本身
const KEEP_SOLID = [
  'modal', '.editor', '.ebody', '.prose', 'input', 'textarea', 'select',
  'button', 'checkbox', 'radio', 'range', 'kbd', 'code', '.chart svg',
];

// 去掉注释，避免把注释里的花括号当规则
const stripped = app.replace(/\/\*[\s\S]*?\*\//g, '');

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
for (const [selector, body] of rules(stripped)) {
  if (selector.includes('@')) continue;
  const m = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*var\((--[a-z0-9-]+)\)\s*;/i);
  if (!m) continue;
  const token = m[1];
  if (!TOKENS.includes(token)) continue;
  for (let sel of selector.split(',')) {
    sel = sel.trim();
    if (!sel || sel.includes('::')) continue;
    if (/:is\(|:where\(|:has\(/.test(sel)) continue;
    if (/:hover|:focus|:active|:checked|\.on\b|\.sel\b|\.open\b|\.drag\b/.test(sel)) continue;
    const lower = sel.toLowerCase();
    if (KEEP_SOLID.some((k) => lower.includes(k))) continue;
    if (!found.has(sel)) found.set(sel, token);
  }
}

const byToken = new Map(TOKENS.map((t) => [t, []]));
for (const [sel, token] of found) byToken.get(token).push(sel);
for (const list of byToken.values()) list.sort();

const lines = [];
lines.push('/* gen:glass-surfaces:begin ------------------------------------------------');
lines.push('  由 plugins/magpie/tools/glass-surfaces.mjs 从上游 app.css 生成，请勿手改。');
lines.push('  命中规则 = 「background 用实色令牌铺底」且不是交互态、表单控件或正文区。');
lines.push('  只改 background-color，不碰任何布局属性。*/');
for (const token of TOKENS) {
  const sels = byToken.get(token);
  if (!sels.length) continue;
  // 每一条都要带自己的前缀，否则只有第一条算数（:root[data-fish-glass] body）
  const scoped = sels.map((s) => `:root[data-fish-glass] body ${s}`);
  lines.push(`${scoped.join(',\n')} {`);
  lines.push(`  background-color: color-mix(in srgb, var(${token}) var(--fish-glass-content-fill), transparent);`);
  lines.push('}');
}
lines.push('/* gen:glass-surfaces:end */');

const gen = lines.join('\n');
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
console.log(`命中 ${total} 条实色铺底规则：` + TOKENS.map((t) => `${t}=${byToken.get(t).length}`).join(' '));
for (const token of TOKENS) {
  for (const s of byToken.get(token).slice(0, 6)) console.log(`  ${token}  ${s}`);
  if (byToken.get(token).length > 6) console.log(`  ${token}  …共 ${byToken.get(token).length} 条`);
}

if (write) {
  fs.writeFileSync(glassCssPath, next);
  console.log(`已写入 ${glassCssPath}`);
} else {
  console.log('（未写入；加 --write 落盘）');
}