import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {createServer,connect as netConnect} from 'node:net';
import {fileURLToPath} from 'node:url';
import {connect as tlsConnect} from 'node:tls';
import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {writeFile,rename,readFile,unlink} from 'node:fs/promises';
import {createSubscriptionRuntime,fileProvider,subscriptionPath,checkExecutable} from './subscriptions.mjs';
// 校验错误统一挂码：文案在 shared/errors.mjs 按 code 查表，页面不再做中文正则匹配。
import {serviceError} from '../../shared/errors.mjs';
const coded=(code,message,extra)=>{
 const error=Error(message);
 error.code=code;
 if(extra)Object.assign(error,{cause:extra});
 return error;
};
const processAlive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
// 结束一个不属于本实例的进程：先 SIGTERM，等不到退出再 SIGKILL。
// 返回 false 表示「杀不掉」——调用方据此报 KERNEL_STOP_UNCONFIRMED，而不是假装成功。
export async function killProcess(pid,{timeoutMs=2000,step=80}={}){
 if(!Number.isInteger(pid)||pid<=0)return true;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 if(!processAlive(pid))return true;
 try{process.kill(pid,'SIGTERM')}catch{}
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){await wait(step);if(!processAlive(pid))return true}
 try{process.kill(pid,'SIGKILL')}catch{}
 for(let i=0;i<5;i++){await wait(step);if(!processAlive(pid))return true}
 return !processAlive(pid);
}
export {processAlive};
export function createProxyLease({storage,adapter}){
 let active=false;
 const same=(a,b)=>['ProxyEnable','ProxyServer','ProxyOverride'].every(k=>a[k]===b[k]);
 async function discard(){try{await storage.write('config','system-proxy.json','')}catch{/* 丢不掉也不影响停止 */}active=false}
 // 「记录对不上」不是致命错误：别的程序（TUN、其他代理）可能改过注册表。
 // 这类情况丢租约 + 带 code 返回，由上层降级成警告，别再让每次 stop 都失败。
 async function restore(port) {
  let raw;
  try{raw=await storage.read('config','system-proxy.json')}
  catch(error){throw coded('PROXY_REGISTRY_READ_FAILED','读取系统代理恢复记录失败',error)}
  if(!raw){
   active=false;
   // 没有租约却还指着我们：Dock 被杀、租约被清、或上次恢复失败留下的死代理。
   // 用户看到的就是「关掉内核，本机直接没网」——这里直接关掉系统代理。
   if(Number.isInteger(port)&&port>=1024&&port<=65535){
    try{
     const current=await adapter.read();
     if(current?.ProxyServer===`127.0.0.1:${port}`&&Number(current.ProxyEnable)===1){
      await adapter.write({...current,ProxyEnable:0});
      return {act:'disabled-stale'};
     }
    }catch{/* 读不到就保持原样，交给下次自愈 */}
   }
   return {act:'nothing'};
  }
  let record=null;
  try{record=JSON.parse(raw)}catch{/* 坏 JSON 与坏结构同样处理 */}
  if(!record||record.schema!==1||!record.previous||!record.owned){
   await discard();
   throw coded('PROXY_RESTORE_RECORD_INVALID','系统代理恢复记录无效，已丢弃');
  }
  let current;
  try{current=await adapter.read()}
  catch(error){throw coded('PROXY_REGISTRY_READ_FAILED','读取当前系统代理设置失败',error)}
  try{
   const restored=same(current,record.owned);
   if(restored)await adapter.write(record.previous);
   await storage.write('config','system-proxy.json','');
   active=false;
   return {act:restored?'restore':'discard'};
  }catch(error){throw coded('PROXY_REGISTRY_WRITE_FAILED','恢复系统代理失败，请检查注册表写入权限',error)}
 }
 async function enable(port, ownerPid){
  if(!Number.isInteger(port)||port<1024||port>65535)throw serviceError('PROXY_PORT_INVALID');
  if(active)return;
  // 记录无效等价于「没有可恢复的租约」，不该拦住接管。
  try{await restore()}catch(error){if(error?.code!=='PROXY_RESTORE_RECORD_INVALID')throw error}
  let previous;
  try{previous=await adapter.read()}
  catch(error){throw coded('PROXY_REGISTRY_READ_FAILED','读取当前系统代理设置失败',error)}
  const owned={ProxyEnable:1,ProxyServer:`127.0.0.1:${port}`,ProxyOverride:'<local>'};
  // owner 是写这份租约的插件进程：看门狗据此判断「这条记录还是不是自己那一次写的」，
  // 新实例覆盖租约之后，老看门狗不许再动注册表。
  const owner=Number.isInteger(ownerPid)&&ownerPid>0?{pid:ownerPid,at:Date.now()}:undefined;
  await storage.write('config','system-proxy.json',JSON.stringify({schema:1,previous,owned,...(owner?{owner}:{})}));
  try{await adapter.write(owned);active=true}
  catch(error){await restore().catch(()=>{});throw coded('PROXY_REGISTRY_WRITE_FAILED','开启系统代理失败，请检查注册表写入权限',error)}
 }
 // recoverStale 是启动自愈：上一次 Dock 被强杀时留下的租约，只要注册表里还是我们写
 // 的那一份就立刻还原——否则用户下次开机没有代理进程，网却全指向 127.0.0.1。
 // 与 restore() 的区别：不看本实例是否 active，只看磁盘上有没有残留记录。
 async function recoverStale(){
  let raw;
  try{raw=await storage.read('config','system-proxy.json')}catch{return {act:'unreadable'}}
  if(!raw)return {act:'nothing'};
  try{return await restore()}catch(error){
   if(error?.code==='PROXY_RESTORE_RECORD_INVALID')return {act:'discard'};
   throw error;
  }
 }
 return {enable,restore,recoverStale,active:()=>active};
}
// 普通模式启动前是否需要让 TUN 服务交出内核：服务已装（job.ini enabled=1）且服务正在
// 跑，说明内核此刻挂在 SYSTEM 服务名下，占着同一个控制器端口。
export function tunHandoverNeeded(info){
 return !!(info&&info.enabled&&info.state==='running');
}
export function kernelConfig({mixedPort,controllerPort,secret,subscriptions=[],dataDirectory,tun,geo=false}){
 const value={'mixed-port':mixedPort,'external-controller':`127.0.0.1:${controllerPort}`,secret,'allow-lan':false,mode:'rule','log-level':'warning','unified-delay':true,'tcp-concurrent':true,profile:{'store-selected':true}};
 const enabled=subscriptions.filter(s=>s.enabled!==false);
 if(enabled.length){
  value['proxy-providers']=Object.fromEntries(enabled.map(s=>[s.id,fileProvider(s.id,subscriptionPath(dataDirectory,s.id))]));
  // Verge 风格组树（内化为 FISH Dock 自己的命名与分流）：
  // 主组可手选也可自动；分类组默认直连还是走代理按国内使用习惯排序；
  // 规则用 geosite 分流国内直连 + 漏网之鱼兜底。
  const MAIN='🚀 节点选择',AUTO='♻️ 自动选择',DIRECT_GROUP='🎯 全球直连',FINAL='🐟 漏网之鱼';
  const category=(name,first)=>({name,type:'select',proxies:[first]});
  value['proxy-groups']=[
   {name:MAIN,type:'select',proxies:[AUTO,'DIRECT'],use:enabled.map(s=>s.id)},
   {name:AUTO,type:'url-test',url:'https://www.gstatic.com/generate_204',interval:300,tolerance:50,use:enabled.map(s=>s.id)},
   {name:'🛑 广告拦截',type:'select',proxies:['REJECT','DIRECT',MAIN]},
   category('📲 Telegram',MAIN),
   category('🤖 AI 服务',MAIN),
   {name:'Ⓜ️ 微软服务',type:'select',proxies:['DIRECT',MAIN]},
   {name:'🍎 苹果服务',type:'select',proxies:['DIRECT',MAIN]},
   {name:DIRECT_GROUP,type:'select',proxies:['DIRECT',MAIN]},
   {name:FINAL,type:'select',proxies:[MAIN,'DIRECT']}
  ];
  if(geo){
   // 有 geo 数据时按类别分流（与 Clash Verge 同构）。
   value.rules=[
    'GEOSITE,category-ads-all,🛑 广告拦截',
    'GEOSITE,telegram,📲 Telegram',
    'GEOSITE,openai,🤖 AI 服务',
    'GEOSITE,bing,🤖 AI 服务',
    'GEOSITE,microsoft,Ⓜ️ 微软服务',
    'GEOSITE,apple,🍎 苹果服务',
    'GEOIP,telegram,📲 Telegram,no-resolve',
    'GEOSITE,cn,🎯 全球直连',
    'GEOIP,private,🎯 全球直连,no-resolve',
    'GEOIP,cn,🎯 全球直连,no-resolve',
    'MATCH,🐟 漏网之鱼'
   ];
   value['geodata-mode']=true;
   // geo-auto-update 关掉（2.1.8）：geo 文件随包发布、启动时由 ensureGeoData 落到内核目录，
   // 不需要内核自己去 GitHub 下。开着它时，缓存判定过期会让内核在「启动」或「热重载」那一刻
   // 去下载 GeoSite/GeoIP——连不上的机器直接 Parse config error 退出，或把重载拖过超时。
   // 文件缺失时内核仍会自己尝试下载（那是它自己的兜底），我们只不再主动催它。
   value['geo-auto-update']=false;
   value['geo-update-interval']=168;
   value['geo-download-urls']=['https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/','https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/'];
  }else{
   // 无 geo 数据（离线/下载失败）：不引用 GEOSITE/GEOIP，保证内核能启动；
   // 仍保留 .cn 域名与内网直连，其余走漏网之鱼。
   value.rules=[
    'DOMAIN-SUFFIX,cn,🎯 全球直连',
    'IP-CIDR,127.0.0.0/8,🎯 全球直连,no-resolve',
    'IP-CIDR,10.0.0.0/8,🎯 全球直连,no-resolve',
    'IP-CIDR,172.16.0.0/12,🎯 全球直连,no-resolve',
    'IP-CIDR,192.168.0.0/16,🎯 全球直连,no-resolve',
    'IP-CIDR,169.254.0.0/16,🎯 全球直连,no-resolve',
    'IP-CIDR6,fe80::/10,🎯 全球直连,no-resolve',
    'MATCH,🐟 漏网之鱼'
   ];
  }
 }else value.rules=['MATCH,DIRECT'];
 if(tun?.enable){
  value.tun={enable:true,stack:['mixed','gvisor','system'].includes(tun.stack)?tun.stack:'mixed',
   'dns-hijack':['any:53'],'auto-route':true,'auto-detect-interface':true};
  value.dns={enable:true,ipv6:false,'enhanced-mode':'fake-ip','fake-ip-range':'198.18.0.1/16',nameserver:['223.5.5.5','119.29.29.29']};
 }
 return value;
}
// geo 数据就位：geodata 模式首启需要 GeoSite.dat/GeoIP.dat。
// 优先从插件包内（内核同目录，随包分发）复制——完全离线、无网络依赖；
// 包内没有时才回退到网络下载（跟随重定向、双源×2 次重试）。
// 全失败返回 false，调用方据此降级到不依赖 geo 的规则，保证内核能启动。
const GEO_SOURCES=['https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/','https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/'];
export const GEO_FILES=Object.freeze(['GeoSite.dat','GeoIP.dat']);
export async function ensureGeoData(home,{bundleDir,fetch:fetcher=globalThis.fetch,signal,timeoutMs=30000}={}){
  const missing=GEO_FILES.filter(name=>!existsSync(join(home,name)));
  let failed=0;
  for(const name of missing){
    let done=false;
    // 1) 包内随附文件（最快、离线可用）。
    const bundled=bundleDir&&join(bundleDir,name);
    if(bundled&&existsSync(bundled)){
      try{
        const bytes=await readFile(bundled);
        if(bytes.length>1024*1024){
          const target=join(home,name),candidate=`${target}.copy-${process.pid}`;
          await writeFile(candidate,bytes);await rename(candidate,target);done=true;
        }
      }catch{/* 复制失败则回退网络 */}
    }
    // 2) 网络兜底：每源最多 2 次（境外链路偶发 ECONNRESET 很常见）。
    if(!done)for(const base of GEO_SOURCES)for(let attempt=0;attempt<2&&!done;attempt++){
      signal?.throwIfAborted();
      try{
        const response=await fetcher(base+name,{redirect:'follow',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
        if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});continue}
        const reader=response.body.getReader();const chunks=[];let size=0;
        try{for(;;){signal?.throwIfAborted();const{done,value}=await reader.read();if(done)break;
          if((size+=value.byteLength)>32*1024*1024)throw serviceError('GEO_DATA_TOO_LARGE');chunks.push(value)}}
        finally{await reader.cancel().catch(()=>{})}
        if(!size)continue;
        const target=join(home,name),candidate=`${target}.download-${process.pid}`;
        await writeFile(candidate,Buffer.concat(chunks));
        await rename(candidate,target);done=true;break;
      }catch{continue}
    }
    // 单个文件拿不到继续下一个；至少一个缺失就返回 false。
    if(!done)failed++;
  }
  return failed===0;
}
async function free(port){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',()=>reject(Error('端口已占用，请在配置中修改')));server.listen(port,'127.0.0.1',resolve)});await new Promise(resolve=>server.close(resolve))}
// 内核真正读取的配置文件名：start 与运行中热切换共用同一份生成逻辑，不允许两处各拼一遍。
export const RUNTIME_CONFIG=Object.freeze('mihomo-runtime.json');
// 热切换先写到候选文件，内核确认换上了才 rename 成正式配置：失败时正式配置一个字节都没动。
const CANDIDATE_CONFIG=Object.freeze('mihomo-runtime.next.json');
export function createRuntime(context){
 const adapter={async read(){return powershell('read')},async write(values){await powershell('write',values)}};
 const proxy=createProxyLease({storage:context.storage,adapter});
 const tun=context.tun||null;
 // 启动自愈只跑一次，且 start() 会先等它：上一次 Dock 被强杀留下的租约要先还原，
 // 否则可能与随后的「启用系统代理」抢注册表（先写新租约、再被旧记录还原掉）。
 let recovery=null;
 function recoverStaleOnce(){
  return recovery??=proxy.recoverStale().then(result=>{
   if(result?.act==='restore')console.error('[clash] 已还原上次意外退出遗留的系统代理');
   return result;
  }).catch(error=>{
   console.error('[clash] 系统代理自愈失败：'+(error?.code??'UNKNOWN')+' '+(error?.message??''));
   return {act:'failed'};
  });
 }
 let viaService=false;
 async function waitController(c,limit=8000){
  const deadline=Date.now()+limit;
  while(Date.now()<deadline){
   c.signal?.throwIfAborted();
   try{const response=await fetch(`http://127.0.0.1:${c.controllerPort}/version`,{headers:{Authorization:`Bearer ${c.secret}`},signal:AbortSignal.timeout(500),redirect:'error'});if(response.ok&&typeof(await response.json()).version==='string')return true}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  return false;
 }
 // 内核配置生成 + 落盘：start 与「运行中热切换」共用这一处（否则两处各拼一遍必然漂移）。
 // 返回配置文件绝对路径（内核 -f 读的就是它，热切换要让控制器读同一个目录）。
 async function writeConfig({settings,subscriptions=[],secret,dataDirectory=context.dataDirectory,geo=false,name=RUNTIME_CONFIG}={}){
  const value=kernelConfig({...settings,secret,subscriptions,dataDirectory,geo});
  await context.storage.write('tmp',name,JSON.stringify(value));
  return join(dataDirectory,'tmp',name);
 }
 // geo 数据是否就位：热切换不重复下载，按内核实际的工作目录（TUN 用数据根，普通模式用 config）判断。
 function geoPresent(settings){
  const home=settings?.tun?.enable?context.dataDirectory:join(context.dataDirectory,'config');
  return GEO_FILES.every(name=>existsSync(join(home,name)));
 }
 // 运行中换启用集：写候选文件 → 让内核就地重载（apply 里发 PUT /configs）→ 成功才转正。
 // 任何一步失败都删掉候选文件、正式配置一个字节都没动；启用集的回滚由 service 负责。
 async function swapConfig({settings,subscriptions=[],secret,apply}){
  const geo=geoPresent(settings);
  const candidate=await writeConfig({settings,subscriptions,secret,geo,name:CANDIDATE_CONFIG});
  try{await apply(candidate)}
  catch(error){await unlink(candidate).catch(()=>{});throw error}
  try{await rename(candidate,join(context.dataDirectory,'tmp',RUNTIME_CONFIG))}
  catch{
   // 转正失败不影响已经在跑的内核：内容直接再写一份正式配置；
   // 候选文件同样按「失败不留痕」清掉（与上面 apply 失败分支保持一致）。
   await unlink(candidate).catch(()=>{});
   await writeConfig({settings,subscriptions,secret,geo});
  }
 }
 async function start(c){
  c.signal?.throwIfAborted();
  // 先把上一次的租约收干净（Dock 被强杀时没机会还原），再谈启动。
  await recoverStaleOnce();
  await checkExecutable(c.kernel);await free(c.mixedPort);await free(c.controllerPort);
  for(const category of ['tmp','config','credentials'])await mkdir(join(context.dataDirectory,category),{recursive:true});
  // 内核 -d 目录：TUN 服务用数据根，普通模式用 config 子目录。
  const kernelHome=c.tun?.enable?context.dataDirectory:join(context.dataDirectory,'config');
  // geo 数据优先取包内随附文件（插件 service 目录，后端注入 geoDir），离线可用；
  // 未注入时退回内核同目录；都拿不到则降级为无 geo 规则。
  const hasSubscriptions=!!c.subscriptions?.some(s=>s.enabled!==false);
  const geoReady=hasSubscriptions
    ?await ensureGeoData(kernelHome,{bundleDir:context.geoDir||dirname(c.kernel),signal:c.signal}).catch(()=>false)
    :false;
  const runtimePath=await writeConfig({settings:c,subscriptions:c.subscriptions??[],secret:c.secret,geo:geoReady});

  // TUN 交给已安装的 SYSTEM 服务托管：本进程不再 spawn 内核，只写 job.ini。
  if(c.tun?.enable){
   if(!tun)throw serviceError('TUN_UNSUPPORTED')
   const info=await tun.status();
   if(!info.installed)throw serviceError('TUN_NOT_INSTALLED')
   if(info.kernel&&info.kernel.toLowerCase()!==c.kernel.toLowerCase()){
    const error=Error('已安装的 TUN 服务绑定了另一个内核，请重新安装服务');error.code='TUN_KERNEL_MISMATCH';throw error}
   viaService=true;
   try{
    const applied=await tun.enable({config:runtimePath,home:context.dataDirectory});
    if(!applied)throw serviceError('TUN_START_UNCONFIRMED');
    if(!(await waitController(c,15000)))throw serviceError('TUN_READY_TIMEOUT');
    return {alive:()=>viaService,pid:null,mode:'service',stop:async()=>{await tun.disable().catch(()=>{});viaService=false}};
   }catch(error){viaService=false;throw error}
  }

  // 普通模式：先把 TUN 服务托管的内核交出来。两者写的是同一个控制器端口，同时跑
  // 只有一个能用——先起的占着端口，另一个连不上，用户看到的就是「TUN 与普通模式
  // 只能活一个」。停不掉也继续，后面的 free() 与 waitController() 会给出确定错误。
  if(tun)try{const info=await tun.status();if(tunHandoverNeeded(info))await tun.disable()}catch{}

  const data=join(context.dataDirectory,'config');const child=spawn(c.kernel,['-d',data,'-f',runtimePath],{cwd:context.dataDirectory,windowsHide:true,stdio:['ignore','ignore','ignore'],env:{...process.env,SAFE_PATHS:join(context.dataDirectory,'credentials'),TMP:join(context.dataDirectory,'tmp'),TEMP:join(context.dataDirectory,'tmp')}});
  let failure=null;child.on('error',()=>{failure=Error('mihomo 内核启动失败')});
  const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve)});
  const alive=()=>!failure&&child.exitCode===null&&child.signalCode===null;
  let stopping,watchdogPid=0;
  function stop(){
   return stopping??=(async()=>{
    // 正常停止：先遣散看门狗，否则它会把下面这次「主动停止」当成宿主意外退出。
    if(watchdogPid)try{process.kill(watchdogPid,'SIGTERM')}catch{};
    if(alive()){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),1500);
     try{await exited}finally{clearTimeout(timer)}}
    await context.storage.write('tmp','mihomo-runtime.json','');
   })();
  }
  try{
   if(!(await waitController(c)))throw failure||Error('未在时限内就绪，请检查订阅与端口');
      // 内核没了就一定要把 TUN 收掉：虚拟网卡还在、内核已经不在，等于所有流量打进
   // 一个死内核——用户看到的就是「偶发掉线、网络回环、整机没网」。
   child.once('exit',()=>{
    void proxy.restore(c.mixedPort).catch(()=>{});
    void (async()=>{try{const info=await tun?.status();if(info?.enabled)await tun.disable()}catch{/* 服务未装或已停 */}})();
   });
   // Dock 被强杀时插件进程同时消失，上面那个 exit 回调没机会跑：另起一个看门狗
   // 盯住本进程，它一消失就还原系统代理并把内核结束掉（watchdog.mjs）。
   if(proxy.active())watchdogPid=spawnWatchdog({leasePath:join(context.dataDirectory,'config','system-proxy.json'),mihomoPid:child.pid,port:c.mixedPort});
   return {alive,stop,pid:child.pid,mode:'process',watchdogPid};
  }catch(error){await stop();throw error}
 }
 return {start,proxy,tun,proxiedGet,writeConfig,swapConfig,recoverStaleOnce,configPath:()=>join(context.dataDirectory,'tmp',RUNTIME_CONFIG),
  // 插件重载后留下的内核不由本实例 spawn，只能按 pid 结束；processAlive 供 attach 判活。
  kill:killProcess,processAlive,
  // 停止时若内核由 TUN 服务托管，一并让服务停下，避免遗留提升权限的内核。
  // 停止时一律把 TUN 收掉：服务可能还 enabled（上一次 TUN 会话留下的），内核一停
 // 它就是个「有网卡没内核」的死劫持。viaService 只用来记状态。
 tunStop:async()=>{
  if(!tun)return;
  try{const info=await tun.status();if(info?.enabled&&info.state!=='stopped')await tun.disable()}catch{/* 服务未装或已停 */}
  viaService=false;
 },
  ...createSubscriptionRuntime(context)};
}
// 使用固定脚本和 JSON stdin，配置值不会拼入 PowerShell 源码。
function powershell(action,values){
 if(process.platform!=='win32')return Promise.reject(Error('系统代理接管仅支持 Windows'));
 const source=`$ErrorActionPreference='Stop';$r=ConvertFrom-Json ([Console]::In.ReadToEnd());$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';if($r.action -eq 'read'){$v=Get-ItemProperty -LiteralPath $p;@{ProxyEnable=$v.ProxyEnable;ProxyServer=$v.ProxyServer;ProxyOverride=$v.ProxyOverride}|ConvertTo-Json -Compress}else{foreach($k in @('ProxyEnable','ProxyServer','ProxyOverride')){$v=$r.values.$k;if($null -eq $v){Remove-ItemProperty -LiteralPath $p -Name $k -ErrorAction SilentlyContinue}else{New-ItemProperty -LiteralPath $p -Name $k -Value $v -PropertyType $(if($k -eq 'ProxyEnable'){'DWord'}else{'String'}) -Force|Out-Null}};Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class FishInternet{[DllImport("wininet.dll")]public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);}';[void][FishInternet]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0);[void][FishInternet]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0);'{}'}`;
 return new Promise((resolve,reject)=>{
  const child=spawn('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});let output='';
  const timer=setTimeout(()=>{child.kill();reject(Error('系统代理操作超时'))},5000);
  child.on('error',()=>{clearTimeout(timer);reject(Error('请先安装 PowerShell 7 后使用系统代理控制'))});child.stdout.on('data',b=>{output+=b;if(output.length>16384)child.kill()});
  child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error();resolve(JSON.parse(output))}catch{reject(Error('Windows 系统代理读取或写入失败'))}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action,values}));
 });
}

// 出口 IP 查询必须走用户自己的代理口：直连查询在 TUN 或系统代理下会查到本机出口，
// 结果与实际分流不符。这里只用 Node 自带的 http/net/tls 做一次受限的 GET：
// 明文地址按绝对 URI 交给代理；https 先 CONNECT 建隧道再在隧道里握手。
// 限制响应大小与超时，不跟随跳转，不读取认证信息。
export function proxiedGet(url,{port,timeoutMs=6000,limit=64*1024}={}){
 return new Promise((resolve,reject)=>{
  let target;try{target=new URL(String(url))}catch{return reject(Error('查询地址无效'))}
  if(target.protocol!=='http:'&&target.protocol!=='https:')return reject(Error('查询地址无效'));
  if(!Number.isInteger(port)||port<1||port>65535)return reject(Error('代理端口无效'));
  const secure=target.protocol==='https:';
  const portNumber=Number(target.port||(secure?443:80));
  let settled=false;
  const timer=setTimeout(()=>fail(Error('查询超时')),timeoutMs);
  function settle(fn,value){if(settled)return;settled=true;clearTimeout(timer);fn(value)}
  const fail=error=>settle(reject,error);
  const done=value=>settle(resolve,value);
  const collect=(response,holder)=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{
    size+=chunk.byteLength;
    if(size>limit){holder.destroy();fail(Error('查询响应超过限制'));return}
    chunks.push(chunk);
   });
   response.on('end',()=>{
    if(!response.statusCode||response.statusCode<200||response.statusCode>=300)return fail(Error('查询服务返回异常状态'));
    try{done(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{fail(Error('查询结果不是有效 JSON'))}
   });
   response.on('error',fail);
  };
  if(!secure){
   const request=http.request({host:'127.0.0.1',port,method:'GET',path:target.href,
    headers:{Host:target.host,Accept:'application/json'},timeout:timeoutMs},response=>collect(response,request));
   request.on('timeout',()=>{request.destroy();fail(Error('查询超时'))});
   request.on('error',fail);request.end();
   return;
  }
  const tunnel=http.request({host:'127.0.0.1',port,method:'CONNECT',
   path:`${target.hostname}:${portNumber}`,headers:{Host:`${target.hostname}:${portNumber}`},timeout:timeoutMs});
  tunnel.on('timeout',()=>{tunnel.destroy();fail(Error('查询超时'))});
  tunnel.on('error',fail);
  tunnel.once('connect',(response,socket)=>{
   if(response.statusCode!==200){socket.destroy();return fail(Error('代理拒绝建立隧道'))}
   const secureSocket=tlsConnect({socket,servername:target.hostname});
   secureSocket.on('error',fail);
   const request=http.request({path:target.pathname+target.search,method:'GET',
    headers:{Host:target.host,Accept:'application/json'},createConnection:()=>secureSocket},inner=>collect(inner,secureSocket));
   request.on('error',fail);request.end();
  });
  tunnel.end();
 });
}
// spawnWatchdog 起一个脱离本进程的看门狗（stdio 全 ignore：宿主死了管道也断，
// 不能再依赖它）。它只认三件事：本进程 pid、租约文件、内核 pid 与混合端口。
function spawnWatchdog({leasePath,mihomoPid,port}){
 try{
  const file=fileURLToPath(new URL('./watchdog.mjs',import.meta.url));
  const child=spawn(process.execPath,[file,String(process.pid),leasePath,String(mihomoPid),String(port)],
   {detached:true,stdio:'ignore',windowsHide:true,cwd:dirname(file)});
  child.unref();
  return child.pid||0;
 }catch{return 0}
}