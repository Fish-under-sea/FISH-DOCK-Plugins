import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {embedProxy,freePort} from './embed-proxy.mjs';
import {available,startChild} from '../../shared/child.mjs';
import {magpieEnvironment} from './environment.mjs';
import {preparePortableRuntime} from './portable-runtime.mjs';
import {gatewayAddr,gatewayHost,gatewayPortCandidates,readMagpiePrefs} from './network.mjs';
import {registerSeedPage,syncPageDirectory} from './page-seed.mjs';
import {serviceError} from '../../shared/errors.mjs';

// lanGatewayPort 挑一个共享时能长期不变的端口：按保存端口、Magpie 端口、默认
// 端口依次试，每个再试紧跟的两个；设过的那一个被占也不至于整台机器没法共享。
// 挑不到就是端口冲突，交给上层提示。
async function lanGatewayPort({configured,prefs,port,upstreamPort}){
 const taken=[port,upstreamPort];
 for(const base of gatewayPortCandidates({configured,prefs,taken})){
  for(let candidate=base;candidate<=Math.min(base+2,65535);candidate++){
   if(taken.includes(candidate))continue;
   try{await available(candidate);return candidate}catch{}
  }
 }
 return 0;
}
export function createRuntime(context){
 return {async start({executable,port,gatewayPort,signal,onPhase=()=>{}}){
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
  // web --addr 仅设置管理页；模型网关需独立地址。
  const portable=await preparePortableRuntime(executable,credentials,{signal,onPhase});
  // 共享时绑全网卡：MAGPIE_ADDR 一旦钉住回环，Magpie 自己不会放开绑定，局域网
  // 共享开关就不生效（internal/gateway/lan.go 的 pinnedHost / LANURLs）。
  const prefs=await readMagpiePrefs(portable.data);
  let listeningPort;
  if(prefs.lan)listeningPort=await lanGatewayPort({configured:gatewayPort,prefs,port,upstreamPort});
  else do{listeningPort=await freePort()}while(listeningPort===port||listeningPort===upstreamPort);
  if(!listeningPort)throw serviceError('PORT_IN_USE');
  const gateway=gatewayAddr(gatewayHost(prefs.lan),listeningPort);
  // 出厂预置的页面插件（page-checkin）随 Dock 内置在 page-plugins/ 下。启动前把它
  // 同步到 <data>/plugins/page-checkin，并让 plugins.json 只用这个稳定路径引用：升级
  // 之后路径不变，页面才跟着换版本；旧包目录被清理也不会 404。
  // 没有内置目录（普通 magpie）时不碰清单，仍由原生按包名装 npm 上的同名包。
  try{
   const bundled=path.join(path.dirname(fileURLToPath(import.meta.url)),'page-plugins','page-checkin');
   const seeded=await syncPageDirectory({source:bundled,data:portable.data,onPhase,signal});
   if(seeded)await registerSeedPage({data:portable.data,directory:seeded.directory,onPhase,signal});
  }catch(error){if(error.name==='AbortError')throw error;throw serviceError('DATA_MIGRATION_FAILED')}
  onPhase('start-process');
  const child=await startChild({executable:portable.executable,args:['web','--addr',`127.0.0.1:${upstreamPort}`,'--no-open'],cwd:root,signal,
   env:{...magpieEnvironment({cache,key}),MAGPIE_ADDR:gateway},
   ready:output=>output.includes(`magpie web on http://127.0.0.1:${upstreamPort}/`),
   probe:async()=>{try{const response=await fetch(upstreamUrl,{redirect:'manual',signal:AbortSignal.timeout(1500)});return response.status===303&&response.headers.get('location')==='/'&&response.headers.has('set-cookie')}catch{return false}}
  });
  let proxy;
  try{signal?.throwIfAborted();proxy=await embedProxy({port,upstreamPort});signal?.throwIfAborted()}catch(error){try{await proxy?.stop()}finally{await child.stop()}throw error}
  return {alive:child.alive,url,runtime:{executable:portable.executable,sha256:portable.sha256},async stop(){try{await proxy.stop()}finally{await child.stop()}}};
 }};
}
