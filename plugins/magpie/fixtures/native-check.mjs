import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {createRuntime} from '../runtime.mjs';
import {freePort} from '../embed-proxy.mjs';
import {preparePortableRuntime} from '../portable-runtime.mjs';
import {checkRelay} from './relay-check.mjs';
import {checkVault} from './vault-check.mjs';

const root=process.env.FISH_TEST_ROOT;
assert.ok(root&&process.env.HOME===root&&process.env.USERPROFILE===root);
const values=new Map(),context={dataDirectory:root,secrets:{read:async(c,n)=>values.get(`${c}/${n}`),write:async(c,n,v)=>values.set(`${c}/${n}`,v)}};
// Native background catalog/news requests are refused locally, never forwarded.
const deny=http.createServer((req,res)=>{res.writeHead(502);res.end()});
deny.on('connect',(req,socket)=>socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
deny.listen(0,'127.0.0.1');await once(deny,'listening');
const portable=await preparePortableRuntime(process.env.FISH_TEST_MAGPIE,path.join(root,'credentials'));
await fs.writeFile(path.join(portable.data,'settings.json'),JSON.stringify({noAutoUpdate:true,noAccountDiscovery:true,noStats:true,noUsageStats:true,noWSLAgents:true,proxy:`http://127.0.0.1:${deny.address().port}`,lang:'en'}));
const fixture=path.join(root,'内部插件 usage glance');await fs.mkdir(path.join(fixture,'page'),{recursive:true});
await fs.writeFile(path.join(fixture,'package.json'),JSON.stringify({name:'magpie-usage-glance',version:'0.1.0',magpie:{page:{title:'Usage glance',titles:{zh:'用量速览'},file:'page/index.html'},permissions:['usage:summary']}}));
await fs.writeFile(path.join(fixture,'page/index.html'),'<!doctype html><meta charset="utf-8"><title>Usage glance</title><script src="_magpie/bridge.js"></script><script defer src="app.js"></script><h1>Usage glance</h1><p id="calls">Loading</p>');
await fs.writeFile(path.join(fixture,'page/app.js'),`(async()=>{await magpie.ready;const s=await magpie.read('usage:summary',{period:'today'});document.querySelector('#calls').textContent=s.calls+' calls';})()`);
await fs.writeFile(path.join(portable.data,'plugins.json'),JSON.stringify({plugins:[{spec:fixture,options:{fixture:true}}]}));
const runtime=createRuntime(context),port=await freePort();
// Never pick a gateway port a real Magpie may already own on this computer.
let gatewayPort=await freePort();while(gatewayPort===port)gatewayPort=await freePort();
let instance,browser;
async function login(){
 const entry=await fetch(instance.url,{redirect:'manual'});assert.equal(entry.status,303);
 assert.match(entry.headers.get('set-cookie'),/SameSite=None; Secure; Partitioned/);
 return entry.headers.get('set-cookie').split(';')[0];
}
try{
 instance=await runtime.start({executable:process.env.FISH_TEST_MAGPIE,port,gatewayPort});
 const cookie=await login(),origin=new URL(instance.url).origin;
 // Native authentication and the Dock cookie-injecting proxy are different
 // boundaries: test both, not a stale 401 expectation on the trusted proxy.
 assert.equal((await fetch(`http://127.0.0.1:${instance.upstreamPort}/api/plugin-pages`)).status,401);
 assert.equal((await fetch(origin+'/api/plugin-pages')).status,200);
 const pages=await (await fetch(origin+'/api/plugin-pages',{headers:{cookie}})).json();
 assert.equal(pages.length,1);const entry=pages[0];
 assert.match(entry.url,/^\/_magpie\/plugin\/[0-9a-f]{32}\/index.html$/);
 const page=await fetch(origin+entry.url);assert.equal(page.status,200);
 const csp=page.headers.get('content-security-policy');
 // Fish pages can nest sandboxed parts with opaque origins: an ancestor
 // directive would block those parts. Access is a per-run token capability.
 assert.ok(!csp.includes('frame-ancestors'));
 const ownPrefix=entry.url.slice(0,entry.url.lastIndexOf('/')+1);
 const connect=csp.split(';').find(row=>row.trim().startsWith('connect-src')).trim().split(/\s+/).slice(1);
 assert.ok(connect.length>0);
 for(const allowed of connect){const u=new URL(allowed);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.pathname,ownPrefix)}
 assert.match(csp,/sandbox allow-scripts/);
 for(const relative of ['app.js','_magpie/bridge.js'])assert.equal((await fetch(new URL(relative,origin+entry.url))).status,200);
 const result=await fetch(origin+'/api/plugin-pages/read',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({spec:entry.spec,read:'usage:summary',params:{period:'today'}})});
 assert.equal(result.status,200);assert.equal((await result.json()).calls,0);
 const forbidden=await fetch(origin+'/api/plugin-pages/read',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({spec:entry.spec,read:'providers:list'})});
 assert.equal(forbidden.status,403);
 const framed=await fetch(origin+'/api/plugin-pages/read',{method:'POST',headers:{cookie,origin:'null','content-type':'application/json'},body:'{}'});
 assert.equal(framed.status,403);
 console.log('PASS native: token files + relative bridge/app 200; native unauthenticated API 401; Dock proxy supplies cookie; same-token assets only; allowed read 0 calls; undeclared/framed read 403');
 const scriptResponse=await fetch(origin+'/app.js',{headers:{cookie}});assert.equal(scriptResponse.status,200);
 const script=await scriptResponse.text();new Script(script);assert.match(script,/版本由 FISH Dock 插件管理/);
 assert.ok(script.includes("about.querySelectorAll('.update-pill-row,.update-auto-row"),'更新控件由定点 DOM 处理移除，普通配置行不切掉');
 const update=await (await fetch(origin+'/api/update/check',{method:'POST',headers:{cookie}})).json();assert.equal(update.managed,true);

 if(process.env.FISH_TEST_PLAYWRIGHT){
  const {chromium}=createRequire(import.meta.url)(process.env.FISH_TEST_PLAYWRIGHT);
  browser=await chromium.launch({headless:true,...(process.env.FISH_TEST_BROWSER?{executablePath:process.env.FISH_TEST_BROWSER}:{})});
  const evidence=process.env.FISH_TEST_EVIDENCE;if(evidence)await fs.mkdir(evidence,{recursive:true});
  for(const baseline of [true,false]){
   const bc=await browser.newContext(),tab=await bc.newPage(),errors=[],failures=[];
   // A normal browser prompts for loopback access; the Tauri shell has its
   // own host policy. Grant only this synthetic origin in this test context.
   await bc.grantPermissions(['local-network-access'],{origin:'http://tauri.localhost'});
   tab.on('requestfailed',r=>failures.push({path:new URL(r.url()).pathname.replace(/[a-f0-9]{32}/g,'<token>'),reason:r.failure()?.errorText}));
   tab.on('console',m=>{if(m.type()==='error'&&m.text().includes('frame-ancestors'))errors.push('frame-ancestors blocked')});
   await bc.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin==='http://tauri.localhost')return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Dock fixture</title><iframe style="width:1200px;height:850px" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" referrerpolicy="no-referrer" src="${instance.url}"></iframe>`});
    if(u.hostname!=='127.0.0.1')return route.abort();
    if(baseline&&u.pathname.startsWith('/_magpie/plugin/')){
     const response=await route.fetch(),headers=response.headers();
     if(headers['content-security-policy'])headers['content-security-policy'] += "; frame-ancestors 'self'";
     return route.fulfill({response,headers});
    }
    return route.continue();
   });
   await tab.goto('http://tauri.localhost/');
   const outer=tab.frameLocator('iframe');
   await outer.locator(`[data-view="${entry.key}"]`).first().dispatchEvent('click',{timeout:15000});
   if(baseline){
    await assert.rejects(outer.frameLocator('iframe.plugin-frame').locator('#calls').waitFor({state:'attached',timeout:4000}));
    assert.ok(errors.length,'baseline must produce a frame-ancestors console violation; failed requests: '+JSON.stringify(failures));
   }else{
    await outer.frameLocator('iframe.plugin-frame').locator('#calls').filter({hasText:'0 calls'}).waitFor({state:'attached',timeout:15000});
    assert.equal(errors.length,0);
    const child=tab.frames().find(f=>f.url().includes('/_magpie/plugin/'));
    assert.ok(child);
    const restrictions=await child.evaluate(async()=>{
     let network=false,storage=false,parentAccess=false;
     try{await fetch('/api/state');network=true}catch{}
     try{localStorage.getItem('x');storage=true}catch{}
     try{void parent.document;parentAccess=true}catch{}
     return {network,storage,parentAccess};
    });
    assert.deepEqual(restrictions,{network:false,storage:false,parentAccess:false});
     await outer.locator('#prefs').dispatchEvent('click');
     await outer.locator('[data-set="about"]').dispatchEvent('click');
     await outer.locator('#about').getByText('版本由 FISH Dock 插件管理，请在 Dock 插件页更新').waitFor({state:'attached'});
     assert.equal(await outer.locator('.update-auto-row, .update-every-row, .update-download-row, .update-restart-row, .update-pill-row').count(),0);
     assert.equal(await outer.locator('#about > .row').first().locator('button').count(),0);
     assert.equal(await outer.locator('.whatsnew-row').count(),0);
      assert.equal(await outer.locator('#update').isVisible(),false);
   }
   if(evidence)try{await tab.screenshot({path:path.join(evidence,baseline?'before.png':'after.png'),timeout:5000})}catch{console.log('SKIP screenshot: headless compositor timeout')}
   await bc.close();
  }
  const bc=await browser.newContext(),tab=await bc.newPage();let blocked=false;
  await bc.grantPermissions(['local-network-access'],{origin:'http://untrusted.localhost'});
  tab.on('console',m=>{if(m.text().includes('frame-ancestors'))blocked=true});
  await bc.route('http://untrusted.localhost/**',route=>route.fulfill({contentType:'text/html',body:`<iframe src="${origin+entry.url}"></iframe>`}));
  await tab.goto('http://untrusted.localhost/');
  await tab.frameLocator('iframe').locator('#calls').filter({hasText:'0 calls'}).waitFor({state:'attached',timeout:15000});
  // A holder of the token can embed the capability, but its opaque sandbox
  // still cannot read the embedding page or the authenticated management API.
  const child=tab.frames().find(f=>f.url().includes('/_magpie/plugin/'));
  assert.deepEqual(await child.evaluate(async()=>{let network=false,parentAccess=false;try{await fetch('/api/state');network=true}catch{}try{void parent.document;parentAccess=true}catch{}return {network,parentAccess}}),{network:false,parentAccess:false});
  await bc.close();
  console.log('PASS browser: adding self-only ancestors rejects Dock nesting; token-scoped pages render 0 calls; external network/storage/parent access remain blocked even in another embedding page');
 }else console.log('SKIP browser: set FISH_TEST_PLAYWRIGHT to the installed playwright module');

 await checkVault({data:portable.data,origin,cookie,gatewayPort:instance.gatewayPort});
 await checkRelay({origin,cookie,data:portable.data});
 await instance.stop();assert.equal(instance.alive(),false);
 await assert.rejects(fetch(origin+'/',{signal:AbortSignal.timeout(1000)}));
 instance=await runtime.start({executable:process.env.FISH_TEST_MAGPIE,port,gatewayPort});
 const newCookie=await login();
 assert.equal((await fetch(origin+entry.url)).status,404);
 const next=await (await fetch(origin+'/api/plugin-pages',{headers:{cookie:newCookie}})).json();
 assert.notEqual(next[0].url,entry.url);assert.equal((await fetch(origin+next[0].url)).status,200);
 assert.equal(JSON.parse(await fs.readFile(path.join(portable.data,'plugins.json'))).plugins[0].options.fixture,true);
 console.log('PASS lifecycle: stop releases listener; restart invalidates old token (404), returns new working URL, retains plugin settings');
}finally{
 await browser?.close();
 await instance?.stop();
 deny.closeAllConnections();await new Promise(resolve=>deny.close(resolve));
}
