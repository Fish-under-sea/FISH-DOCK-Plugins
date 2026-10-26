import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
export function stageOfm(source,destination){
 if(!path.isAbsolute(source)||!path.isAbsolute(destination)||fs.existsSync(destination))throw Error('OFM 暂存须使用新的绝对路径');
 const copy=(name)=>{const out=path.join(destination,name);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(source,name),out)};
 const tree=(name,accept)=>{for(const item of fs.readdirSync(path.join(source,name),{withFileTypes:true})){const child=`${name}/${item.name}`;if(item.isDirectory())tree(child,accept);else if(item.isFile()&&accept(child))copy(child)}};
 tree('src',p=>/\.(js|json)$/.test(p));
 for(const name of ['cli','service','management','login-terminal','open-external','eac','backup'])copy(`packages/standalone/${name}.mjs`);
 copy('packages/standalone/package.json');copy('packages/standalone/backup-readme.txt');tree('packages/standalone/channels',p=>p.endsWith('.mjs'));tree('packages/standalone/vendor',p=>p.endsWith('.mjs')||p.endsWith('/LICENSE'));tree('packages/standalone/web',p=>/\.(html|js|css|json)$/.test(p));
 copy('packages/desktop/service-host.mjs');for(const name of ['qoder-auth-wasm.wasm','LICENSE','NOTICE.md'])copy(`vendor/channel-pack/${name}`);copy('LICENSE');copy('scripts/standalone-third-party.txt');
 fs.writeFileSync(path.join(destination,'package.json'),'{"private":true,"type":"module"}\n');
 fs.copyFileSync(path.join(own,'storage-layout.mjs'),path.join(destination,'src/fish-storage.js'));
 function patch(name,changes,importPath){const file=path.join(destination,name);let text=fs.readFileSync(file,'utf8');for(const [before,after]of changes){if(!text.includes(before))throw Error(`上游 OFM 接口变化：${name}`);text=text.replaceAll(before,after)}if(importPath)text=`import {fishDataPath,fishRelative} from '${importPath}';\n${text}`;fs.writeFileSync(file,text)}
 patch('src/core/runtime.js',[["path.join(dataDir, file)","fishDataPath(dataDir, file)"],["path.join(dataDir, 'settings.json')","fishDataPath(dataDir, 'settings.json')"]],'../fish-storage.js');
 patch('packages/standalone/service.mjs',[["path.join(dataDir, 'service.lock')","fishDataPath(dataDir, 'service.lock')"],["path.join(dataDir, 'settings.json')","fishDataPath(dataDir, 'settings.json')"]],'../../src/fish-storage.js');
 patch('packages/standalone/eac.mjs',[["path.join(dataDir, EAC_USER_FILE)","fishDataPath(dataDir, EAC_USER_FILE)"]],'../../src/fish-storage.js');
 patch('packages/standalone/channels/credentials.mjs',[["path.join(dataDir, 'channel-credentials.json')","fishDataPath(dataDir, 'channel-credentials.json')"]],'../../../src/fish-storage.js');
 patch('packages/standalone/channels/runtime.mjs',[["path.join(dataDir, 'channel-pack', 'codearts-cache')","fishDataPath(dataDir, 'channel-pack/codearts-cache')"]],'../../../src/fish-storage.js');
 patch('packages/standalone/login-terminal.mjs',[["(platform === 'win32' ? path.win32 : path.posix).join(dataDir, 'settings.json')","fishDataPath(dataDir, 'settings.json')"]],'../../src/fish-storage.js');
 patch('packages/standalone/management.mjs',[["`${info().dataDir}/settings.json`","fishDataPath(info().dataDir, 'settings.json')"]],'../../src/fish-storage.js');
 patch('packages/standalone/backup.mjs',[["const base = fs.realpathSync(root)","relative = fishRelative(relative);\n  const base = fs.realpathSync(root)"]],'../../src/fish-storage.js');
 // 产物补丁逐项匹配；上游输出改变时停止暂存，避免静默恢复旧路径。
 const bundle='packages/standalone/channels/business.mjs';let text=fs.readFileSync(path.join(destination,bundle),'utf8');
 const matches=[...text.matchAll(/join\d*\((home|this\.home), "channel-pack"(?:, ([^)\n]+))?\)/g)];
 if(matches.length!==8)throw Error('OFM channel-pack 分类路径数量已变化，请审查更新');
 text=text.replace(/join\d*\((home|this\.home), "channel-pack"(?:, ([^)\n]+))?\)/g,(_,home,name)=>name?`fishDataPath(${home}, "channel-pack/" + ${name})`:`fishDataPath(${home}, "channel-pack/.directory") + "/.."`);
 fs.writeFileSync(path.join(destination,bundle),`import {fishDataPath} from '../../../src/fish-storage.js';\n${text}`);
 // 独立插件不开放局域网同端口，由宿主仅嵌入回环管理页。
 patch('packages/desktop/service-host.mjs',[["{ lanSamePort: true }","{ lanSamePort: false }"]]);
 return destination;
}
