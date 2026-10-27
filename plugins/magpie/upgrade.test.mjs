import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {preparePortableRuntime} from './portable-runtime.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-upgrade-'));
 const source=path.join(root,'source','magpie.exe'),credentials=path.join(root,'credentials');
 await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(source,'fixture-v1');
 return {root,source,credentials};
}

test('同一资料根按摘要并存新旧运行副本，升级和回选不覆盖旧程序',async()=>{
 const {source,credentials}=await fixture();
 const v1=await preparePortableRuntime(source,credentials);
 assert.equal(path.basename(v1.executable),`magpie-${hash('fixture-v1')}.exe`);
 const config=path.join(v1.data,'providers.json');await fs.writeFile(config,'user-current');
 await fs.writeFile(source,'fixture-v2');const v2=await preparePortableRuntime(source,credentials);
 assert.notEqual(v2.executable,v1.executable);assert.equal(v2.data,v1.data);
 assert.equal(await fs.readFile(v1.executable,'utf8'),'fixture-v1');
 assert.equal(await fs.readFile(v2.executable,'utf8'),'fixture-v2');
 await fs.writeFile(source,'fixture-v1');const back=await preparePortableRuntime(source,credentials);
 assert.equal(back.executable,v1.executable);assert.equal(await fs.readFile(config,'utf8'),'user-current');
});

test('旧版固定文件和已自更新的副本原样保留；旧source标记不决定运行文件',async()=>{
 const {source,credentials}=await fixture(),directory=path.join(credentials,'magpie-runtime');
 await fs.mkdir(path.join(directory,'data'),{recursive:true});
 await fs.writeFile(path.join(directory,'magpie.exe'),'legacy-self-updated');
 await fs.writeFile(path.join(directory,'source.sha256'),hash('fixture-v1'));
 const ready=await preparePortableRuntime(source,credentials);
 assert.notEqual(ready.executable,path.join(directory,'magpie.exe'));
 assert.equal(await fs.readFile(path.join(directory,'magpie.exe'),'utf8'),'legacy-self-updated');
 assert.equal(await fs.readFile(ready.executable,'utf8'),'fixture-v1');
});

test('实际副本被修改时拒绝运行并给出确定错误，保留损坏文件和用户资料',async()=>{
 const {source,credentials}=await fixture(),ready=await preparePortableRuntime(source,credentials);
 await fs.writeFile(ready.executable,'modified');await fs.writeFile(path.join(ready.data,'providers.json'),'keep');
 await assert.rejects(preparePortableRuntime(source,credentials),{code:'RUNTIME_INTEGRITY'});
 assert.equal(await fs.readFile(ready.executable,'utf8'),'modified');
 assert.equal(await fs.readFile(path.join(ready.data,'providers.json'),'utf8'),'keep');
});

test('并发准备同一版本只发布完整副本且不遗留本次临时文件',async()=>{
 const {source,credentials}=await fixture();
 // 先完成一次资料初始化；并发只考察二进制发布，不同时写用户设置。
 const first=await preparePortableRuntime(source,credentials);await fs.writeFile(source,'fixture-v2');
 const rows=await Promise.all(Array.from({length:5},()=>preparePortableRuntime(source,credentials)));
 assert.ok(rows.every(r=>r.executable===rows[0].executable));
 assert.equal(await fs.readFile(rows[0].executable,'utf8'),'fixture-v2');
 assert.equal(await fs.readFile(first.executable,'utf8'),'fixture-v1');
 assert.deepEqual((await fs.readdir(path.dirname(first.executable))).filter(n=>n.startsWith('.binary-')),[]);
});
