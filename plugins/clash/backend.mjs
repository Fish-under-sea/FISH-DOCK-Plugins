import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPlugin} from './sdk.mjs';
import {createClash} from './service.mjs';
import {createRuntime} from './runtime.mjs';
let service;
createPlugin({id:'fish.clash',activate:async context=>{const runtime=createRuntime(context);await runtime.proxy.restore();service=createClash({context,runtime});const state=await service.view();const kernel=fileURLToPath(new URL('../../service/mihomo.exe',import.meta.url));if(!state.kernel&&(await stat(kernel).catch(()=>null))?.isFile())await service.save({kernel})},deactivate:async()=>{if(service)await service.stop();service=null},commands:Object.fromEntries(['view','save','layout','start','stop','select','mode','reload','proxy','details'].map(name=>[`clash.${name}`,params=>service[name](params)]))});
