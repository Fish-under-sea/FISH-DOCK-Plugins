import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createRuntime} from './runtime.mjs';
import {subscriptionPath} from './subscriptions.mjs';
const idA='sub-00000000-0000-0000-0000-000000000001',idB='sub-00000000-0000-0000-0000-000000000002';
async function port() {
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const value=server.address().port;await new Promise(r=>server.close(r));return value;
}
test('native SafePath: two credentials providers outside config home, same-name selection and isolated reload',
 {skip:!process.env.FISH_TEST_MIHOMO,timeout:25000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'fish-clash-native 中文 '));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const context={dataDirectory:root,storage:{
  read:async(c,n)=>readFile(join(root,c,n),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e}),
  write:async(c,n,v)=>{await mkdir(join(root,c),{recursive:true});await writeFile(join(root,c,n),v)}
 }};
 await mkdir(join(root,'credentials'));
 const payload=name=>`proxies:\n  - name: ${name}\n    type: ss\n    server: 127.0.0.1\n    port: 9\n    cipher: aes-128-gcm\n    password: synthetic-only\n`;
 for(const id of [idA,idB])await writeFile(subscriptionPath(root,id),payload('same'));
 const runtime=createRuntime(context),controllerPort=await port(),mixedPort=await port(),secret='synthetic-test-only';
 const instance=await runtime.start({kernel:process.env.FISH_TEST_MIHOMO,controllerPort,mixedPort,secret,
  subscriptions:[{id:idA,enabled:true},{id:idB,enabled:true}]});
 t.after(()=>instance.stop());
 const request=async(path,method='GET',body)=>{
  const response=await fetch(`http://127.0.0.1:${controllerPort}${path}`,{method,headers:{
   Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(response.ok,`controller ${method} ${path} returned ${response.status}`);
  return response.status===204?{}:response.json();
 };
 const proxies=(await request('/proxies')).proxies;
 assert.deepEqual(proxies.PROXY.all,[`[${idA}] same`,`[${idB}] same`]);
 await request('/proxies/PROXY','PUT',{name:`[${idB}] same`});
 assert.equal((await request('/proxies')).proxies.PROXY.now,`[${idB}] same`);
 await writeFile(subscriptionPath(root,idA),payload('changed'));
 await request(`/providers/proxies/${idA}`,'PUT');
 const after=(await request('/proxies')).proxies;
 assert.ok(after.PROXY.all.includes(`[${idA}] changed`));assert.ok(after.PROXY.all.includes(`[${idB}] same`));
 assert.equal(after.PROXY.now,`[${idB}] same`);
 assert.equal(await context.storage.read('config','system-proxy.json'),null);
 await instance.stop();
 assert.equal(await context.storage.read('tmp','mihomo-runtime.json'),'');
});
