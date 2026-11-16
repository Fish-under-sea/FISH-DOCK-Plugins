import http from 'node:http';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {REVEAL_ROUTES,targetOf,localTarget,sameOrigin,openInExplorer,pickedDir} from './reveal.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {managedUpdates,managedUpdateScript} from './managed-update.mjs';
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
// Legacy hosts without dialogs can still use a cancellable STA picker.
export function defaultFallbackChoice({title='选择备份文件夹',timeoutMs=300000,signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return}
  const quoted="'"+title.replaceAll("'","''")+"'";
  const script=`Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = ${quoted}; try { if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) } } finally { $d.Dispose() }`;
  let child,timer,done=false,out='';
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)};
  const abort=()=>{try{child?.kill()}catch{}finish(signal.reason)};
  try{child=spawn('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:true,stdio:['ignore','pipe','ignore']})}catch(error){finish(error);return}
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{try{child.kill()}catch{}finish(Error('Folder picker timed out'))},timeoutMs);
  child.stdout.on('data',chunk=>{out+=chunk;if(Buffer.byteLength(out)>32768){child.kill();finish(Error('Folder picker output too large'))}});
  child.once('error',error=>finish(error));
  child.once('close',code=>code===0?finish(null,out.trim()||null):finish(Error('Folder picker failed')));
 });
}
function cancellable(work,signal){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{signal.throwIfAborted();return work()}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
function requestBody(req,limit,signal){
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0;
  const clean=()=>{req.off('data',data);req.off('end',end);req.off('error',fail);signal.removeEventListener('abort',abort)};
  const fail=error=>{clean();reject(error)};
  const abort=()=>fail(signal.reason);
  const data=chunk=>{size+=chunk.length;if(size>limit){fail(Object.assign(Error('Request too large'),{status:413}));req.resume()}else chunks.push(chunk)};
  const end=()=>{clean();resolve(Buffer.concat(chunks))};
  req.on('data',data);req.once('end',end);req.once('error',fail);signal.addEventListener('abort',abort,{once:true});
 });
}
// Only the handoff routes are buffered. Model streams remain untouched.
export async function embedProxy({port,upstreamPort,key='',retries=2,delays=[120,240],signal,
 openFolder=(target,options)=>openInExplorer(target,spawn,process.platform,options),chooseFolder=null,
 fallbackChoice=defaultFallbackChoice,home=os.homedir()}){
 const sockets=new Set(),lifetime=new AbortController();
 const revealEnabled=String(process.env.FISH_MAGPIE_REVEAL??'')!=='0';
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
  const revealPath=revealEnabled&&(REVEAL_ROUTES.has(pathname)||pathname==='/api/library/browser/setup');
  const choosePath=revealEnabled&&pathname==='/api/autobackup/choose';
  if(revealPath||choosePath){
   if(req.method!=='POST'){req.resume();res.writeHead(405,{allow:'POST'});res.end();return}
   if(!req.url.startsWith('/')||req.url.startsWith('//')||!sameOrigin(req,port)){req.resume();res.writeHead(403);res.end('forbidden');return}
   const controller=new AbortController(),cancel=()=>controller.abort();
   const active=AbortSignal.any([controller.signal,lifetime.signal,...(signal?[signal]:[])]);
   req.once('aborted',cancel);res.once('close',cancel);
   const send=reply=>{if(!reply||active.aborted)return;res.writeHead(reply.status,reply.headers);res.end(reply.body)};
   // Responses over 64 KiB bypass interpretation and stream verbatim; never truncate them.
   const buffered=(url,method,payload)=>new Promise((resolve,reject)=>{
    active.throwIfAborted();
    const h={...headers,'accept-encoding':'identity'};
    if(authCookie)h.cookie=withAuth(h.cookie);
    delete h['content-length'];delete h['transfer-encoding'];
    if(payload!==undefined)h['content-length']=String(payload.length);else delete h['content-type'];
    const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:url,method,headers:h,signal:active},reply=>{
     const responseHeaders={...reply.headers};
     if(responseHeaders['set-cookie'])responseHeaders['set-cookie']=responseHeaders['set-cookie'].map(cookie);
     const chunks=[];let size=0,streaming=false;
     reply.on('data',chunk=>{
      size+=chunk.length;
      if(streaming)return;
      if(size>64*1024){streaming=true;res.writeHead(reply.statusCode,responseHeaders);for(const part of chunks)res.write(part);res.write(chunk);reply.pipe(res);resolve(null)}
      else chunks.push(chunk);
     });
     reply.once('end',()=>{if(!streaming)resolve({status:reply.statusCode,headers:responseHeaders,body:Buffer.concat(chunks)})});
     reply.once('error',error=>{if(streaming)res.destroy();reject(error)});
    });
    upstream.once('error',reject);upstream.end(payload);
   });
   try{
    active.throwIfAborted();
    body=await requestBody(req,64*1024,active);
    active.throwIfAborted();
    if(choosePath){
     let dir;
     // Do not mask SDK errors (busy/permission failures) with a second dialog.
     if(typeof chooseFolder==='function')dir=pickedDir(await cancellable(()=>chooseFolder({title:'选择备份文件夹',parent:'main'}),active));
     else dir=await cancellable(()=>fallbackChoice({signal:active}),active);
     active.throwIfAborted();
     if(dir!==null){dir=localTarget(dir,home);if(!dir)throw Error('Invalid chosen folder')}
     if(dir===null)send(await buffered('/api/autobackup','GET'));
     else {headers['content-type']='application/json';send(await buffered('/api/autobackup/set','POST',Buffer.from(JSON.stringify({dir}))))}
    }else{
     const reply=await buffered(req.url,'POST',body);
     if(!reply)return;
     active.throwIfAborted();
     // A server refusing an unvalidated page path does not have this exact error.
     // A compressed response cannot be interpreted even if upstream ignored identity.
     if(!reply.headers['content-encoding']||reply.headers['content-encoding']==='identity'){
      let data;try{data=JSON.parse(reply.body.toString('utf8'))}catch{}
      const setup=pathname==='/api/library/browser/setup';
      const target=setup&&reply.status===200&&typeof data?.revealError==='string'&&data.revealError
       ?localTarget(data.dir,home):!setup&&reply.status===400?targetOf(data?.error,home):null;
      if(target){
       try{
        active.throwIfAborted();await cancellable(()=>openFolder(target,{signal:active}),active);active.throwIfAborted();
        if(!setup){res.writeHead(204);res.end();return}
        delete data.revealError;reply.body=Buffer.from(JSON.stringify(data));
        for(const name of ['transfer-encoding','content-encoding','etag','content-md5'])delete reply.headers[name];
        reply.headers['content-length']=String(reply.body.length);
       }catch(error){if(active.aborted)throw error}
      }
     }
     send(reply);
    }
   }catch(error){if(!active.aborted&&!res.headersSent){res.writeHead(error.status||502);res.end('Native folder handoff failed')}}
   finally{req.off('aborted',cancel)}
   return;
  }
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
 return {async stop(){lifetime.abort();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}};
}
export async function freePort(){const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
