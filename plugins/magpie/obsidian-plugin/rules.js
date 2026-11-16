'use strict';
// The Obsidian plugin's rules that need no Obsidian, no HTTP and no vault:
// where it may write, what it may read back, and what it drops when its own
// folder grows past its budget.
//
// main.js requires this file; the tests require it too, so the rules are
// exercised without a browser or a real vault.

// FOLDER is the one folder this plugin writes notes into, inside the vault.
// Everything else in the vault is read-only to it.
const FOLDER = 'Magpie 对话';
// BUDGET is how much its folder may hold, in bytes: past it, its own files
// go oldest first until it is back under.
const BUDGET = 20 * 1024 * 1024;
// MARKER is the front matter every note this plugin writes carries, so a
// file it didn't write (the user's own, edited in) is never deleted. An
// older note without the marker but named as this plugin names them is
// taken as its own (WRITTEN).
const MARKER = 'magpie-generated: true';
// WRITTEN is how this plugin names a note it writes:
// YYYY-MM-DDTHH-MM-SS-sssZ-<6 hex>.md
const WRITTEN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}\.md$/;

// noteName is the name of the note this plugin writes at time now.
function noteName(now, random) {
  const iso = new Date(now).toISOString().replace(/[:.]/g, '-');
  const suffix = String(random).slice(2, 8).padEnd(6, '0');
  return `${iso}-${suffix}.md`;
}

// writePath is the vault-relative path a note is written to, or an error:
// one path segment name under FOLDER, nothing else. A name that is empty,
// absolute, has a separator, a `..`, a `~`, a UNC prefix, a control
// character or a leading dot is refused: the plugin writes nowhere else.
function writePath(name) {
  if (typeof name !== 'string') throw Error('笔记名必须是文字');
  const n = name.trim();
  if (!n) throw Error('笔记名不能为空');
  if (n.length > 120) throw Error('笔记名过长');
  if (n.includes('/') || n.includes('\\')) throw Error('笔记名不能包含路径分隔符');
  if (n === '.' || n === '..' || n.startsWith('.')) throw Error('笔记名不能以点开头');
  if (n.includes('..')) throw Error('笔记名不能包含 ..');
  if (n.includes('~')) throw Error('笔记名不能包含 ~');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) throw Error('笔记名不能包含控制字符');
  if (!/\.md$/i.test(n)) throw Error('笔记必须是 Markdown 文件');
  return `${FOLDER}/${n}`;
}

// ownPath says whether a vault-relative path is one this plugin wrote: it
// starts with FOLDER and a single segment, and nothing else follows.
function ownPath(rel) {
  if (typeof rel !== 'string') return false;
  const prefix = FOLDER + '/';
  if (!rel.startsWith(prefix)) return false;
  const rest = rel.slice(prefix.length);
  if (!rest || rest.includes('/') || rest.includes('\\') || rest.includes('..')) return false;
  if (rest.startsWith('.') || rest.startsWith('~')) return false;
  return /\.md$/i.test(rest);
}

// isOurs says whether a file in FOLDER may be deleted by the budget: one
// this plugin wrote, by its marker or by the name it gives them.
function isOurs(text, name) {
  return typeof text === 'string' && text.startsWith(MARKER) || WRITTEN.test(name || '');
}

// body is what the plugin puts in a note: the marker first, then the
// assistant's text as it came, never interpreted.
function body(text) {
  return `${MARKER}\n\n${text}\n`;
}

// budget is how much may be deleted from a folder's files to bring it to
// BUDGET: the files, oldest first by modified time, until the total is at
// or under. Files that aren't ours are neither counted nor deleted, and
// nothing outside the folder is ever named.
//
// files: [{path, size, mtime, ours}] all inside FOLDER.
// Returns {total, overflow, drop: [paths in the order to delete]}.
function budget(files, limit = BUDGET) {
  const ours = (files || []).filter((f) => f.ours && ownPath(f.path));
  const total = ours.reduce((n, f) => n + Math.max(0, f.size | 0), 0);
  if (total <= limit) return { total, overflow: 0, drop: [] };
  const ordered = ours.slice().sort((a, b) => (a.mtime - b.mtime) || (a.path < b.path ? -1 : 1));
  const drop = [];
  let left = total;
  for (const f of ordered) {
    if (left <= limit) break;
    drop.push(f.path);
    left -= Math.max(0, f.size | 0);
  }
  return { total, overflow: total - limit, drop };
}

// roleAgents is the agents a role may be run as, from the bridge's answer:
// ids and names only, never a model. The registry's own answer is
// {agents: [{id, name}], defaults, roles}.
function roleAgents(view, role) {
  if (!view || !Array.isArray(view.agents)) return [];
  return view.agents.map((a) => ({ id: a.id, name: a.name || a.id })).filter((a) => a.id);
}

// statusLines is what a run's status says, one line a message, newest
// last: the phase, how far it has gone, and what it said or the tool it
// called. A finished run that failed says why.
function statusLines(st, max = 20) {
  if (!st) return [];
  const out = [];
  const role = st.role ? `（${st.role}）` : '';
  if (st.running) {
    const of = st.of ? ` · ${st.doing || 0}/${st.of}` : '';
    out.push(`运行中${role}${st.phase ? ' · ' + st.phase : ''}${of}`);
  } else if (st.error) {
    out.push(`上次失败${role}：${st.error}`);
  } else if (st.phase) {
    out.push(`上次结束${role} · ${st.phase}`);
  }
  for (const m of (st.messages || []).slice(-max)) {
    const who = m.tool ? m.tool : m.role || '';
    out.push(who ? `${who} · ${m.text || ''}` : (m.text || ''));
  }
  return out;
}

module.exports = { FOLDER, BUDGET, MARKER, WRITTEN, noteName, writePath, ownPath, isOurs, body, budget, roleAgents, statusLines };