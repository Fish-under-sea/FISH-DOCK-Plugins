// 交接 2026-11-15-magpie-web-folders.md §6.1/§7.1：magpie 网页模式下的「打开文件夹/
// 选文件夹」按钮在被代理转发前接住。本文件只做可测纯函数：文案契约、路由白名单、
// 路径解析、同源判定、opener。不在这里开连接（embed-proxy 负责）。
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';

// 与 pinned 二进制一致的拒绝文案前缀（末尾是冒号加空格）。上游改文案会让前缀失配，
// 集成/UI 测试在 pinned 二进制上会立刻红（§9 版本守护）。
export const REVEAL_REFUSED = "in the browser magpie can't open folders: it is ";

// 网页里会弹红字、需要接力到资源管理器的路由（含懒加载模块里才出现的两条）。
export const REVEAL_ROUTES = new Set([
  '/api/library/reveal',
  '/api/settings/reveal',
  '/api/settings/log/reveal',
  '/api/davsync/reveal',
  '/api/autobackup/reveal',
  '/api/datafolder/reveal',
  '/api/gateway/held/reveal',
]);

// 从 magpie 的拒绝文案里取出目标路径：展开 ~，规范化；拒绝相对路径、\\?\ 与 \\.\
// 设备路径、非 WSL 的 UNC。路径来自服务端已校验的报错（传库外路径会得到
// not a path the library shows），代理不采信页面传来的 path。
export function targetOf(message, home) {
  if (typeof message !== 'string' || !message.startsWith(REVEAL_REFUSED)) return null;
  let p = message.slice(REVEAL_REFUSED.length).trim();
  if (!p) return null;
  if (p === '~') p = home;
  else if (/^~[\\/]/.test(p)) p = path.join(home, p.slice(2));
  if (!path.isAbsolute(p)) return null;
  if (/^\\\\[.?]\\/.test(p)) return null; // \\?\ 与 \\.\ 设备路径
  const unc = /^\\\\([^\\/]+)/.exec(p);
  if (unc && !['wsl$', 'wsl.localhost'].includes(unc[1].toLowerCase())) return null;
  return path.normalize(p);
}

// 仅本机页面可触发：远端（LAN/隧道）访问的页面必须被拒。Origin 为空（非浏览器本机
// 客户端，如 curl）放行——它们本就能自己开资源管理器；'null' 等不可解析的一律拒。
export function sameOrigin(req, port) {
  const site = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false; // cross-site / same-site 一律拒
  const origin = String(req.headers?.origin || '');
  if (!origin) return true;
  let u;
  try { u = new URL(origin); } catch { return false; }
  const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname.toLowerCase());
  return local && Number(u.port) === Number(port);
}

// 打开资源管理器：目录直接打开，文件用 /select 选中。spawn 与 platform 可注入便于测试。
// explorer 成功也常回 1，不等退出码；detached 后 unref 不阻塞代理。
export async function openInExplorer(target, run = spawn, platform = process.platform) {
  const stat = await fs.stat(target); // 不存在就抛，调用方透传上游 400
  const select = !stat.isDirectory();
  let command, args;
  if (platform === 'win32') {
    command = 'explorer.exe';
    args = select ? [`/select,${target}`] : [target];
  } else if (platform === 'darwin') {
    command = 'open';
    args = select ? ['-R', target] : [target];
  } else {
    command = 'xdg-open';
    args = [select ? path.dirname(target) : target];
  }
  const child = run(command, args, {detached: true, stdio: 'ignore'});
  child?.unref?.();
}

// P1：从宿主 dialogs.chooseFolder 的返回里取选中目录。给 embed-proxy 用。
// 返回字符串或 null（取消）。
export function pickedDir(result) {
  if (!result || typeof result !== 'object') return null;
  const dir = result.dir;
  if (typeof dir !== 'string' || !dir) return null;
  return dir;
}
