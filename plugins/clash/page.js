(() => {
 const root=document.querySelector('#app');
 let view=null,busy=false,polling=false,error='',group='',section='nodes',detail=null,timer=null,revision=0;
 let draft={id:'',name:'',url:''},configDraft=null,settingsOpen=false,confirmDelete='',confirmTun='';
 let notice='',noticeKind='info';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const updating=()=>view?.subscriptions?.some(s=>s.updating);
 const locked=()=>busy||view?.running||!!view?.operation||updating();
 const button=(action,text,extra='',disabled=busy)=>`<button type="button" data-action="${action}" ${extra} ${disabled?'disabled':''}>${text}</button>`;
 const when=value=>value?esc(new Date(value).toLocaleString()):'—';
 // 页面自身版本：用于区分「插件已升级」与「页面仍在跑旧缓存」。
 const UI_VERSION='1.3.0';
 const say=(text,kind='info')=>{notice=String(text||'');noticeKind=kind};
 // 后端错误文案是固定中文提示，不含地址或凭据；只接受这类已知提示，
 // 其余异常（可能夹带 URL/token 的原始错误）一律折叠为通用说明。
 const KNOWN=[/订阅地址无效/,/订阅必须使用不含用户名、密码或片段的 HTTPS 地址/,/请输入 1–80 字的订阅名称/,
  /请输入 HTTPS 订阅地址/,/最多保存 32 个订阅/,/订阅不存在，请刷新/,/订阅 ID 无效/,/订阅启用状态无效/,
  /订阅配置损坏，请从备份恢复/,/请先停止内核/,/请等待订阅更新完成/,/插件正在停用/,/请选择 mihomo 内核/,
  /请先配置 mihomo 内核/,/请先选择 mihomo 内核/,/端口应为 1024–65535/,/混合代理和控制器端口应不同/,
  /布局值无效/,/TUN 开关无效/,/当前环境不支持 TUN 服务模式/,/内核尚未启动/,/内核正在切换状态/,
  /请先更新已启用订阅/,/内核控制器尚未就绪/,/系统代理状态无效/,/请先启动内核/,/详情类别无效/,
  /mihomo 控制器请求失败/,/代理组或节点已变化/];
 const reason=e=>{
  const m=typeof e?.message==='string'?e.message.trim():'';
  const hit=KNOWN.find(r=>r.test(m));
  return hit?m:'请检查配置和运行状态后重试';
 };
 function methodLabel(method){
  return {view:'读取状态',save:'保存设置',subscriptionSave:'保存订阅',subscriptionToggle:'切换启用',
   subscriptionRemove:'删除订阅',reload:'更新订阅',start:'启动内核',stop:'停止内核',select:'切换节点',
   mode:'切换模式',proxy:'系统代理',layout:'切换布局',details:'读取详情',tunService:'读取 TUN 状态',
   installTunService:'安装 TUN 服务',uninstallTunService:'卸载 TUN 服务'}[method]??'操作';
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
    if(method==='subscriptionSave'){draft={id:'',name:'',url:''};say('订阅已保存。下一步点「更新」下载并校验节点。','ok')}
    if(method==='subscriptionToggle')say('启用状态已更新','ok');
    if(method==='subscriptionRemove')say('订阅已删除，其余订阅不受影响','ok');
    if(method==='reload')say('已开始更新，完成后显示节点数与结果','ok');
    if(method==='installTunService')say('TUN 服务已安装','ok');
    if(method==='uninstallTunService')say('TUN 服务已卸载','ok');
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
 function usageBlock(s) {
  const u=s.userInfo;
  if(!u||!Number.isFinite(u.total)||!Number.isFinite(u.used)||u.total<=0)return '';
  const pct=Math.min(100,Math.round(u.used/u.total*100));
  const left=Math.max(0,u.total-u.used);
  const expire=u.expire?` · ${fmtExpire(u.expire)} 到期`:'';
  return `<div class="usage" role="figure" aria-label="流量额度">
   <div class="usage-bar"><span class="usage-fill ${pct>=90?'hot':pct>=70?'warm':''}" style="width:${pct}%"></span></div>
   <p class="usage-text">已用 ${fmtBytes(u.used)} / ${fmtBytes(u.total)} · 剩余 ${fmtBytes(left)} · ${pct}%${expire}</p>
  </div>`;
 }
 function subscriptionsView() {
  const rows=view.subscriptions||[];
  const empty=rows.length===0?`<div class="empty-card"><p><strong>还没有订阅。</strong></p>
   <p class="muted">填好下面的「名称」和「HTTPS 订阅地址」后点「保存订阅」，然后点该订阅卡上的「更新」下载并校验节点。校验通过前不会启动内核。</p></div>`:'';
  return `<h2>订阅管理</h2><p class="muted">多个订阅可同时启用；新增后点「更新」校验，通过后才能启动内核。改名、增删或启用切换前需先停止内核。</p>
   ${empty}
   ${button('reload','更新全部已启用订阅','',busy||!view.configured||!rows.some(s=>s.enabled)||!!view.operation)}
   <div class="subscriptions">${rows.map(s=>`<article class="subscription">
    <div class="subscription-title"><strong>${esc(s.name)}</strong><span class="tag ${s.enabled?'on':'off'}">${s.enabled?'已启用':'已停用'}</span></div>
    <p class="sub-state ${s.status==='error'?'bad':s.status==='ready'?'good':'muted'}" role="status">${s.updating?'更新中…':{pending:'等待更新',ready:'缓存可用',error:'更新失败'}[s.status]||'等待更新'} · ${s.nodeCount} 个节点 · ${s.hasCache?'保有可用缓存':'尚无缓存'}</p>
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
    <label>名称<input id="subscription-name" name="name" maxlength="80" required value="${esc(draft.name)}" placeholder="例如：机场A" ${locked()?'disabled':''}></label>
    <label>HTTPS 订阅地址<input id="subscription-url" name="url" type="password" autocomplete="off" spellcheck="false" value="${esc(draft.url)}" placeholder="${draft.id?'留空保持原地址':'https://…'}" ${draft.id?'':'required'} ${locked()?'disabled':''}></label>
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
  if(view.legacyPending&&!view.subscriptions.length)
   parts.push('<p class="banner" role="status">检测到格式未识别的旧版单订阅资料。原数据已保留；可在下方重新添加订阅地址。</p>');
  return parts.join('');
 }
 function saveSubscription() {
  if(locked())return false;
  const form=root.querySelector('#subscription-form');
  if(!form||form.reportValidity?.()===false)return false;
  const data=new FormData(form);
  draft={...draft,name:String(data.get('name')??''),url:String(data.get('url')??'')};
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
  if(!view.groups.some(g=>g.name===group))group=view.groups[0]?.name||'';
  const current=view.groups.find(g=>g.name===group),double=view.layout==='double',cfg=configDraft||view;
  FishDock.setLayout(double?'double':'single');
  const nav=['nodes','providers','rules','connections'].map(s=>button(`section-${s}`,{nodes:'节点',providers:'订阅',rules:'规则',connections:'连接'}[s],`aria-pressed="${section===s}"`,false)).join('');
  // 延迟色阶：沿用 Dock 的成功/警告/失败色，未测速灰色。
  const delayClass=d=>d===null?'muted':d<150?'good':d<400?'warm':'bad';
  const delayText=d=>d===null?'未测速':`${d} ms`;
  // 组卡：当前选中 + 成员数；点击卡片本身切换当前组。
  const groupCards=view.groups.map(g=>button('group-card',
   `<span class="g-name">${esc(g.name)}</span><span class="g-now">${esc(g.selected||'—')}</span><span class="g-count">${g.nodes.length} 项</span>`,
   `class="group-card" data-group="${esc(g.name)}" aria-current="${g.name===group}"`,false)).join('');
  const nodes=`<h2>代理组</h2>${view.groups.length?`<div class="group-grid" role="tablist">${groupCards}</div>
   <h2 class="nodes-title">${esc(current?.name||'')}<span class="muted"> · 当前 ${esc(current?.selected||'—')}</span></h2>
   <div class="nodes">${(current?.nodes||[]).map(n=>button('node',
    `<span class="n-label"><span class="n-name">${esc(n.label??n.name)}</span>${n.source?`<small class="source">${esc(n.source)}</small>`:''}</span><span class="n-delay ${delayClass(n.delay)}">${n.type==='group'?esc(n.label):delayText(n.delay)}</span>`,
    `class="node" data-node="${esc(n.name)}" aria-current="${n.name===current.selected}"`)).join('')}</div>`:'<p>尚无代理节点。请在订阅页添加并更新订阅，然后启动内核。</p>'}`;
  root.innerHTML=`<header><div><h1>Clash</h1><span class="muted">${view.running?'内核运行中':'内核已停止'}${view.version?' · '+esc(view.version):''} · 页面 v${UI_VERSION}</span></div><div class="layouts" aria-label="页面布局">${button('single','单栏',`aria-pressed="${!double}"`)}${button('double','双栏',`aria-pressed="${double}"`)}</div></header>
   <div class="toolbar"><label class="autostart" title="随 Dock 启动就拉起内核"><input id="autostart" type="checkbox"> 自启动</label>${button(view.running||view.operation==='starting'||updating()?'stop':'start',view.operation==='starting'?'取消启动':view.operation==='stopping'?'正在停止…':view.running?'停止内核':updating()?'取消更新':'启动内核','',busy||view.operation==='stopping')}${button('view','刷新')}
   ${button('proxy',view.systemProxy?'关闭系统代理':'开启系统代理',`aria-pressed="${view.systemProxy}"`,busy||(!view.running&&!view.systemProxy))}
   <label>运行模式<select id="mode" ${busy||!view.running?'disabled':''}>${['rule','global','direct'].map(m=>`<option value="${m}" ${m===view.mode?'selected':''}>${{rule:'规则',global:'全局',direct:'直连'}[m]}</option>`).join('')}</select></label></div>
   ${double?'<p class="muted narrow-note">窄窗口自动按单列排列，双栏偏好保持。</p>':''}
   ${feedbackBlock()}
   <div class="workspace ${double?'double':''}">${double?`<aside><h2>管理</h2><nav>${nav}</nav><p>代理 ${esc(view.mixedPort)}<br>控制器 ${esc(view.controllerPort)}</p></aside>`:''}<section>${!double?`<div class="toolbar">${nav}</div>`:''}
   ${section==='nodes'?nodes:section==='providers'?subscriptionsView():`<h2>${section==='rules'?'规则':'连接'}</h2>${button('detail','刷新详情','',busy||!view.running)}<pre>${esc(detail?JSON.stringify(detail,null,2):'详情仅显示脱敏摘要。')}</pre>`}</section></div>
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
   subscriptionForm.oninput=()=>{const data=new FormData(subscriptionForm);draft={...draft,name:data.get('name'),url:data.get('url')}};
   bindSave(subscriptionForm,saveSubscription);
  }
  root.querySelector('#mode').onchange=e=>run('mode',{mode:e.target.value});
  if(focus){const next=root.querySelector(`#${focus}`);next?.focus();if(caret&&next?.setSelectionRange)next.setSelectionRange(...caret)}
 }
 async function readAutostart(box){
 try{const row=await FishDock.call('dock.autostart');box.checked=row.autostart===true;}
 catch{const wrap=box.closest('.autostart');if(wrap)wrap.hidden=true;}
}
async function setAutostart(box){
 const want=box.checked;box.disabled=true;
 try{const row=await FishDock.call('dock.autostart',{autostart:want});box.checked=row.autostart===true;}
 catch{box.checked=!want;error='自启动设置未保存，请重试';draw();}
 finally{const again=root.querySelector('#autostart');if(again)again.disabled=false;}
}
function bind() {
 const auto=root.querySelector('#autostart');
 if(auto){auto.onchange=()=>setAutostart(auto);void readAutostart(auto);}
  root.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
   const a=b.dataset.action,id=b.dataset.id;
    if(a==='save-subscription')return saveSubscription();
    if(a==='save-config')return saveConfig();
   if(a==='single'||a==='double')return run('layout',{layout:a});
   if(a.startsWith('section-')){section=a.slice(8);detail=null;draw();return}
   // 点击组卡切换当前组（纯前端状态，不发 RPC）；节点点击才走 select。
   if(a==='group-card'){group=b.dataset.group;draw();return}
   if(a==='node')return run('select',{group,name:b.dataset.node});
   if(a==='proxy')return run('proxy',{enabled:!view.systemProxy});
   if(a==='detail')return run('details',{section});
   if(a==='edit'){const s=view.subscriptions.find(s=>s.id===id);draft={id,name:s.name,url:''};draw();return}
   if(a==='cancel-edit'){draft={id:'',name:'',url:''};draw();return}
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
 }
 window.addEventListener('pagehide',()=>clearTimeout(timer));
 run('view');
})();
