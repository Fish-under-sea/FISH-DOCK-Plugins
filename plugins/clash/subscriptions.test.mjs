import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createSubscriptionRuntime,downloadSubscription,subscriptionPath,publicUpdateError} from './subscriptions.mjs';
const id='sub-00000000-0000-0000-0000-000000000001';
const yaml='proxies:\n  - name: same\n    type: ss\n    server: 127.0.0.1\n    port: 9\n    cipher: aes-128-gcm\n    password: synthetic-only\n';
async function temporary(t) {
 const root=await mkdtemp(join(tmpdir(),'fish-clash-中文 '));t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
test('download uses bounded real loopback HTTP transport and rejects HTTP errors, redirects and oversize responses',async t=>{
 let mode='ok',received;
 const server=createServer((req,res)=>{
  received=req.headers;
  if(mode==='timeout')return;
  if(mode==='error'){res.writeHead(403);return res.end('private-token')}
  if(mode==='redirect'){res.writeHead(302,{location:'/leak'});return res.end()}
  res.end(mode==='huge'?'x'.repeat(4*1024*1024+1):mode==='empty'?'':yaml);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));
 const options={fetch:(_url,opts)=>fetch(`http://127.0.0.1:${server.address().port}/sub`,opts)};
 assert.equal((await downloadSubscription('https://example.test/token',options)).toString(),yaml);
 assert.equal(received['user-agent'],'clash.meta');
 for(const [value,code] of [['error','HTTP'],['redirect','REDIRECT'],['huge','TOO_LARGE'],['empty','EMPTY']]){
  mode=value;await assert.rejects(downloadSubscription('https://example.test/token',options),{code});
 }
 mode='timeout';await assert.rejects(downloadSubscription('https://example.test/token',{...options,timeoutMs:25}),{code:'TIMEOUT'});
 const abort=new AbortController();abort.abort();
 await assert.rejects(downloadSubscription('https://example.test/token',{...options,signal:abort.signal}),{code:'CANCELLED'});
 await assert.rejects(downloadSubscription('https://example.test/token',{fetch:async()=>{throw Error('PRIVATE')}}),{code:'NETWORK'});
 assert.equal(publicUpdateError(Error('PRIVATE')).message.includes('PRIVATE'),false);
 await assert.rejects(downloadSubscription('http://example.test/token',options));
});
test('cache transaction retains bytes on validation, apply, and metadata failures and cleans candidate files',async t=>{
 const root=await temporary(t);let bad=false;
 const runtime=createSubscriptionRuntime({dataDirectory:root},{fetch:async()=>new Response(yaml),
  validate:async()=>{if(bad)throw Error('bad YAML');return {nodeCount:1}}});
 await runtime.updateSubscription({id,url:'https://example.test/sub',kernel:'unused'});
 const target=subscriptionPath(root,id);await writeFile(target,'last-good');
 bad=true;await assert.rejects(runtime.updateSubscription({id,url:'https://example.test/sub'}));
 assert.equal(await readFile(target,'utf8'),'last-good');bad=false;
 let calls=0;
 await assert.rejects(runtime.updateSubscription({id,url:'https://example.test/sub',apply:async()=>{calls++;throw Error('controller')}}));
 assert.equal(calls,2);assert.equal(await readFile(target,'utf8'),'last-good');
 await assert.rejects(runtime.updateSubscription({id,url:'https://example.test/sub',commit:async()=>{throw Error('disk')}}));
 assert.equal(await readFile(target,'utf8'),'last-good');assert.deepEqual(await readdir(join(root,'tmp')),[]);
 const abort=new AbortController();abort.abort();
 await assert.rejects(runtime.updateSubscription({id,url:'https://example.test/sub',signal:abort.signal}));
 assert.equal(await readFile(target,'utf8'),'last-good');
});
test('legacy provider cache migration copies only the named cache, and deletion is ID constrained',async t=>{
 const root=await temporary(t);await mkdir(join(root,'config','providers'),{recursive:true});
 await writeFile(join(root,'config','providers','subscription.yaml'),yaml);
 const runtime=createSubscriptionRuntime({dataDirectory:root});
 assert.equal(await runtime.migrateSubscription(id),true);
 assert.equal(await readFile(subscriptionPath(root,id),'utf8'),yaml);
 await assert.rejects(runtime.removeSubscription('../outside'));
 await runtime.removeSubscription(id);
 assert.equal(await readFile(join(root,'config','providers','subscription.yaml'),'utf8'),yaml);
});
test('native mihomo validates real YAML and prefixed nodes, rejects HTML and retains last-good cache',{skip:!process.env.FISH_TEST_MIHOMO,timeout:40000},async t=>{
 const root=await temporary(t);let payload=yaml;
 const runtime=createSubscriptionRuntime({dataDirectory:root},{fetch:async()=>new Response(payload)});
 const c={id,kernel:process.env.FISH_TEST_MIHOMO,url:'https://example.test/synthetic'};
 const result=await runtime.updateSubscription(c);assert.equal(result.nodeCount,1);
 assert.equal(await readFile(subscriptionPath(root,id),'utf8'),yaml);
 payload='<html>Login required: token=synthetic</html>';
 await assert.rejects(runtime.updateSubscription(c),{code:'FORMAT'});
 assert.equal(await readFile(subscriptionPath(root,id),'utf8'),yaml);
 payload='proxies: []\n';
 await assert.rejects(runtime.updateSubscription(c),{code:'EMPTY'});
 assert.equal(await readFile(subscriptionPath(root,id),'utf8'),yaml);
 payload=yaml;
 await assert.rejects(runtime.updateSubscription({...c,kernel:join(root,'missing.exe')}),{code:'KERNEL'});
 assert.deepEqual(await readdir(join(root,'tmp')),[]);
});
