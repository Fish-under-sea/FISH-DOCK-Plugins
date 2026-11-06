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
 // 这里原先按「从某条注释切到下一个 const open = el("button", "text", t("Open"))」删块，
 // 但在上游 0.1.3140 上那个终点挪到了两百多行之后：一刀切掉的是「命令行 / 网关地址 /
 // 日志 / 配置目录」这些与更新无关的设置行，管理页于是只剩个空壳（用户看到的
 // 「界面全错、body 空」）。改成**只删与 What's new 有关的那三行**，再补一句把入口
 // 变成空操作；一行都没命中就什么都不切，绝不抛错——抛错在代理那边是 502，等于把
 // 整页打死。
 const dropRows=[
  /^[ \t]*const notes = el\("button", "text", t\("Open"\)\);\r?\n/m,
  /^[ \t]*notes\.onclick = \(\) => openWhatsNew\(notes\);\r?\n/m,
  /^[ \t]*row\(t\("What's new"\)[^\n]*\r?\n/m,
 ];
 for(const pattern of dropRows)source=source.replace(pattern,'');
 // 兜底：即使上游把这段搬了家，那个入口也点不出东西（函数声明可以重新赋值）。
 source+=`\n;(function(){try{openWhatsNew=function(){};}catch(e){}})();\n`;
 return source;
}
