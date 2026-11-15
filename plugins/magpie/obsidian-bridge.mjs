import http from 'node:http';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {vaultPaths} from './knowledge-vault.mjs';

const MAX_BODY=1024*1024;
const methods={status:'GET',models:'GET',search:'POST',chat:'POST',memory:'POST'};
async function jsonBody(req){
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Object.assign(Error('请求内容过长'),{status:413});chunks.push(chunk)}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(Error('请求 JSON 无效'),{status:400})}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(Error('请求格式无效'),{status:400});return value;
}
function validate(route,body){
 const bad=()=>{throw Object.assign(Error('请求参数无效'),{status:400})};
 if(route==='search'){if(typeof body.q!=='string'||body.q.length>2000)bad();return {q:body.q}}
 if(route==='memory'){
  if(typeof body.text!=='string'||!body.text.trim()||[...body.text].length>2000)bad();
  // This endpoint creates candidates only. No caller-selected ID, scope, delete
  // operation or arbitrary native route is accepted from an Obsidian panel.
  return {text:body.text,kind:'fact',status:'candidate',scope:'global'};
 }
 if(route==='chat'){
  if(typeof body.model!=='string'||!body.model||body.model.length>300||!Array.isArray(body.messages)||!body.messages.length||body.messages.length>200)bad();
  return {model:body.model,messages:body.messages.map(m=>{if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>60000)bad();return {role:m.role,content:m.content}}),stream:true};
 }
 return undefined;
}
async function textStream(reply,res,signal){
 if(!reply.headers.get('content-type')?.includes('text/event-stream'))throw Error('模型没有返回有效流');
 res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
 const decoder=new TextDecoder();let buffer='',done=false,size=0;
 async function line(value){
  if(!value.startsWith('data:'))return;
  const data=value.slice(5).trim();if(!data)return;if(data==='[DONE]'){done=true;return}
  const obj=JSON.parse(data);if(obj.error)throw Error('模型返回错误');
  if(['length','content_filter'].includes(obj.choices?.[0]?.finish_reason))throw Error('模型回复未完整结束');
  const chunk=obj.choices?.[0]?.delta?.content;if(chunk===undefined||chunk===null)return;if(typeof chunk!=='string')throw Error('模型流格式无效');
  size+=Buffer.byteLength(chunk);if(size>8*1024*1024)throw Error('模型回复过长');
  if(!res.write(chunk))await once(res,'drain',{signal});
 }
 for await(const chunk of reply.body){
  signal.throwIfAborted();buffer+=decoder.decode(chunk,{stream:true});
  if(buffer.length>1024*1024)throw Error('模型事件过长');
  let pos;while((pos=buffer.indexOf('\n'))!==-1){const value=buffer.slice(0,pos).replace(/\r$/,'');buffer=buffer.slice(pos+1);await line(value)}
 }
 buffer+=decoder.decode();if(buffer.trim())await line(buffer.trim());
 if(!done)throw Error('模型回复中断');res.end();
}

// A separate loopback listener, not the Dock embed proxy (which supplies admin
// cookies). Never exposes provider credentials, general URLs or a filesystem API.
export async function startObsidianBridge({data,upstreamPort,key,fetcher=fetch}){
 if(!Number.isInteger(upstreamPort)||upstreamPort<1||upstreamPort>65535)throw Error('原生端口无效');
 const {root:vault,connection}=vaultPaths(data),token=randomBytes(32).toString('hex');
 const sockets=new Set(),controllers=new Set();let active=0,closed=false;
 const server=http.createServer(async(req,res)=>{
  const fail=(status,error)=>{if(res.headersSent){res.destroy();return}req.resume();res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error}))};
  const host=`127.0.0.1:${server.address().port}`;
  if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==host||req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined){fail(403,'只允许本机桌面连接');return}
  const provided=Buffer.from(String(req.headers.authorization||'')),want=Buffer.from(`Bearer ${token}`);
  if(provided.length!==want.length||!timingSafeEqual(provided,want)){fail(401,'需要 Magpie 配对');return}
  if(!/^\/(status|models|search|chat|memory)$/.test(req.url)){fail(404,'未知操作');return}
  const route=req.url.slice(1);
  if(req.method!==methods[route]){fail(405,'方法不支持');return}
  if(active>=8){fail(429,'请求过多，请稍后重试');return}
  const controller=new AbortController();controllers.add(controller);active++;
  req.once('aborted',()=>controller.abort());res.once('close',()=>controller.abort());
  try{
   if(Number(req.headers['content-length'])>MAX_BODY){fail(413,'请求内容过长');return}
   let body;if(req.method==='POST')body=validate(route,await jsonBody(req));
   if(route==='status'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({connected:true,vault}));return}
   const native=route==='memory'?'/api/memory':`/api/fish-vault/${route}`;
   const reply=await fetcher(`http://127.0.0.1:${upstreamPort}${native}`,{
    method:req.method,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10*60*1000)]),
    headers:{cookie:`magpie_web_${upstreamPort}=${key}`,'x-fish-obsidian-token':token,...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
   });
   if(!reply.ok){await reply.body?.cancel();fail(reply.status>=400&&reply.status<600?reply.status:502,'Magpie 无法完成请求，请在 Dock 检查服务与模型配置');return}
   if(route==='chat'){await textStream(reply,res,controller.signal);return}
   let size=0;const parts=[];for await(const chunk of reply.body){size+=chunk.length;if(size>4*1024*1024)throw Error('本机响应过大');parts.push(chunk)}
   const result=JSON.parse(Buffer.concat(parts).toString('utf8'));
   // Memory POST returns the entire native view. Don't leak unrelated private
   // scopes to this narrow save endpoint: only an acknowledgement is needed.
   const output=route==='memory'?{saved:true,status:'candidate'}:result;
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(output));
  }catch(error){if(!res.destroyed)fail(error.status||502,error.status?error.message:'Magpie 连接中断，请重试')}
  finally{active--;controllers.delete(controller)}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const cfg={schema:1,url:`http://127.0.0.1:${server.address().port}/`,token,vault};
 const temporary=`${connection}.${randomUUID()}.tmp`;
 async function stop(){
  if(closed)return;closed=true;for(const c of controllers)c.abort();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));
  try{const current=JSON.parse(await fs.readFile(connection,'utf8'));if(current.token===token)await fs.rm(connection)}catch(error){if(error.code!=='ENOENT')console.error('[magpie] Obsidian 连接文件清理未完成')}
 }
 try{await fs.writeFile(temporary,JSON.stringify(cfg),{flag:'wx',mode:0o600});await fs.rename(temporary,connection)}catch(error){await stop();throw error}finally{await fs.rm(temporary,{force:true})}
 return {url:cfg.url,connection,stop};
}
