import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRuntime} from './runtime.mjs';
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

// The native worker gets a synthetic home before importing the runtime. Never
// start the production adapter against the test runner's real Agent profiles.
test('正式 Magpie 隔离资料：内部页面、鉴权、重启和嵌入回归',
 {skip:!process.env.FISH_TEST_MAGPIE,timeout:120000},async t=>{
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie 中文 space-'));
 const env={};
 for(const key of ['SystemRoot','WINDIR','COMSPEC','SystemDrive','PATHEXT'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{PATH:[path.join(process.env.SystemRoot||'C:/Windows','System32'),path.dirname(process.execPath)].join(path.delimiter),
  TEMP:root,TMP:root,HOME:root,USERPROFILE:root,APPDATA:path.join(root,'roaming'),LOCALAPPDATA:path.join(root,'local'),
  XDG_CONFIG_HOME:path.join(root,'xdg'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state'),
  CODEX_HOME:path.join(root,'codex'),CLAUDE_CONFIG_DIR:path.join(root,'claude'),DSH_HOME:path.join(root,'dsh'),
  FISH_TEST_ROOT:root,FISH_TEST_MAGPIE:path.resolve(process.env.FISH_TEST_MAGPIE)});
 for(const key of ['FISH_TEST_PLAYWRIGHT','FISH_TEST_BROWSER','FISH_TEST_EVIDENCE'])if(process.env[key])env[key]=path.resolve(process.env[key]);
 const worker=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/native-check.mjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';worker.stdout.on('data',chunk=>{output+=chunk});worker.stderr.on('data',chunk=>{output+=chunk});
 const code=await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('exit',resolve)});
 assert.equal(code,0,output);t.diagnostic(output.trim());
});
