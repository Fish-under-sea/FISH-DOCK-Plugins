import fs from 'node:fs/promises';
import path from 'node:path';
import {defaultSourceVault,vaultPaths,importRecord} from './knowledge-vault.mjs';
import {readKnowledgeHint,dismissKnowledgeHint} from './knowledge-hint.mjs';
import {detectObsidian,openObsidianVault,registerObsidianVault} from './obsidian.mjs';
import {fileURLToPath} from 'node:url';
import {createPlugin} from './sdk.mjs';
import {createGateway} from '../../shared/gateway.mjs';
import {createRuntime,isRetryableFailure,packagedExecutablePath,recordGatewayError,startWithBackoff} from './runtime.mjs';
let service,pluginContext,launching,lastFailure,magpieGlassOn=false;
const dockThemeListeners=new Set();
let currentDockTheme=null;
const dockThemeBridge={
 get:()=>currentDockTheme,
 set:value=>{
  currentDockTheme=value&&typeof value==='object'?value:null;
  for(const fn of [...dockThemeListeners])try{fn(currentDockTheme)}catch{}
 },
 subscribe:fn=>{dockThemeListeners.add(fn);return ()=>dockThemeListeners.delete(fn);}
};
// 默认服务路径每次从 import.meta.url 解析，不持久化包内绝对路径。
const defaultExecutable=fileURLToPath(new URL('../../service/magpie.exe',import.meta.url));
async function exists(file){try{await fs.stat(file);return true}catch{return false}}
// 插件包升级后旧版本目录消失，gateway.json 里的 executable 会指向不存在的包路径。
// 用 gateway 自己的 save() 改指当前包路径，端口等其余字段原样保留；用户自选路径不动。
async function repairPackagedExecutable(){
 const view=service.view();
 if(!view.executable||!packagedExecutablePath(view.executable)||await exists(view.executable))return;
 try{await service.save({executable:defaultExecutable})}catch{}
}
// 启动失败不再用 catch(()=>{}) 丢掉：原始 code 进了 gateway-error.log，error 状态按
// 递增间隔复起（3 次），用尽后定住并保留 gateway 记下的原因。用户停止不受影响。
function launchGateway(port){
 if(launching)return launching;
 lastFailure=null;
 launching=startWithBackoff(service,{attempts:3,delays:[600,1500],shouldRetry:()=>isRetryableFailure(lastFailure?.code)})
  .catch(error=>recordGatewayError(pluginContext?.dataDirectory,{error,phase:'start-process',port:port??service?.view().port}))
  .finally(()=>{launching=null;});
 return launching;
}
const plugin=createPlugin({id:'fish.magpie',activate:async context=>{
 pluginContext=context;
 const runtime=createRuntime(context,{sourceVault:defaultSourceVault(),connectObsidian:true,dockTheme:dockThemeBridge,onGlassState:on=>{magpieGlassOn=!!on}});
 // gateway 会把启动异常换成人话（原始 code 就丢了），这里留一份给失败日志和重试判定。
 const tracked={async start(options){try{return await runtime.start(options)}catch(error){lastFailure=error;throw error}}};
 service=createGateway({context,runtime:tracked,kind:'magpie',defaultExecutable:defaultExecutable});await service.load();
 await repairPackagedExecutable();
 // 宿主只在「随 Dock 启动」这一次传 FISH_PLUGIN_AUTOSTART=1（#22）。那一次把
 // 本机服务拉起来；安装、点启用、回滚都不传 1，服务等用户自己点。
 const autostartView=service.view();
 if(process.env.FISH_PLUGIN_AUTOSTART==='1'&&autostartView.state==='stopped')void launchGateway(autostartView.port);
},deactivate:async()=>{await service?.stop()},commands:{
 'knowledge.view':async()=>{
  const data=path.join(pluginContext.dataDirectory,'credentials','magpie-runtime','data'),{root}=vaultPaths(data);
  const initialized=await exists(path.join(root,importRecord));
  return {root,initialized,...await readKnowledgeHint(pluginContext.storage),obsidian:await detectObsidian(),...(initialized?{imported:JSON.parse(await fs.readFile(path.join(root,importRecord),'utf8')).imported}:{})};
 },
 'knowledge.dismiss':()=>dismissKnowledgeHint(pluginContext.storage),
 'knowledge.connect':async()=>{
  const {root}=vaultPaths(path.join(pluginContext.dataDirectory,'credentials','magpie-runtime','data'));
  if(!await exists(path.join(root,importRecord)))throw Error('请先启动 Magpie，完成知识库准备');
  return registerObsidianVault(root);
 },
 'knowledge.open':async()=>{
  const {root}=vaultPaths(path.join(pluginContext.dataDirectory,'credentials','magpie-runtime','data'));
  if(!await exists(path.join(root,importRecord)))throw Error('请先启动 Magpie，完成知识库准备');
  return openObsidianVault(root);
 },
 'gateway.view':()=>({...service.view(),magpieGlassOn}),'gateway.save':params=>service.save(params),
 'gateway.theme':params=>{dockThemeBridge.set(params);return {ok:true}},
 'gateway.start':()=>{void launchGateway();return {...service.view(),magpieGlassOn}},'gateway.stop':()=>{magpieGlassOn=false;void service.stop();return {...service.view(),magpieGlassOn}}
},onError:()=>{void service?.stop().finally(()=>{process.exitCode=1})}});
process.stdin.once('end',()=>{void service?.stop()});
