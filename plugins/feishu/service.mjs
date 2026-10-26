import {createHmac} from 'node:crypto';
const DEFAULTS=Object.freeze({enabled:false,waiting:true,done:true,error:true});
const safe=value=>String(value??'').replaceAll('<','＜').replaceAll('>','＞').replace(/[\x00-\x1f]/g,' ').slice(0,600);
function webhook(value) {
 if(typeof value!=='string'||!/^https:\/\/(open\.feishu\.cn|open\.larksuite\.com)\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_.-]{1,200}$/.test(value))throw Error('请输入飞书或 Lark 群机器人的 HTTPS Webhook');
 return value;
}
function preferences(value) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('通知配置格式无效');
 const result={};for(const key of Object.keys(DEFAULTS)){if(typeof value[key]!=='boolean')throw Error('通知开关应为布尔值');result[key]=value[key]}
 return result;
}
export function createNotifier({context,fetch:request=globalThis.fetch,clock=Date.now}={}) {
 let last=null;const times=[],sent=new Map();
 async function credentials(){const raw=await context.secrets.read('credentials','robot.json');if(!raw)return null;const row=JSON.parse(raw);webhook(row.webhook);if(typeof row.secret!=='string'||row.secret.length>512)throw Error('签名配置损坏');return row}
 async function config(){const raw=await context.storage.read('config','notifications.json');return raw?preferences(JSON.parse(raw)):{...DEFAULTS}}
 async function layout(value){if(!['single','double'].includes(value))throw Error('页面布局无效');await context.storage.write('config','layout.json',JSON.stringify({layout:value}));return {layout:value}}
  async function view(){const [row,settings,ui]=await Promise.all([credentials(),config(),context.storage.read('config','layout.json')]);let mode='single';try{if(JSON.parse(ui)?.layout==='double')mode='double'}catch{}return {...settings,layout:mode,configured:!!row,signing:!!row?.secret,webhookTail:row?'…'+row.webhook.slice(-4):'',last}}
 async function save(value){
   const settings=preferences(value);
   if(value.webhook!==undefined&&typeof value.webhook!=='string')throw Error('Webhook 格式无效');
   if(value.secret!==undefined&&(typeof value.secret!=='string'||value.secret.length>512||/[\x00-\x1f]/.test(value.secret)))throw Error('签名密钥格式无效');
   const old=await credentials();
   const next=value.clear?null:{webhook:value.webhook?.trim()||old?.webhook||'',secret:value.clearSecret?'':value.secret||old?.secret||''};
   if(next)webhook(next.webhook);
   // 即使清除也通过宿主加密写入空对象标记，避免产生明文临时凭据。
   await context.secrets.write('credentials','robot.json',next?JSON.stringify(next):'');
   try{await context.storage.write('config','notifications.json',JSON.stringify(settings));}
   catch{
     try{await context.secrets.write('credentials','robot.json',old?JSON.stringify(old):'');}
     catch{throw Error('配置保存失败，凭据恢复未完成，请重新保存配置');}
     throw Error('配置保存失败，原凭据已恢复');
   }
   return view();
 }
 async function post(text){
   const row=await credentials();if(!row)return {ok:false,code:'NOT_CONFIGURED'};
   const body={msg_type:'text',content:{text}};
   if(row.secret){body.timestamp=String(Math.floor(clock()/1000));body.sign=createHmac('sha256',`${body.timestamp}\n${row.secret}`).update('').digest('base64')}
   let result;
   try {
     const response=await request(row.webhook,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
     if(!response.ok)result={ok:false,code:'HTTP'};
     else {const answer=await response.json();result=answer?.code===0?{ok:true,code:'0'}:{ok:false,code:Number.isInteger(answer?.code)?String(answer.code):'RESPONSE'}};
   }catch{result={ok:false,code:'NETWORK'}}
   last={...result,at:clock()};return last;
 }
 async function test(){return post('FISH Dock 飞书测试通知：连接与签名验证。')}
 async function event(row){
   const settings=await config();if(row?.type!=='agent.alert'||!settings.enabled||!['waiting','done','error'].includes(row.mood)||!settings[row.mood])return {skipped:'filtered'};
   const now=clock(),key=JSON.stringify([row.mood,row.session,row.workspace,row.repo,row.project]);
   for(const [id,time] of sent)if(now-time>=5000)sent.delete(id);
   if(sent.has(key))return {skipped:'duplicate'};
   while(times.length&&now-times[0]>=60000)times.shift();
   if(times.length>=20)return {skipped:'rate-limit'};
   times.push(now);sent.set(key,now);
   const status={waiting:'需要确认',done:'已完成',error:'发生错误'}[row.mood];
   return post(`FISH Dock · ${status}\n仓库：${safe(row.repo||row.project)}\n工作区：${safe(row.workspace)}\n会话：${safe(row.session)}\n时间：${new Date(now).toISOString()}`);
 }
 return {save,view,test,event,layout};
}
