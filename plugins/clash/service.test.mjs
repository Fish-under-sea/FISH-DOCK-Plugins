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
function fixture(disk=new Map(),options={}) {
 const requests=[],updates=[],kills=[],swaps=[];let up=false,starts=0,stops=0,owned,fail=false,blocked=null,delayError=null,switchDown=false,startDown=false;
 // external 模拟「插件进程重启后仍有残留内核」：pid 还活着、控制器可应答，但不是本实例 spawn 的。
 const external=options.external?{alive:true,...options.external}:null;
 const controllerUp=options.controller!==false;
 // 夹具层的 options 在 request(path,options) 里会被参数遮蔽，先取出来再用。
 let externalDown=options.externalController===false;
 const kernelPid=options.pid??4242;
 const context={dataDirectory:'D:/synthetic/.fishplugin-clash',
  storage:{read:async(c,n)=>disk.get(`${c}/${n}`)??null,write:async(c,n,v)=>disk.set(`${c}/${n}`,v)},
  secrets:{read:async(c,n)=>disk.get(`secret/${c}/${n}`)??null,write:async(c,n,v)=>disk.set(`secret/${c}/${n}`,v)}};
 const subs=()=>owned?.subscriptions??external?.subscriptions??[];
 const request=async(path,options={})=>{
  requests.push({path,...options});
  // 目标内核不认 PUT /configs（老版本/被代理挡住）：热切换必须明确失败并回滚。
  if(switchDown&&path.startsWith('/configs?force=true'))throw Object.assign(Error('控制器拒绝热重载'),{code:'CONTROLLER_UNREACHABLE'});
  if(delayError&&path.includes('/delay?'))throw delayError;
  if(!controllerUp)throw Object.assign(Error('控制器不可达'),{code:'CONTROLLER_UNREACHABLE'});
  // 残留内核（不是本实例 spawn 的）控制器不通：用来证明 attach 失败后也不会盲杀 pid。
  if(!up&&externalDown)throw Object.assign(Error('控制器不可达'),{code:'CONTROLLER_UNREACHABLE'});
  if(!up&&!external?.alive)throw Error('offline');
  const names=subs().map(s=>`[${s.id}] same`);
  return path==='/version'?{version:'synthetic'}:path==='/proxies'?{proxies:{
   GLOBAL:{now:'🚀 节点选择',all:['🚀 节点选择','♻️ 自动选择','DIRECT',...names]},
   '🚀 节点选择':{now:'♻️ 自动选择',all:['♻️ 自动选择','DIRECT',...names]},
   '♻️ 自动选择':{now:names[0],all:names},
   'Ⓜ️ 微软服务':{now:'DIRECT',all:['DIRECT','🚀 节点选择']},
   DIRECT:{type:'Direct',now:'',all:null},
   ...Object.fromEntries(names.map(name=>[name,{history:[{delay:20}]}]))}}:
   path==='/configs'?{mode:'rule'}:path==='/connections'?{connections:[{id:'conn-1',
    metadata:{network:'tcp',host:'example.test',destinationIP:'203.0.113.9',destinationPort:'443',sourceIP:'127.0.0.1',processPath:'C:/private/PRIVATE.exe'},
    chains:['🚀 节点选择',`[${subs()[0]?.id}] same`],rule:'DomainSuffix',rulePayload:'test',
    upload:5,download:7,start:'2026-10-31T09:00:00.000Z',token:'PRIVATE'}],uploadTotal:10,downloadTotal:12,memory:1048576}:
   path==='/rules'?{rules:[{type:'MATCH',payload:'',proxy:'🐟 漏网之鱼'},{type:'GEOSITE',payload:'cn',proxy:'🎯 全球直连'},{type:'GEOIP',payload:'cn',proxy:'🎯 全球直连'}]}:
   path.includes('/delay?')?{delay:path.includes('youtube')?0:87}:{url:'https://private.test/?token=PRIVATE'};
 };
 const runtime={start:async c=>{if(startDown)throw Object.assign(Error('启动失败'),{code:'SPAWN_FAILED'});starts++;up=true;owned=c;return {alive:()=>up,pid:kernelPid,mode:'process',stop:async()=>{stops++;up=false}}},
  // 结束残留内核（不是本实例 spawn 的）：记录 pid，按 external 状态回报是否真的没了。
  kill:async pid=>{kills.push(pid);if(external&&external.pid===pid)external.alive=false;return true},
  updateSubscription:async c=>{updates.push(c);await blocked;if(c.signal.aborted||fail)throw Error('token=PRIVATE');await c.apply?.();await c.commit({nodeCount:2,userInfo:{upload:1,download:2,total:10,used:3,expire:1767225600}});return {nodeCount:2,userInfo:{upload:1,download:2,total:10,used:3,expire:1767225600}}},
  // 运行中热切换：service 只把「新启用集 + apply 回调」交出去；这里记录调用并真的走 apply，
  // 好让「PUT /configs?force=true 失败」这条路径也能被验证（配置文件的 rename 由 runtime 真实实现负责）。
  swapConfig:async({settings,subscriptions,secret,apply})=>{
   swaps.push({settings,secret,subscriptions:subscriptions.map(s=>[s.id,s.enabled])});
   await apply(`${context.dataDirectory}/tmp/mihomo-runtime.next.json`);
  },
  proxy:{enable:async()=>{},restore:async()=>{},active:()=>false},
  tun:{status:async()=>({installed:tunInstalled,state:tunInstalled?'running':'absent',kernel:tunKernel,log:''}),
   install:async({kernel})=>{tunInstalled=true;tunKernel=kernel},
   uninstall:async()=>{tunInstalled=false;return {installed:false}},
   enable:async()=>true,disable:async()=>true},
  tunStop:async()=>{},
  // #46：宿主的 storage 没有 delete，订阅地址/缓存由 runtime 自己删；夹具照做。
  removeSubscription:async id=>{disk.delete(`secret/credentials/${id}.yaml`);disk.delete(`secret/credentials/${id}.json`)},
  removeCredential:async name=>{disk.delete(`secret/credentials/${name}`)}};
 let tunInstalled=false,tunKernel='';
 const service=createClash({context,runtime,request,...options,pidAlive:pid=>{
  // 残留内核优先按 external 判活：它的 pid 可能与本实例的假 pid 同号。
  if(external&&external.pid===pid)return external.alive;
  return pid===kernelPid?up:false;
 },pidStartedAt:pid=>{
  // pid 复用的回归开关：externalStartedAt 与落盘记录不一致＝这个 pid 已经被系统复用给别的程序。
  if(options.externalStartedAt!==undefined)return options.externalStartedAt;
  // 默认认为残留内核就是记录里那个进程：启动时刻与 run-state 一致。
  try{
   const raw=disk.get('config/run-state.json');
   const record=raw?JSON.parse(raw):null;
   if(record&&Number.isFinite(record.startedAt))return record.startedAt;
  }catch{/* 坏记录按取不到处理 */}
  return null;
 }});
 return {service,disk,requests,updates,swaps,runtime,context,external,stats:()=>({starts,stops,up,owned,kills}),
  // 模拟「目标内核不认 PUT /configs」。
  refuseReload:(on=true)=>{switchDown=on},fail:()=>{fail=true},
  // 模拟「重启内核失败」（热切换失败后的兜底路径）。
  refuseStart:(on=true)=>{startDown=on},
  // 模拟「残留内核的控制器从不通恢复为可达」。
  setExternalController:on=>{externalDown=on===false},
  breakDelay:error=>{delayError=error},
  block:()=>{let release;blocked=new Promise(r=>release=r);return release}};
}
async function add(f,name='A',url='https://example.test/a?token=PRIVATE') {
 return (await f.service.subscriptionSave({name,url})).subscriptions.at(-1);
}
async function settled(service) {
 for(let i=0;i<200;i++){const state=await service.view({controller:false});if(!state.subscriptions.some(s=>s.updating))return state;await tick()}
 throw Error('jobs failed to finish');
}
test('multiple subscriptions keep independent IDs but only one runs at a time',async()=>{
 const f=fixture();await f.service.save(kernel);const a=await add(f),b=await add(f,'B','https://example.test/b');
 // 启用无缓存的订阅现在两条路径都拒绝（t5 F5），这里先把 A、B 的缓存都准备好，本用例只关心单选语义。
 await f.service.reload();await settled(f.service);
 await f.service.reload({id:b.id});await settled(f.service);
 assert.notEqual(a.id,b.id);
 assert.equal(a.enabled,true,'第一条默认启用');
 assert.equal(b.enabled,false,'之后再新增的默认停用');
 // 单选：启用 B 会把 A 关掉，存储里也只留一条启用。
 const switched=await f.service.subscriptionToggle({id:b.id,enabled:true});
 assert.deepEqual(switched.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,false],[b.id,true]]);
 assert.equal(JSON.parse(f.disk.get('config/subscriptions.json')).subscriptions.filter(s=>s.enabled).length,1);
 // 停用 B 之后一条也不启用。
 const off=await f.service.subscriptionToggle({id:b.id,enabled:false});
 assert.equal(off.subscriptions.some(s=>s.enabled),false);
 await f.service.subscriptionToggle({id:a.id,enabled:true});
 await f.service.subscriptionSave({id:a.id,name:'Renamed',url:''});
 await f.service.reload();await settled(f.service);await f.service.start();
 const state=await f.service.view();
 assert.equal(state.subscriptions.length,2);
 assert.deepEqual(f.stats().owned.subscriptions.map(s=>s.id),[a.id],'内核只吃启用那一条');
 // view 只暴露代理组（GLOBAL/DIRECT 不算组），主组节点含订阅来源前缀。
 assert.ok(state.groups.every(g=>g.name!=='GLOBAL'&&g.name!=='DIRECT'));
 const main=state.groups.find(g=>g.name==='🚀 节点选择');
 assert.ok(main);assert.equal(main.selected,'♻️ 自动选择');
 const sourceNodes=main.nodes.filter(n=>n.sourceId);
 assert.deepEqual(sourceNodes.map(n=>n.label),['same']);
 assert.deepEqual(sourceNodes.map(n=>n.source),['Renamed']);
 assert.ok(main.nodes.some(n=>n.name==='♻️ 自动选择'&&n.sourceId===null));
 // 自动选择组只含订阅节点。
 const auto=state.groups.find(g=>g.name==='♻️ 自动选择');
 assert.ok(auto.nodes.every(n=>n.sourceId));
 // 默认直连的分类组：DIRECT 排第一。
 const ms=state.groups.find(g=>g.name==='Ⓜ️ 微软服务');
 assert.equal(ms.nodes[0].label,'DIRECT');
 await f.service.select({group:'🚀 节点选择',name:sourceNodes[0].name});
 assert.ok(f.requests.some(r=>r.method==='PUT'&&r.body?.name===`[${a.id}] same`));
 assert.ok(!JSON.stringify(state).includes('PRIVATE'));assert.ok(!f.disk.get('config/subscriptions.json').includes('https:'));
 // 2.1.4：运行中改启用集不再抛 KERNEL_RUNNING_LOCK——B 已有缓存，这里直接走热重载。
 // 「无缓存时拒绝」的路径由「无缓存的订阅两条路径都不许启用（t5 F5）」那一条单独覆盖。
 const hot=await f.service.subscriptionToggle({id:b.id,enabled:true});
 assert.deepEqual(hot.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,false],[b.id,true]],'运行中切换生效');
 assert.ok(f.swaps.length>0,'走的是热重载路径，不是停内核');
 await f.service.stop();await f.service.subscriptionToggle({id:a.id,enabled:true});
 await f.service.start();assert.deepEqual(f.stats().owned.subscriptions.map(s=>s.id),[a.id]);
 await f.service.stop();await f.service.subscriptionRemove({id:a.id});
 assert.deepEqual((await f.service.view()).subscriptions.map(s=>s.id),[b.id]);
 assert.equal(f.disk.has(`secret/credentials/${a.id}.json`),false);
});
// ───────── 2.1.4 运行中热切换（§3.3）：不重启内核，失败全回滚 ─────────
async function twoCached(f){
 const a=await add(f),b=await add(f,'B','https://example.test/b');
 await f.service.reload();await settled(f.service);          // A 启用 → 拿到缓存
 await f.service.reload({id:b.id});await settled(f.service); // B 单独刷一次，也拿到缓存
 return {a,b};
}
test('运行中热切换订阅：生成候选配置 → PUT /configs?force=true，内核不重启',async()=>{
 const f=fixture();await f.service.save(kernel);
 const {a,b}=await twoCached(f);
 await f.service.start();
 const before=f.stats();
 const state=await f.service.subscriptionToggle({id:b.id,enabled:true});
 assert.deepEqual(state.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,false],[b.id,true]]);
 assert.equal(state.running,true);
 assert.equal(f.stats().starts,before.starts,'热切换不重新起内核');
 assert.equal(f.stats().stops,before.stops,'热切换不停内核');
 // 新启用集交给了配置生成（其余自动关掉），并且真的发了一条热重载指令。
 const swap=f.swaps.at(-1);
 assert.deepEqual(swap.subscriptions,[[a.id,false],[b.id,true]]);
 assert.equal(typeof swap.secret,'string');assert.ok(swap.secret,'带上控制器密钥');
 const put=f.requests.find(r=>r.method==='PUT'&&r.path==='/configs?force=true');
 assert.ok(put,'内核收到就地换配置的指令');
 assert.match(put.body.path,/mihomo-runtime\.next\.json$/,'先用候选文件，成功再转正');
 const rows=JSON.parse(f.disk.get('config/subscriptions.json')).subscriptions;
 assert.deepEqual(rows.filter(s=>s.enabled).map(s=>s.id),[b.id],'启用集落盘也是新的');
});
test('热切换失败时插件自己重启内核：启用集照常生效，不用用户手动重启',async()=>{
 const f=fixture();await f.service.save(kernel);
 const {a,b}=await twoCached(f);
 await f.service.start();
 const before=f.stats();
 // 目标内核不认 PUT /configs：2.1.8 起不再把「请重启内核」丢给用户，插件按新配置重启一次。
 f.refuseReload();
 const state=await f.service.subscriptionToggle({id:b.id,enabled:true});
 assert.deepEqual(state.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,false],[b.id,true]],'启用集生效');
 assert.equal(f.stats().stops,before.stops+1,'先停了旧内核');
 assert.equal(f.stats().starts,before.starts+1,'再按新配置起一次');
 assert.deepEqual(f.stats().owned.subscriptions.map(s=>s.id),[b.id],'新内核吃的是新启用集');
 assert.equal(state.running,true);
 const rows=JSON.parse(f.disk.get('config/subscriptions.json')).subscriptions;
 assert.deepEqual(rows.filter(s=>s.enabled).map(s=>s.id),[b.id],'磁盘上也是新的');
 // 热重载恢复后照旧走热路径，不再重启。
 f.refuseReload(false);
 const back=await f.service.subscriptionToggle({id:a.id,enabled:true});
 assert.deepEqual(back.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,true],[b.id,false]]);
 assert.equal(f.stats().starts,before.starts+1,'这次没再重启内核');
});
test('热切换与重启都失败：回滚启用集，抛 SUBSCRIPTION_SWITCH_FAILED',async()=>{
 const f=fixture();await f.service.save(kernel);
 const {a,b}=await twoCached(f);
 await f.service.start();
 f.refuseReload();
 f.refuseStart();
 await assert.rejects(f.service.subscriptionToggle({id:b.id,enabled:true}),error=>error.code==='SUBSCRIPTION_SWITCH_FAILED');
 const state=await f.service.view({controller:false});
 assert.deepEqual(state.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,true],[b.id,false]],'启用集回滚');
 const rows=JSON.parse(f.disk.get('config/subscriptions.json')).subscriptions;
 assert.deepEqual(rows.filter(s=>s.enabled).map(s=>s.id),[a.id],'磁盘也回滚');
 // 两次都失败后旧内核已经停了，界面必须如实说「没在跑」，不能还画成运行中。
 assert.equal(state.running,false,'内核确实没起来');
 // 回滚后再切一次（控制器与启动都恢复）必须成功：证明回滚没把内部状态弄脏。
 f.refuseReload(false);
 f.refuseStart(false);
 const retried=await f.service.subscriptionToggle({id:b.id,enabled:true});
 assert.deepEqual(retried.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,false],[b.id,true]]);
});
test('内核没跑时切启用集只落盘，不生成配置也不碰控制器',async()=>{
 const f=fixture();await f.service.save(kernel);
 const a=await add(f),b=await add(f,'B','https://example.test/b');
 // 先给 B 准备缓存（无缓存的订阅两条路径都拒绝，见下一条用例），本用例只关心"没跑内核只落盘"。
 await f.service.reload({id:b.id});await settled(f.service);
 const state=await f.service.subscriptionToggle({id:b.id,enabled:true});
 assert.deepEqual(state.subscriptions.map(s=>[s.id,s.enabled]),[[a.id,false],[b.id,true]]);
 assert.equal(f.swaps.length,0,'没跑内核就不生成新配置');
 assert.equal(f.requests.some(r=>r.path==='/configs?force=true'),false,'不碰控制器');
 assert.equal(JSON.parse(f.disk.get('config/subscriptions.json')).subscriptions.find(s=>s.enabled).id,b.id);
});
test('无缓存的订阅两条路径都不许启用（t5 F5）：没跑内核时也不落盘',async()=>{
 const f=fixture();await f.service.save(kernel);
 const a=await add(f),b=await add(f,'B','https://example.test/b');
 // 内核没跑：同样拒绝，且绝不落盘（否则下次 start 会带着空 provider 起来）。
 await assert.rejects(f.service.subscriptionToggle({id:b.id,enabled:true}),error=>error.code==='SUBSCRIPTION_NO_CACHE');
 assert.deepEqual(JSON.parse(f.disk.get('config/subscriptions.json')).subscriptions.map(s=>[s.id,s.enabled]),
  [[a.id,true],[b.id,false]],'被拒时磁盘上的启用集不变');
 // 跑起来以后同一条也拒绝（两条路径语义一致），并且不去写配置。
 await f.service.reload();await settled(f.service);await f.service.start();
 await assert.rejects(f.service.subscriptionToggle({id:b.id,enabled:true}),error=>error.code==='SUBSCRIPTION_NO_CACHE');
 assert.equal(f.swaps.length,0,'被拒时不写配置');
 assert.equal(f.stats().up,true,'内核照旧在原配置上跑');
});
test('订阅更新进行中不许切启用集：SUBSCRIPTION_UPDATING，且不动现有启用项',async()=>{
 const f=fixture();await f.service.save(kernel);
 const a=await add(f),b=await add(f,'B','https://example.test/b');
 const release=f.block();
 await f.service.reload({id:b.id});
 await assert.rejects(f.service.subscriptionToggle({id:a.id,enabled:false}),error=>error.code==='SUBSCRIPTION_UPDATING');
 release();await settled(f.service);
 assert.equal(JSON.parse(f.disk.get('config/subscriptions.json')).subscriptions.find(s=>s.enabled).id,a.id);
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
 assert.equal(after.subscriptions[0].nodeCount,2);assert.equal(after.subscriptions[1].status,'pending','没启用的订阅不参与刷新');
 assert.ok(after.subscriptions[0].lastSuccess>=before.subscriptions[0].lastSuccess);
 // 流量额度随更新落库并持久化：损坏结构不覆盖旧值。
 assert.deepEqual(after.subscriptions[0].userInfo,{upload:1,download:2,total:10,used:3,expire:1767225600});
 const restored=await fixture(f.disk).service.view();
 assert.deepEqual(restored.subscriptions[0].userInfo,{upload:1,download:2,total:10,used:3,expire:1767225600});
 f.runtime.updateSubscription=async c=>{await c.commit({nodeCount:2,userInfo:{upload:'broken'}});return {nodeCount:2}};
 await f.service.reload({id:a.id});const damaged=await settled(f.service);
 assert.deepEqual(damaged.subscriptions[0].userInfo,{upload:1,download:2,total:10,used:3,expire:1767225600});
 assert.ok(!JSON.stringify(after).includes('PRIVATE'));
 assert.ok(!JSON.stringify(await f.service.details({section:'providers'})).includes('PRIVATE'));
 // 规则详情要带 payload：只有类型和策略，页面看不出这条规则到底拦了什么。
 const rules=await f.service.details({section:'rules'});
 assert.equal(rules.count,3);
 assert.deepEqual(rules.rules[1],{type:'GEOSITE',payload:'cn',proxy:'🎯 全球直连'});
 // 连接详情要带列表：只给数量的话「连接」页永远是空的。
 const connections=await f.service.details({section:'connections'});
 assert.equal(connections.count,1);assert.equal(connections.uploadTotal,10);assert.equal(connections.downloadTotal,12);
 assert.equal(connections.connections[0].host,'example.test');
 assert.equal(connections.connections[0].destination,'203.0.113.9:443');
 assert.deepEqual(connections.connections[0].chains,['🚀 节点选择','same'],'链路里的订阅前缀要剥掉');
 assert.equal(connections.connections[0].rule,'DomainSuffix test');
 assert.equal(connections.connections[0].download,7);
 assert.ok(!JSON.stringify(connections).includes('PRIVATE'),'连接详情不透传原始字段与进程路径');
 await f.service.stop();
});
test('single subscription migration is idempotent and preserves legacy cache availability',async()=>{
 const disk=new Map([['secret/credentials/subscription.json','https://example.test/legacy?token=PRIVATE']]);
 const f=fixture(disk);f.runtime.migrateSubscription=async()=>true;
 const first=await f.service.view();
 assert.equal(first.subscriptions.length,1);assert.equal(first.subscriptions[0].hasCache,true);
 assert.equal(disk.has('secret/credentials/subscription.json'),false);
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
// #46：删订阅要连订阅地址一起删；以前写空串，每删一条留一个 0 字节残片。
test('删除订阅连订阅地址一起删，不留残片',async()=>{
 const f=fixture();const a=await add(f);
 assert.ok(f.disk.has(`secret/credentials/${a.id}.json`));
 await f.service.subscriptionRemove({id:a.id});
 assert.equal(f.disk.has(`secret/credentials/${a.id}.json`),false);
 assert.equal(f.disk.has(`secret/credentials/${a.id}.yaml`),false);
 assert.equal((await f.service.view()).subscriptions.length,0);
});
test('invalid URLs/ports are rejected; unsynced subscriptions block startup; interrupted jobs recover',async()=>{
 const f=fixture();await f.service.view();
 // 只拒真正的非法地址：非 http(s) 协议、带账号密码、空串。
 for(const url of ['file:///bad','ftp://example.test','https://user:pass@example.test',''])
  await assert.rejects(add(f,'A',url),error=>error.code==='SUBSCRIPTION_URL_INVALID');
 // http 与 #片段 必须接受：国内机场大量如此，拒绝会让用户永远导不进来。
 const httpRow=await f.service.subscriptionSave({name:'http ok',url:'http://example.test/sub?token=x'});
 assert.equal(httpRow.subscriptions.at(-1).name,'http ok');
 const fragRow=await f.service.subscriptionSave({name:'fragment ok',url:'https://example.test/sub?token=y#Clash'});
 assert.equal(fragRow.subscriptions.length,2);
 assert.equal(f.disk.get(`secret/credentials/${fragRow.subscriptions.at(-1).id}.json`),'https://example.test/sub?token=y');
 await assert.rejects(f.service.save({...kernel,mixedPort:9099}),error=>error.code==='PORT_CONFLICT');
 await assert.rejects(f.service.save({...kernel,mixedPort:80}),error=>error.code==='PORT_RANGE_INVALID');
 await f.service.save(kernel);
 await add(f,'third','https://example.test/three');
 await assert.rejects(f.service.start(),error=>error.code==='SUBSCRIPTION_NO_CACHE');
 const release=f.block();await f.service.reload();
 const restart=await fixture(f.disk).service.view();assert.equal(restart.subscriptions[0].status,'error');
 const stop=f.service.shutdown();await tick();release();await stop;
 assert.equal(f.updates[0].signal.aborted,true);assert.equal(f.stats().starts,0);
 await assert.rejects(f.service.start(),error=>error.code==='PLUGIN_STOPPING');
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
test('节点测速对当前组逐条打 delay 接口，按节点名回结果',async()=>{
 const f=fixture();await f.service.save(kernel);const a=await add(f);
 await f.service.reload();await settled(f.service);await f.service.start();
 const result=await f.service.nodeTest({group:'🚀 节点选择'});
 assert.equal(result.group,'🚀 节点选择');
 assert.equal(result.tested,result.delays.length);
 assert.ok(result.tested>0);
 const leaf=result.delays.find(row=>row.name===`[${a.id}] same`);
 assert.ok(leaf,'订阅节点要参与测速');
 assert.equal(leaf.delay,87);
 assert.ok(result.delays.every(row=>typeof row.name==='string'),'每条都带节点名');
 assert.ok(f.requests.some(row=>/\/proxies\/.*\/delay\?url=/.test(row.path)),'走控制器的 delay 接口');
 await f.service.stop();
 await assert.rejects(f.service.nodeTest({group:'🚀 节点选择'}),error=>error.code==='KERNEL_NOT_RUNNING');
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
 await assert.rejects(f.service.installTunService(),error=>error.code==='KERNEL_RUNNING_LOCK');
});
test('解密后的旧凭据内容格式无效时保留原值，view 与新增订阅仍可用',async()=>{
 // 覆盖真正的损坏内容；此替身不代表宿主 DPAPI 解密行为。
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


test('概览数据：规则数量与运行时间只在内核运行时可读',async()=>{
 const f=fixture();
 const idle=await f.service.view({controller:false});
 assert.equal(idle.rulesCount,null);assert.equal(idle.uptimeMs,null);
 await f.service.save(kernel);await f.service.start();
 const live=await f.service.view();
 assert.equal(live.rulesCount,3);
 assert.ok(Number.isFinite(live.uptimeMs)&&live.uptimeMs>=0);
 assert.ok(typeof live.os==='string'&&live.os.length>0);
 await f.service.stop();
 assert.equal((await f.service.view({controller:false})).uptimeMs,null);
});
test('出口 IP 只在经代理时查询，字段归一化并缓存一分钟',async()=>{
 const f=fixture();
 assert.equal((await f.service.ipInfo()).available,false);
 await f.service.save(kernel);await f.service.start();
 const seen=[];let reply={status:'success',country:'日本',countryCode:'JP',as:'AS2516  KDDI',isp:'KDDI',org:'KDDI Corporation',regionName:'东京',city:'千代田',timezone:'Asia/Tokyo',query:'203.0.113.7'};
 f.runtime.proxiedGet=async(url,options)=>{seen.push({url,options});return reply};
 const first=await f.service.ipInfo();
 assert.equal(first.available,true);assert.equal(first.ip,'203.0.113.7');assert.equal(first.asn,'AS2516');
 assert.equal(first.location,'日本 · 东京 · 千代田');assert.equal(first.source,'ip-api');
 // 必须经用户自己的混合代理口，而不是直连。
 assert.equal(seen[0].url,'http://ip-api.com/json/?lang=zh-CN&fields=status,country,countryCode,regionName,city,isp,org,as,timezone,query');
 assert.equal(seen[0].options.port,7895);
 // 缓存命中：再次读取不再发请求。
 await f.service.ipInfo();
 assert.equal(seen.length,1);
 // 刷新失败时降级为不可用，不抛出、不残留旧值。
 f.runtime.proxiedGet=async()=>{throw Error('offline')};
 const failed=await f.service.ipInfo({refresh:true});
 assert.equal(failed.available,false);assert.ok(failed.reason);
});
test('网站测试经当前叶子节点测速，超时与无延迟都归零',async()=>{
 const f=fixture();await f.service.save(kernel);
 await assert.rejects(f.service.siteTest(),error=>error.code==='KERNEL_NOT_RUNNING');
 const a=await add(f);await f.service.reload();await settled(f.service);await f.service.start();
 const result=await f.service.siteTest();
 assert.equal(result.node,`[${a.id}] same`);
 assert.deepEqual(result.sites.map(site=>site.label),['Apple','GitHub','Google','YouTube']);
 assert.deepEqual(result.sites.map(site=>site.ok),[true,true,true,false]);
 assert.equal(result.sites[0].delay,87);
 assert.equal(result.sites[3].delay,null);
 assert.match(f.requests.at(-1).path,/\/proxies\/.*\/delay\?url=/);
});

// 现象 C/E 的根因：「内核在不在跑」只由内存变量决定，插件进程一重启 running 归零，
// 而 mihomo 子进程还在跑 → 界面「内核已停止」+ 代理有效。运行态必须落盘并可 attach。
test('插件重载后按 run-state 记录 attach 成 running，不再起第二个内核',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const record=JSON.parse(f.disk.get('config/run-state.json'));
 assert.equal(record.schema,1);
 assert.equal(record.pid,4242);
 assert.equal(record.mode,'process');
 assert.equal(record.mixedPort,7895);
 assert.equal(record.controllerPort,9099);
 assert.ok(Number.isFinite(record.startedAt)&&record.startedAt>0,'启动时间要落盘，页面才能显示运行时长');
 assert.ok(Array.isArray(record.subscriptions));
 assert.match(record.secretFingerprint,/^[a-f0-9]{16}$/,'只落 secret 指纹，不落 secret 本身');
 assert.ok(!JSON.stringify(record).includes(f.disk.get('secret/keys/controller.key')),'记录里不得出现明文密钥');
 // 插件进程重启：同一个数据目录、新的 service 实例，内核仍在跑。
 const g=fixture(f.disk,{external:{pid:record.pid,subscriptions:record.subscriptions}});
 const state=await g.service.view();
 assert.equal(state.running,true);
 assert.equal(state.attached,true);
 assert.equal(state.kernelPid,record.pid);
 assert.ok(Number.isFinite(state.uptimeMs)&&state.uptimeMs>=0,'attach 后运行时长按记录里的 startedAt 算');
 assert.equal(g.stats().starts,0,'已经 attach，不得起第二个内核');
 await g.service.start();
 assert.equal(g.stats().starts,0,'再点启动也只认已存在的内核');
 assert.equal((await g.service.view()).running,true);
 // 停止必须真的杀掉那个不属于本实例的内核，并清掉运行态记录。
 const stopped=await g.service.stop();
 assert.deepEqual(g.stats().kills,[record.pid]);
 assert.deepEqual({kernel:stopped.stop.kernel,proxy:stopped.stop.proxy},{kernel:'stopped',proxy:'restored'});
 assert.equal(g.disk.get('config/run-state.json'),'');
 assert.equal((await g.service.view()).running,false);
});
test('run-state 里的 pid 已不存在时静默丢弃记录，不误报内核在跑',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const g=fixture(f.disk,{external:{pid:9999}});
 const state=await g.service.view();
 assert.equal(state.running,false);
 assert.equal(state.attachError,null,'内核正常退出后的残留记录不是错误');
 assert.equal(g.disk.get('config/run-state.json'),'','过期记录要清掉，避免每次都读');
});
test('run-state 的 secret 指纹对不上时丢弃记录并报 KERNEL_ATTACH_FAILED',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const record=JSON.parse(f.disk.get('config/run-state.json'));
 const g=fixture(f.disk,{external:{pid:record.pid}});
 g.disk.set('config/run-state.json',JSON.stringify({...record,secretFingerprint:'0'.repeat(16)}));
 const state=await g.service.view();
 assert.equal(state.running,false);
 assert.equal(state.attachError.code,'KERNEL_ATTACH_FAILED');
 assert.equal(state.errorCode,'KERNEL_ATTACH_FAILED');
 assert.equal(g.disk.get('config/run-state.json'),'');
});
test('残留内核在跑但控制器不可达：不谎报运行中，停止仍按 pid 杀干净',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const record=JSON.parse(f.disk.get('config/run-state.json'));
 const g=fixture(f.disk,{external:{pid:record.pid},controller:false,attachCooldownMs:0});
 const state=await g.service.view();
 assert.equal(state.running,false,'控制器没应答就不能当成运行中');
 assert.equal(state.attachError.code,'KERNEL_ATTACH_FAILED');
 assert.equal(state.attachError.cause,'CONTROLLER_UNREACHABLE');
 const stopped=await g.service.stop();
 assert.deepEqual(g.stats().kills,[record.pid],'停止必须按落盘 pid 结束残留内核');
 assert.equal(stopped.stop.kernel,'stopped');
});
// 复审 t7 F2：pid 被系统复用给外部进程（记录还在、控制器不通）时，用户点「停止」不能盲杀。
// 第二道防线是「pid 的实际启动时刻」与 run-state 记录比对（宿主 plugin_runtime.rs 同口径 ±5s）。
test('pid 被复用给外部进程时，点停止不杀它',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const record=JSON.parse(f.disk.get('config/run-state.json'));
 const g=fixture(f.disk,{external:{pid:record.pid},controller:false,attachCooldownMs:0,
  externalStartedAt:record.startedAt+600000});
 const stopped=await g.service.stop();
 assert.deepEqual(g.stats().kills,[],'启动时刻对不上＝不是我们的内核，绝不能发信号');
 assert.equal(stopped.stop.kernel,'absent','没杀就别谎报 stopped');
 assert.equal((await g.service.view()).running,false);
});
// 复审 t7 F1：再次启动前的残留回收同样不能盲杀；确认不是我们的内核后才起新内核。
test('残留回收遇到被复用的 pid：不杀外部进程，照常起自己的内核',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const record=JSON.parse(f.disk.get('config/run-state.json'));
 const g=fixture(f.disk,{external:{pid:record.pid},externalController:false,attachCooldownMs:0,
  externalStartedAt:record.startedAt-600000});
 const state=await g.service.start();
 assert.deepEqual(g.stats().kills,[],'回收路径也不得对外部进程发信号');
 assert.equal(g.stats().starts,1,'确认不是残留内核之后才拉起新内核');
 assert.equal(state.running,true);
});
// 复审 t19 #2：stop() 在 attach 冷却窗口内走到 record 分支时，必须先接管成句柄再停（不盲杀）。
test('停止时 attach 还在冷却：先接管再停，仍按句柄结束内核',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const record=JSON.parse(f.disk.get('config/run-state.json'));
 // 先让一次 view() 的 attach 失败（控制器不通），进入冷却窗口。
 const g=fixture(f.disk,{external:{pid:record.pid},externalController:false,attachCooldownMs:5000});
 const first=await g.service.view();
 assert.equal(first.running,false,'冷却期间不能谎报运行中');
 // 控制器恢复可达，但冷却还没到：stop 必须重新接管成句柄，再走正常停止路径。
 g.setExternalController(true);
 const stopped=await g.service.stop();
 assert.deepEqual(g.stats().kills,[record.pid],'接管成句柄后才结束它');
 assert.equal(stopped.stop.kernel,'stopped');
 assert.equal(g.disk.get('config/run-state.json'),'','停完记录要清掉');
});
// 复审 t19 #3：取不到进程启动时刻时保守不杀，但页面要能说明「无法确认残留内核」。
test('取不到启动时刻时不杀残留进程，并把原因交给页面显示',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const record=JSON.parse(f.disk.get('config/run-state.json'));
 const g=fixture(f.disk,{external:{pid:record.pid},controller:false,attachCooldownMs:0,externalStartedAt:null});
 const stopped=await g.service.stop();
 assert.deepEqual(g.stats().kills,[],'取不到启动时刻就不发信号');
 assert.equal(stopped.stop.kernel,'absent');
 assert.equal(stopped.attachError.code,'KERNEL_ATTACH_FAILED');
 assert.match(stopped.error,/无法确认残留内核/,'页面要能看到原因，而不是显示成已停止');
});
// 现象 B：系统代理恢复失败不该让整次停止失败，更不该拦住杀内核。
test('系统代理恢复记录无效只降级为警告，内核照样停干净',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 f.runtime.proxy.restore=async()=>{const error=Error('系统代理恢复记录无效');error.code='PROXY_RESTORE_RECORD_INVALID';throw error};
 const state=await f.service.stop();
 assert.equal(f.stats().up,false);assert.equal(f.stats().stops,1);
 assert.deepEqual({kernel:state.stop.kernel,proxy:state.stop.proxy,code:state.stop.code},
  {kernel:'stopped',proxy:'failed',code:'PROXY_RESTORE_RECORD_INVALID'});
 assert.match(state.error,/内核已停止/);
 assert.match(state.error,/PROXY_RESTORE_RECORD_INVALID/);
 assert.equal(state.running,false);
});
test('注册表读写失败带代码同样只降级：内核已停止 + 系统代理恢复失败（原因码）',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 // #44：适配层把被拒的键名与 Win32 码挂在错误上，停止结果里要能看到。
 f.runtime.proxy.restore=async()=>{const error=Error('恢复系统代理失败');error.code='PROXY_REGISTRY_WRITE_FAILED';error.key='ProxyServer';error.win32=5;throw error};
 const state=await f.service.stop();
 assert.equal(f.stats().up,false);
 assert.equal(state.stop.proxy,'failed');
 assert.equal(state.stop.code,'PROXY_REGISTRY_WRITE_FAILED');
 assert.match(state.error,/PROXY_REGISTRY_WRITE_FAILED/);
 assert.match(state.error,/写入 ProxyServer 失败/);
 assert.match(state.error,/Win32 5/);
});
// 现象 D：换节点后 IP 信息仍是旧节点的出口。
test('换节点后服务端清空出口 IP 缓存，不再返回旧节点出口',async()=>{
 const f=fixture();await f.service.save(kernel);const a=await add(f);
 await f.service.reload();await settled(f.service);await f.service.start();
 let calls=0;
 f.runtime.proxiedGet=async()=>{calls++;return {status:'success',country:'日本',countryCode:'JP',as:'AS2516  KDDI',
  isp:'KDDI',org:'KDDI Corporation',regionName:'东京',city:'千代田',timezone:'Asia/Tokyo',query:`203.0.113.${calls}`}};
 assert.equal((await f.service.ipInfo()).ip,'203.0.113.1');
 assert.equal((await f.service.ipInfo()).ip,'203.0.113.1');
 assert.equal(calls,1,'60 秒内命中缓存');
 const main=(await f.service.view()).groups.find(g=>g.name==='🚀 节点选择');
 const target=main.nodes.find(node=>node.sourceId);
 await f.service.select({group:'🚀 节点选择',name:target.name});
 assert.equal((await f.service.ipInfo()).ip,'203.0.113.2','换节点后必须重新查询，不能返回旧出口');
 assert.equal(calls,2);
 await f.service.stop();
});
test('网站测试区分「节点不通」与「控制器超时」',async()=>{
 const f=fixture();await f.service.save(kernel);await add(f);
 await f.service.reload();await settled(f.service);await f.service.start();
 f.breakDelay(Object.assign(Error('mihomo 控制器请求超时'),{code:'CONTROLLER_TIMEOUT'}));
 const timedOut=await f.service.siteTest();
 assert.ok(timedOut.sites.every(site=>site.kind==='controller'&&site.code==='CONTROLLER_TIMEOUT'));
 assert.ok(timedOut.sites.every(site=>site.ok===false&&site.delay===null));
 assert.match(timedOut.sites[0].reason,/控制器超时/);
 f.breakDelay(Error('节点不通'));
 const refused=await f.service.siteTest();
 assert.ok(refused.sites.every(site=>site.kind==='node'&&site.code===null),'自造错误码不进统一映射');
 assert.match(refused.sites[0].reason,/节点不通/);
 await f.service.stop();
});

// TUN 由 SYSTEM 服务托管、普通模式由本进程 spawn，两者抢同一个控制器端口：切 TUN
// 必须重启内核，否则就是「只有一个能用」。
async function settledTun(service){
 for(let i=0;i<200;i++){const state=await service.view({controller:false});if(!state.tunSwitching)return state;await tick()}
 throw Error('tun switch did not finish');
}
test('运行中切 TUN：先停内核、写配置、再按新设置起来',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 await f.runtime.tun.install({kernel:kernel.kernel});
 const before=f.stats();
 await f.service.tunSwitch({enable:true});
 const state=await settledTun(f.service);
 const after=f.stats();
 assert.ok(after.stops>=before.stops+1,'切 TUN 前要把普通内核停掉');
 assert.ok(after.starts>=before.starts+1,'切完要按新设置把内核拉起来');
 assert.equal(state.tun.enable,true);
 assert.equal(state.tunSwitching,false);
 assert.equal(state.error,'');
 // 配置真的落盘了，不是只改了内存。
 assert.equal(JSON.parse(f.disk.get('config/clash.json')).tun.enable,true);
});
test('内核本来停着时切 TUN 只写配置，不顺手拉起内核',async()=>{
 const f=fixture();await f.service.save(kernel);
 await f.runtime.tun.install({kernel:kernel.kernel});
 const before=f.stats();
 await f.service.tunSwitch({enable:true});
 const state=await settledTun(f.service);
 assert.equal(f.stats().starts,before.starts,'本来没跑就不该起');
 assert.equal(state.running,false);
 assert.equal(state.tun.enable,true);
});
test('TUN 服务没装时拒绝切换，且不动正在跑的内核',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 const before=f.stats();
 await assert.rejects(f.service.tunSwitch({enable:true}),error=>error.code==='TUN_NOT_INSTALLED');
 assert.equal(f.stats().stops,before.stops,'拒绝时不该停内核');
 assert.equal(f.stats().up,true);
 assert.equal((await f.service.view({controller:false})).tun.enable,false);
});
// 系统信息卡过去只有「操作系统 / 运行模式 / 页面版本」三行，用户看到的就是「读取不完整」。
test('系统信息补齐架构、处理器、内存与插件版本',async()=>{
 const f=fixture();
 const state=await f.service.view({controller:false});
 assert.ok(typeof state.os==='string'&&state.os.length>0);
 assert.ok(typeof state.arch==='string'&&state.arch.length>0,'架构');
 assert.ok(typeof state.cpu==='string'&&state.cpu.length>0,'处理器');
 assert.ok(Number.isFinite(state.memoryTotal)&&state.memoryTotal>0,'内存总量');
 assert.equal(state.pluginVersion,'','未注入时留空由页面兜底');
 const stamped=fixture(new Map(),{pluginVersion:'2.0.3'});
 assert.equal((await stamped.service.view({controller:false})).pluginVersion,'2.0.3');
});
// 「当前运行时不支持查询出口 IP」只该在能力真的缺失时出现；代理本身不通要说代理不通。
test('出口 IP：运行时缺能力才报不支持，代理不通报查询失败',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 f.runtime.proxiedGet=undefined;
 const missing=await f.service.ipInfo({refresh:true});
 assert.equal(missing.available,false);assert.match(missing.reason,/不支持/);
 f.runtime.proxiedGet=async()=>{throw Error('offline')};
 const broken=await f.service.ipInfo({refresh:true});
 assert.equal(broken.available,false);assert.match(broken.reason,/无响应/);
 await f.service.stop();
});


// t14：校验错误统一挂码，文案由 shared/errors.mjs 按 code 查表（本分支码表未合入时 message 为回退文案，
// 断言一律按 code；高频码 KERNEL_NOT_RUNNING / KERNEL_RUNNING_LOCK / PORT_RANGE_INVALID /
// SUBSCRIPTION_URL_INVALID / NODE_UNAVAILABLE 分别在各自场景测试里覆盖）。
test('校验错误统一挂码：无节点、组失效、未启动路径都带 code',async()=>{
 const f=fixture();await f.service.save(kernel);await f.service.start();
 // 无订阅时叶子节点不存在：NODE_UNAVAILABLE。
 await assert.rejects(f.service.siteTest(),error=>error.code==='NODE_UNAVAILABLE');
 // 节点不在组里：NODE_STALE。
 await assert.rejects(f.service.select({group:'🚀 节点选择',name:'[sub-00000000-0000-0000-0000-000000000001] ghost'}),error=>error.code==='NODE_STALE');
 // 内核在跑但模式值非法：KERNEL_STATE_INVALID（与「没启动」是两种用户动作，不能合并）。
 await assert.rejects(f.service.mode({mode:'sideways'}),error=>error.code==='KERNEL_STATE_INVALID');
 await f.service.stop();
 // 停止后：KERNEL_NOT_RUNNING。
 await assert.rejects(f.service.details({section:'rules'}),error=>error.code==='KERNEL_NOT_RUNNING');
 await assert.rejects(f.service.select({group:'🚀 节点选择',name:'x'}),error=>error.code==='KERNEL_NOT_RUNNING');
 await assert.rejects(f.service.mode({mode:'rule'}),error=>error.code==='KERNEL_NOT_RUNNING');
 await assert.rejects(f.service.mode({mode:'sideways'}),error=>error.code==='KERNEL_NOT_RUNNING');
});





