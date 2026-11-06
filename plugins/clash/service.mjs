import {createHash,randomBytes, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import os from 'node:os';
import {publicUpdateError,updateMessages} from './subscriptions.mjs';
// 校验错误统一挂码：文案在 shared/errors.mjs 按 code 查表，页面不再做中文正则匹配。
import {serviceError} from '../../shared/errors.mjs';

// 统一错误码：这些 code 由适配层产生，页面按 code 显示专属文案（#13/#14 共用一套）。
// 只在这里声明消息，不把 code 拼进字符串，避免页面只能做字符串匹配。
const coded=(code,message,extra)=>{
  const error=Error(message);
  error.code=code;
  if(extra)Object.assign(error,extra);
  return error;
};
// 内核运行态落盘文件：插件进程重启后靠它认出「内核还在跑」。
const RUN_STATE_FILE='run-state.json';
const secretFingerprint=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,16);
const isPort=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
const defaultPidAlive=pid=>{
  try{process.kill(pid,0);return true}catch{return false}
};
// pid 复用只能靠「这个 pid 的实际启动时刻」挡住：与宿主 plugin_runtime.rs 的 running_for(pid)+
// ORPHAN_SLACK_MS 同口径。取不到（无权限、进程已退、平台不认、PowerShell 全不可用）就返回 null，
// 调用方一律当作「不是本插件的内核」，不发信号。
const PID_REUSE_SLACK_MS=5000;
// 解释器候选：FISH_PWSH 覆盖（tun.mjs 也用这个）→ powsh → Windows PowerShell 5.1
// （5.1 同样能算 Get-Process 的 StartTime；没有 pwsh 的机器不能让清理能力整个失效）。
function powershellCandidates() {
  const list=[process.env.FISH_PWSH,'pwsh','powershell.exe'].filter(value=>typeof value==='string'&&value.trim());
  return [...new Set(list)];
}
function defaultProcessStartedAt(pid) {
  if(!Number.isInteger(pid)||pid<=0)return Promise.resolve(null);
  const windows=process.platform==='win32';
  const startedAtOf=output=>{
    const text=String(output??'').trim();
    if(windows){
      const elapsed=Number(text);
      return Number.isFinite(elapsed)&&elapsed>=0?Date.now()-elapsed:null;
    }
    const seconds=Number(text.split(/\s+/)[0]);
    return Number.isFinite(seconds)?Date.now()-seconds*1000:null;
  };
  const run=(file,args)=>new Promise(resolve=>{
    execFile(file,args,{windowsHide:true,timeout:3000},(error,stdout)=>resolve(error?null:startedAtOf(stdout)));
  });
  const valid=value=>Number.isFinite(value)&&value>0;
  if(!windows)return run('ps',['-o','etimes=','-p',String(pid)]).then(value=>valid(value)?value:null);
  const script=`[long]((Get-Date).ToUniversalTime()-(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime()).TotalMilliseconds`;
  const candidates=powershellCandidates();
  return (async()=>{
    for(const file of candidates){
      const value=await run(file,['-NoProfile','-NonInteractive','-Command',script]);
      if(valid(value))return value;
    }
    return null;
  })();
}
// 落盘记录必须自证完整才可信：字段不全就当作「没有残留内核」，不能让坏记录冒充运行中。
function runStateValue(value) {
  if(!value||typeof value!=='object'||value.schema!==1)return null;
  const pid=Number(value.pid),startedAt=Number(value.startedAt);
  const mode=value.mode==='service'?'service':'process';
  if(mode==='process'&&(!Number.isInteger(pid)||pid<=0))return null;
  if(!isPort(value.mixedPort)||!isPort(value.controllerPort))return null;
  if(!Number.isFinite(startedAt)||startedAt<=0)return null;
  if(typeof value.secretFingerprint!=='string'||!/^[a-f0-9]{16}$/.test(value.secretFingerprint))return null;
  return {schema:1,pid:Number.isInteger(pid)&&pid>0?pid:null,mode,mixedPort:value.mixedPort,
    controllerPort:value.controllerPort,startedAt,
    subscriptions:Array.isArray(value.subscriptions)?value.subscriptions.filter(id=>validId(id)):[],
    secretFingerprint:value.secretFingerprint};
}

const defaults={kernel:'',mixedPort:7895,controllerPort:9099};
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
  let url;try{url=new URL(String(value).trim())}catch{throw serviceError('SUBSCRIPTION_URL_INVALID')}
  if(url.protocol!=='http:'&&url.protocol!=='https:')
    throw serviceError('SUBSCRIPTION_URL_INVALID');
  if(url.username||url.password)throw serviceError('SUBSCRIPTION_URL_INVALID');
  if(url.href.length>8192)throw serviceError('SUBSCRIPTION_URL_INVALID');
  // 片段（#名称）是订阅备注，不是地址的一部分；机场常带，直接剥掉而不是拒绝。
  url.hash='';
  return url.href;
}
function labelValue(value) {
  const name=String(value??'').trim();
  if(!name||name.length>80||/[\x00-\x1f\x7f]/.test(name)||/https?:\/\/|token\s*=/i.test(name))
    throw serviceError('SUBSCRIPTION_NAME_INVALID');
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
export function createClash({context,runtime,request:injectedRequest,fetch:fetcher=globalThis.fetch,defaultKernel='',pluginVersion='',
  pidAlive=defaultPidAlive,pidStartedAt=defaultProcessStartedAt,attachCooldownMs=3000}) {
  let running=null,settings,loading,subscriptions=[],secret='',operation=null,closing=false,operationError='';
  let startedAt=0,ipCache=null;
  // 「内核在不在跑」不再只由内存里的 running 决定：插件进程重启后 running 会归零，
  // 但 mihomo 子进程还在，于是界面显示「内核已停止」而代理仍然有效（#14 现象 C/E）。
  // 这里补一份落盘运行态，并按 pid + secret 指纹 + 控制器 /version 三重确认后 attach。
  let attached=false,kernelPid=null,attachError=null,attachTask=null,attachRetryAt=0;
  // secrets.read 由宿主先解密；这里只标记解密后内容仍不符合订阅地址格式的情况。
  let legacyPending=false;
  let queue=Promise.resolve();
  // 运行中换订阅：热重载的控制器超时（默认 3.5 秒是给读接口用的，重载要重建 provider 与规则）。
  const SWITCH_RELOAD_TIMEOUT_MS=4500;
  // 切 TUN 要重启内核，耗时可能超过一次 RPC 的超时，所以它跑在后台：RPC 立刻返回，
  // 前端靠轮询 tunSwitching 看进度。这个标记不进 operation，免得和启动/停止互相覆盖。
  let tunBusy=false;
  const jobs=new Map(),alive=()=>!!running&&running.alive();
  const exclusive=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result};
  // ---- 运行态落盘与 attach -------------------------------------------------
  const processAlive=pid=>{
    try{return pidAlive(pid)===true}catch{return false}
  };
  async function clearRunState() {
    try{await context.storage.write('config',RUN_STATE_FILE,'')}catch{/* 记录清不掉不影响停止语义 */}
  }
  async function readRunState() {
    let raw;
    try{raw=await context.storage.read('config',RUN_STATE_FILE)}
    catch{attachError={code:'KERNEL_ATTACH_FAILED',message:'内核运行态记录读取失败'};return null}
    if(!raw)return null;
    let record=null;
    try{record=runStateValue(JSON.parse(raw))}catch{/* 坏 JSON 与坏结构同样处理 */}
    if(!record){
      attachError={code:'KERNEL_ATTACH_FAILED',message:'内核运行态记录已损坏，已丢弃'};
      await clearRunState();return null;
    }
    return record;
  }
  async function writeRunState(record) {
    await context.storage.write('config',RUN_STATE_FILE,JSON.stringify(record));
  }
  // 结束一个不属于本实例的残留内核：优先交给 runtime（会等真正退出），
  // 没有 runtime 能力时退回本进程发信号。
  async function terminateKernel(pid) {
    if(typeof runtime.kill==='function'){
      const settled=await runtime.kill(pid);
      if(settled===false)throw coded('KERNEL_STOP_UNCONFIRMED','残留内核没有退出，请在任务管理器中结束 mihomo 进程后重试');
      return;
    }
    try{process.kill(pid,'SIGTERM')}
    catch(error){if(error?.code!=='ESRCH')throw coded('KERNEL_STOP_UNCONFIRMED','结束残留内核失败')}
  }
  async function probeController(controllerPort,key) {
    // 注入的 request 就是控制器本身（测试与宿主自测走这条），保持单一入口。
    if(injectedRequest)return injectedRequest('/version',{method:'GET'});
    let response;
    try{
      response=await fetcher(`http://127.0.0.1:${controllerPort}/version`,{
        method:'GET',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(1500),redirect:'error'});
    }catch(error){
      throw coded(error?.name==='TimeoutError'?'CONTROLLER_TIMEOUT':'CONTROLLER_UNREACHABLE','残留内核的控制器没有应答');
    }
    if(!response.ok)throw coded('CONTROLLER_UNREACHABLE','残留内核的控制器没有应答');
    const value=await response.json().catch(()=>null);
    if(typeof value?.version!=='string')throw coded('CONTROLLER_UNREACHABLE','残留内核的控制器应答无效');
    return value;
  }
  // 残留内核的判据：reclaim 与 stop 共用一套，且与 attach 的判据对齐——只看 pid 存活就
  // SIGTERM/SIGKILL，会在 pid 被系统复用给别的程序（浏览器等）时杀错人（#14 复审 F1/F2）。
  //   service     —— 由 TUN 服务托管，交给 runtime.tunStop；
  //   absent      —— 内核进程已经不在了，没有残留；
  //   attachable  —— 控制器还应答：这是能接管的活内核，留给 attach，这里绝不发信号；
  //   reclaim     —— 控制器不通 + pid 的实际启动时刻与记录一致（±5s）：确实是我们的僵尸内核；
  //   foreign     —— 控制器不通 + 启动时刻对不上或取不到（pid 多半已被复用）：不杀。
  async function residualKernel(record) {
    if(!record)return 'absent';
    if(record.mode==='service')return 'service';
    if(!processAlive(record.pid))return 'absent';
    let key='';
    try{key=await context.secrets.read('keys','controller.key')||''}catch{key=''}
    if(key&&secretFingerprint(key)===record.secretFingerprint){
      try{await probeController(record.controllerPort,key);return 'attachable'}
      catch{/* 控制器不通：接着用启动时刻判定是不是同一个进程 */}
    }
    const actual=await pidStartedAt(record.pid);
    if(!Number.isFinite(actual)){
      // 连启动时刻都取不到：保守地不杀，但要让页面能说清楚，别让用户以为「已停止」。
      attachError={code:'KERNEL_ATTACH_FAILED',
        message:'无法确认残留内核的启动时刻，已保守地不结束该进程；如确认是 mihomo 残留内核，请在任务管理器中结束它'};
      return 'foreign';
    }
    return Math.abs(actual-record.startedAt)<=PID_REUSE_SLACK_MS?'reclaim':'foreign';
  }
  // attach 三重校验：pid 存活（服务托管模式看控制器）、secret 指纹一致、/version 可达。
  // pid 复用只能靠后两项兜底，所以缺一项就不认。
  async function attachRunning() {
    const record=await readRunState();
    if(!record)return null;
    let key='';
    try{key=await context.secrets.read('keys','controller.key')||''}catch{key=''}
    if(!key||secretFingerprint(key)!==record.secretFingerprint){
      attachError={code:'KERNEL_ATTACH_FAILED',message:'内核运行态记录与当前密钥不匹配，已丢弃'};
      await clearRunState();return null;
    }
    if(record.mode!=='service'&&!processAlive(record.pid)){
      // 内核已经退出：这是正常停机后的残留记录，静默丢弃。
      await clearRunState();return null;
    }
    try{await probeController(record.controllerPort,key)}
    catch(error){
      attachError={code:'KERNEL_ATTACH_FAILED',cause:error?.code??'CONTROLLER_UNREACHABLE',
        message:'残留内核仍在运行，但控制器没有应答，请停止后重新启动'};
      return {record,key,ok:false};
    }
    return {record,key,ok:true};
  }
  function adoptKernel(record) {
    let stopped=false;
    return {pid:record.pid,mode:record.mode,attached:true,
      alive:()=>!stopped&&(record.mode==='service'?true:processAlive(record.pid)),
      stop:async()=>{
        if(stopped)return;
        stopped=true;
        if(record.mode==='service'){try{await runtime.tunStop?.()}catch{/* 服务未安装或已停 */}return}
        await terminateKernel(record.pid);
      }};
  }
  // 只在需要时读一次盘；失败后按冷却窗口重试，避免每次 view() 都等一次控制器超时。
  // 已经持有运行中的句柄时绝不重新 attach：那会把本实例 spawn 的内核替换成「外来进程」，
  // 停止时只发信号不等它退出，反而杀不干净。
  function ready() {
    if(running)return Promise.resolve(null);
    if(attachTask)return attachTask;
    if(Date.now()<attachRetryAt)return Promise.resolve(null);
    attachTask=(async()=>{
      const outcome=await attachRunning();
      if(!outcome)return null;
      if(!outcome.ok){
        attachTask=null;attachRetryAt=Date.now()+attachCooldownMs;
        return outcome;
      }
      running=adoptKernel(outcome.record);
      attached=true;kernelPid=outcome.record.pid;startedAt=outcome.record.startedAt;
      secret=outcome.key;ipCache=null;attachError=null;attachRetryAt=0;
      return outcome;
    })().catch(error=>{
      attachTask=null;
      attachError={code:'KERNEL_ATTACH_FAILED',message:error?.message??'识别残留内核失败'};
      return null;
    });
    return attachTask;
  }
  // 起新内核前先收拾上一实例的残留：否则两边抢同一个控制器端口，用户看到的是 EADDRINUSE。
  // 判据走 residualKernel：只有「确实是记录里那个内核」才结束它，可接管的活内核留给 attach。
  async function reclaimRunState() {
    const record=await readRunState();
    if(!record)return 'absent';
    let verdict='absent';
    try{
      verdict=await residualKernel(record);
      if(verdict==='service')await runtime.tunStop?.();
      else if(verdict==='reclaim')await terminateKernel(record.pid);
    }catch{/* 回收不成功留给后续端口探测报错 */}
    // 可接管的活内核必须留住记录：清掉就再也认不出来，下次启动必然并起第二个内核。
    if(verdict!=='attachable')await clearRunState();
    return verdict;
  }
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
        controllerPort:saved.controllerPort??defaults.controllerPort,bundled,
        tun:{enable:saved.tun?.enable===true,stack:tunStacks.includes(saved.tun?.stack)?saved.tun.stack:defaultTun.stack}};
      if(bundled)settings.kernel=defaultKernel;
      const raw=await context.storage.read('config','subscriptions.json');
      if(raw) {
        const data=JSON.parse(raw);
        if(data.schema!==2||!Array.isArray(data.subscriptions)||data.subscriptions.length>32||
          data.subscriptions.some(s=>!validId(s.id))||new Set(data.subscriptions.map(s=>s.id)).size!==data.subscriptions.length)
          throw serviceError('SUBSCRIPTION_CORRUPT');
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
        // 旧数据里可能有多条启用；内存里只留第一条，界面与内核看到的是同一个状态，
        // 用户下次点卡片时再写回盘。
        const firstEnabled=subscriptions.find(row=>row.enabled);
        if(firstEnabled)subscriptions=subscriptions.map(row=>({...row,enabled:row.id===firstEnabled.id}));
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
  async function request(path,{method='GET',body,limit=2*1024*1024,timeoutMs=3500}={}) {
    if(injectedRequest)return injectedRequest(path,{method,...(body===undefined?{}:{body})});
    const c=await config();
    let response;
    try{
      response=await fetcher(`http://127.0.0.1:${c.controllerPort}${path}`,{
        method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
    }catch(error){
      // 超时与不可达对用户是两件事：一个可能只是内核忙，另一个是内核/端口不对。
      throw error?.name==='TimeoutError'
        ?coded('CONTROLLER_TIMEOUT','mihomo 控制器请求超时，请稍后重试')
        :coded('CONTROLLER_UNREACHABLE','mihomo 控制器不可达，请检查内核是否在运行');
    }
    if(!response.ok)throw coded('CONTROLLER_UNREACHABLE','mihomo 控制器请求失败');
    if(response.status===204)return {};
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;
      if((size+=value.byteLength)>limit)throw serviceError('RESPONSE_TOO_LARGE');chunks.push(value)}}
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
    // 先认一次落盘运行态：插件进程重启后 view() 是唯一的唤醒点。
    await ready();
    const c=await config(),state={...c,configured:!!c.kernel,subscriptionConfigured:subscriptions.length>0,
      legacyPending,
      subscriptions:subscriptions.map(s=>({...s,updating:jobs.has(s.id)})),
      running:alive(),operation:operation?.name??null,tunSwitching:tunBusy,error:operationError,
      errorCode:null,attached,kernelPid,attachError,systemProxy:runtime.proxy.active?.()??false,
      os:`${os.platform()==='win32'?'Windows':os.platform()} ${os.release()}`,
      arch:os.arch(),cpu:cpuLabel(),memoryTotal:os.totalmem(),pluginVersion,
      uptimeMs:alive()&&startedAt?Date.now()-startedAt:null,
      rulesCount:null,groups:[],mode:'rule'};
    if(!state.error&&attachError)state.error=attachError.message;
    if(attachError)state.errorCode=attachError.code;
    if(controller&&state.running)try{
      // /rules 只用于概览卡片的规则数量；拿不到不影响主视图。
      const [version,proxies,status,rules]=await Promise.all([
        request('/version'),request('/proxies'),request('/configs'),request('/rules').catch(()=>null)]);
      state.version=version.version;state.mode=status.mode;
      state.rulesCount=Array.isArray(rules?.rules)?rules.rules.length:null;
      state.groups=Object.entries(proxies.proxies||{}).filter(([name,p])=>isProxyGroup(name,p)).map(([name,p])=>({
        name,selected:p.now,nodes:p.all.map(name=>sourceNode(name,proxies.proxies))}));
    }catch(error){
      // 「内核在跑但控制器不可达」与「内核根本没起」是两件事，页面要能分开显示。
      state.error='控制器暂未响应，请刷新或停止内核';
      state.errorCode=error?.code??'CONTROLLER_UNREACHABLE';
    }
    if(runtime.tun)try{state.tunService=await runtime.tun.status()}catch{state.tunService=null}
    return state;
  }
  function editable() {
    if(alive()||operation)throw serviceError('KERNEL_RUNNING_LOCK');
    if(jobs.size)throw serviceError('SUBSCRIPTION_UPDATING');
    if(closing)throw serviceError('PLUGIN_STOPPING');
  }
  function rowFor(id) {
    const row=subscriptions.find(s=>s.id===id);if(!row)throw serviceError('SUBSCRIPTION_NOT_FOUND');return row;
  }
  async function save(params) {
    return exclusive(async()=>{
      const old=await config();editable();
      const next={...old,kernel:String(params.kernel??old.kernel).trim(),
        mixedPort:params.mixedPort??old.mixedPort,controllerPort:params.controllerPort??old.controllerPort};
      if(!next.kernel||next.kernel.length>2048||/[\r\n\0]/.test(next.kernel))throw serviceError('KERNEL_NOT_SELECTED');
      for(const port of [next.mixedPort,next.controllerPort])
        if(!Number.isInteger(port)||port<1024||port>65535)throw serviceError('PORT_RANGE_INVALID');
      if(next.mixedPort===next.controllerPort)throw serviceError('PORT_CONFLICT');
      if(params.subscription||params.clearSubscription)throw serviceError('SUBSCRIPTION_IMMUTABLE');
      if(params.tun!==undefined){
        const tun=params.tun||{};
        if(typeof tun.enable!=='boolean'&&tun.enable!==undefined)throw serviceError('TUN_SWITCH_INVALID');
        next.tun={enable:tun.enable===true, stack:tunStacks.includes(tun.stack)?tun.stack:(old.tun?.stack??defaultTun.stack)};
        if(next.tun.enable&&!runtime.tun)throw serviceError('TUN_UNSUPPORTED');
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
      if(!url)throw serviceError('SUBSCRIPTION_URL_INVALID');
      for(const row of subscriptions)if(row.id!==old?.id&&await context.secrets.read('credentials',`${row.id}.json`)===url)
        return view({controller:false});
      if(!old&&subscriptions.length>=32)throw serviceError('SUBSCRIPTION_LIMIT');
      const id=old?.id??`sub-${randomUUID()}`;
      const row={id,name,enabled:old?.enabled??subscriptions.length===0,status:old?.status??'pending',
        lastAttempt:old?.lastAttempt??null,lastSuccess:old?.lastSuccess??null,
        nodeCount:old?.nodeCount??0,hasCache:old?.hasCache??false,userInfo:old?.userInfo??null,error:'',errorCode:null};
      if(url!==previous)row.status='pending';
      await context.secrets.write('credentials',`${id}.json`,url);
      try{await persist(old?subscriptions.map(s=>s.id===id?row:s):[...subscriptions,row])}
      catch(error){await context.secrets.write('credentials',`${id}.json`,previous||'');throw error}
      return view({controller:false});
    });
  }
  // 订阅是单选的：同时只能启用一条。多条一起启用等于把几家机场的节点混进同一个
// 组树，出问题时也说不清是谁的节点——所以启用一条就把其余的关掉。
// 2.1.4：内核运行中也直接生效——热重载配置，不 stop/start 内核。三步走：
//   ① 持久化新启用集；② 生成候选配置 + PUT /configs?force=true 让内核就地换配置；③ 成功 rename 成正式配置。
// 失败则启用集与配置文件一起回滚，抛 SUBSCRIPTION_SWITCH_FAILED——绝不停在「UI 说切了、内核还是旧配置」的中间态。
  async function subscriptionToggle({id,enabled}) {
    return exclusive(async()=>{
      const c=await config();
      if(typeof enabled!=='boolean')throw serviceError('SUBSCRIPTION_STATE_INVALID');
      if(closing)throw serviceError('PLUGIN_STOPPING');
      // 切 TUN 正在后台重启内核：这时的启用集写盘会和重启撞车，明确要求稍后重试。
      if(operation||tunBusy)throw serviceError('KERNEL_SWITCHING');
      if(jobs.size)throw serviceError('SUBSCRIPTION_UPDATING');
      rowFor(id);
      const previous=subscriptions;
      const next=previous.map(s=>s.id===id?{...s,enabled}:(enabled?{...s,enabled:false}:s));
      // 启用没有缓存的订阅，内核会拿到空 provider：运行中要热重载、未运行下次 start 也会失败，
      // 所以两条路径都直接拒绝、且一律不落盘（否则用户拿到「启用成功、启动失败」两个状态）。
      if(next.filter(s=>s.enabled).some(s=>!s.hasCache))throw serviceError('SUBSCRIPTION_NO_CACHE');
      await persist(next);
      // 内核没跑：只落盘启用集，下次启动用新的一套。
      if(!alive())return view({controller:false});
      // 2.1.8：热重载失败不再把「请重启内核」丢给用户——插件自己按新配置重启一次。
      await applySwitch(c,next,previous);
      // 换完配置立刻回读视图：代理组已经是新启用集的，页面才不会显示旧组树。
      try{return await view()}catch{return view({controller:false})}
    });
  }
  // applySwitch 是「让新启用集真正生效」的唯一入口：先热重载（连接不断），失败就按
  // 新配置重启一次内核。两次都失败才回滚启用集并报错——回滚之后用户至少还是旧的那套。
  //
  // 重启不经过 start()：那会走 operation 队列，而本次调用就在队列里，两边互等。
  async function applySwitch(c,next,previous) {
    const key=secret||await context.secrets.read('keys','controller.key')||'';
    try{
      if(typeof runtime.swapConfig!=='function')throw coded('SUBSCRIPTION_SWITCH_FAILED','当前运行时不支持热切换配置');
      await runtime.swapConfig({settings:c,subscriptions:next,secret:key,
        // 热重载要读配置文件、重建 provider 与规则，给 4.5 秒而不是默认的 3.5 秒。
        apply:path=>request('/configs?force=true',{method:'PUT',body:{path},timeoutMs:SWITCH_RELOAD_TIMEOUT_MS})});
      return {applied:'hot'};
    }catch(hot){
      try{
        await restartKernel(c,next);
        return {applied:'restart',hotCode:hot?.code??'UNKNOWN'};
      }catch(restart){
        await rollbackSwitch(previous);
        throw coded('SUBSCRIPTION_SWITCH_FAILED',
          `订阅切换没能生效（热重载 ${hot?.code??'UNKNOWN'}，重启 ${restart?.code??'UNKNOWN'}）`,{cause:restart});
      }
    }
  }
  // restartKernel 按给定的启用集重起内核：先停旧的，再用新配置启动，最后写回运行态
  // （下次插件重载还能 attach）。任何一步失败抛错，交给 applySwitch 回滚。
  async function restartKernel(c,next) {
    const enabled=next.filter(s=>s.enabled);
    if(running){try{await running.stop()}catch{/* 旧内核可能已经自己退了，照常往下走 */}running=null}
    secret=await context.secrets.read('keys','controller.key')||randomBytes(32).toString('hex');
    await context.secrets.write('keys','controller.key',secret);
    const candidate=await runtime.start({...c,secret,subscriptions:enabled,request});
    running=candidate;
    await request('/version',{timeoutMs:4000}).catch(()=>{throw coded('CONTROLLER_UNREACHABLE','重启后的内核控制器尚未就绪')});
    startedAt=Date.now();ipCache=null;attached=false;attachError=null;attachTask=null;attachRetryAt=0;
    kernelPid=Number.isInteger(candidate.pid)?candidate.pid:null;
    try{
      await writeRunState({schema:1,pid:kernelPid,mode:candidate.mode??(c.tun?.enable?'service':'process'),
        mixedPort:c.mixedPort,controllerPort:c.controllerPort,startedAt,
        subscriptions:enabled.map(s=>s.id),secretFingerprint:secretFingerprint(secret)});
    }catch{/* 落盘失败只影响重载后能否 attach */}
  }
  // 热切换失败回滚启用集：磁盘写失败也要把内存复原，不能留下两套状态。
  async function rollbackSwitch(previous){
    try{await persist(previous)}catch{subscriptions=previous}
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
      if(closing||operation)throw serviceError('KERNEL_SWITCHING');
      if(!settings.kernel)throw serviceError('KERNEL_NOT_SELECTED');
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
  // TUN 服务：安装/卸载各需要一次 UAC；装好后普通权限即可开关 TUN。
  async function tunService() {
    if(!runtime.tun)throw serviceError('TUN_UNSUPPORTED');
    return runtime.tun.status();
  }
  async function installTunService() {
    return exclusive(async()=>{
      if(!runtime.tun)throw serviceError('TUN_UNSUPPORTED');
      const c=await config();editable();
      if(!c.kernel)throw serviceError('KERNEL_NOT_SELECTED');
      await runtime.tun.install({kernel:c.kernel,home:context.dataDirectory});
      return view({controller:false});
    });
  }
  async function uninstallTunService() {
    return exclusive(async()=>{
      if(!runtime.tun)throw serviceError('TUN_UNSUPPORTED');
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
      // attach 优先于 start：插件重载后内核通常还在跑，此时再 spawn 就是第二个内核。
      await ready();
      if(alive())return view();
      if(jobs.size)throw serviceError('SUBSCRIPTION_UPDATING');
      if(closing)throw serviceError('PLUGIN_STOPPING');
      if(!c.kernel)throw serviceError('KERNEL_NOT_SELECTED');
      const enabled=subscriptions.filter(s=>s.enabled);
      if(enabled.some(s=>!s.hasCache))throw serviceError('SUBSCRIPTION_NO_CACHE');
      // 走到这里说明没有可 attach 的内核；上一实例可能留下了僵尸进程占着端口，先回收。
      // 回收判定为「可 attach」时不杀它，而是先把那个内核接管过来，绝不并起第二个。
      const reclaimed=await reclaimRunState();
      if(reclaimed==='attachable'){
        attachRetryAt=0;attachTask=null;
        await ready();
        if(alive())return view();
        throw coded('KERNEL_ATTACH_FAILED','残留内核仍在运行但无法接管，请先停止内核再启动');
      }
      secret=await context.secrets.read('keys','controller.key')||randomBytes(32).toString('hex');
      await context.secrets.write('keys','controller.key',secret);
      const candidate=await runtime.start({...c,secret,subscriptions:enabled,request,signal:task.controller.signal});running=candidate;
      try{await request('/version')}catch{await candidate.stop();running=null;throw coded('CONTROLLER_UNREACHABLE','内核控制器尚未就绪')}
      startedAt=Date.now();ipCache=null;attached=false;attachError=null;attachTask=null;attachRetryAt=0;
      kernelPid=Number.isInteger(candidate.pid)?candidate.pid:null;
      // 运行态落盘是「下次能 attach」的唯一依据；写失败不该让已经起来的内核回滚。
      try{
        await writeRunState({schema:1,pid:kernelPid,mode:candidate.mode??(c.tun?.enable?'service':'process'),
          mixedPort:c.mixedPort,controllerPort:c.controllerPort,startedAt,
          subscriptions:enabled.map(s=>s.id),secretFingerprint:secretFingerprint(secret)});
      }catch{/* 落盘失败只影响重载后能否 attach */}
      return view();
    })().catch(error=>{operationError=task.controller.signal.aborted?'启动已取消':'启动失败，请检查内核路径、端口和订阅缓存';throw error})
      .finally(()=>{if(operation===task)operation=null});
    return task.promise;
  }
  // 停止是两件事：内核必须杀干净，系统代理恢复失败只降级为警告（#14 现象 B）。
  // 顺序也是结论的一部分——先杀内核，再动注册表，恢复失败才拦不住内核。
  async function stop() {
    if(operation?.name==='stopping')return operation.promise;
    const prior=operation?.promise;operation?.controller?.abort();
    const task={name:'stopping',promise:null};operation=task;operationError='';
    task.promise=(async()=>{
      await prior?.catch(()=>{});
      for(const job of jobs.values())job.controller.abort();
      await Promise.allSettled([...jobs.values()].map(j=>j.promise));
      // 插件重载过就只剩落盘记录：先尝试 attach，才能认出「内核其实还在跑」。
      await ready();
      const result={kernel:'absent',proxy:'skipped',code:null,message:'',ok:true};
      let kernelError=null,keepRecord=false,keepAttachError=false;
      try{
        if(running){await running.stop();result.kernel='stopped'}
        else{
          const record=await readRunState();
          if(record){
            // 用户点「停止」是默认路径，这里同样不能只凭 pid 存活就发信号（复审 F2）。
            const verdict=await residualKernel(record);
            if(verdict==='service'){try{await runtime.tunStop?.()}catch{/* 服务未安装或已停 */}result.kernel='stopped'}
            else if(verdict==='reclaim'){await terminateKernel(record.pid);result.kernel='stopped'}
            else if(verdict==='attachable'){
              // 控制器还应答：先把这个内核接管成自己的句柄，再按正常路径停——不对没有句柄的 pid 发信号。
              attachRetryAt=0;attachTask=null;
              await ready();
              if(running){await running.stop();result.kernel='stopped'}
              else{
                keepRecord=true;result.kernel='attachable';result.ok=false;
                result.code='KERNEL_ATTACH_FAILED';
                result.message='内核仍在运行且可接管，未结束进程；请重启插件后再次停止';
                operationError=result.message;
              }
            }
            // verdict==='foreign'：pid 的启动时刻对不上（多半已被系统复用给别的程序），不杀。
            // 如果是「取不到启动时刻」，residualKernel 已把原因写进 attachError：留给页面说明白。
            else if(verdict==='foreign'&&attachError?.code==='KERNEL_ATTACH_FAILED'){
              keepAttachError=true;result.message=attachError.message;
            }
          }
        }
      }catch(error){
        kernelError=error;result.kernel='failed';result.ok=false;
        result.code=error?.code??'KERNEL_STOP_UNCONFIRMED';
        result.message='内核未能确认停止，请在任务管理器中结束 mihomo 进程后重试';
      }
      running=null;startedAt=0;ipCache=null;attached=false;kernelPid=null;
      // TUN 由 SYSTEM 服务托管时，确保服务侧内核也停下（running 为空时的兜底）。
      try{await runtime.tunStop?.()}catch{/* 服务未安装或已停 */}
      // 可接管的活内核要留住记录，否则下次启动就把它当成没有内核、再起一个。
      if(!keepRecord)await clearRunState();
      attachTask=null;attachRetryAt=0;
      if(!keepRecord&&!keepAttachError)attachError=null;
      // 系统代理恢复：只有带 code 的适配层错误才降级为警告；
      // 没有 code 的异常说明不是已知状况，保持原有「停止失败」语义，但带上结构化结果。
      let proxyError=null;
      try{await runtime.proxy.restore();result.proxy='restored'}
      catch(error){
        proxyError=error;result.proxy='failed';result.ok=false;
        if(error?.code){
          result.code=error.code;
          result.message=`内核已停止，系统代理恢复失败（${error.code}）`;
        }
      }
      if(kernelError)throw coded(result.code,result.message,{result});
      if(proxyError&&!proxyError.code)throw Object.assign(proxyError,{result});
      if(proxyError)operationError=result.message;
      const state=await view({controller:false});
      state.stop=result;
      return state;
    })().catch(error=>{operationError=error?.result?.message||'停止失败，请检查内核和系统代理恢复状态';throw error})
      .finally(()=>{if(operation===task)operation=null});
    return task.promise;
  }
  async function shutdown(){closing=true;return stop()}
  async function select({group,name}) {
    if(!alive())throw serviceError('KERNEL_NOT_RUNNING');const state=await view();
    if(!state.groups.some(g=>g.name===group&&g.nodes.some(n=>n.name===name)))throw serviceError('NODE_STALE');
    await request(`/proxies/${encodeURIComponent(group)}`,{method:'PUT',body:{name}});
    // 出口 IP 跟着节点走：缓存还留着旧节点的结果就是「换了节点 IP 还是上一个」（#14 现象 D）。
    ipCache=null;
    return view();
  }
  async function mode({mode}) {
    // 两种失败是两种用户动作，别合成一条：没启动内核该去点「启动内核」，模式值非法才该查调用方。
    if(!alive())throw serviceError('KERNEL_NOT_RUNNING');
    if(!['rule','global','direct'].includes(mode))throw serviceError('KERNEL_STATE_INVALID');
    await request('/configs',{method:'PATCH',body:{mode}});return view();
  }
  async function proxy({enabled}) {
    if(typeof enabled!=='boolean')throw serviceError('PROXY_STATE_INVALID');
    // 第二个参数是写租约的插件进程：看门狗据此判断租约有没有被新实例接管。
    if(enabled){if(!alive()||operation)throw serviceError('KERNEL_NOT_RUNNING');await runtime.proxy.enable((await config()).mixedPort,process.pid)}
    else await runtime.proxy.restore();return view();
  }
  async function details({section}) {
    if(section==='providers')return (await view({controller:false})).subscriptions;
    if(!alive())throw serviceError('KERNEL_NOT_RUNNING');
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
    throw serviceError('DETAIL_SECTION_INVALID');
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
    if(!alive())throw serviceError('KERNEL_NOT_RUNNING');
    const {proxies}=await request('/proxies');
    const leaf=resolveLeaf(proxies??{});
    if(!leaf)throw serviceError('NODE_UNAVAILABLE');
    const sites=await Promise.all(siteTargets.map(async target=>{
      try{
        const result=await request(`/proxies/${encodeURIComponent(leaf)}/delay?url=${encodeURIComponent(target.url)}&timeout=5000`,{timeoutMs:6000});
        const delay=Number.isFinite(result?.delay)&&result.delay>0?result.delay:null;
        return {...target,delay,ok:delay!==null,kind:delay===null?'node':null,code:null,
          reason:delay===null?'节点不通，延迟测试失败':''};
      }catch(error){
        // 「节点不通」和「控制器超时」是两种结论，都渲染成超时页面就没法判断该查哪边。
        // kind 是这次测试的结论类别；code 只在控制器侧用统一错误码。
        const timeout=error?.code==='CONTROLLER_TIMEOUT'||error?.name==='TimeoutError';
        return {...target,delay:null,ok:false,kind:timeout?'controller':'node',
          code:timeout?'CONTROLLER_TIMEOUT':null,
          reason:timeout?'控制器超时，未取到节点延迟':'节点不通，延迟测试失败'};
      }
    }));
    return {node:leaf,sites};
  }
  // 节点测速：对当前组的每个节点打一次控制器的 delay 接口，结果按节点名回给页面。
  //
  // 两条硬约束（2.1.8）：宿主给一次 RPC 只有 15 秒（plugin_rpc_timeout），控制器请求
  // 自己也带 AbortSignal 超时。原先是「并发 6 + 每个节点 5 秒」，40 个节点就要 30 秒
  // 以上——整次调用被宿主掐断，页面只剩「未识别错误」，插件还会被记成「响应超时」。
  // 现在自己带预算：并发 8、单节点 2.5 秒、整段 9 秒封顶；来不及测的节点如实标成
  // untested，而不是把整次调用拖死。
  const delayUrl='https://www.gstatic.com/generate_204';
  const TEST_CONCURRENCY=8,DELAY_TIMEOUT_MS=2500,TEST_BUDGET_MS=9000;
  async function nodeTest({group:groupName}={}) {
    if(!alive())throw serviceError('KERNEL_NOT_RUNNING');
    const state=await view();
    const target=groupName?state.groups.find(row=>row.name===groupName):state.groups[0];
    if(!target)throw serviceError('NODE_UNAVAILABLE');
    const names=target.nodes.filter(node=>node.type!=='group').slice(0,200).map(node=>node.name);
    const delays=[];
    const deadline=Date.now()+TEST_BUDGET_MS;
    let cursor=0;
    const worker=async()=>{
      for(;;){
        const index=cursor++;if(index>=names.length)return;
        if(Date.now()>deadline)return;
        const name=names[index];
        try{
          const result=await request(`/proxies/${encodeURIComponent(name)}/delay?url=${encodeURIComponent(delayUrl)}&timeout=${DELAY_TIMEOUT_MS}`,
            {timeoutMs:DELAY_TIMEOUT_MS+500});
          delays.push({name,delay:Number.isFinite(result?.delay)&&result.delay>0?result.delay:null});
        }catch{delays.push({name,delay:null})}
      }
    };
    await Promise.all(Array.from({length:Math.min(TEST_CONCURRENCY,names.length)},worker));
    const done=new Set(delays.map(row=>row.name));
    return {group:target.name,tested:delays.length,delays,budgetMs:TEST_BUDGET_MS,
      untested:names.filter(name=>!done.has(name)).length};
  }
  // 运行中切换 TUN 必须重启内核：TUN 由 SYSTEM 服务托管，普通模式由本进程 spawn，
  // 两者写同一个控制器端口，不能并存。整段「停 → 写配置 → 按新设置起」放到后台跑，
  // RPC 立刻返回：一次 TUN 启动要等 SYSTEM 服务拉起内核，很容易超过单次 RPC 的 15 秒。
  async function tunSwitch({enable}={}) {
    if(typeof enable!=='boolean')throw serviceError('TUN_SWITCH_INVALID');
    if(!runtime.tun)throw serviceError('TUN_UNSUPPORTED');
    if(tunBusy)return view({controller:false});
    const old=await config();
    if(enable){
      const info=await runtime.tun.status();
      if(!info.installed)throw serviceError('TUN_NOT_INSTALLED');
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
  return {view,save,tunSwitch,subscriptionSave,subscriptionToggle,subscriptionRemove,start,stop,shutdown,select,mode,reload,proxy,details,nodeTest,
    tunService,installTunService,uninstallTunService,ipInfo,siteTest};
}
