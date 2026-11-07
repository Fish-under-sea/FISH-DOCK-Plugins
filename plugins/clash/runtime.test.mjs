import test from 'node:test';
import assert from 'node:assert/strict';
import {createProxyLease, createRuntime, kernelConfig, ensureGeoData, tunHandoverNeeded, GEO_FILES, proxiedGet, killProcess, pruneTmp} from './runtime.mjs';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,readdir,rm,mkdir,utimes} from 'node:fs/promises';
import {existsSync} from 'node:fs';
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
test('mihomo uses independent local file providers with stable source prefixes and no subscription URL',()=>{ const a='sub-00000000-0000-0000-0000-000000000001',b='sub-00000000-0000-0000-0000-000000000002';
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
// #14 现象 B 的直接成因：记录被别的程序改过（TUN / 其他代理）→ 每次 stop 都失败。
// 「记录对不上」要降级成带 code 的可诊断错误，并把租约丢掉，别让它反复拖垮停止。
test('系统代理恢复记录无效：带 code、丢弃租约，且不拦住下一次接管',async()=>{
 let saved=JSON.stringify({schema:2,previous:{ProxyEnable:0}});
 const live={ProxyEnable:1,ProxyServer:'foreign:8888',ProxyOverride:null};
 const store={read:async()=>saved,write:async(c,n,v)=>{saved=v}};
 const adapter={read:async()=>({...live}),write:async value=>{Object.assign(live,value)}};
 const lease=createProxyLease({storage:store,adapter});
 await assert.rejects(lease.restore(),error=>error.code==='PROXY_RESTORE_RECORD_INVALID');
 assert.equal(saved,'','坏记录要丢弃，否则每次停止都失败');
 assert.equal(lease.active(),false);
 await lease.enable(7895);
 assert.equal(live.ProxyServer,'127.0.0.1:7895');
});
test('注册表读写失败各有独立错误码；写失败保留租约，下次停止还能重试',async()=>{
 const owned={ProxyEnable:1,ProxyServer:'127.0.0.1:7895',ProxyOverride:'<local>'};
 let saved=JSON.stringify({schema:1,previous:{ProxyEnable:0,ProxyServer:null,ProxyOverride:null},owned});
 const store={read:async()=>saved,write:async(c,n,v)=>{saved=v}};
 const readOnly={read:async()=>({...owned}),write:async()=>{throw Error('denied')}};
 await assert.rejects(createProxyLease({storage:store,adapter:readOnly}).restore(),
  error=>error.code==='PROXY_REGISTRY_WRITE_FAILED');
 assert.ok(saved.length>0,'写失败时保留租约，下次停止仍可重试');
 const broken={read:async()=>{throw Error('io')},write:async()=>{throw Error('io')}};
 await assert.rejects(createProxyLease({storage:broken,adapter:readOnly}).restore(),
  error=>error.code==='PROXY_REGISTRY_READ_FAILED');
});
test('killProcess 对已退出/非法 pid 直接成功，不需要调用方先判活',async()=>{
 assert.equal(await killProcess(0),true);
 assert.equal(await killProcess(-1),true);
 assert.equal(await killProcess(2147483646,{timeoutMs:200,step:20}),true,'不存在的 pid 视为已结束');
});
// 出口 IP 查询能力必须由 runtime 交出去：service 用 runtime.proxiedGet 判断
// 「运行时是否支持查询出口 IP」。漏了这一项，页面就永远显示那句话。
test('runtime 暴露 proxiedGet，service 才能真正经代理查询出口 IP',()=>{
 const context={dataDirectory:'D:/synthetic/.fishplugin-clash',storage:{read:async()=>null,write:async()=>{}},tun:null};
 const runtime=createRuntime(context);
 assert.equal(typeof runtime.proxiedGet,'function');
 assert.equal(runtime.proxiedGet,proxiedGet);
});
// 插件重载后 attach 到的内核不是本实例 spawn 的，只能按 pid 结束：runtime 必须交出这个能力。
test('runtime 交出 kill/processAlive，service 才能结束残留内核',()=>{
 const context={dataDirectory:'D:/synthetic/.fishplugin-clash',storage:{read:async()=>null,write:async()=>{}},tun:null};
 const runtime=createRuntime(context);
 assert.equal(typeof runtime.kill,'function');
 assert.equal(runtime.kill,killProcess);
 assert.equal(typeof runtime.processAlive,'function');
 assert.equal(runtime.processAlive(process.pid),true);
 assert.equal(runtime.processAlive(2147483646),false);
});
// §3.3 第 1 步：把 start 里「拼 proxy-providers 并落盘」那段抽成 writeConfig，start 复用它。
test('writeConfig 与 start 共用同一份生成逻辑：路径固定、内容与 kernelConfig 一致',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clash-cfg-'));
 try{
  const storage={read:async(c,n)=>{try{return await readFile(join(dir,c,n),'utf8')}catch{return null}},
   write:async(c,n,v)=>{await mkdir(join(dir,c),{recursive:true});await writeFile(join(dir,c,n),v,'utf8')}};
  const runtime=createRuntime({dataDirectory:dir,storage});
  const sub={id:'sub-00000000-0000-0000-0000-000000000001',enabled:true};
  const path=await runtime.writeConfig({settings:{mixedPort:7895,controllerPort:9099},secret:'synthetic',subscriptions:[sub]});
  assert.equal(path,join(dir,'tmp','mihomo-runtime.json'),'内核 -f 读的就是这个路径');
  assert.equal(path,runtime.configPath());
  const written=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(written,kernelConfig({mixedPort:7895,controllerPort:9099,secret:'synthetic',
   dataDirectory:dir,subscriptions:[sub]}),'与 start 时代产物逐字段相同');
 }finally{await rm(dir,{recursive:true,force:true})}
});
// §3.3 第 2 步：热切换先写候选文件，内核确认换上了才 rename 成正式配置；
// 失败则删候选、正式配置一个字节都不动（回滚由 service 负责启用集）。
test('运行中换配置：候选文件只在 apply 成功后转正，失败时正式配置不变、候选被清掉',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clash-swap-'));
 try{
  const storage={read:async(c,n)=>{try{return await readFile(join(dir,c,n),'utf8')}catch{return null}},
   write:async(c,n,v)=>{await mkdir(join(dir,c),{recursive:true});await writeFile(join(dir,c,n),v,'utf8')}};
  const runtime=createRuntime({dataDirectory:dir,storage});
  const settings={mixedPort:7895,controllerPort:9099};
  const a='sub-00000000-0000-0000-0000-000000000001',b='sub-00000000-0000-0000-0000-000000000002';
  const candidate=join(dir,'tmp','mihomo-runtime.next.json');
  await runtime.writeConfig({settings,secret:'k',subscriptions:[{id:a,enabled:true}]});
  let applied=null;
  await runtime.swapConfig({settings,secret:'k',subscriptions:[{id:a,enabled:false},{id:b,enabled:true}],
   apply:async path=>{
    applied=path;
    assert.equal(path,candidate,'先写候选文件，不直接盖正式配置');
    const value=JSON.parse(await readFile(path,'utf8'));
    assert.deepEqual(Object.keys(value['proxy-providers']),[b],'候选配置带的是新启用集');
   }});
  assert.equal(applied,candidate);
  const live=JSON.parse(await readFile(join(dir,'tmp','mihomo-runtime.json'),'utf8'));
  assert.deepEqual(Object.keys(live['proxy-providers']),[b],'成功后正式配置换成新的一套');
  assert.equal(existsSync(candidate),false,'候选文件已转正，不残留');
  const before=await readFile(join(dir,'tmp','mihomo-runtime.json'),'utf8');
  await assert.rejects(runtime.swapConfig({settings,secret:'k',subscriptions:[{id:a,enabled:true}],
   apply:async()=>{const error=Error('controller said no');error.code='CONTROLLER_UNREACHABLE';throw error}}),
   error=>error.code==='CONTROLLER_UNREACHABLE');
  assert.equal(await readFile(join(dir,'tmp','mihomo-runtime.json'),'utf8'),before,'失败时正式配置一个字节都没动');
  assert.equal(existsSync(candidate),false,'失败也把候选文件清掉');
 }finally{await rm(dir,{recursive:true,force:true})}
});
// Dock 被强杀留下的系统代理租约：启动时必须自己收干净，否则没有代理进程的机器
// 整台电脑的网都指向 127.0.0.1（用户报的「网络回环、无法联网」）。
test('启动自愈：残留租约在 registry 仍是我们那份时被还原',async()=>{
 let saved=JSON.stringify({schema:1,previous:{ProxyEnable:0,ProxyServer:'',ProxyOverride:''},
  owned:{ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>'},
  owner:{pid:1234,at:1}});
 let live={ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>'};
 const storage={read:async()=>saved,write:async(c,n,v)=>{saved=v}};
 const adapter={read:async()=>({...live}),write:async values=>{live={...values}}};
 const lease=createProxyLease({storage,adapter});
 const result=await lease.recoverStale();
 assert.equal(result.act,'restore');
 assert.deepEqual(live,{ProxyEnable:0,ProxyServer:'',ProxyOverride:''},'注册表要还原成上次的原样');
 assert.equal(saved,'','租约要清掉');
});

// 别的程序（TUN、另一个代理）改过注册表：只清我们自己的记录，不覆盖别人的设置。
test('启动自愈：注册表已被别人改过时只丢记录',async()=>{
 let saved=JSON.stringify({schema:1,previous:{ProxyEnable:0,ProxyServer:'',ProxyOverride:''},
  owned:{ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>'}});
 const live={ProxyEnable:1,ProxyServer:'127.0.0.1:9999',ProxyOverride:'*'};
 const storage={read:async()=>saved,write:async(c,n,v)=>{saved=v}};
 const adapter={read:async()=>({...live}),write:async values=>{live={...values}}};
 const lease=createProxyLease({storage,adapter});
 await lease.recoverStale();
 assert.deepEqual(live,{ProxyEnable:1,ProxyServer:'127.0.0.1:9999',ProxyOverride:'*'},'别人的设置不许动');
 assert.equal(saved,'');
});

// 没有租约时自愈什么都不做（绝大多数正常启动走这条）。
test('启动自愈：没有租约时是 no-op',async()=>{
 const storage={read:async()=>null,write:async()=>{}};
 let wrote=false;
 const adapter={read:async()=>({ProxyEnable:0,ProxyServer:'',ProxyOverride:''}),write:async()=>{wrote=true}};
 const lease=createProxyLease({storage,adapter});
 assert.equal((await lease.recoverStale()).act,'nothing');
 assert.equal(wrote,false);
});

// 看门狗的判定：记录属于自己才还原；记录已换成新实例（owner.pid 不同）就撒手。
test('看门狗判定：自己的租约还原，新实例的租约不动，对不上只丢记录',async()=>{
 const {plan}=await import('./watchdog.mjs');
 const owned={ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>'};
 const previous={ProxyEnable:0,ProxyServer:'',ProxyOverride:''};
 const record={schema:1,previous,owned,owner:{pid:42,at:1}};
 assert.equal(plan(record,{...owned},42).act,'restore');
 assert.equal(plan(record,{...owned},7).act,'superseded','新实例接管了租约');
 assert.equal(plan(record,{ProxyEnable:1,ProxyServer:'127.0.0.1:9999',ProxyOverride:'*'},42).act,'discard');
 assert.equal(plan(null,{...owned},42).act,'discard');
});
// 看门狗真正执行的还原动作（注入 read/write，不碰真注册表）：还原 previous、
// 清掉租约、并把内核进程结束掉。
test('看门狗 recover：还原注册表、清租约、结束内核',async()=>{
 const {recover}=await import('./watchdog.mjs');
 const {mkdtemp,writeFile,readFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const dir=await mkdtemp(join(process.env.FISH_TEST_TMP||tmpdir(),'clash-watchdog-'));
 const lease=join(dir,'system-proxy.json');
 await writeFile(lease,JSON.stringify({schema:1,
  previous:{ProxyEnable:0,ProxyServer:'',ProxyOverride:''},
  owned:{ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>'},
  owner:{pid:4242,at:1}}));
 let live={ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>'};
 const result=await recover({leasePath:lease,parentPid:4242,mihomoPid:0,
  read:async()=>({...live}),write:async values=>{live={...values}}});
 assert.equal(result.act,'restore');
 assert.deepEqual(live,{ProxyEnable:0,ProxyServer:'',ProxyOverride:''});
 assert.equal(await readFile(lease,'utf8').catch(()=>''),'','租约要清掉');
});
// 关掉内核后本机没网：没有租约，但注册表还指着我们的混合端口 → 停止时直接关代理。
test('没有租约但注册表指着我们的端口：restore 直接关掉系统代理',async()=>{
 let live={ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>'};
 const storage={read:async()=>null,write:async()=>{}};
 const adapter={read:async()=>({...live}),write:async values=>{live={...values}}};
 const lease=createProxyLease({storage,adapter});
 const result=await lease.restore(7890);
 assert.equal(result.act,'disabled-stale');
 assert.equal(Number(live.ProxyEnable),0,'指着死端口的系统代理要关掉');
 assert.equal(live.ProxyServer,'127.0.0.1:7890','只关开关，不动别人的地址');
});

// 注册表指着别的端口（别人的代理）时不许动。
test('registry 指着别人的代理时 restore 什么都不做',async()=>{
 let live={ProxyEnable:1,ProxyServer:'127.0.0.1:7895',ProxyOverride:'<local>'};
 const storage={read:async()=>null,write:async()=>{}};
 const adapter={read:async()=>({...live}),write:async values=>{live={...values}}};
 const lease=createProxyLease({storage,adapter});
 const result=await lease.restore(7890);
 assert.equal(result.act,'nothing');
 assert.equal(Number(live.ProxyEnable),1,'别人的代理不许动');
});

// #44：恢复失败不能只说「请检查权限」。被拒的键名与 Win32 码要跟着错误走，
// 而且不能把代理地址带进日志。
test('#44 恢复系统代理失败带被拒键名与 Win32 码',async()=>{
 const saved=JSON.stringify({schema:1,previous:{ProxyEnable:0,ProxyServer:'',ProxyOverride:''},owned:{ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:''}});
 const adapter={read:async()=>({ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:''}),
  write:async()=>{const error=Error('拒绝访问');error.key='ProxyServer';error.win32=5;throw error}};
 const lease=createProxyLease({storage:{read:async()=>saved,write:async()=>{}},adapter});
 const error=await lease.recoverStale().catch(error=>error);
 assert.equal(error.code,'PROXY_REGISTRY_WRITE_FAILED');
 assert.equal(error.key,'ProxyServer');
 assert.equal(error.win32,5);
 assert.match(error.message,/写入 ProxyServer 失败/);
 assert.match(error.message,/Win32 5/);
 assert.equal(error.message.includes('127.0.0.1'),false,'错误文案不带代理地址');
});

// #44：启动自愈失败只降级 + 记日志，不抛给启动路径（内核照常起）。
test('#44 自愈失败只记日志并降级，不拦住启动',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fish-clash-selfheal-'));
 const runtime=createRuntime({dataDirectory:root,storage:{read:async()=>null,write:async()=>{}},secrets:{read:async()=>'',write:async()=>{}}});
 runtime.proxy.recoverStale=async()=>{const error=Error('恢复系统代理失败');error.code='PROXY_REGISTRY_WRITE_FAILED';error.key='ProxyServer';error.win32=5;throw error};
 const logged=[];const original=console.error;console.error=(...args)=>logged.push(args.join(' '));
 let result;
 try{result=await runtime.recoverStaleOnce()}finally{console.error=original}
 assert.equal(result.act,'failed');
 const text=logged.join('\n');
 assert.match(text,/PROXY_REGISTRY_WRITE_FAILED/);
 assert.match(text,/ProxyServer/);
 assert.match(text,/Win32 5/);
});

// #46：tmp 里的 import-* 工作目录与写了一半的候选配置，启动时清掉超过宽限期的。
test('pruneTmp 清掉陈旧的导入目录与候选配置，留下正在用的',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fish-clash-tmp-'));
 const tmp=join(root,'tmp');await mkdir(tmp,{recursive:true});
 const staleImport=join(tmp,'import-old'),candidate=join(tmp,'mihomo-runtime.next.json'),live=join(tmp,'mihomo-runtime.json');
 await mkdir(staleImport);await writeFile(join(staleImport,'provider.yaml'),'x');
 await writeFile(candidate,'{}');await writeFile(live,'{}');
 const old=new Date(Date.now()-60*60*1000);
 for(const entry of [staleImport,candidate])await utimes(entry,old,old);
 await pruneTmp(root);
 await assert.rejects(readFile(join(staleImport,'provider.yaml')),{code:'ENOENT'});
 await assert.rejects(readFile(candidate),{code:'ENOENT'});
 await readFile(live);
});

// C5：租约是恢复系统代理的唯一依据。坏 JSON、版本不符、缺字段、字段类型不对，
// 全部走同一条「丢弃租约」路径；自愈只能返回 discard，不能把异常抛到启动路径上。
test('C5 租约坏记录：坏 JSON / schema=2 / 缺字段 / 类型错误都丢弃且不抛',async()=>{
 const live={ProxyEnable:1,ProxyServer:'foreign:8888',ProxyOverride:null};
 const previous={ProxyEnable:0,ProxyServer:'',ProxyOverride:''};
 const owned={ProxyEnable:1,ProxyServer:'127.0.0.1:7895',ProxyOverride:''};
 const badRecords=[
  '{"schema":1,',
  JSON.stringify({schema:2,previous,owned}),
  JSON.stringify({schema:1,previous}),
  JSON.stringify({schema:1,owned}),
  JSON.stringify({schema:1,previous:{ProxyEnable:'1',ProxyServer:'',ProxyOverride:''},owned}),
  JSON.stringify({schema:1,previous,owned:{ProxyEnable:1,ProxyServer:127,ProxyOverride:''}}),
  JSON.stringify({schema:1,previous:[],owned})
 ];
 for(const raw of badRecords){
  let saved=raw,registryWrites=0;
  const storage={read:async()=>saved,write:async(c,n,v)=>{saved=v}};
  const adapter={read:async()=>({...live}),write:async()=>{registryWrites++}};
  const lease=createProxyLease({storage,adapter});
  const result=await lease.recoverStale();
  assert.deepEqual(result,{act:'discard'},`坏记录应丢弃：${raw}`);
  assert.equal(saved,'',`坏记录要清空：${raw}`);
  assert.equal(registryWrites,0,'坏记录不许写注册表');
 }
});
// C8：看门狗任务的生命周期跟着「系统代理租约」走——启用后创建，恢复后删除，
// 停止/关闭时也要删除；注入执行器，单测不碰真实任务计划。
test('C8 看门狗任务：代理启用后创建、恢复后删除，runtime 停止时也删除',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clash-watchdog-task-'));
 try{
  const storage={read:async(c,n)=>{try{return await readFile(join(dir,c,n),'utf8')}catch{return null}},
   write:async(c,n,v)=>{await mkdir(join(dir,c),{recursive:true});await writeFile(join(dir,c,n),v,'utf8')}};
  let live={ProxyEnable:0,ProxyServer:'',ProxyOverride:''};
  const proxyAdapter={read:async()=>({...live}),write:async values=>{live={...values}}};
  const calls=[];
  const runtime=createRuntime({dataDirectory:dir,storage,proxyAdapter,tun:null,
   watchdogTask:{start:async payload=>{calls.push(['start',payload]);return {ok:true,act:'started'}},
    stop:async()=>{calls.push(['stop']);return {ok:true,act:'removed'}}}});
  await runtime.proxy.enable(7895,process.pid);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0][0],'start');
  assert.equal(calls[0][1].leasePath,join(dir,'config','system-proxy.json'));
  assert.equal(calls[0][1].ownerPid,process.pid);
  await runtime.proxy.restore(7895);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.at(-1),['stop']);
  await runtime.stop();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(call=>call[0]==='stop').length,2,'runtime.stop 也要把任务收掉');
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('看门狗还原失败留下键名/错误码日志，租约保留',async()=>{
 const {recover}=await import('./watchdog.mjs');
 const dir=await mkdtemp(join(process.env.FISH_TEST_TMP||tmpdir(),'clash-watchdog-log-'));
 const lease=join(dir,'system-proxy.json');
 await writeFile(lease,JSON.stringify({schema:1,
  previous:{ProxyEnable:0,ProxyServer:'',ProxyOverride:''},
  owned:{ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:''},owner:{pid:4242,at:1}}));
 const result=await recover({leasePath:lease,parentPid:4242,mihomoPid:0,
  read:async()=>({ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:''}),
  write:async()=>{const error=Error('拒绝访问');error.key='ProxyServer';error.win32=5;throw error}});
 assert.equal(result.act,'write-failed');
 assert.equal(result.key,'ProxyServer');
 assert.equal(result.win32,5);
 const log=await readFile(`${lease}.log`,'utf8');
 assert.match(log,/ProxyServer/);
 assert.match(log,/Win32 5/);
 assert.ok((await readFile(lease,'utf8')).length>0,'租约要留着下次再试');
});
