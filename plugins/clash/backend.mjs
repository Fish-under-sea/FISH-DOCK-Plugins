import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPlugin} from './sdk.mjs';
import {createClash} from './service.mjs';
import {createRuntime} from './runtime.mjs';
let service;
createPlugin({id:'fish.clash',activate:async context=>{const runtime=createRuntime(context);await runtime.proxy.restore();const kernel=fileURLToPath(new URL('../../service/mihomo.exe',import.meta.url));service=createClash({context,runtime,defaultKernel:(await stat(kernel).catch(()=>null))?.isFile()?kernel:''});await service.view()},deactivate:async()=>{if(service)await service.shutdown();service=null},commands:{
 ...Object.fromEntries(['view','save','subscriptionSave','subscriptionToggle','subscriptionRemove','layout','select','mode','reload','proxy','details'].map(name=>[`clash.${name}`,params=>service[name](params)])),
 'clash.start':()=>{void service.start().catch(()=>{});return service.view({controller:false})},
 'clash.stop':()=>{void service.stop().catch(()=>{});return service.view({controller:false})}
},onError:()=>{void service?.shutdown().catch(()=>{})}});
process.stdin.once('end',()=>{void service?.shutdown().catch(()=>{})});
