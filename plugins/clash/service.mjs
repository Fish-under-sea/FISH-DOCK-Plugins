import {randomBytes} from 'node:crypto';
export function createClash({context,runtime,request:injectedRequest,fetch:fetcher=globalThis.fetch}){
 let running=null,settings,secret='';
 const defaults={kernel:'',mixedPort:7895,controllerPort:9099,layout:'single'};
 async function config(){if(!settings){settings={...defaults,...JSON.parse(await context.storage.read('config','clash.json')||'{}')}}return settings}
 async function request(path,{method='GET',body}={}){
  if(injectedRequest)return injectedRequest(path,{method,...(body===undefined?{}:{body})});
  const c=await config(),response=await fetcher(`http://127.0.0.1:${c.controllerPort}${path}`,{method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3500),redirect:'error'});
  if(!response.ok)throw Error('mihomo 控制器请求失败');if(response.status===204)return {};
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>2*1024*1024)throw Error('mihomo 响应超过限制');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
 }
 function alive(){return !!running&&running.alive()}
 async function view(){
  const c=await config();const state={...c,configured:!!c.kernel,subscriptionConfigured:!!(await context.secrets.read('credentials','subscription.json')),running:alive(),systemProxy:runtime.proxy.active?.()??false,groups:[],mode:'rule'};
  if(state.running){try{const [version,proxies,status]=await Promise.all([request('/version'),request('/proxies'),request('/configs')]);state.version=version.version;state.mode=status.mode;state.groups=Object.entries(proxies.proxies||{}).filter(([,p])=>Array.isArray(p.all)).map(([name,p])=>({name,selected:p.now,nodes:p.all.map(name=>({name,delay:proxies.proxies[name]?.history?.at(-1)?.delay??null}))}))}catch{state.error='控制器暂未响应，请刷新或停止内核'}}
  return state;
 }
 async function save(params){
  if(alive())throw Error('请先停止内核再更改配置');const old=await config();const next={...old,kernel:String(params.kernel??old.kernel).trim(),mixedPort:params.mixedPort??old.mixedPort,controllerPort:params.controllerPort??old.controllerPort};
  if(!next.kernel||next.kernel.length>2048||/[\r\n\0]/.test(next.kernel))throw Error('请选择 mihomo 内核');
  for(const port of [next.mixedPort,next.controllerPort])if(!Number.isInteger(port)||port<1024||port>65535)throw Error('端口应为 1024–65535');
  if(next.mixedPort===next.controllerPort)throw Error('混合代理和控制器端口应不同');
  const previous=await context.secrets.read('credentials','subscription.json');let subscription=previous;
  if(params.clearSubscription)subscription='';else if(params.subscription?.trim()){const url=new URL(params.subscription.trim());if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('订阅使用 HTTPS 地址');subscription=url.href}
  try{await context.secrets.write('credentials','subscription.json',subscription||'');await context.storage.write('config','clash.json',JSON.stringify(next));settings=next}catch(error){await context.secrets.write('credentials','subscription.json',previous||'');throw error}
  return view();
 }
 async function layout({layout}){if(!['single','double'].includes(layout))throw Error('布局值无效');const next={...await config(),layout};await context.storage.write('config','clash.json',JSON.stringify(next));settings=next;return view()}
 async function start(){
  if(alive())return view();const c=await config();if(!c.kernel)throw Error('请先选择 mihomo 内核');
  secret=await context.secrets.read('keys','controller.key')||randomBytes(32).toString('hex');await context.secrets.write('keys','controller.key',secret);
  const subscription=await context.secrets.read('credentials','subscription.json')||'';
  const candidate=await runtime.start({...c,secret,subscription,request});running=candidate;
  try{await request('/version')}catch(error){await candidate.stop();running=null;throw error}return view();
 }
 async function stop(){await runtime.proxy.restore();if(running){await running.stop();running=null}return view()}
 async function select({group,name}){if(!alive())throw Error('内核尚未启动');const state=await view();if(!state.groups.some(g=>g.name===group&&g.nodes.some(n=>n.name===name)))throw Error('代理组或节点已变化，请刷新');await request(`/proxies/${encodeURIComponent(group)}`,{method:'PUT',body:{name}});return view()}
 async function mode({mode}){if(!alive()||!['rule','global','direct'].includes(mode))throw Error('内核状态或模式无效');await request('/configs',{method:'PATCH',body:{mode}});return view()}
 async function reload(){if(!alive())throw Error('内核尚未启动');await request('/providers/proxies/subscription',{method:'PUT'});return view()}
 async function proxy({enabled}){if(typeof enabled!=='boolean')throw Error('系统代理状态无效');if(enabled){if(!alive())throw Error('请先启动内核');await runtime.proxy.enable((await config()).mixedPort)}else await runtime.proxy.restore();return view()}
 async function details({section}){if(!alive())throw Error('内核尚未启动');const path={rules:'/rules',connections:'/connections',providers:'/providers/proxies'}[section];if(!path)throw Error('详情类别无效');return request(path)}
 return {view,save,layout,start,stop,select,mode,reload,proxy,details};
}
