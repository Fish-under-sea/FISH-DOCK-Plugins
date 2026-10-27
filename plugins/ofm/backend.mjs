import {fileURLToPath} from 'node:url';
import {createPlugin} from './sdk.mjs';import {createGateway} from '../../shared/gateway.mjs';import {createRuntime} from './runtime.mjs';
let service;
createPlugin({id:'fish.ofm',activate:async context=>{service=createGateway({context,runtime:createRuntime(context),kind:'ofm',defaultExecutable:fileURLToPath(new URL('../../service/packages/desktop/service-host.mjs',import.meta.url))});await service.load()},deactivate:async()=>{await service?.stop()},commands:{'gateway.view':()=>service.view(),'gateway.save':p=>service.save(p),'gateway.start':()=>{void service.start();return service.view()},'gateway.stop':()=>{void service.stop();return service.view()}},onError:()=>{void service?.stop()}});
process.stdin.once('end',()=>{void service?.stop()});
