import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {embedProxy,freePort,pluginPagePolicy} from './embed-proxy.mjs';

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
