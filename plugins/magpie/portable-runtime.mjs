import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {prepareManagedUpdates} from './managed-update.mjs';
import {serviceError} from '../../shared/errors.mjs';

async function exists(file){try{await fs.stat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}

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
 return {executable,data,sha256:sourceHash};
}
