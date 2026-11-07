import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {preparePortableRuntime} from './portable-runtime.mjs';

test('便携启动复制独立服务并迁移旧资料，重复启动保留新资料且不改发行资源',async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'fish-magpie-portable-'));
 const source=path.join(root,'package','magpie.exe'),credentials=path.join(root,'plugin','credentials');
 await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(source,'binary-v1');
 const old=path.join(credentials,'magpie');await fs.mkdir(old,{recursive:true});
 await fs.writeFile(path.join(old,'providers.json'),'synthetic-original');
 const ready=await preparePortableRuntime(source,credentials);
 assert.notEqual(ready.executable,source);
 assert.equal(await fs.readFile(ready.executable,'utf8'),'binary-v1');
 assert.equal(await fs.readFile(path.join(path.dirname(ready.executable),'.portable'),'utf8'),'');
 assert.equal(ready.data,path.join(path.dirname(ready.executable),'data'));
 assert.equal(await fs.readFile(path.join(ready.data,'providers.json'),'utf8'),'synthetic-original');
 assert.equal(await fs.readFile(path.join(old,'providers.json'),'utf8'),'synthetic-original');
 await fs.writeFile(path.join(ready.data,'providers.json'),'synthetic-edited');
 await fs.writeFile(ready.executable,'self-update');
 await assert.rejects(preparePortableRuntime(source,credentials),{code:'RUNTIME_INTEGRITY'});
 assert.equal(await fs.readFile(ready.executable,'utf8'),'self-update');
 assert.equal(await fs.readFile(path.join(ready.data,'providers.json'),'utf8'),'synthetic-edited');
 await fs.writeFile(source,'binary-v2');const next=await preparePortableRuntime(source,credentials);
 assert.notEqual(next.executable,ready.executable);
 assert.equal(await fs.readFile(next.executable,'utf8'),'binary-v2');
 assert.equal(await fs.readFile(ready.executable,'utf8'),'self-update');
 assert.equal(await fs.readFile(path.join(ready.data,'providers.json'),'utf8'),'synthetic-edited');
 assert.deepEqual(await fs.readdir(path.dirname(source)),['magpie.exe']);
});

test('成功准备后清掉过期副本与过期复制残留：目录只剩当前副本',async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),['magpie','prune'].join('-')));
 const source=path.join(root,'package','magpie.exe'),credentials=path.join(root,'plugin','credentials');
 await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(source,'binary-v1');
 const first=await preparePortableRuntime(source,credentials);
 const directory=path.dirname(first.executable);
 const agedCopy=path.join(directory,`magpie-${'f'.repeat(64)}.exe`);
 const agedBinary=path.join(directory,`.binary-${'1'.repeat(8)}`);
 const agedData=path.join(directory,`.data-${'2'.repeat(8)}`);
 const inflight=path.join(directory,`.binary-${'3'.repeat(8)}`);
 const cached=path.join(directory,`magpie-${'4'.repeat(64)}.exe`);
 await fs.writeFile(agedCopy,'old-copy');await fs.writeFile(agedBinary,'partial');
 await fs.mkdir(agedData);await fs.writeFile(path.join(agedData,'providers.json'),'partial');
 await fs.writeFile(inflight,'copying');await fs.writeFile(cached,'previous-build');
 // 历史副本堆了 4 个（含 agedCopy），成功启动后只该留「当前 + 一个回选缓存」。
 const stacked=Array.from({length:3},(_,index)=>path.join(directory,`magpie-${String(index+5).repeat(64)}.exe`));
 for(const entry of stacked)await fs.writeFile(entry,'old-copy');
 const past=new Date(Date.now()-60*60*1000);
 for(const entry of [agedCopy,agedBinary,agedData,...stacked])await fs.utimes(entry,past,past);
 await fs.writeFile(source,'binary-v2');
 const next=await preparePortableRuntime(source,credentials);
 const names=await fs.readdir(directory);
 // 过期的历史副本与复制残留清掉，正在回选的上一版与正在写的临时名原样保留。
 for(const gone of [agedCopy,agedBinary,agedData,...stacked])assert.equal(names.includes(path.basename(gone)),false,path.basename(gone));
 assert.ok(names.includes(path.basename(inflight)));
 assert.ok(names.includes(path.basename(cached)));
 assert.ok(names.includes(path.basename(next.executable)));
 const copies=names.filter(name=>/^magpie-[0-9a-f]{64}\.exe$/.test(name));
 assert.deepEqual(copies.sort(),[path.basename(next.executable),path.basename(cached)].sort());
 assert.match(path.basename(next.executable),/^magpie-[0-9a-f]{64}\.exe$/);
 assert.equal(await fs.readFile(next.executable,'utf8'),'binary-v2');
});

// #46：旧版自更新留下的 magpie.exe / magpie.exe.new / magpie.before-*.exe 不算
// 便携副本，留着永不再用。宽限期一过就清；宽限期内的（可能还有旧客户端在跑）不动。
test('旧名自更新副本宽限期后清掉，宽限期内不动',async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),['magpie','legacy'].join('-')));
 const source=path.join(root,'package','magpie.exe'),credentials=path.join(root,'plugin','credentials');
 await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(source,'binary-v1');
 const first=await preparePortableRuntime(source,credentials);
 const directory=path.dirname(first.executable);
 const legacy=['magpie.exe','magpie.exe.new','magpie.before-20251001.exe'].map(name=>path.join(directory,name));
 for(const entry of legacy)await fs.writeFile(entry,'legacy-copy');
 const past=new Date(Date.now()-2*24*60*60*1000);
 for(const entry of legacy)await fs.utimes(entry,past,past);
 const freshLegacy=path.join(directory,'magpie.before-fresh.exe');await fs.writeFile(freshLegacy,'legacy-copy');
 await fs.writeFile(source,'binary-v2');
 const next=await preparePortableRuntime(source,credentials);
 const names=await fs.readdir(directory);
 for(const entry of legacy)assert.equal(names.includes(path.basename(entry)),false,path.basename(entry));
 assert.ok(names.includes(path.basename(freshLegacy)),'宽限期内的旧名不该被删');
 assert.ok(names.includes(path.basename(next.executable)));
});
