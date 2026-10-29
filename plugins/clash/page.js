(() => {
 const root=document.querySelector('#app');
 // 页面自身版本：用于区分「插件已升级」与「页面仍在跑旧缓存」。
 const UI_VERSION='1.4.0';
 const SECTIONS=[['overview','概览'],['nodes','节点'],['providers','订阅'],['rules','规则'],['connections','连接']];
 const MODES=[['rule','规则','按规则分流：国内直连，其余走代理'],['global','全局','所有流量都走代理'],
  ['direct','直连','全部不走代理，等价于关闭分流']];
 let view=null,busy=false,polling=false,error='',notice='',noticeKind='info';
 let group='',section='overview',detail=null,timer=null,revision=0;
 let draft={id:'',name:'',url:''},fieldErrors={},configDraft=null,settingsOpen=false,confirmDelete='',confirmTun='';
 // 节点浏览状态只影响渲染，不落盘：搜索、延迟排序、只看可用。
 let nodeQuery='',sortDelay=false,onlyAvailable=false;
 let autostart=null,autostartBusy=false;
 let ip=null,ipBusy=false,ipError='',ipReveal=false,ipAsked=false;
 let sites=null,sitesBusy=false;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const updating=()=>view?.subscriptions?.some(s=>s.updating);
 // 后端在运行中拒绝订阅与配置变更，界面必须同步禁用（否则只是把错误延后到 RPC）。
 const locked=()=>busy||view?.running||!!view?.operation||updating();
 const button=(action,text,extra='',disabled=busy)=>`<button type="button" data-action="${action}" ${extra} ${disabled?'disabled':''}>${text}</button>`;
 const when=value=>value?esc(new Date(value).toLocaleString()):'—';
 const say=(text,kind='info')=>{notice=String(text||'');noticeKind=kind};
 // 后端错误文案是固定中文提示，不含地址或凭据；只接受这类已知提示，
 // 其余异常（可能夹带 URL/token 的原始错误）一律折叠为通用说明。
 const KNOWN=[/订阅地址无效/,/订阅地址必须/,/订阅地址不要包含/,/请输入 1–80 字的订阅名称/,
  /请输入 HTTPS 订阅地址/,/最多保存 32 个订阅/,/订阅不存在，请刷新/,/订阅 ID 无效/,/订阅启用状态无效/,
  /订阅配置损坏，请从备份恢复/,/请先停止内核/,/请等待订阅更新完成/,/插件正在停用/,/请选择 mihomo 内核/,
  /请先配置 mihomo 内核/,/请先选择 mihomo 内核/,/端口应为 1024–65535/,/混合代理和控制器端口应不同/,
  /布局值无效/,/TUN 开关无效/,/当前环境不支持 TUN 服务模式/,/内核尚未启动/,/内核正在切换状态/,
  /请先更新已启用订阅/,/内核控制器尚未就绪/,/系统代理状态无效/,/请先启动内核/,/详情类别无效/,
  /mihomo 控制器请求失败/,/代理组或节点已变化/,/没有可用的代理节点/];
 const reason=e=>{
  const m=typeof e?.message==='string'?e.message.trim():'';
  const hit=KNOWN.find(r=>r.test(m));
  return hit?m:'请检查配置和运行状态后重试';
 };
 function methodLabel(method){
  return {view:'读取状态',save:'保存设置',subscriptionSave:'保存订阅',subscriptionToggle:'切换启用',
   subscriptionRemove:'删除订阅',reload:'更新订阅',start:'启动内核',stop:'停止内核',select:'切换节点',
   mode:'切换模式',proxy:'系统代理',layout:'切换布局',details:'读取详情',tunService:'读取 TUN 状态',
   installTunService:'安装 TUN 服务',uninstallTunService:'卸载 TUN 服务',ipInfo:'查询出口 IP',siteTest:'网站测试'}[method]??'操作';
 }
 async function run(method,params={}) {
  if(busy)return false;
  busy=true;revision++;error='';say('');draw();
  try {
   const result=await FishDock.call(`clash.${method}`,params);
   if(method==='details')detail=result;
   else {
    view=result;
    if(method==='save'){configDraft=null;say('内核设置已保存','ok')}
    if(method==='subscriptionSave'){draft={id:'',name:'',url:''};fieldErrors={};say('订阅已保存。下一步点「更新」下载并校验节点。','ok')}
    if(method==='subscriptionToggle')say('启用状态已更新','ok');
    if(method==='subscriptionRemove')say('订阅已删除，其余订阅不受影响','ok');
    if(method==='reload')say('已开始更新，完成后显示节点数与结果','ok');
    if(method==='installTunService')say('TUN 服务已安装','ok');
    if(method==='uninstallTunService')say('TUN 服务已卸载','ok');
    if(method==='select')sites=null;
    // 内核重启后出口 IP 会变，缓存不能沿用。
    if(method==='start'||method==='stop'){ip=null;ipAsked=false;ipError='';sites=null}
   }
   return true;
  }catch(e){error=`${methodLabel(method)}失败：${reason(e)}`;return false}
  finally{busy=false;draw();schedule();}
 }
 function schedule() {
  clearTimeout(timer);
  if(view&&(view.running||updating()||view.operation))timer=setTimeout(poll,1200);
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
 const delayClass=d=>Number.isFinite(d)?(d<150?'good':d<400?'warm':'bad'):'neutral';
 const delayText=d=>Number.isFinite(d)?`${d} ms`:'未测速';
 const groups=()=>view?.groups??[];
 const currentGroup=()=>groups().find(g=>g.name===group)??groups()[0]??null;
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
 function subscriptionCard() {
  const rows=(view.subscriptions??[]).filter(s=>s.enabled),single=rows.length===1;
  // 只有一条订阅时，把「更新」放到底部操作区，和「管理订阅」并排；
  // 多条时每条各自带按钮，避免底部堆一排分不清归属的更新键。
  const body=rows.length?rows.map(s=>`<div class="sub-row">
   <div class="sub-head"><strong>${esc(s.name)}</strong><span class="tag ${s.status==='ready'?'on':'off'}">${subState(s)}</span></div>
   <p class="small muted">最近成功 ${when(s.lastSuccess)} · ${s.hasCache?'保有可用缓存':'尚无缓存'}</p>
   ${usageBlock(s)}
   ${s.error?`<p class="bad small" role="alert">${esc(s.error)}</p>`:''}
   ${single?'':button('update',s.updating?'更新中…':'更新',`data-id="${esc(s.id)}"`,busy||s.updating||!view.configured||!!view.operation)}
  </div>`).join(''):'<p class="muted">还没有启用中的订阅。添加并更新后才能启动内核。</p>';
  const update=single?button('update',rows[0].updating?'更新中…':'更新订阅',`data-id="${esc(rows[0].id)}"`,
   busy||rows[0].updating||!view.configured||!!view.operation):'';
  return card('订阅',body,{wide:true,footer:`${update}${button('goto-providers',rows.length?'管理订阅':'添加订阅','',false)}`});
 }
 function currentNodeCard() {
  const list=groups();
  if(!list.length)return card('当前节点','<p class="muted">内核运行后显示代理组与可选节点。</p>',
   {wide:true,footer:button('goto-nodes','打开节点列表','',false)});
  const current=currentGroup();
  const groupPicker=`<label>代理组<select id="group-pick" ${busy?'disabled':''}>${list.map(g=>
   `<option value="${esc(g.name)}" ${g.name===current.name?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>`;
  const nodePicker=`<label>节点<select id="node-pick" ${busy||!view.running?'disabled':''}>${(current?.nodes??[]).map(n=>
   `<option value="${esc(n.name)}" ${n.name===current.selected?'selected':''}>${esc(n.label??n.name)}${Number.isFinite(n.delay)?` · ${n.delay} ms`:''}</option>`).join('')}</select></label>`;
  const now=(current?.nodes??[]).find(n=>n.name===current.selected);
  // 跨满整行：宽窗口下两个选择器并排，窄窗口自动回落到上下排列。
  return card('当前节点',`<div class="split">${groupPicker}${nodePicker}</div>
   <p class="status-line">延迟 <span class="n-delay ${delayClass(now?.delay)}">${now&&now.type==='group'?'代理组':delayText(now?.delay)}</span></p>`,
   {wide:true,footer:button('goto-nodes','节点列表','',false)});
 }
 function networkCard() {
  const system=view.systemProxy===true,tun=view.tun?.enable===true;
  const status=tun?'TUN 模式已启用：应用通过虚拟网卡访问网络。'
   :system?`系统代理已接管：浏览器等应用走 127.0.0.1:${view.mixedPort}。`
   :'未接管系统网络：只有内置代理端口可用，其他应用需要自行配置。';
  const tunNote=!view.tunService?.installed?' · 需先安装 TUN 服务':view.running&&!tun?' · 先停止内核再修改':'';
  return card('网络设置',`<div class="switch-row"><div><strong>系统代理</strong>
    <p class="small muted">${system?'已写入系统代理设置':'由 Dock 写入，停止内核时还原'}</p></div>
    ${button('proxy',system?'关闭':'开启',`role="switch" aria-checked="${system}"`,busy||(!view.running&&!system))}</div>
   <div class="switch-row"><div><strong>TUN 虚拟网卡</strong>
    <p class="small muted">${tun?'已启用':'未启用'}${tunNote}</p></div>
    ${button('tun-toggle',tun?'关闭':'开启',`role="switch" aria-checked="${tun}"`,busy||view.running||!view.configured)}</div>
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
  const auto=autostart===true?'已启用':autostart==='unknown'?'不可用':autostart===false?'未启用':'读取中…';
  return card('系统信息',`${kv('操作系统',esc(view.os||'—'))}
   ${kv('开机自启',`<span class="tag ${autostart===true?'on':'off'}">${auto}</span> ${button('autostart-toggle',autostart===true?'关闭':'启用','',autostartBusy||autostart===null||autostart==='unknown')}`)}
   ${kv('运行模式',view.tun?.enable?'TUN / 服务模式':'普通模式')}
   ${kv('页面版本',UI_VERSION)}`);
 }
 function overviewSection() {
  return `<div class="cards">${subscriptionCard()}${currentNodeCard()}${networkCard()}${modeCard()}
   ${siteCard()}${ipCard()}${clashCard()}${systemCard()}</div>`;
 }
 // ── 节点：搜索 / 延迟排序 / 只看可用，列表内部滚动，工具栏常驻 ──
 function visibleNodes(nodes) {
  const query=nodeQuery.trim().toLowerCase();
  let list=nodes.filter(n=>!query
   ||String(n.label??n.name).toLowerCase().includes(query)
   ||String(n.source??'').toLowerCase().includes(query));
  if(onlyAvailable)list=list.filter(n=>Number.isFinite(n.delay));
  if(sortDelay)list=[...list].sort((a,b)=>(Number.isFinite(a.delay)?a.delay:Infinity)-(Number.isFinite(b.delay)?b.delay:Infinity));
  return list;
 }
 function nodeItems(current) {
  return visibleNodes(current?.nodes??[]).map(n=>button('node',
   `<span class="n-label"><span class="n-name">${esc(n.label??n.name)}</span>${n.source?`<small class="source">${esc(n.source)}</small>`:''}</span>
    <span class="n-delay ${delayClass(n.delay)}">${n.type==='group'?'代理组':delayText(n.delay)}</span>`,
   `class="node" data-node="${esc(n.name)}" aria-current="${n.name===current.selected}"`,false)).join('');
 }
 function nodesSection() {
  if(!groups().length)return `<h2>代理组</h2><p>尚无代理节点。请在订阅页添加并更新订阅，然后启动内核。</p>`;
  const current=currentGroup();
  const chips=groups().map(g=>button('group-card',
   `<span class="g-name">${esc(g.name)}</span><span class="g-count">${g.nodes.length} 项</span>`,
   `class="group-card" data-group="${esc(g.name)}" aria-current="${g.name===group}"`,false)).join('');
  const shown=visibleNodes(current?.nodes??[]).length,total=current?.nodes?.length??0;
  return `<h2>代理组</h2><div class="group-strip" role="tablist">${chips}</div>
   <div class="nodes-head"><h2 class="nodes-title">${esc(current?.name??'')}
    <span class="muted"> · 当前 ${esc(current?.selected??'—')}</span></h2>
    ${button('sort-delay',sortDelay?'按延迟 ✓':'按延迟',`aria-pressed="${sortDelay}"`,false)}
    ${button('only-available',onlyAvailable?'只看可用 ✓':'只看可用',`aria-pressed="${onlyAvailable}"`,false)}</div>
   <label class="search">搜索节点<input id="node-search" type="search" autocomplete="off"
    placeholder="按节点名或订阅名筛选" value="${esc(nodeQuery)}"></label>
   <div class="node-scroll" id="node-list"><div class="nodes">${nodeItems(current)}</div></div>
   <p class="muted small" id="node-count">显示 ${shown} / ${total} 个节点</p>`;
 }
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
  return `<h2>订阅管理</h2><p class="muted">多个订阅可同时启用；新增后点「更新」校验，通过后才能启动内核。</p>
   ${banner}${empty}
   ${button('reload','更新全部已启用订阅','',busy||!view.configured||!rows.some(s=>s.enabled)||!!view.operation)}
   <div class="subscriptions">${rows.map(s=>`<article class="subscription">
    <div class="subscription-title"><strong>${esc(s.name)}</strong><span class="tag ${s.enabled?'on':'off'}">${s.enabled?'已启用':'已停用'}</span></div>
    <p class="sub-state ${s.status==='error'?'bad':s.status==='ready'?'good':'muted'}" role="status">${s.updating?'更新中…':{pending:'等待更新',ready:'缓存可用',error:'更新失败'}[s.status]||'等待更新'} · ${s.nodeCount} 个节点</p>
    <p class="muted small">最近尝试：${when(s.lastAttempt)} · 最近成功：${when(s.lastSuccess)}</p>
   ${usageBlock(s)}
    ${s.error?`<p class="bad" role="alert">${esc(s.error)}</p>`:''}
    ${!s.hasCache&&s.status==='pending'?`<p class="muted small">还没下载过节点：点下面的「更新」。</p>`:''}
    <div class="toolbar">${button('update','更新',`data-id="${esc(s.id)}"`,busy||s.updating||!view.configured||!!view.operation)}
    ${button('edit','编辑',`data-id="${esc(s.id)}"`,locked())}
    ${button('toggle',s.enabled?'停用':'启用',`data-id="${esc(s.id)}"`,locked())}
    ${button('delete','删除',`data-id="${esc(s.id)}"`,locked())}</div>
    ${confirmDelete===s.id?`<div class="confirm-bar" role="alert"><p>删除此订阅和本地节点缓存？其他订阅保持原状态。</p>${button('confirm-delete','确认删除',`data-id="${esc(s.id)}"`,locked())}${button('cancel-delete','取消')}</div>`:''}
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
 function feedbackBlock() {
  const parts=[];
  if(busy)parts.push('<p class="banner" role="status">正在执行…</p>');
  if(error||view.error)parts.push(`<p class="banner bad" role="alert">${esc(error||view.error)}</p>`);
  else if(notice)parts.push(`<p class="banner ${noticeKind==='ok'?'good':''}" role="status">${esc(notice)}</p>`);
  if(view.legacyPending&&!view.subscriptions?.length)
   parts.push('<p class="banner" role="status">检测到格式未识别的旧版单订阅资料。原数据已保留；可在下方重新添加订阅地址。</p>');
  return parts.join('');
 }
 function detailSection(name) {
  const label=name==='rules'?'规则':'连接';
  return `<h2>${label}</h2>${button('detail',detail?'重新读取':'读取详情','',busy||!view.running)}
   <pre>${esc(detail?JSON.stringify(detail,null,2):'详情仅显示脱敏摘要。')}</pre>`;
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
  if(locked())return false;
  return run('save',{kernel:view.kernel,mixedPort:view.mixedPort,controllerPort:view.controllerPort,
   tun:{enable:!(view.tun?.enable===true),stack:view.tun?.stack||'mixed'}});
 }
 async function toggleAutostart() {
  if(autostartBusy)return;
  const want=autostart!==true;
  autostartBusy=true;draw();
  try{const row=await FishDock.call('dock.autostart',{autostart:want});autostart=row?.autostart===true;
   say(want?'已开启随 Dock 启动':'已关闭随 Dock 启动','ok')}
  catch{error='自启动设置未保存，请重试'}
  finally{autostartBusy=false;draw()}
 }
 async function loadIp(refresh=false) {
  if(ipBusy)return;
  ipBusy=true;ipAsked=true;ipError='';if(refresh)ip=null;draw();
  try{const next=await FishDock.call('clash.ipInfo',{refresh});ip=next??null;
   if(next?.available===false)ipError=next.reason||'当前无法查询出口 IP'}
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
  const active=document.activeElement,focus=active?.id;
  const caret=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
  if(!view){root.innerHTML=`<h1>Clash</h1><p role="status">${busy?'正在读取内核状态…':esc(error||'尚未读取状态')}</p>${button('view','重试')}`;bind();return}
  if(!groups().some(g=>g.name===group))group=groups()[0]?.name||'';
  const double=view.layout==='double',cfg=configDraft||view;
  FishDock.setLayout(double?'double':'single');
  const nav=SECTIONS.map(([key,label])=>button(`section-${key}`,label,`aria-pressed="${section===key}"`,false)).join('');
  const body=section==='overview'?overviewSection():section==='nodes'?nodesSection()
   :section==='providers'?providersSection():detailSection(section);
  root.innerHTML=`<header><div><h1>Clash</h1><span class="muted">${view.running?'内核运行中':'内核已停止'}${view.version?' · '+esc(view.version):''} · 页面 v${UI_VERSION}</span></div><div class="layouts" aria-label="页面布局">${button('single','单栏',`aria-pressed="${!double}"`,false)}${button('double','双栏',`aria-pressed="${double}"`,false)}</div></header>
   <div class="toolbar">${button(view.running||view.operation==='starting'||updating()?'stop':'start',view.operation==='starting'?'取消启动':view.operation==='stopping'?'正在停止…':view.running?'停止内核':updating()?'取消更新':'启动内核','',busy||view.operation==='stopping')}${button('view','刷新')}</div>
   ${double?'<p class="muted narrow-note">窄窗口自动按单列排列，双栏偏好保持。</p>':''}
   ${feedbackBlock()}
   <div class="workspace ${double?'double':''}">${double?`<aside><h2>管理</h2><nav>${nav}</nav><p>代理 ${esc(view.mixedPort)}<br>控制器 ${esc(view.controllerPort)}</p></aside>`:''}<section class="${section==='overview'?'plain':''}">${!double?`<div class="toolbar">${nav}</div>`:''}
   ${body}</section></div>
   <details id="settings" class="spaced" ${settingsOpen?'open':''}><summary>内核设置</summary><form id="config">
   <label>mihomo 可执行文件<input id="kernel" name="kernel" value="${esc(cfg.kernel)}" required ${locked()?'disabled':''}></label>
   <div class="columns"><label>混合代理端口<input id="mixedPort" name="mixedPort" type="number" min="1024" max="65535" value="${esc(cfg.mixedPort)}" required ${locked()?'disabled':''}></label>
   <label>控制器端口<input id="controllerPort" name="controllerPort" type="number" min="1024" max="65535" value="${esc(cfg.controllerPort)}" required ${locked()?'disabled':''}></label></div>
   <fieldset class="tun-box"><legend>TUN 模式</legend>
   <label class="check"><input id="tunEnable" name="tunEnable" type="checkbox" ${cfg.tun?.enable?'checked':''} ${locked()?'disabled':''}> 启用 TUN（由 SYSTEM 服务托管，普通权限即可用）</label>
   <label>栈<select id="tunStack" name="tunStack" ${locked()?'disabled':''}>${['mixed','gvisor','system'].map(s=>`<option value="${s}" ${(cfg.tun?.stack||'mixed')===s?'selected':''}>${s}</option>`).join('')}</select></label>
   ${cfg.tun?.enable&&!view.tunService?.installed?'<p class="bad" role="alert">TUN 已勾选但服务未安装，启动内核会被拒绝。请先安装 TUN 服务。</p>':''}
   ${tunServiceBlock()}
   </fieldset>
   ${button('save-config','保存内核配置','',locked())}</form></details>`;
  bind();
  const form=root.querySelector('#config');
  form.oninput=()=>{const data=new FormData(form);configDraft={kernel:data.get('kernel'),mixedPort:data.get('mixedPort'),controllerPort:data.get('controllerPort'),tun:{enable:data.has('tunEnable'),stack:String(data.get('tunStack')||'mixed')}}};
  bindSave(form,saveConfig);
  root.querySelector('#settings').ontoggle=e=>{settingsOpen=e.target.open};
  const subscriptionForm=root.querySelector('#subscription-form');
  if(subscriptionForm){
   subscriptionForm.oninput=()=>{const data=new FormData(subscriptionForm);draft={...draft,name:data.get('name'),url:data.get('url')};fieldErrors={}};
   bindSave(subscriptionForm,saveSubscription);
  }
  const groupPicker=root.querySelector('#group-pick');
  if(groupPicker)groupPicker.onchange=e=>{group=e.target.value;draw()};
  const nodePicker=root.querySelector('#node-pick');
  if(nodePicker)nodePicker.onchange=e=>{const current=currentGroup();if(current)run('select',{group:current.name,name:e.target.value})};
  // 搜索框就地过滤：重建列表会丢输入焦点，所以只收起重建后的焦点与光标。
  const search=root.querySelector('#node-search');
  if(search){
   search.oninput=e=>{nodeQuery=String(e.target.value??'');if(!e.isComposing)draw()};
   search.oncompositionend=()=>draw();
  }
  if(focus){const next=root.querySelector(`#${focus}`);next?.focus();if(caret&&next?.setSelectionRange)next.setSelectionRange(...caret)}
 }
 function bind() {
  root.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
   const a=b.dataset.action,id=b.dataset.id;
   if(a==='save-subscription')return saveSubscription();
   if(a==='save-config')return saveConfig();
   if(a==='single'||a==='double')return run('layout',{layout:a});
   if(a.startsWith('section-')){section=a.slice(8);detail=null;draw();return}
   // 点击组卡切换当前组（纯前端状态，不发 RPC）；节点点击才走 select。
   if(a==='group-card'){group=b.dataset.group;draw();return}
   if(a==='node')return run('select',{group, name:b.dataset.node});
   if(a==='goto-nodes'||a==='goto-providers'){section=a.slice(5);draw();return}
   if(a==='sort-delay'){sortDelay=!sortDelay;draw();return}
   if(a==='only-available'){onlyAvailable=!onlyAvailable;draw();return}
   if(a==='stop-inline')return run('stop');
   if(a==='proxy')return run('proxy',{enabled:!view.systemProxy});
   if(a==='tun-toggle')return toggleTun();
   if(a==='mode-set')return run('mode',{mode:b.dataset.mode});
   if(a==='site-test')return testSites();
   if(a==='ip-refresh')return loadIp(true);
   if(a==='ip-reveal'){ipReveal=!ipReveal;draw();return}
   if(a==='autostart-toggle')return toggleAutostart();
   if(a==='detail')return run('details',{section});
   if(a==='edit'){const s=view.subscriptions.find(s=>s.id===id);draft={id,name:s.name,url:''};fieldErrors={};draw();return}
   if(a==='cancel-edit'){draft={id:'',name:'',url:''};fieldErrors={};draw();return}
   if(a==='toggle'){const s=view.subscriptions.find(s=>s.id===id);return run('subscriptionToggle',{id,enabled:!s.enabled})}
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
  // 自启动与出口 IP 都是一次性读取，加标记避免每次重绘都打一次 RPC。
  if(autostart===null&&!autostartBusy){autostartBusy=true;void FishDock.call('dock.autostart')
   .then(row=>{autostart=row?.autostart===true})
   .catch(()=>{autostart='unknown'})
   .finally(()=>{autostartBusy=false;draw()})}
  if(section==='overview'&&view?.running&&!ip&&!ipError&&!ipAsked)void loadIp();
 }
 window.addEventListener('pagehide',()=>clearTimeout(timer));
 run('view');
})();








