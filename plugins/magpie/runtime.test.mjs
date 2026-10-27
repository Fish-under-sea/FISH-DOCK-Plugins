import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createRuntime} from './runtime.mjs';
import {freePort} from './embed-proxy.mjs';
test('真实 Magpie 独立服务完成就绪、网页访问及进程回收',{skip:!process.env.FISH_TEST_MAGPIE,timeout:90000},async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'fish-magpie-'));
 await fs.mkdir(path.join(root,'config'),{recursive:true});await fs.mkdir(path.join(root,'keys'),{recursive:true});
 const values=new Map();const context={dataDirectory:root,secrets:{read:async(c,n)=>values.get(`${c}/${n}`),write:async(c,n,v)=>values.set(`${c}/${n}`,v)}};
 const runtime=createRuntime(context);let instance;
 try{
  instance=await runtime.start({executable:process.env.FISH_TEST_MAGPIE,port:await freePort()});
  assert.equal(instance.alive(),true);assert.equal(values.get('keys/web-key').length,64);
  const entry=await fetch(instance.url,{redirect:'manual',signal:AbortSignal.timeout(5000)});assert.equal(entry.status,303);
  const attributes=entry.headers.get('set-cookie');assert.match(attributes,/SameSite=None/i);assert.match(attributes,/; Secure/i);assert.match(attributes,/; Partitioned/i);
   const cookie=attributes.split(';')[0];
  assert.equal((await fetch(new URL('/',instance.url),{headers:{cookie},signal:AbortSignal.timeout(5000)})).status,200);
  const names=await fs.readdir(path.join(root,'credentials','magpie-runtime'));assert.ok(names.includes('data'));assert.ok(names.includes('.portable'));
  await instance.stop();assert.equal(instance.alive(),false);
 }finally{await instance?.stop()}
});
