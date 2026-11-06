import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createRuntime,isRetryableFailure,packagedExecutablePath,startWithBackoff} from './runtime.mjs';
import {available} from '../../shared/child.mjs';
import {serviceError} from '../../shared/errors.mjs';
import {freePort} from './embed-proxy.mjs';
import net from 'node:net';
import {once} from 'node:events';

test('启动已取消时不创建资料或启动子进程',async()=>{
 const root=path.join(os.tmpdir(),`magpie-cancel-${crypto.randomUUID()}`);
 await assert.rejects(createRuntime({dataDirectory:root}).start({signal:AbortSignal.abort()}),{name:'AbortError'});
 await assert.rejects(fs.stat(root),{code:'ENOENT'});
});

test('无效服务文件与占用端口提供确定错误；失败后不留下服务副本',async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-preflight-'));
 const runtime=createRuntime({dataDirectory:root,secrets:{read:async()=> 'a'.repeat(64)}});
 await assert.rejects(runtime.start({executable:path.join(root,'missing.exe'),port:await freePort()}),{code:'EXECUTABLE_MISSING'});
 await assert.rejects(runtime.start({executable:root,port:await freePort()}),{code:'EXECUTABLE_INVALID'});
 const file=path.join(root,'fixture.exe');await fs.writeFile(file,'not executed');
 await assert.rejects(createRuntime({dataDirectory:file}).start({executable:file,port:await freePort()}),{code:'DATA_UNWRITABLE'});
 const occupied=net.createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');
 try{await assert.rejects(runtime.start({executable:file,port:occupied.address().port}),{code:'PORT_IN_USE'})}
 finally{await new Promise(resolve=>occupied.close(resolve))}
 await assert.rejects(fs.stat(path.join(root,'credentials/magpie-runtime')),{code:'ENOENT'});
});

// 先占住服务端口，再复制运行时、拉起子进程：端口在手，几十秒的 TOCTOU 窗口不存在。
test('服务端口在准备运行时之前已被占住，子进程失败后释放',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-bind-first-'));
 const file=path.join(root,'fixture.exe');await fs.writeFile(file,'not a real executable');
 const port=await freePort();const runtime=createRuntime({dataDirectory:root,secrets:{read:async()=>'a'.repeat(64)}});
 let held='unprobed';
 const start=runtime.start({executable:file,port,onPhase:phase=>{
  if(phase!=='prepare-data'||held!=='unprobed')return;
  // 复制运行时这一刻若端口已被代理绑定，再绑一次必然冲突。
  const probe=net.createServer();
  probe.once('error',error=>{held=error.code});
  probe.listen(port,'127.0.0.1',()=>{held='free';probe.close()});
 }});
 const error=await start.catch(error=>error);
 for(let wait=0;held==='unprobed'&&wait<100;wait++)await delay(10);
 assert.equal(error.code,'SPAWN_FAILED');
 assert.equal(held,'EADDRINUSE');
 await available(port);
});

// 端口被占时在绑定阶段就失败：既不复制运行副本，也没有子进程被拉起再回滚。
test('端口被占在绑定阶段失败，不复制运行副本',async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-bind-fail-'));
 const file=path.join(root,'fixture.exe');await fs.writeFile(file,'not executed');
 const occupied=net.createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');
 try{
  const runtime=createRuntime({dataDirectory:root,secrets:{read:async()=>'a'.repeat(64)}});
  const error=await runtime.start({executable:file,port:occupied.address().port}).catch(error=>error);
  assert.equal(error.code,'PORT_IN_USE');
  assert.equal(error.message,serviceError('PORT_IN_USE').message);
  await assert.rejects(fs.stat(path.join(root,'credentials','magpie-runtime')),{code:'ENOENT'});
 }finally{await new Promise(resolve=>occupied.close(resolve))}
});

// 失败必须落盘：原始 code、阶段、端口、时间，进程重启后仍可查。
test('启动失败写 gateway-error.log，含 code/阶段/端口/时间并跨实例保留',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-errorlog-'));
 const file=path.join(root,'fixture.exe');await fs.writeFile(file,'not a real executable');
 const port=await freePort();
 await createRuntime({dataDirectory:root,secrets:{read:async()=>'a'.repeat(64)}}).start({executable:file,port}).catch(()=>{});
 const log=path.join(root,'gateway-error.log');
 const first=JSON.parse((await fs.readFile(log,'utf8')).trim().split('\n').at(-1));
 assert.equal(first.code,'SPAWN_FAILED');
 assert.ok(first.nativeCode,JSON.stringify(first));
 assert.equal(first.phase,'start-process');
 assert.equal(first.port,port);
 assert.equal(Number.isNaN(Date.parse(first.time)),false);
 // 新实例（等价于插件进程重启）再失败一次：旧记录仍在，说明写的是磁盘而不是内存。
 await createRuntime({dataDirectory:path.join(root,''),secrets:{read:async()=>'a'.repeat(64)}}).start({executable:path.join(root,'missing.exe'),port}).catch(()=>{});
 const lines=(await fs.readFile(log,'utf8')).trim().split('\n');
 assert.equal(lines.length,2);
 const second=JSON.parse(lines[1]);
 assert.equal(second.code,'EXECUTABLE_MISSING');assert.equal(second.port,port);
 assert.equal(Number.isNaN(Date.parse(second.time)),false);
});

test('gateway error 按退避重试，用尽后定住并保留原因',async()=>{
 const calls=[];
 const failing={view:()=>({state:'error',error:'端口已被占用，请停止冲突服务或更换本机端口后重试',port:3425}),
  async start(){calls.push(Date.now());return this.view()}};
 const view=await startWithBackoff(failing,{attempts:3,delays:[20,60]});
 assert.equal(calls.length,3);
 assert.ok(calls[1]-calls[0]>=10);
 assert.ok(calls[2]-calls[1]>=30);
 assert.equal(view.state,'error');
 assert.equal(view.error,'端口已被占用，请停止冲突服务或更换本机端口后重试');
});

test('恢复或用户停止时不再重试；不可恢复的失败一次定住',async()=>{
 let calls=0;
 const recovering={view:()=>({state:calls<2?'error':'running'}),async start(){calls++;return this.view()}};
 const recovered=await startWithBackoff(recovering,{attempts:3,delays:[10,10]});
 assert.equal(calls,2);assert.equal(recovered.state,'running');

 calls=0;let stopped=false;
 const cancelled={view:()=>({state:stopped?'stopped':'error'}),async start(){calls++;return this.view()}};
 const pending=startWithBackoff(cancelled,{attempts:3,delays:[50,50]});
 await delay(10);stopped=true;
 const after=await pending;
 assert.equal(calls,1);assert.equal(after.state,'stopped');

 calls=0;
 const fatal={view:()=>({state:'error',error:'服务文件不存在'}),async start(){calls++;return this.view()}};
 const fatalView=await startWithBackoff(fatal,{attempts:3,delays:[10,10],shouldRetry:()=>isRetryableFailure('EXECUTABLE_MISSING')});
 assert.equal(calls,1);assert.equal(fatalView.error,'服务文件不存在');
});

test('重试白名单只放过换时机可能成功的失败；旧包路径可被识别重写',()=>{
 for(const code of ['PORT_IN_USE','PORT_BIND_DENIED','FILE_BUSY','PERMISSION_DENIED','RUNTIME_COPY_FAILED','GATEWAY_ERROR','UNKNOWN_ERROR','SPAWN_FAILED','EARLY_EXIT','READY_TIMEOUT'])
  assert.equal(isRetryableFailure(code),true,code);
 for(const code of ['EXECUTABLE_MISSING','EXECUTABLE_INVALID','DATA_UNWRITABLE','DATA_MIGRATION_FAILED','SETTINGS_INVALID','RUNTIME_INTEGRITY','INVALID_READY_URL','STOP_FAILED'])
  assert.equal(isRetryableFailure(code),false,code);
 assert.equal(isRetryableFailure(undefined),true);
 for(const value of ['C:/Users/a/AppData/Local/Fish/packages/fish.magpie/2.1.1/abc/service/magpie.exe','D:\\Fish\\packages\\fish.magpie\\2.1.0\\deadbeef\\service\\magpie.exe'])
  assert.equal(packagedExecutablePath(value),true,value);
 for(const value of ['C:/Users/me/tools/magpie.exe',`C:/x/credentials/magpie-runtime/magpie-${'a'.repeat(64)}.exe`,undefined,''])
  assert.equal(packagedExecutablePath(value),false,String(value));
});

// The native worker gets a synthetic home before importing the runtime. Never
// start the production adapter against the test runner's real Agent profiles.
test('正式 Magpie 隔离资料：内部页面、鉴权、重启和嵌入回归',
 {skip:!process.env.FISH_TEST_MAGPIE,timeout:120000},t=>runNative(t,'native-check.mjs'));
test('正式1.0.2旧MCP保持运行时新版可启动，停止不影响旧MCP与资料',
 {skip:!process.env.FISH_TEST_MAGPIE||!process.env.FISH_TEST_PREVIOUS_MAGPIE,timeout:60000},t=>runNative(t,'upgrade-check.mjs'));
async function runNative(t,fixture){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie 中文 space-'));
 const env={};
 for(const key of ['SystemRoot','WINDIR','COMSPEC','SystemDrive','PATHEXT'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{PATH:[path.join(process.env.SystemRoot||'C:/Windows','System32'),path.dirname(process.execPath)].join(path.delimiter),
  TEMP:root,TMP:root,HOME:root,USERPROFILE:root,APPDATA:path.join(root,'roaming'),LOCALAPPDATA:path.join(root,'local'),
  XDG_CONFIG_HOME:path.join(root,'xdg'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state'),
  CODEX_HOME:path.join(root,'codex'),CLAUDE_CONFIG_DIR:path.join(root,'claude'),DSH_HOME:path.join(root,'dsh'),
  FISH_TEST_ROOT:root,FISH_TEST_MAGPIE:path.resolve(process.env.FISH_TEST_MAGPIE)});
 for(const key of ['FISH_TEST_PLAYWRIGHT','FISH_TEST_BROWSER','FISH_TEST_EVIDENCE','FISH_TEST_PREVIOUS_MAGPIE','FISH_TEST_CURRENT_MAGPIE'])if(process.env[key])env[key]=path.resolve(process.env[key]);
 const worker=spawn(process.execPath,[fileURLToPath(new URL(`./fixtures/${fixture}`,import.meta.url))],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(worker.exitCode===null){const killer=spawn('taskkill.exe',['/PID',String(worker.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});await once(killer,'exit')}});
 let output='';worker.stdout.on('data',chunk=>{output+=chunk});worker.stderr.on('data',chunk=>{output+=chunk});
 const code=await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('exit',resolve)});
 assert.equal(code,0,output);t.diagnostic(output.trim());
}

// #30：网关端口不再按「是否共享」分叉——两条分支都走 gatewayPortFor（固定候选），
// 只剩插件内部代理的上游端口还随机（它不对外，随机无妨）。这是接线守卫：候选
// 顺序由 network.test 覆盖，这里只盯「有没有真的接上」和「随机那半有没有删净」。
test('#30 网关端口不再在非共享时随机挑，也不许再按 lan 分叉',async()=>{
 const source=await fs.readFile(new URL('./runtime.mjs',import.meta.url),'utf8');
 assert.match(source,/gatewayPortFor\(\{configured:gatewayPort/,'监听端口要走固定候选');
 assert.doesNotMatch(source,/prefs\.lan\s*\?\s*await\s*lanGatewayPort/,'不许再按 lan 分叉');
 assert.doesNotMatch(source,/while\(listeningPort===port\|\|listeningPort===upstreamPort\)/,'监听端口不许再随机挑');
 assert.match(source,/upstreamPort=await freePort\(\)/,'上游端口仍随机（内部用，不对外）');
 assert.match(source,/gatewayPort:listeningPort/,'要把实际监听的端口回给上层，供写回配置');
});