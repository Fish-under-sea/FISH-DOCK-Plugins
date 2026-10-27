import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {embedProxy,freePort} from './embed-proxy.mjs';
import {available,startChild} from '../../shared/child.mjs';
import {magpieEnvironment} from './environment.mjs';
import {preparePortableRuntime} from './portable-runtime.mjs';
import {serviceError} from '../../shared/errors.mjs';
export function createRuntime(context){
 return {async start({executable,port,signal}){
  signal?.throwIfAborted();
  if(!path.isAbsolute(context.dataDirectory))throw Error('缺少插件数据目录');
  const root=context.dataDirectory,credentials=path.join(root,'credentials'),cache=path.join(root,'tmp');
  try{await fs.mkdir(credentials,{recursive:true});await fs.mkdir(cache,{recursive:true})}catch{throw serviceError('DATA_UNWRITABLE')}
  // 上游便携模式优先于 XDG。插件只运行不附带便携目录的已验证副本。
  for(const name of ['data','.portable']){try{await fs.stat(path.join(path.dirname(executable),name));throw Error('服务旁存在便携数据，请使用独立服务副本')}catch(error){if(error.code!=='ENOENT')throw error}}
  let stat;try{stat=await fs.stat(executable)}catch(error){if(error.code==='ENOENT')throw serviceError('EXECUTABLE_MISSING');throw error}
  if(!stat.isFile())throw serviceError('EXECUTABLE_INVALID');
  let key=await context.secrets.read('keys','web-key');
  if(!key){key=randomBytes(32).toString('hex');await context.secrets.write('keys','web-key',key)}
  await available(port);
  const url=`http://127.0.0.1:${port}/?k=${encodeURIComponent(key)}`;
  let upstreamPort;do{upstreamPort=await freePort()}while(upstreamPort===port);
  const upstreamUrl=`http://127.0.0.1:${upstreamPort}/?k=${encodeURIComponent(key)}`;
  let gatewayPort;do{gatewayPort=await freePort()}while(gatewayPort===port||gatewayPort===upstreamPort);
  // web --addr 仅设置管理页；模型网关需独立地址。
  const portable=await preparePortableRuntime(executable,credentials);
  const child=await startChild({executable:portable.executable,args:['web','--addr',`127.0.0.1:${upstreamPort}`,'--no-open'],cwd:root,signal,
   env:{...magpieEnvironment({cache,key}),MAGPIE_ADDR:`127.0.0.1:${gatewayPort}`},
   ready:output=>output.includes(`magpie web on http://127.0.0.1:${upstreamPort}/`),
   probe:async()=>{try{const response=await fetch(upstreamUrl,{redirect:'manual',signal:AbortSignal.timeout(1500)});return response.status===303&&response.headers.get('location')==='/'&&response.headers.has('set-cookie')}catch{return false}}
  });
  let proxy;
  try{signal?.throwIfAborted();proxy=await embedProxy({port,upstreamPort});signal?.throwIfAborted()}catch(error){try{await proxy?.stop()}finally{await child.stop()}throw error}
  return {alive:child.alive,url,async stop(){try{await proxy.stop()}finally{await child.stop()}}};
 }};
}
