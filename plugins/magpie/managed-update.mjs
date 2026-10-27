import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {serviceError} from '../../shared/errors.mjs';

export const managedUpdates={noAutoUpdate:true,noAutoDownload:true,noUpdatePill:true,autoRestart:false};

// 在启动原生服务前固定更新归属；其他业务设置保持原值。
export async function prepareManagedUpdates(data){
 const file=path.join(data,'settings.json');let raw;
 try{raw=await fs.readFile(file,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
 let settings;
 try{settings=raw===undefined?{}:JSON.parse(raw.replace(/^\uFEFF/,''))}catch{throw serviceError('SETTINGS_INVALID')}
 if(!settings||typeof settings!=='object'||Array.isArray(settings))throw serviceError('SETTINGS_INVALID');
 if(Object.entries(managedUpdates).every(([k,v])=>settings[k]===v))return;
 if(raw!==undefined){
  try{await fs.writeFile(path.join(data,'settings.before-dock-update.json'),raw,{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST')throw error}
 }
 const temporary=path.join(data,`.settings-${randomUUID()}.tmp`);
 const handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile((raw?.startsWith('\uFEFF')?'\uFEFF':'')+JSON.stringify({...settings,...managedUpdates},null,2)+'\n');await handle.sync()}finally{await handle.close()}
 await fs.rename(temporary,file);
}

// 精确适配固定版本的管理脚本，保留原生协议、鉴权与内部插件更新。
export function managedUpdateScript(source){
 const anchors=['async function renderUpdate(r, u) {','function renderUpdateBadge('];
 if(!anchors.every(a=>source.includes(a)))throw Error('Magpie 管理页更新入口已变更，请更新 Dock 适配层');
 source=source.replace('async function renderUpdate(r, u) {',`async function renderUpdate(r, u) {
 r.querySelector('.val')?.querySelectorAll('button').forEach(b=>b.remove());
 const managedWho=r.querySelector('.who');
 const managedNote=managedWho?.querySelector('.sub')||managedWho?.appendChild(el('div','sub'));
 if(managedNote)managedNote.textContent='版本由 FISH Dock 插件管理，请在 Dock 插件页更新';
 return;
`);
 source=source.replace(/(function renderUpdateBadge\([^)]*\)\s*\{)/,`$1\n document.querySelector('#update')?.setAttribute('hidden',''); document.querySelector('.update-wrap')?.setAttribute('hidden',''); return;\n`);
 const start=source.indexOf('  // what changed in this version, and in one waiting;'),end=source.indexOf('  const open = el("button", "text", t("Open"));',start);
 if(start<0||end<start)throw Error('Magpie 管理页更新设置已变更，请更新 Dock 适配层');
 return source.slice(0,start)+source.slice(end);
}
