// C8：看门狗改成「任务计划拉起的进程」，只在系统代理接管期间存在。
// 这里只验证命令形状与生命周期判定；执行器全部注入，单测不真起 pwsh、不碰任务表。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start,stop} from './watchdog-task.mjs';

const scriptPath=fileURLToPath(new URL('./watchdog.mjs',import.meta.url));

function capture(answer) {
  const calls=[];
  return {calls,exec:async(source,payload)=>{calls.push({source,payload});return {code:0,stdout:JSON.stringify(answer)}}};
}

test('C8 没有租约时什么都不建：连 pwsh 都不起',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clash-wd-none-'));
 try{
  let executed=false;
  const result=await start({leasePath:join(dir,'system-proxy.json'),mihomoPid:1,port:7895,ownerPid:2,
   exec:async()=>{executed=true;return {code:0,stdout:'{}'}}});
  assert.deepEqual(result,{ok:true,act:'no-lease'});
  assert.equal(executed,false,'没接管就不该创建任务（也不该起 pwsh）');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('C8 有租约时注册并启动任务：参数走 JSON stdin，配置值不拼进源码',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clash-wd-start-'));
 try{
  const leasePath=join(dir,'system-proxy.json');
  await writeFile(leasePath,'{}');
  const {calls,exec}=capture({ok:true,act:'started',name:'FISH Dock clash watchdog-S-1-5-21-1'});
  const result=await start({leasePath,mihomoPid:4242,port:7895,ownerPid:99,exec});
  assert.equal(result.ok,true);
  assert.equal(result.act,'started');
  assert.equal(calls.length,1);
  const {source,payload}=calls[0];
  // 任务名固定由当前用户 SID 拼出，多用户机器不会互相覆盖。
  assert.match(source,/\[System\.Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value/);
  assert.ok(source.includes('$name="FISH Dock clash watchdog-$sid"'));
  // 动作：node + watchdog.mjs + 5 个参数；taskName 由 PowerShell 在运行时替换。
  assert.equal(payload.node,process.execPath);
  assert.equal(payload.script,scriptPath);
  assert.equal(payload.cwd,dirname(scriptPath));
  assert.match(payload.args,/^"99" ".*system-proxy\.json" "4242" "7895" "\{taskName\}"$/);
  assert.ok(source.includes('$arguments=$r.args.Replace(\'{taskName}\',$name)'));
  // 注册 + 立即启动 + 5 分钟重复 10 年；执行上限 13 小时；电池策略不拦。
  assert.ok(source.includes('Register-ScheduledTask -TaskName $name'));
  assert.ok(source.includes('Start-ScheduledTask -TaskName $name'));
  assert.ok(source.includes('-RepetitionInterval (New-TimeSpan -Minutes 5)'));
  assert.ok(source.includes('-RepetitionDuration (New-TimeSpan -Days 3650)'));
  assert.ok(source.includes('MultipleInstances IgnoreNew'));
  assert.ok(source.includes('-ExecutionTimeLimit (New-TimeSpan -Hours 13)'));
  assert.ok(source.includes('-DisallowStartIfOnBatteries:$false'));
  assert.ok(source.includes('-StopIfGoingOnBatteries:$false'));
  assert.ok(/-Force/.test(source));
  // 配置值（租约路径、node 路径）不得出现在 PowerShell 源码里。
  assert.equal(source.includes(leasePath),false);
  assert.equal(source.includes(process.execPath),false);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('C8 停止时注销任务；任务不存在也算成功',async()=>{
 const {calls,exec}=capture({ok:true,act:'removed'});
 const result=await stop({exec});
 assert.equal(result.ok,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].payload.action,'stop');
 assert.ok(calls[0].source.includes('Unregister-ScheduledTask -TaskName $name -Confirm:$false'));
 assert.ok(calls[0].source.includes('-ErrorAction SilentlyContinue'),'任务不存在时不能报失败');
});

test('C8 执行器失败如实返回 ok:false，不假装任务已建好',async()=>{
 const {exec}=capture({ok:false,message:'Access is denied'});
 exec.mock=null;
 const failed=async()=>({code:1,stdout:JSON.stringify({ok:false,message:'Access is denied'})});
 const result=await start({leasePath:join(tmpdir(),'fish-clash-wd-missing','x.json'),exec:failed});
 assert.equal(result.ok,true);
 assert.equal(result.act,'no-lease','路径不存在时先判租约，连执行器都不调用');
 const dir=await mkdtemp(join(tmpdir(),'clash-wd-fail-'));
 try{
  const leasePath=join(dir,'system-proxy.json');
  await writeFile(leasePath,'{}');
  const denied=await start({leasePath,exec:failed});
  assert.equal(denied.ok,false);
  assert.match(denied.error,/Access is denied/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('C8 看门狗退出时用 schtasks 删除自己的任务（execFile，不拼 shell）',async()=>{
 const {deleteTask}=await import('./watchdog.mjs');
 const calls=[];
 const run=(file,args,options,callback)=>{calls.push({file,args,options});callback(null,'','')};
 const result=await deleteTask('FISH Dock clash watchdog-S-1-5-21-1',run);
 assert.deepEqual(result,{ok:true});
 assert.deepEqual(calls[0].file,'schtasks');
 assert.deepEqual(calls[0].args,['/Delete','/TN','FISH Dock clash watchdog-S-1-5-21-1','/F']);
 assert.equal(calls[0].options.windowsHide,true);
 const skipped=await deleteTask('',run);
 assert.deepEqual(skipped,{ok:true,skipped:true});
 assert.equal(calls.length,1,'没有任务名时什么都不做');
});