// 网关监听地址：MAGPIE_ADDR 钉住主机时 Magpie 自己不会放开绑定
// （internal/gateway/lan.go：pinnedHost() 非空即按 Addr() 监听，LANURLs()
// 在钉死回环时返回空），局域网共享开关因此永远不生效。适配层在启动前读
// Magpie 自己的 settings.json，按 lan 决定绑回环还是全网卡，并把端口固定
// 下来，避免地址随每次启动漂移。
import fs from 'node:fs/promises';
import path from 'node:path';

// 与服务端口 3425 错开的默认网关端口，只在适配层没有保存网关端口时使用。
export const DEFAULT_GATEWAY_PORT=3426;

// readMagpiePrefs 读 credentials/magpie-runtime/data/settings.json 里与启动
// 有关的两项：lan 决定绑定范围，port 是用户在 Magpie 里设过的网关端口。
// 文件缺失或损坏都不阻塞启动：损坏由 prepareManagedUpdates 先行拦截，这里
// 只当没有设置。
export async function readMagpiePrefs(data){
 let raw;
 try{raw=await fs.readFile(path.join(data,'settings.json'),'utf8')}catch{return {lan:false,port:0}}
 let json;
 try{json=JSON.parse(raw.replace(/^\uFEFF/,''))}catch{return {lan:false,port:0}}
 if(!json||typeof json!=='object'||Array.isArray(json))return {lan:false,port:0};
 const port=Number.isInteger(json.port)&&json.port>=1024&&json.port<=65535?json.port:0;
 return {lan:json.lan===true,port};
}

// gatewayHost 是 MAGPIE_ADDR 的主机部分：共享时绑全网卡（含回环，Dock 内部
// 仍可用 127.0.0.1 访问），否则只绑回环。
export function gatewayHost(lan){return lan?'0.0.0.0':'127.0.0.1'}

// gatewayPortCandidates 是按优先顺序尝试的网关端口：适配层保存的端口、Magpie
// 里设过的端口、默认端口；服务端口与网页上游端口一律排除，重复值只留首个。
export function gatewayPortCandidates({configured=0,prefs={},taken=[]}={}){
 const out=[];
 for(const value of [configured,prefs.port,DEFAULT_GATEWAY_PORT]){
  if(!Number.isInteger(value)||value<1024||value>65535)continue;
  if(taken.includes(value)||out.includes(value))continue;
  out.push(value);
 }
 return out;
}

// gatewayAddr 把主机与端口拼成 MAGPIE_ADDR 的形式。
export function gatewayAddr(host,port){return `${host}:${port}`}