(() => {
 'use strict';
 const root=document.querySelector('#app');
 const popoverRoot=document.querySelector('#popover-root')||document.body||root;
 // 页签 + 启停/刷新共用顶部一行（#headbar）。内核设置是独立页签。
 const SECTIONS=[['overview','概览'],['providers','订阅'],['settings','内核设置']];
 const MODES=[['rule','规则','按规则分流：国内直连，其余走代理'],['global','全局','所有流量都走代理'],
  ['direct','直连','全部不走代理，等价于关闭分流']];
 const TUN_STACKS=['mixed','gvisor','system'];

 // ── 状态 ──
 let view=null,error='',notice='',noticeKind='info';
 let group='',section='overview',timer=null,revision=0;
 let draft={id:'',name:'',url:''},fieldErrors={},configDraft=null,confirmTun='';
 let activeSub='',pendingDelete=new Set(),undo=null;
 let nodeDelays={},nodeTesting=false;
 let ip=null,ipBusy=false,ipError='',ipReveal=false,ipAsked=false;
 let sites=null,sitesBusy=false;
 // H2 IME：组合输入期间挂起一切重绘（也挂起局部更新里的同一节点），compositionend 后补一次。
 let composing=false,pendingDraw=false;
 // H1 局部更新：轮询只改带 data-live 的读数节点；结构性变化才整块重绘。旧的「下拉/滚动期间暂停重绘」补丁已整段移除。
 let lastStructSig='',lastUpdatedAt=null,pollFails=0;
 // H3/H4 局部 busy + 取消：每个操作一条记录，含 AbortController、开始时刻与参数。
 const ops=new Map();
 let lastError=null; // {method,params}——错误横幅的「重试」重放它
 const updateSince={};

 // 设置 view 的唯一出口：整体替换视图时顺手把高亮校正到「真实启用项」。
 // 加载（首屏/刷新）、轮询、操作成功、操作回滚四条路径都走这里——只覆盖操作路径，
 // 首屏就会出现「标签写着已启用、卡片却没高亮」（t5 实测），以后每加一个入口还会再漏一次。
 function applyView(next){
  view=next??null;
  activeSub=(next?.subscriptions??[]).find(s=>s.enabled)?.id??'';
  return view;
 }

 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const updating=()=>view?.subscriptions?.some(s=>s.updating);
 // locked：必须停内核才能做的动作（订阅增删改、改内核设置、装/卸 TUN 服务），界面同步禁用，
 // 否则只是把错误延后到 RPC。订阅启用/停用不在其中——2.1.4 起运行中改启用集由内核就地热重载。
 const locked=()=>view?.running||!!view?.operation||updating()||!!view?.tunSwitching;
 // subEditLocked：启用集切换的闸门，只挡「启动/停止/订阅更新/切 TUN」这些中间态。
 const subEditLocked=()=>!!view?.operation||updating()||!!view?.tunSwitching;
 const switchingSub=id=>ops.has('sub:'+id);
 const anyOp=()=>ops.size>0;
 const opSince=key=>ops.get(key)?.since??0;
 const elapsed=since=>since?Math.max(0,Math.round((Date.now()-since)/1000)):'';
 const button=(action,text,extra='',disabled=false)=>`<button type="button" data-action="${action}" ${extra} ${disabled?'disabled':''}>${text}</button>`;
 const when=value=>value?esc(new Date(value).toLocaleString()):'—';
 const say=(text,kind='info')=>{notice=String(text||'');noticeKind=kind};
 const clock=ts=>{const d=new Date(ts);const p=n=>String(n).padStart(2,'0');return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`};

 // 错误呈现：只按错误码查固定文案，不再用中文正则猜后端提示。
 // 这份表与 shared/errors.mjs 的 errorMessages 逐条同源（page.test.mjs 会逐码比对两份表）。
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
  // 运行中换订阅：热重载失败时插件自己会重启一次内核；两次都失败才回滚启用集。
  SUBSCRIPTION_SWITCH_FAILED:'订阅切换没能生效：已回滚到原启用集；请刷新后重试，反复失败请打开插件日志查看原始错误码',
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
  // 插件协议层（d.sdk/宿主产生）：不要落到「未识别错误」。
  COMMAND_FAILED:'这次操作插件没能完成：请重试；仍失败请打开插件日志查看原因',
  NOT_ACTIVE:'插件尚未启用：回到插件页启用后重试',
  UNKNOWN_METHOD:'宿主与插件版本不匹配（页面要的方法插件没有）：请更新插件到 2.1.8 后重试',
  CAPABILITY_REQUIRED:'宿主与插件版本不匹配（插件没声明所需能力）：请更新插件到 2.1.8 后重试',
  BAD_HANDSHAKE:'插件没能与 Dock 完成握手：请重新安装该插件；仍失败请打开插件日志',
  HANDSHAKE_REQUIRED:'插件会话尚未就绪：请关闭并重新打开插件页面后重试',
  OPERATION_ERROR:'插件操作未完成：请刷新后重试；仍失败请打开插件日志查看原因'};
 // 宿主自己的两句话没有错误码，按原文折叠：15 秒 RPC 上限撞上时，用户看到的必须是
 // 「这次操作超过了宿主的上限」，而不是「未识别错误」（2.1.8 之前的测速就是这样）。
 const HOST_FOLD={'插件操作未完成，请检查配置后重试':ERROR_TEXT.OPERATION_ERROR,
  '插件响应超时':'这次操作超过了宿主的 15 秒上限（插件仍在运行）：请稍后重试；反复出现请减少启用的订阅节点数',
  '插件进程无响应（握手超时），已按未运行处理':'插件进程没有应答，已被宿主当作未运行：请回插件页重新启用后再试'};
 const reason=e=>{
  const code=typeof e?.code==='string'?e.code.trim():'';
  if(Object.hasOwn(ERROR_TEXT,code))return ERROR_TEXT[code];
  const m=typeof e?.message==='string'?e.message.trim():'';
  const translated=Object.keys(ERROR_TEXT).find(key=>ERROR_TEXT[key]===m);
  if(translated)return m;
  return Object.hasOwn(HOST_FOLD,m)?HOST_FOLD[m]:ERROR_TEXT.UNKNOWN_ERROR;
 };
 function methodLabel(method){
  return {view:'读取状态',save:'保存设置',subscriptionSave:'保存订阅',subscriptionToggle:'切换启用',
   subscriptionRemove:'删除订阅',reload:'更新订阅',start:'启动内核',stop:'停止内核',select:'切换节点',
   mode:'切换模式',proxy:'系统代理',details:'读取详情',tunService:'读取 TUN 状态',nodeTest:'节点测速',
   installTunService:'安装 TUN 服务',uninstallTunService:'卸载 TUN 服务',ipInfo:'查询出口 IP',siteTest:'网站测试',
   tunSwitch:'切换 TUN'}[method]??'操作';
 }

 // ── 下拉 listbox 纯逻辑（可单测） ──
 function moveActive(idx,len,delta){
  if(len<=0)return -1;
  if(idx<0||idx>=len)return delta>0?0:len-1;
  const next=idx+delta;
  return next<0?0:next>=len?len-1:next;
 }
 function resolveActive(active,len,key){
  if(len<=0)return -1;
  if(key==='Home')return 0;
  if(key==='End')return len-1;
  if(key==='ArrowDown')return moveActive(active,len,1);
  if(key==='ArrowUp')return moveActive(active,len,-1);
  return active;
 }
 function filterItems(items,q){
  const s=String(q??'').trim().toLowerCase();
  if(!s)return items;
  return items.filter(it=>String(it.label??'').toLowerCase().includes(s));
 }
 function typeAheadNext(items,fromIndex,buffer){
  const q=String(buffer??'').toLowerCase();
  if(!q||!items.length)return -1;
  const len=items.length,base=fromIndex<0?0:fromIndex;
  for(let k=1;k<=len;k++){const i=(base+k)%len;if(String(items[i].label??'').toLowerCase().startsWith(q))return i}
  return -1;
 }
 // 过滤输入框里：方向键/Home/End/Enter/Escape/Tab 归 listbox 处理；其余按键（可打印字符、退格等）
 // 一律交还原生 input，不 preventDefault、不跑 type-ahead——否则过滤框里打字会被吞、oninput 不触发。
 function keyRoute(target,key){
  const inFilter=!!(target&&target.closest&&target.closest('.lb-filter'));
  if(!inFilter)return 'list';
  return ['ArrowDown','ArrowUp','Home','End','Enter','Escape','Tab'].includes(key)?'list':'native';
 }
 // 组名/节点名常以 emoji 开头（🔵 微软服务、♻️ 自动选择、🇭🇰 香港 01）。emoji 的字形高度不受
 // font-size 约束，直接排在行里会把 .lb-option 撑到 40px 以上；这里把开头那串符号剥出来交给
 // .lb-ico 16px 盒，正文只留文字。整串都是符号（例如组名只叫「🚀」）时不动，别把标签清空。
 const ICON_RE=/^([\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]+)\s+/u;
 function splitIcon(label){
  const text=String(label??'');
  const m=ICON_RE.exec(text);
  return m?{icon:m[1],text:text.slice(m[0].length)}:{icon:'',text};
 }

 // ── 弹层（position:fixed 挂 body，不能被 .pane 的 overflow:auto 裁切） ──
 const LB={active:null};
 function closeListbox(restoreFocus){
  const cur=LB.active;if(!cur)return;
  LB.active=null;
  cur.trigger.setAttribute?.('aria-expanded','false');
  cur.pop.remove?.();
  document.removeEventListener?.('pointerdown',cur.onOutside,true);
  document.removeEventListener?.('keydown',cur.onKey,true);
  (window.removeEventListener||(()=>{}))('wheel',cur.onWheel,true);
  (window.removeEventListener||(()=>{}))('resize',cur.onResize,true);
  if(restoreFocus)cur.trigger.focus?.();
 }
 function openListbox(cfg){
  closeListbox(false);
  const trigger=cfg.trigger;
  trigger.setAttribute?.('aria-expanded','true');
  const pop=document.createElement('div');
  pop.className='listbox';pop.id=cfg.popupId;pop.setAttribute('role','listbox');
  pop.setAttribute('aria-label',cfg.ariaLabel||'选项');pop.tabIndex=-1;
  let query='',active=Math.max(0,cfg.selectedIndex??0),filtered=[];
  function paint(){
   filtered=filterItems(cfg.items,query);
   let html='';
   // 过滤输入：>12 项时给出；可打印键交还原生 input（见 keyRoute），过滤由下面的 oninput 负责。
   if(cfg.items.length>12){html+=`<input class="lb-filter" type="text" role="textbox" aria-label="过滤选项" value="${esc(query)}" placeholder="输入以过滤">`}
   if(!filtered.length){html+='<div class="lb-empty" role="status">没有匹配的节点</div>'}
   else{let last=null;filtered.forEach((it,i)=>{
    if(it.group&&it.group!==last){last=it.group;html+=`<div class="lb-group" role="presentation">${esc(it.group)}</div>`}
    const sel=it.selected?'true':'false',d=it.delay,{icon,text}=splitIcon(it.label);
    // emoji 一律进 .lb-ico 16px 盒：字形再高也不撑高行（选中态「咋这么大」的根因）。
    const ico=`<span class="lb-ico" aria-hidden="true">${esc(icon)}</span>`;
    // 勾固定占住 16px 盒：勾出现/消失时文字不左右漂移，勾本身在 28px 行内垂直居中。
    const check=`<span class="check" aria-hidden="true">${it.selected?'✓':''}</span>`;
    const dot=d?`<span class="dot ${esc(d.kind)}" aria-hidden="true"></span>`:'';
    // 状态点跟着数字走（都靠右贴边），右侧读数不会被挤出去。
    const delayTxt=d?`<span class="lb-delay">${dot}${esc(d.kind==='neutral'?'—':d.text)}</span>`:'';
    html+=`<div class="lb-option" role="option" id="${esc(pop.id)}-opt-${i}" data-index="${i}" aria-selected="${sel}"${it.disabled?' aria-disabled="true"':''}${i===active?' data-active="true"':''}>${ico}${check}<span class="lb-label">${esc(text)}</span>${delayTxt}</div>`;
   })}
   pop.innerHTML=html;
   pop.querySelectorAll?.('[data-index]').forEach(el=>{
    el.onmousedown=e=>e.preventDefault?.();
    el.onclick=()=>choose(Number(el.dataset.index));
   });
   const f=pop.querySelector?.('.lb-filter');
   if(f){f.oninput=()=>{query=f.value;active=0;paint();const nf=pop.querySelector('.lb-filter');nf?.focus?.()};f.focus?.()}
   if(!cfg.items.length)pop.focus?.();
   if(filtered.length)pop.setAttribute?.('aria-activedescendant',`${pop.id}-opt-${active}`);
  }
  function choose(i){
   const it=filtered[i];if(!it||it.disabled)return;
   cfg.onSelect(it.value);closeListbox(true);
  }
  let buffer='',bufferAt=0;
  function key(e){
   const k=e.key;
   if(keyRoute(e.target,k)==='native')return; // 过滤框里的可打印字符交还原生 input
   if(k==='Escape'){e.preventDefault?.();closeListbox(true);return}
   if(k==='Tab'){closeListbox(false);return}
   if(k==='ArrowDown'||k==='ArrowUp'||k==='Home'||k==='End'){
    e.preventDefault?.();active=resolveActive(active,filtered.length,k);paint();
    pop.querySelector?.(`#${pop.id}-opt-${active}`)?.scrollIntoView?.({block:'nearest'});return;
   }
   if(k==='Enter'){e.preventDefault?.();choose(active);return}
   if(k.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    e.preventDefault?.();
    const now=Date.now();if(now-bufferAt>500)buffer='';buffer+=k;bufferAt=now;
    const idx=typeAheadNext(filtered,active,buffer);
    if(idx>=0){active=idx;paint();pop.querySelector?.(`#${pop.id}-opt-${active}`)?.scrollIntoView?.({block:'nearest'})}
   }
  }
  const onOutside=e=>{const t=e.target;if(!pop.contains?.(t)&&!trigger.contains?.(t))closeListbox(false)};
  // 弹层内滚列表不能收起弹层（2.1.3 回归：往下滑两下弹层就没了）。只有弹层外的滚轮才关闭；
  // .listbox 自带 overscroll-behavior:contain，滚动链不会继续传给外层页面。
  const onWheel=e=>{const t=e?.target;if(pop.contains?.(t))return;closeListbox(false)};
  const onResize=()=>closeListbox(false);
  LB.active={trigger,pop,onOutside,onKey:key,onWheel,onResize};
  popoverRoot.appendChild(pop);
  paint();
  // 定位：触发器的正下方，空间不足则向上翻。
  const r=trigger.getBoundingClientRect?.()??{left:0,bottom:0,top:0,width:0};
  const vh=(window.innerHeight||document.documentElement?.clientHeight||600);
  const height=Math.min(pop.scrollHeight||320,320);
  pop.style.position='fixed';
  pop.style.left=Math.round(r.left)+'px';
  pop.style.width=Math.round(r.width||280)+'px';
  pop.style.top=(r.bottom+4+height>vh&&r.top-4-height>0)?Math.round(r.top-4-height)+'px':Math.round(r.bottom+4)+'px';
  pop.focus?.();
  document.addEventListener?.('pointerdown',onOutside,true);
  document.addEventListener?.('keydown',key,true);
  (window.addEventListener||(()=>{}))('wheel',onWheel,true);
  (window.addEventListener||(()=>{}))('resize',onResize,true);
 }
 function mountCombo(id,cfg){
  const trigger=root.querySelector?.(`#${id}`);
  if(!trigger)return;
  trigger.onclick=()=>{if(LB.active&&LB.active.trigger===trigger)closeListbox(true);else openListbox({...cfg,trigger})};
  trigger.onkeydown=e=>{
   if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){e.preventDefault?.();openListbox({...cfg,trigger})}
  };
 }

 // ── 运行 / 取消 / 乐观更新 ──
 function raceAbort(promise,controller){
  if(controller.signal.aborted)return Promise.reject({__cancelled:true,code:'CANCELLED'});
  return new Promise((resolve,reject)=>{
   const onAbort=()=>reject({__cancelled:true,code:'CANCELLED'});
   controller.signal.addEventListener?.('abort',onAbort,{once:true});
   promise.then(v=>{controller.signal.removeEventListener?.('abort',onAbort);resolve(v)},
    e=>{controller.signal.removeEventListener?.('abort',onAbort);reject(e)});
  });
 }
 function cancelOp(key){
  const op=ops.get(key);if(!op)return false;
  op.cancelled=true;op.controller?.abort?.();
  say('已取消本次操作','ok');draw();
  return true;
 }
 function afterSuccess(method,params){
  lastError=null;
  if(method==='save'){configDraft=null;say('内核设置已保存','ok')}
  if(method==='subscriptionSave'){draft={id:'',name:'',url:''};fieldErrors={};say('订阅已保存。下一步点「更新」下载并校验节点。','ok')}
  if(method==='subscriptionToggle')say('启用状态已更新','ok');
  if(method==='subscriptionRemove')say('订阅已删除，其余订阅不受影响','ok');
  if(method==='reload')say('已开始更新，完成后显示节点数与结果','ok');
  if(method==='installTunService')say('TUN 服务已安装','ok');
  if(method==='uninstallTunService')say('TUN 服务已卸载','ok');
  if(method==='select'){sites=null;ip=null;ipAsked=false;ipError=''}
  if(method==='start'||method==='stop'){ip=null;ipAsked=false;ipError='';sites=null;nodeDelays={}}
 }
 const RETRYABLE=new Set(['view','save','subscriptionSave','reload','start','stop','select','mode','proxy',
  'tunService','installTunService','uninstallTunService','ipInfo','siteTest','nodeTest','tunSwitch']);
 async function run(method,params={},opts={}){
  const key=opts.key??method;
  if(ops.has(key))return false;
  const controller=new AbortController();
  ops.set(key,{controller,since:Date.now(),label:methodLabel(method),method,params});
  error='';say('');lastError=null;revision++;
  draw();schedule();
  try{
   const result=await FishDock.call(`clash.${method}`,params);
   applyView(result);afterSuccess(method,params);
   return true;
  }catch(e){
   if(e&&e.__cancelled){/* 取消不走错误横幅 */}
   else{error=`${methodLabel(method)}失败：${reason(e)}`;lastError=RETRYABLE.has(method)?{method,params}:null}
   return false;
  }finally{ops.delete(key);draw();schedule()}
 }
 // H7 乐观更新 + 失败回滚：先切 UI，RPC 失败则切回并给一行「未生效，已回到原状态」。
 async function optimistic(method,params,apply,revert,label){
  const key='opt:'+method;
  if(ops.has(key))return false;
  const controller=new AbortController();
  ops.set(key,{controller,since:Date.now(),label,method,params});
  const prev=view;apply();error='';say('');lastError=null;revision++;draw();
  try{const result=await FishDock.call(`clash.${method}`,params);applyView(result);return true}
  catch(e){revert?.();applyView(prev);error=`${label}失败：${reason(e)}；未生效，已回到原状态`;lastError=null;return false}
  finally{ops.delete(key);draw();schedule()}
 }

 function schedule(){
  clearTimeout(timer);
  if(view&&(view.running||updating()||view.operation||view.tunSwitching||anyOp()))timer=setTimeout(poll,1200);
 }
 async function poll(){
  if(polling||composing){if(composing)pendingDraw=true;schedule();return}
  polling=true;const requestedRevision=revision;
  try{
   const next=await FishDock.call('clash.view');
   if(requestedRevision===revision){
    applyView(next);lastUpdatedAt=Date.now();pollFails=0;
    // H1：结构性变化才整块重绘，否则只改进读数节点。
    if(structSig()!==lastStructSig)requestDraw();else updateLive();
   }
  }catch{
   if(requestedRevision===revision){pollFails++;if(pollFails>=3){updateLive()}else{updateLive()}}
  }
  finally{polling=false;schedule()}
 }
 let polling=false;
 function requestDraw(){if(composing){pendingDraw=true;return}draw()}

 // ── 数据格式化 ──
 const fmtBytes=v=>v>=1024**3?(v/1024**3).toFixed(2)+' GB':v>=1024**2?(v/1024**2).toFixed(1)+' MB':Math.round(v/1024)+' KB';
 const fmtExpire=unix=>{const d=new Date(unix*1000);return Number.isNaN(d.getTime())?'':d.toLocaleDateString()};
 function fmtUptime(ms){
  if(!Number.isFinite(ms)||ms<=0)return '—';
  const minutes=Math.floor(ms/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  if(days)return `${days} 天 ${hours} 小时`;
  if(hours)return `${hours} 小时 ${rest} 分`;
  return `${rest} 分`;
 }
 const groups=()=>view?.groups??[];
 const autoGroup=()=>groups().find(g=>/自动选择/.test(g.name))??groups()[0]??null;
 const currentGroup=()=>groups().find(g=>g.name===group)??autoGroup();
 const currentNode=()=>{const g=currentGroup();if(!g)return null;return (g.nodes??[]).find(n=>n.name===g.selected)??null};
 function delayInfo(node){
  if(!node)return {kind:'neutral',text:'—'};
  const known=Object.hasOwn(nodeDelays,node.name),value=known?nodeDelays[node.name]:node.delay;
  if(value===0||(value===null&&known))return {kind:'bad',text:'已超时'};
  if(Number.isFinite(value))return {kind:value<150?'good':value<400?'warm':'bad',text:`${value} ms`};
  return {kind:'neutral',text:'未测速'};
 }
 function nodeDelayView(){
  const n=currentNode();
  if(!n)return {kind:'neutral',text:'—',width:0,label:'—',isGroup:false};
  if(n.type==='group')return {kind:'neutral',text:'代理组',width:0,label:n.label??n.name,isGroup:true};
  const info=delayInfo(n);
  const raw=Object.hasOwn(nodeDelays,n.name)?nodeDelays[n.name]:n.delay;
  const width=Number.isFinite(raw)&&raw>0?Math.min(100,Math.round(raw/400*100)):0;
  return {kind:info.kind,text:info.text,width,label:n.label??n.name,isGroup:false};
 }

 // ── 渲染 ──
 function usageBlock(s){
  const u=s.userInfo;
  if(!u||!Number.isFinite(u.total)||!Number.isFinite(u.used)||u.total<=0)return '';
  const pct=Math.min(100,Math.round(u.used/u.total*100));
  const left=Math.max(0,u.total-u.used);
  const expire=u.expire?fmtExpire(u.expire):'';
  return `<div class="usage" role="figure" aria-label="流量额度">
   <div class="usage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span class="usage-fill ${pct>=90?'hot':pct>=70?'warm':''}" data-live="trafficbar" data-live-id="${esc(s.id)}" style="width:${pct}%"></span></div>
   <p class="usage-text" data-live="traffic" data-live-id="${esc(s.id)}">已用 ${fmtBytes(u.used)} / ${fmtBytes(u.total)} · 剩余 ${fmtBytes(left)} · ${pct}%</p>${expire?`<p class="usage-text">${expire} 到期</p>`:''}
  </div>`;
 }
 const card=(title,body,{footer='',wide=false}={})=>`<article class="card${wide?' wide':''}"><h2 class="card-title">${title}</h2>${body}${footer?`<div class="card-foot">${footer}</div>`:''}</article>`;
 const kv=(key,value)=>`<div class="kv"><span class="k">${key}</span><span class="v">${value}</span></div>`;
 const subState=s=>s.updating?`更新中 ${elapsed(updateSince[s.id])||0}s`:({pending:'等待更新',ready:`可用 · ${s.nodeCount} 个节点`,error:'更新失败'}[s.status]??'等待更新');
 function activeSubscription(rows){
  let name=groups()[0]?.name;
  for(let depth=0;depth<4&&name;depth++){
   const g=groups().find(x=>x.name===name);if(!g)break;
   const node=g.nodes.find(n=>n.name===g.selected);if(!node)break;
   if(node.sourceId){const hit=rows.find(s=>s.id===node.sourceId);if(hit)return hit}
   name=node.type==='group'?node.name:'';
  }
  return rows[0]??null;
 }
 // 收起箭头用内联 SVG（12×12、stroke:currentColor、flex:none）：文本字形「⌄」的基线随
 // 回退字体漂移，两个触发器会一高一低；盒子固定后只靠 align-items:center 对齐，不用 translateY 凑。
 const CHEV='<svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 function comboTrigger(id,label,text,delay,disabled,reasonText){
  const {icon,text:plain}=splitIcon(text);
  return `<div class="combo"><span class="combo-label">${label}</span>
   <button type="button" class="combo-trigger" id="${id}" role="combobox" aria-haspopup="listbox" aria-expanded="false"
    aria-controls="${id}-listbox" data-action="open-${id}" ${disabled?'disabled aria-disabled="true"':''} title="${esc(disabled?(reasonText||'不可用'):'')}">
    <span class="lb-ico" aria-hidden="true">${esc(icon)}</span><span class="trigger-text">${esc(plain)}</span>${delay!=null?`<span class="trigger-delay n-delay ${delay.kind}">${esc(delay.text)}</span>`:''}
    ${CHEV}</button>
   ${disabled&&reasonText?`<span class="reason">${esc(reasonText)}</span>`:''}</div>`;
 }
 function subscriptionCard(){
  const rows=(view.subscriptions??[]).filter(s=>s.enabled&&!pendingDelete.has(s.id));
  if(!rows.length)return card('订阅','<p class="muted">还没有启用中的订阅。添加并更新后才能启动内核。</p>',
   {wide:true,footer:button('goto-providers','添加订阅','',false)});
  const current=activeSubscription(rows),others=rows.length-1;
  const upd=ops.has('update:'+current.id)||current.updating;
  const update=button('update',upd?`更新中 ${elapsed(updateSince[current.id])||0}s`:'更新订阅',`data-id="${esc(current.id)}"`,
   locked()||upd||!view.configured||!!view.operation);
  return card('订阅',`<div class="sub-row">
   <div class="sub-head"><strong>${esc(current.name)}</strong><span class="tag ${current.status==='ready'?'on':'off'}">${subState(current)}</span></div>
   <p class="small muted">最近成功 ${when(current.lastSuccess)} · ${current.hasCache?'保有可用缓存':'尚无缓存'}</p>
   ${usageBlock(current)}
   ${current.error?`<p class="bad small" role="alert">${esc(current.error)}</p>`:''}
   ${others>0?`<p class="small muted">另有 ${others} 个已启用订阅，这里只显示当前节点所用的那条；切换在订阅页点卡片。</p>`:''}
  </div>`,{wide:true,footer:`${update}${button('goto-providers','管理订阅','',false)}`});
 }
 function currentNodeCard(){
  const list=groups();
  if(!list.length)return card('当前节点','<p class="muted">内核运行后显示代理组与可选节点。</p>',{wide:true});
  const current=currentGroup(),dv=nodeDelayView();
  const groupPicker=comboTrigger('group-pick','代理组',current?.name??'',null,anyOp()||ops.has('kernel'),'切换中，请稍候');
  const nodeDisabled=!view.running||ops.has('select');
  const nodePicker=comboTrigger('node-pick','节点',dv.label,dv,nodeDisabled,view.running?'切换中，请稍候':'内核运行后可选');
  return card('当前节点',`<div class="split">${groupPicker}${nodePicker}</div>
   <div class="readout-area" data-stale="${pollFails>=3?'true':'false'}">
    <div class="readout" aria-live="polite" aria-atomic="true">
     <span class="readout-label">当前节点延迟</span>
     <span class="readout-node" data-live="node">${esc(dv.label)}</span>
     <span class="readout-bar" aria-hidden="true"><span class="readout-fill ${dv.kind}" data-live="delaybar" style="width:${dv.width}%"></span></span>
     <span class="n-delay ${dv.kind}" data-live="delay">${esc(dv.text)}</span>
    </div>
    <p class="stamp ${pollFails>=3?'stale':''}"><span data-live="stamp">${pollFails>=3?'数据已停止更新':(lastUpdatedAt?'更新于 '+clock(lastUpdatedAt):'尚未更新')}</span> ${button('retry-view','重试',`class="retry-inline"${pollFails>=3?'':' hidden'}`,false)}</p>
   </div>`,
   {wide:true,footer:`${button('node-test',nodeTesting?'测速中…':'测速',`aria-busy="${nodeTesting}"`,anyOp()||nodeTesting||!view.running)}${nodeTesting?button('cancel-test','取消测速','',false):''}`});
 }
 function networkCard(){
  const system=view.systemProxy===true,tun=view.tun?.enable===true;
  const status=tun?'TUN 模式已启用：应用通过虚拟网卡访问网络。'
   :system?`系统代理已接管：浏览器等应用走 127.0.0.1:${view.mixedPort}。`
   :'未接管系统网络：只有内置代理端口可用，其他应用需要自行配置。';
  // 禁用原因是独立一行 muted 小字（同时进 title）：混进同一句会把「开启」胶囊压成竖排圆块。
  const proxyReason=!view.running&&!system?'内核未运行，无法接管系统代理':'';
  const tunReason=!view.configured?'先完成内核配置':!view.tunService?.installed?'需先安装 TUN 服务':'';
  const tunNote=view.tunService?.installed&&view.running?' · 切换会重启内核':'';
  return card('网络设置',`<div class="switch-row"><div><strong>系统代理</strong>
    <p class="small muted">${system?'已写入系统代理设置':'由 Dock 写入，停止内核时还原'}</p></div>
    ${button('proxy',system?'关闭':'开启',`role="switch" aria-checked="${system}" title="${esc(proxyReason||'接管系统代理')}"`,anyOp()||(!view.running&&!system))}</div>
   ${proxyReason?`<p class="reason">${esc(proxyReason)}</p>`:''}
   <div class="switch-row"><div><strong>TUN 虚拟网卡</strong>
    <p class="small muted">${tun?'已启用':'未启用'}${tunNote}</p></div>
    ${button('tun-toggle',view.tunSwitching?'切换中…':tun?'关闭':'开启',`role="switch" aria-checked="${tun}" title="${esc(tunReason||'切换 TUN')}"`,anyOp()||view.tunSwitching||!view.configured||!view.tunService?.installed)}</div>
   ${tunReason?`<p class="reason">${esc(tunReason)}</p>`:''}
   <p class="status-line">${esc(status)}</p>`);
 }
 function modeCard(){
  const current=view.mode||'rule',hint=MODES.find(m=>m[0]===current)?.[2]??'';
  const row=MODES.map(([key,label])=>button('mode-set',label,`data-mode="${key}" aria-pressed="${current===key}"`,
   anyOp()||!view.running)).join('');
  return card('代理模式',`<div class="segmented">${row}</div><p class="status-line">${esc(hint)}</p>${!view.running?'<p class="reason">内核运行后可切换模式</p>':''}`);
 }
 function siteCard(){
  const list=sites?.sites,ok=list?list.filter(s=>s.ok).length:0;
  const body=list?list.map(s=>`<div class="site-row"><span>${esc(s.label)}</span>
    <span class="n-delay ${s.ok?'good':'bad'}">${s.ok?`${s.delay} ms`:'超时'}</span></div>`).join('')
   :['Apple','GitHub','Google','YouTube'].map(label=>`<div class="site-row"><span>${label}</span>
    <span class="muted">${sitesBusy?'测试中…':'未测试'}</span></div>`).join('');
  const summary=list?`<p class="status-line">${ok} / ${list.length} 个站点可达</p>`
   :'<p class="status-line">经当前节点发起请求，避免直连测出假结果</p>';
  return card('网站测试',`<div class="kv-list">${body}</div>${summary}`,{footer:button('site-test',sitesBusy?'测试中…':'测试全部',
   `aria-busy="${sitesBusy}"`,anyOp()||sitesBusy||!view.running)});
 }
 const maskIp=value=>/^\d+\.\d+\.\d+\.\d+$/.test(String(value??''))
  ?String(value).replace(/\.\d+$/,'.***'):(value?'***':'—');
 function ipCard(){
  if(!view.running)return card('IP 信息','<p class="muted">内核运行后经当前代理查询出口 IP。</p>');
  if(ipError)return card('IP 信息',`<p class="bad" role="alert">${esc(ipError)}</p>`,
   {footer:`${button('ip-refresh','重试','',anyOp())}`});
  if(!ip)return card('IP 信息',`<p class="muted">${ipBusy?'正在经代理查询出口 IP…':'尚未查询'}</p>`,
   {footer:`${ipBusy?button('ip-cancel','取消','',false):button('ip-refresh','查询','',false)}`});
  if(ip.available===false)return card('IP 信息',`<p class="muted">${esc(ip.reason??'当前无法查询出口 IP')}</p>`,
   {footer:`${button('ip-refresh','重试','',anyOp())}${ipBusy?button('ip-cancel','取消','',false):''}`});
  const country=esc(ip.country||'—'),code=/^[A-Za-z]{2}$/.test(ip.countryCode??'')?` (${esc(ip.countryCode.toUpperCase())})`:'';
  return card('IP 信息',`<div class="kv-list">${kv('国家',`${country}${code}`)}
   ${kv('IP',`<code>${esc(ipReveal?ip.ip:maskIp(ip.ip))}</code> ${button('ip-reveal',ipReveal?'隐藏':'显示','',false)}`)}
   ${kv('ASN',esc(ip.asn||'—'))}${kv('服务商',esc(ip.isp||'—'))}
   ${kv('位置',esc(ip.location||'—'))}${kv('时区',esc(ip.timezone||'—'))}</div>`,
   {footer:`${button('ip-refresh','刷新','',anyOp())}${anyOp()?button('ip-cancel','取消','',false):''}`});
 }
 function clashCard(){
  const addr=`127.0.0.1:${view.mixedPort}`;
  return card('Clash 信息',`<div class="kv-list">${kv('内核版本',esc(view.version||'—'))}
   ${kv('系统代理地址',`<code>${esc(addr)}</code>`)}
   ${kv('混合代理端口',`<code data-live="port">${esc(view.mixedPort)}</code>`)}
   ${kv('控制器端口',`<code data-live="cport">${esc(view.controllerPort)}</code>`)}
   ${kv('运行时间',`<span data-live="uptime">${esc(fmtUptime(view.uptimeMs))}</span>`)}
   ${kv('规则数量',`<span data-live="rules">${Number.isFinite(view.rulesCount)?`${view.rulesCount} 条`:'—'}</span>`)}</div>`);
 }
 function systemCard(){
  const rows=[['操作系统',`${esc(view.os||'—')}${view.arch?` · ${esc(view.arch)}`:''}`]];
  if(view.cpu)rows.push(['处理器',esc(view.cpu)]);
  if(Number.isFinite(view.memoryTotal))rows.push(['内存',fmtBytes(view.memoryTotal)]);
  rows.push(['运行模式',view.tun?.enable?'TUN / 服务模式':'普通模式']);
  rows.push(['内核来源',view.bundled?'内置 mihomo':'自定义路径']);
  if(view.pluginVersion)rows.push(['插件版本',`v${esc(view.pluginVersion)}`]);
  return card('系统信息',`<div class="kv-list">${rows.map(([key,value])=>kv(key,value)).join('')}</div>`);
 }
 function overviewSection(){
  return `<div class="cards">${subscriptionCard()}${currentNodeCard()}${networkCard()}${modeCard()}
   ${siteCard()}${ipCard()}${clashCard()}${systemCard()}</div>`;
 }
 function providersSection(){
  const rows=(view.subscriptions??[]).filter(s=>!pendingDelete.has(s.id)),running=!!view.running;
  const banner=running?`<div class="banner" data-banner="kernel-running" role="status">
   <p>内核运行中：添加、编辑或删除订阅前请先停止内核。${button('stop-inline','停止内核','',anyOp())}</p></div>`:'';
  const empty=rows.length===0?`<div class="empty-card"><p><strong>还没有订阅。</strong></p>
   <p class="muted">填好下面的「名称」和「订阅地址」后点「保存订阅」，然后点该订阅卡上的「更新」下载并校验节点。校验通过前不会启动内核。</p></div>`:'';
  const field=(id,label,input,error)=>`<label for="${id}">${label}${input}${error?`<p class="field-error" role="alert">${esc(error)}</p>`:''}</label>`;
  const nameInput=`<input id="subscription-name" name="name" maxlength="80" required aria-label="订阅名称" value="${esc(draft.name)}" placeholder="例如：机场A" aria-invalid="${!!fieldErrors.name}" ${locked()||ops.has('subscriptionSave')?'disabled':''}>`;
  const urlInput=`<input id="subscription-url" name="url" type="password" autocomplete="off" spellcheck="false" aria-label="HTTPS 订阅地址" value="${esc(draft.url)}" placeholder="${draft.id?'留空保持原地址':'https://…'}" aria-invalid="${!!fieldErrors.url}" ${draft.id?'':'required'} ${locked()||ops.has('subscriptionSave')?'disabled':''}>`;
  return `<h2>订阅管理</h2><p class="muted">点订阅卡片＝高亮并切换启用（内核运行中就地热重载，不重启）；卡内开关等价。新增后点「更新」校验，通过后才能启动内核。</p>
   ${banner}${empty}
   ${button('reload','更新全部已启用订阅','',anyOp()||!view.configured||!rows.some(s=>s.enabled)||!!view.operation)}
   <div class="subscriptions">${rows.map(s=>subscriptionRow(s)).join('')}</div>
   <form id="subscription-form"><h3>${draft.id?'编辑订阅':'添加订阅'}</h3>
    ${field('subscription-name','名称',nameInput,fieldErrors.name)}
    ${field('subscription-url','HTTPS 订阅地址',urlInput,fieldErrors.url)}
    ${button('save-subscription',ops.has('subscriptionSave')?'正在保存…':'保存订阅','',locked()||ops.has('subscriptionSave'))}${draft.id?button('cancel-edit','取消编辑'):''}
    <p class="muted small">地址加密保存且不回显。支持 mihomo 可读取的代理 YAML/JSON；网页、登录页与普通分享链接不等于订阅。</p>
   </form>`;
 }
 function subscriptionRow(s){
  const upd=s.updating||ops.has('update:'+s.id),switching=switchingSub(s.id);
  // 蓄意只挡中间态：运行中允许点卡片/开关热切换，不再整块置灰（2.1.3 的「运行中就锁死」已废弃）。
  const blocked=subEditLocked()||anyOp();
  const toggle=`<button type="button" data-action="toggle-sub" data-id="${esc(s.id)}" role="switch" aria-checked="${s.enabled}" aria-busy="${switching}" title="${switching?'正在热切换订阅':s.enabled?'点击停用此订阅':'点击启用此订阅'}" ${blocked?'disabled':''}>${switching?'切换中…':s.enabled?'已启用':'已停用'}</button>`;
  return `<article class="subscription" data-sub="${esc(s.id)}" data-active="${activeSub===s.id?'true':'false'}" aria-busy="${switching}" ${blocked?'aria-disabled="true"':''} tabindex="${blocked?-1:0}" aria-label="${esc(s.name)}">
   <div class="subscription-title"><strong>${esc(s.name)}</strong><span class="tag ${s.enabled?'on':'off'}">${s.enabled?'已启用':'已停用'}</span></div>
   <p class="sub-state ${s.status==='error'?'bad':s.status==='ready'?'good':'muted'}" role="status" data-live="substate" data-live-id="${esc(s.id)}">${s.updating?`更新中 ${elapsed(updateSince[s.id])||0}s`:({pending:'等待更新',ready:'缓存可用',error:'更新失败'}[s.status]||'等待更新')} · ${s.nodeCount} 个节点</p>
   <p class="muted small">最近尝试：${when(s.lastAttempt)} · 最近成功：${when(s.lastSuccess)}</p>
   ${usageBlock(s)}
   ${s.error?`<p class="bad" role="alert">${esc(s.error)}</p>`:''}
   ${!s.hasCache&&s.status==='pending'?`<p class="muted small">还没下载过节点：点下面的「更新」。</p>`:''}
   <div class="toolbar">${upd?button('cancel-update','取消更新',`data-id="${esc(s.id)}"`,false):button('update','更新',`data-id="${esc(s.id)}"`,locked()||!view.configured||!!view.operation)}
   ${toggle}
   ${button('edit','编辑',`data-id="${esc(s.id)}"`,locked())}
   ${button('delete','删除',`data-id="${esc(s.id)}"`,locked())}</div>
   <p class="sub-hint">${view.running?'内核运行中：点卡片即热切换订阅，内核就地重载、不重启；增删改订阅仍需先停止内核':'点卡片＝高亮并切换启用，同时只保留一条启用；卡内开关等价'}</p>
  </article>`;
 }
 function tunServiceBlock(){
  const svc=view.tunService;
  if(!svc)return '<p class="muted">当前环境不支持 TUN 服务模式。</p>';
  const stateText=!svc.installed?'未安装':svc.state==='running'?'已安装 · 运行中':svc.state==='stopped'?'已安装 · 已停止':'已安装 · 状态未知';
  return `<div class="tun-service"><p role="status">服务状态：${esc(stateText)}${svc.kernel?' · 绑定内核 '+esc(String(svc.kernel).split(/[\\\\/]/).pop()):''}</p>
   ${svc.log?`<pre class="svc-log">${esc(svc.log)}</pre>`:''}
   ${confirmTun==='install'?`<div class="confirm-bar" role="alertdialog"><p>将请求管理员权限安装 TUN 服务（只需一次）。继续？</p>${button('tun-install-yes','继续安装','data-focus',false)}${button('tun-cancel','取消')}</div>`:''}
   ${confirmTun==='uninstall'?`<div class="confirm-bar" role="alertdialog"><p>卸载后 TUN 将不可用，需重新安装才能再用。继续？</p>${button('tun-uninstall-yes','确认卸载','data-focus',false)}${button('tun-cancel','取消')}</div>`:''}
   <div class="toolbar">${button('tun-install',svc.installed?'重新安装服务':'安装 TUN 服务','',locked())}
   ${svc.installed?button('tun-uninstall','卸载服务','',locked()):''}
   ${button('tun-refresh','刷新状态')}</div></div>`;
 }
 function settingsSection(){
  const cfg=configDraft||view;
  const stack=cfg.tun?.stack||view.tun?.stack||'mixed';
  return `<h2>内核设置</h2><form id="config">
   <label>mihomo 可执行文件<input id="kernel" name="kernel" value="${esc(cfg.kernel)}" required ${locked()?'disabled':''}></label>
   <div class="columns"><label>混合代理端口<input id="mixedPort" name="mixedPort" type="number" min="1024" max="65535" value="${esc(cfg.mixedPort)}" required ${locked()?'disabled':''}></label>
   <label>控制器端口<input id="controllerPort" name="controllerPort" type="number" min="1024" max="65535" value="${esc(cfg.controllerPort)}" required ${locked()?'disabled':''}></label></div>
   <fieldset class="tun-box"><legend>TUN 模式</legend>
   <label class="check"><input id="tunEnable" name="tunEnable" type="checkbox" ${cfg.tun?.enable?'checked':''} ${locked()?'disabled':''}> 启用 TUN（由 SYSTEM 服务托管，普通权限即可用）</label>
   ${comboTrigger('tunStack','栈',stack,null,locked(),'内核运行中不可改')}
   ${cfg.tun?.enable&&!view.tunService?.installed?'<p class="bad" role="alert">TUN 已勾选但服务未安装，启动内核会被拒绝。请先安装 TUN 服务。</p>':''}
   ${tunServiceBlock()}
   </fieldset>
   <div class="save-bar">${button('save-config','保存内核配置','',locked()||ops.has('save'))}</div></form>`;
 }
 // H8 错误可重试：横幅带「重试」按钮，重放上一次 method+params。
 function feedbackBlock(){
  const parts=[];
  if(anyOp()&&!lastError){const op=[...ops.values()].find(o=>o.label);if(op)parts.push(`<p class="banner" role="status">正在执行：${esc(op.label)}${elapsed(op.since)!==''?` ${elapsed(op.since)} s`:''}</p>`)}
  if(error||view?.error){parts.push(`<p class="banner bad" role="alert">${esc(error||view.error)}${lastError?` ${button('retry','重试','',false)}`:''}</p>`)}
  else if(notice)parts.push(`<p class="banner ${noticeKind==='ok'?'good':''}" role="status">${esc(notice)}</p>`);
  if(view?.legacyPending&&!view.subscriptions?.length)
   parts.push('<p class="banner" role="status">检测到格式未识别的旧版单订阅资料。原数据已保留；可在下方重新添加订阅地址。</p>');
  return parts.join('');
 }
 function snackbarBlock(){
  if(!undo)return '';
  return `<div class="snackbar" role="status">已删除「${esc(undo.name)}」${button('undo-delete','撤销','',false)}<span class="reason">5 秒内可撤销，本地节点缓存将一并删除</span></div>`;
 }

 // ── 整块重绘（结构变化才走这里） ──
 function structSig(){
  if(!view)return 'null';
  const subs=(view.subscriptions??[]).filter(s=>!pendingDelete.has(s.id)).map(s=>[s.id,s.enabled,s.status,s.nodeCount,!!s.hasCache,!!s.updating,s.error?'e':''].join(':')).join('|');
  const gs=(view.groups??[]).map(g=>g.name+'='+g.selected+':'+g.nodes.map(n=>n.name).join(',')).join('|');
  const ipState=ip?(ip.available===false?'na':'have'):(ipError?'err':'none');
  return [section,view.running,view.operation,view.tunSwitching,view.configured,view.mode,!!view.systemProxy,
   view.tun?.enable,view.tun?.stack,view.tunService?.installed,view.tunService?.state,subs,gs,confirmTun,
   draft.id,activeSub,ipState,!!sites,anyOp(),nodeTesting].join('§');
 }
 function draw(){
  // H2：组合输入期间挂起重绘；compositionend 后补。
  if(composing){pendingDraw=true;return}
  // F2：整块重绘前先收弹层，避免重绘后弹层还挂在旧 trigger/旧 cfg 上。
  closeListbox(false);
  const active=document.activeElement,focus=active?.id;
  const caret=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
  const pane=root.querySelector('#pane');
  const keepTop=pane?.scrollTop??0;
  // 订阅卡更新计时：第一次看到 updating 记当前时刻，结束后清掉。
  for(const s of view?.subscriptions??[]){
   if(s.updating&&!updateSince[s.id])updateSince[s.id]=Date.now();
   if(!s.updating&&updateSince[s.id])delete updateSince[s.id];
  }
  if(!view){root.innerHTML=`<h1>Clash</h1><p role="status">${anyOp()?'正在读取内核状态…':esc(error||'尚未读取状态')}</p>${button('view','重试')}`;bind();return}
  if(!groups().some(g=>g.name===group))group=autoGroup()?.name??'';
  const nav=SECTIONS.map(([key,label])=>button(`section-${key}`,label,`aria-pressed="${section===key}"`,false)).join('');
  const body=section==='overview'?overviewSection():section==='providers'?providersSection():settingsSection();
  const toggle=button(view.running||view.operation==='starting'||updating()?'stop':'start',
   view.operation==='starting'?'取消启动':view.operation==='stopping'?'正在停止…':view.running?'停止内核':updating()?'取消更新':'启动内核','',
   ops.has('kernel')||view.operation==='stopping');
  root.innerHTML=`<header><div><h1>Clash</h1><span class="muted" data-live="state">${view.running?'内核运行中':'内核已停止'}${view.version?' · 内核 '+esc(view.version):''}${view.pluginVersion?' · 插件 v'+esc(view.pluginVersion):''}</span></div></header>
   ${feedbackBlock()}
   <div class="toolbar headbar" id="headbar" aria-label="页面分区与内核操作">${nav}${toggle}${button('view','刷新')}</div>
   <section class="pane${section==='overview'?' plain':''}${section==='settings'?' settings':''}" id="pane" aria-live="off">${body}</section>${snackbarBlock()}`;
  bind();
  const form=root.querySelector('#config');
  if(form){
   form.oninput=()=>{const d=new FormData(form);configDraft={kernel:d.get('kernel'),mixedPort:d.get('mixedPort'),controllerPort:d.get('controllerPort'),
    tun:{enable:root.querySelector('#tunEnable')?.checked===true,stack:configDraft?.tun?.stack??view.tun?.stack??'mixed'}}};
   bindSave(form,saveConfig);
  }
  const sf=root.querySelector('#subscription-form');
  if(sf){sf.oninput=()=>{const d=new FormData(sf);draft={...draft,name:d.get('name'),url:d.get('url')};fieldErrors={}};bindSave(sf,saveSubscription)}
  bindCombos();
  if(focus){const next=root.querySelector(`#${focus}`);next?.focus?.();if(caret&&next?.setSelectionRange)next.setSelectionRange(...caret)}
  const paneNow=root.querySelector('#pane');if(paneNow&&keepTop)paneNow.scrollTop=keepTop;
  lastStructSig=structSig();
 }
 function bindCombos(){
  const list=groups();
  if(list.length){
   mountCombo('group-pick',{popupId:'group-listbox',ariaLabel:'代理组',selectedIndex:Math.max(0,list.findIndex(g=>g.name===currentGroup()?.name)),
    items:list.map(g=>({value:g.name,label:g.name,selected:g.name===currentGroup()?.name})),
    onSelect:value=>{group=value;draw()}});
  }
  const cur=currentGroup();
  if(cur){
   const nodes=cur.nodes??[];
   mountCombo('node-pick',{popupId:'node-listbox',ariaLabel:'节点',selectedIndex:Math.max(0,nodes.findIndex(n=>n.name===cur.selected)),
    items:nodes.map(n=>({value:n.name,label:n.label??n.name,selected:n.name===cur.selected,delay:delayInfo(n),disabled:false})),
    onSelect:value=>{const g=currentGroup();if(g)run('select',{group:g.name,name:value})}});
  }
  mountCombo('tunStack',{popupId:'tunstack-listbox',ariaLabel:'TUN 栈',selectedIndex:Math.max(0,TUN_STACKS.indexOf((configDraft||view)?.tun?.stack||'mixed')),
   items:TUN_STACKS.map(s=>({value:s,label:s,selected:s===((configDraft||view)?.tun?.stack||'mixed')})),
   onSelect:value=>{configDraft={...(configDraft||{kernel:view.kernel,mixedPort:view.mixedPort,controllerPort:view.controllerPort,tun:{enable:view.tun?.enable===true,stack:view.tun?.stack||'mixed'}}),tun:{...((configDraft||view).tun||{}),stack:value}};draw()}});
 }
 // H1 局部更新：只改带 data-live 的读数节点，绝不重建 DOM。
 function updateLive(){
  if(composing||!view)return;
  const dv=nodeDelayView();
  const stamp=pollFails>=3?'数据已停止更新':(lastUpdatedAt?('更新于 '+clock(lastUpdatedAt)):'尚未更新');
  for(const el of root.querySelectorAll?.('[data-live]')??[]){
   const key=el.dataset?.live;
   if(key==='delay'){el.textContent=dv.text;el.className='n-delay '+dv.kind}
   else if(key==='delaybar'){el.className='readout-fill '+dv.kind;if(el.style)el.style.width=dv.width+'%'}
   else if(key==='node'){el.textContent=dv.label}
   else if(key==='uptime'){el.textContent=fmtUptime(view.uptimeMs)}
   else if(key==='rules'){el.textContent=Number.isFinite(view.rulesCount)?`${view.rulesCount} 条`:'—'}
   else if(key==='port'){el.textContent=String(view.mixedPort)}
   else if(key==='cport'){el.textContent=String(view.controllerPort)}
   else if(key==='stamp'){el.textContent=stamp}
   else if(key==='state'){el.textContent=`${view.running?'内核运行中':'内核已停止'}${view.version?' · 内核 '+view.version:''}${view.pluginVersion?' · 插件 v'+view.pluginVersion:''}`}
   else if(key==='traffic'){const s=(view.subscriptions??[]).find(x=>x.id===el.dataset?.liveId);if(s){const u=s.userInfo;if(u&&Number.isFinite(u.total)&&Number.isFinite(u.used)&&u.total>0){const pct=Math.min(100,Math.round(u.used/u.total*100)),left=Math.max(0,u.total-u.used);el.textContent=`已用 ${fmtBytes(u.used)} / ${fmtBytes(u.total)} · 剩余 ${fmtBytes(left)} · ${pct}%`}}}
   // F7：额度条宽度与 hot/warm 色随局部更新同步（此前轮询只更新文本，进度条是冻的）。
   else if(key==='trafficbar'){const s=(view.subscriptions??[]).find(x=>x.id===el.dataset?.liveId);if(s){const u=s.userInfo;if(u&&Number.isFinite(u.total)&&Number.isFinite(u.used)&&u.total>0){const pct=Math.min(100,Math.round(u.used/u.total*100));el.className='usage-fill'+(pct>=90?' hot':pct>=70?' warm':'');if(el.style)el.style.width=pct+'%'}}}
   else if(key==='substate'){const s=(view.subscriptions??[]).find(x=>x.id===el.dataset?.liveId);if(s){el.textContent=`${s.updating?`更新中 ${elapsed(updateSince[s.id])}s`:({pending:'等待更新',ready:'缓存可用',error:'更新失败'}[s.status]||'等待更新')} · ${s.nodeCount} 个节点`}}
  }
  const area=root.querySelector?.('.readout-area');if(area)area.setAttribute?.('data-stale',pollFails>=3?'true':'false');
  // F5：stale 时把「重试」按钮显出来（真按钮，data-action=retry-view→run('view')），不 stale 时隐藏。
  const rb=root.querySelector?.('.retry-inline');if(rb)rb.hidden=pollFails<3;
  const stampP=root.querySelector?.('.stamp');if(stampP&&stampP.classList)stampP.classList.toggle?.('stale',pollFails>=3);
 }

 // ── 表单与业务动作 ──
 function validateSubscription(values){
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
 function saveSubscription(){
  if(locked())return false;
  const form=root.querySelector('#subscription-form');if(!form)return false;
  const data=new FormData(form);
  draft={...draft,name:String(data.get('name')??''),url:String(data.get('url')??'')};
  fieldErrors=validateSubscription(draft);
  if(Object.keys(fieldErrors).length){draw();return false}
  return run('subscriptionSave',{...draft});
 }
 function saveConfig(){
  if(locked())return false;
  const form=root.querySelector('#config');
  if(!form||form.reportValidity?.()===false)return false;
  const data=new FormData(form);
  const tunEnable=root.querySelector('#tunEnable');
  const stack=(configDraft?.tun?.stack)||view.tun?.stack||'mixed';
  return run('save',{kernel:data.get('kernel'),mixedPort:Number(data.get('mixedPort')),
   controllerPort:Number(data.get('controllerPort')),tun:{enable:tunEnable?.checked===true,stack}});
 }
 function bindSave(form,save){
  form.onsubmit=e=>{e.preventDefault();return save()};
  form.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.target?.tagName==='INPUT'){e.preventDefault();return save()}};
 }
 // H4 长操作：测速 / 查出口 IP 有进度、耗时与取消；取消走 AbortController，取消后回到上一个稳定态。
 async function testNodes(){
  if(nodeTesting||anyOp()||!view.running)return;
  nodeTesting=true;say('');error='';draw();
  const controller=new AbortController();ops.set('testNodes',{controller,since:Date.now(),label:'节点测速'});
  try{
   const result=await raceAbort(FishDock.call('clash.nodeTest',{group:currentGroup()?.name??''}),controller);
   for(const row of result?.delays??[])nodeDelays[row.name]=row.delay;
  }catch(e){if(!(e&&e.__cancelled))error=`节点测速失败：${reason(e)}`}
  finally{nodeTesting=false;ops.delete('testNodes');draw();schedule()}
 }
 async function loadIp(refresh=false){
  if(ipBusy)return;
  ipBusy=true;ipAsked=true;ipError='';if(refresh)ip=null;draw();
  const controller=new AbortController();ops.set('ip',{controller,since:Date.now(),label:'查询出口 IP'});
  try{ip=await raceAbort(FishDock.call('clash.ipInfo',{refresh}),controller)??null;lastUpdatedAt=Date.now();pollFails=0}
  catch(e){if(!(e&&e.__cancelled)){ip=null;ipError=`查询出口 IP 失败：${reason(e)}`;lastError={method:'ipInfo',params:{refresh}}}}
  finally{ipBusy=false;ops.delete('ip');draw();schedule()}
 }
 async function testSites(){
  if(sitesBusy||anyOp())return;
  sitesBusy=true;draw();
  try{sites=await FishDock.call('clash.siteTest')}
  catch(e){sites=null;error=`网站测试失败：${reason(e)}`;lastError={method:'siteTest',params:{}}}
  finally{sitesBusy=false;draw();schedule()}
 }
 function toggleTun(){
  if(anyOp())return false;
  return optimistic('tunSwitch',{enable:!(view.tun?.enable===true)},()=>{view.tun={...(view.tun||{}),enable:!(view.tun?.enable===true)}},()=>{},'切换 TUN');
 }
 function changeMode(mode){
  if(anyOp())return false;
  const prev=view.mode;
  return optimistic('mode',{mode},()=>{view.mode=mode},()=>{view.mode=prev},'切换模式');
 }
 function setProxy(enabled){
  if(anyOp())return false;
  const prev=view.systemProxy;
  return optimistic('proxy',{enabled},()=>{view.systemProxy=enabled},()=>{view.systemProxy=prev},'系统代理');
 }
 async function toggleSub(id,next){
  const row=view?.subscriptions?.find(s=>s.id===id);
  if(!row||subEditLocked()||anyOp())return false;
  const want=typeof next==='boolean'?next:!row.enabled;
  const prevView=view,prevRows=view.subscriptions;
  ops.set('sub:'+id,{since:Date.now(),label:'切换订阅启用',method:'subscriptionToggle',params:{id,enabled:want}});
  // 乐观：先切 UI（高亮跟着启用项走），RPC 回来再以服务端视图为准；失败整块回滚。
  applyView({...view,subscriptions:prevRows.map(s=>s.id===id?{...s,enabled:want}:{...s,enabled:want?false:s.enabled})});
  error='';say('');lastError=null;revision++;draw();schedule();
  try{
   const result=await FishDock.call('clash.subscriptionToggle',{id,enabled:want});
   applyView(result);
   say(want?'已启用该订阅，内核已就地切换':'已停用该订阅','ok');
   return true;
  }catch(e){
   applyView(prevView);
   error=`切换订阅启用失败：${reason(e)}；未生效，已回到原状态`;lastError=null;
   return false;
  }finally{ops.delete('sub:'+id);draw();schedule()}
 }
 // 点卡＝高亮 + 切换启用（两个动作同一次点击）；拖动选文字/双击不触发（selection 非折叠即忽略）。
 function onCardClick(id,event){
  const sel=typeof window.getSelection==='function'?window.getSelection():null;
  if(sel&&sel.isCollapsed===false)return false;
  const row=view?.subscriptions?.find(s=>s.id===id);
  if(!row)return false;
  return toggleSub(id,!row.enabled);
 }
 // H6：删除先删后撤销——UI 立即移除，5 秒后真正落盘；撤销则取消落盘并恢复。
 function deleteSub(id){
  if(locked())return false;
  const row=view.subscriptions.find(s=>s.id===id);if(!row)return false;
  pendingDelete.add(id);
  if(draft.id===id)draft={id:'',name:'',url:''};
  // pendingDelete 只是 UI 过滤、view 没变（applyView 不会动高亮），这里显式清掉被删那条的高亮；
  // 真正落盘后由 applyView(commitDelete 的返回视图) 重新校正。
  if(activeSub===id)activeSub='';
  undo={id,name:row.name,timer:setTimeout(()=>commitDelete(id),5000)};
  say(`已删除「${row.name}」，5 秒内可撤销`,'ok');draw();return true;
 }
 function commitDelete(id){
  undo=null;
  run('subscriptionRemove',{id}).then(ok=>{pendingDelete.delete(id);if(!ok)draw()});
 }
 function undoDelete(){
  if(!undo)return;
  clearTimeout(undo.timer);
  const {id}=undo;undo=null;pendingDelete.delete(id);
  say('已撤销删除','ok');draw();
 }

 function bind(){
  root.querySelectorAll('[data-action]').forEach(b=>{b.onclick=()=>{
   const a=b.dataset.action,id=b.dataset.id;
   if(a==='save-subscription')return saveSubscription();
   if(a==='save-config')return saveConfig();
   if(a.startsWith('section-')){section=a.slice(8);draw();return}
   if(a==='goto-providers'){section='providers';draw();return}
   if(a==='node-test')return testNodes();
   if(a==='cancel-test'){cancelOp('testNodes');return}
   if(a==='ip-cancel'){cancelOp('ip');return}
   if(a==='stop-inline')return run('stop');
   if(a==='proxy')return setProxy(!view.systemProxy);
   if(a==='tun-toggle')return toggleTun();
   if(a==='mode-set')return changeMode(b.dataset.mode);
   if(a==='site-test')return testSites();
   if(a==='ip-refresh')return loadIp(true);
   if(a==='ip-reveal'){ipReveal=!ipReveal;draw();return}
   if(a==='edit'){const s=view.subscriptions.find(s=>s.id===id);draft={id,name:s.name,url:''};fieldErrors={};draw();return}
   if(a==='cancel-edit'){draft={id:'',name:'',url:''};fieldErrors={};draw();return}
   if(a==='delete')return deleteSub(id);
   if(a==='undo-delete')return undoDelete();
   if(a==='toggle-sub')return toggleSub(id);
   if(a==='cancel-update')return cancelUpdate(id);
   if(a==='update')return run('reload',{id},{key:'update:'+id});
   if(a==='reload')return run('reload',{});
   if(a==='retry-view')return run('view');
   if(a==='retry'){if(lastError){const {method,params}=lastError;return run(method,params,{key:method+':retry'})}return false}
   if(a==='tun-install'){confirmTun='install';draw();focusConfirm();return}
   if(a==='tun-uninstall'){confirmTun='uninstall';draw();focusConfirm();return}
   if(a==='tun-cancel'){confirmTun='';draw();return}
   if(a==='tun-install-yes'){confirmTun='';return run('installTunService')}
   if(a==='tun-uninstall-yes'){confirmTun='';return run('uninstallTunService')}
   if(a==='tun-refresh')return run('tunService');
   if(a==='start'||a==='stop')return run(a,{}, {key:'kernel'});
   if(a==='view')return run('view');
   return false;
  }});
  root.querySelectorAll('[data-sub]').forEach(card=>{
   card.onclick=event=>onCardClick(card.dataset.sub,event);
   card.onkeydown=event=>{if(event?.key!=='Enter'&&event?.key!==' ')return false;event.preventDefault?.();return onCardClick(card.dataset.sub);};
  });
  // 出口 IP 是一次性读取，加标记避免每次重绘都打一次 RPC。
  if(section==='overview'&&view?.running&&!ip&&!ipError&&!ipAsked)void loadIp();
 }
 function cancelUpdate(id){
  // 后端只提供 stop() 能中断订阅更新（会 abort 所有 job）；没有独立 cancel RPC。
  say('已取消更新，旧缓存仍保留','ok');
  return run('stop');
 }
 function focusConfirm(){
  const btn=root.querySelector('[data-focus]');
  if(btn)btn.focus?.();
 }

 // H2 IME 保护：组合期间挂起重绘，compositionend 后补一次。
 root.addEventListener?.('compositionstart',()=>{composing=true},true);
 root.addEventListener?.('compositionend',()=>{composing=false;if(pendingDraw){pendingDraw=false;draw()}else{draw()}},true);
 window.addEventListener?.('pagehide',()=>clearTimeout(timer));
 document.addEventListener?.('keydown',e=>{if(e.key==='Escape'&&confirmTun){confirmTun='';draw()}},true);

 // 供单测读取纯逻辑（仅测试上下文注入时挂载，生产不产生全局副作用）。
 if(typeof globalThis!=='undefined'&&typeof globalThis.__CLASH_TEST_HOOKS__==='function')
  globalThis.__CLASH_TEST_HOOKS__({moveActive,resolveActive,filterItems,typeAheadNext,nodeDelayView,keyRoute,splitIcon,run});

 run('view');
})();
