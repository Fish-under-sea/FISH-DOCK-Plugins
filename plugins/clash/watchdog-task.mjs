// C8：看门狗改成「任务计划拉起的进程」，只在系统代理被本插件接管期间存在。
//
// 为什么不用 spawn(detached)：Windows 上 Node 的 detached 不带
// CREATE_BREAKAWAY_FROM_JOB，子进程仍在宿主给插件建的 Job 里；宿主一死（或崩溃），
// Job 关闭，插件 + mihomo + 看门狗一起消失，没人再还系统代理。
//
// 为什么任务动作不是 node.exe（#50）：任务计划在交互式会话里启动控制台子系统程序
// 会新建一个可见的控制台窗口，Node 的 windowsHide 管不到；Dock 内置的 node.exe 就是
// CONSOLE 子系统，直接把它写进任务动作会让桌面一直挂着黑窗口。改成 wscript.exe
// （GUI 子系统，自身不开控制台）拉起 watchdog-launch.js，再由它以 SW_HIDE 启动 node。
//
// 任务名带当前用户 SID：多用户机器上互不覆盖，同一用户重复启用只会 -Force 覆盖自己。
// 固定 PowerShell 源码 + JSON stdin：租约路径、node 路径、脚本路径、内核 pid 都不拼进源码。
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const WATCHDOG_SCRIPT=fileURLToPath(new URL('./watchdog.mjs',import.meta.url));
const WATCHDOG_LAUNCHER=fileURLToPath(new URL('./watchdog-launch.js',import.meta.url));

// 任务动作用 wscript.exe：GUI 子系统，任务计划不会为它建控制台窗口。
export function scriptHost(env=process.env){
  const root=env.SystemRoot||env.windir||'C:\\Windows';
  const file=join(root,'System32','wscript.exe');
  return existsSync(file)?file:'';
}

const SOURCE=`$ErrorActionPreference='Stop'
$r=ConvertFrom-Json ([Console]::In.ReadToEnd())
function Reply($o){$o|ConvertTo-Json -Compress}
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$name="FISH Dock clash watchdog-$sid"
try{
 if($r.action -eq 'stop'){
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  Reply @{ok=$true;act='removed';name=$name}
  exit 0
 }
 $arguments=$r.args.Replace('{taskName}',$name)
 $action=New-ScheduledTaskAction -Execute $r.exec -Argument $arguments -WorkingDirectory $r.cwd
 $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
 $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 13) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
 Start-ScheduledTask -TaskName $name
 Reply @{ok=$true;act='started';name=$name}
}catch{Reply @{ok=$false;message=[string]$_.Exception.Message};exit 1}`;

// 参数按 Windows 命令行引号写：路径可能带空格（Dock 的插件目录就是这样）。
function quote(value){return `"${String(value??'').replace(/"/g,'\\"')}"`}

function parseAnswer(result){
  let answer=null;
  try{answer=JSON.parse(String(result?.stdout??'').trim())}catch{/* 非 JSON 应答下面统一处理 */}
  if(answer&&answer.ok===true)return answer;
  if(answer&&typeof answer.message==='string')return {ok:false,error:answer.message};
  const detail=String(result?.error??'').trim();
  return {ok:false,error:detail||`任务计划命令失败（exit ${result?.code??'?'}）`};
}

function runPowerShell(source,payload){
  return new Promise(resolve=>{
    let child;
    try{
      child=spawn('pwsh',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],
        {windowsHide:true,stdio:['pipe','pipe','pipe']});
    }catch(error){resolve({code:1,stdout:'',error:error?.message??''});return}
    let output='',errors='';
    const timer=setTimeout(()=>{try{child.kill()}catch{};resolve({code:1,stdout:output,error:'任务计划命令超时'})},15000);
    child.on('error',()=>{clearTimeout(timer);resolve({code:1,stdout:'',error:'请先安装 PowerShell 7'})});
    child.stdout.on('data',b=>{output+=b;if(output.length>16384)try{child.kill()}catch{}});
    child.stderr.on('data',b=>{errors=(errors+b).slice(-4096)});
    child.on('close',code=>{
      clearTimeout(timer);
      resolve({code:code??1,stdout:output,error:code===0?'':errors.trim().slice(0,300)});
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
  });
}

// start：没有租约（没接管系统代理）就什么都不建，连 pwsh 都不起。
// 系统禁用了 Windows Script Host 时明确失败——退回直接启动 node.exe 会重新出现
// 那个黑窗口（#50），宁可不建看门狗，也不让用户桌面挂一个窗口。
export async function start({leasePath,mihomoPid=0,port=0,ownerPid=0,exec=runPowerShell,host=scriptHost()}={}){
  if(!leasePath||!existsSync(leasePath))return {ok:true,act:'no-lease'};
  if(!host)return {ok:false,error:'系统未启用 Windows Script Host（找不到 wscript.exe），看门狗无法隐藏启动'};
  const payload={action:'start',exec:host,
    // //B 是批处理模式：脚本自身出错时不弹「Windows Script Host」对话框，任务静默失败、
    // 由 runtime 记日志——桌面不能被看门狗再弹一次窗（#50）。
    args:['//B','//Nologo','//E:JScript',quote(WATCHDOG_LAUNCHER),quote(process.execPath),quote(WATCHDOG_SCRIPT),quote(dirname(WATCHDOG_SCRIPT)),
      quote(ownerPid),quote(leasePath),quote(mihomoPid),quote(port),quote('{taskName}')].join(' '),
    cwd:dirname(WATCHDOG_SCRIPT)};
  return parseAnswer(await exec(SOURCE,payload));
}

// stop：注销任务；任务本来就不存在也算成功（PowerShell 侧 SilentlyContinue）。
export async function stop({exec=runPowerShell}={}){
  return parseAnswer(await exec(SOURCE,{action:'stop'}));
}
