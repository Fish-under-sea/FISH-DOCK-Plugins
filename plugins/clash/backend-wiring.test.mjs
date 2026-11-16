// 命令接线守卫：2.4.0 的外观页只剩「插件没能完成」，因为 backend 的 commands 里
// 直接写了 activate 回调参数 context（`()=>readAppearance(context.storage)`）。
// 那个箭头在模块作用域求值，拿不到回调参数，于是抛 ReferenceError，
// 被 SDK 折成 COMMAND_FAILED —— 页面上就是一句通用的失败提示，日志里也没有线索。
//
// 这条测试不跑插件（需要宿主的 sdk.mjs），只盯源码里那类「游离作用域」：
// commands 段里出现 `context.` 就是漏了把值搬到模块作用域。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'backend.mjs'), 'utf8');
const commandsAt = source.indexOf('commands:');
assert.ok(commandsAt > 0, 'backend.mjs 里找不到 commands 段');

const beforeCommands = source.slice(0, commandsAt);
const inCommands = source.slice(commandsAt);
// 注释里提到 context 是允许的（解释这个坑），代码里不允许。
const codeOf = text => text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

test('commands 段不直接引用 activate 的 context（那会抛 ReferenceError）', () => {
  const offending = codeOf(inCommands)
    .split('\n')
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /\bcontext\s*\./.test(line));
  assert.deepEqual(offending, [], `commands 里出现了游离的 context.：\n${offending.map(([n, l]) => `${n}: ${l.trim()}`).join('\n')}`);
});

test('外观命令走模块作用域的 storage，并在 activate 里赋值', () => {
  const code = codeOf(source);
  assert.match(code, /^let storage;$/m, '缺少模块作用域的 storage 声明');
  assert.match(code, /storage\s*=\s*context\.storage/, 'activate 里没有把 context.storage 搬到模块作用域');
  for (const name of ['clash.appearance', 'clash.appearanceSave', 'clash.appearanceWallpaper']) {
    assert.ok(code.includes(`'${name}'`), `缺少命令 ${name}`);
  }
  for (const call of ['readAppearance(storage)', 'savePatch(storage', 'saveWallpaper(storage']) {
    assert.ok(code.includes(call), `外观命令没有用模块作用域的 storage：${call}`);
  }
});

test('storage 还没就绪时：读回落默认值，写明确报 APPEARANCE_SAVE_FAILED', async () => {
  // 契约与外观存储层一致：读永不抛（页面照常打开），写失败要能说清原因。
  const {readAppearance, savePatch} = await import('./appearance-store.mjs');
  const fallback = await readAppearance(undefined);
  assert.equal(fallback.glass.preset, 'off');
  assert.equal(fallback.veil, 40);
  await assert.rejects(() => savePatch(undefined, {veil: 20}), error => {
    assert.equal(error.code, 'APPEARANCE_SAVE_FAILED');
    return true;
  });
});
