import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {REVEAL_REFUSED, REVEAL_ROUTES, targetOf, sameOrigin, openInExplorer} from './reveal.mjs';

const home = path.join(os.tmpdir(), 'magpie-home');
const refused = msg => REVEAL_REFUSED + msg;

// §7.1 全表：targetOf 6 例。
test('targetOf 展开 ~、拒特殊路径、保留 WSL UNC', () => {
  assert.equal(targetOf(refused('~\\.fish-dock\\x'), home), path.normalize(`${home}\\.fish-dock\\x`));
  assert.equal(targetOf(refused('~/x'), home), path.normalize(`${home}/x`));
  assert.equal(targetOf(refused('~'), home), path.normalize(home));
  assert.equal(targetOf(refused('\\\\?\\C:\\x'), home), null);
  assert.equal(targetOf(refused('\\\\wsl$\\Ubuntu\\home\\u'), home), path.normalize('\\\\wsl$\\Ubuntu\\home\\u'));
  assert.equal(targetOf('not a path the library shows', home), null);
  // 额外：相对路径、\\.\ 设备路径、非 WSL 的 UNC 都拒。
  assert.equal(targetOf(refused('relative\\x'), home), null);
  assert.equal(targetOf(refused('\\\\.\\C:\\x'), home), null);
  assert.equal(targetOf(refused('\\\\server\\share\\x'), home), null);
  assert.equal(targetOf(refused('   '), home), null);
  assert.equal(targetOf(undefined, home), null);
});

// §7.1：sameOrigin 3 例。
test('sameOrigin 只放行本机同端口来源', () => {
  assert.equal(sameOrigin({headers: {origin: 'http://127.0.0.1:3425', 'sec-fetch-site': 'same-origin'}}, 3425), true);
  assert.equal(sameOrigin({headers: {origin: 'https://evil.example'}}, 3425), false);
  assert.equal(sameOrigin({headers: {'sec-fetch-site': 'cross-site'}}, 3425), false);
  // 额外：空 Origin（curl 这类本机客户端）放行；'null' 不可解析拒；端口不符拒。
  assert.equal(sameOrigin({headers: {}}, 3425), true);
  assert.equal(sameOrigin({headers: {origin: 'null'}}, 3425), false);
  assert.equal(sameOrigin({headers: {origin: 'http://127.0.0.1:9999'}}, 3425), false);
  assert.equal(sameOrigin({headers: {origin: 'http://localhost:3425'}}, 3425), true);
});

// §7.1：openInExplorer 3 例（用注入 run 记录参数，不真开资源管理器）。
test('openInExplorer 目录直接开、文件用 /select、不存在抛 ENOENT', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reveal-'));
  const dir = path.join(root, 'folder');
  const file = path.join(root, 'note.txt');
  await fs.mkdir(dir);
  await fs.writeFile(file, 'x');
  const calls = [];
  const run = (command, args) => { calls.push({command, args}); return {unref() {}}; };
  try {
    await openInExplorer(dir, run, 'win32');
    assert.equal(calls[0].command, 'explorer.exe');
    assert.deepEqual(calls[0].args, [dir]);
    await openInExplorer(file, run, 'win32');
    assert.deepEqual(calls[1].args, [`/select,${file}`]);
    // 不存在：抛，调用方会透传上游 400。
    await assert.rejects(openInExplorer(path.join(root, 'missing'), run, 'win32'), /ENOENT/);
    assert.equal(calls.length, 2, '不存在的目标不该调用 opener');
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

// 路由白名单：7 条，含懒加载里的两条。
test('REVEAL_ROUTES 是 7 条白名单路由', () => {
  assert.equal(REVEAL_ROUTES.size, 7);
  for (const route of [
    '/api/library/reveal', '/api/settings/reveal', '/api/settings/log/reveal',
    '/api/davsync/reveal', '/api/autobackup/reveal', '/api/datafolder/reveal',
    '/api/gateway/held/reveal',
  ]) assert.ok(REVEAL_ROUTES.has(route), route);
  assert.ok(!REVEAL_ROUTES.has('/api/autobackup/choose'), 'choose 走 P1 单独处理');
});
