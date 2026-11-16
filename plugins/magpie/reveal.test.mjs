import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
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
  const sameOriginRequest=(headers,port)=>sameOrigin({headers:{host:'127.0.0.1:3425',...headers}},port);
  assert.equal(sameOriginRequest({origin: 'http://127.0.0.1:3425', 'sec-fetch-site': 'same-origin'}, 3425), true);
  for(const headers of [
    {origin:'https://evil.example'},{'sec-fetch-site':'cross-site'},
    {origin:'null'},{origin:'http://127.0.0.1:9999'},
    {origin:'http://localhost:3425'},{origin:'https://127.0.0.1:3425'},
    {origin:'http://127.0.0.1:3425/'},{origin:''},{host:'evil.example:3425'},
  ])assert.equal(sameOriginRequest(headers,3425),false,JSON.stringify(headers));
  assert.equal(sameOriginRequest({},3425),true);
  assert.equal(sameOriginRequest({host:'localhost:3425',origin:'http://localhost:3425'},3425),true);
  assert.equal(sameOrigin({headers:{host:'127.0.0.1:3425'},socket:{remoteAddress:'192.168.1.2'}},3425),false);
});

// §7.1：openInExplorer 3 例（用注入 run 记录参数，不真开资源管理器）。
test('openInExplorer 目录直接开、文件用 /select、不存在抛 ENOENT', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reveal-'));
  const dir = path.join(root, 'folder');
  const file = path.join(root, 'note.txt');
  await fs.mkdir(dir);
  await fs.writeFile(file, 'x');
  const calls = [];
  const run = (command, args) => { calls.push({command, args}); const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child; };
  try {
    await openInExplorer(dir, run, 'win32');
    assert.equal(calls[0].command, 'explorer.exe');
    assert.deepEqual(calls[0].args, [dir]);
    await openInExplorer(file, run, 'win32');
    assert.deepEqual(calls[1].args, [`/select,${file}`]);
    // 不存在：抛，调用方会透传上游 400。
    await assert.rejects(openInExplorer(path.join(root, 'missing'), run, 'win32'), /ENOENT/);
    assert.equal(calls.length, 2, '不存在的目标不该调用 opener');
    await assert.rejects(openInExplorer(dir,()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Error('spawn failed')));return child;},'win32'),/spawn failed/);
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