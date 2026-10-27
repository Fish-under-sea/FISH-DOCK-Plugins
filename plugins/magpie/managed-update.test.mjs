import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {preparePortableRuntime} from './portable-runtime.mjs';
import {embedProxy,freePort} from './embed-proxy.mjs';

test('Dock 托管更新在原生启动前禁用，保留其他设置且损坏文件不被覆盖',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'magpie-managed-'));
 const source=path.join(root,'package/magpie.exe'),credentials=path.join(root,'credentials');
 await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(source,'fixture');
 const ready=await preparePortableRuntime(source,credentials),settings=path.join(ready.data,'settings.json');
 await fs.writeFile(settings,JSON.stringify({theme:'dark',proxy:'direct',custom:{kept:true},noAutoUpdate:false,autoRestart:true}));
 await preparePortableRuntime(source,credentials);
 const got=JSON.parse(await fs.readFile(settings,'utf8'));
 assert.equal(got.noAutoUpdate,true);assert.equal(got.noAutoDownload,true);assert.equal(got.autoRestart,false);assert.equal(got.noUpdatePill,true);
 assert.equal(got.theme,'dark');assert.equal(got.proxy,'direct');assert.deepEqual(got.custom,{kept:true});
 await fs.writeFile(settings,'{"broken":');
 await assert.rejects(preparePortableRuntime(source,credentials));
 assert.equal(await fs.readFile(settings,'utf8'),'{"broken":');
});

test('托管代理截断内置更新调用，设置保存固定更新关闭，其他 API 保持透传',async()=>{
 const requests=[];
 const up=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push({url:req.url,body});res.setHeader('content-type','application/json');res.end(body||'{}');
 });
 up.listen(0,'127.0.0.1');await once(up,'listening');
 const port=await freePort(),proxy=await embedProxy({port,upstreamPort:up.address().port});
 try{
  for(const suffix of ['','?fresh=1','/notes','/check','/install']){
   const response=await fetch(`http://127.0.0.1:${port}/api/update${suffix}`,{method:['/check','/install'].includes(suffix)?'POST':'GET'});
   const out=await response.json();assert.equal(out.managed,true);assert.equal(out.state,'managed');
  }
  const news=await fetch(`http://127.0.0.1:${port}/api/whatsnew?all=1`);assert.equal((await news.json()).managed,true);
  assert.equal(requests.length,0,'更新请求不得抵达原生服务');
  const response=await fetch(`http://127.0.0.1:${port}/api/settings`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({theme:'light',noAutoUpdate:false,autoRestart:true})});
  assert.equal(response.status,200);const saved=JSON.parse(requests.at(-1).body);
  assert.equal(saved.theme,'light');assert.equal(saved.noAutoUpdate,true);assert.equal(saved.noAutoDownload,true);assert.equal(saved.autoRestart,false);assert.equal(saved.noUpdatePill,true);
  await fetch(`http://127.0.0.1:${port}/api/plugin/update`,{method:'POST',body:'{}'});
  assert.equal(requests.at(-1).url,'/api/plugin/update','内部插件的业务更新不受影响');
 }finally{await proxy.stop();up.closeAllConnections();await new Promise(resolve=>up.close(resolve))}
});
