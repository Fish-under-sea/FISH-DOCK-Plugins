import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {createServer,connect as netConnect} from 'node:net';
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
 async function restore() {
  let raw;
  try{raw=await storage.read('config','system-proxy.json')}
  catch(error){throw coded('PROXY_REGISTRY_READ_FAILED','读取系统代理恢复记录失败',error)}
  if(!raw){active=false;return}
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
   if(same(current,record.owned))await adapter.write(record.previous);
   await storage.write('config','system-proxy.json','');
   active=false;
  }catch(error){throw coded('PROXY_REGISTRY_WRITE_FAILED','恢复系统代理失败，请检查注册表写入权限',error)}
 }
 async function enable(port){
  if(!Number.isInteger(port)||port<1024||port>65535)throw serviceError('PROXY_PORT_INVALID');
  if(active)return;
  // 记录无效等价于「没有可恢复的租约」，不该拦住接管。
  try{await restore()}catch(error){if(error?.code!=='PROXY_RESTORE_RECORD_INVALID')throw error}
  let previous;
  try{previous=await adapter.read()}
  catch(error){throw coded('PROXY_REGISTRY_READ_FAILED','读取当前系统代理设置失败',error)}
  const owned={ProxyEnable:1,ProxyServer:`127.0.0.1:${port}`,ProxyOverride:'<local>'};
  await storage.write('config','system-proxy.json',JSON.stringify({schema:1,previous,owned}));
  try{await adapter.write(owned);active=true}
  catch(error){await restore().catch(()=>{});throw coded('PROXY_REGISTRY_WRITE_FAILED','开启系统代理失败，请检查注册表写入权限',error)}
 }
 return {enable,restore,active:()=>active};
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
   value['geo-auto-update']=true;
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
  let stopping;
  function stop(){return stopping??=(async()=>{
   if(alive()){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),1500);
    try{await exited}finally{clearTimeout(timer)}}
   await context.storage.write('tmp','mihomo-runtime.json','');
  })()}
  try{
   if(!(await waitController(c)))throw failure||Error('内核未在时限内就绪，请检查订阅与端口');
   child.once('exit',()=>{void proxy.restore().catch(()=>{})});return {alive,stop,pid:child.pid,mode:'process'};
  }catch(error){await stop();throw error}
 }
 return {start,proxy,tun,proxiedGet,writeConfig,swapConfig,configPath:()=>join(context.dataDirectory,'tmp',RUNTIME_CONFIG),
  // 插件重载后留下的内核不由本实例 spawn，只能按 pid 结束；processAlive 供 attach 判活。
  kill:killProcess,processAlive,
  // 停止时若内核由 TUN 服务托管，一并让服务停下，避免遗留提升权限的内核。
  tunStop:async()=>{if(viaService&&tun){await tun.disable().catch(()=>{});viaService=false}},
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
