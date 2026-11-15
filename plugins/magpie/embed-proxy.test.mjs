import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {embedProxy,freePort,pluginPagePolicy,portBindError} from './embed-proxy.mjs';
import {REVEAL_REFUSED} from './reveal.mjs';
import {serviceError} from '../../shared/errors.mjs';

const file=`/_magpie/plugin/${'a'.repeat(32)}/index.html`;
const policy="sandbox allow-scripts; default-src 'none'; script-src 127.0.0.1:3425/_magpie/plugin/aaa/; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'";
test('仅原生 token 页面允许精确 Dock 祖先，保留全部其他 CSP',()=>{
 assert.equal(pluginPagePolicy(file,policy),policy+" http://tauri.localhost");
 for(const url of ['/','/api/plugin-pages','/_magpie/plugin/short/index.html','/other'+file])
  assert.equal(pluginPagePolicy(url,policy),policy);
 for(const value of ["frame-ancestors 'none'","frame-ancestors https://example.test","default-src 'none'"])
  assert.equal(pluginPagePolicy(file,value),value);
 assert.equal(pluginPagePolicy(file,undefined),undefined);
 assert.equal(pluginPagePolicy(file,policy+" http://tauri.localhost"),policy+" http://tauri.localhost");
});

test('绑定失败把原生码转成适配层码：文案与 available() 同源，原生错误留在 cause',()=>{
 const inUse=portBindError(Object.assign(Error('listen EADDRINUSE'),{code:'EADDRINUSE'}));
 assert.equal(inUse.code,'PORT_IN_USE');
 assert.equal(inUse.message,serviceError('PORT_IN_USE').message);
 assert.equal(inUse.cause.code,'EADDRINUSE');
 assert.equal(portBindError(Object.assign(Error('x'),{code:'EACCES'})).code,'PORT_BIND_DENIED');
 assert.equal(portBindError(Object.assign(Error('x'),{code:'EPERM'})).code,'PORT_BIND_DENIED');
 const native=Object.assign(Error('socket'),{code:'ENOTSOCK'});
 const unknown=portBindError(native);
 assert.equal(unknown.code,'UNKNOWN_ERROR');assert.equal(unknown.cause,native);
 assert.equal(portBindError(undefined).code,'UNKNOWN_ERROR');
});

test('端口被占时以 PORT_IN_USE 失败；占住的一方在重试窗口内让出后能绑上',{timeout:10000},async()=>{
 const blocker=net.createServer();blocker.listen(0,'127.0.0.1');await once(blocker,'listening');
 const port=blocker.address().port;
 // 一直被占：短重试用尽仍报端口冲突，绝不把原生 EADDRINUSE 漏给上层。
 const error=await embedProxy({port,upstreamPort:port,retries:1,delays:[10]}).catch(error=>error);
 assert.equal(error.code,'PORT_IN_USE');
 assert.equal(error.cause?.code,'EADDRINUSE');
 assert.equal(error.message,serviceError('PORT_IN_USE').message);
 // 短间隔重试：占住的一方在重试间隔内退出，第二次 listen 成功。
 const pending=embedProxy({port,upstreamPort:port,retries:1,delays:[400]});
 await delay(30);await new Promise(resolve=>blocker.close(resolve));
 const proxy=await pending;await proxy.stop();
 await assert.rejects(fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1000)}));
});

test('代理保留 token URL、鉴权、相对资源、重定向、流和 WebSocket；停止释放端口',{timeout:10000},async()=>{
 const requests=[],peers=new Set();
 const upstream=http.createServer((req,res)=>{
  requests.push({url:req.url,host:req.headers.host,cookie:req.headers.cookie});
  if(req.url==='/redirect'){res.writeHead(303,{location:'/landing','set-cookie':'test=session; HttpOnly; SameSite=Lax; Path=/'});res.end();return}
  res.writeHead(200,{'content-security-policy':policy,'x-frame-options':'SAMEORIGIN','content-type':'text/plain'});
  res.write('first\n');setTimeout(()=>res.end('last\n'),30);
 });
 upstream.on('upgrade',(req,socket)=>{peers.add(socket);socket.on('close',()=>peers.delete(socket));socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');socket.on('data',data=>socket.write(data));});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const port=await freePort(),proxy=await embedProxy({port,upstreamPort:upstream.address().port});
 try{
  const response=await fetch(`http://127.0.0.1:${port}${file}`,{headers:{cookie:'test=session'}});
  assert.equal(response.headers.get('content-security-policy'),policy+' http://tauri.localhost');
  assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
  assert.equal(await response.text(),'first\nlast\n');
  assert.deepEqual(requests[0],{url:file,host:`127.0.0.1:${port}`,cookie:'test=session'});
  const api=await fetch(`http://127.0.0.1:${port}/api/plugin-pages`);
  assert.equal(api.headers.get('content-security-policy'),policy);await api.text();
  const redirect=await fetch(`http://127.0.0.1:${port}/redirect`,{redirect:'manual'});
  assert.equal(redirect.status,303);assert.equal(redirect.headers.get('location'),'/landing');
  assert.match(redirect.headers.get('set-cookie'),/HttpOnly.*SameSite=None; Secure; Partitioned/);
  const socket=net.connect(port,'127.0.0.1');await once(socket,'connect');
  socket.write('GET /socket HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  const [head]=await once(socket,'data');assert.match(head.toString(),/101 Switching Protocols/);
  socket.write('owned-stream');assert.equal((await once(socket,'data'))[0].toString(),'owned-stream');
  const closed=once(socket,'close');await proxy.stop();await closed;
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1000)}));
 }finally{await proxy.stop();for(const peer of peers)peer.destroy();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve))}
});

// ---- 2026-11-15 handoff §7.1/§7.2：reveal 接力（HO-P0）、选目录接力（HO-P1） ----
// 建一个假上游：按路由返回 magpie 网页模式的 400 拒绝文案或指定响应。
async function fakeUpstream(handler){
 const requests=[];
 const server=http.createServer((req,res)=>{requests.push({url:req.url,method:req.method,headers:req.headers});handler(req,res)});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {server,requests,port:server.address().port};
}
async function closeServer(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve))}

test('reveal：库目录拒绝文案 → opener 收到库目录，回 204',async()=>{
 const home=path.join(os.tmpdir(),'magpie-home');
 const lib=path.join(home,'data','library');
 const opened=[];
 const up=await fakeUpstream((req,res)=>{
  assert.equal(req.method,'POST');
  res.writeHead(400,{'content-type':'application/json'});
  res.end(JSON.stringify({error:REVEAL_REFUSED+`~\\data\\library`}));
 });
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,home,openFolder:async target=>{opened.push(target)}});
 try{
  const res=await fetch(`http://127.0.0.1:${port}/api/library/reveal`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({path:lib})});
  assert.equal(res.status,204);
  assert.deepEqual(opened,[path.normalize(lib)],'opener 收到从文案里解析出的库目录');
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('reveal：越权路径的 400 纯文本原样透传，opener 不被调用',async()=>{
 const up=await fakeUpstream((req,res)=>{res.writeHead(400,{'content-type':'text/plain'});res.end('not a path the library shows')});
 const opened=[];
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,openFolder:async t=>{opened.push(t)}});
 try{
  const res=await fetch(`http://127.0.0.1:${port}/api/library/reveal`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'sec-fetch-site':'same-origin'},body:'{}'});
  assert.equal(res.status,400);
  assert.equal(await res.text(),'not a path the library shows');
  assert.equal(opened.length,0);
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('reveal：跨站 Origin / LAN 页面返回 403，不转发、opener 为空',async()=>{
 const up=await fakeUpstream((req,res)=>{res.writeHead(500);res.end('should not reach')});
 const opened=[];
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,openFolder:async t=>{opened.push(t)}});
 try{
  for(const headers of [{origin:'https://evil.example'},{origin:'http://192.168.1.5:3426'},{'sec-fetch-site':'cross-site'}]){
   const res=await fetch(`http://127.0.0.1:${port}/api/library/reveal`,{method:'POST',headers:{...headers},body:'{}'});
   assert.equal(res.status,403,JSON.stringify(headers));
   await res.text();
  }
  assert.equal(up.requests.length,0,'跨站请求不该转发到上游');
  assert.equal(opened.length,0);
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('reveal：上游非 400（正常 JSON）原样透传，不改写',async()=>{
 const up=await fakeUpstream((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}))});
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,openFolder:async()=>{throw Error('不该调用')}});
 try{
  const res=await fetch(`http://127.0.0.1:${port}/api/library/reveal`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'sec-fetch-site':'same-origin'},body:'{}'});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true});
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('reveal：library/browser/setup 有 revealError 时打开目录、删字段、重算 length',async()=>{
 const home=path.join(os.tmpdir(),'magpie-home');
 const dir=path.join(home,'data','extension');
 const opened=[];
 const up=await fakeUpstream((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({dir,'revealError':"can't open"}))});
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,home,openFolder:async t=>{opened.push(t)}});
 try{
  const res=await fetch(`http://127.0.0.1:${port}/api/library/browser/setup`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'sec-fetch-site':'same-origin'},body:'{}'});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.revealError,undefined,'revealError 被删掉');
  assert.equal(body.dir,dir);
  assert.deepEqual(opened,[path.normalize(dir)]);
  assert.equal(Number(res.headers.get('content-length')),Buffer.byteLength(JSON.stringify(body)),'content-length 重算');
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('P1：autobackup/choose 用宿主 dialogs 选目录，选中 POST set 原样返回；取消 GET autobackup',async()=>{
 const calls=[];
 const up=await fakeUpstream((req,res)=>{
  if(req.url.startsWith('/api/autobackup/choose')){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:"in the browser magpie can't show a folder picker: type the folder's path"}));return}
  if(req.url.startsWith('/api/autobackup/set')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({on:true,dir:calls.lastChosen}));return}
  if(req.url.startsWith('/api/autobackup')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({on:false,dir:null,view:'autobackup'}));return}
  res.writeHead(404);res.end();
 });
 const port=await freePort();
 // 选中：宿主能力返回 {dir}
 let picked=path.join(os.tmpdir(),'magpie-home','data','auto-backups');
 const proxy=await embedProxy({port,upstreamPort:up.port,chooseFolder:async()=>({dir:picked})});
 calls.lastChosen=picked;
 try{
  const res=await fetch(`http://127.0.0.1:${port}/api/autobackup/choose`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'sec-fetch-site':'same-origin'},body:'{}'});
  assert.equal(res.status,200);
  assert.equal((await res.json()).dir,picked);
 }finally{await proxy.stop()}
 // 取消：宿主能力返回 {dir:null} → GET /api/autobackup 原样返回
 const port2=await freePort();
 const proxy2=await embedProxy({port:port2,upstreamPort:up.port,chooseFolder:async()=>({dir:null})});
 try{
  const res=await fetch(`http://127.0.0.1:${port2}/api/autobackup/choose`,{method:'POST',headers:{origin:`http://127.0.0.1:${port2}`,'sec-fetch-site':'same-origin'},body:'{}'});
  assert.equal(res.status,200);
  assert.equal((await res.json()).view,'autobackup','取消时返回当前 autobackup 视图');
 }finally{await proxy2.stop();await closeServer(up.server)}
});

test('P1：宿主能力缺席时 autobackup/choose 用 PowerShell 兜底（注入替身），无输出视为取消',async()=>{
 const up=await fakeUpstream((req,res)=>{
  if(req.url.startsWith('/api/autobackup/choose')){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'picker'}));return}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({view:'autobackup',dir:null}));
 });
 const port=await freePort();
 let fallbackCalls=0;
 const proxy=await embedProxy({port,upstreamPort:up.port,chooseFolder:null,fallbackChoice:async()=>{fallbackCalls++;return null}});
 try{
  const res=await fetch(`http://127.0.0.1:${port}/api/autobackup/choose`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'sec-fetch-site':'same-origin'},body:'{}'});
  assert.equal(res.status,200);
  assert.equal(fallbackCalls,1,'宿主能力缺席时走兜底');
  assert.equal((await res.json()).view,'autobackup');
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('FISH_MAGPIE_REVEAL=0 时整体关闭：reveal 路由原样透传 400',async()=>{
 const prev=process.env.FISH_MAGPIE_REVEAL;process.env.FISH_MAGPIE_REVEAL='0';
 const up=await fakeUpstream((req,res)=>{res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:REVEAL_REFUSED+'~\\x'}))});
 const opened=[];
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,openFolder:async t=>{opened.push(t)}});
 try{
  const res=await fetch(`http://127.0.0.1:${port}/api/library/reveal`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`,'sec-fetch-site':'same-origin'},body:'{}'});
  assert.equal(res.status,400);
  assert.equal(opened.length,0,'开关关闭时不接力');
 }finally{await proxy.stop();await closeServer(up.server);if(prev===undefined)delete process.env.FISH_MAGPIE_REVEAL;else process.env.FISH_MAGPIE_REVEAL=prev}
});
