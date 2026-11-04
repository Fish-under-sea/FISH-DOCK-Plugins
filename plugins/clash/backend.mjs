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
async function exists(file){try{await stat(file);return true}catch{return false}}
// 插件包升级后旧版本目录消失，clash.json 里的 kernel 会指向不存在的包路径：卡上还写着
// 「内核运行中」的地址，自启动那一次直接 EXECUTABLE_MISSING。跟 magpie 的
// repairPackagedExecutable 一样，这里只改「指向包内、而文件已经不在了」的那一种，
// 用户自选的内核路径一律不动。
async function repairPackagedKernel(view,defaultKernel){
 if(!defaultKernel||!view.kernel||view.kernel===defaultKernel)return view;
 if(await exists(view.kernel))return view;
 try{
  await service.save({kernel:defaultKernel,mixedPort:view.mixedPort,controllerPort:view.controllerPort,tun:view.tun});
  console.error('[clash] 内核路径已失效（多半是插件升级换了目录），已改回包内内核');
 }catch(error){console.error('[clash] 内核路径修复失败：'+(error?.code??'UNKNOWN')+' '+(error?.message??''))}
 return service.view({controller:false});
}
// 自启动：只在「随 Dock 启动」那一次做，而且不占 activate 的预算。
// activate 在宿主那边有 5–8 秒的冷启预算，恢复系统代理（要起一次 pwsh）、探控制器
// （pid + 密钥 + /version 三重确认）都放在里面排队，冷启时很容易把预算吃光——用户看到
// 的就是「第一次开机没起来，第二次好了」。这里让 activate 立刻返回，慢活全在后台。
async function autostartKernel(defaultKernel){
 try{
  let view=await service.view({controller:false});
  view=await repairPackagedKernel(view,defaultKernel);
  // 未配置内核（还没选过）时不替用户拿主意，与 2.1.5 起的行为一致。
  if(!view.configured||view.running)return;
  for(const delay of [0,1500,4000]){
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   try{
    await service.start();
    return;
   }catch(error){
    // 冷启时端口/磁盘/杀软都可能还慢一拍：按 0 / 1.5 / 4 秒各试一次，最后把原因写进日志。
    if(delay===4000)console.error('[clash] 自启动内核失败：'+(error?.code??'UNKNOWN')+' '+(error?.message??''));
   }
  }
 }catch(error){console.error('[clash] 自启动准备失败：'+(error?.code??'UNKNOWN')+' '+(error?.message??''))}
}
createPlugin({id:'fish.clash',activate:async context=>{
 // TUN 服务目录固定在 ProgramData，跨插件升级不随目录移动。
 const programData=process.env.ProgramData||'C:/ProgramData';
 // 内置 geo 数据随插件分发，位于插件自己的 service 目录（与 tun-service.exe 同级）。
 const geoDir=fileURLToPath(new URL('./service',import.meta.url));
 const runtime=createRuntime({...context,tun:createTun({context,programData}),geoDir});
 const kernel=fileURLToPath(new URL('../../service/mihomo.exe',import.meta.url));
 const defaultKernel=(await stat(kernel).catch(()=>null))?.isFile()?kernel:'';
 service=createClash({context,runtime,pluginVersion:await pluginVersion(),defaultKernel});
 // 宿主只在「随 Dock 启动」这一次传 FISH_PLUGIN_AUTOSTART=1（#22）；安装、点启用、回滚
 // 与手动启动都不传 1。自启动判定放在最前面，activate 立刻返回，剩下的交给后台。
 if(process.env.FISH_PLUGIN_AUTOSTART==='1')void autostartKernel(defaultKernel);
 // 系统代理恢复记录被其他程序改过（TUN、别的代理）属于可降级状况：带上 code 记一条，
 // 但不能让 activate 抛出去——插件进程起不来，标签页就跟着消失（#14 现象 C/E）。
 void runtime.proxy.restore().catch(error=>console.error('[clash] 系统代理恢复失败：'+(error?.code??'UNKNOWN')+' '+(error?.message??'')));
},deactivate:async()=>{if(service)await service.shutdown();service=null},commands:{
 ...Object.fromEntries(['view','save','tunSwitch','subscriptionSave','subscriptionToggle','subscriptionRemove','select','mode','reload','proxy','details','nodeTest',
  'tunService','installTunService','uninstallTunService','ipInfo','siteTest'].map(name=>[`clash.${name}`,params=>service[name](params)])),
 'clash.start':()=>{void service.start().catch(()=>{});return service.view({controller:false})},
 'clash.stop':()=>{void service.stop().catch(()=>{});return service.view({controller:false})}
},onError:()=>{void service?.shutdown().catch(()=>{})}});
process.stdin.once('end',()=>{void service?.shutdown().catch(()=>{})});