import path from 'node:path';
import {publicServiceError, serviceError} from './errors.mjs';

export function createGateway({context,runtime,kind,defaultExecutable=''}) {
 let config={executable:defaultExecutable,port:kind==='magpie'?3425:38080};
 let state='unconfigured',error=null,instance=null,starting=null,stopping=null,stopRequested=false,controller;
 function validate(value) {
  if(!value||typeof value.executable!=='string'||(value.executable&&!path.isAbsolute(value.executable)&&!path.win32.isAbsolute(value.executable)))throw Error('服务路径必须为绝对路径');
  if(!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw Error('端口须为 1024–65535 的整数');
  return {executable:value.executable,port:value.port};
 }
 function view() {
  if(state==='running'&&instance?.alive&&!instance.alive()){state='error';error='服务进程已退出，请检查服务配置后重新启动';}
  return {...config,state,error,url:state==='running'?instance.url:null};
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
    config=validate({...saved,executable:bundled&&defaultExecutable?defaultExecutable:saved.executable});
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
 function start() {
  if(starting)return starting;
  if(stopping||view().state==='running')return Promise.resolve(view());
  if(!config.executable){state='error';error='请先配置服务路径';return Promise.resolve(view());}
  stopRequested=false;state='starting';error=null;
  controller=new AbortController();
  starting=(async()=>{
   try {
    if(instance){await instance.stop();instance=null;}
    instance=await runtime.start({...config,signal:controller.signal});
    const url=new URL(instance.url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||Number(url.port)!==config.port)throw serviceError('INVALID_READY_URL');
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
