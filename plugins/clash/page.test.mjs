import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// 页面里的文案表与 shared/errors.mjs 同源：这里逐码比对，防止两份表漂移。
import {errorMessages} from '../../shared/errors.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
const alertsOf=html=>[...html.matchAll(/role="alert">([^<]*)</g)].map(m=>m[1]);
const pageJs=readFileSync(new URL('./page.js',import.meta.url),'utf8');
const pageCss=readFileSync(new URL('./page.css',import.meta.url),'utf8');
const pageHtml=readFileSync(new URL('./page.html',import.meta.url),'utf8');

// ───────────────────────── 静态断言：双主题 token / 裸色 / 圆角 / listbox 结构 ─────────────────────────
test('双主题 token：dark 写在 :root，light 用 :root[data-dock-theme=light] 覆盖，不读 prefers-color-scheme',()=>{
 assert.match(pageCss,/:root\{[\s\S]*--line-hair:#333336/,'dark 基准在 :root');
 assert.match(pageCss,/:root\[data-dock-theme=light\]\{[\s\S]*--line-hair:#e3e3e6/,'light 覆盖块');
 for(const tok of ['--line-hair','--line-control','--layer-1','--layer-2','--hi','--shadow','--c-ok','--c-warn','--c-bad','--c-ok-bg','--c-bad-bg','--sel-bg','--sel-line','--glass'])
  assert.ok(pageCss.includes(tok+':'),'缺少 token '+tok);
 assert.equal(/@media[^{]*prefers-color-scheme/.test(pageCss),false,'不得用系统偏好当主题真相');
 assert.match(pageCss,/:root\[data-dock-theme=light\]\{[\s\S]*--c-ok:#0f7b33/,'light 三态换浅色值');
 assert.match(pageCss,/:root\[data-dock-theme=light\]\{[\s\S]*--layer-1:#ffffff/,'light 卡片白底');
});
test('13 处裸色全部收敛到 token：允许的 6 个色值只出现在 token 定义段，其余位置无裸色',()=>{
 const tokenEnd=pageCss.indexOf('\n\n/* ── 顶部按钮行');
 assert.ok(tokenEnd>0,'能定位 token 段结束');
 const hexes=['#0a84ff','#30d158','#ffd60a','#ff453a','#ff6b7a','#ff8a80'];
 for(const hex of hexes){
  let idx=pageCss.indexOf(hex);
  while(idx>=0){assert.ok(idx<tokenEnd,`${hex} 出现在 token 段之外（位置 ${idx}）`);idx=pageCss.indexOf(hex,idx+1)}
 }
 const outside=pageCss.slice(tokenEnd);
 assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(outside),false,'token 段之外不得出现任何裸色值');
});
test('圆角只保留 14 与 999 两档',()=>{
 const vals=[...pageCss.matchAll(/border-radius:([^;}]+)/g)].map(m=>m[1].trim());
 assert.ok(vals.length>0,'有圆角声明');
 for(const v of vals) assert.ok(/^(14px|999px)$/.test(v),`非法圆角档 ${v}`);
});
test('弹层用 position:fixed（不被 .pane 的 overflow 裁切）且具备 listbox 八态样式',()=>{
 assert.match(pageCss,/\.listbox\{position:fixed/,'弹层固定定位');
 for(const cls of ['\\.listbox','\\.lb-filter','\\.lb-option','\\.lb-option\\[aria-selected=true\\]','\\.lb-option\\[data-active=true\\]','\\.lb-option\\[aria-disabled=true\\]','\\.lb-empty','\\.lb-loading'])
  assert.ok(new RegExp(cls).test(pageCss),'缺少 '+cls);
});
test('页面结构含 role=listbox/option/combobox 与 aria 契约',()=>{
 for(const s of ['role="combobox"','role="option"','aria-haspopup="listbox"','aria-expanded','aria-controls','aria-selected','aria-activedescendant'])
  assert.ok(pageJs.includes(s),'缺少 '+s);
 assert.ok(/listbox/.test(pageJs),'含 listbox 角色/容器');
 assert.ok(pageJs.includes("setAttribute('role','listbox')"),'弹层 role=listbox');
});
test('整段删除 staleDraw / scrollAt 两个补丁；poll 内不再 root.innerHTML 重建',()=>{
 assert.equal(pageJs.includes('staleDraw'),false,'staleDraw 应删除');
 assert.equal(pageJs.includes('scrollAt'),false,'scrollAt 应删除');
 const pollBody=/async function poll\(\)\{[\s\S]*?\n \}/.exec(pageJs)?.[0]??'';
 assert.ok(pollBody.includes('updateLive'),'poll 走局部更新');
 assert.equal(pollBody.includes('innerHTML'),false,'poll 不重建 innerHTML');
});
test('读数节点带 data-live，结构区 aria-live=off，读数区 aria-live=polite',()=>{
 assert.ok(pageJs.includes('data-live="delay"'),'延迟读数带 data-live');
 assert.ok(pageJs.includes('data-live="stamp"'),'新鲜度带 data-live');
 assert.ok(pageJs.includes('aria-live="off"'),'结构区 off');
 assert.ok(pageJs.includes('aria-live="polite"'),'读数区 polite');
});
test('page.html 增加浮层容器（挂 body 的弹层根）',()=>{
 assert.ok(pageHtml.includes('id="popover-root"'),'浮层容器');
});

// ───────────────────────── 测试夹具 ─────────────────────────
function fixture(prepare) {
 const calls=[],timers=new Map();let serial=0,html='',elements={},buttons=[],cards=[],liveEls=[],hooks=null;
 let blocked=null,fail=false,ipReply=null,nodeTestReply=null,thrown=null;const failMethods=new Set();
 const listeners={compositionstart:[],compositionend:[]};
 const docListeners={keydown:[]};
 const row={kernel:'D:/mihomo.exe',mixedPort:7895,controllerPort:9099,configured:true,running:false,
  version:'v1.19.0',rulesCount:11,uptimeMs:3723000,os:'Windows 10.0.26200',
  arch:'x64',cpu:'Synthetic CPU · 16 核',memoryTotal:64*1024**3,pluginVersion:'2.0.3',bundled:true,
  tun:{enable:false,stack:'mixed'},systemProxy:false,groups:[
  {name:'🚀 节点选择',selected:'♻️ 自动选择',nodes:[
   {name:'♻️ 自动选择',label:'♻️ 自动选择',sourceId:null,source:null,type:'group',delay:null},
   {name:'DIRECT',label:'DIRECT',sourceId:null,source:null,type:'Direct',delay:null},
   {name:'[sub-00000000-0000-0000-0000-000000000001] 香港节点',label:'香港节点',sourceId:'sub-00000000-0000-0000-0000-000000000001',source:'One',type:'ss',delay:20}]}],
  subscriptions:[{id:'sub-00000000-0000-0000-0000-000000000001',name:'One',enabled:true,status:'ready',nodeCount:2,hasCache:true}],
  mode:'rule'};
 const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
 const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
 let htmlSets=0;
 const root={
  get innerHTML(){return html},
  set innerHTML(value){
   html=value;htmlSets++;elements={};buttons=[];cards=[];liveEls=[];
   for(const m of value.matchAll(/<(?:input|form|details|select|div|article|section)\b[^>]*>/g)){
    const a=attrs(m[0]);
    if(a.id)elements[a.id]={...a,tagName:(/^<(\w+)/.exec(m[0])?.[1]??'').toUpperCase(),value:a.value??'',open:m[0].includes(' open'),disabled:m[0].includes('disabled'),scrollTop:0,scrollLeft:0,focus(){}};
    if(a['data-sub'])cards.push({dataset:{sub:a['data-sub']},enabled:a['aria-checked']==='true',active:a['data-active'],onclick:null,onkeydown:null});
   }
   for(const m of value.matchAll(/<button\b[^>]*>/g)){
    const a=attrs(m[0]);if(a['data-action'])buttons.push({dataset:{action:a['data-action'],id:a['data-id'],node:a['data-node'],group:a['data-group'],mode:a['data-mode'],section:a['data-section']},disabled:m[0].includes('disabled')});
   }
   for(const m of value.matchAll(/<(\w+)\b[^>]*\bdata-live="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)){
    const a=attrs(m[0]);const inner=decode(m[3].replace(/<[^>]*>/g,''));
    liveEls.push({dataset:{live:a['data-live'],liveId:a['data-live-id']},textContent:inner,className:'',style:{},setAttribute(){}});
   }
  },
  querySelector:q=>{
   if(q==='.readout-area')return {setAttribute(){}};
   if(q&&q[0]==='#')return elements[q.slice(1)]??null;
   return null;
  },
  querySelectorAll:q=>q==='[data-sub]'?cards:q==='[data-live]'?liveEls:buttons,
  addEventListener:(type,fn)=>{if(listeners[type])listeners[type].push(fn)}
 };
 class FormData {
  constructor(form){this.id=form.id}
  get(key){return elements[this.id==='subscription-form'?`subscription-${key}`:key]?.value??null}
 }
 const context={document:{querySelector:()=>root,querySelectorAll:q=>root.querySelectorAll(q),createElement:()=>({style:{},setAttribute(){},appendChild(){},remove(){},focus(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}}),activeElement:null,addEventListener:(t,fn)=>{(docListeners[t]||(docListeners[t]=[])).push(fn)},removeEventListener(){},documentElement:{clientHeight:800}},
  window:{addEventListener(){},removeEventListener(){},getSelection:()=>({isCollapsed:true}),innerHeight:800},
  navigator:{},AbortController,FormData,URL,structuredClone,
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  FishDock:{setLayout(){},call:async(method,params)=>{
   calls.push({method,params});
   if(failMethods.has(method)){const e=Error('backend said: PRIVATE');e.code='CONTROLLER_TIMEOUT';throw e}
   if(thrown&&thrown.method===method){const error=thrown.error;thrown=null;throw error}
   if(method==='clash.subscriptionSave'){await blocked;if(fail)throw Error('PRIVATE');}
   if(method==='clash.ipInfo')return ipReply??{available:true,ip:'203.0.113.7',country:'日本',countryCode:'JP',
    asn:'AS2516',isp:'KDDI',org:'KDDI Corporation',location:'日本 · 东京 · 千代田',timezone:'Asia/Tokyo'};
   if(method==='clash.nodeTest')return nodeTestReply??{group:params.group??'',tested:2,delays:[
    {name:'[sub-00000000-0000-0000-0000-000000000001] 香港节点',delay:42},{name:'DIRECT',delay:null}]};
   if(method==='clash.siteTest')return {node:'[sub-00000000-0000-0000-0000-000000000001] 香港节点',sites:[
    {key:'apple',label:'Apple',url:'https://www.apple.com/library/test/success.html',delay:128,ok:true},
    {key:'github',label:'GitHub',url:'https://github.com/favicon.ico',delay:null,ok:false},
    {key:'google',label:'Google',url:'https://www.google.com/generate_204',delay:null,ok:false},
    {key:'youtube',label:'YouTube',url:'https://www.youtube.com/favicon.ico',delay:null,ok:false}]};
   return structuredClone(row);
  }},
  __CLASH_TEST_HOOKS__:t=>{hooks=t}
 };
 prepare?.(row);
 vm.runInNewContext(pageJs,context);
 const fire=async()=>{const pending=[...timers.values()];timers.clear();for(const t of pending)await t.fn();await flush()};
 return {calls,row,root,element:id=>elements[id],buttons:()=>buttons,cards:()=>cards,live:()=>liveEls,get htmlSets(){return htmlSets},
  hooks:()=>hooks,setActive:el=>{context.document.activeElement=el},
  compositionStart:()=>{for(const fn of listeners.compositionstart)fn()},
  compositionEnd:()=>{for(const fn of listeners.compositionend)fn()},
  click:(action,section)=>{const button=buttons.find(b=>b.dataset.action===action&&(section===undefined||b.dataset.section===section));assert.ok(button,`${action}${section?`(${section})`:''}`);return button.onclick()},
  clickWhere:(action,pred)=>{const b=buttons.find(x=>x.dataset.action===action&&pred(x));assert.ok(b,action);return b.onclick()},
  cardClick:id=>{const card=cards.find(c=>c.dataset.sub===id);assert.ok(card,`订阅卡 ${id}`);return card.onclick({target:{closest:()=>null}})},
  setIpReply:value=>{ipReply=value},setNodeTest:value=>{nodeTestReply=value},
  throwOn:(method,error)=>{thrown={method,error}},failMethod:m=>failMethods.add(m),
  block:()=>{let release;blocked=new Promise(r=>release=r);return release},fail:()=>{fail=true},
  fire};
}
const has=(f,action)=>f.buttons().some(b=>b.dataset.action===action);

// ───────────────────────── 下拉纯逻辑（键盘表逐条） ─────────────────────────
test('listbox 键盘：↑↓ 首尾不循环，Home/End 直达两端',()=>{
 const f=fixture();const k=f.hooks();
 assert.equal(k.resolveActive(-1,5,'ArrowDown'),0,'无活动项向下落到第一项');
 assert.equal(k.resolveActive(-1,5,'ArrowUp'),4,'无活动项向上落到最后一项');
 assert.equal(k.resolveActive(0,5,'ArrowUp'),0,'首项向上不循环');
 assert.equal(k.resolveActive(4,5,'ArrowDown'),4,'末项向下不循环');
 assert.equal(k.resolveActive(2,5,'Home'),0,'Home 到首项');
 assert.equal(k.resolveActive(2,5,'End'),4,'End 到末项');
 assert.equal(k.resolveActive(1,5,'ArrowDown'),2,'普通下移');
});
test('listbox 过滤与 type-ahead：子串过滤、中文首字与字母前缀拼接',()=>{
 const f=fixture();const k=f.hooks();
 const items=[{label:'香港 01'},{label:'Hong Kong 02'},{label:'日本 03'}];
 assert.deepEqual(k.filterItems(items,'香港').map(i=>i.label),['香港 01']);
 assert.deepEqual(k.filterItems(items,'hong').map(i=>i.label),['Hong Kong 02']);
 assert.equal(k.filterItems(items,'').length,3,'空串不过滤');
 assert.equal(k.typeAheadNext(items,-1,'日'),2,'首字匹配中文');
 assert.equal(k.typeAheadNext(items,-1,'h'),1,'字母前缀匹配');
});

// ───────────────────────── 表单 / 订阅 / 概览回归 ─────────────────────────
test('sandbox 页面点击保存订阅直接调用 RPC，并读取实时输入',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='Click save';
 f.element('subscription-url').value='https://example.test/sub?token=synthetic';
 const release=f.block();f.click('save-subscription');f.click('save-subscription');
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionSave').length,1);
 assert.equal(f.calls.find(c=>c.method==='clash.subscriptionSave').params.name,'Click save');
 release();await flush();
});
test('sandbox 页面内核设置保存按钮直接调用 RPC',async()=>{
 const f=fixture();await flush();f.click('section-settings');
 f.element('kernel').value='D:/new/mihomo.exe';f.element('mixedPort').value='7897';
 f.click('save-config');await flush();
 const saved=f.calls.find(c=>c.method==='clash.save');assert.ok(saved);
 assert.equal(saved.params.kernel,'D:/new/mihomo.exe');assert.equal(saved.params.mixedPort,7897);
});
test('sandbox 页面输入框回车走同一保存路径，无原生提交',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='Keyboard save';f.element('subscription-url').value='https://example.test/sub';
 let prevented=false;
 f.element('subscription-form').onkeydown({key:'Enter',target:{tagName:'INPUT'},preventDefault(){prevented=true}});
 await flush();assert.equal(prevented,true);
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionSave').length,1);
});
test('草稿在刷新后保留，等待保存时不重复提交',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='Draft';f.element('subscription-url').value='https://example.test/?token=synthetic';
 f.element('subscription-form').oninput();
 f.click('view');await flush();
 assert.equal(f.element('subscription-name').value,'Draft');
 const release=f.block();f.fail();
 f.element('subscription-form').onsubmit({preventDefault(){}});
 f.element('subscription-form').onsubmit({preventDefault(){}});
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionSave').length,1);
 release();await flush();
 assert.equal(f.root.innerHTML.includes('PRIVATE'),false);
});
test('保存订阅失败时显示可操作提示，不泄露地址或凭据',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='9YUN';f.element('subscription-url').value='https://example.test/?token=PRIVATE';
 f.element('subscription-form').oninput();f.fail();
 f.element('subscription-form').onsubmit({preventDefault(){}});await flush();
 assert.ok(f.root.innerHTML.includes('保存订阅失败'));
 assert.equal(alertsOf(f.root.innerHTML).some(t=>t.includes('PRIVATE')),false);
});
test('空订阅列表给出下一步指引',async()=>{
 const f=fixture();await flush();f.row.subscriptions=[];f.click('view');await flush();f.click('section-providers');
 assert.ok(f.root.innerHTML.includes('还没有订阅'));
 assert.ok(f.root.innerHTML.includes('下载并校验节点'));
});
test('概览渲染信息卡：订阅、当前节点、网络、模式、网站、IP、Clash、系统',async()=>{
 const f=fixture();await flush();const html=f.root.innerHTML;
 for(const title of ['订阅','当前节点','网络设置','代理模式','网站测试','IP 信息','Clash 信息','系统信息'])
  assert.ok(html.includes(title),`缺少卡片：${title}`);
 assert.ok(html.includes('v1.19.0'));assert.ok(html.includes('11 条'));assert.ok(html.includes('127.0.0.1:7895'));
 assert.ok(html.includes('1 小时 2 分'));
});
test('内核运行时订阅区给出先停止内核的说明与入口',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();f.click('section-providers');
 assert.ok(f.root.innerHTML.includes('data-banner="kernel-running"'));
 assert.ok(f.root.innerHTML.includes('先停止内核'));
 assert.ok(has(f,'stop-inline'));
 f.click('stop-inline');await flush();
 assert.ok(f.calls.some(c=>c.method==='clash.stop'));
});
test('订阅名称为空或协议不合法时就地报错，不发保存请求',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='';f.element('subscription-url').value='https://example.test/sub';
 f.click('save-subscription');await flush();
 assert.equal(f.calls.some(c=>c.method==='clash.subscriptionSave'),false);
 assert.ok(f.root.innerHTML.includes('请输入 1–80 字的订阅名称'));
 assert.ok(/id="subscription-name"[^>]*aria-invalid="true"/.test(f.root.innerHTML));
});
test('网站测试展示各站点延迟与超时状态',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 assert.ok(f.root.innerHTML.includes('未测试'));
 f.click('site-test');await flush();
 assert.ok(f.root.innerHTML.includes('128 ms'));assert.ok(f.root.innerHTML.includes('超时'));
 assert.ok(f.root.innerHTML.includes('Apple')&&f.root.innerHTML.includes('YouTube'));
});
test('IP 卡片默认脱敏，点开后显示完整地址',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();await flush();
 assert.ok(f.root.innerHTML.includes('203.0.113.***'));
 assert.equal(f.root.innerHTML.includes('203.0.113.7'),false);
 f.click('ip-reveal');assert.ok(f.root.innerHTML.includes('203.0.113.7'));
});
test('出口 IP 不可用时按普通提示显示，不用红色告警',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.setIpReply({available:false,reason:'当前运行时不支持查询出口 IP'});
 f.click('view');await flush();await flush();
 assert.ok(f.root.innerHTML.includes('当前运行时不支持查询出口 IP'));
 assert.equal(alertsOf(f.root.innerHTML).some(t=>t.includes('不支持')),false);
 assert.ok(f.root.innerHTML.includes('重试'));
});
test('网络设置与代理模式反映实际状态，开关带切换语义',async()=>{
 const f=fixture();await flush();f.row.running=true;f.row.systemProxy=true;f.row.mode='global';
 f.click('view');await flush();
 const html=f.root.innerHTML;
 assert.ok(/<button[^>]*data-action="proxy"[^>]*aria-checked="true"/.test(html));
 assert.ok(/<button[^>]*data-action="mode-set"[^>]*data-mode="global"[^>]*aria-pressed="true"/.test(html));
 f.clickWhere('mode-set',b=>b.dataset.mode==='rule');await flush();
 assert.ok(f.calls.some(c=>c.method==='clash.mode'&&c.params.mode==='rule'));
});
test('内核运行时 TUN 开关仍可点，并说明会重启内核',async()=>{
 const f=fixture();await flush();f.row.running=true;f.row.tunService={installed:true,state:'running',canElevate:true};
 f.click('view');await flush();
 const b=f.buttons().find(b=>b.dataset.action==='tun-toggle');assert.ok(b);
 assert.equal(b.disabled,false);
 assert.ok(f.root.innerHTML.includes('切换会重启内核'));
});
test('概览只显示当前节点所用订阅，其余折叠成一行',async()=>{
 const f=fixture();await flush();f.row.running=true;
 const second='sub-00000000-0000-0000-0000-000000000002';
 f.row.subscriptions.push({id:second,name:'Two',enabled:true,status:'ready',nodeCount:3,hasCache:true});
 f.row.groups[0].nodes.push({name:`[${second}] 云图节点`,label:'云图节点',sourceId:second,source:'Two',type:'ss',delay:30});
 f.row.groups[0].selected=`[${second}] 云图节点`;
 f.click('view');await flush();
 assert.ok(f.root.innerHTML.includes('另有 1 个已启用订阅'));
 assert.ok(f.root.innerHTML.includes('>Two<'));
});
test('订阅卡点卡片＝查看/选中（不改启用态）；启用/停用只由卡内开关承担（H5）',async()=>{
 const f=fixture();await flush();
 const first='sub-00000000-0000-0000-0000-000000000001';
 f.row.subscriptions.push({id:'sub-00000000-0000-0000-0000-000000000002',name:'Two',enabled:false,status:'ready',nodeCount:3,hasCache:true});
 f.click('view');await flush();f.click('section-providers');
 assert.ok(new RegExp(`data-sub="${first}"[^>]*data-active=`).test(f.root.innerHTML));
 assert.ok(/data-action="toggle-sub"[^>]*role="switch" aria-checked="true"/.test(f.root.innerHTML),'启用态由卡内开关表达');
 f.cardClick(first);await flush();
 assert.equal(f.calls.some(c=>c.method==='clash.subscriptionToggle'),false,'点卡片不下发切换');
 assert.ok(/data-sub="[^"]+" data-active="true"/.test(f.root.innerHTML),'点后成为活动卡');
 f.clickWhere('toggle-sub',b=>b.dataset.id===first);await flush();
 const call=f.calls.find(c=>c.method==='clash.subscriptionToggle');
 assert.ok(call,'开关发切换');assert.equal(call.params.enabled,false);
});
test('删除先删后撤销：5 秒内撤销不落盘；超时才真正删除（H6）',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 const id='sub-00000000-0000-0000-0000-000000000001';
 f.clickWhere('delete',b=>b.dataset.id===id);await flush();
 assert.equal(f.calls.some(c=>c.method==='clash.subscriptionRemove'),false,'删除先不落盘');
 assert.ok(f.root.innerHTML.includes('5 秒内可撤销'),'给撤销入口');
 f.click('undo-delete');await flush();
 assert.equal(f.calls.some(c=>c.method==='clash.subscriptionRemove'),false,'撤销后仍不落盘');
 assert.ok(f.root.innerHTML.includes('One'),'订阅恢复');
 f.clickWhere('delete',b=>b.dataset.id===id);await flush();
 await f.fire();await flush();
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionRemove').length,1,'超时才真正删除');
});
test('禁用控件有可读原因：内核停止时节点下拉写明「内核运行后可选」（H9）',async()=>{
 const f=fixture();await flush();f.row.running=false;f.click('view');await flush();
 assert.ok(f.root.innerHTML.includes('内核运行后可选'),'节点下拉有禁用原因');
});

// ───────────────────────── 局部更新 / IME / 新鲜度 / 重试 / 乐观回滚 ─────────────────────────
test('局部更新：轮询只改 data-live 读数，不重建 DOM（H1）',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.row.groups[0].selected='[sub-00000000-0000-0000-0000-000000000001] 香港节点';
 f.click('view');await flush();
 const before=f.htmlSets;
 const delay=f.live().find(e=>e.dataset.live==='delay');assert.ok(delay,'有延迟读数节点');
 assert.equal(delay.textContent,'20 ms','初始读数');
 f.row.groups[0].nodes[2].delay=233;
 await f.fire();await flush();await flush();
 assert.equal(f.htmlSets,before,'轮询未重建 DOM');
 const after=f.live().find(e=>e.dataset.live==='delay');
 assert.equal(after.textContent,'233 ms',`读数应更新，实际 ${after.textContent}；htmlSets ${before}->${f.htmlSets}`);
});
test('局部更新：滚动位置不受轮询影响，下拉触发器不被换掉（H1）',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 const pane=f.element('pane');pane.scrollTop=180;
 await f.fire();await flush();await flush();
 assert.equal(f.element('pane').scrollTop,180,'滚动不动');
 assert.ok(f.root.innerHTML.includes('id="node-pick"'),'下拉触发器仍在');
});
test('IME 保护：组合期间挂起重绘与局部更新，compositionend 后补一次（H2）',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.row.groups[0].selected='[sub-00000000-0000-0000-0000-000000000001] 香港节点';
 f.click('view');await flush();
 const before=f.htmlSets;
 f.compositionStart();
 f.row.groups[0].nodes[2].delay=99;
 await f.fire();await flush();await flush();
 assert.equal(f.htmlSets,before,'组合期间不重绘');
 const delayMid=f.live().find(e=>e.dataset.live==='delay');
 assert.equal(delayMid.textContent,'20 ms',`组合期间读数也不动，实际 ${delayMid.textContent}`);
 f.compositionEnd();await flush();
 assert.ok(f.htmlSets>before,'compositionend 后补一次重绘');
});
test('读数新鲜度：连续 3 次轮询失败 → 读数区标注停止更新（H12）',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 const before=f.htmlSets;
 f.failMethod('clash.view');
 for(let i=0;i<3;i++){await f.fire();await flush()}
 assert.equal(f.htmlSets,before,'降级提示走局部更新，不重建 DOM');
 const stamp=f.live().find(e=>e.dataset.live==='stamp');
 assert.ok(stamp&&stamp.textContent.includes('数据已停止更新'),'显示停止更新与重试');
});
test('错误可重试：横幅带「重试」，点一次重放上一次操作（H8）',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();f.click('section-providers');
 const err=new Error('PRIVATE');err.code='CONTROLLER_TIMEOUT';
 f.throwOn('clash.reload',err);
 f.click('reload');await flush();
 assert.ok(f.root.innerHTML.includes('重试'),'错误横幅有重试');
 const before=f.calls.filter(c=>c.method==='clash.reload').length;
 f.click('retry');await flush();await flush();
 assert.equal(f.calls.filter(c=>c.method==='clash.reload').length,before+1,'重试重放一次');
});
test('模式切换乐观更新，失败回滚并提示未生效（H7）',async()=>{
 const f=fixture();await flush();f.row.running=true;f.row.mode='rule';f.click('view');await flush();
 const err=new Error('offline');err.code='CONTROLLER_UNREACHABLE';
 f.throwOn('clash.mode',err);
 f.clickWhere('mode-set',b=>b.dataset.mode==='global');await flush();
 assert.ok(f.root.innerHTML.includes('未生效，已回到原状态'),'失败提示回滚');
 assert.ok(/data-action="mode-set"[^>]*data-mode="rule"[^>]*aria-pressed="true"/.test(f.root.innerHTML),'规则模式回滚为选中');
});

// ───────────────────────── 其它回归 ─────────────────────────
test('内核设置是独立页签，概览页不拖着输入框',async()=>{
 const f=fixture();await flush();
 assert.equal(f.element('kernel'),undefined);
 assert.ok(has(f,'section-settings'));
 f.click('section-settings');
 assert.ok(f.element('kernel'));
 assert.ok(f.root.innerHTML.includes('TUN 模式'));
 assert.ok(f.element('pane'));
});
test('页面版本跟随插件版本，顶部只有一行工具条',async()=>{
 const f=fixture();await flush();const html=f.root.innerHTML;
 assert.ok(html.includes('插件 v2.0.3'));
 assert.equal(html.includes('页面 v'),false);
 assert.equal((html.match(/class="toolbar/g)||[]).length,1);
 assert.ok(html.includes('id="pane"'));
 assert.equal(f.calls.some(c=>c.method==='clash.layout'),false);
});
test('系统信息补齐处理器、内存、内核来源与插件版本',async()=>{
 const f=fixture();await flush();const html=f.root.innerHTML;
 assert.ok(html.includes('Synthetic CPU · 16 核'));assert.ok(html.includes('64.00 GB'));
 assert.ok(html.includes('内置 mihomo'));assert.ok(html.includes('插件 v2.0.3'));
});
test('换节点成功后重新查询出口 IP 并替换面板',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();await flush();
 const ipCalls=()=>f.calls.filter(c=>c.method==='clash.ipInfo').length;
 assert.equal(ipCalls(),1,'首次进概览查一次');
 f.setIpReply({available:true,ip:'198.51.100.23',country:'美国',countryCode:'US',asn:'AS64500',isp:'ExampleNet',location:'美国 · 洛杉矶',timezone:'America/Los_Angeles'});
 await f.hooks().run('select',{group:'🚀 节点选择',name:'[sub-00000000-0000-0000-0000-000000000001] 香港节点'});
 await flush();await flush();
 assert.equal(ipCalls(),2,'换节点后再查一次');
 assert.ok(f.root.innerHTML.includes('198.51.100.***'));
 assert.equal(f.root.innerHTML.includes('203.0.113.***'),false);
});
test('shared/errors.mjs 的错误码表覆盖约定三类码，每条文案互不相同',()=>{
 for(const code of ['KERNEL_ATTACH_FAILED','KERNEL_STOP_UNCONFIRMED','PROXY_RESTORE_RECORD_INVALID',
  'PROXY_REGISTRY_READ_FAILED','PROXY_REGISTRY_WRITE_FAILED','CONTROLLER_UNREACHABLE','CONTROLLER_TIMEOUT',
  'SUBSCRIPTION_CORRUPT','PORT_IN_USE','PORT_BIND_DENIED','FILE_BUSY','PERMISSION_DENIED','RUNTIME_COPY_FAILED',
  'GATEWAY_ERROR','UNKNOWN_ERROR','EADDRINUSE','EACCES','EPERM','EBUSY',
  'COMMAND_FAILED','NOT_ACTIVE','UNKNOWN_METHOD','CAPABILITY_REQUIRED','BAD_HANDSHAKE','HANDSHAKE_REQUIRED','OPERATION_ERROR'])
  assert.equal(typeof errorMessages[code],'string',`缺少错误码 ${code}`);
 assert.equal(errorMessages.UNKNOWN_ERROR,'未识别错误，请重试；若反复出现，请打开插件日志查看原始错误码');
 const texts=Object.values(errorMessages);assert.equal(new Set(texts).size,texts.length);
});
test('页面按错误码展示专属文案（含原生码），原始 message 不透出',async()=>{
 for(const [code,text] of Object.entries(errorMessages)){
  const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
  const error=new Error('backend said: PRIVATE');error.code=code;
  f.throwOn('clash.proxy',error);f.click('proxy');await flush();
  assert.ok(alertsOf(f.root.innerHTML).some(t=>t.includes(`系统代理失败：${text}`)),`${code} 专属文案`);
  assert.equal(f.root.innerHTML.includes('PRIVATE'),false,`${code} 不漏原文`);
 }
});
test('未知错误码与无码异常折叠成「未识别错误」，不回显原文也不漏栈',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 const error=new Error('PRIVATE https://example.test/?token=PRIVATE');error.code='NOT_A_REAL_CODE';
 f.throwOn('clash.proxy',error);f.click('proxy');await flush();
 assert.ok(alertsOf(f.root.innerHTML).some(t=>t.includes(`系统代理失败：${errorMessages.UNKNOWN_ERROR}`)));
 assert.equal(f.root.innerHTML.includes('PRIVATE'),false);
 assert.equal(/at .*\.js:\d+/.test(f.root.innerHTML),false);
});
test('协议层码与宿主折叠常量都按文案呈现，不落到「未识别错误」',async()=>{
 for(const code of ['COMMAND_FAILED','NOT_ACTIVE','UNKNOWN_METHOD','CAPABILITY_REQUIRED','BAD_HANDSHAKE','HANDSHAKE_REQUIRED','OPERATION_ERROR']){
  const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
  const error=new Error('插件操作未完成');error.code=code;
  f.throwOn('clash.proxy',error);f.click('proxy');await flush();
  assert.ok(alertsOf(f.root.innerHTML).some(t=>t.includes(`系统代理失败：${errorMessages[code]}`)),`${code} 专属`);
 }
 const folded=fixture();await flush();folded.row.running=true;folded.click('view');await flush();
 folded.throwOn('clash.proxy',Error('插件操作未完成，请检查配置后重试'));folded.click('proxy');await flush();
 assert.ok(alertsOf(folded.root.innerHTML).some(t=>t.includes(`系统代理失败：${errorMessages.OPERATION_ERROR}`)));
});
test('原始 message 恰好是原型键名时不文案化，仍落到「未识别错误」',async()=>{
 for(const message of ['toString','constructor']){
  const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
  f.throwOn('clash.proxy',Error(message));f.click('proxy');await flush();
  assert.ok(alertsOf(f.root.innerHTML).some(t=>t.includes(`系统代理失败：${errorMessages.UNKNOWN_ERROR}`)));
 }
});
test('Clash 校验码沿用原话原文，按码查表',async()=>{
 const codes=['KERNEL_NOT_RUNNING','KERNEL_RUNNING_LOCK','PORT_RANGE_INVALID','SUBSCRIPTION_URL_INVALID',
  'NODE_UNAVAILABLE','TUN_UNSUPPORTED','SUBSCRIPTION_UPDATING','TUN_KERNEL_MISMATCH'];
 for(const code of codes){
  const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
  const error=new Error('raw backend text');error.code=code;
  f.throwOn('clash.proxy',error);f.click('proxy');await flush();
  assert.ok(alertsOf(f.root.innerHTML).some(t=>t.includes(`系统代理失败：${errorMessages[code]}`)),`${code} 原话`);
 }
 assert.equal(errorMessages.KERNEL_RUNNING_LOCK,'请先停止内核再更改配置');
 assert.equal(errorMessages.TUN_KERNEL_MISMATCH,'已安装的 TUN 服务绑定了另一个内核，请重新安装服务');
});
test('IP 查询失败按码呈现，无码异常退到「未识别错误」',async()=>{
 const f=fixture();await flush();f.row.running=true;
 const coded=new Error('controller said nothing');coded.code='CONTROLLER_TIMEOUT';
 f.throwOn('clash.ipInfo',coded);f.click('view');await flush();await flush();
 assert.ok(f.root.innerHTML.includes(`查询出口 IP 失败：${errorMessages.CONTROLLER_TIMEOUT}`));
 assert.equal(f.root.innerHTML.includes('controller said nothing'),false);
});
