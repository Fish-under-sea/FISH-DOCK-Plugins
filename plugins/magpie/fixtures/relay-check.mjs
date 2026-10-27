import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';

// 真实网关接合成多级 URL；静默阶段只在客户端确实收到保活后结束。
export async function checkRelay({origin,cookie}){
 let finish,requests=0;const seen=[];
 const up=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');seen.push(req.url);
  if(req.url.endsWith('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return}
  if(req.url!=='/tenant/api/v1/chat/completions'){res.writeHead(404);res.end('{}');return}
  assert.equal(body.model,'fixture-model');
  if(!body.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'fixture-probe',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));return}
  requests++;
  res.setHeader('content-type','text/event-stream');
  res.write('data: '+JSON.stringify({id:'fixture-1',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:'fixture-first'},finish_reason:null}]})+'\n\n');
  finish=()=>res.end('data: '+JSON.stringify({id:'fixture-1',object:'chat.completion.chunk',choices:[{index:0,delta:{content:'fixture-last'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}})+'\n\ndata: [DONE]\n\n');
 });
 up.listen(0,'127.0.0.1');await once(up,'listening');
 const json=async(url,body)=>{
  const r=await fetch(origin+url,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(r.status,200,await r.clone().text());return r.json();
 };
 let reader;
 try{
  const base=`http://127.0.0.1:${up.address().port}/tenant/api/v1`;
  await json('/api/provider/save',{new:true,id:'relay-fixture',name:'Relay fixture',chat:base,key:'fixture-only',models:['fixture-model'],proxy:'direct'});
  const listed=await json('/api/provider/models',{id:'relay-fixture'});assert.equal(listed.count,1);
  assert.ok(seen.includes('/tenant/api/v1/models'));
  const detection=await json('/api/provider/detect',{id:'relay-fixture',base,model:'fixture-model'});
  const chat=detection.results.find(r=>r.protocol==='chat');assert.equal(chat?.ok,true,JSON.stringify(detection));assert.equal(chat.base,base);
  const settings=await json('/api/settings');assert.ok(settings.gateway);
  const response=await fetch(settings.gateway+'/v1/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'relay-fixture/fixture-model',input:'fixture only',stream:true}),signal:AbortSignal.timeout(65000)});
  assert.equal(response.status,200);reader=response.body.getReader();
  const decoder=new TextDecoder();let output='',pings=0,began=false;
  while(true){
   const {done,value}=await reader.read();if(done)break;
   const text=decoder.decode(value,{stream:true});output+=text;
   if(began){pings+=(text.match(/^data:.*"type"\s*:\s*"response\.in_progress"/gm)||[]).length;if(pings>=2)finish()}
   if(output.includes('fixture-first'))began=true;
  }
  assert.ok(pings>=2,'协议转换后的静默流必须独立向客户端保活');
  assert.match(output,/fixture-last/);assert.match(output,/response.completed/);assert.doesNotMatch(output,/response.failed/);
  assert.equal(requests,1,'慢输出不应引起重复上游请求');
  assert.ok(seen.includes('/tenant/api/v1/chat/completions'));
  console.log('PASS relay: nested custom URL retained; Responses -> Chat silent stream kept alive twice; completed; exactly one upstream request');
 }finally{
  finish?.();await reader?.cancel().catch(()=>{});up.closeAllConnections();await new Promise(resolve=>up.close(resolve));
 }
}
