import test from 'node:test';
import assert from 'node:assert/strict';
import {createProxyLease, createRuntime, kernelConfig, ensureGeoData, tunHandoverNeeded, GEO_FILES, proxiedGet} from './runtime.mjs';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
test('代理组生成 Verge 风格组树：主组引用 providers，规则按类别分流',()=>{
 const a='sub-00000000-0000-0000-0000-000000000001',b='sub-00000000-0000-0000-0000-000000000002';
 const c=kernelConfig({mixedPort:7895,controllerPort:9099,secret:'synthetic',dataDirectory:'D:/synthetic',subscriptions:[{id:a,enabled:true},{id:b,enabled:true}],geo:true});
 const groups=c['proxy-groups'],names=groups.map(g=>g.name);
 // 组树完整：主选择、自动测速、广告、分类组、直连组、兜底组。
 assert.deepEqual(names,['🚀 节点选择','♻️ 自动选择','🛑 广告拦截','📲 Telegram','🤖 AI 服务','Ⓜ️ 微软服务','🍎 苹果服务','🎯 全球直连','🐟 漏网之鱼']);
 const by=Object.fromEntries(groups.map(g=>[g.name,g]));
 // 主组同时引用自动选择、DIRECT 与全部 provider 节点。
 assert.equal(by['🚀 节点选择'].type,'select');
 assert.deepEqual(by['🚀 节点选择'].proxies,['♻️ 自动选择','DIRECT']);
 assert.deepEqual(by['🚀 节点选择'].use,[a,b]);
 assert.equal(by['♻️ 自动选择'].type,'url-test');
 assert.ok(by['♻️ 自动选择'].url.startsWith('https://'));
 assert.equal(by['♻️ 自动选择'].interval,300);
 // 分类组默认直连的（微软/苹果）DIRECT 排第一，走代理的组节点选择排第一。
 assert.equal(by['Ⓜ️ 微软服务'].proxies[0],'DIRECT');
 assert.equal(by['🍎 苹果服务'].proxies[0],'DIRECT');
 assert.equal(by['📲 Telegram'].proxies[0],'🚀 节点选择');
 assert.equal(by['🤖 AI 服务'].proxies[0],'🚀 节点选择');
 // 规则按类别分流，国内直连，最终兜底到漏网之鱼。
 const rules=c.rules;
 assert.equal(rules.at(-1),'MATCH,🐟 漏网之鱼');
 assert.ok(rules.some(r=>r==='GEOSITE,cn,🎯 全球直连'));
 assert.ok(rules.some(r=>r==='GEOIP,cn,🎯 全球直连,no-resolve'));
 assert.ok(rules.some(r=>r==='GEOSITE,category-ads-all,🛑 广告拦截'));
 assert.ok(rules.some(r=>r.startsWith('GEOSITE,telegram')));
 assert.ok(rules.some(r=>r.startsWith('GEOSITE,openai')));
 assert.ok(rules.some(r=>r.startsWith('GEOSITE,microsoft')));
 assert.ok(rules.some(r=>r.startsWith('GEOSITE,apple')));
 // 组引用的名称全部存在（组名或内置），不存在悬空引用。
 const known=new Set([...names,'DIRECT','REJECT','REJECT-DROP','PASS','COMPATIBLE']);
 for(const g of groups)for(const name of g.proxies||[])assert.ok(known.has(name),`未知引用 ${name}`);
 // geo 数据走国内镜像，首启不依赖 github 直连。
 assert.ok(Array.isArray(c['geo-download-urls'])&&c['geo-download-urls'].length>=2);
 assert.ok(c['geo-download-urls'].every(u=>/^https:\/\/.+\/$/.test(u)));
});
test('无 geo 数据时降级为不依赖 GEOSITE/GEOIP 的规则，组树仍完整',()=>{
 const a='sub-00000000-0000-0000-0000-000000000001';
 const c=kernelConfig({mixedPort:7895,controllerPort:9099,secret:'synthetic',dataDirectory:'D:/synthetic',subscriptions:[{id:a,enabled:true}],geo:false});
 // 组树不因缺 geo 而缺失。
 assert.equal(c['proxy-groups'].length,9);
 assert.equal(c['proxy-groups'].map(g=>g.name)[0],'🚀 节点选择');
 // 规则不含任何 GEOSITE/GEOIP（否则内核会因缺数据致命退出）。
 assert.ok(!c.rules.some(r=>r.startsWith('GEOSITE')||r.startsWith('GEOIP')),'降级规则不得引用 geo');
 assert.ok(c.rules.includes('DOMAIN-SUFFIX,cn,🎯 全球直连'));
 assert.ok(c.rules.includes('IP-CIDR,192.168.0.0/16,🎯 全球直连,no-resolve'));
 assert.equal(c.rules.at(-1),'MATCH,🐟 漏网之鱼');
 assert.equal(c['geo-download-urls'],undefined);
});
test('无订阅时不生成组树，规则保持纯直连',()=>{
 const c=kernelConfig({mixedPort:7895,controllerPort:9099,secret:'synthetic',dataDirectory:'D:/synthetic',subscriptions:[]});
 assert.equal(c['proxy-groups'],undefined);assert.equal(c['proxy-providers'],undefined);
 assert.deepEqual(c.rules,['MATCH,DIRECT']);
});
test('TUN 关闭时不生成 tun/dns 段，开启时生成且栈值受控',()=>{
 const base2={mixedPort:7895,controllerPort:9099,secret:'synthetic',dataDirectory:'D:/synthetic',subscriptions:[]};
 const off=kernelConfig({...base2,tun:{enable:false,stack:'mixed'}});
 assert.equal(off.tun,undefined);assert.equal(off.dns,undefined);
 const on=kernelConfig({...base2,tun:{enable:true,stack:'gvisor'}});
 assert.equal(on.tun.enable,true);assert.equal(on.tun.stack,'gvisor');
 assert.deepEqual(on.tun['dns-hijack'],['any:53']);assert.equal(on.tun['auto-route'],true);
 assert.equal(on.dns.enable,true);assert.equal(on.dns['enhanced-mode'],'fake-ip');
 const weird=kernelConfig({...base2,tun:{enable:true,stack:'nonsense'}});
 assert.equal(weird.tun.stack,'mixed');
});
test('ensureGeoData：包内文件优先、网络双源回退、已有文件幂等、全失败不抛出',async t=>{
 // 包内随附场景：直接从 bundleDir 复制，完全不发网络请求。
 const bundle=await mkdtemp(join(tmpdir(),'fish-geo-bundle-'));t.after(()=>rm(bundle,{recursive:true,force:true}));
 const homeBundle=await mkdtemp(join(tmpdir(),'fish-geo-home-'));t.after(()=>rm(homeBundle,{recursive:true,force:true}));
 for(const name of GEO_FILES)await writeFile(join(bundle,name),Buffer.alloc(2*1024*1024,7));
 let bundleFetches=0;
 assert.equal(await ensureGeoData(homeBundle,{bundleDir:bundle,fetch:async()=>{bundleFetches++;return new Response('x')},timeoutMs:500}),true);
 assert.equal(bundleFetches,0,'包内有文件时不应发网络请求');
 for(const name of GEO_FILES)assert.equal((await readFile(join(homeBundle,name))).length,2*1024*1024);
 // 包内文件过小（可疑）则回退网络。
 const smallBundle=await mkdtemp(join(tmpdir(),'fish-geo-small-'));t.after(()=>rm(smallBundle,{recursive:true,force:true}));
 for(const name of GEO_FILES)await writeFile(join(smallBundle,name),Buffer.from('tiny'));
 const homeSmall=await mkdtemp(join(tmpdir(),'fish-geo-home-'));t.after(()=>rm(homeSmall,{recursive:true,force:true}));
 assert.equal(await ensureGeoData(homeSmall,{bundleDir:smallBundle,fetch:async()=>new Response(new Uint8Array([1,2,3,4,5]),{status:200}),timeoutMs:500}),true);
 assert.deepEqual([...await readFile(join(homeSmall,GEO_FILES[0]))],[1,2,3,4,5]);
 // 无包内文件时的网络行为：全失败 → false 且不落文件。
 const home=await mkdtemp(join(tmpdir(),'fish-geo-'));t.after(()=>rm(home,{recursive:true,force:true}));
 let mode='all-fail';const seen=[];
 const fetcher=async(url)=>{seen.push(url);
  if(mode==='all-fail')return new Response('gateway down',{status:502});
  if(mode==='first-fail'&&url.includes('gh-proxy'))return new Response(null,{status:504});
  if(mode==='empty-body')return new Response('',{status:200});
  return new Response(new Uint8Array([1,2,3,4,5]),{status:200});};
 assert.equal(await ensureGeoData(home,{fetch:fetcher,timeoutMs:500}),false);
 assert.deepEqual(await readdir(home),[]);
 assert.equal(seen.length,GEO_FILES.length*4,'两个文件各试两个源×2 次重试');
 // 首源两次重试都失败、第二源成功：文件落到第二源。
 mode='first-fail';seen.length=0;
 assert.equal(await ensureGeoData(home,{fetch:fetcher,timeoutMs:500}),true);
 for(const name of GEO_FILES)assert.deepEqual([...await readFile(join(home,name))],[1,2,3,4,5]);
 assert.equal(seen.length,GEO_FILES.length*3,'首源重试 2 次后回退第二源');
 // 幂等：文件已存在时不发请求。
 seen.length=0;
 assert.equal(await ensureGeoData(home,{fetch:fetcher,timeoutMs:500}),true);
 assert.equal(seen.length,0);
 // 空响应体：跳过该源继续回退，全部为空则 false 且不落文件。
 mode='empty-body';
 const home2=await mkdtemp(join(tmpdir(),'fish-geo-'));t.after(()=>rm(home2,{recursive:true,force:true}));
 assert.equal(await ensureGeoData(home2,{fetch:fetcher,timeoutMs:500}),false);
 assert.deepEqual(await readdir(home2),[]);
});

test('出口 IP 查询把绝对 URI 交给本地代理口，并拒绝异常、超限与非 JSON 响应',async()=>{
 const seen=[];let reply={status:200,body:'{"ip":"203.0.113.7"}'};
 const server=createServer((request,response)=>{
  seen.push({method:request.method,url:request.url,host:request.headers.host});
  response.writeHead(reply.status,{'Content-Type':'application/json'});response.end(reply.body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 try{
  assert.deepEqual(await proxiedGet('http://ip-api.test/json?x=1',{port,timeoutMs:3000}),{ip:'203.0.113.7'});
  // 明文目标必须用绝对 URI 交给代理，Host 保留目标域名而不是代理地址。
  assert.deepEqual(seen[0],{method:'GET',url:'http://ip-api.test/json?x=1',host:'ip-api.test'});
  reply={status:502,body:'{}'};
  await assert.rejects(proxiedGet('http://ip-api.test/json',{port,timeoutMs:3000}),/异常状态/);
  reply={status:200,body:'not json'};
  await assert.rejects(proxiedGet('http://ip-api.test/json',{port,timeoutMs:3000}),/有效 JSON/);
  reply={status:200,body:'x'.repeat(2048)};
  await assert.rejects(proxiedGet('http://ip-api.test/json',{port,timeoutMs:3000,limit:256}),/超过限制/);
  await assert.rejects(proxiedGet('ftp://ip-api.test/json',{port}),/查询地址无效/);
  await assert.rejects(proxiedGet('http://ip-api.test/json',{port:0}),/代理端口无效/);
 } finally {
  await new Promise(resolve=>server.close(resolve));
 }
});
// 普通模式起内核前，必须让 TUN 服务把它的内核交出来：两者写同一个控制器端口，
// 同时跑就成了「TUN 与普通模式只有一个能用」。
test('TUN 服务还托管着内核时才需要交还，其余状态不误停',()=>{
 assert.equal(tunHandoverNeeded({installed:true,enabled:true,state:'running'}),true);
 assert.equal(tunHandoverNeeded({installed:true,enabled:false,state:'running'}),false,'job 已关，服务里没有内核');
 assert.equal(tunHandoverNeeded({installed:true,enabled:true,state:'stopped'}),false,'服务停着，端口是空的');
 assert.equal(tunHandoverNeeded({installed:false,enabled:false,state:'absent'}),false);
 assert.equal(tunHandoverNeeded(null),false);
 assert.equal(tunHandoverNeeded(undefined),false);
});
// 出口 IP 查询能力必须由 runtime 交出去：service 用 runtime.proxiedGet 判断
// 「运行时是否支持查询出口 IP」。漏了这一项，页面就永远显示那句话。
test('runtime 暴露 proxiedGet，service 才能真正经代理查询出口 IP',()=>{
 const context={dataDirectory:'D:/synthetic/.fishplugin-clash',storage:{read:async()=>null,write:async()=>{}},tun:null};
 const runtime=createRuntime(context);
 assert.equal(typeof runtime.proxiedGet,'function');
 assert.equal(runtime.proxiedGet,proxiedGet);
});
