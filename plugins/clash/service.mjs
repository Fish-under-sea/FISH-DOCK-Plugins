import {randomBytes, randomUUID} from 'node:crypto';
import os from 'node:os';
import {publicUpdateError,updateMessages} from './subscriptions.mjs';

const defaults={kernel:'',mixedPort:7895,controllerPort:9099,layout:'single'};
const tunStacks=['mixed','gvisor','system'];
const defaultTun={enable:false,stack:'mixed'};
// 网站测试与 IP 查询的目标：全部经当前选中节点发起，避免「直连测自己」。
const siteTargets=Object.freeze([
 {key:'apple',label:'Apple',url:'https://www.apple.com/library/test/success.html'},
 {key:'github',label:'GitHub',url:'https://github.com/favicon.ico'},
 {key:'google',label:'Google',url:'https://www.google.com/generate_204'},
 {key:'youtube',label:'YouTube',url:'https://www.youtube.com/favicon.ico'}
]);
// 出口 IP：优先明文接口（可经 HTTP 代理，字段最全），失败再试 HTTPS。
const ipSources=Object.freeze([
 {label:'ip-api',url:'http://ip-api.com/json/?lang=zh-CN&fields=status,country,countryCode,regionName,city,isp,org,as,timezone,query',
  parse:json=>json?.status!=='success'?null:{ip:json.query,country:json.country,countryCode:json.countryCode,
   asn:String(json.as??'').split(/\s+/)[0]??'',isp:json.isp??'',org:json.org??'',
   location:[json.country,json.regionName,json.city].filter(Boolean).join(' · '),timezone:json.timezone??''}},
 {label:'ip.sb',url:'https://api.ip.sb/geoip',
  parse:json=>!json?.ip?null:{ip:json.ip,country:json.country??'',countryCode:json.country_code??'',
   asn:json.asn?`AS${json.asn}`:'',isp:json.isp??'',org:json.organization??'',
   location:[json.country,json.region,json.city].filter(Boolean).join(' · '),timezone:json.timezone??''}}
]);
const validId=id=>/^sub-[a-f0-9-]{36}$/.test(id);
function urlValue(value) {
  let url;try{url=new URL(String(value).trim())}catch{throw Error('订阅地址无效，请粘贴完整的 http:// 或 https:// 链接')}
  if(url.protocol!=='http:'&&url.protocol!=='https:')
    throw Error('订阅地址必须以 http:// 或 https:// 开头');
  if(url.username||url.password)throw Error('订阅地址不要包含用户名和密码');
  if(url.href.length>8192)throw Error('订阅地址过长');
  // 片段（#名称）是订阅备注，不是地址的一部分；机场常带，直接剥掉而不是拒绝。
  url.hash='';
  return url.href;
}
function labelValue(value) {
  const name=String(value??'').trim();
  if(!name||name.length>80||/[\x00-\x1f\x7f]/.test(name)||/https?:\/\/|token\s*=/i.test(name))
    throw Error('请输入 1–80 字的订阅名称，不要包含地址或凭据');
  return name;
}
// 连接详情最多回这么多条：控制器返回的是全量连接，几千条一层层过协议会把页面卡住。
const CONNECTION_LIMIT=200;
// 规则一般几百条，上限只是防止异常内核把页面撑爆。
const RULE_LIMIT=2000;
// 订阅节点的名字带 `[sub-…] ` 前缀，只用于内核内部区分来源，展示时剥掉。
const stripPrefix=name=>String(name??'').replace(/^\[sub-[a-f0-9-]{36}\] /,'');
function cpuLabel() {
  const list=os.cpus();
  const model=String(list[0]?.model??'').trim().replace(/\s+/g,' ');
  return model?`${model} · ${list.length} 核`:`${list.length} 核`;
}
export function createClash({context,runtime,request:injectedRequest,fetch:fetcher=globalThis.fetch,defaultKernel='',pluginVersion=''}) {
  let running=null,settings,loading,subscriptions=[],secret='',operation=null,closing=false,operationError='';
  let startedAt=0,ipCache=null;
  // secrets.read 由宿主先解密；这里只标记解密后内容仍不符合订阅地址格式的情况。
  let legacyPending=false;
  let queue=Promise.resolve();
  // 切 TUN 要重启内核，耗时可能超过一次 RPC 的超时，所以它跑在后台：RPC 立刻返回，
  // 前端靠轮询 tunSwitching 看进度。这个标记不进 operation，免得和启动/停止互相覆盖。
  let tunBusy=false;
  const jobs=new Map(),alive=()=>!!running&&running.alive();
  const exclusive=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result};
  async function persist(rows) {
    await context.storage.write('config','subscriptions.json',JSON.stringify({schema:2,subscriptions:rows}));
    subscriptions=rows;
  }
  async function config() {
    if(!loading)loading=(async()=>{
      const saved=JSON.parse(await context.storage.read('config','clash.json')||'{}');
      const legacy=/\/packages\/fish\.clash\/\d+\.\d+\.\d+\/[a-f0-9]{64}\/service\/mihomo\.exe$/i;
      const bundled=saved.bundled===true||legacy.test(String(saved.kernel).replaceAll('\\','/'));
      settings={kernel:saved.kernel??defaultKernel,mixedPort:saved.mixedPort??defaults.mixedPort,
        controllerPort:saved.controllerPort??defaults.controllerPort,layout:saved.layout??defaults.layout,bundled,
        tun:{enable:saved.tun?.enable===true,stack:tunStacks.includes(saved.tun?.stack)?saved.tun.stack:defaultTun.stack}};
      if(bundled)settings.kernel=defaultKernel;
      const raw=await context.storage.read('config','subscriptions.json');
      if(raw) {
        const data=JSON.parse(raw);
        if(data.schema!==2||!Array.isArray(data.subscriptions)||data.subscriptions.length>32||
          data.subscriptions.some(s=>!validId(s.id))||new Set(data.subscriptions.map(s=>s.id)).size!==data.subscriptions.length)
          throw Error('订阅配置损坏，请从备份恢复');
        subscriptions=data.subscriptions.map(s=>({
          id:s.id,name:labelValue(s.name),enabled:s.enabled===true,
          status:s.status==='updating'?'error':(['ready','error'].includes(s.status)?s.status:'pending'),
          lastAttempt:s.lastAttempt??null,lastSuccess:s.lastSuccess??null,
          nodeCount:Number.isInteger(s.nodeCount)?s.nodeCount:0,hasCache:s.hasCache===true,
          // 流量额度只接受服务端解析过的数字结构；损坏值一律丢弃。
          userInfo:s.userInfo&&Number.isFinite(s.userInfo.total)&&Number.isFinite(s.userInfo.used)&&s.userInfo.used<=s.userInfo.total?
            {upload:Number.isFinite(s.userInfo.upload)?s.userInfo.upload:null,
             download:Number.isFinite(s.userInfo.download)?s.userInfo.download:null,
             total:s.userInfo.total,used:s.userInfo.used,
             expire:Number.isFinite(s.userInfo.expire)&&s.userInfo.expire>0?s.userInfo.expire:null}:null,
          errorCode:s.status==='updating'?'CANCELLED':Object.hasOwn(updateMessages,s.errorCode)?s.errorCode:null,
          error:s.status==='updating'?'上次更新被中断，旧缓存仍保留':s.status==='error'?(updateMessages[s.errorCode]??updateMessages.UNKNOWN):''
        }));
      } else {
        // 宿主已解密旧版单订阅凭据；格式正常就迁移，格式无效则提示并保留原值。
        const old=await context.secrets.read('credentials','subscription.json');
        if(old) {
          let migrated=null;
          try{migrated=urlValue(old)}catch{}
          if(migrated) {
            const id=`sub-${randomUUID()}`;
            await context.secrets.write('credentials',`${id}.json`,migrated);
            const hasCache=await runtime.migrateSubscription?.(id)??false;
            // Commit the stable identity before clearing legacy credentials; retries cannot duplicate it.
            await persist([{id,name:'原有订阅',enabled:true,status:hasCache?'ready':'pending',lastAttempt:null,lastSuccess:null,nodeCount:0,hasCache,error:''}]);
            await context.secrets.write('credentials','subscription.json','');
            legacyPending=false;
          } else {
            legacyPending=true;
          }
        }
      }
    })().catch(error=>{loading=null;throw error});
    await loading;return settings;
  }
  async function request(path,{method='GET',body,limit=2*1024*1024}={}) {
    if(injectedRequest)return injectedRequest(path,{method,...(body===undefined?{}:{body})});
    const c=await config(),response=await fetcher(`http://127.0.0.1:${c.controllerPort}${path}`,{
      method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3500),redirect:'error'});
    if(!response.ok)throw Error('mihomo 控制器请求失败');
    if(response.status===204)return {};
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;
      if((size+=value.byteLength)>limit)throw Error('mihomo 响应超过限制');chunks.push(value)}}
    finally{await reader.cancel().catch(()=>{})}
    return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
  }
  function sourceNode(name,proxies={}) {
    const source=subscriptions.find(s=>name.startsWith(`[${s.id}] `));
    const info=proxies[name];
    // 组成员既可能是订阅节点，也可能是另一个组或内置出站（DIRECT/REJECT 等）。
    const type=Array.isArray(info?.all)?'group':info?.type??null;
    return {name,label:source?name.slice(source.id.length+3):name,sourceId:source?.id??null,
      source:source?.name??null,type,
      delay:info?.history?.at(-1)?.delay??null};
  }
  // 内核聚合出的 GLOBAL 组与内置出站不算业务代理组，页面不展示。
  function isProxyGroup(name,proxy) {
    return name!=='GLOBAL'&&Array.isArray(proxy?.all);
  }
  async function view({controller=true}={}) {
    const c=await config(),state={...c,configured:!!c.kernel,subscriptionConfigured:subscriptions.length>0,
      legacyPending,
      subscriptions:subscriptions.map(s=>({...s,updating:jobs.has(s.id)})),
      running:alive(),operation:operation?.name??null,tunSwitching:tunBusy,error:operationError,systemProxy:runtime.proxy.active?.()??false,
      os:`${os.platform()==='win32'?'Windows':os.platform()} ${os.release()}`,
      arch:os.arch(),cpu:cpuLabel(),memoryTotal:os.totalmem(),pluginVersion,
      uptimeMs:alive()&&startedAt?Date.now()-startedAt:null,
      rulesCount:null,groups:[],mode:'rule'};
    if(controller&&state.running)try{
      // /rules 只用于概览卡片的规则数量；拿不到不影响主视图。
      const [version,proxies,status,rules]=await Promise.all([
        request('/version'),request('/proxies'),request('/configs'),request('/rules').catch(()=>null)]);
      state.version=version.version;state.mode=status.mode;
      state.rulesCount=Array.isArray(rules?.rules)?rules.rules.length:null;
      state.groups=Object.entries(proxies.proxies||{}).filter(([name,p])=>isProxyGroup(name,p)).map(([name,p])=>({
        name,selected:p.now,nodes:p.all.map(name=>sourceNode(name,proxies.proxies))}));
    }catch{state.error='控制器暂未响应，请刷新或停止内核'}
    if(runtime.tun)try{state.tunService=await runtime.tun.status()}catch{state.tunService=null}
    return state;
  }
  function editable() {
    if(alive()||operation)throw Error('请先停止内核再更改配置');
    if(jobs.size)throw Error('请等待订阅更新完成');
    if(closing)throw Error('插件正在停用');
  }
  function rowFor(id) {
    const row=subscriptions.find(s=>s.id===id);if(!row)throw Error('订阅不存在，请刷新');return row;
  }
  async function save(params) {
    return exclusive(async()=>{
      const old=await config();editable();
      const next={...old,kernel:String(params.kernel??old.kernel).trim(),
        mixedPort:params.mixedPort??old.mixedPort,controllerPort:params.controllerPort??old.controllerPort};
      if(!next.kernel||next.kernel.length>2048||/[\r\n\0]/.test(next.kernel))throw Error('请选择 mihomo 内核');
      for(const port of [next.mixedPort,next.controllerPort])
        if(!Number.isInteger(port)||port<1024||port>65535)throw Error('端口应为 1024–65535');
      if(next.mixedPort===next.controllerPort)throw Error('混合代理和控制器端口应不同');
      if(params.subscription||params.clearSubscription)throw Error('请在订阅管理中新增或删除订阅');
      if(params.tun!==undefined){
        const tun=params.tun||{};
        if(typeof tun.enable!=='boolean'&&tun.enable!==undefined)throw Error('TUN 开关无效');
        next.tun={enable:tun.enable===true, stack:tunStacks.includes(tun.stack)?tun.stack:(old.tun?.stack??defaultTun.stack)};
        if(next.tun.enable&&!runtime.tun)throw Error('当前环境不支持 TUN 服务模式');
      }
      next.bundled=!!defaultKernel&&next.kernel.replaceAll('\\','/').toLowerCase()===defaultKernel.replaceAll('\\','/').toLowerCase();
      await context.storage.write('config','clash.json',JSON.stringify(next));settings=next;
      return view({controller:false});
    });
  }
  async function subscriptionSave(params) {
    return exclusive(async()=>{
      await config();editable();
      const name=labelValue(params.name),old=params.id?rowFor(params.id):null;
      const previous=old?await context.secrets.read('credentials',`${old.id}.json`):'';
      const url=params.url?.trim()?urlValue(params.url):previous;
      if(!url)throw Error('请输入 HTTPS 订阅地址');
      for(const row of subscriptions)if(row.id!==old?.id&&await context.secrets.read('credentials',`${row.id}.json`)===url)
        return view({controller:false});
      if(!old&&subscriptions.length>=32)throw Error('最多保存 32 个订阅');
      const id=old?.id??`sub-${randomUUID()}`;
      const row={id,name,enabled:old?.enabled??true,status:old?.status??'pending',
        lastAttempt:old?.lastAttempt??null,lastSuccess:old?.lastSuccess??null,
        nodeCount:old?.nodeCount??0,hasCache:old?.hasCache??false,userInfo:old?.userInfo??null,error:'',errorCode:null};
      if(url!==previous)row.status='pending';
      await context.secrets.write('credentials',`${id}.json`,url);
      try{await persist(old?subscriptions.map(s=>s.id===id?row:s):[...subscriptions,row])}
      catch(error){await context.secrets.write('credentials',`${id}.json`,previous||'');throw error}
      return view({controller:false});
    });
  }
  async function subscriptionToggle({id,enabled}) {
    return exclusive(async()=>{
      await config();editable();rowFor(id);
      if(typeof enabled!=='boolean')throw Error('订阅启用状态无效');
      await persist(subscriptions.map(s=>s.id===id?{...s,enabled}:s));return view({controller:false});
    });
  }
  async function subscriptionRemove({id}) {
    return exclusive(async()=>{
      await config();editable();rowFor(id);
      const previous=await context.secrets.read('credentials',`${id}.json`);
      await context.secrets.write('credentials',`${id}.json`,'');
      try{await persist(subscriptions.filter(s=>s.id!==id))}
      catch(error){await context.secrets.write('credentials',`${id}.json`,previous||'');throw error}
      await runtime.removeSubscription?.(id);return view({controller:false});
    });
  }
  async function updateOne(id,signal) {
    try{
      const url=await context.secrets.read('credentials',`${id}.json`);
      await runtime.updateSubscription({...settings,id,url,signal,
        apply:alive()&&rowFor(id).enabled?()=>request(`/providers/proxies/${id}`,{method:'PUT'}):null,
        commit:result=>exclusive(async()=>persist(subscriptions.map(s=>s.id===id?{...s,status:'ready',error:'',errorCode:null,
          hasCache:true,nodeCount:result.nodeCount,
          // 服务器没回报额度就保留旧值；结构异常视为无额度。
          userInfo:result.userInfo&&Number.isFinite(result.userInfo.total)&&Number.isFinite(result.userInfo.used)&&result.userInfo.used<=result.userInfo.total?result.userInfo:s.userInfo??null,
          lastSuccess:new Date().toISOString()}:s)))});
    }catch(error){
      const safe=publicUpdateError(signal.aborted?{code:'CANCELLED'}:error);
      await exclusive(async()=>{
        try{await persist(subscriptions.map(s=>s.id===id?{...s,status:'error',error:safe.message,errorCode:safe.code}:s))}
        catch{subscriptions=subscriptions.map(s=>s.id===id?{...s,status:'error',error:updateMessages.STORAGE,errorCode:'STORAGE'}:s)}
      });
    }finally{jobs.delete(id)}
  }
  async function reload({id}={}) {
    return exclusive(async()=>{
      await config();
      if(closing||operation)throw Error('内核正在切换状态，请稍后重试');
      if(!settings.kernel)throw Error('请先配置 mihomo 内核');
      const selected=id?[rowFor(id)]:subscriptions.filter(s=>s.enabled),fresh=selected.filter(s=>!jobs.has(s.id));
      await persist(subscriptions.map(s=>fresh.some(f=>f.id===s.id)?{...s,status:'updating',
        lastAttempt:new Date().toISOString(),error:'',errorCode:null}:s));
      for(const row of fresh){
        const controller=new AbortController(),job={controller,promise:null};jobs.set(row.id,job);
        job.promise=updateOne(row.id,controller.signal);
      }
      return view({controller:false});
    });
  }
  async function layout({layout}) {
    return exclusive(async()=>{
      if(!['single','double'].includes(layout))throw Error('布局值无效');
      const next={...await config(),layout};
      await context.storage.write('config','clash.json',JSON.stringify(next));settings=next;return view();
    });
  }
  // TUN 服务：安装/卸载各需要一次 UAC；装好后普通权限即可开关 TUN。
  async function tunService() {
    if(!runtime.tun)throw Error('当前环境不支持 TUN 服务模式');
    return runtime.tun.status();
  }
  async function installTunService() {
    return exclusive(async()=>{
      if(!runtime.tun)throw Error('当前环境不支持 TUN 服务模式');
      const c=await config();editable();
      if(!c.kernel)throw Error('请先选择 mihomo 内核');
      await runtime.tun.install({kernel:c.kernel,home:context.dataDirectory});
      return view({controller:false});
    });
  }
  async function uninstallTunService() {
    return exclusive(async()=>{
      if(!runtime.tun)throw Error('当前环境不支持 TUN 服务模式');
      const c=await config();editable();
      await runtime.tun.uninstall();
      const next={...c,tun:{...c.tun,enable:false}};
      await context.storage.write('config','clash.json',JSON.stringify(next));settings=next;
      return view({controller:false});
    });
  }
  async function start() {
    if(operation)return operation.promise;
      const task={name:'starting',promise:null,controller:new AbortController()};operation=task;operationError='';
    task.promise=(async()=>{
      await queue;const c=await config();
      if(alive())return view();
      if(jobs.size)throw Error('请等待订阅更新完成');
      if(closing)throw Error('插件正在停用');
      if(!c.kernel)throw Error('请先选择 mihomo 内核');
      const enabled=subscriptions.filter(s=>s.enabled);
      if(enabled.some(s=>!s.hasCache))throw Error('请先更新已启用订阅，获取可用缓存');
      secret=await context.secrets.read('keys','controller.key')||randomBytes(32).toString('hex');
      await context.secrets.write('keys','controller.key',secret);
      const candidate=await runtime.start({...c,secret,subscriptions:enabled,request,signal:task.controller.signal});running=candidate;
      try{await request('/version')}catch{await candidate.stop();running=null;throw Error('内核控制器尚未就绪')}
      startedAt=Date.now();ipCache=null;
      return view();
    })().catch(error=>{operationError=task.controller.signal.aborted?'启动已取消':'启动失败，请检查内核路径、端口和订阅缓存';throw error})
      .finally(()=>{if(operation===task)operation=null});
    return task.promise;
  }
  async function stop() {
    if(operation?.name==='stopping')return operation.promise;
    const prior=operation?.promise;operation?.controller?.abort();
    const task={name:'stopping',promise:null};operation=task;operationError='';
    task.promise=(async()=>{
      await prior?.catch(()=>{});
      for(const job of jobs.values())job.controller.abort();
      await Promise.allSettled([...jobs.values()].map(j=>j.promise));
      // A failed registry restore must not keep the owned core running.
      // The lease record remains available for retry on the next stop/activation.
      let restoreError;
      try{await runtime.proxy.restore()}catch(error){restoreError=error}
      if(running){await running.stop();running=null}
      startedAt=0;ipCache=null;
      // TUN 由 SYSTEM 服务托管时，确保服务侧内核也停下（running 为空时的兜底）。
      try{await runtime.tunStop?.()}catch{/* 服务未安装或已停 */}
      if(restoreError)throw restoreError;
      return view({controller:false});
    })().catch(error=>{operationError='停止失败，请检查内核和系统代理恢复状态';throw error})
      .finally(()=>{if(operation===task)operation=null});
    return task.promise;
  }
  async function shutdown(){closing=true;return stop()}
  async function select({group,name}) {
    if(!alive())throw Error('内核尚未启动');const state=await view();
    if(!state.groups.some(g=>g.name===group&&g.nodes.some(n=>n.name===name)))throw Error('代理组或节点已变化，请刷新');
    await request(`/proxies/${encodeURIComponent(group)}`,{method:'PUT',body:{name}});return view();
  }
  async function mode({mode}) {
    if(!alive()||!['rule','global','direct'].includes(mode))throw Error('内核状态或模式无效');
    await request('/configs',{method:'PATCH',body:{mode}});return view();
  }
  async function proxy({enabled}) {
    if(typeof enabled!=='boolean')throw Error('系统代理状态无效');
    if(enabled){if(!alive()||operation)throw Error('请先启动内核');await runtime.proxy.enable((await config()).mixedPort)}
    else await runtime.proxy.restore();return view();
  }
  async function details({section}) {
    if(section==='providers')return (await view({controller:false})).subscriptions;
    if(!alive())throw Error('内核尚未启动');
    if(section==='rules'){
      // payload 是规则真正拦/放的域名或网段：只有 type 与 proxy 的话，页面上一行行
      // 全是「GEOSITE → 🎯 全球直连」，看不出规则在干什么。
      const result=await request('/rules');
      const rules=(Array.isArray(result.rules)?result.rules:[]).map(rule=>({type:String(rule?.type??''),
        payload:String(rule?.payload??''),proxy:String(rule?.proxy??'')}));
      return {count:rules.length,rules:rules.slice(0,RULE_LIMIT)};
    }
    if(section==='connections'){
      // 只取展示需要的字段：进程路径这类本机信息既不展示也不回传。
      // 连接列表比一般响应大得多（几百条连接×每条 metadata），单独放宽到 8 MiB。
      const result=await request('/connections',{limit:8*1024*1024});
      const list=Array.isArray(result.connections)?result.connections:[];
      return {count:list.length,
        uploadTotal:Number.isFinite(result.uploadTotal)?result.uploadTotal:0,
        downloadTotal:Number.isFinite(result.downloadTotal)?result.downloadTotal:0,
        connections:list.slice(0,CONNECTION_LIMIT).map(row=>{
          const meta=row?.metadata??{},port=meta.destinationPort?`:${meta.destinationPort}`:'';
          return {id:String(row?.id??'').slice(0,80),network:String(meta.network??''),
            host:String(meta.host??''),destination:meta.destinationIP?`${meta.destinationIP}${port}`:'',
            source:String(meta.sourceIP??''),
            chains:Array.isArray(row?.chains)?row.chains.slice(0,8).map(stripPrefix):[],
            rule:[row?.rule,row?.rulePayload].filter(Boolean).map(String).join(' '),
            upload:Number.isFinite(row?.upload)?row.upload:0,
            download:Number.isFinite(row?.download)?row.download:0,
            start:row?.start??null};
        })};
    }
    throw Error('详情类别无效');
  }
  // 出口 IP 必须经用户配置的代理口查询：直连查询在 TUN 或系统代理下会得到本机出口，
  // 与页面要展示的「当前节点看到的 IP」不一致。结果缓存 60 秒，避免反复打查询接口。
  async function ipInfo({refresh=false}={}) {
    if(!alive())return {available:false,reason:'内核未运行：出口 IP 需要经代理查询'};
    if(!refresh&&ipCache&&Date.now()-ipCache.at<60000)return ipCache.value;
    const query=runtime.proxiedGet;
    if(typeof query!=='function')return {available:false,reason:'当前运行时不支持查询出口 IP'};
    const {mixedPort}=await config();
    for(const source of ipSources){
      try{
        const value=source.parse(await query(source.url,{port:mixedPort,timeoutMs:6000}));
        if(value){ipCache={at:Date.now(),value:{available:true,...value,source:source.label}};return ipCache.value}
      }catch{/* 单个源不可用就换下一个，最终统一降级 */}
    }
    return {available:false,reason:'查询服务无响应，请检查代理连通性后重试'};
  }
  // 主组的 now 可能仍是另一个组，逐层取到真正的叶子节点再测速。
  function resolveLeaf(proxies) {
    let name=proxies?.['🚀 节点选择']?.now;
    for(let depth=0;depth<8&&name;depth++){
      const node=proxies[name];
      if(!node)return null;
      if(!Array.isArray(node.all))return name;
      name=node.now;
    }
    return null;
  }
  async function siteTest() {
    if(!alive())throw Error('内核尚未启动');
    const {proxies}=await request('/proxies');
    const leaf=resolveLeaf(proxies??{});
    if(!leaf)throw Error('没有可用的代理节点，请先选择节点');
    const sites=await Promise.all(siteTargets.map(async target=>{
      try{
        const result=await request(`/proxies/${encodeURIComponent(leaf)}/delay?url=${encodeURIComponent(target.url)}&timeout=5000`);
        const delay=Number.isFinite(result?.delay)&&result.delay>0?result.delay:null;
        return {...target,delay,ok:delay!==null};
      }catch{return {...target,delay:null,ok:false}}
    }));
    return {node:leaf,sites};
  }
  // 运行中切换 TUN 必须重启内核：TUN 由 SYSTEM 服务托管，普通模式由本进程 spawn，
  // 两者写同一个控制器端口，不能并存。整段「停 → 写配置 → 按新设置起」放到后台跑，
  // RPC 立刻返回：一次 TUN 启动要等 SYSTEM 服务拉起内核，很容易超过单次 RPC 的 15 秒。
  async function tunSwitch({enable}={}) {
    if(typeof enable!=='boolean')throw Error('TUN 开关无效');
    if(!runtime.tun)throw Error('当前环境不支持 TUN 服务模式');
    if(tunBusy)return view({controller:false});
    const old=await config();
    if(enable){
      const info=await runtime.tun.status();
      if(!info.installed)throw Error('请先在设置里安装 TUN 服务');
    }
    const wasRunning=alive();
    tunBusy=true;operationError='';
    void (async()=>{
      try{
        if(wasRunning)await stop();
        await save({kernel:old.kernel,mixedPort:old.mixedPort,controllerPort:old.controllerPort,
          tun:{enable,stack:old.tun?.stack??defaultTun.stack}});
        if(wasRunning)await start();
      }catch(error){operationError=error?.message||'切换 TUN 失败，请检查内核与服务状态'}
      finally{tunBusy=false}
    })();
    return view({controller:false});
  }
  return {view,save,tunSwitch,subscriptionSave,subscriptionToggle,subscriptionRemove,layout,start,stop,shutdown,select,mode,reload,proxy,details,
    tunService,installTunService,uninstallTunService,ipInfo,siteTest};
}
