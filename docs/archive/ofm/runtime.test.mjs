import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {stageOfm} from './stage.mjs';import {fishRelative,fishDataPath} from './storage-layout.mjs';import {createRuntime} from './runtime.mjs';
test('分类目录支持中文空格、拒绝 Windows ADS 和设备路径',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish 中文 空格-'));
 const resolved=fishDataPath(root,'settings.json');
 assert.equal(resolved,path.join(root,'keys/settings.json'));assert.ok(fs.statSync(path.dirname(resolved)).isDirectory());
 for(const name of ['config:token','a/NUL.txt','a./b','a /b','a\u0000b'])assert.throws(()=>fishRelative(name));
});
test('分类映射把混合密钥配置、凭据及花名册分开且限制越界',()=>{assert.equal(fishRelative('settings.json'),'keys/settings.json');assert.equal(fishRelative('channel-credentials.json'),'credentials/channel-credentials.json');assert.equal(fishRelative('channel-pack/state.json'),'roster/channel-pack/state.json');for(const bad of ['../escape','C:/data','/abs','a\\b'])assert.throws(()=>fishRelative(bad));});
test('实际 OFM 暂存并启动分类服务，管理网页可访问且结束后回收',{skip:!process.env.FISH_TEST_OFM,timeout:90000},async()=>{
 const work=fs.mkdtempSync(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'fish-ofm-runtime-'));const runtime=stageOfm(process.env.FISH_TEST_OFM,path.join(work,'service'));const data=path.join(work,'data');fs.mkdirSync(data);let instance;
 try{instance=await createRuntime({dataDirectory:data}).start({executable:path.join(runtime,'packages/desktop/service-host.mjs'),port:38087});assert.equal(instance.alive(),true);const page=await fetch(instance.url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors http:\/\/tauri\.localhost/);assert.ok(fs.existsSync(path.join(data,'keys/settings.json')));assert.ok(!fs.existsSync(path.join(data,'settings.json')));assert.ok(fs.existsSync(path.join(data,'roster/channel-pack')));await instance.stop();assert.equal(instance.alive(),false)}finally{await instance?.stop()}
});
