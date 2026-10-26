import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {stageOfm} from '../plugins/ofm/stage.mjs';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const definitions=[
 {key:'feishu',name:'飞书通知',directory:'.fishplugin-feishu',capabilities:['storage','events','network']},
 {key:'clash',name:'Clash 代理',directory:'.fishplugin-clash',capabilities:['storage','network','services','system-proxy']},
 {key:'magpie',name:'Magpie 网关',directory:'.fishplugin-magpie',capabilities:['storage','network','services']},
 {key:'ofm',name:'OFM 本地模型',directory:'.fishplugin-ourfreemodel',capabilities:['storage','network','services']},
];
// 仅产生供开发加载的目录，不制作 ZIP、不更新线上目录、不携带用户数据。
export function stage({out,sdk,ofm,magpie,mihomo}){
 if(!path.isAbsolute(out)||fs.existsSync(out))throw Error('请使用新的绝对输出目录');
 if(!sdk||!path.isAbsolute(sdk))throw Error('请明确指定 Dock SDK 目录');
 const copy=(source,target)=>{if(!fs.lstatSync(source).isFile())throw Error('源资源不是普通文件');fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target)};
 const resources=[];
 for(const definition of definitions){
  const {key,name,directory,capabilities}=definition,root=path.join(out,key);
  fs.mkdirSync(root,{recursive:true});
  for(const item of fs.readdirSync(path.join(repository,'plugins',key),{withFileTypes:true})){
   if(item.isFile()&&!item.name.includes('.test.')&&item.name!=='stage.mjs')copy(path.join(repository,'plugins',key,item.name),path.join(root,'plugins',key,item.name));
  }
  for(const item of fs.readdirSync(path.join(repository,'shared'),{withFileTypes:true}))if(item.isFile()&&!item.name.includes('.test.'))copy(path.join(repository,'shared',item.name),path.join(root,'shared',item.name));
  copy(path.join(sdk,'node','plugin.mjs'),path.join(root,'plugins',key,'sdk.mjs'));
  copy(path.join(sdk,'browser','bridge.js'),path.join(root,'bridge.js'));
  let executable=null;
  if(key==='ofm'&&ofm){stageOfm(ofm,path.join(root,'service'));executable='service/packages/desktop/service-host.mjs';}
  if(key==='magpie'&&magpie){copy(magpie,path.join(root,'service','magpie.exe'));executable='service/magpie.exe';}
  if(key==='clash'&&mihomo){copy(mihomo,path.join(root,'service','mihomo.exe'));executable='service/mihomo.exe';}
  fs.writeFileSync(path.join(root,'README.md'),`# ${name}\n\n版本：1.0.0；宿主 API：1；开发预览。\n\n数据由宿主解析的 .fish-dock/${directory} 管理，按 credentials、roster、keys、config、exports、backups、tmp 分类。停用和卸载保留资料。\n\n服务按需启动，首次配置由用户确认。此目录尚未发布，不代表线上商店已提供下载。\n`);
  const files={};
  function walk(relative=''){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=relative?`${relative}/${entry.name}`:entry.name;if(entry.isDirectory())walk(file);else if(entry.isFile())files[file]=hash(fs.readFileSync(path.join(root,file)));else throw Error('资源树包含链接');}}
  walk();
  const manifest={schema:1,id:`fish.${key}`,name,version:'1.0.0',hostApi:1,platforms:['windows-x86_64'],storage:{directory,dataSchema:1},backend:{runtime:'node',entry:`plugins/${key}/backend.mjs`},capabilities,pages:[{id:'main',title:name,entry:key==='ofm'||key==='magpie'?'shared/gateway-page.html':`plugins/${key}/page.html`}],files};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(root,'plugin.json'),bytes);
  resources.push({id:manifest.id,directory:key,sha256:hash(bytes),executable});
 }
 fs.writeFileSync(path.join(out,'development.json'),JSON.stringify({schema:1,plugins:resources},null,2)+'\n');
 return resources;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args={};for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index];if(!['--out','--sdk','--ofm','--magpie','--mihomo'].includes(key)||!process.argv[index+1])throw Error('参数为 --out、--sdk 以及可选的 --ofm、--magpie、--mihomo');args[key.slice(2)]=path.resolve(process.argv[index+1]);}
 console.log(JSON.stringify(stage(args).map(row=>({id:row.id,ready:!!row.executable||row.id==='fish.feishu'})),null,2));
}
