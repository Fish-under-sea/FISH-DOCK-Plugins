import path from 'node:path';
import {publicServiceError, serviceError} from './errors.mjs';

export function createGateway({context,runtime,kind,defaultExecutable=''}) {
 let config={executable:defaultExecutable,port:kind==='magpie'?3425:38080,gatewayPort:kind==='magpie'?3426:undefined};
 let state='unconfigured',phase=null,error=null,instance=null,starting=null,stopping=null,stopRequested=false,controller;
 function validate(value) {
  if(!value||typeof value.executable!=='string'||(value.executable&&!path.isAbsolute(value.executable)&&!path.win32.isAbsolute(value.executable)))throw Error('服务路径必须为绝对路径');
  if(!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw Error('端口须为 1024–65535 的整数');
  // 网关端口（Magpie 的模型网关）与网页服务端口分开保存：共享时它必须固定，
  // 否则外部 Agent 的地址每次启动都会变。
  const gatewayPort=value.gatewayPort==null?undefined:value.gatewayPort;
  if(gatewayPort!==undefined&&(!Number.isInteger(gatewayPort)||gatewayPort<1024||gatewayPort>65535))throw Error('网关端口须为 1024–65535 的整数');
  if(gatewayPort!==undefined&&gatewayPort===value.port)throw Error('网关端口不能与服务端口相同');
  return {executable:value.executable,port:value.port,...(gatewayPort===undefined?{}:{gatewayPort})};
 }
 function view() {
  if(state==='running'&&instance?.alive&&!instance.alive()){state='error';error='服务进程已退出，请检查服务配置后重新启动';}
  return {...config,state,phase:state==='starting'?phase:null,error,url:state==='running'?instance.url:null,runtime:state==='running'?(instance.runtime??null):null};
 }
 async function load() {
  const bytes=await context.storage.read('config','gateway.json');
  if(bytes!=null) {
   try {
    const saved=JSON.parse(bytes);
    // Older adapters persisted the installed package's absolute path. Only
    // recognize the host's exact package layout; retain arbitrary user paths.
    const suffix=kind==='magpie'?'magpie.exe':'packages/desktop/service-host.mjs';
    const legacy=new RegExp(`/packages/fish\\.${kind}/\\d+\\.\\d+\\.\\d+/[a-f0-9]{64}/service/${suffix.replaceAll('.','\\.')}$`,'i');
    const bundled=saved.bundled||legacy.test(String(saved.executable).replaceAll('\\','/'));
    // 未保存过网关端口的老配置沿用默认值，不因缺字段退回随机端口。
    config=validate({...config,...saved,executable:bundled&&defaultExecutable?defaultExecutable:saved.executable});
   } catch {
    state='error';error='服务配置损坏，原文件已保留；请在服务设置中重新保存配置';
    return view();
   }
  }
  state=config.executable?'stopped':'unconfigured';error=null;return view();
 }
 async function save(patch) {
  if(starting||stopping||view().state==='running')throw Error('请先停止服务再修改启动参数');
  const next=validate({...config,...patch});
  await context.storage.write('config','gateway.json',JSON.stringify({...next,bundled:!!defaultExecutable&&next.executable===defaultExecutable}));
  config=next;state=config.executable?'stopped':'unconfigured';error=null;return view();
 }
 // #30：启动成功后把运行时**实际监听**的网关端口写回配置，下次启动直接复用它；
 // 首选端口被别的程序占住而回退时也记下回退值，否则每次启动都会重新从首选试起、
 // 端口又变一次。这里刻意不走 save()：save() 在 running 时按设计拒绝修改（用户要
 // 改启动参数仍须先停止服务），而这一条只是把运行时挑到的值落盘。
 async function persistGatewayPort(port) {
  if(!Number.isInteger(port)||port<1024||port>65535)return null;
  if(config.gatewayPort===port)return null;
  const next=validate({...config,gatewayPort:port});
  await context.storage.write('config','gateway.json',JSON.stringify({...next,bundled:!!defaultExecutable&&next.executable===defaultExecutable}));
  config=next;return port;
 }
 // 服务端口（网页/管理页那个）被别的程序占住时，按 +0/+1/+2 试：一个跑着老 magpie
 // 的残留进程就能让整个插件报「端口已被占用」，用户却不知道是谁占的。回退值与
 // 网关端口一样写回配置，下次直接复用，不会每次启动又跳回首选。
 function persistServicePort(port) {
  if(!Number.isInteger(port)||port<1024||port>65535)return null;
  if(config.port===port)return null;
  const next=validate({...config,port});
  return context.storage.write('config','gateway.json',JSON.stringify({...next,bundled:!!defaultExecutable&&next.executable===defaultExecutable})).then(()=>{config=next;return port});
 }
 function servicePortCandidates(base) {
  const out=[];
  for(const candidate of [base,base+1,base+2]){
   if(Number.isInteger(candidate)&&candidate>=1024&&candidate<=65535&&!out.includes(candidate))out.push(candidate);
  }
  return out;
 }
 function start() {
  if(starting)return starting;
  if(stopping||view().state==='running')return Promise.resolve(view());
  if(!config.executable){state='error';error='请先配置服务路径';return Promise.resolve(view());}
  stopRequested=false;state='starting';phase=null;error=null;
  controller=new AbortController();
  const currentController=controller;
  starting=(async()=>{
   try {
    if(instance){await instance.stop();instance=null;}
    // 服务端口冲突不再直接判死：换下一个候选再试，试完还不行才报 PORT_IN_USE。
    let usedPort=config.port,lastFailure=null;
    for(const candidate of servicePortCandidates(config.port)){
     try{
      instance=await runtime.start({...config,port:candidate,signal:currentController.signal,onPhase:value=>{
       if(controller===currentController&&state==='starting'&&!stopRequested&&['prepare-data','prepare-settings','verify-binary','start-process'].includes(value))phase=value;
      }});
      usedPort=candidate;lastFailure=null;break;
     }catch(cause){
      lastFailure=cause;
      if(cause?.code!=='PORT_IN_USE')throw cause;
     }
    }
    if(lastFailure)throw lastFailure;
    const url=new URL(instance.url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||Number(url.port)!==usedPort)throw serviceError('INVALID_READY_URL');
    // #30：记下运行时挑到的网关端口（含回退值）。写不进去只影响下次是否复用，
    // 不拦启动——本次服务已经起来了。
    try{await persistGatewayPort(instance.gatewayPort)}catch{}
    if(usedPort!==config.port)try{await persistServicePort(usedPort)}catch{}
    if(!stopRequested)state='running';
   } catch(cause) {
    error=publicServiceError(cause);state='error';
    if(instance)try{await instance.stop();instance=null;}catch{error=publicServiceError(serviceError('STOP_FAILED'));}
   }
   return view();
  })().finally(()=>{starting=null;});
  return starting;
 }
 function stop() {
  if(stopping)return stopping;
  stopRequested=true;state='stopping';
  controller?.abort();
  stopping=(async()=>{
   try {
    // Deactivation/EOF must dispose the instance even when startup is pending.
    if(starting)await starting;
    if(instance){await instance.stop();instance=null;}
    state=config.executable?'stopped':'unconfigured';error=null;
   } catch {
    state='error';error=publicServiceError(serviceError('STOP_FAILED'));
   }
   return view();
  })().finally(()=>{stopping=null;});
  return stopping;
 }
 return {load,view,save,start,stop};
}
