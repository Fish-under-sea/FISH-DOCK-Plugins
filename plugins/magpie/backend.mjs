import {fileURLToPath} from 'node:url';
import {createPlugin} from './sdk.mjs';
import {createGateway} from '../../shared/gateway.mjs';
import {createRuntime} from './runtime.mjs';
let service;
const plugin=createPlugin({id:'fish.magpie',activate:async context=>{
 service=createGateway({context,runtime:createRuntime(context),kind:'magpie',defaultExecutable:fileURLToPath(new URL('../../service/magpie.exe',import.meta.url))});await service.load();
},deactivate:async()=>{await service?.stop()},commands:{
 'gateway.view':()=>service.view(),'gateway.save':params=>service.save(params),
 'gateway.start':()=>{void service.start();return service.view()},'gateway.stop':()=>{void service.stop();return service.view()}
},onError:()=>{void service?.stop().finally(()=>{process.exitCode=1})}});
process.stdin.once('end',()=>{void service?.stop()});
