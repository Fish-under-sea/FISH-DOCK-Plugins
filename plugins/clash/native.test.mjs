import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createClash} from './service.mjs';
import {createRuntime} from './runtime.mjs';
import {subscriptionPath} from './subscriptions.mjs';
const idA='sub-00000000-0000-0000-0000-000000000001',idB='sub-00000000-0000-0000-0000-000000000002';
const MAIN='🚀 节点选择';
// 内置 geo 数据目录：随包分发时由 backend 注入；测试用仓库内 service 目录。
const geoDir=fileURLToPath(new URL('./service',import.meta.url));
async function port() {
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const value=server.address().port;await new Promise(r=>server.close(r));return value;
}
test('native SafePath: two credentials providers outside config home, same-name selection and isolated reload',
 {skip:!process.env.FISH_TEST_MIHOMO,timeout:25000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'fish-clash-native 中文 '));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const context={dataDirectory:root,storage:{
  read:async(c,n)=>readFile(join(root,c,n),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e}),
  write:async(c,n,v)=>{await mkdir(join(root,c),{recursive:true});await writeFile(join(root,c,n),v)}
 }};
 await mkdir(join(root,'credentials'));
 const payload=(name,extra='')=>`proxies:\n  - name: ${name}\n    type: ss\n    server: 127.0.0.1\n    port: 9\n    cipher: aes-128-gcm\n    password: synthetic-only\n${extra}`;
 await writeFile(subscriptionPath(root,idA),payload('same','  - name: 剩余流量：228.87 GB\n    type: ss\n    server: 127.0.0.1\n    port: 9\n    cipher: aes-128-gcm\n    password: synthetic-only\n'));
 await writeFile(subscriptionPath(root,idB),payload('same','  - name: Traffic Reset：18 Days Left\n    type: ss\n    server: 127.0.0.1\n    port: 9\n    cipher: aes-128-gcm\n    password: synthetic-only\n'));
 const runtime=createRuntime({...context,geoDir}),controllerPort=await port(),mixedPort=await port(),secret='synthetic-test-only';
 const instance=await runtime.start({kernel:process.env.FISH_TEST_MIHOMO,controllerPort,mixedPort,secret,
  subscriptions:[{id:idA,enabled:true},{id:idB,enabled:true}]});
 t.after(()=>instance.stop());
 const request=async(path,method='GET',body)=>{
  const response=await fetch(`http://127.0.0.1:${controllerPort}${path}`,{method,headers:{
   Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(response.ok,`controller ${method} ${path} returned ${response.status}`);
  return response.status===204?{}:response.json();
 };
 const proxies=(await request('/proxies')).proxies;
 // Verge 风格组树：主组含自动选择、故障转移、DIRECT 与两个真实订阅节点（信息假节点被 exclude-filter 排除）。
 const main=proxies[MAIN];
 assert.ok(main,`应有代理组 ${MAIN}`);
 for(const name of [`[${idA}] same`,`[${idB}] same`])assert.ok(main.all.includes(name),`主组应含 ${name}`);
 assert.ok(!main.all.some(n=>n.includes('剩余流量')||n.includes('Traffic Reset')),'主组不得混入订阅信息假节点');
 assert.ok(main.all.includes('♻️ 自动选择')&&main.all.includes('🩺 故障转移')&&main.all.includes('DIRECT'));
 const auto=proxies['♻️ 自动选择'];
 assert.deepEqual([...auto.all].sort(),[`[${idA}] same`,`[${idB}] same`].sort());
 assert.equal(proxies['🐙 GitHub']?.now,MAIN);
 await request(`/proxies/${encodeURIComponent(MAIN)}`,'PUT',{name:`[${idB}] same`});
 assert.equal((await request('/proxies')).proxies[MAIN].now,`[${idB}] same`);
 await writeFile(subscriptionPath(root,idA),payload('changed'));
 await request(`/providers/proxies/${idA}`,'PUT');
 const after=(await request('/proxies')).proxies;
 assert.ok(after[MAIN].all.includes(`[${idA}] changed`));assert.ok(after[MAIN].all.includes(`[${idB}] same`));
 assert.equal(after[MAIN].now,`[${idB}] same`);
 await instance.stop();
 // 回归（mihomo v1.19+）：createClash 对 provider-only 节点需合并 /providers/proxies，
 // 让 view 识别真实协议类型、siteTest/nodeTest 不因 /proxies/<name>/delay 404 失败或报 NODE_UNAVAILABLE。
 const svcCtx={
  dataDirectory:root,
  storage:context.storage,
  secrets:{read:async()=>secret,write:async()=>{}}
 };
 const safeRuntime={
  ...runtime,
  proxy:{enable:async()=>{},restore:async()=>{},active:()=>false},
  envProxy:{enable:async()=>{},restore:async()=>{},active:()=>false}
 };
 await context.storage.write('config','clash.json',JSON.stringify({kernel:process.env.FISH_TEST_MIHOMO,mixedPort,controllerPort,envProxy:false,tun:{enable:false,stack:'mixed'}}));
 await context.storage.write('config','subscriptions.json',JSON.stringify({schema:2,subscriptions:[{id:idB,name:'SubB',enabled:true,status:'ready',hasCache:true,nodeCount:1,lastSuccess:Date.now()}]}));
 const svc=createClash({context:svcCtx,runtime:safeRuntime});
 t.after(()=>svc.shutdown().catch(()=>{}));
 await svc.start();
 const svcView=await svc.view();
 const svcMain=svcView.groups.find(g=>g.name===MAIN);
 const leafNode=svcMain?.nodes.find(n=>n.name===`[${idB}] same`);
 assert.equal(leafNode?.type,'Shadowsocks','真实 mihomo v1.19.34 下应从 /providers/proxies 补全节点类型');
 const siteRes=await svc.siteTest();
 assert.equal(siteRes.node,`[${idB}] same`,'siteTest 在真实 mihomo 上不得因 NODE_UNAVAILABLE 失败');
 assert.equal(siteRes.sites.every(s=>s.code!=='CONTROLLER_TIMEOUT'),true,'siteTest 不得误报 CONTROLLER_TIMEOUT');
 const nodeRes=await svc.nodeTest({group:MAIN});
 assert.ok(nodeRes.delays.some(d=>d.name===`[${idB}] same`),'nodeTest 应覆盖 provider 节点');
 await svc.stop();
 assert.equal(await context.storage.read('config','system-proxy.json'),null);
 assert.equal(await context.storage.read('tmp','mihomo-runtime.json'),'');
});

test('native Verge-parity: 单条完整订阅 YAML 合并启动 mihomo v1.19.34，保留原生组树、清理连接并记录脱敏 mihomo.log',
 {skip:!process.env.FISH_TEST_MIHOMO,timeout:25000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'fish-clash-native-b1-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const storage={
  read:async(c,n)=>readFile(join(root,c,n),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e}),
  write:async(c,n,v)=>{await mkdir(join(root,c),{recursive:true});await writeFile(join(root,c,n),v)}
 };
 await mkdir(join(root,'credentials'),{recursive:true});
 const nativeSub=[
  'port: 7890',
  'allow-lan: true',
  'external-controller: 0.0.0.0:19090',
  'secret: leaked-sub-secret',
  'proxies:',
  '  - {name: "🇯🇵 Japan 04", type: ss, server: 127.0.0.1, port: 9, cipher: aes-128-gcm, password: synthetic-only}',
  '  - {name: "🇸🇬 Singapore 01", type: ss, server: 127.0.0.1, port: 9, cipher: aes-128-gcm, password: synthetic-only}',
  'proxy-groups:',
  '  - name: Kuromis',
  '    type: select',
  '    proxies: ["🇯🇵 Japan 04", "🇸🇬 Singapore 01", DIRECT]',
  'rules:',
  '  - GEOIP,CN,DIRECT',
  '  - MATCH,Kuromis'
 ].join('\n');
 await writeFile(subscriptionPath(root,idA),nativeSub,'utf8');
 const controllerPort=await port(),mixedPort=await port(),secret='native-b1-secret-123456';
 const rawRuntime=createRuntime({dataDirectory:root,storage,geoDir});
 const safeRuntime={
  ...rawRuntime,
  proxy:{enable:async()=>{},restore:async()=>{},active:()=>false},
  envProxy:{enable:async()=>{},restore:async()=>{},active:()=>false}
 };
 await storage.write('config','clash.json',JSON.stringify({kernel:process.env.FISH_TEST_MIHOMO,mixedPort,controllerPort,envProxy:false,profileMode:'subscription',tun:{enable:false,stack:'gvisor',strictRoute:false}}));
 await storage.write('config','subscriptions.json',JSON.stringify({schema:2,subscriptions:[{id:idA,name:'NativeSub',enabled:true,status:'ready',hasCache:true,nodeCount:2,lastSuccess:Date.now()}]}));
 const svc=createClash({context:{dataDirectory:root,storage,secrets:{read:async()=>secret,write:async()=>{}}},runtime:safeRuntime});
 t.after(()=>svc.shutdown().catch(()=>{}));
 await svc.start();
 const st=await svc.view();
 assert.equal(st.running,true);
 const kuromis=st.groups.find(g=>g.name==='Kuromis');
 assert.ok(kuromis,'应加载订阅原生代理组 Kuromis');
 assert.equal(kuromis.selected,'🇯🇵 Japan 04');
 // select 切换并验证真实控制器接受 DELETE /connections
 const afterSel=await svc.select({group:'Kuromis',name:'🇸🇬 Singapore 01'});
 assert.equal(afterSel.groups.find(g=>g.name==='Kuromis')?.selected,'🇸🇬 Singapore 01');
 // siteTest 应能穿透原生组找到叶子节点
 const siteRes=await svc.siteTest();
 assert.equal(siteRes.node,'🇸🇬 Singapore 01');
 // mihomo.log 已落盘且不得包含明文 secret
 const logText=await readFile(join(root,'tmp','mihomo.log'),'utf8');
 assert.ok(logText.includes('[fish-clash] start mihomo'));
 assert.equal(logText.includes(secret),false,'mihomo.log 不得泄露明文控制器密钥');
 await svc.stop();
});
