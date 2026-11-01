import http from 'node:http';
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
// 仅适配插件持有的回环服务，模型流不缓存、不重试。
export async function embedProxy({port,upstreamPort,retries=2,delays=[120,240]}){
 const sockets=new Set();
 const cookie=value=>value.replace(/;\s*(?:SameSite=[^;]*|Secure|Partitioned)(?=;|$)/gi,'')+'; SameSite=None; Secure; Partitioned';
 const server=http.createServer(async(req,res)=>{
  let pathname;try{pathname=new URL(req.url,'http://127.0.0.1').pathname}catch{res.writeHead(400);res.end();return}
  if(/^\/api\/(?:update|whatsnew)(?:\/|$)/.test(pathname)){
   req.resume();res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
   res.end(JSON.stringify({managed:true,state:'managed',releases:[],message:'版本由 FISH Dock 插件管理'}));return;
  }
  const headers={...req.headers};let body;
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
 return {async stop(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}};
}
export async function freePort(){const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
