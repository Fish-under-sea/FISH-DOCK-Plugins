import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

// 真实 Chromium + 与 Dock 相同的 allow-scripts iframe。
// 显式启用；数据只写入唯一测试目录，绝不读取用户订阅或改变系统代理。
const enabled=!!process.env.FISH_TEST_EDGE&&!!process.env.FISH_TEST_PLAYWRIGHT;
test('真实 sandbox 页面：按钮、回车、错误反馈、多订阅落盘与配置保存',{
 skip:enabled?false:'设置 FISH_TEST_EDGE 和 FISH_TEST_PLAYWRIGHT 以启用真实浏览器测试',timeout:45000
},async()=>{
 const require=createRequire(import.meta.url);
 const {chromium}=require(resolve(process.env.FISH_TEST_PLAYWRIGHT));
 const repo=process.env.FISH_TEST_RESOURCE_ROOT?pathToFileURL(resolve(process.env.FISH_TEST_RESOURCE_ROOT)+sep):new URL('../../',import.meta.url);
 const {createClash}=await import(new URL('plugins/clash/service.mjs',repo));
 const bridge=await readFile(resolve(process.env.FISH_TEST_BRIDGE),'utf8');
 const root=await mkdtemp(join(resolve(process.env.FISH_TEST_TMP), 'clash-browser-'));
 const dataDirectory=join(root,'data');await mkdir(dataDirectory,{recursive:true});
 const calls=[],browserErrors=[];
 const storage={
  async read(category,name){try{return await readFile(join(dataDirectory,category,name),'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}},
  async write(category,name,value){await mkdir(join(dataDirectory,category),{recursive:true});await writeFile(join(dataDirectory,category,name),value,'utf8')}
 };
 // 此测试验证页面 RPC 到真实业务保存与文件持久化；凭据使用隔离目录，不模拟真实 DPAPI 密文。
 const context={dataDirectory,storage,secrets:storage};
 const runtime={proxy:{active:()=>false,restore:async()=>{}}};
 const service=createClash({context,runtime,defaultKernel:'D:/synthetic/mihomo.exe'});
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<iframe id="plugin" sandbox="allow-scripts" src="/ticket/plugins/clash/page.html" style="width:1100px;height:1100px"></iframe><script>
     window.addEventListener('message',event=>{const row=event.data;if(row?.type!=='fish:call')return;
      fetch('/rpc',{method:'POST',body:JSON.stringify(row)}).then(r=>r.json()).then(result=>
       event.source.postMessage({type:'fish:result',ticket:row.ticket,id:row.id,...result},'*'));
     });</script>`);return;
   }
   if(req.url==='/rpc'){
    let body='';for await(const b of req)body+=b;
    const {method,params}=JSON.parse(body);calls.push(method);
    res.setHeader('Content-Type','application/json');
    try{
     const result=method==='dock.autostart'?{autostart:false}:await service[method.replace(/^clash\./,'')](params);
     res.end(JSON.stringify({result}));
    }catch(e){res.end(JSON.stringify({error:e.message}));}
    return;
   }
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
   if(url.pathname==='/ticket/bridge.js'){res.setHeader('Content-Type','text/javascript');res.end(bridge);return;}
   const relative=url.pathname.replace(/^\/ticket\//,'');
   let bytes=await readFile(new URL(relative,repo));
   if(relative==='plugins/clash/page.html'){
    bytes=Buffer.from(bytes.toString().replace('<head>','<head><script src="/ticket/bridge.js"></script>'));
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'");
   }
   res.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(bytes);
  }catch{res.writeHead(500);res.end('fixture error');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=join(root,'edge');await mkdir(profile,{recursive:true});
 const edge=spawn(process.env.FISH_TEST_EDGE,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let browser;
 try{
  let port;const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{}
   if(edge.exitCode!==null)throw Error('Edge 启动退出 '+edge.exitCode);
   await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(port,'浏览器 CDP 应就绪');
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
  const page=await browser.contexts()[0].newPage();
  page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});
  page.on('pageerror',e=>browserErrors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const frame=page.frameLocator('#plugin');
  await frame.locator('[data-action="section-providers"]').click();
  // 点击：业务代码实际落盘，出现第一张卡。
  await frame.locator('#subscription-name').fill('合成订阅 A');
  await frame.locator('#subscription-url').fill('https://example.test/a?token=synthetic');
  await frame.locator('[data-action="save-subscription"]').click();
  await frame.locator('.subscription').filter({hasText:'合成订阅 A'}).waitFor();
  assert.equal(calls.filter(x=>x==='clash.subscriptionSave').length,1);
  // 回车：创建第二张卡，多订阅独立保存。
  await frame.locator('#subscription-name').fill('合成订阅 B');
  await frame.locator('#subscription-url').fill('https://example.test/b');
  await frame.locator('#subscription-url').press('Enter');
  await frame.locator('.subscription').filter({hasText:'合成订阅 B'}).waitFor();
  assert.equal(await frame.locator('.subscription').count(),2);
  const saved=JSON.parse(await storage.read('config','subscriptions.json'));
  assert.equal(saved.subscriptions.length,2);
  assert.notEqual(saved.subscriptions[0].id,saved.subscriptions[1].id);
  // 真实后端固定错误：立即可见，输入保留，无第三个条目。
  await frame.locator('#subscription-name').fill('token=synthetic-invalid-name');
  await frame.locator('#subscription-url').fill('https://example.test/c?token=synthetic');
  await frame.locator('[data-action="save-subscription"]').click();
  await frame.locator('.banner[role="alert"]').filter({hasText:'请输入 1–80 字'}).waitFor();
  assert.equal(await frame.locator('#subscription-name').inputValue(),'token=synthetic-invalid-name');
  assert.equal(await frame.locator('.subscription').count(),2);
  assert.ok(!(await frame.locator('.banner[role="alert"]').textContent()).includes('synthetic'));
  // 内核配置同样在 allow-scripts 环境内保存，不要求放开 allow-forms。
  await frame.locator('#settings summary').click();
  await frame.locator('#mixedPort').fill('7897');
  await frame.locator('[data-action="save-config"]').click();
  await frame.locator('.banner[role="status"]').filter({hasText:'内核设置已保存'}).waitFor();
  assert.equal(JSON.parse(await storage.read('config','clash.json')).mixedPort,7897);
  // 重建业务实例读取隔离目录，验证非仅页面内存状态。
  const reloaded=createClash({context,runtime,defaultKernel:'D:/synthetic/mihomo.exe'});
  assert.equal((await reloaded.view({controller:false})).subscriptions.length,2);
  assert.deepEqual(browserErrors,[]);
  await page.screenshot({path:join(root,'result.png'),fullPage:true});
  console.log(JSON.stringify({sandbox:'allow-scripts',savedSubscriptions:saved.subscriptions.length,
   saveCalls:calls.filter(x=>x==='clash.subscriptionSave').length,configSaved:true,browserErrors,artifact:root}));
 }finally{
  if(browser)await browser.close();
  if(edge.exitCode===null)edge.kill();
  await new Promise(r=>server.close(r));
 }
});
