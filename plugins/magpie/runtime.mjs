import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {randomBytes} from 'node:crypto';
import {embedProxy,freePort} from './embed-proxy.mjs';
import {available,startChild} from '../../shared/child.mjs';
import {magpieEnvironment} from './environment.mjs';
import {preparePortableRuntime} from './portable-runtime.mjs';
import {gatewayAddr,gatewayHost,gatewayPortCandidates,readMagpiePrefs} from './network.mjs';
import {registerSeedPage,syncPageDirectory} from './page-seed.mjs';
import {ensurePreinstallState,preinstallEnabled,seedPreinstalled} from './preinstall.mjs';
import {serviceError} from '../../shared/errors.mjs';

// 只有「换个时机就可能成功」的失败值得重试：端口被短暂占住、复制被文件占用、
// 子进程刚起来就退出。路径错误、资料损坏、副本校验失败，再试也不会变。
const TRANSIENT_CODES=new Set(['PORT_IN_USE','PORT_BIND_DENIED','FILE_BUSY','PERMISSION_DENIED',
 'RUNTIME_COPY_FAILED','GATEWAY_ERROR','UNKNOWN_ERROR','SPAWN_FAILED','EARLY_EXIT','READY_TIMEOUT']);
export function isRetryableFailure(code){return code==null||TRANSIENT_CODES.has(code)}

// 适配层已经出过的码原样放行；别的一律是原生码（Windows 上 spawn 会同步抛 UNKNOWN），
// 换成 SPAWN_FAILED 的文案，原生 code 挂 cause 留给失败日志。
const ADAPTER_CODES=new Set(['PORT_IN_USE','PORT_BIND_DENIED','FILE_BUSY','PERMISSION_DENIED',
 'RUNTIME_COPY_FAILED','GATEWAY_ERROR','UNKNOWN_ERROR','EXECUTABLE_MISSING','EXECUTABLE_INVALID',
 'DATA_UNWRITABLE','DATA_MIGRATION_FAILED','RUNTIME_PREPARE_FAILED','RUNTIME_INTEGRITY',
 'SETTINGS_INVALID','SPAWN_FAILED','EARLY_EXIT','READY_TIMEOUT','INVALID_READY_URL','STOP_FAILED']);
function spawnFailure(error){
 if(error?.name==='AbortError'||ADAPTER_CODES.has(error?.code))return error;
 const failure=serviceError('SPAWN_FAILED');failure.cause=error;return failure;
}

// 老配置会把插件包内的绝对路径写进 gateway.json；包升级后该目录消失，需改指当前包。
// 只认宿主 packages/fish.magpie/<版本>/<摘要>/ 这一种布局，用户自选路径不动。
export function packagedExecutablePath(executable){
 return typeof executable==='string'&&/\/packages\/fish\.magpie\/[^/]+\//i.test(executable.replaceAll('\\','/'));
}

// 失败落盘：插件数据目录下 gateway-error.log 追加一行，含原始 code、阶段、端口、时间。
// 只有落盘的文件才熬得过插件进程重启，内存里的 gateway.error 不行。写日志本身失败
// 不能盖掉原错误，所以这里的 IO 异常全部吞掉。
export async function recordGatewayError(root,{error,phase,port}={}){
 if(typeof root!=='string'||!path.isAbsolute(root))return '';
 const entry={time:new Date().toISOString(),
  code:typeof error?.code==='string'?error.code:'UNKNOWN_ERROR',
  nativeCode:typeof error?.cause?.code==='string'?error.cause.code:null,
  phase:typeof phase==='string'?phase:null,
  port:Number.isInteger(port)?port:null,
  message:String(error?.message??'').slice(0,300)};
 const line=`${JSON.stringify(entry)}\n`;
 try{await fs.mkdir(root,{recursive:true});await fs.appendFile(path.join(root,'gateway-error.log'),line)}catch{}
 return line;
}

// gateway 停在 error 时按递增间隔重试；用户停止或已恢复就停手，用尽后定住并保留原因。
export async function startWithBackoff(service,{attempts=3,delays=[600,1500],shouldRetry=()=>true}={}){
 let view=await service.start();
 for(let attempt=0;view?.state==='error'&&attempt<attempts-1;attempt++){
  if(!shouldRetry(view,attempt))break;
  await delay(delays[Math.min(attempt,delays.length-1)]||0);
  const current=service.view();
  if(current?.state!=='error'){view=current;break}
  view=await service.start();
 }
 return view;
}

// gatewayPortFor 挑一个**每次启动都一样**的网关端口（#30）：按适配层保存的端口、
// Magpie 里设过的端口、默认端口的顺序试，每个再试紧跟的两个。首选被别的程序占住
// 才回退，回退值由调用方写回配置，下次启动直接复用它、不会又跳回首选。
// 以前只在局域网共享时才走这条，默认分支 `freePort()` 每次随机挑一个，端口每次
// 启动都变，按端口导入的客户端一重启就失效。
// 返回 {port, fellBack}：port 为 0 表示候选全被占，交给上层报端口冲突。
async function gatewayPortFor({configured,prefs,port,upstreamPort}){
 const taken=[port,upstreamPort];
 const [first]=gatewayPortCandidates({configured,prefs,taken});
 for(const base of gatewayPortCandidates({configured,prefs,taken})){
  for(let candidate=base;candidate<=Math.min(base+2,65535);candidate++){
   if(taken.includes(candidate))continue;
   try{await available(candidate);return {port:candidate,fellBack:candidate!==first}}catch{}
  }
 }
 return {port:0,fellBack:false};
}
export function createRuntime(context){
 return {async start({executable,port,gatewayPort,signal,onPhase=()=>{}}){
  // 阶段名只用于失败记录与页面进度，内部记住最后一个是哪一段。
  let phase=null;const track=value=>{phase=value;onPhase(value)};
  try{
   signal?.throwIfAborted();
   if(!path.isAbsolute(context.dataDirectory))throw Error('缺少插件数据目录');
   const root=context.dataDirectory,credentials=path.join(root,'credentials'),cache=path.join(root,'tmp');
   try{await fs.mkdir(credentials,{recursive:true});await fs.mkdir(cache,{recursive:true})}catch{throw serviceError('DATA_UNWRITABLE')}
   // 上游便携模式优先于 XDG。插件只运行不附带便携目录的已验证副本。
   for(const name of ['data','.portable']){try{await fs.stat(path.join(path.dirname(executable),name));throw Error('服务旁存在便携数据，请使用独立服务副本')}catch(error){if(error.code!=='ENOENT')throw error}}
   let stat;try{stat=await fs.stat(executable)}catch(error){if(error.code==='ENOENT')throw serviceError('EXECUTABLE_MISSING');throw error}
   if(!stat.isFile())throw serviceError('EXECUTABLE_INVALID');
   let key=await context.secrets.read('keys','web-key');
   if(!key){key=randomBytes(32).toString('hex');await context.secrets.write('keys','web-key',key)}
   const url=`http://127.0.0.1:${port}/?k=${encodeURIComponent(key)}`;
   let upstreamPort;do{upstreamPort=await freePort()}while(upstreamPort===port);
   const upstreamUrl=`http://127.0.0.1:${upstreamPort}/?k=${encodeURIComponent(key)}`;
   // 端口先占后拉：代理在复制运行时之前就绑住服务端口（冲突转 PORT_IN_USE，短重试）。
   // 之后几十秒的复制、页面同步、就绪等待期间端口一直在手，别的实例抢不走，也就
   // 不会出现「magpie 已经拉起来，最后一步绑端口失败再被回滚」。
   const proxy=await embedProxy({port,upstreamPort});
   let portable,child;
   try{
    signal?.throwIfAborted();
    // web --addr 仅设置管理页；模型网关需独立地址。
    portable=await preparePortableRuntime(executable,credentials,{signal,onPhase:track});
    // 共享时绑全网卡：MAGPIE_ADDR 一旦钉住回环，Magpie 自己不会放开绑定，局域网
    // 共享开关就不生效（internal/gateway/lan.go 的 pinnedHost / LANURLs）。
    const prefs=await readMagpiePrefs(portable.data);
    // #30：不论是否共享都走同一套固定候选——共享只改绑定范围，不改端口值。
    const listening=await gatewayPortFor({configured:gatewayPort,prefs,port,upstreamPort});
    const listeningPort=listening.port;
    if(!listeningPort)throw serviceError('PORT_IN_USE');
    const gateway=gatewayAddr(gatewayHost(prefs.lan),listeningPort);
    // 出厂预置的页面插件随 Dock 内置在 page-plugins/ 下。启动前逐个同步到
    // <data>/plugins/<name>，并让 plugins.json 只用这个稳定路径引用：升级之后路径
    // 不变，页面才跟着换版本；旧包目录被清理也不会 404。
    // 没有内置目录（普通 magpie）时不碰清单，仍由原生按包名装 npm 上的同名包。
    const bundledPages=path.join(path.dirname(fileURLToPath(import.meta.url)),'page-plugins');
    try{
     for(const name of ['page-checkin','page-relay-probe']){
      const seeded=await syncPageDirectory({source:path.join(bundledPages,name),data:portable.data,name,onPhase:track,signal});
      if(seeded)await registerSeedPage({data:portable.data,name,directory:seeded.directory,onPhase:track,signal});
     }
    }catch(error){if(error.name==='AbortError')throw error;throw serviceError('DATA_MIGRATION_FAILED')}
    // 出厂预装的社区供应商插件按「当前基线 − 已登记」增量补登记（#71）：基线新增
    // 的（2.1.4 才进来的 Meoo）升级后自动补上；用户删过的、不在基线里的不会被加回
    // 来。首次由 magpie 自己的更新循环按 spec 装进 <data>/plugins。登记失败不拦
    // 启动——它是锦上添花，写不进去就下次再试，用户的服务照常起来。
    //
    // 状态文件可能缺：清过、写到一半，或者在还没有这份文件的 2.1.3 之前就登记过。
    // 缺了补一次（registered/added 取本次登记的实际结果），host 的 brand:status 才
    // 有「正在准备 N 个供应商插件」可算（#16 的后端一半；N 由 Go 侧按真实安装算）。
    if(preinstallEnabled())try{
     const seeded=await seedPreinstalled({data:portable.data,onPhase:track,signal});
     await ensurePreinstallState({data:portable.data,seeded});
    }catch(error){if(error.name==='AbortError')throw error}
    track('start-process');
    try{
     child=await startChild({executable:portable.executable,args:['web','--addr',`127.0.0.1:${upstreamPort}`,'--no-open'],cwd:root,signal,
      env:{...magpieEnvironment({cache,key}),MAGPIE_ADDR:gateway},
      ready:output=>output.includes(`magpie web on http://127.0.0.1:${upstreamPort}/`),
      probe:async()=>{try{const response=await fetch(upstreamUrl,{redirect:'manual',signal:AbortSignal.timeout(1500)});return response.status===303&&response.headers.get('location')==='/'&&response.headers.has('set-cookie')}catch{return false}}
     });
    }catch(error){throw spawnFailure(error)}
    signal?.throwIfAborted();
   }catch(error){
    // 启动失败要把已占住的端口和已拉起的子进程一起还回去，不留半套。
    try{await proxy.stop()}catch{}
    if(child)try{await child.stop()}catch{}
    throw error;
   }
   // #30：把实际监听的网关端口回给上层，它写回配置后下次启动就能复用同一个端口。
   return {alive:child.alive,url,gatewayPort:listeningPort,gatewayPortFellBack:listening.fellBack,runtime:{executable:portable.executable,sha256:portable.sha256},async stop(){try{await proxy.stop()}finally{await child.stop()}}};
  }catch(error){
   if(error?.name!=='AbortError')await recordGatewayError(context.dataDirectory,{error,phase,port});
   throw error;
  }
 }};
}
