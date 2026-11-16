import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

async function optional(file){try{return await fs.lstat(file)}catch(e){if(e.code==='ENOENT')return null;throw e}}
export async function detectObsidian({env=process.env,platform=process.platform}={}){
 const home=env.USERPROFILE||env.HOME||os.homedir();
 const config=platform==='win32'?path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'obsidian','obsidian.json'):platform==='darwin'?path.join(home,'Library','Application Support','obsidian','obsidian.json'):path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'obsidian','obsidian.json');
 const candidates=platform==='win32'?[
  path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Programs','Obsidian','Obsidian.exe'),
  path.join(env.ProgramFiles||'C:\\Program Files','Obsidian','Obsidian.exe'),
 ]:platform==='darwin'?['/Applications/Obsidian.app/Contents/MacOS/Obsidian']:[];
 let executable='';for(const candidate of candidates)if((await optional(candidate))?.isFile()){executable=candidate;break}
 return {installed:!!executable,executable,config};
}
export function obsidianURI(vault,file=''){
 if(!path.isAbsolute(vault)||file&&(path.isAbsolute(file)||file.split(/[\\/]/).some(p=>p==='..')))throw Error('知识库链接路径无效');
 return `obsidian://open?path=${encodeURIComponent(file?path.join(vault,file):vault)}`;
}
// Register only the new owned vault; never remove or relabel another vault.
// Obsidian may hold its registry in memory. Report that a reload can be needed,
// instead of claiming that writing this file made the plugin load in its window.
export async function registerObsidianVault(vault,{detected}={}){
 const state=detected||await detectObsidian();
 if(!state.installed)return {...state,registered:false,reason:'未检测到 Obsidian；Magpie 知识库照常可用'};
 const real=await fs.realpath(vault);if((await fs.lstat(vault)).isSymbolicLink())throw Error('不能登记链接知识库');
 const file=state.config;await fs.mkdir(path.dirname(file),{recursive:true});
 const lock=`${file}.fish-lock`;let handle;
 try{handle=await fs.open(lock,'wx',0o600)}catch(e){if(e.code==='EEXIST')throw Error('Obsidian 库登记正被另一操作使用，请稍后重试');throw e}
 try{
  const info=await optional(file);if(info?.isSymbolicLink()||info&&!info.isFile())throw Error('Obsidian 库登记文件不是普通文件');
  const raw=info?await fs.readFile(file,'utf8'):null;
  const doc=raw===null?{}:JSON.parse(raw);
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||Object.hasOwn(doc,'vaults')&&(!doc.vaults||typeof doc.vaults!=='object'||Array.isArray(doc.vaults)))throw Error('Obsidian 库登记文件无效，已保留');
  doc.vaults??={};
  const canonical=p=>path.resolve(p).toLowerCase();
  for(const [id,row] of Object.entries(doc.vaults))if(typeof row?.path==='string'&&canonical(row.path)===canonical(real))return {...state,registered:true,vault:real,id,reloadNeeded:true};
  const id=createHash('sha256').update(canonical(real)).digest('hex').slice(0,16);
  if(doc.vaults[id])throw Error('Obsidian 知识库标识冲突，已保留原登记');
  doc.vaults[id]={path:real,ts:Date.now()};
  if(raw!==null)try{await fs.writeFile(`${file}.before-fish-vault`,raw,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}
  const temporary=`${file}.${randomUUID()}.tmp`;
  try{
   await fs.writeFile(temporary,JSON.stringify(doc),{flag:'wx',mode:0o600});
   const current=(await optional(file))?await fs.readFile(file,'utf8'):null;
   if(current!==raw)throw Error('Obsidian 正在更新库登记，请稍后重试');
   await fs.rename(temporary,file);
  }finally{await fs.rm(temporary,{force:true})}
  return {...state,registered:true,vault:real,id,reloadNeeded:true};
 }finally{await handle.close();await fs.rm(lock,{force:true})}
}
export async function openObsidianVault(vault,{detected,launch,spawnProcess=spawn}={}){
 const result=await registerObsidianVault(vault,{detected});if(!result.registered)throw Error(result.reason);
 const uri=obsidianURI(vault);
 if(launch)await launch(result.executable,[uri]);
 // Obsidian is a GUI, not a background service. SW_HIDE from windowsHide:true
 // can suppress its vault window while the chooser closes, leaving only an
 // invisible Electron process. Keep stdio detached without hiding its windows.
 else await new Promise((resolve,reject)=>{const child=spawnProcess(result.executable,[uri],{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()})});
 return {...result,opened:true};
}
