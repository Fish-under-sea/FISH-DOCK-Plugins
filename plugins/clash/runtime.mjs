import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {mkdir} from 'node:fs/promises';
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
export function kernelConfig({mixedPort,controllerPort,secret,subscriptions=[],dataDirectory}){
 const value={'mixed-port':mixedPort,'external-controller':`127.0.0.1:${controllerPort}`,secret,'allow-lan':false,mode:'rule','log-level':'warning','unified-delay':true,'tcp-concurrent':true,profile:{'store-selected':true}};
 const enabled=subscriptions.filter(s=>s.enabled!==false);
 if(enabled.length){value['proxy-providers']=Object.fromEntries(enabled.map(s=>[s.id,fileProvider(s.id,subscriptionPath(dataDirectory,s.id))]));value['proxy-groups']=[{name:'PROXY',type:'select',use:enabled.map(s=>s.id)}];value.rules=['MATCH,PROXY']}else value.rules=['MATCH,DIRECT'];
 return value;
}
async function free(port){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',()=>reject(Error('端口已占用，请在配置中修改')));server.listen(port,'127.0.0.1',resolve)});await new Promise(resolve=>server.close(resolve))}
export function createRuntime(context){
 const adapter={async read(){return powershell('read')},async write(values){await powershell('write',values)}};
 const proxy=createProxyLease({storage:context.storage,adapter});
 async function start(c){
  c.signal?.throwIfAborted();
  await checkExecutable(c.kernel);await free(c.mixedPort);await free(c.controllerPort);
  for(const category of ['tmp','config','credentials'])await mkdir(join(context.dataDirectory,category),{recursive:true});
  await context.storage.write('tmp','mihomo-runtime.json',JSON.stringify(kernelConfig({...c,dataDirectory:context.dataDirectory})));
  const data=join(context.dataDirectory,'config');const child=spawn(c.kernel,['-d',data,'-f',join(context.dataDirectory,'tmp','mihomo-runtime.json')],{cwd:context.dataDirectory,windowsHide:true,stdio:['ignore','ignore','ignore'],env:{...process.env,SAFE_PATHS:join(context.dataDirectory,'credentials'),TMP:join(context.dataDirectory,'tmp'),TEMP:join(context.dataDirectory,'tmp')}});
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
   const deadline=Date.now()+8000;let ready=false;
   while(Date.now()<deadline&&alive()){
    c.signal?.throwIfAborted();
    try{const response=await fetch(`http://127.0.0.1:${c.controllerPort}/version`,{headers:{Authorization:`Bearer ${c.secret}`},signal:AbortSignal.timeout(500),redirect:'error'});if(response.ok&&typeof(await response.json()).version==='string'){ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   if(!ready)throw failure||Error('内核未在时限内就绪，请检查订阅与端口');
   child.once('exit',()=>{void proxy.restore().catch(()=>{})});return {alive,stop};
  }catch(error){await stop();throw error}
 }
 return {start,proxy,...createSubscriptionRuntime(context)};
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
