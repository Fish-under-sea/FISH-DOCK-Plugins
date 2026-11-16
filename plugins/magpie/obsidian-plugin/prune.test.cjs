'use strict';
// prune, against a stand-in vault: which files it deletes, and which it
// must never even look at.
//
// main.js requires obsidian, which only exists inside Obsidian. The test
// gives it a stand-in through the module cache, so the real prune (and the
// real ownFiles) is the code exercised here.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const rules = require('./rules.js');

// obsidian is a stub: a plugin registers a view, a modal confirms, a notice
// says something. Nothing is drawn.
const stub = {
  Plugin: class { registerView() {} addRibbonIcon() {} addCommand() {} },
  ItemView: class {},
  Modal: class {},
  Notice: class { constructor(text) { this.text = text; } },
};

const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return stub;
  return load.call(this, request, parent, isMain);
};
const plugin = require('./main.js');
Module._load = load;

const FOLDER = rules.FOLDER;

// a vault of files on disk, as Obsidian's vault API sees it: getFiles,
// getAbstractFileByPath and trash. getFiles and cachedRead hand back the
// same file object, as Obsidian's do.
function fakeVault(files) {
  const byPath = new Map();
  for (const f of files) {
    byPath.set(f.path, {
      path: f.path,
      stat: { size: f.size, mtime: f.mtime },
      text: f.text || '',
    });
  }
  const vault = {
    getFiles: () => [...byPath.values()],
    getAbstractFileByPath: (p) => byPath.get(p) || null,
    cachedRead: async (f) => f.text,
    read: async (f) => f.text,
    trash: async (f) => { byPath.delete(f.path); },
    deleted: byPath,
  };
  return vault;
}

test('prune deletes only this plugin\'s notes, oldest first, to the budget', async () => {
  const mine = (n, mtime) => ({
    path: `${FOLDER}/n${n}.md`,
    size: 8 * 1024 * 1024,
    mtime,
    text: rules.body('note ' + n),
  });
  const vault = fakeVault([
    mine(0, 10), mine(1, 20), mine(2, 30),
    // never counted, never deleted
    { path: 'memories/important.md', size: 9 * 1024 * 1024, mtime: 1, text: 'a memory' },
    { path: 'wiki/long.md', size: 9 * 1024 * 1024, mtime: 1, text: 'a note' },
    // in the folder but the user's own: no marker, no plugin name
    { path: `${FOLDER}/我的笔记.md`, size: 9 * 1024 * 1024, mtime: 2, text: '# mine' },
  ]);
  const r = await plugin.prune(vault);
  assert.equal(r.total, 24 * 1024 * 1024, 'only the plugin\'s three were counted');
  // 24 MB less the oldest 8 MB is 16 MB, under the 20 MB budget: one goes
  assert.deepEqual(r.deleted, [`${FOLDER}/n0.md`], 'the oldest goes first, and only as many as needed');
  // vault.deleted holds what is still there: the pruned note is gone, the
  // rest stay, whatever else the vault holds
  assert.ok(!vault.deleted.has(`${FOLDER}/n0.md`), 'the pruned note is still there');
  assert.ok(vault.deleted.has(`${FOLDER}/n1.md`) && vault.deleted.has(`${FOLDER}/n2.md`), 'a kept note was deleted');
  assert.ok(vault.deleted.has('memories/important.md'), 'a memory was deleted');
  assert.ok(vault.deleted.has('wiki/long.md'), 'a wiki note was deleted');
  assert.ok(vault.deleted.has(`${FOLDER}/我的笔记.md`), 'the user\'s own note was deleted');
});

test('prune leaves a folder under its budget alone', async () => {
  const vault = fakeVault([
    { path: `${FOLDER}/a.md`, size: 1024, mtime: 1, text: rules.body('a') },
  ]);
  const r = await plugin.prune(vault);
  assert.deepEqual(r.deleted, []);
  assert.ok(vault.deleted.has(`${FOLDER}/a.md`));
});

test('prune does nothing when the folder isn\'t there', async () => {
  const r = await plugin.prune(fakeVault([]));
  assert.deepEqual(r, { total: 0, overflow: 0, deleted: [] });
});

test('ownFiles skips everything outside the one folder', async () => {
  const vault = fakeVault([
    { path: `${FOLDER}/a.md`, size: 3, mtime: 1, text: rules.body('a') },
    { path: 'memories/b.md', size: 3, mtime: 1, text: rules.body('b') },
    { path: `${FOLDER}/sub/c.md`, size: 3, mtime: 1, text: rules.body('c') },
  ]);
  const files = await plugin.ownFiles(vault);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, `${FOLDER}/a.md`);
});