import http from 'node:http';
// 只适配本插件的回环服务；保留上游鉴权、流式响应及 WebSocket。
export async function embedProxy({port,upstreamPort}){
 const sockets=new Set();
 const cookie=value=>value.replace(/;\s*(?:SameSite=[^;]*|Secure|Partitioned)(?=;|$)/gi,'')+'; SameSite=None; Secure; Partitioned';
 const server=http.createServer((req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:req.headers},reply=>{
   const headers={...reply.headers};if(headers['set-cookie'])headers['set-cookie']=headers['set-cookie'].map(cookie);
   res.writeHead(reply.statusCode,headers);reply.pipe(res);reply.on('error',()=>res.destroy());
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('本机服务连接中断')});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))});
 server.on('upgrade',(req,socket,head)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:req.headers});
  upstream.on('upgrade',(reply,peer,extra)=>{sockets.add(peer);peer.on('close',()=>sockets.delete(peer));socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(extra.length)socket.write(extra);if(head.length)peer.write(head);socket.pipe(peer).pipe(socket);peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());socket.on('close',()=>peer.destroy())});
  upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return {async stop(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}};
}
export async function freePort(){const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
