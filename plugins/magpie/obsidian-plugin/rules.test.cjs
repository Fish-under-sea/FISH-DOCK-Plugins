'use strict';
// The rules main.js runs by, without Obsidian, a vault or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('./rules.js');

test('a note is written under the one folder, as a Markdown file', () => {
  const rel = rules.writePath(rules.noteName(Date.UTC(2026, 10, 16, 12, 0, 0, 5), 0.123456));
  assert.match(rel, /^Magpie 对话\/2026-11-16T12-00-00-005Z-[0-9a-f]{6}\.md$/);
});

test('a name that escapes the folder is refused', () => {
  for (const bad of ['', '   ', '../x.md', 'a/b.md', 'a\\b.md', '..', '.', '.hidden.md', 'a..b.md', '~x.md', 'x.txt', 'x.md\u0000', 'x\ny.md']) {
    assert.throws(() => rules.writePath(bad), undefined, JSON.stringify(bad) + " was taken");
  }
  assert.equal(rules.writePath('  正常.md '), 'Magpie 对话/正常.md');
});

test('only a file in the one folder is ours to touch', () => {
  assert.ok(rules.ownPath('Magpie 对话/a.md'));
  for (const bad of ['memories/a.md', 'Magpie 对话/sub/a.md', 'Magpie 对话/../memories/a.md', 'Magpie 对话/.a.md', 'Magpie 对话/a.txt', 'wiki/Magpie 对话/a.md', 'Magpie 对话/a\\b.md', 'Magpie 对话/']) {
    assert.equal(rules.ownPath(bad), false, bad + ' counted as ours');
  }
});

test('a note the plugin wrote is marked, and an old one is known by its name', () => {
  assert.ok(rules.isOurs(rules.body('hello'), 'x.md'));
  assert.ok(rules.isOurs('', '2026-11-16T12-00-00-005Z-abc123.md'));
  assert.equal(rules.isOurs('# the user wrote this', 'my-note.md'), false);
  assert.equal(rules.isOurs('', 'random.md'), false);
});

test('under the budget nothing is dropped', () => {
  const files = [
    { path: 'Magpie 对话/a.md', size: 1024, mtime: 3, ours: true },
    { path: 'Magpie 对话/b.md', size: 1024, mtime: 1, ours: true },
  ];
  const r = rules.budget(files, 4096);
  assert.equal(r.total, 2048);
  assert.deepEqual(r.drop, []);
});

test('over the budget the oldest of ours go first, until it is back under', () => {
  const files = [
    { path: 'Magpie 对话/new.md', size: 8, mtime: 30, ours: true },
    { path: 'Magpie 对话/old.md', size: 8, mtime: 10, ours: true },
    { path: 'Magpie 对话/mid.md', size: 8, mtime: 20, ours: true },
  ];
  const r = rules.budget(files, 16);
  assert.equal(r.total, 24);
  assert.equal(r.overflow, 8);
  assert.deepEqual(r.drop, ['Magpie 对话/old.md'], 'oldest first, only as many as needed');
  const all = rules.budget(files, 0);
  assert.deepEqual(all.drop, ['Magpie 对话/old.md', 'Magpie 对话/mid.md', 'Magpie 对话/new.md']);
});

// The whole point of the budget: it never reaches past its own folder.
test('a file the plugin did not write is never counted or deleted', () => {
  const files = [
    { path: 'Magpie 对话/old.md', size: 8, mtime: 10, ours: true },
    { path: 'Magpie 对话/new.md', size: 8, mtime: 20, ours: true },
    { path: 'memories/important.md', size: 100, mtime: 1, ours: false },
    { path: 'memories/old.md', size: 50, mtime: 2, ours: true },
    { path: 'Magpie 对话/notes.md', size: 30, mtime: 3, ours: false },
  ];
  const r = rules.budget(files, 8);
  assert.equal(r.total, 16);
  for (const p of r.drop) {
    assert.ok(p.startsWith('Magpie 对话/'), 'dropped outside the folder: ' + p);
    assert.ok(!p.includes('memories/'), 'dropped a memory: ' + p);
    assert.ok(p !== 'Magpie 对话/notes.md', 'dropped the user\'s own note');
  }
  assert.deepEqual(r.drop, ['Magpie 对话/old.md']);
});

test('the 20 MB budget is the default', () => {
  assert.equal(rules.BUDGET, 20 * 1024 * 1024);
  const big = [];
  for (let i = 0; i < 4; i++) big.push({ path: `Magpie 对话/n${i}.md`, size: 7 * 1024 * 1024, mtime: i, ours: true });
  const r = rules.budget(big);
  assert.equal(r.total, 28 * 1024 * 1024);
  // 28 MB less one 7 MB file is 21 MB, still over; two bring it to 14 MB
  assert.deepEqual(r.drop, ['Magpie 对话/n0.md', 'Magpie 对话/n1.md'], 'the fewest oldest files that bring 28 MB under 20 MB');
  assert.equal(r.overflow, 8 * 1024 * 1024);
});

test('the agents a role may run as are names, never models', () => {
  const view = {
    agents: [
      { id: 'memory-curator', name: '记忆整理 Agent', role: 'learn|organize', model: 'group/deepseek' },
      { id: 'dreamer', name: '做梦 Agent', role: 'dream', model: 'group/deepseek' },
    ],
    defaults: { learn: 'memory-curator', dream: 'dreamer' },
  };
  const list = rules.roleAgents(view, 'learn');
  assert.equal(list.length, 2);
  for (const a of list) {
    assert.ok(a.id && a.name);
    assert.equal(a.model, undefined, 'a model reached the picker');
    assert.ok(!JSON.stringify(a).includes('deepseek'));
  }
  assert.deepEqual(rules.roleAgents(null), []);
  assert.deepEqual(rules.roleAgents({ agents: [{ name: 'no id' }] }), []);
});

test('a run is shown by its phase, how far, and what it said', () => {
  const lines = rules.statusLines({
    running: true, role: 'learn', phase: 'tool',
    doing: 2, of: 5,
    messages: [
      { role: 'note', text: 'Starting: learn' },
      { tool: 'memory_search', text: '找 3 条' },
    ],
  });
  assert.equal(lines[0], '运行中（learn） · tool · 2/5');
  assert.equal(lines[1], 'note · Starting: learn');
  assert.equal(lines[2], 'memory_search · 找 3 条');

  // a finished run that failed says why, in its own words
  assert.deepEqual(rules.statusLines({ role: 'dream', phase: 'failed', error: 'no knowledge vault' })[0], '上次失败（dream）：no knowledge vault');
  // a finished run that went through says so
  assert.deepEqual(rules.statusLines({ role: 'organize', phase: 'done' })[0], '上次结束（organize） · done');
  assert.deepEqual(rules.statusLines(null), []);
});