// 独立看门狗：Dock 被强杀（或更新时宿主直接消失）以后，插件进程没了，没人再去
// 恢复系统代理——注册表还指着 127.0.0.1:<mixedPort>，内核要么已经死了（彻底断网），
// 要么还挂着但没人管（节点一换就回环）。这个进程由「任务计划」拉起（watchdog-task.mjs），
// 独立于宿主给插件建的 Job，只干一件事：父进程一消失，就把系统代理还原、把内核结束掉。
//
// 为什么不在插件里做：宿主被 Task Manager 结束时插件进程同时被杀，任何「退出时清理」
// 的代码都来不及跑；只有另起一个进程才盯得住。
//
// 它不碰 stdio 管道（宿主死了管道会断），也不需要宿主提供的 storage：租约就用
// <dataDirectory>/config/system-proxy.json 这个真实文件。
import {existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, appendFileSync, statSync} from 'node:fs';
import {dirname} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const RECORD_KEYS = ['ProxyEnable', 'ProxyServer', 'ProxyOverride'];

export function sameProxy(a, b) {
  return !!a && !!b && RECORD_KEYS.every((k) => a[k] === b[k]);
}

// plan 决定看门狗该做什么（纯函数，便于单测）：
//   restore —— 注册表里还是我们写的那份，还原 previous
//   discard —— 记录无效，或者注册表已经被别人改过：只清记录，别动别人的设置
//   superseded —— 租约已经属于新的插件实例（owner.pid 变了）：什么都不做
export function plan(record, current, parentPid) {
  if (!record || record.schema !== 1 || !record.previous || !record.owned) return {act: 'discard'};
  if (record.owner && Number.isInteger(record.owner.pid) && record.owner.pid !== parentPid) return {act: 'superseded'};
  if (!sameProxy(current, record.owned)) return {act: 'discard'};
  return {act: 'restore', previous: record.previous};
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 与 runtime.mjs 同一套脚本：固定 PowerShell 源码 + JSON stdin，配置值不拼进代码。
// #44：应答带 ok/键名/Win32 码——看门狗没有 stdout 可看，失败必须有可查的记录。
function powershell(action, values) {
  const source = `$ErrorActionPreference='Stop';$r=ConvertFrom-Json ([Console]::In.ReadToEnd());$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
function Reply($o){$o|ConvertTo-Json -Compress}
function Code($e){try{if($e.PSObject.Properties['NativeErrorCode']){return [int]$e.NativeErrorCode}}catch{};try{return [int]($e.HResult -band 65535)}catch{return 0}}
if($r.action -eq 'read'){
 try{$k=Get-ItemProperty -Path $p;Reply @{ok=$true;ProxyEnable=[int]$k.ProxyEnable;ProxyServer=[string]$k.ProxyServer;ProxyOverride=[string]$k.ProxyOverride}}
 catch{Reply @{ok=$false;key='';win32=(Code $_.Exception);message=[string]$_.Exception.Message}}
}else{
 foreach($k in @('ProxyEnable','ProxyServer','ProxyOverride')){
  try{Set-ItemProperty -Path $p -Name $k -Value $(if($k -eq 'ProxyEnable'){[int]$r.ProxyEnable}else{[string]$r.$k})}
  catch{Reply @{ok=$false;key=$k;win32=(Code $_.Exception);message=[string]$_.Exception.Message};exit 0}
 }
 Reply @{ok=$true}
}`;
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {windowsHide: true});
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('系统代理操作超时')); }, 8000);
    child.stdin.on('error', () => {});
    child.stdout.on('data', (b) => { output += b; if (output.length > 16384) child.kill(); });
    child.on('error', () => { clearTimeout(timer); reject(Error('请先安装 PowerShell 7')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let answer = null;
      try { answer = JSON.parse(output); } catch {}
      if (answer && answer.ok === false) {
        const key = typeof answer.key === 'string' ? answer.key : '';
        const win32 = Number.isInteger(answer.win32) && answer.win32 > 0 ? answer.win32 : 0;
        const error = Error(`${key ? `写入 ${key} 失败` : '系统代理操作失败'}${win32 ? `（Win32 ${win32}）` : ''}${answer.message ? `：${answer.message}` : ''}`);
        error.key = key || null; error.win32 = win32;
        return reject(error);
      }
      if (code !== 0) return reject(Error('系统代理读写失败'));
      try { resolve(JSON.parse(output)); } catch { reject(Error('系统代理应答解析失败')); }
    });
    child.stdin.end(JSON.stringify({action, ...(values ?? {})}));
  });
}

// 看门狗没有 stdout：失败写进 <租约>.log，64 KB 封顶（#44）。
function logFailure(leasePath, error) {
  try {
    const file = `${leasePath}.log`;
    if (existsSync(file) && statSync(file).size > 64 * 1024) writeFileSync(file, '');
    const parts = [`${new Date().toISOString()} ${error?.code ?? 'PROXY_RESTORE_FAILED'}`];
    if (error?.key) parts.push(`写入 ${error.key} 失败`);
    if (Number.isInteger(error?.win32) && error.win32 > 0) parts.push(`Win32 ${error.win32}`);
    if (error?.message) parts.push(error.message);
    appendFileSync(file, `${parts.join(' ')}\n`);
  } catch {}
}

function readLease(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearLease(path) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}

// recover 是看门狗真正干活的那一步，导出给单测与启动自愈共用。
export async function recover({leasePath, parentPid, mihomoPid, read = () => powershell('read'), write = (v) => powershell('write', v)}) {
  const record = readLease(leasePath);
  if (!record) return {act: 'nothing'};
  let current = null;
  try { current = await read(); } catch { return {act: 'unreadable'}; }
  const decision = plan(record, current, parentPid);
  let act = decision.act, failure = null;
  if (decision.act === 'restore') {
    try { await write(decision.previous); }
    catch (error) {
      // #44：带上被拒的键名与 Win32 码；没有 stdout 可看，只能落文件。租约留着，
      // 下次插件启动还能再试一次——删掉就再也认不出注册表里那份是谁写的。
      logFailure(leasePath, error);
      act = 'write-failed';
      failure = {key: typeof error?.key === 'string' ? error.key : null,
        win32: Number.isInteger(error?.win32) ? error.win32 : 0};
    }
  }
  if (act !== 'write-failed') clearLease(leasePath);
  if (Number.isInteger(mihomoPid) && mihomoPid > 0 && processAlive(mihomoPid)) {
    try { process.kill(mihomoPid, 'SIGTERM'); } catch {}
    const until = Date.now() + 1500;
    while (Date.now() < until && processAlive(mihomoPid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (processAlive(mihomoPid)) try { process.kill(mihomoPid, 'SIGKILL'); } catch {}
  }
  return failure ? {act, ...failure} : {act};
}

// C8：看门狗由任务计划拉起，退出前要把自己的任务注销；否则父进程早没了，任务每 5 分钟
// 还会再拉起一个新看门狗。用 execFile 传参数，不拼 shell 字符串（任务名/路径带空格）。
export function deleteTask(taskName,run=(file,args,options,callback)=>execFile(file,args,options,callback)){
 if(!taskName)return Promise.resolve({ok:true,skipped:true});
 return new Promise(resolve=>{
  try{
   run('schtasks',['/Delete','/TN',String(taskName),'/F'],{windowsHide:true},error=>resolve(error?{ok:false}:{ok:true}));
  }catch{resolve({ok:false})}
 });
}

async function main() {
  const [parentPid, leasePath, mihomoPid, port, taskName] = process.argv.slice(2);
  const pid = Number(parentPid);
  const kernel = Number(mihomoPid);
  const mixed = Number(port);
  if (!Number.isInteger(pid) || !leasePath) process.exit(2);
  // 父进程还活着就每 800ms 看一眼；最多守 12 小时，之后自己退出（留一份 irradiating
  // 的看门狗毫无意义，租约文件还在就交给下次启动自愈）。
  const deadline = Date.now() + 12 * 3600 * 1000;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) {
      const record = readLease(leasePath);
      // 记录已经换成新实例的（owner.pid 不同） or 已清空：任务一起注销，然后退出。
      if (record?.owner && Number.isInteger(record.owner.pid) && record.owner.pid !== pid) {
        await deleteTask(taskName);
        process.exit(0);
      }
      if (record?.owned?.ProxyServer && Number.isInteger(mixed) && record.owned.ProxyServer !== `127.0.0.1:${mixed}`) {
        await deleteTask(taskName);
        process.exit(0);
      }
      await recover({leasePath, parentPid: pid, mihomoPid: kernel}).catch(() => {});
      await deleteTask(taskName);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
