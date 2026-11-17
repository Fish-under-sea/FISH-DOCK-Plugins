'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

function createElStub(tag = 'div', opts = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    textContent: opts.text || '',
    value: '',
    disabled: false,
    options: [],
    children: [],
    classes: new Set(),
    listeners: new Map(),
    attrs: { ...(opts.attr || {}) },
    get selectedIndex() {
      const idx = this.options.findIndex((o) => o.value === this.value);
      return idx >= 0 ? idx : 0;
    },
    addClass(c) { this.classes.add(c); },
    empty() { this.children = []; this.options = []; this.textContent = ''; },
    setText(t) { this.textContent = String(t); },
    appendText(t) { this.textContent += String(t); },
    addEventListener(ev, fn) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, []);
      this.listeners.get(ev).push(fn);
    },
    async dispatch(ev) {
      for (const fn of (this.listeners.get(ev) || [])) await fn({ type: ev, target: this });
    },
    createEl(childTag, childOpts = {}) {
      const child = createElStub(childTag, childOpts);
      if (childOpts.value !== undefined) child.value = childOpts.value;
      if (childOpts.text !== undefined) child.text = childOpts.text;
      this.children.push(child);
      if (childTag === 'option') {
        this.options.push(child);
        if (this.options.length === 1 && !this.value) this.value = child.value;
      }
      return child;
    },
    createDiv(childOpts = {}) { return this.createEl('div', childOpts); },
  };
  return el;
}

test('Obsidian 视图：加载记忆 Agent、切换任务或 Agent 同步状态，并在 rules 缺失时降级可用', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-obs-view-'));
  const vault = path.join(tmp, 'data', 'knowledge', 'vault');
  fs.mkdirSync(vault, { recursive: true });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const token = 'a'.repeat(64);
  const requests = [];
  let notifyAgentsOrganize = null;
  const agentsOrganizeDone = new Promise((r) => { notifyAgentsOrganize = r; });
  let notifyOrganize = null;
  const organizeDone = new Promise((r) => { notifyOrganize = r; });
  const srv = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/fish-vault/models') {
      res.end(JSON.stringify({ models: [{ id: 'group/deepseek', name: 'DeepSeek' }] }));
      return;
    }
    if (req.url === '/api/fish-vault/memory/agents?role=learn') {
      res.end(JSON.stringify({
        agents: [
          { id: 'memory-curator', name: '记忆整理 Agent' },
          { id: 'obsidian-memory', name: 'Obsidian 记忆 Agent' },
        ],
        defaults: { learn: 'obsidian-memory', organize: 'obsidian-memory', dream: 'obsidian-memory' },
        roles: ['learn', 'organize', 'dream'],
      }));
      return;
    }
    if (req.url === '/api/fish-vault/memory/agents?role=organize') {
      res.end(JSON.stringify({
        agents: [{ id: 'obsidian-memory', name: 'Obsidian 记忆 Agent' }],
        defaults: { organize: 'obsidian-memory' },
        roles: ['learn', 'organize', 'dream'],
      }));
      notifyAgentsOrganize();
      return;
    }
    if (req.url.startsWith('/api/fish-vault/memory/agents/status')) {
      res.end(JSON.stringify({ running: false, role: req.url.includes('organize') ? 'organize' : 'learn', phase: 'done' }));
      if (req.url.includes('role=organize')) notifyOrganize();
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());

  const port = srv.address().port;
  fs.writeFileSync(path.join(tmp, 'data', 'fish-obsidian-connection.json'), JSON.stringify({
    url: `http://127.0.0.1:${port}/`,
    token,
    vault,
  }));

  let RegisteredView = null;
  const stub = {
    Plugin: class {
      registerView(_type, factory) { RegisteredView = factory; }
      addRibbonIcon() {}
      addCommand() {}
    },
    ItemView: class {
      constructor() { this.contentEl = createElStub('div'); }
    },
    Modal: class {},
    Notice: class {},
  };

  // Load with rules.js missing to verify graceful fallback alongside agent selection.
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'obsidian') return stub;
    if (request === './rules') throw Object.assign(Error("Cannot find module './rules'"), { code: 'MODULE_NOT_FOUND' });
    return load.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('./main.js')];
  const PluginClass = require('./main.js');
  Module._load = load;

  const instance = new PluginClass();
  await instance.onload();
  assert.ok(RegisteredView, 'view factory registered');

  const view = RegisteredView({ id: 'leaf' });
  view.app = {
    vault: {
      adapter: { getBasePath: () => vault },
      getFiles: () => [],
    },
  };
  await view.onOpen();

  assert.equal(view.agentSel.options.length, 2, '应列出可用记忆 Agent');
  assert.equal(view.agent, 'obsidian-memory', '应优先选中当前 role 的默认 Agent');
  assert.equal(view.agentSel.value, 'obsidian-memory');

  // Switching agent updates view.agent.
  view.agentSel.value = 'memory-curator';
  await view.agentSel.dispatch('change');
  assert.equal(view.agent, 'memory-curator', '切换 Agent 下拉应更新选中 agent');

  // Switching role reloads role agents & polls that role's status.
  view.roleSel.value = 'organize';
  await view.roleSel.dispatch('change');
  await Promise.all([agentsOrganizeDone, organizeDone]);
  for (let i = 0; i < 100 && (view.agentSel.options.length !== 1 || !requests.includes('/api/fish-vault/memory/agents/status?role=organize')); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(view.agentSel.options.length, 1);
  assert.equal(view.agent, 'obsidian-memory');
  assert.ok(requests.includes('/api/fish-vault/memory/agents/status?role=organize'));
});
