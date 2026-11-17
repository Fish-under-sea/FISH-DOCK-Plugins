import test from 'node:test';
import assert from 'node:assert/strict';
import { iniText, iniRead, validateJob, serviceRoot, jobIniPath, serviceIniPath, hostLeasePath, createTun, SERVICE_ID } from './tun.mjs';

const HOME = 'D:/synthetic/.fish-dock/.fishplugin-clash';

test('ini 读写往返，忽略注释与空行', () => {
  const text = iniText({ enabled: 1, config: 'C:/x/y.json' });
  assert.deepEqual(iniRead(text), { enabled: '1', config: 'C:/x/y.json' });
  assert.deepEqual(iniRead('# note\n\nkernel = "C:/k/mihomo.exe"\n'), { kernel: 'C:/k/mihomo.exe' });
  assert.deepEqual(iniRead(null), {});
});

test('job 只接受 home 内的 mihomo-runtime.json，越界与改名的都拒', () => {
  assert.equal(validateJob({ config: `${HOME}/tmp/mihomo-runtime.json`, home: HOME }), 'D:\\synthetic\\.fish-dock\\.fishplugin-clash\\tmp\\mihomo-runtime.json');
  assert.throws(() => validateJob({ config: 'C:/Windows/System32/drivers/etc/hosts', home: HOME }), /数据目录内/);
  assert.throws(() => validateJob({ config: `${HOME}/tmp/evil.json`, home: HOME }), /文件名不合法/);
  assert.throws(() => validateJob({ config: '', home: HOME }), /缺少配置路径/);
});

test('服务路径固定在 ProgramData，job 与 service.ini 分离', () => {
  assert.equal(serviceRoot('C:/ProgramData'), 'C:\\ProgramData\\FishDock\\clash-tun');
  assert.ok(serviceIniPath('C:/ProgramData').endsWith('service.ini'));
  assert.ok(jobIniPath('C:/ProgramData').endsWith('job.ini'));
});

function fixture({ state = 'stopped', ini = null, job = null, log = '' } = {}) {
  const writes = [], hostWrites = [], hostRemoved = [];
  const exec = async () => ({ code: 0, stdout: state === 'running' ? 'STATE : 4  RUNNING' : 'STATE : 1  STOPPED' });
  const io = {
    readIni: async () => ini,
    readJob: async () => job,
    readLog: async () => log,
    writeJob: async v => { writes.push(v); },
    // C7：宿主租约写/删注入，单测不碰 ProgramData。
    writeHost: async (path, value) => { hostWrites.push({ path, value }); },
    removeHost: async path => { hostRemoved.push(path); },
    isFile: async () => true
  };
  return { io, exec, writes, hostWrites, hostRemoved };
}

test('status 汇总服务状态、内核绑定与最近日志', async () => {
  const f = fixture({ state: 'running', ini: { kernel: 'C:/k/mihomo.exe', home: HOME }, job: { enabled: '1', config: `${HOME}/tmp/mihomo-runtime.json` }, log: 'a\nb\nkernel started\n' });
  const tun = createTun({ programData: 'C:/ProgramData', exec: f.exec, platform: 'win32', io: f.io });
  const s = await tun.status();
  assert.equal(s.installed, true);
  assert.equal(s.state, 'running');
  assert.equal(s.enabled, true);
  assert.equal(s.kernel, 'C:/k/mihomo.exe');
  assert.ok(s.log.includes('kernel started'));
});

test('服务不存在时 status 报 absent 且 installed=false', async () => {
  const exec = async () => ({ code: 1, stdout: 'FAILED 1060: 指定的服务未安装。' });
  const tun = createTun({ programData: 'C:/ProgramData', exec, platform: 'win32', io: { readIni: async () => null, readJob: async () => null, readLog: async () => '', writeJob: async () => {}, isFile: async () => false } });
  const s = await tun.status();
  assert.equal(s.installed, false);
  assert.equal(s.state, 'absent');
});

test('enable 写 job.ini 并在服务日志确认启动；disable 写 enabled=0', async () => {
  const f = fixture({ ini: { kernel: 'C:/k/mihomo.exe', home: HOME } });
  let phase = 'start';
  const tun = createTun({
    programData: 'C:/ProgramData', exec: f.exec, platform: 'win32',
    io: { ...f.io, readLog: async () => phase === 'start' ? 'kernel started' : 'tun idle' }
  });
  const ok = await tun.enable({ config: `${HOME}/tmp/mihomo-runtime.json` });
  assert.equal(ok, true);
  assert.match(f.writes[0], /enabled=1/);
  phase = 'stop';
  assert.equal(await tun.disable(), true);
  assert.match(f.writes[1], /enabled=0/);
});

// C7：TUN 由 SYSTEM 服务托管，服务不随宿主 Job 消失。开启 TUN 时写宿主租约，
// 关 TUN 时删掉；服务侧 Tick 看到宿主 pid 不在了就撤内核并 disable。
test('C7 TUN 开启写宿主租约、关闭删除，路径与 service.ini 的 home 同源', async () => {
  const f = fixture({ ini: { kernel: 'C:/k/mihomo.exe', home: HOME } });
  const tun = createTun({ programData: 'C:/ProgramData', exec: f.exec, platform: 'win32', io: f.io });
  assert.equal(hostLeasePath(HOME), 'D:\\synthetic\\.fish-dock\\.fishplugin-clash\\host.json');
  await tun.enable({ config: `${HOME}/tmp/mihomo-runtime.json`, hostPid: 4242 });
  assert.equal(f.hostWrites.length, 1);
  assert.equal(f.hostWrites[0].path, hostLeasePath(HOME));
  const lease = JSON.parse(f.hostWrites[0].value);
  assert.equal(lease.pid, 4242);
  assert.ok(Number.isFinite(lease.at) && lease.at > 0);
  await tun.disable();
  assert.deepEqual(f.hostRemoved, [hostLeasePath(HOME)]);
});

// 没传宿主 pid（例如老调用方）时不写一个 pid 无效的租约——那会让服务误判宿主已死。
test('C7 没有宿主 pid 时不写宿主租约', async () => {
  const f = fixture({ ini: { kernel: 'C:/k/mihomo.exe', home: HOME } });
  const tun = createTun({ programData: 'C:/ProgramData', exec: f.exec, platform: 'win32', io: f.io });
  await tun.enable({ config: `${HOME}/tmp/mihomo-runtime.json` });
  assert.equal(f.hostWrites.length, 0);
});

test('enable 拒绝越界配置，不写 job.ini', async () => {
  const f = fixture({ ini: { kernel: 'C:/k/mihomo.exe', home: HOME } });
  const tun = createTun({ programData: 'C:/ProgramData', exec: f.exec, platform: 'win32', io: f.io });
  await assert.rejects(tun.enable({ config: 'C:/Windows/evil.json', home: HOME }), /数据目录内/);
  assert.equal(f.writes.length, 0);
});

test('非 Windows 平台安装直接报错，服务名固定', async () => {
  const tun = createTun({ programData: 'C:/ProgramData', platform: 'linux', io: fixture().io });
  await assert.rejects(tun.install({ kernel: 'x', home: HOME }), /仅支持 Windows/);
  assert.equal(SERVICE_ID, 'FishClashTun');
});

test('iniRead 自动剥离 UTF-8 BOM', () => {
  assert.deepEqual(iniRead('\uFEFFkernel=C:/k/mihomo.exe\r\nhome=D:/h\r\n'), {
    kernel: 'C:/k/mihomo.exe',
    home: 'D:/h'
  });
});

test('带时间戳的历史 service.log 不会让 enable/disable 误判秒过，且会尝试唤醒已停止的服务', async () => {
  const execCalls = [];
  let logText = '2026-11-17 06:40:31  kernel started pid=11\n2026-11-17 06:41:00  tun idle\n';
  let reads = 0;
  const f = fixture({ ini: { kernel: 'C:/k/mihomo.exe', home: HOME } });
  let serviceStarted = false;
  const tun = createTun({
    programData: 'C:/ProgramData',
    platform: 'win32',
    exec: async (cmd, args) => {
      execCalls.push([cmd, ...args]);
      if (args[0] === 'start') serviceStarted = true;
      return { code: 0, stdout: serviceStarted ? 'STATE : 4  RUNNING' : 'STATE : 1  STOPPED' };
    },
    io: {
      ...f.io,
      readLog: async () => {
        reads += 1;
        if (reads === 3) logText += '2026-11-17 08:30:01  kernel started pid=22\n';
        if (reads === 6) logText += '2026-11-17 08:30:05  tun idle\n';
        return logText;
      }
    }
  });
  assert.equal(await tun.enable({ config: `${HOME}/tmp/mihomo-runtime.json`, hostPid: 999 }), true);
  assert.ok(reads >= 3, 'enable must wait past stale history');
  assert.ok(execCalls.some(c => c[0] === 'sc.exe' && c[1] === 'start' && c[2] === SERVICE_ID));
  assert.equal(await tun.disable(), true);
  assert.ok(reads >= 6, 'disable must wait past stale history');
});

test('refreshLease 更新宿主租约而不改动 job.ini；服务已停时 disable 不空等日志超时', async () => {
  const f = fixture({ state: 'stopped', ini: { kernel: 'C:/k/mihomo.exe', home: HOME } });
  const tun = createTun({ programData: 'C:/ProgramData', exec: f.exec, platform: 'win32', io: f.io });
  assert.equal(await tun.refreshLease(8888), true);
  assert.equal(f.hostWrites.length, 1);
  assert.equal(JSON.parse(f.hostWrites[0].value).pid, 8888);
  assert.equal(await tun.refreshLease(0), false);
  const t0 = Date.now();
  assert.equal(await tun.disable(), true);
  assert.ok(Date.now() - t0 < 1000, '服务已停止时 disable 应立即返回');
  assert.match(f.writes[0], /enabled=0/);
});
