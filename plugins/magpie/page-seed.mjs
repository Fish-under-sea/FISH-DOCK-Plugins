import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// 同步目录的默认名字：2.2.9 起内置件里排第一个的就是它。调用方一般显式传 name。
export const seedDirectoryName='magpie-checkin-relay-probe';

async function exists(target){try{await fs.stat(target);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}

// 目录内容指纹：子目录递归，文件路径与内容都参与 sha256。与时间戳、绝对路径无关，
// 换机或搬目录不改变指纹；空目录与少一个文件不会撞同一个值。目录不存在返回 null。
export async function directoryDigest(root,{signal}={}){
 const hash=createHash('sha256');
 // 递归只向同一个 hash 追加，digest 只在这里调用一次——子级不能各自收尾。
 async function walk(directory,relative){
  let entries;
  try{entries=await fs.readdir(directory,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return false;throw error}
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
   signal?.throwIfAborted();
   const child=path.join(directory,entry.name),name=relative?`${relative}/${entry.name}`:entry.name;
   // 链接不跟随：页面目录只发布普通文件，遇到链接即视为不可信内容。
   if(entry.isSymbolicLink())throw Error('页面目录包含链接');
   if(entry.isDirectory()){hash.update(`d:${name}\0`);await walk(child,name)}
   else if(entry.isFile()){
    hash.update(`f:${name}\0`);
    // package.json 的标题会被「去 @用户名 前缀」规范化后落盘；比较两边指纹时
    // 也按规范化后的文本算，否则每次启动都会判定「内容变了」→ 重写 → 再规范化，
    // 变成每次都发布一遍目录（还可能撞上文件占用）。
    if(name==='package.json'){
     const text=await fs.readFile(child,'utf8');
     const normalized=normalizePageManifest(text);
     hash.update(normalized?.changed?normalized.text:text);
    }else{
     const stream=createReadStream(child);
     try{for await(const chunk of stream)hash.update(chunk)}finally{stream.destroy()}
    }
    hash.update('\0');
   }
  }
  return true;
 }
 if(!await walk(root,''))return null;
 return hash.digest('hex');
}

// 页面目录必须整体同步：只补有变化的文件会把上一版本删掉的文件留在磁盘上，
// 页面还会加载到旧脚本。先完整写临时目录，再 rename 换名；失败把旧目录搬回来。
// Windows 不允许 rename 覆盖非空目录，所以旧目录先挪到同级的 .previous 再回滚。
async function publish({source,target,temporary,backup,signal}){
 await fs.cp(source,temporary,{recursive:true,force:false,errorOnExist:false});
 signal?.throwIfAborted();
 const retired=await exists(target);
 if(retired)await fs.rename(target,backup);
 try{await fs.rename(temporary,target)}
 catch(error){if(retired)await fs.rename(backup,target).catch(()=>{});throw error}
 if(retired)await fs.rm(backup,{recursive:true,force:true});
}

// 把随插件发布的页面目录同步到稳定位置 <data>/plugins/<name>，供 plugins.json
// 以固定 spec 引用；版本升级只换内容，不换路径。
// 返回 {directory,digest,written}，written 为 false 表示内容一致、磁盘未动。
export async function syncPageDirectory({source,data,name=seedDirectoryName,onPhase=()=>{},signal}={}){
 if(!await exists(source))return null;
 signal?.throwIfAborted();
 const directory=path.join(data,'plugins',name);
 const wanted=await directoryDigest(source,{signal});
 let written=wanted!==await directoryDigest(directory,{signal})||!await exists(directory);
 if(written){
  onPhase('prepare-data');
  const tag=randomUUID();
  const temporary=path.join(path.dirname(directory),`.${name}.tmp-${tag}`),backup=path.join(path.dirname(directory),`.${name}.old-${tag}`);
  await fs.mkdir(path.dirname(directory),{recursive:true});
  try{
   try{await publish({source,target:directory,temporary,backup,signal})}
   // 另一个实例抢先发布完同一份内容时，磁盘已是目标状态，按成功处理。
   catch(error){if(await directoryDigest(directory,{signal})!==wanted)throw error;written=false}
  }finally{await fs.rm(temporary,{recursive:true,force:true})}
 }
 return {directory,digest:written?await directoryDigest(directory,{signal}):wanted,written};
}

// 内置插件的名字与顺序：目录名、<data>/plugins/<name> 与清单里的条目都按它。
// 2.2.9 起两个内置件分开维护（各自一个仓库 + 一个 npm 包），Dock 只负责把它们
// 随 Magpie 包分发、首启同步与登记：
//   · magpie-checkin-relay-probe：签到 + 中转站探针合成一个页面插件，页内两页切换
//   · magpie-purge：破甲 · Purge（页面 + 网关钩子）
export const bundledPlugins=Object.freeze(['magpie-checkin-relay-probe','magpie-purge']);

// 2.2.8 及更早的两个内置页面插件。它们的内容已经并进 magpie-checkin-relay-probe，
// 升级时清单里那两条要整条去掉：留着就是侧边栏同时出现旧的两个 + 新的一个。
export const legacySeedNames=Object.freeze(['page-checkin','page-relay-probe']);

// 条目指向某个内置插件的判定：spec 是绝对路径（旧版把包目录写死），或以包名开头。
// 包名认两套 scope：#32 之前的 `@magpie-community/<name>` 与之后的 `@fish-under-sea/<name>`
// ——升级时用户清单里可能还是旧的，不认旧的就会重复登记成两条。
// 不认其他插件，避免误改用户自己装的同名以外的东西。
const SEED_SCOPES=['@magpie-community','@fish-under-sea'];
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

// plugins.json 只由结构相同的 {spec,off,options} 条目组成。改写后逐字比较：没变化就
// 不动磁盘，也不刷新时间戳。
//
// specs 是「内置插件名 → 稳定目录」的 Map，按 bundledPlugins 的顺序给。规则：
//   1. 旧内置页（legacy）整条删掉——它们的内容并进了新包；
//   2. 同名条目只留第一条，spec 改成稳定目录，options 与 off 原样保留（用户折叠
//      过、停用过都算数），其余重复条目删掉，否则 magpie 按包名去重成随机的一份。
export function rewriteBundledSpecs({raw,specs,legacy=legacySeedNames}){
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
 for(const [name,directory] of specs){
  // spec 只接受绝对路径：稳定目录在 <data> 下，相对路径会随 CWD 漂移。
  if(!path.isAbsolute(directory))throw Error('稳定插件目录必须是绝对路径');
  let done=false;
  const next=[];
  for(const entry of kept){
   if(isSeedSpec(entry.spec,name)){
    if(done)continue;
    done=true;entry.spec=directory;
   }
   next.push(entry);
  }
  if(!done)next.push({spec:directory});
  kept.length=0;kept.push(...next);
 }
 manifest.plugins=kept;
 const next=JSON.stringify(manifest,null,2)+'\n';
 return {changed:!hasRaw||next!==text,text:next};
}

// 先备份再写；备份用 wx，已有旧备份不会被本次覆盖。preinstall.mjs 登记供应商
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

// 让 <data>/plugins.json 用稳定路径引用每个已同步的内置插件，其余条目原样保留；
// 旧的两个内置页在这一步一并删掉。directories 是「内置插件名 → 稳定目录」的 Map。
export async function registerBundledPlugins({data,directories,onPhase=()=>{},signal}={}){
 const file=path.join(data,'plugins.json');
 let raw;
 try{raw=await fs.readFile(file,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
 const specs=new Map(bundledPlugins.filter(name=>directories?.has(name)).map(name=>[name,directories.get(name)]));
 const next=rewriteBundledSpecs({raw,specs});
 if(!next.changed)return {written:false,file,specs};
 onPhase('prepare-data');
 signal?.throwIfAborted();
 await writeManifest(file,next.text,signal);
 return {written:true,file,specs};
}
// 侧边栏标题只放文字：`@Fish-under-sea/签到` → `签到`。
// 包名仍然是 `@fish-under-sea/page-checkin`（npm 身份不能动），但标题里带 scope 前缀
// 只是噪声——用户要的是「签到」「中转站探针」这几个字。这里做一次幂等归一化：
// 只改以 `@用户/` 开头的标题，别的标题一个字都不碰；没变化就不写盘。
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