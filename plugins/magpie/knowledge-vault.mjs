import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

export const vaultName='github-capability-vault';
export const importRecord='.fish-import.json';
export function vaultPaths(data){
 if(!path.isAbsolute(data))throw Error('知识库需要绝对数据路径');
 const root=path.join(data,'knowledge',vaultName);
 return {root,memories:path.join(root,'memories'),connection:path.join(data,'fish-obsidian-connection.json')};
}
export function defaultSourceVault(home=os.homedir()){
 return path.join(home,'Documents','Obsidian Vault',vaultName);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function optionalStat(file){try{return await fs.lstat(file)}catch(error){if(error.code==='ENOENT')return null;throw error}}
async function realDirectory(directory){
 const info=await fs.lstat(directory);
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('知识库目录不是独立的普通目录');
 // lstat catches a junction at the leaf; realpath also catches redirected parents.
 const resolved=await fs.realpath(directory);
 if(path.resolve(resolved).toLowerCase()!==path.resolve(directory).toLowerCase())throw Error('知识库路径包含链接');
}
async function manifest(root,{signal,excludeObsidian=false}={}){
 await realDirectory(root);
 const files=[];
 async function walk(relative=''){
  signal?.throwIfAborted();
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
   signal?.throwIfAborted();
   if(excludeObsidian&&relative===''&&entry.name.toLowerCase()==='.obsidian')continue;
   const name=relative?`${relative}/${entry.name}`:entry.name;
   const file=path.join(root,name),info=await fs.lstat(file);
   if(info.isSymbolicLink())throw Error(`知识库含链接：${name}`);
   if(info.isDirectory())await walk(name);
   else if(info.isFile()){
    const bytes=await fs.readFile(file,{signal});
    files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
   }else throw Error(`知识库含非普通文件：${name}`);
  }
 }
 await walk();return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function readRecord(root){
 await realDirectory(root);
 const record=JSON.parse(await fs.readFile(path.join(root,importRecord),'utf8'));
 if(record.schema!==1||!Array.isArray(record.files)||typeof record.imported!=='boolean')throw Error('知识库迁移记录无效');
 return record;
}

// Only a successful, verified staging directory is published. A second launch never
// copies from Documents again; source deletion and later note edits are independent.
export async function prepareKnowledgeVault({data,sourceVault=defaultSourceVault(),signal,onPhase=()=>{}}){
 const paths=vaultPaths(data),existing=await optionalStat(paths.root);
 signal?.throwIfAborted();onPhase('prepare-knowledge');
 if(existing){
  let record;try{record=await readRecord(paths.root)}catch(error){throw Object.assign(Error('现有知识库缺少完整迁移记录；已保留原样，请检查后重试'),{code:'VAULT_CONFLICT',cause:error})}
  return {...paths,imported:record.imported,files:record.files.length,created:false};
 }
 const parent=path.dirname(paths.root);
 await fs.mkdir(parent,{recursive:true});await realDirectory(parent);
 const staging=await fs.mkdtemp(path.join(parent,'.vault-'));
 try{
  const source=sourceVault?await optionalStat(sourceVault):null;
  let files=[];
  if(source){
   await realDirectory(sourceVault);
   const relative=path.relative(sourceVault,paths.root);
   if(relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('不能把知识库复制到源目录内部');
   files=await manifest(sourceVault,{signal,excludeObsidian:true});
   if(files.some(f=>f.path===importRecord||f.path==='memories'||f.path.startsWith('memories/')))throw Error('源知识库占用了 Magpie 记忆保留目录');
   for(const file of files){
    signal?.throwIfAborted();
    // Recheck each ancestor and the leaf immediately before copying. No symlink
    // traversal is accepted, including a source replaced after inventory.
    let current=sourceVault;
    for(const component of file.path.split('/')){
     current=path.join(current,component);
     if((await fs.lstat(current)).isSymbolicLink())throw Error(`知识库含链接：${file.path}`);
    }
    const bytes=await fs.readFile(current,{signal});
    if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error(`复制期间源文件发生变化：${file.path}`);
    const target=path.join(staging,file.path);await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,bytes,{flag:'wx'});
   }
   const copied=await manifest(staging,{signal});
   if(JSON.stringify(copied)!==JSON.stringify(files))throw Error('知识库复制校验失败');
   // Detect additions/deletions as well as changes during the copy.
   if(JSON.stringify(await manifest(sourceVault,{signal,excludeObsidian:true}))!==JSON.stringify(files))throw Error('复制期间源知识库发生变化');
  }
  signal?.throwIfAborted();
  await fs.writeFile(path.join(staging,importRecord),JSON.stringify({schema:1,imported:!!source,at:new Date().toISOString(),files},null,2)+'\n',{flag:'wx'});
  try{await fs.rename(staging,paths.root)}catch(error){
   if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;
   const record=await readRecord(paths.root);
   return {...paths,imported:record.imported,files:record.files.length,created:false};
  }
  return {...paths,imported:!!source,files:files.length,created:true};
 }finally{await fs.rm(staging,{recursive:true,force:true})}
}

export const obsidianPluginId='fish-magpie-memory';
export const obsidianResources=['manifest.json','main.js','styles.css'];
// Owned release files only: never touch data.json, notes or other plugins.
export async function deployObsidianPlugin(root,{resources=new URL('./obsidian-plugin/',import.meta.url)}={}){
 await readRecord(root);
 const target=path.join(root,'.obsidian','plugins',obsidianPluginId);
 for(const directory of [path.join(root,'.obsidian'),path.join(root,'.obsidian','plugins'),target]){
  await fs.mkdir(directory,{recursive:true});await realDirectory(directory);
 }
 for(const name of obsidianResources){
  const source=new URL(name,resources),bytes=await fs.readFile(source);
  const output=path.join(target,name),info=await optionalStat(output);
  if(info?.isSymbolicLink()||info&&!info.isFile())throw Error('Obsidian 插件文件不是普通文件');
  if(info&&Buffer.compare(await fs.readFile(output),bytes)===0)continue;
  const temporary=path.join(target,`.${name}-${randomUUID()}`);
  try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,output)}finally{await fs.rm(temporary,{force:true})}
 }
 const enabled=path.join(root,'.obsidian','community-plugins.json');
 const info=await optionalStat(enabled);
 if(info?.isSymbolicLink())throw Error('Obsidian 插件配置包含链接');
 const ids=info?JSON.parse(await fs.readFile(enabled,'utf8')):[];
 if(!Array.isArray(ids)||ids.some(v=>typeof v!=='string'))throw Error('Obsidian 插件配置无效，已保留');
 if(!ids.includes(obsidianPluginId)){
  const temporary=`${enabled}.${randomUUID()}.tmp`;
  try{await fs.writeFile(temporary,JSON.stringify([...ids,obsidianPluginId],null,2)+'\n',{flag:'wx'});await fs.rename(temporary,enabled)}finally{await fs.rm(temporary,{force:true})}
 }
 return {id:obsidianPluginId,root};
}
