import test from 'node:test';
import assert from 'node:assert/strict';
import { iniText, iniRead, validateJob, serviceRoot, jobIniPath, serviceIniPath, createTun, SERVICE_ID } from './tun.mjs';

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
  const writes = [];
  const exec = async () => ({ code: 0, stdout: state === 'running' ? 'STATE : 4  RUNNING' : 'STATE : 1  STOPPED' });
  const io = {
    readIni: async () => ini,
    readJob: async () => job,
    readLog: async () => log,
    writeJob: async v => { writes.push(v); },
    isFile: async () => true
  };
  return { io, exec, writes };
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
