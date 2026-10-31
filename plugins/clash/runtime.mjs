import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {createServer,connect as netConnect} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {writeFile,rename,readFile} from 'node:fs/promises';
import {createSubscriptionRuntime,fileProvider,subscriptionPath,checkExecutable} from './subscriptions.mjs';
export function createProxyLease({storage,adapter}){
 let active=false;
 const same=(a,b)=>['ProxyEnable','ProxyServer','ProxyOverride'].every(k=>a[k]===b[k]);
 async function restore(){const raw=await storage.read('config','system-proxy.json');if(!raw){active=false;return}const record=JSON.parse(raw);if(record.schema!==1||!record.previous||!record.owned)throw Error('系统代理恢复记录无效');if(same(await adapter.read(),record.owned))await adapter.write(record.previous);await storage.write('config','system-proxy.json','');active=false}
 async function enable(port){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('代理端口无效');
  if(active)return;await restore();const previous=await adapter.read();const owned={ProxyEnable:1,ProxyServer:`127.0.0.1:${port}`,ProxyOverride:'<local>'};
  await storage.write('config','system-proxy.json',JSON.stringify({schema:1,previous,owned}));
  try{await adapter.write(owned);active=true}catch(error){await restore();throw error}
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
          if((size+=value.byteLength)>32*1024*1024)throw Error('geo 数据超过限制');chunks.push(value)}}
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
  const runtimePath=join(context.dataDirectory,'tmp','mihomo-runtime.json');
  await context.storage.write('tmp','mihomo-runtime.json',JSON.stringify(kernelConfig({...c,dataDirectory:context.dataDirectory,geo:geoReady})));

  // TUN 交给已安装的 SYSTEM 服务托管：本进程不再 spawn 内核，只写 job.ini。
  if(c.tun?.enable){
   if(!tun){const error=Error('当前环境不支持 TUN 服务模式');error.code='TUN_UNAVAILABLE';throw error}
   const info=await tun.status();
   if(!info.installed){const error=Error('开启 TUN 前请先在设置里安装 TUN 服务');error.code='TUN_SERVICE_MISSING';throw error}
   if(info.kernel&&info.kernel.toLowerCase()!==c.kernel.toLowerCase()){
    const error=Error('已安装的 TUN 服务绑定了另一个内核，请重新安装服务');error.code='TUN_KERNEL_MISMATCH';throw error}
   viaService=true;
   try{
    const applied=await tun.enable({config:runtimePath,home:context.dataDirectory});
    if(!applied)throw Error('TUN 服务未确认启动，请查看服务日志');
    if(!(await waitController(c,15000)))throw Error('TUN 内核未在时限内就绪，请检查服务日志与端口');
    return {alive:()=>viaService,stop:async()=>{await tun.disable().catch(()=>{});viaService=false}};
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
   child.once('exit',()=>{void proxy.restore().catch(()=>{})});return {alive,stop};
  }catch(error){await stop();throw error}
 }
 return {start,proxy,tun,proxiedGet,
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
