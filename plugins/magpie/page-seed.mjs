import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const seedDirectoryName='page-checkin';

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
    const stream=createReadStream(child);
    try{for await(const chunk of stream)hash.update(chunk)}finally{stream.destroy()}
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

// 条目指向内置页面的判定：spec 是绝对路径（旧版把包目录写死），或以包名开头。
// 包名认两套 scope：#32 之前的 `@magpie-community/<name>` 与之后的 `@fish-under-sea/<name>`
// ——升级时用户清单里可能还是旧的，不认旧的就会重复登记成两条。
// 不认其他插件，避免误改用户自己装的同名以外的东西。
const SEED_SCOPES=['@magpie-community','@fish-under-sea'];
export function isSeedSpec(spec,name=seedDirectoryName){
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
export function rewriteSeedSpec({raw,spec,name=seedDirectoryName}){
 const hasRaw=raw!==undefined&&raw!==null;
 const text=hasRaw?String(raw):'';
 const body=text.replace(/^\uFEFF/,'');
 let manifest;
 if(body.trim()){manifest=JSON.parse(body)}
 else manifest={plugins:[]};
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||!Array.isArray(manifest.plugins))throw Error('plugins.json 结构无效');
 // spec 只接受绝对路径：稳定目录在 <data> 下，相对路径会随 CWD 漂移。
 if(!path.isAbsolute(spec))throw Error('稳定插件目录必须是绝对路径');
 // 命中条目保留 options（页面折叠状态等）与 off；同包多条时只留第一条，其余删除，
 // 否则 magpie 会按包名去重成随机的那一份。
 let kept=false;
 manifest.plugins=manifest.plugins.filter(entry=>{
  if(!entry||typeof entry!=='object'||!isSeedSpec(entry.spec,name))return true;
  if(kept)return false;
  kept=true;entry.spec=spec;return true;
 });
 if(!kept)manifest.plugins.push({spec});
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

// 让 <data>/plugins.json 用稳定路径引用签到页，其余条目原样保留。
export async function registerSeedPage({data,directory,name=seedDirectoryName,onPhase=()=>{},signal}={}){
 const file=path.join(data,'plugins.json');
 let raw;
 try{raw=await fs.readFile(file,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
 const next=rewriteSeedSpec({raw,spec:directory,name});
 if(!next.changed)return {written:false,file,spec:directory};
 onPhase('prepare-data');
 signal?.throwIfAborted();
 await writeManifest(file,next.text,signal);
 return {written:true,file,spec:directory};
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