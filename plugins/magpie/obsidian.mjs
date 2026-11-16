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
 // encodeURIComponent 而不是 QueryEscape：后者把空格写成 '+', 只有在「按查询串解码」的实现里
 // 才还原得回来；协议处理器拿到的若被当成裸路径，'+' 会变成一个真的加号。
 return `obsidian://open?path=${encodeURIComponent(file?path.join(vault,file):vault)}`;
}
// isOwnVaultOpenURL: 只认本插件知识库自己的 obsidian://open?path=<root>[/笔记.md]。
// 这条判据是「不交给 magpie 打开」的唯一凭据：magpie 的 /api/open 最终走
// rundll32 url.dll,FileProtocolHandler（ShellExecute），而 magpie 由 Dock 以
// windowsHide 启动、自身又没有控制台，继承下来的显示状态可能让 Obsidian 的窗口
// 被隐藏——用户看到的就是「点了没反应 / 只在后台多一个进程」。
// 因此适配层自己接管这一条，用 windowsHide:false 直接拉起。
// 越界、多参数、别的协议一律 false，交回 magpie 原来的处理。
export function isOwnVaultOpenURL(raw,root){
 if(typeof raw!=='string'||!raw||!root||raw.length>4096)return false;
 let url;try{url=new URL(raw)}catch{return false}
 if(url.protocol!=='obsidian:'||url.host!=='open'||url.pathname||url.hash||url.username||url.password)return false;
 const params=[...url.searchParams];
 if(params.length!==1||params[0][0]!=='path')return false;
 const target=params[0][1];
 if(!target||!path.isAbsolute(target))return false;
 const base=path.resolve(root),real=path.resolve(target);
 const rel=path.relative(base,real);
 if(rel==='')return true;                                  // 库根本身
 if(path.isAbsolute(rel)||rel==='..'||rel.startsWith(`..${path.sep}`))return false;
 return /\.md$/i.test(rel);                                // 库内笔记
}
// launchObsidian 是「让 Obsidian 窗口真的出现在用户眼前」的那个动作。
// GUI 程序不能用 windowsHide:true：SW_HIDE 会把它的仓库窗口一起藏起来，
// 只剩一个看不见的 Electron 进程（2.3.8 已因此翻过一次车）。
export function launchObsidian(executable,args,{spawnProcess=spawn}={}){
 return new Promise((resolve,reject)=>{
  const child=spawnProcess(executable,args,{detached:true,stdio:'ignore',windowsHide:false});
  child.once('error',reject);
  child.once('spawn',()=>{child.unref();resolve()});
 });
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
 else await launchObsidian(result.executable,[uri],{spawnProcess});
 return {...result,opened:true};
}
// openObsidianUri 打开一条**已经校验过**的本库链接（来自 isOwnVaultOpenURL）。
// 它不重新登记库，只负责把窗口拉出来；未安装 Obsidian 时明确报错，不静默失败。
export async function openObsidianUri(uri,{detected,launch,spawnProcess=spawn}={}){
 const state=detected||await detectObsidian();
 if(!state.installed)throw Error('未检测到 Obsidian');
 if(launch)await launch(state.executable,[uri]);
 else await launchObsidian(state.executable,[uri],{spawnProcess});
 return {...state,opened:true,uri};
}
