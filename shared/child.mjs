import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {serviceError} from './errors.mjs';
export async function available(port){
 const socket=net.createServer();
 await new Promise((resolve,reject)=>{socket.once('error',()=>reject(serviceError('PORT_IN_USE')));socket.listen(port,'127.0.0.1',resolve)});
 await new Promise(resolve=>socket.close(resolve));
}
// 持有唯一子进程句柄，日志仅用于就绪匹配，不向调用者转发凭据或上游输出。
export async function startChild({executable,args,env,cwd,ready,probe,timeout=45000,shutdown,signal}){
 signal?.throwIfAborted();
 const child=spawn(executable,args,{env,cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let exited=false,spawnError=false,seen=false,buffer='',stopping;
 const exit=new Promise(resolve=>{child.once('exit',()=>{exited=true;resolve()});child.once('error',()=>{spawnError=true;exited=true;resolve()})});
 function data(chunk){buffer+=chunk.toString();if(ready(buffer))seen=true;buffer=buffer.slice(-16384)}
 child.stdout.on('data',data);child.stderr.on('data',data);child.stdin.on('error',()=>{});
 async function terminate(){
  if(exited)return;
  if(shutdown){
   child.stdin.end(shutdown);
   if(await Promise.race([exit.then(()=>true),delay(1500).then(()=>false)]))return;
  }
  // Kill the owned tree while its root still exists: killing the parent first
  // prevents taskkill /T from discovering remaining descendants.
  if(process.platform==='win32'){
   const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
   await new Promise(resolve=>{killer.once('exit',resolve);killer.once('error',resolve)});
  }else{
   child.kill();
   if(await Promise.race([exit.then(()=>true),delay(1500).then(()=>false)]))return;
   child.kill('SIGKILL');
  }
  if(!await Promise.race([exit.then(()=>true),delay(5000).then(()=>false)]))throw serviceError('STOP_FAILED');
 }
 function stop(){if(!stopping)stopping=terminate().finally(()=>{stopping=null});return stopping}
 try{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
   signal?.throwIfAborted();
   if(spawnError)throw serviceError('SPAWN_FAILED');
   if(exited)throw serviceError('EARLY_EXIT');
   if(seen&&await probe()&&!exited)return {alive:()=>!exited,stop};
   await delay(100);
  }
  throw serviceError('READY_TIMEOUT');
 }catch(error){await stop();throw error}
}
export function isolatedEnvironment({home,credentials,config,cache,key}){
 const env={};
 for(const name of ['SystemRoot','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','SystemDrive'])if(process.env[name])env[name]=process.env[name];
 return {...env,TEMP:cache,TMP:cache,HOME:home,USERPROFILE:home,APPDATA:config,LOCALAPPDATA:cache,XDG_CONFIG_HOME:credentials,XDG_CACHE_HOME:cache,MAGPIE_WEB_KEY:key};
}
