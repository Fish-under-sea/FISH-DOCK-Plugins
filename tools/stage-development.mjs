import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {stageOfm} from '../plugins/ofm/stage.mjs';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// definitions 是发行清单；开发中的插件放在 developmentDefinitions，
// 只进入开发暂存目录，不进入 build-release 的 ZIP/商店目录。
// autostart 是 #22 的清单行为钩子：宿主只在「随 Dock 启动」这一次传
// FISH_PLUGIN_AUTOSTART=1；没有本机服务的插件写 false，卡面显示「无需自启动」。
export const definitions=[
 {key:'feishu',name:'飞书通知',directory:'.fishplugin-feishu',capabilities:['storage','events','network'],autostart:false},
 {key:'clash',name:'Clash 代理',directory:'.fishplugin-clash',capabilities:['storage','network','services','system-proxy'],autostart:true},
 {key:'magpie',name:'Magpie 网关',directory:'.fishplugin-magpie',capabilities:['storage','network','services'],autostart:true},
 {key:'ofm',name:'OFM 本地模型',directory:'.fishplugin-ourfreemodel',capabilities:['storage','network','services'],autostart:true},
];
export const developmentDefinitions=[
 {key:'relay-probe',name:'中转站探针',directory:'.fishplugin-relay-probe',capabilities:['storage','network'],autostart:false},
];
// 2.0.0 的身份表：作者是数组，不再有 maintainer；note 只写状态说明（OFM 暂停维护）。
// build-release 与 catalog/stable.json 都从这里取，避免两处各写一份。
export const identity={
 feishu:{authors:['WTStarMark','FISH']},
 clash:{authors:['Elysia395','FISH']},
 magpie:{authors:['FISH','Jassdingk']},
 ofm:{authors:['FISH'],note:'此插件于 10 月 25 日暂停维护'},
};
const stagedDefinitions=[...definitions,...developmentDefinitions];
// 仅产生供开发加载的目录，不制作 ZIP、不更新线上目录、不携带用户数据。
export function stage({out,sdk,ofm,magpie,mihomo,only,include}={}){
 if(!path.isAbsolute(out)||fs.existsSync(out))throw Error('请使用新的绝对输出目录');
 if(!sdk||!path.isAbsolute(sdk))throw Error('请明确指定 Dock SDK 目录');
 const copy=(source,target)=>{if(!fs.lstatSync(source).isFile())throw Error('源资源不是普通文件');fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target)};
 // 页面插件是整棵目录（package.json + page/），不是单文件，逐层复制，链接一律拒绝。
 const copyDir=(source,target)=>{fs.mkdirSync(target,{recursive:true});for(const item of fs.readdirSync(source,{withFileTypes:true})){const s=path.join(source,item.name),t=path.join(target,item.name);if(item.isDirectory())copyDir(s,t);else if(item.isFile()){if(item.name.endsWith('.cs')||item.name.includes('.test.'))continue;fs.copyFileSync(s,t)}else throw Error('源资源不是普通文件');}};
 const resources=[];
// 发行构建传入 include（只有官方插件）；开发暂存不传，连开发插件一起产出。
 const selected=include?stagedDefinitions.filter(definition=>include.includes(definition.key)):only?definitions.filter(row=>row.key===only):stagedDefinitions;
 if(!selected.length)throw Error('未知插件');
 for(const definition of selected){
  const {key,name,directory,capabilities}=definition,root=path.join(out,key);
  fs.mkdirSync(root,{recursive:true});
  for(const item of fs.readdirSync(path.join(repository,'plugins',key),{withFileTypes:true})){
   const source=path.join(repository,'plugins',key,item.name),target=path.join(root,'plugins',key,item.name);
   // 插件目录允许子目录（例如 Clash 的 service/tun-service.exe）；构建期 .cs 源码不进包。
   // 以点开头的目录是本地构建缓存（magpie 的 .tools 里有 Go 工具链与模块缓存，上万文件
   // 且含链接），不进包，否则 copyDir 会撞上非普通文件而中止。
   if(item.isDirectory()&&!item.name.startsWith('.'))copyDir(source,target);
   else if(item.isFile()&&!item.name.includes('.test.')&&item.name!=='stage.mjs'&&!item.name.endsWith('.cs'))copy(source,target);
  }
  // Magpie 内置的页面插件（page-checkin）以目录随插件发布，首启由 MAGPIE_SEED_EXTRA 装进清单。
  const bundled=path.join(repository,'plugins',key,'page-plugins');
  if(key==='magpie'&&fs.existsSync(bundled))copyDir(bundled,path.join(root,'plugins',key,'page-plugins'));
  for(const item of fs.readdirSync(path.join(repository,'shared'),{withFileTypes:true}))if(item.isFile()&&!item.name.includes('.test.'))copy(path.join(repository,'shared',item.name),path.join(root,'shared',item.name));
  copy(path.join(sdk,'node','plugin.mjs'),path.join(root,'plugins',key,'sdk.mjs'));
  copy(path.join(sdk,'browser','bridge.js'),path.join(root,'bridge.js'));
  let executable=null;
  if(key==='ofm'&&ofm){stageOfm(ofm,path.join(root,'service'));executable='service/packages/desktop/service-host.mjs';}
  if(key==='magpie'&&magpie){copy(magpie,path.join(root,'service','magpie.exe'));executable='service/magpie.exe';}
  if(key==='clash'&&mihomo){copy(mihomo,path.join(root,'service','mihomo.exe'));executable='service/mihomo.exe';}
  fs.writeFileSync(path.join(root,'README.md'),`# ${name}\n\n版本：2.0.0；宿主 API：1；开发预览。\n\n数据由宿主解析的 .fish-dock/${directory} 管理，按 credentials、roster、keys、config、exports、backups、tmp 分类。停用和卸载保留资料。\n\n服务按需启动，首次配置由用户确认。此目录尚未发布，不代表线上商店已提供下载。\n`);
  const files={};
  function walk(relative=''){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=relative?`${relative}/${entry.name}`:entry.name;if(entry.isDirectory())walk(file);else if(entry.isFile())files[file]=hash(fs.readFileSync(path.join(root,file)));else throw Error('资源树包含链接');}}
  walk();
  const manifest={schema:1,id:`fish.${key}`,name,version:'1.0.0',hostApi:1,platforms:['windows-x86_64'],storage:{directory,dataSchema:1},behaviors:{autostart:definition.autostart===true},backend:{runtime:'node',entry:`plugins/${key}/backend.mjs`},capabilities,pages:[{id:'main',title:name,entry:key==='ofm'||key==='magpie'?'shared/gateway-page.html':`plugins/${key}/page.html`}],files};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(root,'plugin.json'),bytes);
  resources.push({id:manifest.id,directory:key,sha256:hash(bytes),executable});
 }
 fs.writeFileSync(path.join(out,'development.json'),JSON.stringify({schema:1,plugins:resources},null,2)+'\n');
 return resources;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args={};for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index];if(!['--out','--sdk','--ofm','--magpie','--mihomo'].includes(key)||!process.argv[index+1])throw Error('参数为 --out、--sdk 以及可选的 --ofm、--magpie、--mihomo');args[key.slice(2)]=path.resolve(process.argv[index+1]);}
 console.log(JSON.stringify(stage(args).map(row=>({id:row.id,ready:!!row.executable||row.id==='fish.feishu'||row.id==='fish.relay-probe'})),null,2));
}
