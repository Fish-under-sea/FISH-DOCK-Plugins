(() => {
 const root=document.querySelector('#app');
 // 版本号不再单独维护：后端读包内 plugin.json 并把 version 放进 view.pluginVersion，
 // 页面直接显示插件版本，跟着发行版本走。
 // 页签 + 启停/刷新共用顶部一行（#headbar）。内核设置是独立页签，不再当每页底部的折叠条。
 const SECTIONS=[['overview','概览'],['providers','订阅'],['settings','内核设置']];
 const MODES=[['rule','规则','按规则分流：国内直连，其余走代理'],['global','全局','所有流量都走代理'],
  ['direct','直连','全部不走代理，等价于关闭分流']];
 let view=null,busy=false,polling=false,error='',notice='',noticeKind='info';
 let group='',section='overview',timer=null,revision=0;
 let draft={id:'',name:'',url:''},fieldErrors={},configDraft=null,confirmDelete='',confirmTun='';
 // 手动测速的结果按节点名缓存：视图里的 delay 要等内核自己测，页面这层先显示新值。
 let nodeDelays={},nodeTesting=false;
 let ip=null,ipBusy=false,ipError='',ipReveal=false,ipAsked=false;
 let sites=null,sitesBusy=false;
 // 下拉框展开期间、以及用户正在滚动时被推迟的重绘（见 draw）；停下来后补上。
 let staleDraw=false,scrollAt=0,scrollTimer=null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const updating=()=>view?.subscriptions?.some(s=>s.updating);
 // 后端在运行中拒绝订阅与配置变更，界面必须同步禁用（否则只是把错误延后到 RPC）。
 const locked=()=>busy||view?.running||!!view?.operation||updating();
 const button=(action,text,extra='',disabled=busy)=>`<button type="button" data-action="${action}" ${extra} ${disabled?'disabled':''}>${text}</button>`;
 const when=value=>value?esc(new Date(value).toLocaleString()):'—';
 const say=(text,kind='info')=>{notice=String(text||'');noticeKind=kind};
 // 错误呈现：只按错误码查固定文案，不再用中文正则猜后端提示。
 // 浏览器里不能 import shared/errors.mjs，所以这份表与 shared/errors.mjs 的 errorMessages
 // 逐条同源（page.test.mjs 会逐码比对两份表），改一处必须改两处。
 const ERROR_TEXT={UNKNOWN_ERROR:'未识别错误，请重试；若反复出现，请打开插件日志查看原始错误码',
  KERNEL_ATTACH_FAILED:'无法接管残留内核：请先停止内核（或结束残留的 mihomo 进程）后重新启动',
  KERNEL_STOP_UNCONFIRMED:'内核是否已退出未能确认：请两秒后刷新；仍显示运行中就在任务管理器结束 mihomo 进程',
  PROXY_RESTORE_RECORD_INVALID:'系统代理恢复记录无效：请在设置里手动关闭系统代理，再重新打开内核',
  PROXY_REGISTRY_READ_FAILED:'无法读取系统代理设置：请检查当前用户对 Internet 设置的读取权限，或先手动关闭系统代理再重试',
  PROXY_REGISTRY_WRITE_FAILED:'无法写入系统代理设置：请检查注册表写入权限与安全软件拦截后重试',
  CONTROLLER_UNREACHABLE:'内核控制器无响应：请确认内核进程仍在运行、控制器端口未被占用，然后重试',
  CONTROLLER_TIMEOUT:'内核控制器响应超时：请稍后重试；连续超时请重启内核',
  SUBSCRIPTION_CORRUPT:'订阅配置损坏：请从备份恢复或重新添加订阅地址后再更新',
  // Clash 校验类（#14）：文案与原话逐字一致，只是从中文正则匹配改成按码查表。
  KERNEL_NOT_RUNNING:'内核尚未启动',
  KERNEL_RUNNING_LOCK:'请先停止内核再更改配置',
  KERNEL_SWITCHING:'内核正在切换状态，请稍后重试',
  KERNEL_STATE_INVALID:'内核状态或模式无效',
  KERNEL_NOT_SELECTED:'请先选择 mihomo 内核',
  PROXY_STATE_INVALID:'系统代理状态无效',
  PROXY_PORT_INVALID:'代理端口无效',
  PORT_RANGE_INVALID:'端口应为 1024–65535',
  PORT_CONFLICT:'混合代理和控制器端口应不同',
  NODE_STALE:'代理组或节点已变化，请刷新',
  NODE_UNAVAILABLE:'没有可用的代理节点，请先选择节点',
  SUBSCRIPTION_URL_INVALID:'订阅地址无效，请粘贴完整的 http:// 或 https:// 链接',
  SUBSCRIPTION_NAME_INVALID:'请输入 1–80 字的订阅名称，不要包含地址或凭据',
  SUBSCRIPTION_LIMIT:'最多保存 32 个订阅',
  SUBSCRIPTION_NOT_FOUND:'订阅不存在，请刷新',
  SUBSCRIPTION_STATE_INVALID:'订阅启用状态无效',
  SUBSCRIPTION_IMMUTABLE:'请在订阅管理中新增或删除订阅',
  SUBSCRIPTION_UPDATING:'请等待订阅更新完成',
  SUBSCRIPTION_NO_CACHE:'请先更新已启用订阅，获取可用缓存',
  DETAIL_SECTION_INVALID:'详情类别无效',
  PLUGIN_STOPPING:'插件正在停用',
  TUN_UNSUPPORTED:'当前环境不支持 TUN 服务模式',
  TUN_SWITCH_INVALID:'TUN 开关无效',
  TUN_NOT_INSTALLED:'请先在设置里安装 TUN 服务',
  TUN_START_UNCONFIRMED:'TUN 服务未确认启动，请查看服务日志',
  TUN_READY_TIMEOUT:'TUN 内核未在时限内就绪，请检查服务日志与端口',
  TUN_KERNEL_MISMATCH:'已安装的 TUN 服务绑定了另一个内核，请重新安装服务',
  RESPONSE_TOO_LARGE:'mihomo 响应超过限制',
  GEO_DATA_TOO_LARGE:'geo 数据超过限制',
  PORT_IN_USE:'端口已被占用，请停止冲突服务或更换本机端口后重试',
  PORT_BIND_DENIED:'端口绑定被系统拒绝：请避开系统保留端口段（或改用 1024 以上的其他端口）后重试',
  FILE_BUSY:'文件被其他进程占用：请关闭正在使用该文件的程序或暂停杀毒扫描后重试',
  PERMISSION_DENIED:'权限不足：请把插件装到当前用户可写的目录，或调整该目录的访问控制后重试',
  RUNTIME_COPY_FAILED:'运行副本复制失败：请检查插件资料目录的可用空间与文件占用后重试，旧副本仍保留',
  GATEWAY_ERROR:'服务网关启动异常：请打开插件日志查看原始错误码，确认端口与运行副本状态后重试',
  EXECUTABLE_MISSING:'服务文件不存在，请重新安装插件或选择有效的服务文件',
  EXECUTABLE_INVALID:'服务路径不是普通文件，请重新选择',
  DATA_UNWRITABLE:'插件数据目录不可写，请检查数据根目录及访问权限',
  DATA_MIGRATION_FAILED:'准备 Magpie 资料目录失败，原资料已保留；请检查目录权限和可用空间后重试',
  RUNTIME_PREPARE_FAILED:'准备 Magpie 运行副本失败，请检查插件资料目录的可用空间、权限或文件占用后重试；旧版本文件已保留',
  RUNTIME_INTEGRITY:'Magpie 运行副本校验失败，已停止启动并保留资料；请重新安装插件，若仍提示此错误请检查对应副本文件',
  SETTINGS_INVALID:'Magpie 设置文件已损坏（原文件已保留），请检查插件资料下 credentials/magpie-runtime/data/settings.json，修复配置后重新启动',
  SPAWN_FAILED:'无法启动服务，请检查运行时依赖、文件权限和系统兼容性',
  EARLY_EXIT:'服务在就绪前退出，请检查依赖和独立测试日志后重试',
  READY_TIMEOUT:'等待服务就绪超时，请检查依赖或端口后重试',
  INVALID_READY_URL:'服务就绪地址无效，请检查适配包与服务版本是否匹配',
  STOP_FAILED:'服务退出尚未完成，请重试停止',
  EADDRINUSE:'端口已被本机其他程序占用（EADDRINUSE）：请关闭占用该端口的程序，或改用其他端口后重试',
  EACCES:'没有访问权限（EACCES）：请确认目标目录归当前用户所有，或以管理员权限重新安装插件',
  EPERM:'系统拒绝该操作（EPERM）：请检查安全软件或系统策略是否拦截，再重试',
  EBUSY:'文件被占用或资源忙（EBUSY）：请关闭占用该文件的程序后重试',
  // 插件协议层（d.sdk/宿主产生，t12 打通后真的会到页面）：不要落到「未识别错误」。
  COMMAND_FAILED:'这次操作插件没能完成：请重试；仍失败请打开插件日志查看原因',
  NOT_ACTIVE:'插件尚未启用：回到插件页启用后重试',
  UNKNOWN_METHOD:'宿主与插件版本不匹配（页面要的方法插件没有）：请更新插件到 2.1.2 后重试',
  CAPABILITY_REQUIRED:'宿主与插件版本不匹配（插件没声明所需能力）：请更新插件到 2.1.2 后重试',
  BAD_HANDSHAKE:'插件没能与 Dock 完成握手：请重新安装该插件；仍失败请打开插件日志',
  HANDSHAKE_REQUIRED:'插件会话尚未就绪：请关闭并重新打开插件页面后重试',
  OPERATION_ERROR:'插件操作未完成：请刷新后重试；仍失败请打开插件日志查看原因'};
 // 宿主协议层会把插件错误折叠成一条固定常量（plugin_protocol.rs 的 OPERATION_ERROR），
 // code 到不了页面时按这条常量给出可执行的下一步；其余原始 message 仍不透出。
 const HOST_FOLD={'插件操作未完成，请检查配置后重试':ERROR_TEXT.OPERATION_ERROR};
 const reason=e=>{
  const code=typeof e?.code==='string'?e.code.trim():'';
  if(Object.hasOwn(ERROR_TEXT,code))return ERROR_TEXT[code];
  const m=typeof e?.message==='string'?e.message.trim():'';
  // 后端如果只透传了已翻译文案（码被中间层吞掉），按同源表反查一次，避免退化成兜底文案。
  const translated=Object.keys(ERROR_TEXT).find(key=>ERROR_TEXT[key]===m);
  if(translated)return m;
  // 只认自己表里的键：message 恰好是 constructor/toString 之类也不能把原型上的值当文案。
  return Object.hasOwn(HOST_FOLD,m)?HOST_FOLD[m]:ERROR_TEXT.UNKNOWN_ERROR;
 };
 function methodLabel(method){
  return {view:'读取状态',save:'保存设置',subscriptionSave:'保存订阅',subscriptionToggle:'切换启用',
   subscriptionRemove:'删除订阅',reload:'更新订阅',start:'启动内核',stop:'停止内核',select:'切换节点',
   mode:'切换模式',proxy:'系统代理',details:'读取详情',tunService:'读取 TUN 状态',nodeTest:'节点测速',
   installTunService:'安装 TUN 服务',uninstallTunService:'卸载 TUN 服务',ipInfo:'查询出口 IP',siteTest:'网站测试'}[method]??'操作';
 }
 async function run(method,params={}) {
  if(busy)return false;
  busy=true;revision++;error='';say('');draw();
  try {
   const result=await FishDock.call(`clash.${method}`,params);
   view=result;
   if(method==='save'){configDraft=null;say('内核设置已保存','ok')}
   if(method==='subscriptionSave'){draft={id:'',name:'',url:''};fieldErrors={};say('订阅已保存。下一步点「更新」下载并校验节点。','ok')}
   if(method==='subscriptionToggle')say('启用状态已更新','ok');
   if(method==='subscriptionRemove')say('订阅已删除，其余订阅不受影响','ok');
   if(method==='reload')say('已开始更新，完成后显示节点数与结果','ok');
   if(method==='installTunService')say('TUN 服务已安装','ok');
   if(method==='uninstallTunService')say('TUN 服务已卸载','ok');
   // 换节点也会换出口：站点测试与出口 IP 的旧值都不能留。ipAsked 必须一起清掉，
   // 否则 bind() 末尾的自动查询条件不成立，面板会一直显示上一个节点的出口（#14 现象 D）。
   if(method==='select'){sites=null;ip=null;ipAsked=false;ipError=''}
   // 内核重启后出口 IP 会变，缓存不能沿用。
   if(method==='start'||method==='stop'){ip=null;ipAsked=false;ipError='';sites=null;nodeDelays={}}
   return true;
  }catch(e){error=`${methodLabel(method)}失败：${reason(e)}`;return false}
  finally{busy=false;draw();schedule();}
 }
 function schedule() {
  clearTimeout(timer);
  if(view&&(view.running||updating()||view.operation||view.tunSwitching))timer=setTimeout(poll,1200);
 }
 async function poll() {
  if(busy||polling){schedule();return}
  polling=true;const requestedRevision=revision;
  try{const next=await FishDock.call('clash.view');if(requestedRevision===revision){view=next;draw()}}
  catch{if(requestedRevision===revision){error='状态刷新失败，请重试';draw()}}
  finally{polling=false;schedule()}
 }
 // 流量额度：used/total 字节与到期时间（服务器没给就不显示这条）。
 const fmtBytes=v=>v>=1024**3?(v/1024**3).toFixed(2)+' GB':v>=1024**2?(v/1024**2).toFixed(1)+' MB':Math.round(v/1024)+' KB';
 const fmtExpire=unix=>{const d=new Date(unix*1000);return Number.isNaN(d.getTime())?'':d.toLocaleDateString()};
 // 运行时间从内核就绪时刻算起，不看窗口开了多久。
 function fmtUptime(ms){
  if(!Number.isFinite(ms)||ms<=0)return '—';
  const minutes=Math.floor(ms/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  if(days)return `${days} 天 ${hours} 小时`;
  if(hours)return `${hours} 小时 ${rest} 分`;
  return `${rest} 分`;
 }
 // 延迟三种状态：测出数值、测过但超时、还没测过。
 // 超时的值在 mihomo 里是 0 或 null，直接显示「0 ms」会让人以为节点很快——标红写「已超时」。
 const groups=()=>view?.groups??[];
 // 代理组默认落在「自动选择」上：多数人不想手挑节点，让它按延迟自动跑。
 const autoGroup=()=>groups().find(g=>/自动选择/.test(g.name))??groups()[0]??null;
 const currentGroup=()=>groups().find(g=>g.name===group)??autoGroup();
 function delayInfo(node) {
  const known=Object.hasOwn(nodeDelays,node.name),value=known?nodeDelays[node.name]:node.delay;
  if(value===0||(value===null&&known))return {kind:'bad',text:'已超时'};
  if(Number.isFinite(value))return {kind:value<150?'good':value<400?'warm':'bad',text:`${value} ms`};
  return {kind:'neutral',text:'未测速'};
 }
 function usageBlock(s) {
  const u=s.userInfo;
  if(!u||!Number.isFinite(u.total)||!Number.isFinite(u.used)||u.total<=0)return '';
  const pct=Math.min(100,Math.round(u.used/u.total*100));
  const left=Math.max(0,u.total-u.used);
  const expire=u.expire?fmtExpire(u.expire):'';
  return `<div class="usage" role="figure" aria-label="流量额度">
   <div class="usage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span class="usage-fill ${pct>=90?'hot':pct>=70?'warm':''}" style="width:${pct}%"></span></div>
   <p class="usage-text">已用 ${fmtBytes(u.used)} / ${fmtBytes(u.total)} · 剩余 ${fmtBytes(left)} · ${pct}%</p>${expire?`<p class="usage-text">${expire} 到期</p>`:''}
  </div>`;
 }
 // wide：跨满整行。主卡（订阅、当前节点）用满宽度，副卡两两并排。
 const card=(title,body,{footer='',wide=false}={})=>`<article class="card${wide?' wide':''}"><h2 class="card-title">${title}</h2>${body}${footer?`<div class="card-foot">${footer}</div>`:''}</article>`;
 const kv=(key,value)=>`<div class="kv"><span class="k">${key}</span><span class="v">${value}</span></div>`;
 const subState=s=>s.updating?'更新中…':({pending:'等待更新',ready:`可用 · ${s.nodeCount} 个节点`,error:'更新失败'}[s.status]??'等待更新');
 // ── 概览：Verge 式信息卡。每张卡只讲一件事，数据全部来自 view / 插件命令 ──
 // 当前订阅：优先取「当前选中节点所属的那条」，取不到（选的是 DIRECT / 自动选择这类
 // 不是订阅节点）就落到第一条已启用。概览只讲这一条，其余订阅在订阅页管理。
 function activeSubscription(rows) {
  let name=groups()[0]?.name;
  for(let depth=0;depth<4&&name;depth++){
   const group=groups().find(g=>g.name===name);if(!group)break;
   const node=group.nodes.find(n=>n.name===group.selected);if(!node)break;
   if(node.sourceId){const hit=rows.find(s=>s.id===node.sourceId);if(hit)return hit}
   name=node.type==='group'?node.name:'';
  }
  return rows[0]??null;
 }
 function subscriptionCard() {
  const rows=(view.subscriptions??[]).filter(s=>s.enabled);
  if(!rows.length)return card('订阅','<p class="muted">还没有启用中的订阅。添加并更新后才能启动内核。</p>',
   {wide:true,footer:button('goto-providers','添加订阅','',false)});
  const current=activeSubscription(rows),others=rows.length-1;
  const update=button('update',current.updating?'更新中…':'更新订阅',`data-id="${esc(current.id)}"`,
   busy||current.updating||!view.configured||!!view.operation);
  return card('订阅',`<div class="sub-row">
   <div class="sub-head"><strong>${esc(current.name)}</strong><span class="tag ${current.status==='ready'?'on':'off'}">${subState(current)}</span></div>
   <p class="small muted">最近成功 ${when(current.lastSuccess)} · ${current.hasCache?'保有可用缓存':'尚无缓存'}</p>
   ${usageBlock(current)}
   ${current.error?`<p class="bad small" role="alert">${esc(current.error)}</p>`:''}
   ${others>0?`<p class="small muted">另有 ${others} 个已启用订阅，这里只显示当前节点所用的那条；切换在订阅页点卡片。</p>`:''}
  </div>`,{wide:true,footer:`${update}${button('goto-providers','管理订阅','',false)}`});
 }
 function currentNodeCard() {
  const list=groups();
  if(!list.length)return card('当前节点','<p class="muted">内核运行后显示代理组与可选节点。</p>',{wide:true});
  const current=currentGroup();
  const groupPicker=`<label>代理组<select id="group-pick" ${busy?'disabled':''}>${list.map(g=>
   `<option value="${esc(g.name)}" ${g.name===current?.name?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>`;
  const nodePicker=`<label>节点<select id="node-pick" ${busy||!view.running?'disabled':''}>${(current?.nodes??[]).map(n=>{
   const info=delayInfo(n);
   return `<option value="${esc(n.name)}" ${n.name===current.selected?'selected':''}>${esc(n.label??n.name)}${info.kind==='neutral'?'':` · ${info.text}`}</option>`;
  }).join('')}</select></label>`;
  const now=(current?.nodes??[]).find(n=>n.name===current.selected),info=now?delayInfo(now):{kind:'neutral',text:'—'};
  // 跨满整行：宽窗口下两个选择器并排，窄窗口自动回落到上下排列。
  // 测速放这里：节点页去掉之后，主界面就是唯一挑节点的地方。
  return card('当前节点',`<div class="split">${groupPicker}${nodePicker}</div>
   <p class="status-line">延迟 <span class="n-delay ${now&&now.type==='group'?'neutral':info.kind}">${now&&now.type==='group'?'代理组':info.text}</span></p>`,
   {wide:true,footer:button('node-test',nodeTesting?'测速中…':'测速',`aria-busy="${nodeTesting}"`,
    busy||nodeTesting||!view.running)});
 }
 function networkCard() {
  const system=view.systemProxy===true,tun=view.tun?.enable===true;
  const status=tun?'TUN 模式已启用：应用通过虚拟网卡访问网络。'
   :system?`系统代理已接管：浏览器等应用走 127.0.0.1:${view.mixedPort}。`
   :'未接管系统网络：只有内置代理端口可用，其他应用需要自行配置。';
  const tunNote=!view.tunService?.installed?' · 需先安装 TUN 服务':view.running?' · 切换会重启内核':'';
  return card('网络设置',`<div class="switch-row"><div><strong>系统代理</strong>
    <p class="small muted">${system?'已写入系统代理设置':'由 Dock 写入，停止内核时还原'}</p></div>
    ${button('proxy',system?'关闭':'开启',`role="switch" aria-checked="${system}"`,busy||(!view.running&&!system))}</div>
   <div class="switch-row"><div><strong>TUN 虚拟网卡</strong>
    <p class="small muted">${tun?'已启用':'未启用'}${tunNote}</p></div>
    ${button('tun-toggle',view.tunSwitching?'切换中…':tun?'关闭':'开启',`role="switch" aria-checked="${tun}"`,busy||view.tunSwitching||!view.configured||!view.tunService?.installed)}</div>
   <p class="status-line">${esc(status)}</p>`);
 }
 function modeCard() {
  const current=view.mode||'rule';
  const hint=MODES.find(m=>m[0]===current)?.[2]??'';
  const row=MODES.map(([key,label])=>button('mode-set',label,`data-mode="${key}" aria-pressed="${current===key}"`,
   busy||!view.running)).join('');
  return card('代理模式',`<div class="segmented">${row}</div><p class="status-line">${hint}</p>`);
 }
 function siteCard() {
  const list=sites?.sites,ok=list?list.filter(s=>s.ok).length:0;
  const body=list?list.map(s=>`<div class="site-row"><span>${esc(s.label)}</span>
    <span class="n-delay ${s.ok?'good':'bad'}">${s.ok?`${s.delay} ms`:'超时'}</span></div>`).join('')
   :['Apple','GitHub','Google','YouTube'].map(label=>`<div class="site-row"><span>${label}</span>
    <span class="muted">${sitesBusy?'测试中…':'未测试'}</span></div>`).join('');
  // 汇总一行：比逐个看色块更快判断「整条链路通不通」。
  const summary=list?`<p class="status-line">${ok} / ${list.length} 个站点可达</p>`
   :'<p class="status-line">经当前节点发起请求，避免直连测出假结果</p>';
  return card('网站测试',`${body}${summary}`,{footer:button('site-test',sitesBusy?'测试中…':'测试全部',
   `aria-busy="${sitesBusy}"`,busy||sitesBusy||!view.running)});
 }
 // 出口 IP 默认脱敏：整串地址等同于身份信息，点开才显示。
 const maskIp=value=>/^\d+\.\d+\.\d+\.\d+$/.test(String(value??''))
  ?String(value).replace(/\.\d+$/,'.***'):(value?'***':'—');
 function ipCard() {
  if(!view.running)return card('IP 信息','<p class="muted">内核运行后经当前代理查询出口 IP。</p>');
  if(ipError)return card('IP 信息',`<p class="bad" role="alert">${esc(ipError)}</p>`,
   {footer:button('ip-refresh','重试','',ipBusy)});
  if(!ip)return card('IP 信息',`<p class="muted">${ipBusy?'正在经代理查询出口 IP…':'尚未查询'}</p>`,
   {footer:button('ip-refresh','查询','',ipBusy)});
  if(ip.available===false)return card('IP 信息',`<p class="muted">${esc(ip.reason??'当前无法查询出口 IP')}</p>`,
   {footer:button('ip-refresh','重试','',ipBusy)});
  // Windows 不渲染国旗 emoji（会退化成 JP 这样的字母），所以用「国家 (代码)」。
  const country=esc(ip.country||'—'),code=/^[A-Za-z]{2}$/.test(ip.countryCode??'')?` (${esc(ip.countryCode.toUpperCase())})`:'';
  return card('IP 信息',`${kv('国家',`${country}${code}`)}
   ${kv('IP',`<code>${esc(ipReveal?ip.ip:maskIp(ip.ip))}</code> ${button('ip-reveal',ipReveal?'隐藏':'显示','',false)}`)}
   ${kv('ASN',esc(ip.asn||'—'))}${kv('服务商',esc(ip.isp||'—'))}
   ${kv('位置',esc(ip.location||'—'))}${kv('时区',esc(ip.timezone||'—'))}`,
   {footer:button('ip-refresh','刷新','',ipBusy)});
 }
 function clashCard() {
  return card('Clash 信息',`${kv('内核版本',esc(view.version||'—'))}
   ${kv('系统代理地址',`127.0.0.1:${esc(view.mixedPort)}`)}
   ${kv('混合代理端口',esc(view.mixedPort))}${kv('控制器端口',esc(view.controllerPort))}
   ${kv('运行时间',esc(fmtUptime(view.uptimeMs)))}
   ${kv('规则数量',Number.isFinite(view.rulesCount)?`${view.rulesCount} 条`:'—')}`);
 }
 function systemCard() {
  // 系统信息一次给全：之前只有操作系统/运行模式/页面版本三行，看着像没读到。
  const rows=[['操作系统',`${esc(view.os||'—')}${view.arch?` · ${esc(view.arch)}`:''}`]];
  if(view.cpu)rows.push(['处理器',esc(view.cpu)]);
  if(Number.isFinite(view.memoryTotal))rows.push(['内存',fmtBytes(view.memoryTotal)]);
  rows.push(['运行模式',view.tun?.enable?'TUN / 服务模式':'普通模式']);
  rows.push(['内核来源',view.bundled?'内置 mihomo':'自定义路径']);
  if(view.pluginVersion)rows.push(['插件版本',`v${esc(view.pluginVersion)}`]);
  return card('系统信息',rows.map(([key,value])=>kv(key,value)).join(''));
 }
 function overviewSection() {
  return `<div class="cards">${subscriptionCard()}${currentNodeCard()}${networkCard()}${modeCard()}
   ${siteCard()}${ipCard()}${clashCard()}${systemCard()}</div>`;
 }
 // 手动测速过的节点优先用页面上的值：内核自己测速要等它下一轮健康检查。
 
 // ── 订阅管理：运行中不再沉默禁用，而是说明原因并给出停止入口 ──
 function providersSection() {
  const rows=view.subscriptions??[],running=!!view.running;
  const banner=running?`<div class="banner" data-banner="kernel-running" role="status">
   <p>内核运行中：添加、编辑或删除订阅前请先停止内核。${button('stop-inline','停止内核','',busy)}</p></div>`:'';
  const empty=rows.length===0?`<div class="empty-card"><p><strong>还没有订阅。</strong></p>
   <p class="muted">填好下面的「名称」和「订阅地址」后点「保存订阅」，然后点该订阅卡上的「更新」下载并校验节点。校验通过前不会启动内核。</p></div>`:'';
  const field=(id,label,input,error)=>`<label for="${id}">${label}${input}${error?`<p class="field-error" role="alert">${esc(error)}</p>`:''}</label>`;
  const nameInput=`<input id="subscription-name" name="name" maxlength="80" required aria-label="订阅名称" value="${esc(draft.name)}" placeholder="例如：机场A" aria-invalid="${!!fieldErrors.name}" ${locked()?'disabled':''}>`;
  const urlInput=`<input id="subscription-url" name="url" type="password" autocomplete="off" spellcheck="false" aria-label="HTTPS 订阅地址" value="${esc(draft.url)}" placeholder="${draft.id?'留空保持原地址':'https://…'}" aria-invalid="${!!fieldErrors.url}" ${draft.id?'':'required'} ${locked()?'disabled':''}>`;
  return `<h2>订阅管理</h2><p class="muted">点订阅卡片即启用或停用，启用中的卡片会高亮；新增后点「更新」校验，通过后才能启动内核。</p>
   ${banner}${empty}
   ${button('reload','更新全部已启用订阅','',busy||!view.configured||!rows.some(s=>s.enabled)||!!view.operation)}
   <div class="subscriptions">${rows.map(s=>`<article class="subscription" data-sub="${esc(s.id)}" role="switch" aria-checked="${s.enabled}" tabindex="${locked()?-1:0}" aria-label="${esc(s.name)}：${s.enabled?'已启用':'已停用'}">
    <div class="subscription-title"><strong>${esc(s.name)}</strong><span class="tag ${s.enabled?'on':'off'}">${s.enabled?'已启用':'已停用'}</span></div>
    <p class="sub-state ${s.status==='error'?'bad':s.status==='ready'?'good':'muted'}" role="status">${s.updating?'更新中…':{pending:'等待更新',ready:'缓存可用',error:'更新失败'}[s.status]||'等待更新'} · ${s.nodeCount} 个节点</p>
    <p class="muted small">最近尝试：${when(s.lastAttempt)} · 最近成功：${when(s.lastSuccess)}</p>
   ${usageBlock(s)}
    ${s.error?`<p class="bad" role="alert">${esc(s.error)}</p>`:''}
    ${!s.hasCache&&s.status==='pending'?`<p class="muted small">还没下载过节点：点下面的「更新」。</p>`:''}
    <div class="toolbar">${button('update','更新',`data-id="${esc(s.id)}"`,busy||s.updating||!view.configured||!!view.operation)}
    ${button('edit','编辑',`data-id="${esc(s.id)}"`,locked())}
    ${button('delete','删除',`data-id="${esc(s.id)}"`,locked())}</div>
    ${confirmDelete===s.id?`<div class="confirm-bar" role="alert"><p>删除此订阅和本地节点缓存？其他订阅保持原状态。</p>${button('confirm-delete','确认删除',`data-id="${esc(s.id)}"`,locked())}${button('cancel-delete','取消')}</div>`:''}
    <p class="sub-hint">${locked()?'内核运行中：先停止内核再切换订阅':'点卡片切换'}</p>
   </article>`).join('')}</div>
   <form id="subscription-form"><h3>${draft.id?'编辑订阅':'添加订阅'}</h3>
    ${field('subscription-name','名称',nameInput,fieldErrors.name)}
    ${field('subscription-url','HTTPS 订阅地址',urlInput,fieldErrors.url)}
    ${button('save-subscription',busy?'正在保存…':'保存订阅','',locked())}${draft.id?button('cancel-edit','取消编辑'):''}
    <p class="muted small">地址加密保存且不回显。支持 mihomo 可读取的代理 YAML/JSON；网页、登录页与普通分享链接不等于订阅。</p>
   </form>`;
 }
 function tunServiceBlock() {
  const svc=view.tunService;
  if(!svc)return '<p class="muted">当前环境不支持 TUN 服务模式。</p>';
  const stateText=!svc.installed?'未安装':svc.state==='running'?'已安装 · 运行中':svc.state==='stopped'?'已安装 · 已停止':'已安装 · 状态未知';
  return `<div class="tun-service"><p role="status">服务状态：${esc(stateText)}${svc.kernel?' · 绑定内核 '+esc(String(svc.kernel).split(/[\\\\/]/).pop()):''}</p>
   ${svc.log?`<pre class="svc-log">${esc(svc.log)}</pre>`:''}
   ${confirmTun==='install'?`<div class="confirm-bar"><p>将请求管理员权限安装 TUN 服务（只需一次）。继续？</p>${button('tun-install-yes','继续安装')}${button('tun-cancel','取消')}</div>`:''}
   ${confirmTun==='uninstall'?`<div class="confirm-bar"><p>卸载后 TUN 将不可用，需重新安装才能再用。继续？</p>${button('tun-uninstall-yes','确认卸载')}${button('tun-cancel','取消')}</div>`:''}
   <div class="toolbar">${button('tun-install',svc.installed?'重新安装服务':'安装 TUN 服务','',locked())}
   ${svc.installed?button('tun-uninstall','卸载服务','',locked()):''}
   ${button('tun-refresh','刷新状态')}</div></div>`;
 }
 // ── 内核设置：独立页签，不再当每页最底下的折叠条 ──
 function settingsSection() {
  const cfg=configDraft||view;
  return `<h2>内核设置</h2><form id="config">
   <label>mihomo 可执行文件<input id="kernel" name="kernel" value="${esc(cfg.kernel)}" required ${locked()?'disabled':''}></label>
   <div class="columns"><label>混合代理端口<input id="mixedPort" name="mixedPort" type="number" min="1024" max="65535" value="${esc(cfg.mixedPort)}" required ${locked()?'disabled':''}></label>
   <label>控制器端口<input id="controllerPort" name="controllerPort" type="number" min="1024" max="65535" value="${esc(cfg.controllerPort)}" required ${locked()?'disabled':''}></label></div>
   <fieldset class="tun-box"><legend>TUN 模式</legend>
   <label class="check"><input id="tunEnable" name="tunEnable" type="checkbox" ${cfg.tun?.enable?'checked':''} ${locked()?'disabled':''}> 启用 TUN（由 SYSTEM 服务托管，普通权限即可用）</label>
   <label>栈<select id="tunStack" name="tunStack" ${locked()?'disabled':''}>${['mixed','gvisor','system'].map(s=>`<option value="${s}" ${(cfg.tun?.stack||'mixed')===s?'selected':''}>${s}</option>`).join('')}</select></label>
   ${cfg.tun?.enable&&!view.tunService?.installed?'<p class="bad" role="alert">TUN 已勾选但服务未安装，启动内核会被拒绝。请先安装 TUN 服务。</p>':''}
   ${tunServiceBlock()}
   </fieldset>
   <div class="save-bar">${button('save-config','保存内核配置','',locked())}</div></form>`;
 }
 function feedbackBlock() {
  const parts=[];
  if(busy)parts.push('<p class="banner" role="status">正在执行…</p>');
  if(error||view.error)parts.push(`<p class="banner bad" role="alert">${esc(error||view.error)}</p>`);
  else if(notice)parts.push(`<p class="banner ${noticeKind==='ok'?'good':''}" role="status">${esc(notice)}</p>`);
  if(view.legacyPending&&!view.subscriptions?.length)
   parts.push('<p class="banner" role="status">检测到格式未识别的旧版单订阅资料。原数据已保留；可在下方重新添加订阅地址。</p>');
  return parts.join('');
 }
 // 与后端一致的就地校验：文案复用后端固定提示，避免两套说法。
 function validateSubscription(values) {
  const errors={},name=String(values.name??'').trim();
  if(!name||name.length>80||/[\x00-\x1f\x7f]/.test(name)||/https?:\/\/|token\s*=/i.test(name))
   errors.name='请输入 1–80 字的订阅名称，不要包含地址或凭据';
  const raw=String(values.url??'').trim();
  if(draft.id&&!raw)return errors;
  if(!raw)errors.url='请输入 HTTPS 订阅地址';
  else{
   let url=null;try{url=new URL(raw)}catch{url=null}
   if(!url||!/^https?:$/.test(url.protocol))errors.url='订阅地址必须以 http:// 或 https:// 开头';
   else if(url.username||url.password)errors.url='订阅地址不要包含用户名和密码';
  }
  return errors;
 }
 function saveSubscription() {
  if(locked())return false;
  const form=root.querySelector('#subscription-form');
  if(!form)return false;
  const data=new FormData(form);
  draft={...draft,name:String(data.get('name')??''),url:String(data.get('url')??'')};
  fieldErrors=validateSubscription(draft);
  if(Object.keys(fieldErrors).length){draw();return false}
  return run('subscriptionSave',{...draft});
 }
 function saveConfig() {
  if(locked())return false;
  const form=root.querySelector('#config');
  if(!form||form.reportValidity?.()===false)return false;
  const data=new FormData(form);
  const tunEnable=root.querySelector('#tunEnable');
  return run('save',{kernel:data.get('kernel'),mixedPort:Number(data.get('mixedPort')),
   controllerPort:Number(data.get('controllerPort')),tun:{enable:tunEnable?.checked===true,stack:String(data.get('tunStack')||'mixed')}});
 }
 function toggleTun() {
  // 运行中也能切：后端把内核停掉、写配置、再按新设置拉起来（TUN 由 SYSTEM 服务托管，
  // 普通模式由插件自己 spawn，两者抢同一个控制器端口，必须重启内核才能换）。整段在后端
  // 后台跑，这里只负责发出去，进度靠 view.tunSwitching 轮询回来。
  if(busy||view.operation||view.tunSwitching)return false;
  return run('tunSwitch',{enable:!(view.tun?.enable===true)});
 }
 async function testNodes() {
  // 手动测速：只测当前组，结果按节点名合并进 nodeDelays，页面立即按新值排序/着色。
  if(nodeTesting||busy||!view.running)return;
  nodeTesting=true;draw();
  try{
   const result=await FishDock.call('clash.nodeTest',{group:currentGroup()?.name??''});
   for(const row of result?.delays??[])nodeDelays[row.name]=row.delay;
  }catch(e){error=`节点测速失败：${reason(e)}`}
  finally{nodeTesting=false;draw()}
 }
 async function loadIp(refresh=false) {
  if(ipBusy)return;
  ipBusy=true;ipAsked=true;ipError='';if(refresh)ip=null;draw();
  try{const next=await FishDock.call('clash.ipInfo',{refresh});ip=next??null}
  catch(e){ip=null;ipError=`查询出口 IP 失败：${reason(e)}`}
  finally{ipBusy=false;draw()}
 }
 async function testSites() {
  if(sitesBusy||busy)return;
  sitesBusy=true;draw();
  try{sites=await FishDock.call('clash.siteTest')}
  catch(e){sites=null;error=`网站测试失败：${reason(e)}`}
  finally{sitesBusy=false;draw()}
 }
 function bindSave(form,save) {
  // Dock 普通插件页仅有 allow-scripts；不依赖原生 submit。
  // 保留 submit 处理器便于独立浏览器使用，回车显式转入同一 RPC 路径。
  form.onsubmit=e=>{e.preventDefault();return save()};
  form.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.target?.tagName==='INPUT'){e.preventDefault();return save()}};
 }
 function draw() {
  // 内核运行时每 1.2 秒轮询重绘一次，而重绘会整块换掉 DOM。原生 <select> 的展开
  // 列表挂在这个元素上，元素一换就没了——表现就是「点一下很快消失」，节点根本选
  // 不了。所以焦点停在下拉框上时先不重绘，等它收起（focusout）再补。
  if(document.activeElement?.tagName==='SELECT'){staleDraw=true;return}
  // 用户滚到一半时不重绘：轮询重绘会整块换掉 DOM，滚动直接被打断。
  if(scrollAt&&Date.now()-scrollAt<1200){staleDraw=true;return}
  staleDraw=false;
  const active=document.activeElement,focus=active?.id;
  const caret=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
  // 内容区与顶部按钮行同样是「重建后要放回滚动位置」的容器。
  const pane=root.querySelector('#pane'),bar=root.querySelector('#headbar');
  const keepScroll={paneTop:pane?.scrollTop??0,barLeft:bar?.scrollLeft??0};
  if(!view){root.innerHTML=`<h1>Clash</h1><p role="status">${busy?'正在读取内核状态…':esc(error||'尚未读取状态')}</p>${button('view','重试')}`;bind();return}
  if(!groups().some(g=>g.name===group))group=autoGroup()?.name??'';
  const nav=SECTIONS.map(([key,label])=>button(`section-${key}`,label,`aria-pressed="${section===key}"`,false)).join('');
  const body=section==='overview'?overviewSection():section==='providers'?providersSection():settingsSection();
  // 页签、启停、刷新挤在同一行（窄了就横向滚，不折到第二行）；
  // 内容区统一一个内滚高度，各页签的高度一致，不会把宿主面板顶长。
  const toggle=button(view.running||view.operation==='starting'||updating()?'stop':'start',
   view.operation==='starting'?'取消启动':view.operation==='stopping'?'正在停止…':view.running?'停止内核':updating()?'取消更新':'启动内核','',
   busy||view.operation==='stopping');
  root.innerHTML=`<header><div><h1>Clash</h1><span class="muted">${view.running?'内核运行中':'内核已停止'}${view.version?' · 内核 '+esc(view.version):''}${view.pluginVersion?' · 插件 v'+esc(view.pluginVersion):''}</span></div></header>
   ${feedbackBlock()}
   <div class="toolbar headbar" id="headbar" aria-label="页面分区与内核操作">${nav}${toggle}${button('view','刷新')}</div>
   <section class="pane${section==='overview'?' plain':''}" id="pane">${body}</section>`;
  bind();
  // 内核设置只在它自己的页签里存在；表单草稿仍跨页保留。
  const form=root.querySelector('#config');
  if(form){
   form.oninput=()=>{const data=new FormData(form);configDraft={kernel:data.get('kernel'),mixedPort:data.get('mixedPort'),controllerPort:data.get('controllerPort'),tun:{enable:data.has('tunEnable'),stack:String(data.get('tunStack')||'mixed')}}};
   bindSave(form,saveConfig);
  }
  const subscriptionForm=root.querySelector('#subscription-form');
  if(subscriptionForm){
   subscriptionForm.oninput=()=>{const data=new FormData(subscriptionForm);draft={...draft,name:data.get('name'),url:data.get('url')};fieldErrors={}};
   bindSave(subscriptionForm,saveSubscription);
  }
  const groupPicker=root.querySelector('#group-pick');
  if(groupPicker){groupPicker.onchange=e=>{group=e.target.value;draw()};groupPicker.onblur=()=>{if(staleDraw)draw()}}
  const nodePicker=root.querySelector('#node-pick');
  if(nodePicker){
   nodePicker.onchange=e=>{const current=currentGroup();if(current)run('select',{group:current.name,name:e.target.value})};
   // 下拉收起后，把因展开而推迟的那次重绘补上。
   nodePicker.onblur=()=>{if(staleDraw)draw()};
  }
  if(focus){const next=root.querySelector(`#${focus}`);next?.focus();if(caret&&next?.setSelectionRange)next.setSelectionRange(...caret)}
  // 滚动位置在重建后放回去；重建后内容可能变短，浏览器自己会夹到合法范围。
  const paneNow=root.querySelector('#pane'),barNow=root.querySelector('#headbar');
  if(paneNow&&keepScroll.paneTop)paneNow.scrollTop=keepScroll.paneTop;
  if(barNow&&keepScroll.barLeft)barNow.scrollLeft=keepScroll.barLeft;
  // 用户滚动期间不重绘，停下来 1.2 秒后补一次：整块换 DOM 会把手感打断成「一滑就被拉回」。
  if(paneNow)paneNow.onscroll=()=>{
   scrollAt=Date.now();
   clearTimeout(scrollTimer);
   scrollTimer=setTimeout(()=>{if(staleDraw)draw()},1200);
  };
 }
 function bind() {
  root.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
   const a=b.dataset.action,id=b.dataset.id;
   if(a==='save-subscription')return saveSubscription();
   if(a==='save-config')return saveConfig();
   if(a.startsWith('section-')){section=a.slice(8);draw();return}
   if(a==='goto-providers'){section='providers';draw();return}
   if(a==='node-test')return testNodes();
   if(a==='stop-inline')return run('stop');
   if(a==='proxy')return run('proxy',{enabled:!view.systemProxy});
   if(a==='tun-toggle')return toggleTun();
   if(a==='mode-set')return run('mode',{mode:b.dataset.mode});
   if(a==='site-test')return testSites();
   if(a==='ip-refresh')return loadIp(true);
   if(a==='ip-reveal'){ipReveal=!ipReveal;draw();return}
   if(a==='edit'){const s=view.subscriptions.find(s=>s.id===id);draft={id,name:s.name,url:''};fieldErrors={};draw();return}
   if(a==='cancel-edit'){draft={id:'',name:'',url:''};fieldErrors={};draw();return}
   if(a==='delete'){confirmDelete=id;draw();return}
   if(a==='cancel-delete'){confirmDelete='';draw();return}
   if(a==='confirm-delete'){confirmDelete='';if(draft.id===id)draft={id:'',name:'',url:''};return run('subscriptionRemove',{id})}
   if(a==='update')return run('reload',{id});
   if(a==='tun-install'){confirmTun='install';draw();return}
   if(a==='tun-uninstall'){confirmTun='uninstall';draw();return}
   if(a==='tun-cancel'){confirmTun='';draw();return}
   if(a==='tun-install-yes'){confirmTun='';return run('installTunService')}
   if(a==='tun-uninstall-yes'){confirmTun='';return run('uninstallTunService')}
   if(a==='tun-refresh')return run('tunService');
   run(a);
  });
  // 订阅卡整张可点：启停走同一个 RPC，卡片上的按钮不触发切换。
  root.querySelectorAll('[data-sub]').forEach(card=>{
   card.onclick=event=>{
    if(event?.target?.closest?.('button,input,select,form,a'))return false;
    if(locked())return false;
    const row=view?.subscriptions?.find(s=>s.id===card.dataset.sub);
    if(!row)return false;
    return run('subscriptionToggle',{id:row.id,enabled:!row.enabled});
   };
   card.onkeydown=event=>{
    if(event?.key!=='Enter'&&event?.key!==' ')return false;
    event.preventDefault?.();
    return card.onclick(event);
   };
  });
  // 出口 IP 是一次性读取，加标记避免每次重绘都打一次 RPC。
  if(section==='overview'&&view?.running&&!ip&&!ipError&&!ipAsked)void loadIp();
 }
 window.addEventListener('pagehide',()=>clearTimeout(timer));
 run('view');
})();








