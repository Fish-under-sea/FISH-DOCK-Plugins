import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import http from 'node:http';
import assert from 'node:assert/strict';
const current=process.env.FISH_TEST_CURRENT_MAGPIE;
const {preparePortableRuntime}=await import(current?pathToFileURL(path.join(current,'plugins/magpie/portable-runtime.mjs')):new URL('../portable-runtime.mjs',import.meta.url));
const {createRuntime}=await import(current?pathToFileURL(path.join(current,'plugins/magpie/runtime.mjs')):new URL('../runtime.mjs',import.meta.url));
import {freePort} from '../embed-proxy.mjs';

const root=process.env.FISH_TEST_ROOT;
assert.ok(root&&process.env.HOME===root&&process.env.USERPROFILE===root);
const previous=process.env.FISH_TEST_PREVIOUS_MAGPIE;
const {preparePortableRuntime:oldPrepare}=await import(pathToFileURL(path.join(previous,'plugins/magpie/portable-runtime.mjs')));
const source=path.join(previous,'service/magpie.exe'),credentials=path.join(root,'credentials');
const legacy=await oldPrepare(source,credentials);
const deny=http.createServer((req,res)=>{res.writeHead(502);res.end()});
deny.on('connect',(req,socket)=>socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
deny.listen(0,'127.0.0.1');await once(deny,'listening');
await fs.writeFile(path.join(legacy.data,'settings.json'),JSON.stringify({noAutoUpdate:true,noAccountDiscovery:true,noStats:true,noUsageStats:true,noWSLAgents:true,proxy:`http://127.0.0.1:${deny.address().port}`}));
await fs.writeFile(path.join(legacy.data,'providers.json'),JSON.stringify({providers:[]}));
const userFile=path.join(legacy.data,'fixture-user-settings.json');await fs.writeFile(userFile,'preserved');
const mcp=spawn(legacy.executable,['mcp','image'],{cwd:root,env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});
let stderr='';mcp.stderr.on('data',chunk=>{stderr+=chunk});
const exit=once(mcp,'exit'),reader=createInterface({input:mcp.stdout}),pending=new Map();
reader.on('line',line=>{try{const row=JSON.parse(line),cb=pending.get(row.id);if(cb){pending.delete(row.id);row.error?cb.reject(Error('MCP returned error')):cb.resolve(row.result)}}catch{}});
let seq=0;const ask=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,...(params?{params}:{})})+'\n')});
let instance;
try{
 await once(mcp,'spawn');
 await ask('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fish-upgrade-fixture',version:'1.0.0'}});
 mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 await ask('ping');
 // 旧发行代码在同一场景向固定目标替换字节时确实被 Windows 阻止。
 if(process.platform==='win32'){
  const probe=path.join(path.dirname(legacy.executable),'.locked-replacement-fixture');await fs.copyFile(source,probe);
  await assert.rejects(fs.rename(probe,legacy.executable),e=>['EPERM','EACCES','EBUSY'].includes(e.code));
  await fs.unlink(probe);
 }
 const prepared=await preparePortableRuntime(process.env.FISH_TEST_MAGPIE,credentials);
 assert.notEqual(prepared.executable,legacy.executable);assert.equal(prepared.data,legacy.data);
 await ask('ping');assert.equal(mcp.exitCode,null);
 const values=new Map(),context={dataDirectory:root,secrets:{read:async(c,n)=>values.get(`${c}/${n}`),write:async(c,n,v)=>values.set(`${c}/${n}`,v)}};
 instance=await createRuntime(context).start({executable:process.env.FISH_TEST_MAGPIE,port:await freePort()});
 const response=await fetch(instance.url,{redirect:'manual'});assert.equal(response.status,303);
 await instance.stop();instance=null;
 await ask('ping');assert.equal(mcp.exitCode,null,'停止 Dock 服务不得结束外部旧 MCP');
 assert.equal(await fs.readFile(userFile,'utf8'),'preserved');
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(legacy.data,'providers.json'),'utf8')),{providers:[]});
 console.log('PASS upgrade 1.0.2: real MCP alive -> old rename EPERM -> new runtime starts with shared data -> stop leaves MCP ping working');
}finally{
 await instance?.stop();reader.close();
 if(mcp.exitCode===null){const killer=spawn('taskkill.exe',['/PID',String(mcp.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});await once(killer,'exit')}
 await exit;deny.closeAllConnections();await new Promise(resolve=>deny.close(resolve));
}
