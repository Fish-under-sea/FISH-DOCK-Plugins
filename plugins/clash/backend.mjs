import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPlugin} from './sdk.mjs';
import {createClash} from './service.mjs';
import {createRuntime} from './runtime.mjs';
import {createTun} from './tun.mjs';
let service;
createPlugin({id:'fish.clash',activate:async context=>{
 // TUN 服务目录固定在 ProgramData，跨插件升级不随目录移动。
 const programData=process.env.ProgramData||'C:/ProgramData';
 const runtime=createRuntime({...context,tun:createTun({context,programData})});
 await runtime.proxy.restore();
 const kernel=fileURLToPath(new URL('../../service/mihomo.exe',import.meta.url));
 service=createClash({context,runtime,defaultKernel:(await stat(kernel).catch(()=>null))?.isFile()?kernel:''});
 await service.view()},deactivate:async()=>{if(service)await service.shutdown();service=null},commands:{
 ...Object.fromEntries(['view','save','subscriptionSave','subscriptionToggle','subscriptionRemove','layout','select','mode','reload','proxy','details',
  'tunService','installTunService','uninstallTunService'].map(name=>[`clash.${name}`,params=>service[name](params)])),
 'clash.start':()=>{void service.start().catch(()=>{});return service.view({controller:false})},
 'clash.stop':()=>{void service.stop().catch(()=>{});return service.view({controller:false})}
},onError:()=>{void service?.shutdown().catch(()=>{})}});
process.stdin.once('end',()=>{void service?.shutdown().catch(()=>{})});
