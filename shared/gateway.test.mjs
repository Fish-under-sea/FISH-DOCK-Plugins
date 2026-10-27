import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from './gateway.mjs';
import {serviceError} from './errors.mjs';
test('准备阶段可见且只有就绪后返回运行副本，停止后清空',async()=>{
 let publish,phase;
 const service=createGateway({context:{storage:{read:async()=>null}},kind:'magpie',defaultExecutable:'C:/source.exe',runtime:{start:async({onPhase})=>{phase=onPhase;onPhase('verify-binary');await new Promise(resolve=>{publish=resolve});return {url:'http://127.0.0.1:3425/',runtime:{executable:'C:/magpie-hash.exe',sha256:'a'.repeat(64)},stop:async()=>{}}}}});
 await service.load();const pending=service.start();
 assert.equal(service.view().phase,'verify-binary');assert.equal(service.view().runtime,null);
 publish();await pending;assert.equal(service.view().runtime.sha256,'a'.repeat(64));
 await service.stop();phase('prepare-data');assert.equal(service.view().phase,null);assert.equal(service.view().runtime,null);
});
function fixture(){const files=new Map();let starts=0,stops=0,fail=false,live=true;const context={storage:{read:async(c,n)=>files.get(`${c}/${n}`),write:async(c,n,v)=>files.set(`${c}/${n}`,v)}};const runtime={start:async config=>{starts++;if(fail)throw Error('underlying token=should-never-display');live=true;return {url:'http://127.0.0.1:24567/?k=synthetic',alive:()=>live,stop:async()=>{stops++;live=false}}}};const service=createGateway({context,runtime,kind:'magpie'});return {files,service,stats:()=>({starts,stops}),fail:()=>{fail=true},crash:()=>{live=false}}}
test('网关保存配置不启动服务，启动幂等，停止只关闭自身实例',async()=>{const f=fixture();await f.service.load();assert.equal(f.service.view().state,'unconfigured');await f.service.save({executable:'C:\\runtime\\magpie.exe',port:24567});assert.equal(f.stats().starts,0);await f.service.start();await f.service.start();assert.equal(f.stats().starts,1);assert.equal(f.service.view().state,'running');assert.match(f.service.view().url,/127\.0\.0\.1/);await f.service.stop();await f.service.stop();assert.deepEqual(f.stats(),{starts:1,stops:1});assert.equal(f.service.view().url,null)});
test('运行中修改启动参数要先停止，失败状态脱敏且可再次配置',async()=>{const f=fixture();await f.service.load();await f.service.save({executable:'C:\\runtime\\magpie.exe',port:24567});await f.service.start();await assert.rejects(f.service.save({port:24568}),/停止/);f.crash();assert.equal(f.service.view().state,'error');assert.equal(f.service.view().url,null);await f.service.stop();f.fail();await f.service.start();assert.equal(f.service.view().state,'error');assert.doesNotMatch(JSON.stringify(f.service.view()),/token=|should-never/);await f.service.save({port:24569});assert.equal(f.service.view().state,'stopped')});
test('保存前验证路径和端口，损坏配置保留原文件供修复',async()=>{const f=fixture();await f.service.load();for(const patch of [{executable:'relative.exe'},{port:80},{port:'3425'},{port:65536}]){await assert.rejects(f.service.save(patch));assert.equal(f.files.size,0)}f.files.set('config/gateway.json','broken');assert.equal((await f.service.load()).state,'error');assert.equal(f.files.get('config/gateway.json'),'broken')});
test('启动中停止等待并回收同一个实例，拒绝并发再次启动',async()=>{
 let ready,stops=0,starts=0;
 const service=createGateway({context:{storage:{read:async()=>null}},kind:'ofm',defaultExecutable:'C:/service.mjs',
  runtime:{start:async()=>{starts++;return new Promise(resolve=>{ready=()=>resolve({url:'http://127.0.0.1:38080/',stop:async()=>{stops++}})})}}});
 await service.load();const starting=service.start(),stopping=service.stop();
 assert.equal(service.view().state,'stopping');
 service.start();ready();await Promise.all([starting,stopping]);
 assert.equal(service.view().state,'stopped');assert.equal(starts,1);assert.equal(stops,1);
});
test('白名单启动错误明确且不回显底层敏感输出，错误就绪端口会回收',async()=>{
 const f=fixture();await f.service.load();await f.service.save({executable:'C:/x',port:24568});
 await f.service.start();assert.equal(f.service.view().state,'error');assert.equal(f.stats().stops,1);
 assert.match(f.service.view().error,/就绪地址/);
 const service=createGateway({context:{storage:{}},kind:'ofm',defaultExecutable:'C:/x',
  runtime:{start:async()=>{const error=serviceError('PORT_IN_USE');error.message='token-secret';throw error}}});
 await service.start();assert.match(service.view().error,/端口已被占用/);assert.doesNotMatch(service.view().error,/token-secret/);
});
test('内置服务路径跟随新资源根，自定义绝对路径不被替换',async()=>{
 let saved;
 const context={storage:{read:async()=>saved,write:async(c,n,value)=>{saved=value}}};
 const a=createGateway({context,runtime:{},kind:'ofm',defaultExecutable:'C:/old/service.mjs'});
 await a.load();await a.save({port:38081});
 const b=createGateway({context,runtime:{},kind:'ofm',defaultExecutable:'D:/中文 路径/service.mjs'});
 assert.equal((await b.load()).executable,'D:/中文 路径/service.mjs');
 await b.save({executable:'E:/custom/service.mjs'});
 assert.equal((await a.load()).executable,'E:/custom/service.mjs');
 saved=JSON.stringify({executable:`C:/old/packages/fish.ofm/1.0.0/${'a'.repeat(64)}/service/packages/desktop/service-host.mjs`,port:38080});
 assert.equal((await b.load()).executable,'D:/中文 路径/service.mjs');
});
