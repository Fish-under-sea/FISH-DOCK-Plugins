// TUN 服务模式：一次性提权安装 SYSTEM 服务，之后普通权限即可开启 TUN。
// 权限面收敛：服务只按安装时写入的 service.ini 里的固定 kernel/home 启动，
// 运行期用户只能改 job.ini（config 路径 + enabled），且路径被限制在 home 内。
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

export const SERVICE_ID = 'FishClashTun';
export const SERVICE_DIR = 'FishDock/clash-tun';
const RUNTIME_FILE = 'mihomo-runtime.json';
const SERVICE_EXE = fileURLToPath(new URL('./service/tun-service.exe', import.meta.url));

export function serviceRoot(programData) { return join(programData, ...SERVICE_DIR.split('/')); }
export function serviceIniPath(programData) { return join(serviceRoot(programData), 'service.ini'); }
export function jobIniPath(programData) { return join(serviceRoot(programData), 'job.ini'); }

export function iniText(rows) {
  return Object.entries(rows).map(([k, v]) => `${k}=${v}`).join('\r\n') + '\r\n';
}
export function iniRead(text) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

// 运行期 job 只允许 home 内的 mihomo-runtime.json，越界即拒（与服务端同一判据）。
export function validateJob({ config, home }) {
  if (!config || !home) throw Error('TUN 任务缺少配置路径');
  const toWin = v => String(v).replace(/\//g, '\\').replace(/\\+$/, '');
  const root = toWin(home) + '\\';
  const normalized = toWin(config);
  if (!normalized.toLowerCase().startsWith(root.toLowerCase())) throw Error('TUN 配置路径必须位于插件数据目录内');
  if (normalized.split('\\').pop().toLowerCase() !== RUNTIME_FILE) throw Error('TUN 配置文件名不合法');
  return normalized;
}

export function createTun({ context, programData, exec = runExec, platform = process.platform, io = null }) {
  const root = serviceRoot(programData);
  const ini = serviceIniPath(programData);
  const job = jobIniPath(programData);
  const exe = join(root, 'tun-service.exe');
  const log = join(root, 'service.log');

  // io 可注入，便于在不触碰真实系统的情况下验证判据与写盘内容。
  const readIni = io?.readIni ? io.readIni : async () => { try { return iniRead(await readFile(ini, 'utf8')); } catch { return null; } };
  const readJob = io?.readJob ? io.readJob : async () => { try { return iniRead(await readFile(job, 'utf8')); } catch { return null; } };
  const readLog = io?.readLog ? io.readLog : async () => { try { return await readFile(log, 'utf8'); } catch { return ''; } };
  const writeJob = io?.writeJob ? io.writeJob : async text => { await mkdir(root, { recursive: true }); await writeFile(job, text, 'utf8'); };
  const isFile = io?.isFile ? io.isFile : async p => { try { return (await stat(p)).isFile(); } catch { return false; } };

  async function status() {
    const cfg = await readIni();
    const task = await readJob();
    let serviceState = 'absent';
    if (platform === 'win32') {
      const q = await exec('sc.exe', ['query', SERVICE_ID]);
      const text = `${q.stdout || ''}`.toLowerCase();
      if (/1060|does not exist|指定的服务|不存在/.test(text)) serviceState = 'absent';
      else if (/running/.test(text)) serviceState = 'running';
      else if (/stopped/.test(text)) serviceState = 'stopped';
      else serviceState = q.code === 0 ? 'unknown' : 'absent';
    }
    const tail = String(await readLog() || '').split(/\r?\n/).filter(Boolean).slice(-6).join('\n');
    return {
      platform, installed: serviceState !== 'absent', state: serviceState, executable: await isFile(exe),
      kernel: cfg?.kernel || '', home: cfg?.home || '', enabled: task?.enabled === '1',
      config: task?.config || '', log: tail, canElevate: platform === 'win32'
    };
  }

  // 安装：复制服务体 → 写 service.ini（固定 kernel/home）→ 建服务 → 放开 job.ini 写权限 → 启动。
  // 需要一次 UAC；脚本写到临时文件后提权执行，结果经 result 文件回传（不依赖编码）。
  async function install({ kernel, home } = {}) {
    if (platform !== 'win32') throw Error('TUN 服务模式仅支持 Windows');
    if (!kernel || !home) throw Error('缺少内核或数据目录');
    if (!(await isFile(SERVICE_EXE))) throw Error('插件内缺少 TUN 服务程序');
    const script = [
      `$ErrorActionPreference='Stop'`,
      `$root='${ps(root)}'; $ini='${ps(ini)}'; $job='${ps(job)}'`,
      `New-Item -ItemType Directory -Force -Path $root | Out-Null`,
      `Copy-Item -LiteralPath '${ps(SERVICE_EXE)}' -Destination '${ps(exe)}' -Force`,
      `Set-Content -LiteralPath $ini -Encoding UTF8 -Value ('kernel=${kernel}','home=${home}')`,
      `if(-not (Test-Path -LiteralPath $job)){Set-Content -LiteralPath $job -Encoding UTF8 -Value ('enabled=0')}`,
      // 普通用户只能写 job.ini：目录给读+遍历，service.ini 只读，job.ini 单独可改。
      `icacls $root /grant '*S-1-5-32-545:(OI)(CI)(RX)' | Out-Null`,
      `icacls $ini /inheritance:r /grant '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' '*S-1-5-32-545:(R)' | Out-Null`,
      `icacls $job /grant '*S-1-5-32-545:(M)' | Out-Null`,
      `$sc=Join-Path $env:SystemRoot 'System32\\sc.exe'`,
      `& $sc stop ${SERVICE_ID} 2>$null | Out-Null`,
      `& $sc delete ${SERVICE_ID} 2>$null | Out-Null`,
      `Start-Sleep -Milliseconds 400`,
      `& $sc create ${SERVICE_ID} binPath= ('"' + '${ps(exe)}' + '"') start= auto DisplayName= 'FISH Dock Clash TUN' | Out-Null`,
      `& $sc description ${SERVICE_ID} 'FISH Dock 的 TUN 内核托管服务；只运行安装时登记的内核。' | Out-Null`,
      `& $sc start ${SERVICE_ID} | Out-Null`
    ].join('; ');
    const result = await elevate(script);
    if (result.code !== 0) throw Error(result.message || '安装 TUN 服务失败');
    return status();
  }

  async function uninstall() {
    if (platform !== 'win32') throw Error('TUN 服务模式仅支持 Windows');
    const script = [
      `$ErrorActionPreference='SilentlyContinue'`,
      `$sc=Join-Path $env:SystemRoot 'System32\\sc.exe'`,
      `& $sc stop ${SERVICE_ID} | Out-Null`,
      `& $sc delete ${SERVICE_ID} | Out-Null`,
      `Remove-Item -LiteralPath '${ps(job)}' -Force`,
      `Remove-Item -LiteralPath '${ps(ini)}' -Force`
    ].join('; ');
    const result = await elevate(script);
    if (result.code !== 0) throw Error(result.message || '卸载 TUN 服务失败');
    return status();
  }

  // 运行期：普通权限，只写 job.ini，服务自己 watch 并重启内核。
  async function enable({ config, home } = {}) {
    const target = validateJob({ config, home: home || (await readIni())?.home });
    await writeJob(iniText({ enabled: 1, config: target }));
    return waitFor('start');
  }

  async function disable() {
    await writeJob(iniText({ enabled: 0 }));
    return waitFor('stop');
  }

  // 等服务侧生效：读 service.log 里是否出现本次动作的关键行。
  async function waitFor(kind, timeout = 6000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const raw = String(await readLog() || '');
      if (kind === 'start' && /kernel started/.test(raw)) return true;
      if (kind === 'stop' && /tun idle|kernel stopped/.test(raw)) return true;
      await new Promise(r => setTimeout(r, 150));
    }
    return false;
  }

  return { status, install, uninstall, enable, disable };
}

function ps(value) { return String(value ?? '').replace(/'/g, "''"); }

// 提权执行：脚本与结果都走临时文件，避免 -EncodedCommand 的输出编码与引号问题。
// 返回 {code, message}；code=0 表示管理员侧脚本执行成功。
async function elevate(script) {
  const stamp = `${process.pid}-${Date.now()}`;
  const scriptFile = join(tmpdir(), `fish-tun-${stamp}.ps1`);
  const resultFile = join(tmpdir(), `fish-tun-${stamp}.txt`);
  const body = `$ErrorActionPreference='Stop'\ntry{\n${script}\n}catch{Set-Content -LiteralPath '${ps(resultFile)}' -Encoding UTF8 -Value ('ERR:' + $_.Exception.Message); exit 1}\nSet-Content -LiteralPath '${ps(resultFile)}' -Encoding UTF8 -Value 'OK'\n`;
  try {
    await writeFile(scriptFile, body, 'utf8');
    const outer = `$p=Start-Process -FilePath '${ps(process.env.FISH_PWSH || 'pwsh')}' -Verb RunAs -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${ps(scriptFile)}') -PassThru -Wait; exit $p.ExitCode`;
    const launched = await runExec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', outer]);
    let message = '';
    try { message = (await readFile(resultFile, 'utf8')).trim(); } catch { message = ''; }
    if (launched.code !== 0 || !/^OK$/.test(message)) {
      const reason = message.startsWith('ERR:') ? message.slice(4) : (message || '提权操作被取消或未完成');
      return { code: 1, message: reason };
    }
    return { code: 0, message: '' };
  } catch (error) {
    return { code: 1, message: error?.message || '提权执行失败' };
  } finally {
    await rm(scriptFile, { force: true }).catch(() => {});
    await rm(resultFile, { force: true }).catch(() => {});
  }
}

function runExec(file, args) {
  return new Promise(resolve => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', b => { stdout += b; });
    child.on('error', () => resolve({ code: 1, stdout: '' }));
    child.on('close', code => resolve({ code: code ?? 0, stdout }));
  });
}
