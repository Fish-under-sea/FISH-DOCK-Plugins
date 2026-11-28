import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {embedProxy,freePort,pluginPagePolicy,portBindError} from './embed-proxy.mjs';
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

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {REVEAL_REFUSED} from './reveal.mjs';

test('handoff rejects wrong methods, opaque origins, wrong Host and oversized bodies before upstream',async()=>{
 const up=await fakeUpstream((req,res)=>res.end('{}'));
 const port=await freePort(),proxy=await embedProxy({port,upstreamPort:up.port,openFolder:async()=>assert.fail('must not open')});
 const url=`http://127.0.0.1:${port}/api/library/reveal`,origin=`http://127.0.0.1:${port}`;
 try{
  for(const [options,status] of [
   [{method:'GET'},405],
   [{method:'POST',headers:{origin:'null'}},403],
   [{method:'POST',headers:{origin:`http://localhost:${port}`}},403],
   [{method:'POST',headers:{origin},body:'x'.repeat(64*1024+1)},413],
  ]){const response=await fetch(url,options);assert.equal(response.status,status,JSON.stringify(options));await response.text()}
  const wrongHost=await new Promise((resolve,reject)=>{const req=http.request(url,{method:'POST',headers:{origin,host:`evil.example:${port}`}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end()});
  assert.equal(wrongHost,403);
  assert.equal(up.requests.length,0);
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('handoff oversized responses stream intact and failed setup opener preserves revealError',async()=>{
 const large='x'.repeat(80*1024),dir=path.join(os.tmpdir(),'extension');
 const setup=JSON.stringify({dir,revealError:'cannot reveal'});
 const up=await fakeUpstream((req,res)=>{const text=req.url.includes('setup')?setup:large;res.writeHead(400+(req.url.includes('setup')?-200:0),{'content-length':Buffer.byteLength(text)});res.end(text)});
 const port=await freePort(),proxy=await embedProxy({port,upstreamPort:up.port,openFolder:async()=>{throw Error('spawn failed')}});
 try{
  for(const [route,text] of [['/api/library/reveal',large],['/api/library/browser/setup',setup]]){
   const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`}});
   assert.equal(await response.text(),text);
  }
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('choose cancellation discards late dialog results and never writes chosen dir',async()=>{
 const up=await fakeUpstream((req,res)=>res.end('{}'));
 let resolveChoice,started;
 const ready=new Promise(resolve=>started=resolve);
 const choice=new Promise(resolve=>resolveChoice=resolve);
 const port=await freePort(),proxy=await embedProxy({port,upstreamPort:up.port,chooseFolder:async()=>{started();return choice}});
 const controller=new AbortController();
 try{
  const pending=fetch(`http://127.0.0.1:${port}/api/autobackup/choose`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`},signal:controller.signal});
  await ready;controller.abort();await assert.rejects(pending);
  await proxy.stop();resolveChoice({dir:os.tmpdir()});await delay(20);
  assert.equal(up.requests.length,0);
 }finally{resolveChoice?.({dir:null});await proxy.stop();await closeServer(up.server)}
});

test('host dialog errors do not trigger fallback or modify backup settings',async()=>{
 const up=await fakeUpstream((req,res)=>res.end('{}'));
 const port=await freePort(),proxy=await embedProxy({port,upstreamPort:up.port,chooseFolder:async()=>{throw Error('DIALOG_BUSY')},fallbackChoice:async()=>assert.fail('must not fall back')});
 try{
  const response=await fetch(`http://127.0.0.1:${port}/api/autobackup/choose`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`}});
  assert.equal(response.status,502);await response.text();assert.equal(up.requests.length,0);
 }finally{await proxy.stop();await closeServer(up.server)}
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

test('本知识库的 obsidian 链接由适配层直接拉起，不转发给 magpie',async()=>{
 const vault=path.join(os.tmpdir(),'magpie-vault');
 const up=await fakeUpstream((req,res)=>{res.writeHead(204);res.end()});
 const opened=[];
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,obsidian:{root:()=>vault,open:async uri=>{opened.push(uri)}}});
 const origin=`http://127.0.0.1:${port}`;
 try{
  const uri='obsidian://open?path='+encodeURIComponent(path.join(vault,'wiki','note.md'));
  const r=await fetch(`${origin}/api/open`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({URL:uri})});
  assert.equal(r.status,204);
  assert.deepEqual(opened,[uri]);
  assert.equal(up.requests.length,0,'本库链接不得到达 magpie');

  // 别的链接原样转发：代理不接管、也不改它的形状
  const foreign='https://example.com/docs';
  const f=await fetch(`${origin}/api/open`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({URL:foreign,system:true})});
  assert.equal(f.status,204);await f.text();
  assert.equal(opened.length,1,'外链不触发 Obsidian');
  assert.equal(up.requests.length,1);
  assert.equal(up.requests[0].url,'/api/open');
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('打开本库链接失败时如实报错，不伪装成功',async()=>{
 const vault=path.join(os.tmpdir(),'magpie-vault');
 const up=await fakeUpstream((req,res)=>{res.writeHead(204);res.end()});
 const port=await freePort();
 const proxy=await embedProxy({port,upstreamPort:up.port,obsidian:{root:()=>vault,open:async()=>{throw Error('未检测到 Obsidian')}}});
 const origin=`http://127.0.0.1:${port}`;
 try{
  const r=await fetch(`${origin}/api/open`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({URL:'obsidian://open?path='+encodeURIComponent(vault)})});
  assert.equal(r.status,502);
  assert.match((await r.json()).error,/未检测到 Obsidian/);
  assert.equal(up.requests.length,0);
 }finally{await proxy.stop();await closeServer(up.server)}
});

test('没有接管方时 /api/open 维持原样（旧宿主行为不变）',async()=>{
 const up=await fakeUpstream((req,res)=>{res.writeHead(204);res.end()});
 const port=await freePort(),proxy=await embedProxy({port,upstreamPort:up.port});
 const origin=`http://127.0.0.1:${port}`;
 try{
  const r=await fetch(`${origin}/api/open`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({URL:'obsidian://open?path=C%3A%5Cv'})});
  assert.equal(r.status,204);await r.text();
  assert.equal(up.requests.length,1);
 }finally{await proxy.stop();await closeServer(up.server)}
});


test('embedProxy 提供 dock-theme 查询/SSE 推送与 glass-state 回调', async (t) => {
 let currentTheme = { dockMode: 'glass', appearance: { glass: { enabled: true, cardOp: 28, cardBlur: 14 } } };
 const listeners = new Set();
 const dockTheme = {
  get: () => currentTheme,
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
 };
 const glassStates = [];
 const port = await freePort();
 const upstreamPort = await freePort();
 const proxy = await embedProxy({ port, upstreamPort, dockTheme, onGlassState: (on) => glassStates.push(on) });
 t.after(() => proxy.stop());

 // GET /api/fish/dock-theme
 const res = await fetch(`http://127.0.0.1:${port}/api/fish/dock-theme`);
 assert.equal(res.status, 200);
 const body = await res.json();
 assert.equal(body.available, true);
 assert.deepEqual(body.theme, currentTheme);

 // POST /api/fish/glass-state 校验来源/方法
 const wrongMethod = await fetch(`http://127.0.0.1:${port}/api/fish/glass-state`);
 assert.equal(wrongMethod.status, 405);
 const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/fish/glass-state`, {
  method: 'POST', headers: { Origin: 'http://evil.test', 'content-type': 'application/json' }, body: '{"on":true}',
 });
 assert.equal(crossOrigin.status, 403);
 const okPost = await fetch(`http://127.0.0.1:${port}/api/fish/glass-state`, {
  method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body: '{"on":true}',
 });
 assert.equal(okPost.status, 204);
 assert.deepEqual(glassStates, [true]);

 // SSE /api/fish/dock-theme/stream 初始推送与后续更新
 const ac = new AbortController();
 const streamRes = await fetch(`http://127.0.0.1:${port}/api/fish/dock-theme/stream`, { signal: ac.signal });
 assert.equal(streamRes.status, 200);
 assert.match(streamRes.headers.get('content-type') || '', /text\/event-stream/);
 const reader = streamRes.body.getReader();
 t.after(async () => { await reader.cancel().catch(() => {}); ac.abort(); });
 const dec = new TextDecoder();
 const chunk1 = dec.decode((await reader.read()).value);
 assert.match(chunk1, /"cardOp":28/);

 const nextTheme = { dockMode: 'glass', appearance: { glass: { enabled: true, cardOp: 55, cardBlur: 20 } } };
 currentTheme = nextTheme;
 for (const fn of listeners) fn(nextTheme);
 const chunk2 = dec.decode((await reader.read()).value);
 assert.match(chunk2, /"cardOp":55/);
 await reader.cancel().catch(() => {});
 ac.abort();
});

test('embedProxy 未配置 dockTheme 时可用性为 false，stream 返回 404', async (t) => {
 const port = await freePort();
 const upstreamPort = await freePort();
 const proxy = await embedProxy({ port, upstreamPort });
 t.after(() => proxy.stop());
 const info = await fetch(`http://127.0.0.1:${port}/api/fish/dock-theme`);
 assert.equal(info.status, 200);
 assert.deepEqual(await info.json(), { available: false, theme: null });
 const stream = await fetch(`http://127.0.0.1:${port}/api/fish/dock-theme/stream`);
 assert.equal(stream.status, 404);
});

test('embedProxy 提供 Purge 叠加层资源并增量注入原生 HTML 与 routing/client.js', async (t) => {
 const up = await fakeUpstream((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
   res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
   res.end('<!doctype html><html><body><h1>magpie</h1></body></html>');
   return;
  }
  if (req.url === '/plugins/routing/client.js') {
   res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
   res.end('function routingPage(){ hub.append(logo, el("b", "", "magpie"), hubSub, chip); function render() { if (!cur) return; hubText(); } }');
   return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
 });
 const port = await freePort();
 const proxy = await embedProxy({ port, upstreamPort: up.port });
 t.after(async () => { await proxy.stop(); await closeServer(up.server); });

 const jsRes = await fetch(`http://127.0.0.1:${port}/_fish/purge-routing-overlay.js`);
 assert.equal(jsRes.status, 200);
 assert.match(jsRes.headers.get('content-type') || '', /javascript/);
 assert.match(await jsRes.text(), /__FISH_PURGE_ROUTING_OVERLAY__/);

 const cssRes = await fetch(`http://127.0.0.1:${port}/_fish/purge-routing-overlay.css`);
 assert.equal(cssRes.status, 200);
 assert.match(cssRes.headers.get('content-type') || '', /text\/css/);
 assert.match(await cssRes.text(), /purge-capsule/);

 const postAsset = await fetch(`http://127.0.0.1:${port}/_fish/purge-routing-overlay.js`, { method: 'POST' });
 assert.equal(postAsset.status, 405);

 const indexRes = await fetch(`http://127.0.0.1:${port}/`);
 const indexHtml = await indexRes.text();
 assert.match(indexHtml, /<h1>magpie<\/h1>/);
 assert.match(indexHtml, /\/_fish\/purge-routing-overlay\.css/);
 assert.match(indexHtml, /\/_fish\/purge-routing-overlay\.js/);

 const clientRes = await fetch(`http://127.0.0.1:${port}/plugins/routing/client.js`);
 const clientJs = await clientRes.text();
 assert.match(clientJs, /dataset\.purgeTargetId = "hub-magpie"/);
 assert.match(clientJs, /fish:routing-render/);

 const plainRes = await fetch(`http://127.0.0.1:${port}/other.txt`);
 assert.equal(await plainRes.text(), 'ok');
});
