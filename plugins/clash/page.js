(() => {
 const root=document.querySelector('#app');
 let view=null,busy=false,polling=false,error='',group='',section='nodes',detail=null,timer=null,revision=0;
 let draft={id:'',name:'',url:''},configDraft=null,settingsOpen=false,confirmDelete='',confirmTun='';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const updating=()=>view?.subscriptions?.some(s=>s.updating);
 const locked=()=>busy||view?.running||!!view?.operation||updating();
 const button=(action,text,extra='',disabled=busy)=>`<button type="button" data-action="${action}" ${extra} ${disabled?'disabled':''}>${text}</button>`;
 const when=value=>value?esc(new Date(value).toLocaleString()):'—';
 async function run(method,params={}) {
  if(busy)return false;
  busy=true;revision++;error='';draw();
  try {
   const result=await FishDock.call(`clash.${method}`,params);
   if(method==='details')detail=result;
   else {view=result;if(method==='save')configDraft=null;if(method==='subscriptionSave')draft={id:'',name:'',url:''};}
   return true;
  }catch{error='操作失败，请检查配置和运行状态后重试';return false}
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
 function subscriptionsView() {
  const rows=view.subscriptions||[];
  return `<h2>订阅管理</h2><p>多个订阅可同时启用；新增后点击更新，验证成功后可启动。改名、增删或启用切换前请停止内核。</p>
   ${button('reload','更新全部已启用订阅','',busy||!view.configured||!rows.some(s=>s.enabled)||!!view.operation)}
   <div class="subscriptions">${rows.map(s=>`<article class="subscription">
    <div class="subscription-title"><strong>${esc(s.name)}</strong><span>${s.enabled?'已启用':'已停用'}</span></div>
    <small class="muted">ID：${esc(s.id)}</small>
    <p role="status">${s.updating?'更新中…':{pending:'等待更新',ready:'缓存可用',error:'更新失败'}[s.status]||'等待更新'} · ${s.nodeCount} 个节点 · ${s.hasCache?'保有可用缓存':'尚无缓存'}</p>
    <p class="muted">最近尝试：${when(s.lastAttempt)}<br>最近成功：${when(s.lastSuccess)}</p>
    ${s.error?`<p class="bad" role="alert">${esc(s.error)}</p>`:''}
    <div class="toolbar">${button('update','更新',`data-id="${esc(s.id)}"`,busy||s.updating||!view.configured||!!view.operation)}
    ${button('edit','编辑',`data-id="${esc(s.id)}"`,locked())}
    ${button('toggle',s.enabled?'停用':'启用',`data-id="${esc(s.id)}"`,locked())}
    ${button('delete','删除',`data-id="${esc(s.id)}"`,locked())}</div>
    ${confirmDelete===s.id?`<div role="alert"><p>删除此订阅和本地节点缓存？其他订阅保持原状态。</p>${button('confirm-delete','确认删除',`data-id="${esc(s.id)}"`,locked())}${button('cancel-delete','取消')}</div>`:''}
   </article>`).join('')||'<p>尚未添加订阅。</p>'}</div>
   <form id="subscription-form"><h3>${draft.id?'编辑订阅':'添加订阅'}</h3>
    <label>名称<input id="subscription-name" name="name" maxlength="80" required value="${esc(draft.name)}" ${locked()?'disabled':''}></label>
    <label>HTTPS 订阅地址<input id="subscription-url" name="url" type="password" autocomplete="off" spellcheck="false" value="${esc(draft.url)}" placeholder="${draft.id?'留空保持原地址':'https://…'}" ${draft.id?'':'required'} ${locked()?'disabled':''}></label>
    <button ${locked()?'disabled':''}>${busy?'正在保存…':'保存订阅'}</button>${draft.id?button('cancel-edit','取消编辑'):''}
    <p class="muted">地址加密保存且不回显。支持 mihomo 可读取的代理 YAML/JSON；网页、登录页与普通分享链接不等于订阅。</p>
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
 function draw() {
  const active=document.activeElement,focus=active?.id;
  const caret=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
  if(!view){root.innerHTML=`<h1>Clash</h1><p role="status">${busy?'正在读取内核状态…':esc(error||'尚未读取状态')}</p>${button('view','重试')}`;bind();return}
  if(!view.groups.some(g=>g.name===group))group=view.groups[0]?.name||'';
  const current=view.groups.find(g=>g.name===group),double=view.layout==='double',cfg=configDraft||view;
  FishDock.setLayout(double?'double':'single');
  const nav=['nodes','providers','rules','connections'].map(s=>button(`section-${s}`,{nodes:'节点',providers:'订阅',rules:'规则',connections:'连接'}[s],`aria-pressed="${section===s}"`,false)).join('');
  const nodes=`<h2>代理节点</h2>${view.groups.length?`<label>代理组<select id="group" ${busy?'disabled':''}>${view.groups.map(g=>`<option ${g.name===group?'selected':''} value="${esc(g.name)}">${esc(g.name)}</option>`).join('')}</select></label>`:'<p>尚无代理节点。请在订阅页添加并更新订阅，然后启动内核。</p>'}
   <div class="nodes">${(current?.nodes||[]).map(n=>button('node',`<span>${esc(n.label??n.name)}${n.source?`<small class="source">${esc(n.source)} · ${esc(n.sourceId)}</small>`:''}</span><span>${n.delay===null?'未测速':`${esc(n.delay)} ms`}</span>`,`class="node" data-node="${esc(n.name)}" aria-current="${n.name===current.selected}"`)).join('')}</div>`;
  root.innerHTML=`<header><div><h1>Clash</h1><span class="muted">${view.running?'内核运行中':'内核已停止'}${view.version?' · '+esc(view.version):''}</span></div><div class="layouts" aria-label="页面布局">${button('single','单栏',`aria-pressed="${!double}"`)}${button('double','双栏',`aria-pressed="${double}"`)}</div></header>
   <div class="toolbar"><label class="autostart" title="随 Dock 启动就拉起内核"><input id="autostart" type="checkbox"> 自启动</label>${button(view.running||view.operation==='starting'||updating()?'stop':'start',view.operation==='starting'?'取消启动':view.operation==='stopping'?'正在停止…':view.running?'停止内核':updating()?'取消更新':'启动内核','',busy||view.operation==='stopping')}${button('view','刷新')}
   ${button('proxy',view.systemProxy?'关闭系统代理':'开启系统代理',`aria-pressed="${view.systemProxy}"`,busy||(!view.running&&!view.systemProxy))}
   <label>运行模式<select id="mode" ${busy||!view.running?'disabled':''}>${['rule','global','direct'].map(m=>`<option value="${m}" ${m===view.mode?'selected':''}>${{rule:'规则',global:'全局',direct:'直连'}[m]}</option>`).join('')}</select></label></div>
   ${double?'<p class="muted narrow-note">窄窗口自动按单列排列，双栏偏好保持。</p>':''}
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
   <button ${locked()?'disabled':''}>保存内核配置</button></form></details>
   ${busy?'<p role="status">正在执行…</p>':''}${error||view.error?`<p class="bad" role="alert">${esc(error||view.error)}</p>`:''}`;
  bind();
  const form=root.querySelector('#config');
  form.oninput=()=>{const data=new FormData(form);configDraft={kernel:data.get('kernel'),mixedPort:data.get('mixedPort'),controllerPort:data.get('controllerPort'),tun:{enable:data.has('tunEnable'),stack:String(data.get('tunStack')||'mixed')}}};
  form.onsubmit=e=>{e.preventDefault();const data=new FormData(form);run('save',{kernel:data.get('kernel'),mixedPort:Number(data.get('mixedPort')),controllerPort:Number(data.get('controllerPort')),tun:{enable:data.has('tunEnable'),stack:String(data.get('tunStack')||'mixed')}})};
  root.querySelector('#settings').ontoggle=e=>{settingsOpen=e.target.open};
  const subscriptionForm=root.querySelector('#subscription-form');
  if(subscriptionForm){
   subscriptionForm.oninput=()=>{const data=new FormData(subscriptionForm);draft={...draft,name:data.get('name'),url:data.get('url')}};
   subscriptionForm.onsubmit=e=>{e.preventDefault();run('subscriptionSave',{...draft})};
  }
  const groups=root.querySelector('#group');if(groups)groups.onchange=()=>{group=groups.value;draw()};
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
   if(a==='single'||a==='double')return run('layout',{layout:a});
   if(a.startsWith('section-')){section=a.slice(8);detail=null;draw();return}
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
