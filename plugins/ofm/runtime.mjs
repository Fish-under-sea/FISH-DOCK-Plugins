import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {available,startChild,isolatedEnvironment} from '../../shared/child.mjs';
import {serviceError} from '../../shared/errors.mjs';
export function createRuntime(context){return {async start({executable,port,signal}){
 const root=context.dataDirectory;if(!path.isAbsolute(root))throw Error('缺少数据目录');
 try{if(!(await fs.stat(executable)).isFile())throw serviceError('EXECUTABLE_INVALID')}catch(error){if(error.code==='ENOENT')throw serviceError('EXECUTABLE_MISSING');throw error}await available(port);
 const home=path.join(root,'tmp/profile'),cache=path.join(root,'tmp'),config=path.join(root,'config');
 try{await Promise.all([home,cache,config,path.join(root,'credentials')].map(directory=>fs.mkdir(directory,{recursive:true})))}catch{throw serviceError('DATA_UNWRITABLE')}
 let managementUrl;
 const instance=await startChild({signal,executable:process.execPath,args:[executable,'--data-dir',root,'--port',String(port),'--no-refresh'],cwd:root,
 env:{...isolatedEnvironment({home,credentials:path.join(root,'credentials'),config,cache,key:''}),OFM_EMBED_ANCESTORS:'http://tauri.localhost'},shutdown:'shutdown\n',
 ready:output=>{for(const line of output.split('\n')){try{const row=JSON.parse(line);if(row.protocol==='ofm-desktop-ready/v1'&&row.port===port){const url=new URL(row.managementUrl);if(url.protocol==='http:'&&!url.username&&!url.password&&url.hostname==='127.0.0.1'&&url.port===String(port))managementUrl=url.href}}catch{}}return !!managementUrl},
 probe:async()=>{try{return !!managementUrl&&(await fetch(managementUrl,{signal:AbortSignal.timeout(2000)})).ok}catch{return false}}
 });return {...instance,url:managementUrl};
}}}
