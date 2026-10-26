import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

async function exists(file){try{await fs.stat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}

// 上游 appdir.Config 的便携模式只重定位 Magpie 自己的资料，保留真实的 Agent home/XDG。
export async function preparePortableRuntime(source,credentials) {
 const directory=path.join(credentials,'magpie-runtime'),data=path.join(directory,'data');
 const executable=path.join(directory,path.basename(source)),identity=path.join(directory,'source.sha256');
 await fs.mkdir(directory,{recursive:true});
 const sourceHash=await digest(source);
 let previous;try{previous=await fs.readFile(identity,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
 if(previous!==sourceHash||!await exists(executable)){
  const temporary=path.join(directory,`.binary-${randomUUID()}`);
  await fs.copyFile(source,temporary);
  if(await digest(temporary)!==sourceHash)throw Error('服务副本校验失败');
  await fs.rename(temporary,executable);
  await fs.writeFile(identity,sourceHash);
 }
 if(!await exists(data)){
  const staging=path.join(directory,`.data-${randomUUID()}`),legacy=path.join(credentials,'magpie');
  if(await exists(legacy))await fs.cp(legacy,staging,{recursive:true,errorOnExist:true,force:false});
  else await fs.mkdir(staging);
  // 完整复制后再启用；旧资料原样留在原目录，不覆盖已运行过的新资料。
  await fs.rename(staging,data);
 }
 await fs.writeFile(path.join(directory,'.portable'),'');
 return {executable,data};
}
