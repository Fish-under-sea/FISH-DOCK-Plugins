import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rename,unlink,lstat,realpath,rm} from 'node:fs/promises';
import {join,isAbsolute,resolve,dirname,sep} from 'node:path';
import {createServer} from 'node:net';

export const subscriptionPrefix=id=>`[${id}] `;
export const updateMessages=Object.freeze({
 NETWORK:'网络请求失败，请检查网络或订阅服务器；旧缓存仍保留',
 TIMEOUT:'订阅请求超时，请稍后重试；旧缓存仍保留',
 REDIRECT:'订阅返回重定向，请使用最终 HTTPS 订阅地址；旧缓存仍保留',
 HTTP:'订阅服务器拒绝请求，请检查地址或凭据；旧缓存仍保留',
 EMPTY:'订阅为空或没有可用节点；旧缓存仍保留',
 FORMAT:'订阅格式无效，仅支持 mihomo 可读取的代理 YAML/JSON；旧缓存仍保留',
 TOO_LARGE:'订阅超过 4 MiB 限制；旧缓存仍保留',
 KERNEL:'内核启动或订阅校验失败，请检查 mihomo 版本和路径；旧缓存仍保留',
 PREFIX:'内核不支持来源前缀或节点名称重复；旧缓存仍保留',
 APPLY:'内核更新失败，已尝试恢复旧缓存',
 STORAGE:'订阅缓存或状态保存失败；请检查数据目录',
 CANCELLED:'更新已取消，旧缓存仍保留',
 UNKNOWN:'订阅更新失败，请检查配置；旧缓存仍保留'
});
export function updateError(code) {const error=new Error(updateMessages[code]??updateMessages.UNKNOWN);error.code=code;return error}
export function publicUpdateError(error) {
  const code=Object.hasOwn(updateMessages,error?.code)?error.code:'UNKNOWN';
  return {code,message:updateMessages[code]};
}
export function subscriptionPath(root,id) {
  if(!/^sub-[a-f0-9-]{36}$/.test(id))throw Error('订阅 ID 无效');
  return join(root,'credentials',`${id}.yaml`);
}
export function fileProvider(id,path) {
  return {type:'file',path,override:{'additional-prefix':subscriptionPrefix(id)},
    'health-check':{enable:false}};
}
export async function checkExecutable(path) {
  if(!isAbsolute(path))throw Error('内核路径应为可执行文件绝对路径');
  const stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isFile()||path.split(/[\\/]/).includes('..')||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())
    throw Error('内核路径包含链接或不规范片段');
}
async function unusedPort() {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));return port;
}
export async function downloadSubscription(url,{fetch:fetcher=globalThis.fetch,signal,timeoutMs=20000}={}) {
  const parsed=new URL(url);
  if((parsed.protocol!=='http:'&&parsed.protocol!=='https:')||parsed.username||parsed.password)throw Error('订阅地址无效');
  parsed.hash='';
  const timeout=AbortSignal.timeout(timeoutMs),abort=signal?AbortSignal.any([signal,timeout]):timeout;
  let response;
  try{response=await fetcher(parsed.href,{redirect:'manual',signal:abort,
    headers:{'User-Agent':'clash.meta','Accept':'application/yaml, text/yaml, application/json, text/plain'}})}
  catch{throw updateError(signal?.aborted?'CANCELLED':timeout.aborted?'TIMEOUT':'NETWORK')}
  if(response.status>=300&&response.status<400){await response.body?.cancel().catch(()=>{});throw updateError('REDIRECT')}
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw updateError('HTTP')}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(;;) {
      abort.throwIfAborted();
      const {done,value}=await reader.read();if(done)break;
      if((size+=value.byteLength)>4*1024*1024)throw updateError('TOO_LARGE');
      chunks.push(value);
    }
  }catch(error){throw error.code==='TOO_LARGE'?error:updateError(signal?.aborted?'CANCELLED':timeout.aborted?'TIMEOUT':'NETWORK')}
  finally {await reader.cancel().catch(()=>{})}
  if(!size)throw updateError('EMPTY');
  const bytes=Buffer.concat(chunks);
  try{new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw updateError('FORMAT')}
  return bytes;
}

// Validate with the selected native core, not a hand-written YAML subset or a mock parser.
// This temporary core has no proxy listener, TUN, remote providers, DNS or health checks.
export async function validateSubscription({kernel,id,path,dataDirectory,signal}) {
  try{await checkExecutable(kernel)}catch{throw updateError('KERNEL')}
  if(signal?.aborted)throw updateError('CANCELLED');
  const port=await unusedPort(),secret=randomBytes(32).toString('hex');
  const home=dirname(path),configPath=join(home,`validate-${randomUUID()}.json`);
  const config={'mixed-port':0,'external-controller':`127.0.0.1:${port}`,secret,
    'allow-lan':false,'log-level':'warning',mode:'direct','geoip-auto-update':false,
    'proxy-providers':{[id]:fileProvider(id,path)},
    'proxy-groups':[{name:'VALIDATE',type:'select',use:[id]}],rules:['MATCH,DIRECT']};
  await writeFile(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
  const child=spawn(kernel,['-d',home,'-f',configPath],{
    cwd:home,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,SAFE_PATHS:home,TMP:home,TEMP:home}});
  let failure=false,seenEmpty=false,formatFailure=false;
  // Classify native diagnostics without forwarding or persisting their sensitive text.
  let diagnostics='';
  const classify=chunk=>{
    diagnostics=(diagnostics+chunk.toString()).slice(-8192);
    if(/no (?:valid )?(?:proxy|proxies)|doesn.t have any proxy|proxies.*empty|empty.*proxies/i.test(diagnostics))seenEmpty=true;
    if(/(?:error|failed).*(?:yaml|unmarshal|provider|proxy)|(?:yaml|unmarshal).*error/i.test(diagnostics))formatFailure=true;
  };
  child.stdout.on('data',classify);child.stderr.on('data',classify);
  child.on('error',()=>{failure=true});
  const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve)});
  const abort=()=>{child.kill()};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    const deadline=Date.now()+10000;
    while(Date.now()<deadline&&!failure&&child.exitCode===null&&child.signalCode===null) {
      if(signal?.aborted)throw updateError('CANCELLED');
      if(seenEmpty)throw updateError('EMPTY');
      if(formatFailure)throw updateError('FORMAT');
      try {
        const response=await fetch(`http://127.0.0.1:${port}/providers/proxies/${id}`,{
          headers:{Authorization:`Bearer ${secret}`},redirect:'error',
          signal:signal?AbortSignal.any([signal,AbortSignal.timeout(500)]):AbortSignal.timeout(500)});
        if(response.ok) {
          const text=await response.text();
          if(text.length>4*1024*1024)throw Error('订阅节点过多');
          const nodes=JSON.parse(text).proxies;
          if(Array.isArray(nodes)&&nodes.length>0) {
            if(nodes.some(n=>typeof n.name!=='string'||!n.name.startsWith(subscriptionPrefix(id)))||
              new Set(nodes.map(n=>n.name)).size!==nodes.length)throw updateError('PREFIX');
            return {nodeCount:nodes.length};
          }
          if(Array.isArray(nodes)&&nodes.length===0)seenEmpty=true;
        }
      }catch(error){if(signal?.aborted)throw updateError('CANCELLED');if(error.code==='PREFIX')throw error}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw updateError(seenEmpty?'EMPTY':formatFailure?'FORMAT':'KERNEL');
  }finally{
    signal?.removeEventListener('abort',abort);
    if(child.exitCode===null&&child.signalCode===null&&!failure)child.kill();
    const timer=setTimeout(()=>child.kill('SIGKILL'),1500);
    try{await exited}finally{clearTimeout(timer);await unlink(configPath).catch(()=>{})}
  }
}

export function createSubscriptionRuntime(context,{fetch:fetcher=globalThis.fetch,validate=validateSubscription}={}) {
  const root=context.dataDirectory;
  async function ensure() {
    for(const category of ['credentials','tmp','config'])await mkdir(join(root,category),{recursive:true});
  }
  async function updateSubscription({kernel,id,url,signal,apply,commit}) {
    await ensure();signal?.throwIfAborted();
    const target=subscriptionPath(root,id),jobDirectory=await mkdtemp(join(root,'tmp','import-'));
    const candidate=join(jobDirectory,'provider.yaml');
    let previous,installed=false;
    try {
      const bytes=await downloadSubscription(url,{fetch:fetcher,signal});
      await writeFile(candidate,bytes,{mode:0o600,flag:'wx'});
      const result=await validate({kernel,id,path:candidate,dataDirectory:root,signal});
      signal?.throwIfAborted();
      previous=await readFile(target).catch(error=>{if(error.code==='ENOENT')return null;throw error});
      // Same-volume atomic replacement: never truncate the last good cache during download.
      await rename(candidate,target);installed=true;
      if(apply)try{await apply()}catch{throw updateError('APPLY')}
      if(signal?.aborted)throw updateError('CANCELLED');
      if(commit)try{await commit(result)}catch{throw updateError('STORAGE')}
      return result;
    }catch(error) {
      if(installed) {
        if(previous===null)await unlink(target);
        else {
          await writeFile(candidate,previous,{mode:0o600});
          await rename(candidate,target);
        }
        // A controller may have applied a request whose response was lost.
        if(apply)await apply().catch(()=>{});
      }
      if(signal?.aborted)throw updateError('CANCELLED');
      if(['EACCES','EPERM','ENOSPC','EIO','ENOENT'].includes(error.code))throw updateError('STORAGE');
      throw error;
    }finally{
      // Only remove the unique temporary directory returned by mkdtemp under this namespace.
      if(!resolve(jobDirectory).startsWith(resolve(root,'tmp')+sep))throw updateError('STORAGE');
      await rm(jobDirectory,{recursive:true,force:true});
    }
  }
  async function migrateSubscription(id) {
    await ensure();
    const previous=await readFile(join(root,'config','providers','subscription.yaml')).catch(error=>{
      if(error.code==='ENOENT')return null;throw error;
    });
    if(!previous?.length)return false;
    const target=subscriptionPath(root,id);
    await writeFile(target,previous,{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error});
    return true;
  }
  async function removeSubscription(id) {
    await unlink(subscriptionPath(root,id)).catch(error=>{if(error.code!=='ENOENT')throw error});
  }
  return {updateSubscription,migrateSubscription,removeSubscription};
}
