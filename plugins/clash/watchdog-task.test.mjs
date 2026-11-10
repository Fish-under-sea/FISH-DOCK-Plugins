// C8：看门狗改成「任务计划拉起的进程」，只在系统代理接管期间存在。
// 这里只验证命令形状与生命周期判定；执行器全部注入，单测不真起 pwsh、不碰任务表。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {start,stop,scriptHost} from './watchdog-task.mjs';

const scriptPath=fileURLToPath(new URL('./watchdog.mjs',import.meta.url));
const launcherPath=fileURLToPath(new URL('./watchdog-launch.js',import.meta.url));

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

// #50：任务动作必须是 wscript.exe，不是 node.exe。任务计划在交互式会话里启动
// 控制台子系统程序会建一个可见窗口，node 的 windowsHide 管不到，桌面上就一直
// 挂着那个黑窗口。
test('#50 任务动作用 wscript 隐藏启动，不再把 node.exe 交给任务计划',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clash-wd-start-'));
 try{
  const leasePath=join(dir,'system-proxy.json');
  await writeFile(leasePath,'{}');
  const {calls,exec}=capture({ok:true,act:'started',name:'FISH Dock clash watchdog-S-1-5-21-1'});
  const result=await start({leasePath,mihomoPid:4242,port:7895,ownerPid:99,exec,host:'C:\\Windows\\System32\\wscript.exe'});
  assert.equal(result.ok,true);
  assert.equal(result.act,'started');
  assert.equal(calls.length,1);
  const {source,payload}=calls[0];
  // 任务名固定由当前用户 SID 拼出，多用户机器不会互相覆盖。
  assert.match(source,/\[System\.Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value/);
  assert.ok(source.includes('$name="FISH Dock clash watchdog-$sid"'));
  // 动作：wscript + 启动器 + node + watchdog.mjs + 工作目录 + 5 个参数；taskName 运行时替换。
  assert.equal(payload.exec,'C:\\Windows\\System32\\wscript.exe');
  assert.equal(payload.cwd,dirname(scriptPath));
  // //B：脚本自身出错也不弹 WSH 对话框，不能换成别的窗口问题。
  assert.match(payload.args,/^\/\/B \/\/Nologo \/\/E:JScript "[^"]*watchdog-launch\.js" "[^"]*node[^"]*" "[^"]*watchdog\.mjs" "[^"]*" "99" ".*system-proxy\.json" "4242" "7895" "\{taskName\}"$/);
  // 动作的 -Execute 取注入值；node 不再出现在 -Execute 上。
  assert.ok(source.includes('-Execute $r.exec'));
  assert.equal(source.includes('-Execute $r.node'),false,'任务动作不许再直接启动 node.exe');
  assert.ok(source.includes('$arguments=$r.args.Replace(\'{taskName}\',$name)'));
  // 注册 + 立即启动 + 5 分钟重复 10 年；执行上限 13 小时；电池策略不拦。
  assert.ok(source.includes('Register-ScheduledTask -TaskName $name'));
  assert.ok(source.includes('Start-ScheduledTask -TaskName $name'));
  assert.ok(source.includes('-RepetitionInterval (New-TimeSpan -Minutes 5)'));
  assert.ok(source.includes('-RepetitionDuration (New-TimeSpan -Days 3650)'));
  assert.ok(source.includes('MultipleInstances IgnoreNew'));
  assert.ok(source.includes('-ExecutionTimeLimit (New-TimeSpan -Hours 13)'));
  // 电池策略不拦。参数名只用 Windows 真实存在的两个开关：`-DisallowStartIfOnBatteries`
  // 与 `-StopIfGoingOnBatteries` 在 `New-ScheduledTaskSettingsSet` 里不存在，写成它们会让
  // 整条命令在参数绑定时就抛「找不到与参数名称匹配的参数」，任务永远建不起来。
  assert.ok(source.includes('-AllowStartIfOnBatteries'));
  assert.ok(source.includes('-DontStopIfGoingOnBatteries'));
  assert.equal(source.includes('DisallowStartIfOnBatteries'),false,'不存在的参数名会让 Register 前的 bind 直接失败');
  assert.ok(/-Force/.test(source));
  // 配置值（租约路径、node 路径、启动器路径）不得出现在 PowerShell 源码里。
  assert.equal(source.includes(leasePath),false);
  assert.equal(source.includes(process.execPath),false);
  assert.equal(source.includes(launcherPath),false);
 }finally{await rm(dir,{recursive:true,force:true})}
});

// #50：启动器本身要真的以隐藏方式拉起 node，否则换成 wscript 只是多绕一层。
test('#50 启动器用 WScript.Shell.Run(cmd, 0, true) 隐藏启动并等 node',()=>{
 const source=readFileSync(launcherPath,'utf8');
 assert.ok(source.includes("new ActiveXObject('WScript.Shell')"));
 assert.match(source,/\.Run\(cmd,\s*0,\s*true\)/,'第二个参数 0 = SW_HIDE');
 assert.equal(/\.Run\(cmd,\s*0,\s*false\)/.test(source),false,
  'Run 必须等 node：启动器立刻返回会让任务实例马上结束，5 分钟的重复触发就会拉起第二个看门狗，IgnoreNew 形同虚设');
 assert.ok(source.includes('WScript.Arguments'));
 assert.ok(source.includes('CurrentDirectory'),'工作目录要跟着任务动作走，看门狗按相对路径读不到东西');
 // 参数顺序与 watchdog.mjs 的 argv 对齐：父 pid、租约、内核 pid、端口、任务名。
 assert.match(source,/for \(var i = 3; i < a\.length; i\+\+\)/);
 assert.equal(source.includes('slice('),false,'WScript.Arguments 不是数组，没有 slice/join');
 // WSH 按 ANSI 读无 BOM 的 .js：混进 UTF-8 中文注释会把下一行吞掉（实测
 // 「'return' statement outside of function」）。启动器必须保持纯 ASCII。
 const bytes=readFileSync(launcherPath);
 assert.equal(bytes.some(byte=>byte>0x7f),false,'启动器必须是纯 ASCII，否则 WSH 按 ANSI 解析会报错');
 assert.equal(bytes[0],0x2f,'启动器不要写 BOM');
});

// #50：系统禁用 Windows Script Host 时明确失败，不退回直接启动 node.exe
// （那会把黑窗口重新带回来），也不假装任务已经建好。
test('#50 找不到 wscript 时如实失败，不回退到 node.exe',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clash-wd-no-wsh-'));
 try{
  const leasePath=join(dir,'system-proxy.json');
  await writeFile(leasePath,'{}');
  let executed=false;
  const result=await start({leasePath,exec:async()=>{executed=true;return {code:0,stdout:'{}'}},host:''});
  assert.equal(result.ok,false);
  assert.match(result.error,/Windows Script Host/);
  assert.equal(executed,false,'没有启动器就不该建任务');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('scriptHost 只在 wscript.exe 真实存在时返回路径',()=>{
 const found=scriptHost();
 if(process.platform==='win32'){
  assert.match(found,/[\\/]System32[\\/]wscript\.exe$/i);
 }else{
  assert.equal(found,'');
 }
 assert.equal(scriptHost({SystemRoot:'C:\\nowhere'}),'');
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
  const denied=await start({leasePath,exec:failed,host:'C:\\Windows\\System32\\wscript.exe'});
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
