import {randomBytes, randomUUID} from 'node:crypto';
import {publicUpdateError,updateMessages} from './subscriptions.mjs';

const defaults={kernel:'',mixedPort:7895,controllerPort:9099,layout:'single'};
const tunStacks=['mixed','gvisor','system'];
const defaultTun={enable:false,stack:'mixed'};
const validId=id=>/^sub-[a-f0-9-]{36}$/.test(id);
function urlValue(value) {
  let url;try{url=new URL(String(value).trim())}catch{throw Error('订阅地址无效')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>8192)
    throw Error('订阅必须使用不含用户名、密码或片段的 HTTPS 地址');
  return url.href;
}
function labelValue(value) {
  const name=String(value??'').trim();
  if(!name||name.length>80||/[\x00-\x1f\x7f]/.test(name)||/https?:\/\/|token\s*=/i.test(name))
    throw Error('请输入 1–80 字的订阅名称，不要包含地址或凭据');
  return name;
}
export function createClash({context,runtime,request:injectedRequest,fetch:fetcher=globalThis.fetch,defaultKernel=''}) {
  let running=null,settings,loading,subscriptions=[],secret='',operation=null,closing=false,operationError='';
  // 旧版单订阅凭据存在但无法自动迁移（密文/格式不符）时置真，用于页面明确提示「请重新添加」。
  let legacyPending=false;
  let queue=Promise.resolve();
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
          errorCode:s.status==='updating'?'CANCELLED':Object.hasOwn(updateMessages,s.errorCode)?s.errorCode:null,
          error:s.status==='updating'?'上次更新被中断，旧缓存仍保留':s.status==='error'?(updateMessages[s.errorCode]??updateMessages.UNKNOWN):''
        }));
      } else {
        const old=await context.secrets.read('credentials','subscription.json');
        if(old) {
          // 旧凭据可能已是加密密文而非明文 URL：无法解析时跳过迁移并保留原值，
          // 否则会抛错并让 config() 每次失败，页面只能显示空订阅且无法新增。
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
            // 无法解析：保留原值不动，但要让页面知道「旧订阅没迁过来，请重新添加地址」。
            legacyPending=true;
          }
        }
      }
    })().catch(error=>{loading=null;throw error});
    await loading;return settings;
  }
  async function request(path,{method='GET',body}={}) {
    if(injectedRequest)return injectedRequest(path,{method,...(body===undefined?{}:{body})});
    const c=await config(),response=await fetcher(`http://127.0.0.1:${c.controllerPort}${path}`,{
      method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3500),redirect:'error'});
    if(!response.ok)throw Error('mihomo 控制器请求失败');
    if(response.status===204)return {};
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;
      if((size+=value.byteLength)>2*1024*1024)throw Error('mihomo 响应超过限制');chunks.push(value)}}
    finally{await reader.cancel().catch(()=>{})}
    return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
  }
  function sourceNode(name,proxies={}) {
    const source=subscriptions.find(s=>name.startsWith(`[${s.id}] `));
    return {name,label:source?name.slice(source.id.length+3):name,sourceId:source?.id??null,
      source:source?.name??null,delay:proxies[name]?.history?.at(-1)?.delay??null};
  }
  async function view({controller=true}={}) {
    const c=await config(),state={...c,configured:!!c.kernel,subscriptionConfigured:subscriptions.length>0,
      legacyPending,
      subscriptions:subscriptions.map(s=>({...s,updating:jobs.has(s.id)})),
      running:alive(),operation:operation?.name??null,error:operationError,systemProxy:runtime.proxy.active?.()??false,groups:[],mode:'rule'};
    if(controller&&state.running)try{
      const [version,proxies,status]=await Promise.all([request('/version'),request('/proxies'),request('/configs')]);
      state.version=version.version;state.mode=status.mode;
      state.groups=Object.entries(proxies.proxies||{}).filter(([,p])=>Array.isArray(p.all)).map(([name,p])=>({
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
        nodeCount:old?.nodeCount??0,hasCache:old?.hasCache??false,error:'',errorCode:null};
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
          hasCache:true,nodeCount:result.nodeCount,lastSuccess:new Date().toISOString()}:s)))});
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
    const path={rules:'/rules',connections:'/connections'}[section];if(!path)throw Error('详情类别无效');
    const result=await request(path);
    if(section==='connections')return {count:Array.isArray(result.connections)?result.connections.length:0,
      uploadTotal:result.uploadTotal??0,downloadTotal:result.downloadTotal??0};
    return {rules:(result.rules||[]).map(r=>({type:r.type,proxy:r.proxy}))};
  }
  return {view,save,subscriptionSave,subscriptionToggle,subscriptionRemove,layout,start,stop,shutdown,select,mode,reload,proxy,details,
    tunService,installTunService,uninstallTunService};
}
