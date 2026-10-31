import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPlugin} from './sdk.mjs';
import {createClash} from './service.mjs';
import {createRuntime} from './runtime.mjs';
import {createTun} from './tun.mjs';
let service;
// 页面版本跟随包内清单：打包时 build-release 把 plugin.json 的 version 写成发行版本，
// 页面读到的就是同一个号，不再单独维护一个「页面版本」。
async function pluginVersion() {
 try{return JSON.parse(await readFile(new URL('../../plugin.json',import.meta.url),'utf8')).version??''}catch{return ''}
}
createPlugin({id:'fish.clash',activate:async context=>{
 // TUN 服务目录固定在 ProgramData，跨插件升级不随目录移动。
 const programData=process.env.ProgramData||'C:/ProgramData';
 // 内置 geo 数据随插件分发，位于插件自己的 service 目录（与 tun-service.exe 同级）。
 const geoDir=fileURLToPath(new URL('./service',import.meta.url));
 const runtime=createRuntime({...context,tun:createTun({context,programData}),geoDir});
 await runtime.proxy.restore();
 const kernel=fileURLToPath(new URL('../../service/mihomo.exe',import.meta.url));
 service=createClash({context,runtime,pluginVersion:await pluginVersion(),defaultKernel:(await stat(kernel).catch(()=>null))?.isFile()?kernel:''});
 await service.view();
 // 宿主只在「随 Dock 启动」这一次传 FISH_PLUGIN_AUTOSTART=1（#22）；安装、点启用、回滚
 // 与手动启动都不传 1。clash 的 view() 是异步的（要读配置与控制器状态），所以先等它，
 // 只补「已经有内核、此刻又没在跑」这一种；未配置时留给用户自己选内核。
 if(process.env.FISH_PLUGIN_AUTOSTART==='1')void service.view().then(view=>{if(view.configured&&!view.running)void service.start().catch(()=>{})}).catch(()=>{});
},deactivate:async()=>{if(service)await service.shutdown();service=null},commands:{
 ...Object.fromEntries(['view','save','tunSwitch','subscriptionSave','subscriptionToggle','subscriptionRemove','layout','select','mode','reload','proxy','details',
  'tunService','installTunService','uninstallTunService','ipInfo','siteTest'].map(name=>[`clash.${name}`,params=>service[name](params)])),
 'clash.start':()=>{void service.start().catch(()=>{});return service.view({controller:false})},
 'clash.stop':()=>{void service.stop().catch(()=>{});return service.view({controller:false})}
},onError:()=>{void service?.shutdown().catch(()=>{})}});
process.stdin.once('end',()=>{void service?.shutdown().catch(()=>{})});
