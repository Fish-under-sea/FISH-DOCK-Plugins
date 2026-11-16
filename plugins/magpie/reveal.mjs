// Native folder handoff only accepts targets returned by validated Magpie routes.
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';

export const REVEAL_REFUSED = "in the browser magpie can't open folders: it is ";
export const REVEAL_ROUTES = new Set([
 '/api/library/reveal','/api/settings/reveal','/api/settings/log/reveal',
 '/api/davsync/reveal','/api/autobackup/reveal','/api/datafolder/reveal','/api/gateway/held/reveal',
]);
export function localTarget(value,home){
 if(typeof value!=='string'||!value||/[\x00-\x1f\x7f]/.test(value))return null;
 let target=value;
 if(target==='~')target=home;
 else if(/^~[\\/]/.test(target))target=path.join(home,target.slice(2));
 if(typeof target!=='string'||!path.isAbsolute(target))return null;
 target=path.normalize(target);
 if(process.platform==='win32'&&!/^(?:[a-z]:[\\/]|[\\/]{2})/i.test(target))return null;
 // Normalize slash variants before rejecting device and remote UNC paths.
 const windows=target.replaceAll('/','\\');
 if(/^\\\\[.?]\\/.test(windows))return null;
 const unc=/^\\\\([^\\]+)/.exec(windows);
 if(unc&&!['wsl$','wsl.localhost'].includes(unc[1].toLowerCase()))return null;
 return path.normalize(target);
}
export function targetOf(message,home){
 return typeof message==='string'&&message.startsWith(REVEAL_REFUSED)?localTarget(message.slice(REVEAL_REFUSED.length),home):null;
}
export function sameOrigin(req,port){
 const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
 if(site&&site!=='same-origin'&&site!=='none')return false;
 const remote=req.socket?.remoteAddress;
 if(remote&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return false;
 const host=req.headers?.host;
 if(typeof host!=='string')return false;
 let local;
 try{local=new URL(`http://${host}`)}catch{return false}
 if(!['127.0.0.1','localhost','[::1]'].includes(local.hostname)||local.host!==host||local.port!==String(port))return false;
 const origin=req.headers?.origin;
 // Headerless local clients are allowed; opaque sandbox origins never are.
 if(origin===undefined)return !site||site==='none';
 if(typeof origin!=='string')return false;
 return origin===local.origin;
}
export async function openInExplorer(target,run=spawn,platform=process.platform,{signal}={}){
 signal?.throwIfAborted();
 const stat=await fs.stat(target);
 signal?.throwIfAborted();
 if(!stat.isDirectory()&&!stat.isFile())throw Error('Not a regular file or directory');
 const select=!stat.isDirectory();
 const command=platform==='win32'?'explorer.exe':platform==='darwin'?'open':'xdg-open';
 const args=platform==='win32'?(select?[`/select,${target}`]:[target]):platform==='darwin'?(select?['-R',target]:[target]):[select?path.dirname(target):target];
 const child=run(command,args,{detached:true,stdio:'ignore'});
 // spawn failures are asynchronous. Do not claim success before the spawn event.
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve)});
 child.unref?.();
}
export function pickedDir(result){
 if(!result||typeof result!=='object'||Array.isArray(result)||!(result.dir===null||typeof result.dir==='string'&&result.dir))throw Error('Invalid folder picker result');
 return result.dir;
}
