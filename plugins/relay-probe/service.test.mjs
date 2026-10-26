import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayService } from './service.mjs';
import { constants } from './probe.mjs';

const KEY = 'test-key-service-123456';

function fakeContext(initial = {}) {
  const files = new Map(Object.entries(initial));
  const calls = [];
  const namespace = () => ({
    read: async (category, name) => {
      calls.push({ op: 'read', category, name });
      return files.get(`${category}/${name}`) ?? null;
    },
    write: async (category, name, value) => {
      calls.push({ op: 'write', category, name, value });
      files.set(`${category}/${name}`, value);
    },
  });
  return { context: { storage: namespace(), secrets: namespace() }, files, calls };
}

function report(code = 'native_consistent') {
  return {
    schema: 1,
    target: { baseUrl: 'https://relay.example', model: constants.DEFAULT_MODEL },
    b1: { status: 'native_signal' },
    c1: { status: 'match' },
    c2: { status: 'differ_expected' },
    verdict: { code, label: code, confidence: 'medium' },
  };
}

test('空存储时使用默认设置，且没有 Key', async () => {
  const { context } = fakeContext();
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();
  const view = await service.view();
  assert.equal(view.baseUrl, '');
  assert.equal(view.model, constants.DEFAULT_MODEL);
  assert.equal(view.comparisonModel, constants.COMPARISON_MODEL);
  assert.equal(view.keyConfigured, false);
  assert.equal(view.loadError, null);
  assert.equal(view.running, false);
});

test('保存把 Key 写入加密凭据、配置写入普通存储，view 不回显 Key', async () => {
  const { context, files } = fakeContext();
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();
  const saved = await service.save({
    baseUrl: 'https://relay.example/v1',
    apiKey: KEY,
    model: 'claude-sonnet-5-5',
    comparisonModel: 'claude-sonnet-4-6',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.view.baseUrl, 'https://relay.example');
  assert.equal(saved.view.keyConfigured, true);
  assert.ok(!JSON.stringify(saved.view).includes(KEY));

  const config = JSON.parse(files.get('config/relay.json'));
  assert.equal(config.baseUrl, 'https://relay.example');
  assert.ok(!JSON.stringify(config).includes(KEY));
  const secret = JSON.parse(files.get('credentials/relay.json'));
  assert.equal(secret.apiKey, KEY);
  assert.equal(secret.baseUrl, 'https://relay.example');
});

test('Key 与 Base URL 成对保存；重启时配对不一致就丢弃 Key', async () => {
  const { context, files } = fakeContext();
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();
  await service.save({ baseUrl: 'https://relay-a.example/v1', apiKey: KEY });

  // 模拟凭据与配置来自不同次写入：凭据指向 B，配置仍是 A。
  files.set('credentials/relay.json', JSON.stringify({ apiKey: KEY, baseUrl: 'https://relay-b.example' }));
  const restarted = createRelayService({ context, clock: () => 1000 });
  await restarted.load();
  const view = await restarted.view();
  assert.equal(view.keyConfigured, false);
  assert.match(view.loadError, /不匹配/);
  const started = await restarted.start({});
  assert.equal(started.ok, false);
  assert.equal(started.error.code, 'KEY_REQUIRED');
});

test('配置写失败且 Key 回滚失败时，重启不会把新 Key 发给旧 Base URL', async () => {
  const files = new Map([
    ['config/relay.json', JSON.stringify({ baseUrl: 'https://relay-a.example' })],
    ['credentials/relay.json', JSON.stringify({ apiKey: KEY, baseUrl: 'https://relay-a.example' })],
  ]);
  let secretWrites = 0;
  const namespace = kind => ({
    read: async (category, name) => files.get(`${category}/${name}`) ?? null,
    write: async (category, name, value) => {
      if (kind === 'secret') {
        secretWrites += 1;
        if (secretWrites === 2) throw new Error('secret rollback failed');
      } else if (category === 'config' && name === 'relay.json') {
        throw new Error('config write failed');
      }
      files.set(`${category}/${name}`, value);
    },
  });
  const context = { storage: namespace('storage'), secrets: namespace('secret') };
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();

  const saved = await service.save({ baseUrl: 'https://relay-b.example/v1', apiKey: 'test-key-relay-probe-654321' });
  assert.equal(saved.ok, false);
  assert.match(saved.error.message, /旧 Key 未能恢复/);

  const restarted = createRelayService({ context, clock: () => 1000 });
  await restarted.load();
  const view = await restarted.view();
  assert.equal(view.keyConfigured, false);
  assert.match(view.loadError, /不匹配/);
  const started = await restarted.start({});
  assert.equal(started.ok, false);
  assert.equal(started.error.code, 'KEY_REQUIRED');
});

test('空白 Key 保留旧值，clearKey 清除旧值', async () => {
  const { context, files } = fakeContext();
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();
  await service.save({ baseUrl: 'https://relay.example/v1', apiKey: KEY });

  await service.save({ apiKey: '' });
  assert.equal((await service.view()).keyConfigured, true);
  assert.equal(JSON.parse(files.get('credentials/relay.json')).apiKey, KEY);

  const cleared = await service.save({ clearKey: true });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.view.keyConfigured, false);
  assert.equal(JSON.parse(files.get('credentials/relay.json')).apiKey, '');
});

test('非法配置返回错误且不覆盖旧配置/旧 Key', async () => {
  const { context, files } = fakeContext();
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();
  await service.save({ baseUrl: 'https://relay.example/v1', apiKey: KEY });

  const badUrl = await service.save({ baseUrl: 'http://relay.example/v1' });
  assert.equal(badUrl.ok, false);
  assert.equal(badUrl.error.code, 'BASE_URL_INSECURE');
  assert.equal((await service.view()).baseUrl, 'https://relay.example');

  const badKey = await service.save({ apiKey: 'bad\nkey' });
  assert.equal(badKey.ok, false);
  assert.equal(badKey.error.code, 'KEY_INVALID');
  assert.equal(JSON.parse(files.get('credentials/relay.json')).apiKey, KEY);
});

test('start/status 采用后台任务；报告落盘且 view 能读到', async () => {
  const { context, files } = fakeContext();
  let resolveProbe;
  const seen = [];
  const probe = config => {
    seen.push(config);
    return new Promise(resolve => { resolveProbe = resolve; });
  };
  const service = createRelayService({ context, probe, clock: () => 1000 });
  await service.load();
  await service.save({ baseUrl: 'https://relay.example/v1', apiKey: KEY });

  const started = await service.start({});
  assert.equal(started.ok, true);
  assert.equal(started.job.state, 'running');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].apiKey, KEY);
  assert.equal(seen[0].baseUrl, 'https://relay.example');
  assert.ok(seen[0].signal instanceof AbortSignal);

  const second = await service.start({});
  assert.equal(second.job.id, started.job.id);
  assert.equal(seen.length, 1);

  resolveProbe(report());
  await new Promise(resolve => setTimeout(resolve, 0));
  const status = await service.status();
  assert.equal(status.job.state, 'done');
  assert.equal(status.job.report.verdict.code, 'native_consistent');
  assert.equal((await service.view()).lastAt, 1000);
  assert.equal(JSON.parse(files.get('config/last.json')).at, 1000);
});

test('stop 会中止当前任务；之后 probe 返回也不会把状态改回 done', async () => {
  const { context } = fakeContext();
  let resolveProbe;
  const probe = config => {
    assert.equal(config.signal.aborted, false);
    return new Promise(resolve => { resolveProbe = resolve; });
  };
  const service = createRelayService({ context, probe, clock: () => 1000 });
  await service.load();
  await service.save({ baseUrl: 'https://relay.example/v1', apiKey: KEY });
  await service.start({});

  const stopped = await service.stop();
  assert.equal(stopped.job.state, 'cancelled');
  assert.equal(stopped.job.finishedAt, 1000);

  resolveProbe(report());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await service.status()).job.state, 'cancelled');
  assert.equal((await service.view()).last, null);
});

test('probe 抛错时任务进入 error，错误信息会抹掉 Key', async () => {
  const { context } = fakeContext();
  const probe = async () => {
    throw Object.assign(new Error(`upstream rejected ${KEY}`), { code: 'UPSTREAM_REJECTED' });
  };
  const service = createRelayService({ context, probe, clock: () => 1000 });
  await service.load();
  await service.save({ baseUrl: 'https://relay.example/v1', apiKey: KEY });
  await service.start({});
  await new Promise(resolve => setTimeout(resolve, 0));
  const job = (await service.status()).job;
  assert.equal(job.state, 'error');
  assert.equal(job.error.code, 'UPSTREAM_REJECTED');
  assert.match(job.error.message, /<REDACTED>/);
  assert.ok(!JSON.stringify(job).includes(KEY));
});

test('没有 Key 或没有 Base URL 时拒绝启动', async () => {
  const { context } = fakeContext();
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();
  const noBase = await service.start({});
  assert.equal(noBase.ok, false);
  assert.equal(noBase.error.code, 'BASE_URL_REQUIRED');

  await service.save({ baseUrl: 'https://relay.example/v1' });
  const noKey = await service.start({});
  assert.equal(noKey.ok, false);
  assert.equal(noKey.error.code, 'KEY_REQUIRED');
});

test('损坏的配置/凭据会给出 loadError，但插件仍可启动', async () => {
  const { context } = fakeContext({
    'config/relay.json': '{not json',
    'credentials/relay.json': JSON.stringify({ apiKey: `bad\r\nkey` }),
    'config/last.json': '{also not json',
  });
  const service = createRelayService({ context, clock: () => 1000 });
  await service.load();
  const view = await service.view();
  assert.match(view.loadError, /配置读取失败/);
  assert.equal(view.baseUrl, '');
  assert.equal(view.keyConfigured, false);
  assert.equal(view.last, null);
});
