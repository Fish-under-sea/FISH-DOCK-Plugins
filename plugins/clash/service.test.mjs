import test from 'node:test';
import assert from 'node:assert/strict';
import {createClash} from './service.mjs';
const kernel={kernel:'D:/synthetic/mihomo.exe'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('failed proxy restoration still stops the owned core and remains retryable',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 f.runtime.proxy.restore=async()=>{throw Error('synthetic registry failure')};
 await assert.rejects(f.service.stop());assert.equal(f.stats().up,false);assert.equal(f.stats().stops,1);
 assert.match((await f.service.view()).error,/停止失败/);
 f.runtime.proxy.restore=async()=>{};
 await f.service.stop();assert.equal((await f.service.view()).error,'');
});
function fixture(disk=new Map()) {
 const requests=[],updates=[];let up=false,starts=0,stops=0,owned,fail=false,blocked=null;
 const context={dataDirectory:'D:/synthetic/.fishplugin-clash',
  storage:{read:async(c,n)=>disk.get(`${c}/${n}`)??null,write:async(c,n,v)=>disk.set(`${c}/${n}`,v)},
  secrets:{read:async(c,n)=>disk.get(`secret/${c}/${n}`)??null,write:async(c,n,v)=>disk.set(`secret/${c}/${n}`,v)}};
 const request=async(path,options={})=>{
  requests.push({path,...options});if(!up)throw Error('offline');
  const names=owned.subscriptions.map(s=>`[${s.id}] same`);
  return path==='/version'?{version:'synthetic'}:path==='/proxies'?{proxies:{PROXY:{now:names[0],all:names},
   ...Object.fromEntries(names.map(name=>[name,{history:[{delay:20}]}]))}}:
   path==='/configs'?{mode:'rule'}:path==='/connections'?{connections:[{token:'PRIVATE'}],uploadTotal:10}:{url:'https://private.test/?token=PRIVATE'};
 };
 const runtime={start:async c=>{starts++;up=true;owned=c;return {alive:()=>up,stop:async()=>{stops++;up=false}}},
  updateSubscription:async c=>{updates.push(c);await blocked;if(c.signal.aborted||fail)throw Error('token=PRIVATE');await c.apply?.();await c.commit({nodeCount:2});return {nodeCount:2}},
  proxy:{enable:async()=>{},restore:async()=>{},active:()=>false},
  tun:{status:async()=>({installed:tunInstalled,state:tunInstalled?'running':'absent',kernel:tunKernel,log:''}),
   install:async({kernel})=>{tunInstalled=true;tunKernel=kernel},
   uninstall:async()=>{tunInstalled=false;return {installed:false}},
   enable:async()=>true,disable:async()=>true},
  tunStop:async()=>{}};
 let tunInstalled=false,tunKernel='';
 const service=createClash({context,runtime,request});
 return {service,disk,requests,updates,runtime,context,stats:()=>({starts,stops,up,owned}),fail:()=>{fail=true},
  block:()=>{let release;blocked=new Promise(r=>release=r);return release}};
}
async function add(f,name='A',url='https://example.test/a?token=PRIVATE') {
 return (await f.service.subscriptionSave({name,url})).subscriptions.at(-1);
}
async function settled(service) {
 for(let i=0;i<200;i++){const state=await service.view({controller:false});if(!state.subscriptions.some(s=>s.updating))return state;await tick()}
 throw Error('jobs failed to finish');
}
test('multiple subscriptions have stable independent IDs and coexist in one runtime',async()=>{
 const f=fixture();await f.service.save(kernel);const a=await add(f),b=await add(f,'B','https://example.test/b');
 assert.notEqual(a.id,b.id);
 await f.service.subscriptionSave({id:a.id,name:'Renamed',url:''});
 await f.service.reload();await settled(f.service);await f.service.start();
 const state=await f.service.view();
 assert.equal(state.subscriptions.length,2);assert.equal(f.stats().owned.subscriptions.length,2);
 assert.deepEqual(state.groups[0].nodes.map(n=>n.label),['same','same']);
 assert.deepEqual(state.groups[0].nodes.map(n=>n.source),['Renamed','B']);
 await f.service.select({group:'PROXY',name:state.groups[0].nodes[1].name});
 assert.ok(f.requests.some(r=>r.method==='PUT'&&r.body?.name===`[${b.id}] same`));
 assert.ok(!JSON.stringify(state).includes('PRIVATE'));assert.ok(!f.disk.get('config/subscriptions.json').includes('https:'));
 await assert.rejects(f.service.subscriptionToggle({id:a.id,enabled:false}),/停止/);
 await f.service.stop();await f.service.subscriptionToggle({id:a.id,enabled:false});
 await f.service.start();assert.deepEqual(f.stats().owned.subscriptions.map(s=>s.id),[b.id]);
 await f.service.stop();await f.service.subscriptionRemove({id:a.id});
 assert.deepEqual((await f.service.view()).subscriptions.map(s=>s.id),[b.id]);
 assert.equal(f.disk.get(`secret/credentials/${a.id}.json`),'');
});
test('duplicate submissions and duplicate refresh clicks cannot create duplicate work',async()=>{
 const f=fixture();await f.service.save(kernel);
 await Promise.all([add(f),add(f)]);
 assert.equal((await f.service.view()).subscriptions.length,1);
 const release=f.block();
 await Promise.all([f.service.reload(),f.service.reload()]);
 assert.equal(f.updates.length,1);
 assert.equal((await f.service.view()).subscriptions[0].updating,true);
 release();await settled(f.service);
 await Promise.all([f.service.start(),f.service.start()]);assert.equal(f.stats().starts,1);
 await f.service.stop();
});
test('refresh failure retains success time and count, updates only one provider and is redacted',async()=>{
 const f=fixture();await f.service.save(kernel);const a=await add(f);await add(f,'B','https://example.test/b');
 await f.service.reload();const before=await settled(f.service);await f.service.start();
 await f.service.reload({id:a.id});await settled(f.service);
 assert.deepEqual(f.requests.filter(r=>r.method==='PUT').map(r=>r.path),[`/providers/proxies/${a.id}`]);
 f.fail();await f.service.reload({id:a.id});const after=await settled(f.service);
 assert.equal(after.subscriptions[0].status,'error');assert.equal(after.subscriptions[0].hasCache,true);
 assert.equal(after.subscriptions[0].nodeCount,2);assert.equal(after.subscriptions[1].status,'ready');
 assert.ok(after.subscriptions[0].lastSuccess>=before.subscriptions[0].lastSuccess);
 assert.ok(!JSON.stringify(after).includes('PRIVATE'));
 assert.ok(!JSON.stringify(await f.service.details({section:'providers'})).includes('PRIVATE'));
 assert.deepEqual(await f.service.details({section:'connections'}),{count:1,uploadTotal:10,downloadTotal:0});
 await f.service.stop();
});
test('single subscription migration is idempotent and preserves legacy cache availability',async()=>{
 const disk=new Map([['secret/credentials/subscription.json','https://example.test/legacy?token=PRIVATE']]);
 const f=fixture(disk);f.runtime.migrateSubscription=async()=>true;
 const first=await f.service.view();
 assert.equal(first.subscriptions.length,1);assert.equal(first.subscriptions[0].hasCache,true);
 assert.equal(disk.get('secret/credentials/subscription.json'),'');
 const again=await fixture(disk).service.view();
 assert.equal(again.subscriptions[0].id,first.subscriptions[0].id);
 assert.equal(again.subscriptions[0].enabled,true);
 assert.ok(!JSON.stringify(again).includes('PRIVATE'));
});
test('metadata write failure restores secret and does not lose existing subscriptions',async()=>{
 const f=fixture();const a=await add(f),old=f.disk.get(`secret/credentials/${a.id}.json`);
 const original=f.context.storage.write;
 f.context.storage.write=async(c,n,v)=>{if(n==='subscriptions.json')throw Error('disk');return original(c,n,v)};
 await assert.rejects(f.service.subscriptionSave({id:a.id,name:'changed',url:'https://example.test/new'}));
 assert.equal(f.disk.get(`secret/credentials/${a.id}.json`),old);
 assert.equal((await f.service.view()).subscriptions[0].name,'A');
 await assert.rejects(f.service.subscriptionRemove({id:a.id}));
 assert.equal(f.disk.get(`secret/credentials/${a.id}.json`),old);
});
test('invalid URLs/ports are rejected; unsynced subscriptions block startup; interrupted jobs recover',async()=>{
 const f=fixture();await f.service.view();
 // 只拒真正的非法地址：非 http(s) 协议、带账号密码、空串。
 for(const url of ['file:///bad','ftp://example.test','https://user:pass@example.test',''])
  await assert.rejects(add(f,'A',url),/订阅/);
 // http 与 #片段 必须接受：国内机场大量如此，拒绝会让用户永远导不进来。
 const httpRow=await f.service.subscriptionSave({name:'http ok',url:'http://example.test/sub?token=x'});
 assert.equal(httpRow.subscriptions.at(-1).name,'http ok');
 const fragRow=await f.service.subscriptionSave({name:'fragment ok',url:'https://example.test/sub?token=y#Clash'});
 assert.equal(fragRow.subscriptions.length,2);
 assert.equal(f.disk.get(`secret/credentials/${fragRow.subscriptions.at(-1).id}.json`),'https://example.test/sub?token=y');
 await assert.rejects(f.service.save({...kernel,mixedPort:9099}));
 await f.service.save(kernel);
 await add(f,'third','https://example.test/three');
 await assert.rejects(f.service.start(),/更新/);
 const release=f.block();await f.service.reload();
 const restart=await fixture(f.disk).service.view();assert.equal(restart.subscriptions[0].status,'error');
 const stop=f.service.shutdown();await tick();release();await stop;
 assert.equal(f.updates[0].signal.aborted,true);assert.equal(f.stats().starts,0);
 await assert.rejects(f.service.start(),/停用/);
});
test('bundled kernel follows exact host package upgrades but custom paths remain untouched',async()=>{
 const old=`C:/old/packages/fish.clash/1.0.0/${'a'.repeat(64)}/service/mihomo.exe`;
 const newPath=`E:/new/packages/fish.clash/1.0.2/${'b'.repeat(64)}/service/mihomo.exe`;
 for(const saved of [{kernel:old},{kernel:old,bundled:true},{kernel:'D:/custom/mihomo.exe'}]){
  const f=fixture(new Map([['config/clash.json',JSON.stringify(saved)]]));
  const service=createClash({context:f.context,runtime:f.runtime,defaultKernel:newPath});
  assert.equal((await service.view()).kernel,saved.kernel==='D:/custom/mihomo.exe'?saved.kernel:newPath);
  await service.save({kernel:newPath});
  assert.equal(JSON.parse(f.disk.get('config/clash.json')).bundled,true);
  await service.save({kernel:'D:/custom/mihomo.exe'});
  assert.equal(JSON.parse(f.disk.get('config/clash.json')).bundled,false);
 }
});
test('stopping cancels an in-progress start and never launches a second core',async()=>{
 const f=fixture();await f.service.save(kernel);let seenSignal;
 f.runtime.start=async({signal})=>{
  seenSignal=signal;
  await new Promise((resolve,reject)=>{
   if(signal.aborted)return reject(Error('aborted'));
   signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
  });
 };
 const starting=f.service.start();const rejected=assert.rejects(starting);
 await tick();const stopping=f.service.stop();await stopping;await rejected;
 assert.equal(seenSignal.aborted,true);assert.equal((await f.service.view()).operation,null);
});
test('layout persists and does not start a core',async()=>{
 const f=fixture();await f.service.layout({layout:'double'});
 assert.equal((await fixture(f.disk).service.view()).layout,'double');
 assert.equal(f.stats().starts,0);await assert.rejects(f.service.layout({layout:'grid'}));
});
test('TUN 服务：未安装→安装→卸载，安装后 TUN 开关持久化且栈值受控',async()=>{
 const f=fixture();await f.service.save(kernel);
 assert.equal((await f.service.tunService()).installed,false);
 await f.service.installTunService();
 const installed=await f.service.tunService();
 assert.equal(installed.installed,true);assert.equal(installed.kernel,'D:/synthetic/mihomo.exe');
 await f.service.save({...kernel,tun:{enable:true,stack:'gvisor'}});
 let state=await f.service.view({controller:false});
 assert.equal(state.tun.enable,true);assert.equal(state.tun.stack,'gvisor');
 await f.service.save({...kernel,tun:{enable:true,stack:'nonsense'}});
 state=await f.service.view({controller:false});
 assert.equal(state.tun.stack,'gvisor');
 await f.service.uninstallTunService();
 state=await f.service.view({controller:false});
 assert.equal(state.tun.enable,false);
 assert.equal((await f.service.tunService()).installed,false);
});
test('TUN 服务安装要求内核已配置且内核未运行',async()=>{
 const f=fixture();
 await assert.rejects(f.service.installTunService());
 await f.service.save(kernel);await f.service.start();
 await assert.rejects(f.service.installTunService(),/停止内核/);
});
test('旧凭据为不可解析密文时跳过迁移，view 与新增订阅仍可用',async()=>{
 // 真实机器上 credentials/subscription.json 可能已是加密 blob；旧实现直接 new URL 会抛错，
 // 导致 config() 每次失败：页面显示「尚未添加订阅」，保存订阅也无反应。
 const disk=new Map([['secret/credentials/subscription.json','\u0000binary-blob-not-a-url']]);
 const f=fixture(disk);
 const state=await f.service.view({controller:false});
 assert.deepEqual(state.subscriptions,[]);
 assert.equal(disk.get('secret/credentials/subscription.json'),'\u0000binary-blob-not-a-url');
 const saved=await f.service.subscriptionSave({name:'9YUN',url:'https://example.test/sub?token=PRIVATE'});
 assert.equal(saved.subscriptions.length,1);
 assert.equal(saved.subscriptions[0].name,'9YUN');
});
test('旧凭据跳过迁移时向页面回报 legacyPending，提示重新添加',async()=>{
 const disk=new Map([['secret/credentials/subscription.json','\u0000binary-blob']]);
 const f=fixture(disk);
 assert.equal((await f.service.view({controller:false})).legacyPending,true);
 await f.service.subscriptionSave({name:'A',url:'https://example.test/a'});
 assert.equal((await f.service.view({controller:false})).legacyPending,true);
});
