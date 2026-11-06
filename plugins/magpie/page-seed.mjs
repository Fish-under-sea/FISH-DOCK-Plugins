import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// 预置的内置插件：Dock 只负责「把包名登记进 magpie 的插件清单」，**不随包分发目录**。
//
// 为什么不再带目录副本：2.2.9 的内置件是同步到 <data>/plugins/<name> 再以绝对路径
// 登记的，那条 spec 不在 magpie 自己的更新循环里——目录副本永远是发版那天的版本，
// 上游发了修复用户也拿不到。改成 npm spec 之后与 @magpie-community 那批预装供应
// 商插件同口径：首装由 magpie 的更新循环按 spec 安装，之后也按同一条路更新，
// Dock 这边不用再跟着发版。
export const builtinPlugins=Object.freeze([
 {name:'magpie-checkin-relay-probe',pkg:'@fish-under-sea/magpie-checkin-relay-probe',spec:'@fish-under-sea/magpie-checkin-relay-probe@latest'},
 {name:'magpie-purge',pkg:'@fish-under-sea/magpie-purge',spec:'@fish-under-sea/magpie-purge@latest'},
]);

// 2.2.8 及更早的两个内置页面插件：内容已并进「签到&探针」那个包，升级时清单里那
// 两条要整条去掉，否则侧边栏同时出现旧的两个 + 新的一个。
export const legacySeedNames=Object.freeze(['page-checkin','page-relay-probe']);

const SEED_SCOPES=['@magpie-community','@fish-under-sea'];

// 条目是否指向某个旧内置页：spec 是绝对路径（旧版把包目录写死），或以旧包名开头。
// 两套 scope 都认，升级时用户清单里可能还是旧的 `@magpie-community/...`。
export function isSeedSpec(spec,name){
 if(typeof name!=='string'||!name)return false;
 if(typeof spec!=='string'||!spec)return false;
 if(path.isAbsolute(spec)){
  return path.basename(spec.replace(/[\\/]+$/,''))===name||spec.replace(/\\/g,'/').split('/').includes(name);
 }
 return SEED_SCOPES.some(scope=>{
  const packageName=`${scope}/${name}`;
  return spec===packageName||spec.startsWith(`${packageName}@`)||spec.startsWith(`${packageName}/`)||spec.startsWith(`${packageName}#`);
 });
}

// npm spec 的包名：`@scope/name@1.2.3` → `@scope/name`；`name@1.2.3` → `name`。
// git spec、绝对路径、空值返回 ''（那不是 npm 包，按「不匹配」处理）。
export function packageNameOf(spec){
 if(typeof spec!=='string')return '';
 let text=spec.trim();
 if(!text||path.isAbsolute(text))return '';
 const hash=text.indexOf('#');
 if(hash>0)text=text.slice(0,hash);
 const scoped=/^(@[^/@]+\/[^/@]+)(?:@[^/]*)?$/.exec(text);
 if(scoped)return scoped[1];
 const plain=/^([^/@]+)(?:@[^/]*)?$/.exec(text);
 return plain?plain[1]:'';
}

// 条目是否已经是某个内置插件的 npm 条目，或指向它 2.2.9 的目录副本
// （<data>/plugins/<name> 绝对路径）。目录那条要迁成 npm spec；用户自己写的 npm
// spec（哪怕钉了版本）原样保留——钉版本是用户的选择，不该被我们改回 @latest。
function builtinOf(spec,item){
 if(typeof spec!=='string'||!spec)return false;
 if(packageNameOf(spec)===item.pkg)return true;
 return path.isAbsolute(spec)&&path.basename(spec.replace(/[\\/]+$/,''))===item.name;
}

// plugins.json 只由结构相同的 {spec,off,options} 条目组成。改写后逐字比较：没变化就
// 不动磁盘，也不刷新时间戳。
//
// 规则：
//   1. 旧内置页（legacy）整条删掉——它们的内容并进了新包；
//   2. 每个内置插件只留第一条：目录副本换成 npm spec，原有 npm spec 不动；
//      options 与 off 原样保留，其余重复条目删掉，否则 magpie 会按包名去重成随机的一份；
//   3. 缺席的内置插件补在末尾。
export function rewriteBuiltinSpecs({raw,plugins=builtinPlugins,legacy=legacySeedNames}){
 const hasRaw=raw!==undefined&&raw!==null;
 const text=hasRaw?String(raw):'';
 const body=text.replace(/^\uFEFF/,'');
 let manifest;
 if(body.trim()){manifest=JSON.parse(body)}
 else manifest={plugins:[]};
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||!Array.isArray(manifest.plugins))throw Error('plugins.json 结构无效');
 const kept=[];
 for(const entry of manifest.plugins){
  if(!entry||typeof entry!=='object')continue;
  if(legacy.some(name=>isSeedSpec(entry.spec,name)))continue;
  kept.push(entry);
 }
 for(const item of plugins){
  let seen=false;
  const next=[];
  for(const entry of kept){
   if(!builtinOf(entry.spec,item)){next.push(entry);continue}
   if(seen)continue;
   seen=true;
   if(path.isAbsolute(entry.spec))entry.spec=item.spec;
   next.push(entry);
  }
  if(!seen)next.push({spec:item.spec});
  kept.length=0;kept.push(...next);
 }
 manifest.plugins=kept;
 const next=JSON.stringify(manifest,null,2)+'\n';
 return {changed:!hasRaw||next!==text,text:next};
}

// 先备份再写；备份用 wx，已有旧备份不会被本次覆盖。preinstall.mjs 登记预装供应商
// 插件时写的是同一个 plugins.json，所以这一份写盘逻辑共用。
export async function writeManifest(file,text,signal){
 const backup=`${file}.bak`;
 try{await fs.writeFile(backup,await fs.readFile(file,'utf8'),{flag:'wx',mode:0o600})}
 catch(error){
  // 第一份备份已经在，保留它；源文件不存在时没有可备份的内容。
  if(!['EEXIST','ENOENT'].includes(error.code))throw error;
 }
 signal?.throwIfAborted();
 const temporary=`${file}.${randomUUID()}.tmp`;
 const handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile(text);await handle.sync()}finally{await handle.close()}
 try{await fs.rename(temporary,file)}
 finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
}

// 把内置插件按 npm spec 登记进 <data>/plugins.json，其余条目原样保留；旧的两个内置页
// 在这一步一并删掉，2.2.9 留下的目录副本也在这里迁成 npm spec。
export async function registerBuiltinPlugins({data,onPhase=()=>{},signal}={}){
 const file=path.join(data,'plugins.json');
 let raw;
 try{raw=await fs.readFile(file,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
 const next=rewriteBuiltinSpecs({raw});
 if(!next.changed)return {written:false,file};
 onPhase('prepare-data');
 signal?.throwIfAborted();
 await writeManifest(file,next.text,signal);
 return {written:true,file};
}

// 侧边栏标题只放文字：`@Fish-under-sea/签到` → `签到`。
// 包名仍然是 npm 身份（不能动），但标题里带 scope 前缀只是噪声。这里做一次幂等
// 归一化：只改以 `@用户/` 开头的标题，别的标题一个字都不碰；没变化就不写盘。
const TITLE_SCOPE=/^@[^/\\]+\//;
export function stripTitleScope(title){
 if(typeof title!=='string')return title;
 const trimmed=title.replace(/^@[^/\\]+\//,'');
 // `@user/` 后面什么都没有时保留原样，别把标题清成空串。
 return trimmed.trim()?trimmed.trim():title;
}
export function normalizePageManifest(text){
 let manifest;
 try{manifest=JSON.parse(String(text??'').replace(/^\uFEFF/,''))}catch{return null}
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return null;
 const page=manifest.magpie?.page;
 if(!page||typeof page!=='object')return null;
 let changed=false;
 const fix=(holder,key)=>{
  const value=holder?.[key];
  if(typeof value==='string'){
   const next=stripTitleScope(value);
   if(next!==value){holder[key]=next;changed=true}
  }
 };
 fix(page,'title');
 if(page.titles&&typeof page.titles==='object')for(const key of Object.keys(page.titles))fix(page.titles,key);
 if(!changed)return {changed:false,text:String(text??'')};
 return {changed:true,text:JSON.stringify(manifest,null,2)+'\n'};
}
// 把 <data>/plugins/<name>/package.json 的标题归一化；返回改了哪些目录。
export async function normalizePageTitles({data,signal}={}){
 const root=path.join(data,'plugins');
 let entries;
 try{entries=await fs.readdir(root,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return [];throw error}
 const fixed=[];
 for(const entry of entries){
  if(!entry.isDirectory())continue;
  signal?.throwIfAborted();
  const file=path.join(root,entry.name,'package.json');
  let text;
  try{text=await fs.readFile(file,'utf8')}catch(error){if(error.code==='ENOENT')continue;throw error}
  const result=normalizePageManifest(text);
  if(!result?.changed)continue;
  await writeManifest(file,result.text,signal);
  fixed.push(entry.name);
 }
 return fixed;
}