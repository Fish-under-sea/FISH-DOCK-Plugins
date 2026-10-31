import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {identity} from './stage-development.mjs';

// 身份与发行目录共用 tools/stage-development.mjs 里的 identity：作者是数组，没有 maintainer。
export const PLUGINS = [
  {id: 'feishu', name: '飞书通知', description: '飞书群机器人通知、事件筛选和签名测试', licenses: []},
  {id: 'clash', name: 'Clash 代理', description: 'mihomo、订阅、节点、模式和系统代理', licenses: ['mihomo.txt']},
  {id: 'magpie', name: 'Magpie 网关', description: '独立 Magpie 网关和原生管理页', licenses: ['Magpie.txt']},
  {id: 'ofm', name: 'OFM 本地模型', description: '独立 OFM 渠道账号、模型目录和原生管理页', licenses: []},
].map(plugin => ({...plugin, authors: identity[plugin.id].authors, ...(identity[plugin.id].note ? {note: identity[plugin.id].note} : {})}));

// 版本只有一个来源：发行目录里的 stable.json。以前这里写死 2.0.0，发 2.0.1 时
// npm 包的 package.json 仍是旧版本，verify-release 直接判「npm 包身份或版本不一致」。
export async function catalogVersion(dist) {
 const catalog = JSON.parse(await fs.readFile(path.join(dist, 'stable.json'), 'utf8'));
 const versions = [...new Set((catalog.plugins ?? []).map(row => row.version))];
 if (versions.length !== 1) throw Error(`发行目录里的插件版本不一致：${versions.join('、') || '空'}`);
 const [version] = versions;
 if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('发行目录里的版本格式无效');
 return version;
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '..');

const arg = (args, name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const packageReadme = (plugin, VERSION) => `# @fish-under-sea/fish-dock-plugin-${plugin.id}

FISH Dock 官方「${plugin.name}」插件，版本 ${VERSION}。适用于 FISH Dock 2.0.0+、Windows x64 和宿主 API 1。

作者：${plugin.authors.join('、')}。${plugin.note ? `${plugin.note}。` : ''}

此 npm 包只包含文件「${plugin.id}.fish-plugin」，可按需安装单个插件，不会安装其他插件，不运行安装后脚本，也不会自动修改系统设置。

## 使用

安装：
npm install @fish-under-sea/fish-dock-plugin-${plugin.id}@${VERSION}
npx @fish-under-sea/fish-dock-plugin-${plugin.id} --out C:/work/plugins

命令只把已校验的「${plugin.id}.fish-plugin」复制到指定目录；然后在 FISH Dock 的「插件」页选择该文件导入。目标文件已存在时命令会停止，避免覆盖已有版本。

功能：${plugin.description}。

GitHub Release：[FISH-DOCK-Plugins v${VERSION}](https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v${VERSION})。
`;

const installerScript = plugin => `#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const expected=${JSON.stringify(plugin.archiveSha256)};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,${JSON.stringify(`${plugin.id}.fish-plugin`)});
const args=process.argv.slice(2),index=args.indexOf('--out');
const output=path.resolve(index>=0&&args[index+1]?args[index+1]:process.cwd());
const bytes=await fs.readFile(source);
const digest=createHash('sha256').update(bytes).digest('hex');
if(digest!==expected)throw Error('插件包 SHA-256 校验失败');
await fs.mkdir(output,{recursive:true});
const target=path.join(output,${JSON.stringify(`${plugin.id}.fish-plugin`)});
await fs.writeFile(target,bytes,{flag:'wx'});
console.log(\`已安装：\${target}\\nSHA-256：\${digest}\`);
`;

export async function buildNpmPackages({dist, out, sourceRoot = repoRoot, version, only}) {
  version = version ?? await catalogVersion(dist);
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('版本格式无效');
  const selected=only?PLUGINS.filter(p=>p.id===only):PLUGINS;
  if(!selected.length)throw Error('未知插件');
  if(!path.isAbsolute(out))throw Error('请使用新的绝对输出目录');
  // Never erase a previous build (or an accidentally supplied data/source root).
  await fs.mkdir(path.dirname(out), {recursive: true});
  await fs.mkdir(out);
  for (const base of selected) {
    const archiveName = `${base.id}.fish-plugin`;
    const archivePath = path.join(dist, archiveName);
    const archive = await fs.readFile(archivePath);
    const plugin = {...base, archiveSha256: createHash('sha256').update(archive).digest('hex')};
    const packageRoot = path.join(out, base.id);
    await fs.mkdir(path.join(packageRoot, 'bin'), {recursive: true});
    await fs.mkdir(path.join(packageRoot, 'licenses'), {recursive: true});
    await fs.copyFile(archivePath, path.join(packageRoot, archiveName));
    await fs.copyFile(path.join(sourceRoot, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
    await fs.copyFile(path.join(sourceRoot, 'THIRD_PARTY_NOTICES.md'), path.join(packageRoot, 'THIRD_PARTY_NOTICES.md'));
    for (const license of plugin.licenses) await fs.copyFile(path.join(sourceRoot, 'licenses', license), path.join(packageRoot, 'licenses', license));
    await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name: `@fish-under-sea/fish-dock-plugin-${base.id}`,
      version,
      description: `FISH Dock 官方${base.name}插件（按需单包）`,
      type: 'module',
      bin: {[`fish-dock-plugin-${base.id}`]: 'bin/install.mjs'},
      files: [archiveName, 'bin/install.mjs', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses'],
      engines: {node: '>=24.0.0'},
      license: 'MIT',
      repository: {type: 'git', url: 'git+https://github.com/Fish-under-sea/FISH-DOCK-Plugins.git'},
      homepage: `https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/tag/v${version}`,
      publishConfig: {access: 'public'},
    }, null, 2)}\n`);
    await fs.writeFile(path.join(packageRoot, 'README.md'), packageReadme(plugin, version));
    await fs.writeFile(path.join(packageRoot, 'bin', 'install.mjs'), installerScript(plugin));
  }
  return {out, packages: selected.map(plugin => ({id: plugin.id, directory: path.join(out, plugin.id)}))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(thisDir, 'build-npm-packages.mjs')) {
  const args = process.argv.slice(2);
  const dist = path.resolve(arg(args, '--dist', path.join(repoRoot, '..', '..', '.tools', 'plugin-release-2.0.0', 'dist')));
  const out = path.resolve(arg(args, '--out', path.join(repoRoot, '..', '..', '.tools', 'npm-plugin-packages-2.0.0')));
  console.log(JSON.stringify(await buildNpmPackages({dist, out, version: arg(args, '--version'), only: arg(args, '--only')})));
}
