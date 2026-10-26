import path from 'node:path';
// 服务统一使用显式路径；浏览器只能修改启动参数，持久凭据由各自后端保管。
export function createGateway({context,runtime,kind}){
 let config={executable:'',port:kind==='magpie'?3425:38080},state='unconfigured',error=null,instance=null,busy=false;
 function validate(value){
  if(typeof value.executable!=='string'||(value.executable&&!path.isAbsolute(value.executable)&&!path.win32.isAbsolute(value.executable)))throw Error('服务路径必须为绝对路径');
  if(!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw Error('端口须为 1024–65535 的整数');
  return {executable:value.executable,port:value.port};
 }
 function view(){
  if(state==='running'&&instance?.alive&&!instance.alive()){state='error';error='服务进程已退出，请检查服务配置后重新启动';}
  return {...config,state,error,url:state==='running'?instance.url:null};
 }
 async function load(){const bytes=await context.storage.read('config','gateway.json');if(bytes!=null){try{config=validate(JSON.parse(bytes))}catch{state='error';error='服务配置损坏，请重新保存配置';throw Error(error)}}state=config.executable?'stopped':'unconfigured';return view()}
 async function save(patch){
  if(busy||view().state==='running')throw Error('请先停止服务再修改启动参数');
  const next=validate({...config,...patch});await context.storage.write('config','gateway.json',JSON.stringify(next));config=next;state=config.executable?'stopped':'unconfigured';error=null;return view();
 }
 async function start(){
  if(view().state==='running'||busy)return view();
  if(!config.executable)throw Error('请先配置服务路径');
  busy=true;state='starting';error=null;
  try{
   if(instance){await instance.stop();instance=null;}
   const candidate=await runtime.start({...config});
   const url=new URL(candidate.url);
   if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password){await candidate.stop();throw Error('服务就绪地址无效')}
   instance=candidate;state='running';
  }catch{state='error';error='服务启动失败，请确认路径、端口与服务文件完整性';}
  finally{busy=false;}
  return view();
 }
 async function stop(){
  if(busy)throw Error('服务正在切换状态，请稍后再试');
  busy=true;
  try{if(instance){await instance.stop();instance=null}state=config.executable?'stopped':'unconfigured';error=null}
  catch{state='error';error='服务退出尚未完成，请重试停止';}
  finally{busy=false}
  return view();
 }
 return {load,view,save,start,stop};
}
