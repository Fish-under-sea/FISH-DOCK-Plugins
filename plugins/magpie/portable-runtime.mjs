import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {prepareManagedUpdates} from './managed-update.mjs';
import {serviceError} from '../../shared/errors.mjs';

async function exists(file){try{await fs.stat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}

// 回选缓存只留一份：上一版留给「换回旧原生版本」（upgrade.test.mjs 的契约），
// 再往前的历史副本一律算堆积。复制临时名（.binary-* / .data-*）比宽限期新的
// 可能是另一个准备者正在写，不碰。
const KEEP_PREVIOUS=1,STAGING_GRACE=10*60*1000;
async function aged(entry,grace=0){
 try{const stat=await fs.stat(entry);return Date.now()-stat.mtimeMs>grace}catch{return false}
}
// 历史副本每次更新都多一个 70MB，复制临时名随强杀堆积。发布并校验当前副本成功
// 后清掉它们；正在被占用的旧副本本就删不掉（EBUSY/EPERM），尽力而为，绝不因
// 清理失败拦下启动，也不碰 data 与 marker。
async function pruneRuntime(directory,current){
 let names;try{names=await fs.readdir(directory)}catch{return}
 const previous=[];
 for(const name of names){
  if(name===current||name==='data'||name==='.portable')continue;
  const entry=path.join(directory,name);
  if(/^magpie-[0-9a-f]{64}\.exe$/.test(name)){
   try{previous.push({entry,time:(await fs.stat(entry)).mtimeMs})}catch{}
   continue;
  }
  if(!/^\.(?:binary|data)-/.test(name))continue;
  if(await aged(entry,STAGING_GRACE))await fs.rm(entry,{recursive:true,force:true}).catch(()=>{});
 }
 // 最新的那一个留在回选缓存里，其余历史副本立即清理。
 previous.sort((left,right)=>right.time-left.time);
 for(const {entry} of previous.slice(KEEP_PREVIOUS))
  await fs.rm(entry,{recursive:true,force:true}).catch(()=>{});
}

// 新旧程序并存，原便携 data 位置固定，旧客户端的程序路径始终保留。
export async function preparePortableRuntime(source,credentials,{signal,onPhase=()=>{}}={}) {
 const directory=path.join(credentials,'magpie-runtime'),data=path.join(directory,'data');
 signal?.throwIfAborted();onPhase('prepare-data');
 try{
  await fs.mkdir(directory,{recursive:true});
  if(!await exists(data)){
   const staging=path.join(directory,`.data-${randomUUID()}`),legacy=path.join(credentials,'magpie');
   try{
    if(await exists(legacy))await fs.cp(legacy,staging,{recursive:true,errorOnExist:true,force:false});
    else await fs.mkdir(staging);
    signal?.throwIfAborted();
    try{await fs.rename(staging,data)}catch(error){
     // 另一个准备者已经完整发布资料时，采用该资料，不覆盖。
     if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code)||!await exists(data))throw error;
    }
   }finally{
    // staging 是本次创建、父目录已确定的唯一临时路径，不清理用户旧资料。
    await fs.rm(staging,{recursive:true,force:true});
   }
  }
 }catch(error){if(error.name==='AbortError')throw error;throw serviceError('DATA_MIGRATION_FAILED')}
 signal?.throwIfAborted();onPhase('prepare-settings');
 try{
  await prepareManagedUpdates(data);
  const marker=await fs.open(path.join(directory,'.portable'),'a');await marker.close();
 }catch(error){if(error.code==='SETTINGS_INVALID')throw error;throw serviceError('DATA_UNWRITABLE')}
 signal?.throwIfAborted();onPhase('verify-binary');
 let sourceHash;
 try{sourceHash=await digest(source)}catch{throw serviceError('EXECUTABLE_INVALID')}
 const executable=path.join(directory,`magpie-${sourceHash}.exe`);
 async function verify(){
  if(!await exists(executable))return false;
  if(await digest(executable)!==sourceHash)throw serviceError('RUNTIME_INTEGRITY');
  return true;
 }
 try{
  if(!await verify()){
   const temporary=path.join(directory,`.binary-${randomUUID()}`);
   try{
    await fs.copyFile(source,temporary);
    if(await digest(temporary)!==sourceHash)throw serviceError('RUNTIME_INTEGRITY');
    const handle=await fs.open(temporary,'r+');try{await handle.sync()}finally{await handle.close()}
    signal?.throwIfAborted();
    // NTFS 同目录硬链接原子发布完整文件，EEXIST 时校验胜出的副本，绝不覆盖。
    try{await fs.link(temporary,executable)}catch(error){if(error.code!=='EEXIST')throw error}
    if(!await verify())throw serviceError('RUNTIME_INTEGRITY');
   }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
  }
 }catch(error){
  if(error.name==='AbortError'||error.code==='RUNTIME_INTEGRITY')throw error;
  throw serviceError('RUNTIME_PREPARE_FAILED');
 }
 signal?.throwIfAborted();
 await pruneRuntime(directory,path.basename(executable));
 return {executable,data,sha256:sourceHash};
}
