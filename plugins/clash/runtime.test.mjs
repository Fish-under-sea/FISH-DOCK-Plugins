import test from 'node:test';
import assert from 'node:assert/strict';
import {createProxyLease, kernelConfig} from './runtime.mjs';
test('代理接管先持久化原值，仅在当前值仍属于自身时恢复',async()=>{
 let live={ProxyEnable:1,ProxyServer:'foreign:8888',ProxyOverride:null},saved=null,writes=0;
 const store={read:async()=>saved,write:async(c,n,v)=>{saved=v}},adapter={read:async()=>({...live}),write:async v=>{writes++;live={...v}}};
 const lease=createProxyLease({storage:store,adapter});await lease.enable(7895);assert.equal(lease.active(),true);assert.equal(live.ProxyServer,'127.0.0.1:7895');assert.ok(JSON.parse(saved).previous.ProxyServer==='foreign:8888');
 await lease.restore();assert.equal(live.ProxyServer,'foreign:8888');assert.equal(live.ProxyEnable,1);assert.equal(saved,'');
 await lease.enable(7895);live.ProxyServer='external:9999';await lease.restore();assert.equal(live.ProxyServer,'external:9999');assert.equal(lease.active(),false);assert.equal(writes,3);
});
test('异常后新实例可恢复持久化代理快照，持久化失败不更改系统',async()=>{
 let live={ProxyEnable:0,ProxyServer:null,ProxyOverride:null},saved='',writes=0;
 const storage={read:async()=>saved,write:async(c,n,v)=>{saved=v}},adapter={read:async()=>({...live}),write:async v=>{live=v;writes++}};
 await createProxyLease({storage,adapter}).enable(7895);await createProxyLease({storage,adapter}).restore();assert.equal(live.ProxyEnable,0);
 const broken={read:async()=>null,write:async()=>{throw Error('disk-full')}};await assert.rejects(createProxyLease({storage:broken,adapter}).enable(7895));assert.equal(writes,2);
});
test('mihomo uses independent local file providers with stable source prefixes and no subscription URL',()=>{
 const a='sub-00000000-0000-0000-0000-000000000001',b='sub-00000000-0000-0000-0000-000000000002';
 const c=kernelConfig({mixedPort:7895,controllerPort:9099,secret:'synthetic',dataDirectory:'D:/synthetic',subscriptions:[{id:a,enabled:true},{id:b,enabled:true}]});
 assert.equal(c['external-controller'],'127.0.0.1:9099');assert.equal(c['allow-lan'],false);
 assert.deepEqual(c['proxy-groups'][0].use,[a,b]);
 assert.notEqual(c['proxy-providers'][a].path,c['proxy-providers'][b].path);
 assert.equal(c['proxy-providers'][a].override['additional-prefix'],`[${a}] `);
 assert.equal(c['proxy-providers'][a].type,'file');assert.equal(c['proxy-providers'][a].url,undefined);
});
