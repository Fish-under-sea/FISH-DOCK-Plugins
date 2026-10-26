import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PAGE_SOURCE = readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const IDS = [
  'status', 'settings', 'fields', 'baseUrl', 'model', 'comparisonModel', 'apiKey',
  'clearKey', 'keyState', 'save', 'run', 'refresh', 'stop', 'result', 'verdict',
  'evidence', 'details', 'json',
];

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.onclick = null;
    const classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains: name => classes.has(name),
    };
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  async dispatch(type) {
    const handler = this.listeners.get(type);
    if (handler) await handler({ preventDefault() {} });
  }
}

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    set(fn) {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clear(id) {
      timers.delete(id);
    },
    runAll() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function loadPage(viewHandler) {
  const elements = new Map(IDS.map(id => [id, new FakeElement(id)]));
  const handlers = new Map([['relay.view', viewHandler]]);
  const calls = [];
  const bridge = {
    async call(method, params) {
      calls.push({ method, params });
      const handler = handlers.get(method);
      if (!handler) throw new Error(`unexpected method: ${method}`);
      return handler(params);
    },
  };
  const document = {
    readyState: 'complete',
    getElementById: id => elements.get(id) ?? null,
    createElement: () => new FakeElement(),
    addEventListener() {},
  };
  const window = { FishDock: bridge };
  const timers = fakeTimers();
  const sandbox = {
    document,
    window,
    FishDock: bridge,
    console,
    setTimeout: (fn) => timers.set(fn),
    clearTimeout: id => timers.clear(id),
  };
  vm.runInNewContext(PAGE_SOURCE, sandbox, { filename: 'page.js' });
  return {
    el: id => elements.get(id),
    on(method, handler) { handlers.set(method, handler); },
    calls,
    timers,
  };
}

function baseView(extra = {}) {
  return {
    baseUrl: 'https://relay.example',
    model: 'claude-sonnet-5-5',
    comparisonModel: 'claude-sonnet-4-6',
    keyConfigured: true,
    running: false,
    job: null,
    last: null,
    lastAt: null,
    loadError: null,
    ...extra,
  };
}

function report() {
  return {
    target: { baseUrl: 'https://relay.example', model: 'claude-sonnet-5-5' },
    b1: { status: 'native_signal' },
    c1: { status: 'match', counted: 130, used: 130, diff: 0, percent: 0 },
    c2: { status: 'differ_expected', primary: { count: 130 }, comparison: { count: 100 }, ratio: 1.3 },
    verdict: {
      code: 'native_consistent',
      label: '与原生一致',
      confidence: 'high',
      signals: [],
      forgedScore: 0,
      nativeScore: 5,
    },
  };
}

test('配置读回前禁用保存/启动，读回成功后才启用', async () => {
  let resolveView;
  const page = loadPage(() => new Promise(resolve => { resolveView = resolve; }));
  assert.equal(page.el('fields').disabled, true);
  assert.equal(page.el('save').disabled, true);
  assert.equal(page.el('run').disabled, true);

  resolveView(baseView());
  await flush();
  assert.equal(page.el('fields').disabled, false);
  assert.equal(page.el('save').disabled, false);
  assert.equal(page.el('run').disabled, false);
  assert.equal(page.el('baseUrl').value, 'https://relay.example');
  assert.equal(page.el('apiKey').value, '');
  assert.match(page.el('keyState').textContent, /已保存 Key/);
});

test('首次 relay.view 失败时保持禁用，避免空表单覆盖旧配置', async () => {
  const page = loadPage(() => Promise.reject(new Error('bridge unavailable')));
  await flush();
  assert.equal(page.el('fields').disabled, true);
  assert.equal(page.el('save').disabled, true);
  assert.equal(page.el('run').disabled, true);
  assert.match(page.el('status').textContent, /插件尚未就绪/);
  assert.equal(page.el('status').classList.contains('bad'), true);
});

test('保存失败时显示错误、保留输入，并恢复按钮', async () => {
  const page = loadPage(() => baseView());
  await flush();
  page.el('baseUrl').value = 'https://relay.example';
  page.el('apiKey').value = 'test-key-page-123456';
  page.on('relay.save', () => ({ ok: false, error: { message: '保存被拒绝' } }));

  await page.el('settings').dispatch('submit');
  assert.equal(page.el('status').textContent, '保存被拒绝');
  assert.equal(page.el('status').classList.contains('bad'), true);
  assert.equal(page.el('apiKey').value, 'test-key-page-123456');
  assert.equal(page.el('fields').disabled, false);
  assert.equal(page.el('save').disabled, false);
  assert.equal(page.el('run').disabled, false);
});

test('启动后轮询到 done：停止按钮出现再隐藏，结果区渲染', async () => {
  const page = loadPage(() => baseView());
  await flush();
  page.el('baseUrl').value = 'https://relay.example';
  page.el('apiKey').value = 'test-key-page-123456';
  page.on('relay.save', () => ({ ok: true, view: { keyConfigured: true } }));
  page.on('relay.start', () => ({ ok: true, job: { id: 'j1', state: 'running' } }));
  let statusCalls = 0;
  page.on('relay.status', () => {
    statusCalls += 1;
    if (statusCalls === 1) return { ok: true, job: { id: 'j1', state: 'running' } };
    return { ok: true, job: { id: 'j1', state: 'done', report: report() } };
  });

  page.el('run').onclick();
  await flush();
  assert.equal(page.el('stop').hidden, false);
  assert.equal(page.el('fields').disabled, true);
  assert.equal(page.el('run').disabled, true);
  assert.equal(page.el('status').textContent, '检测进行中…');

  page.timers.runAll();
  await flush();
  assert.equal(page.el('result').hidden, false);
  assert.equal(page.el('verdict').textContent, '与原生一致');
  assert.equal(page.el('stop').hidden, true);
  assert.equal(page.el('fields').disabled, false);
  assert.equal(page.el('status').textContent, '检测完成');
});

test('停止后迟到的 running 状态不会把界面拉回进行中', async () => {
  const page = loadPage(() => baseView());
  await flush();
  page.el('baseUrl').value = 'https://relay.example';
  page.el('apiKey').value = 'test-key-page-123456';
  page.on('relay.save', () => ({ ok: true, view: { keyConfigured: true } }));
  page.on('relay.start', () => ({ ok: true, job: { id: 'j2', state: 'running' } }));
  let resolveStatus;
  page.on('relay.status', () => new Promise(resolve => { resolveStatus = resolve; }));
  page.on('relay.stop', () => ({ ok: true, job: { id: 'j2', state: 'cancelled' } }));

  page.el('run').onclick();
  await flush();
  assert.equal(page.el('stop').hidden, false);
  assert.equal(page.el('fields').disabled, true);

  await page.el('stop').onclick();
  assert.equal(page.el('stop').hidden, true);
  assert.equal(page.el('fields').disabled, false);
  assert.equal(page.el('status').textContent, '检测已停止');

  resolveStatus({ ok: true, job: { id: 'j2', state: 'running' } });
  await flush();
  assert.equal(page.el('stop').hidden, true);
  assert.equal(page.el('fields').disabled, false);
});

test('读取状态失败时保留停止按钮并禁用编辑', async () => {
  const page = loadPage(() => baseView());
  await flush();
  page.el('baseUrl').value = 'https://relay.example';
  page.el('apiKey').value = 'test-key-page-123456';
  page.on('relay.save', () => ({ ok: true, view: { keyConfigured: true } }));
  page.on('relay.start', () => ({ ok: true, job: { id: 'j3', state: 'running' } }));
  page.on('relay.status', () => { throw new Error('status unavailable'); });

  page.el('run').onclick();
  await flush();
  assert.equal(page.el('stop').hidden, false);
  assert.equal(page.el('fields').disabled, true);
  assert.equal(page.el('save').disabled, true);
  assert.match(page.el('status').textContent, /读取检测状态失败/);
  assert.equal(page.el('status').classList.contains('bad'), true);
});
