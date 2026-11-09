// C8：看门狗改成「任务计划拉起的进程」，只在系统代理被本插件接管期间存在。
//
// 为什么不用 spawn(detached)：Windows 上 Node 的 detached 不带
// CREATE_BREAKAWAY_FROM_JOB，子进程仍在宿主给插件建的 Job 里；宿主一死（或崩溃），
// Job 关闭，插件 + mihomo + 看门狗一起消失，没人再还系统代理。
//
// 任务名带当前用户 SID：多用户机器上互不覆盖，同一用户重复启用只会 -Force 覆盖自己。
// 固定 PowerShell 源码 + JSON stdin：租约路径、node 路径、脚本路径、内核 pid 都不拼进源码。
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const WATCHDOG_SCRIPT=fileURLToPath(new URL('./watchdog.mjs',import.meta.url));

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
 $action=New-ScheduledTaskAction -Execute $r.node -Argument ('"'+$r.script+'" '+$arguments) -WorkingDirectory $r.cwd
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
export async function start({leasePath,mihomoPid=0,port=0,ownerPid=0,exec=runPowerShell}={}){
  if(!leasePath||!existsSync(leasePath))return {ok:true,act:'no-lease'};
  const payload={action:'start',node:process.execPath,script:WATCHDOG_SCRIPT,
    args:[quote(ownerPid),quote(leasePath),quote(mihomoPid),quote(port),quote('{taskName}')].join(' '),
    cwd:dirname(WATCHDOG_SCRIPT)};
  return parseAnswer(await exec(SOURCE,payload));
}

// stop：注销任务；任务本来就不存在也算成功（PowerShell 侧 SilentlyContinue）。
export async function stop({exec=runPowerShell}={}){
  return parseAnswer(await exec(SOURCE,{action:'stop'}));
}