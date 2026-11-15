import http from 'node:http';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {managedUpdates,managedUpdateScript} from './managed-update.mjs';
import {REVEAL_ROUTES,targetOf,sameOrigin,openInExplorer,pickedDir} from './reveal.mjs';
import {serviceError} from '../../shared/errors.mjs';
// 原生 code 一律转成适配层错误码：文案与 shared/child.mjs 的 available() 同源，
// 原生错误挂在 cause 上留证，不让 EADDRINUSE 之类漏成兜底话术。
export function portBindError(error){
 const native=error?.code;
 const mapped=native==='EADDRINUSE'?'PORT_IN_USE':native==='EACCES'||native==='EPERM'?'PORT_BIND_DENIED':'UNKNOWN_ERROR';
 const failure=serviceError(mapped);failure.cause=error;return failure;
}
function listenOnce(server,port){
 return new Promise((resolve,reject)=>{
  const settle=()=>{server.off('error',onError);server.off('listening',onListening)};
  const onError=error=>{settle();reject(error)};
  const onListening=()=>{settle();resolve()};
  server.once('error',onError);server.once('listening',onListening);server.listen(port,'127.0.0.1');
 });
}
// 只对「端口正被别人短暂占住」做短间隔重试：释放了就绑上，没释放仍按端口冲突报出。
async function bind(server,port,retries=2,delays=[120,240]){
 for(let attempt=0;;attempt++){
  try{await listenOnce(server,port);return}
  catch(error){
   const failure=portBindError(error);
   if(failure.code!=='PORT_IN_USE'||attempt>=retries)throw failure;
   await delay(delays[Math.min(attempt,delays.length-1)]||0);
  }
 }
}
// 只扩展 token 页面已知的祖先策略，其余沙箱限制原样保留。
export function pluginPagePolicy(requestPath,policy){
 if(!/^\/_magpie\/plugin\/[a-f0-9]{32}\//.test(requestPath)||typeof policy!=='string')return policy;
 return policy.replace(/(^|;)(\s*frame-ancestors\s+)'self'(\s*)(?=;|$)/gi,
  "$1$2'self' http://tauri.localhost$3");
}
// P1 兜底：宿主 dialogs 能力缺席时，spawn 一个 STA 的 PowerShell FolderBrowserDialog。
// -STA 必须；对话框没有 owner，可能出现在 Dock 窗口后面。用户取消时无输出 → 视为取消。
// 返回选中路径或 null。任何 spawn 失败/超时/无输出都按取消处理，不抛给页面。
export function defaultFallbackChoice({title='选择备份文件夹',timeoutMs=300000}={}){
 return new Promise(resolve=>{
  let done=false;
  const finish=value=>{if(done)return;done=true;resolve(value)};
  const script=`Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = ${JSON.stringify(title)}; if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`;
  let child;
  try{child=spawn('pwsh',['-NoProfile','-STA','-Command',script],{windowsHide:true,stdio:['ignore','pipe','ignore']})}
  catch{return finish(null)}
  let out='';
  const timer=setTimeout(()=>{try{child.kill()}catch{}finish(null)},timeoutMs);
  child.stdout?.on('data',chunk=>{out+=chunk});
  child.on('error',()=>{clearTimeout(timer);finish(null)});
  child.on('close',()=>{clearTimeout(timer);const trimmed=out.trim();finish(trimmed||null)});
 });
}

// openFolder：揭示（reveal）接力用的 opener（默认 openInExplorer；测试注入记录器）。
// chooseFolder：宿主 dialogs 能力（P1），返回 {dir: string|null}；缺席时用 fallbackChoice 兜底。
// fallbackChoice：STA PowerShell FolderBrowserDialog 兜底（默认见 defaultFallbackChoice），
// 返回选中路径或 null（取消）。
// home：~ 展开用的用户目录（默认 os.homedir()）。
export async function embedProxy({port,upstreamPort,key='',retries=2,delays=[120,240],
 openFolder=openInExplorer,chooseFolder=null,fallbackChoice=defaultFallbackChoice,home=os.homedir()}){
 const sockets=new Set();
 const revealEnabled=String(process.env.FISH_MAGPIE_REVEAL??'')!=='0';
 // 揭示接力的两条入口：7 条 reveal 路由，以及 library/browser/setup 的响应后处理。
 const isRevealRoute=pathname=>REVEAL_ROUTES.has(pathname);
 const isBrowserSetup=pathname=>pathname==='/api/library/browser/setup';
 const isChoose=pathname=>pathname==='/api/autobackup/choose';
 // 缓冲一次上游响应（只对白名单路由用，上限 64 KiB），返回 {status,headers,text}。
 const bufferUpstream=(req,headers,body,limit=64*1024)=>new Promise(resolve=>{
  const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers},reply=>{
   const chunks=[];let size=0;
   reply.on('data',chunk=>{size+=chunk.length;if(size<=limit)chunks.push(chunk)});
   reply.on('end',()=>resolve({status:reply.statusCode,headers:{...reply.headers},text:Buffer.concat(chunks).toString('utf8')}));
   reply.on('error',()=>resolve({status:502,headers:{},text:''}));
  });
  upstream.on('error',()=>resolve({status:502,headers:{},text:''}));
  // 有正文就发正文；没有正文时，真实请求才 pipe，合成请求（P1 的跟进 GET）直接 end。
  if(body!==undefined&&body!==null)upstream.end(body);
  else if(typeof req.pipe==='function')req.pipe(upstream);
  else upstream.end();
 });
 // Dock 把管理页装在跨站 iframe 里（宿主是 tauri://），浏览器不会把 magpie 那条
 // SameSite=None/Partitioned 的鉴权 cookie 带回来：HTML 能出来，boot.js / app.css
 // 全 401，用户看到的就是「界面全错、内容空白、字体回退」。这里由代理在转发时
 // 无条件补上鉴权 cookie——浏览器带不带都不影响，页面恢复。
 const authCookie=key?`magpie_web_${upstreamPort}=${key}`:'';
 const withAuth=value=>{
  if(!authCookie)return value;
  const parts=String(value||'').split(';').map(p=>p.trim()).filter(Boolean).filter(p=>!p.startsWith(`magpie_web_${upstreamPort}=`));
  parts.push(authCookie);
  return parts.join('; ');
 };
 const cookie=value=>value.replace(/;\s*(?:SameSite=[^;]*|Secure|Partitioned)(?=;|$)/gi,'')+'; SameSite=None; Secure; Partitioned';
 const server=http.createServer(async(req,res)=>{
  let pathname;try{pathname=new URL(req.url,'http://127.0.0.1').pathname}catch{res.writeHead(400);res.end();return}
  if(/^\/api\/(?:update|whatsnew)(?:\/|$)/.test(pathname)){
   req.resume();res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
   res.end(JSON.stringify({managed:true,state:'managed',releases:[],message:'版本由 FISH Dock 插件管理'}));return;
  }
  const headers={...req.headers};let body;
  if(authCookie)headers.cookie=withAuth(headers.cookie);
  if(pathname==='/api/settings'&&req.method==='POST'){
   try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>1024*1024){res.writeHead(413);res.end();return}chunks.push(chunk)}
    const settings=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('settings');
    body=Buffer.from(JSON.stringify({...settings,...managedUpdates}));headers['content-length']=String(body.length);delete headers['transfer-encoding'];
   }catch{res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'设置格式无效'}));return}
  }
  const script=pathname==='/app.js';
  if(script){headers['accept-encoding']='identity';delete headers['if-none-match'];delete headers['if-modified-since']}
  // ---- handoff P0/P1：在转发之前接住「打开文件夹 / 选文件夹」 ----
  // 同源是本机页面上才成立（远端 LAN/隧道页即使能直连也要拒）；不同源直接 403，
  // 连上游都不碰——这是「Explorer relay 不绕过上游路径/同源/令牌校验」的入口。
  const revealPath=req.method==='POST'&&revealEnabled&&(isRevealRoute(pathname)||isBrowserSetup(pathname));
  const choosePath=req.method==='POST'&&isChoose(pathname);
  if(revealPath||choosePath){
   if(!sameOrigin(req,port)){req.resume();res.writeHead(403,{'content-type':'text/plain'});res.end('forbidden');return}
  }
  if(revealPath){
   headers['accept-encoding']='identity';
   const upstreamBody=await bufferUpstream(req,headers,body);
   // 7 条 reveal 路由：仅当上游 400 且正文是「can't open folders: it is …」时接力。
   if(isRevealRoute(pathname)){
    let target=null;
    if(upstreamBody.status===400){
     try{target=targetOf(JSON.parse(upstreamBody.text||'{}').error,home)}catch{target=null}
    }
    if(target){
     try{await openFolder(target);res.writeHead(204).end();return}catch{}
    }
    // 不满足（路径过期/被删/spawn 失败/文案不匹配）：原样透传上游响应，用户至少能看到原文。
    res.writeHead(upstreamBody.status,upstreamBody.headers);res.end(upstreamBody.text);return;
   }
   // library/browser/setup：200 且 JSON 同时有 dir 与非空 revealError 时打开目录、删 revealError、重算 length。
   if(isBrowserSetup(pathname)&&upstreamBody.status===200){
    try{
     const data=JSON.parse(upstreamBody.text);
     if(data&&typeof data.dir==='string'&&data.dir&&data.revealError){
      await openFolder(data.dir).catch(()=>{});
      delete data.revealError;
      const out=Buffer.from(JSON.stringify(data));
      const clean={...upstreamBody.headers};delete clean['transfer-encoding'];delete clean['content-encoding'];
      clean['content-length']=String(out.length);clean['content-type']='application/json';
      res.writeHead(200,clean);res.end(out);return;
     }
    }catch{}
   }
   res.writeHead(upstreamBody.status,upstreamBody.headers);res.end(upstreamBody.text);return;
  }
  if(choosePath){
   // 选目录：优先宿主 dialogs 能力（能力探测在 runtime 侧做，这里只负责调），
   // 缺席时用 STA PowerShell 兜底；取消回当前 autobackup 视图、选中 POST set 原样返回。
   let dir=null,done=false;
   try{
    if(typeof chooseFolder==='function'){
     const result=await chooseFolder({title:'选择备份文件夹',parent:'main'});
     dir=pickedDir(result);done=true;
    }
   }catch{done=false}
   if(!done&&typeof fallbackChoice==='function'){
    try{dir=await fallbackChoice();done=true}catch{done=false}
   }
   if(done){
    const followup=async(pathName,payload)=>{
     const data=payload?Buffer.from(JSON.stringify(payload)):null;
     const h={...headers,'accept-encoding':'identity'};
     // 跟进请求换方法、换正文：清掉原请求的正文头，避免上游按旧长度等数据。
     delete h['content-length'];delete h['content-type'];delete h['transfer-encoding'];
     if(data){h['content-type']='application/json';h['content-length']=String(data.length)}
     const reply=await bufferUpstream({url:pathName,method:data?'POST':'GET'},h,data);
     res.writeHead(reply.status,reply.headers);res.end(reply.text);
    };
    if(dir)await followup('/api/autobackup/set',{dir});
    else await followup('/api/autobackup',null);
    return;
   }
   // 兜底与能力都没成：透传上游的 400 原文（用户仍看得到 magpie 的话）。
   const reply=await bufferUpstream(req,headers,body);
   res.writeHead(reply.status,reply.headers);res.end(reply.text);return;
  }
  const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers},reply=>{
   const headers={...reply.headers};if(headers['set-cookie'])headers['set-cookie']=headers['set-cookie'].map(cookie);
   if(headers['content-security-policy'])headers['content-security-policy']=pluginPagePolicy(req.url,headers['content-security-policy']);
   if(script&&reply.statusCode===200){
    const chunks=[];let size=0;
    reply.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)reply.destroy(Error('管理脚本过大'));else chunks.push(chunk)});
    reply.on('end',()=>{try{
     const output=Buffer.from(managedUpdateScript(Buffer.concat(chunks).toString('utf8')));
     delete headers['transfer-encoding'];delete headers.etag;delete headers['content-encoding'];headers['content-length']=String(output.length);headers['cache-control']='no-store';
     res.writeHead(200,headers);res.end(output);
    }catch{res.writeHead(502);res.end('Magpie 管理页版本与 Dock 适配层不匹配')}});
   }else{res.writeHead(reply.statusCode,headers);reply.pipe(res)}
   reply.on('error',()=>res.destroy());
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('本机服务连接中断')});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());
  if(body)upstream.end(body);else req.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))});
 server.on('upgrade',(req,socket,head)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:req.headers});
  upstream.on('upgrade',(reply,peer,extra)=>{sockets.add(peer);peer.on('close',()=>sockets.delete(peer));socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(extra.length)socket.write(extra);if(head.length)peer.write(head);socket.pipe(peer).pipe(socket);peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());socket.on('close',()=>peer.destroy())});
  upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.end();
 });
 await bind(server,port,retries,delays);
 return {async stop(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}};
}
export async function freePort(){const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
