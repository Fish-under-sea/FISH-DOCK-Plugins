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
 for(const cls of ['\\.listbox','\\.lb-filter','\\.lb-option','\\.lb-option\\[aria-selected=true\\]','\\.lb-option\\[data-active=true\\]','\\.lb-option\\[aria-disabled=true\\]','\\.lb-empty'])
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

// ───────── 2.1.4 尺寸刻度表 / 弹层尺寸 / 复制按钮移除 / 箭头 SVG / 滚轮守卫 ─────────
// 用户原话「ux 美化都要做视觉化调整大小与对齐」：先立刻度表，再逐处套用，禁止手写孤值。
test('尺寸刻度表落地：字号 13/12.5/12、行高 26/28、图标 16 盒、圆角 14/999，无孤值',()=>{
 const bare=pageCss.replace(/\/\*[\s\S]*?\*\//g,'');
 const values=re=>[...new Set([...bare.matchAll(re)].map(m=>m[1].trim()))];
 for(const v of values(/font-size:([^;}]+)/g))
  assert.ok(['13px','12.5px','12px','14px'].includes(v),`字号档外 ${v}（14px 只给 .lb-ico 图标盒）`);
 for(const v of values(/min-height:([^;}]+)/g))
  assert.ok(['26px','28px','44px','0'].includes(v),`行高档外 ${v}（0 是复位，不是档位）`);
 for(const v of values(/border-radius:([^;}]+)/g))
  assert.ok(['14px','999px'].includes(v),`圆角档外 ${v}`);
 assert.match(pageCss,/\.lb-option\{[^}]*min-height:28px[^}]*padding:2px 8px[^}]*font-size:12\.5px[^}]*line-height:18px/,'列表项按刻度 28 行高');
 assert.match(pageCss,/\.lb-ico\{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:16px\}/,'emoji 关进 16px 盒子');
 assert.match(pageCss,/\.kv\{[^}]*align-items:baseline[^}]*min-height:26px[^}]*line-height:26px/,'详情卡行高 26 + 基线对齐');
 assert.match(pageCss,/\.kv>\.k\{[^}]*line-height:26px/,'k 与 v 同一行高');
 assert.match(pageCss,/\.kv>\.v\{[^}]*line-height:26px/,'k 与 v 同一行高');
 assert.match(pageCss,/\.lb-option \.check\{[^}]*width:16px;height:16px/,'勾占固定盒，不随文字漂移');
 assert.match(pageCss,/\.listbox\{[^}]*padding:4px/,'弹层内边距 4，行距＝行高');
 assert.equal(/\.lb-option\{[^}]*margin/.test(pageCss),false,'选项之间不加 margin');
 assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(pageCss.slice(pageCss.indexOf('\n\n/* ── 顶部按钮行'))),false,'刻度表改写不动颜色 token');
});
test('emoji 前缀拆进 .lb-ico 图标盒，正文只留文字（整串符号保留原文）',()=>{
 const k=fixture().hooks();
 const ic=x=>{const r=k.splitIcon(x);return [r.icon,r.text]};
 assert.deepEqual(ic('🔵 微软服务'),['🔵','微软服务']);
 assert.deepEqual(ic('♻️ 自动选择'),['♻️','自动选择']);
 assert.deepEqual(ic('🇭🇰 香港 01'),['🇭🇰','香港 01']);
 assert.deepEqual(ic('Ⓜ️ 微软服务'),['Ⓜ️','微软服务']);
 assert.deepEqual(ic('DIRECT'),['','DIRECT']);
 assert.deepEqual(ic('香港 01'),['','香港 01']);
 assert.deepEqual(ic('🚀'),['','🚀'],'整串都是符号时保留原文，别把标签清空');
});
test('详情卡「复制」按钮全链移除，不留死代码',()=>{
 for(const gone of ['copyBtn','copyText','data-copy','已复制到剪贴板','复制失败，请手动全选后按 Ctrl+C'])
  assert.equal(pageJs.includes(gone),false,`复制链残留：${gone}`);
 assert.equal((pageJs.match(/data-action="copy"/g)||[]).length,0,'没有 copy 动作');
 assert.ok(pageJs.includes("button('ip-reveal'"),'IP 卡的显示/隐藏保留');
});
test('下拉箭头是 12×12 内联 SVG，两个触发器共用同一个盒子',()=>{
 assert.match(pageJs,/const CHEV='<svg class="chev" viewBox="0 0 12 12" width="12" height="12"/,'箭头是内联 SVG');
 assert.equal(/<span class="chev"[^>]*>⌄/.test(pageJs),false,'不再用文本字形当箭头（基线随回退字体漂移）');
 assert.equal((pageJs.match(/\$\{CHEV\}/g)||[]).length,1,'只有一处箭头模板，两个触发器共用');
 assert.match(pageCss,/\.combo-trigger \.chev\{flex:none;display:block;width:12px;height:12px/,'箭头盒子固定');
 assert.match(pageCss,/\.combo-trigger\{[^}]*align-items:center/,'箭头与文字同一行内居中');
});
test('弹层内滚轮不关闭弹层：onWheel 有 pop.contains 守卫，弹层自带 overscroll-behavior',()=>{
 assert.match(pageJs,/const onWheel=e=>\{const t=e\?\.target;if\(pop\.contains\?\.\(t\)\)return;closeListbox\(false\)\}/,'弹层内滚轮放行');
 assert.match(pageCss,/\.listbox\{[^}]*overscroll-behavior:contain/,'阻断滚动链外传');
});
// 两个触发器并排放在同一行：首列文字必须同一起点（代理组只有 [图标][文字][箭头]，
// 节点多一个延迟——用 space-between 时前者的文字会被推到中间，两个框文字起点差一大截）。
test('两个下拉触发器首列对齐：图标盒恒在、文字固定左靠、右侧元素贴右',()=>{
 assert.match(pageCss,/\.combo-trigger\{[^}]*justify-content:flex-start/,'触发器不许用 space-between 分配空余');
 assert.match(pageCss,/\.combo-trigger \.trigger-delay\{[^}]*margin-left:auto/,'有延迟时由延迟贴右');
 assert.match(pageCss,/\.combo-trigger:not\(:has\(\.trigger-delay\)\) \.chev\{[^}]*margin-left:auto/,'无延迟时由箭头贴右');
 const trigger=pageJs.slice(pageJs.indexOf('function comboTrigger'),pageJs.indexOf('function subscriptionCard'));
 assert.ok(trigger.includes('class="lb-ico"'),'触发器必须有图标盒（哪怕没有 emoji）');
 assert.equal(/icon\?`<span class="lb-ico"/.test(trigger),false,'图标盒不许按条件省略，否则首列随 emoji 有无而漂移');
});
// 反面清单（docs/developers/design-language.md）：grid/flex 容器被外层 stretch 拉高后，
// align-content:normal(=stretch) 会把多余高度均摊给每一行 → 同一容器里「一个高一个低」。
test('被 stretch 拉高的容器不把多余高度摊给各行：grid 一律 align-content:start',()=>{
 for(const sel of ['.cards','.split','.subscriptions','.columns'])
  assert.match(pageCss,new RegExp(`${sel.replace('.','\\.')}\\{[^}]*align-content:start`),`${sel} 缺 align-content:start`);
 assert.match(pageCss,/\.cards>\.card\{[^}]*justify-content:flex-start/,'卡内 flex 不把多余高度摊给子行');
 assert.match(pageCss,/\.combo\{[^}]*justify-content:flex-start/,'下拉列不摊 gap（label 与触发器高度只由刻度表决定）');
});
test('详情卡行距只由行高决定：.kv 行包在 .kv-list 里，不吞 .card 的 8px 块间距',()=>{
 assert.equal((pageJs.match(/class="kv-list"/g)||[]).length,4,'Clash 信息 / 系统信息 / IP / 网站测试四处都用同一行组件');
 assert.match(pageCss,/\.kv-list\{[^}]*gap:0[^}]*align-content:start/,'行列表内不加 gap，行距＝行高');
});
test('描边口径：卡片与容器用 --line-hair，--line-control 只留给输入框/按钮/触发器',()=>{
 for(const sel of ['.card','.subscription','.listbox','.tun-box','.empty-card','.confirm-bar','.banner'])
  assert.match(pageCss,new RegExp(`${sel.replace('.','\\.')}\\{[^}]*border:1px (?:solid|dashed) var\\(--line-hair\\)`),`${sel} 应该用 hair 描边`);
 assert.match(pageCss,/\.combo-trigger\{[^}]*var\(--line-control\)/,'触发器属于控件，保留 control 描边');
 assert.match(pageCss,/\.lb-filter\{[^}]*var\(--line-control\)/,'输入框保留 control 描边');
 assert.match(pageCss,/\.segmented\{[^}]*var\(--line-control\)/,'分段控件是控件组，保留 control 描边');
});

// ───────────────────────── 测试夹具 ─────────────────────────
function fixture(prepare) {
 const calls=[],timers=new Map(),popped=[];let serial=0,html='',elements={},buttons=[],cards=[],liveEls=[],hooks=null;
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
    const a=attrs(m[0]);
    // 带 id 的按钮也要可按 id 取到：下拉触发器（#group-pick / #node-pick / #tunStack）是 button，
    // mountCombo 把 onclick 挂在 elements[id] 上，这里缺了就永远测不到弹层内部。
    if(a.id)elements[a.id]={...a,tagName:'BUTTON',value:'',disabled:m[0].includes('disabled'),scrollTop:0,scrollLeft:0,focus(){},setAttribute(){},getBoundingClientRect:()=>({left:0,top:0,bottom:28,width:280}),contains:()=>true};
    if(a['data-action'])buttons.push({dataset:{action:a['data-action'],id:a['data-id'],node:a['data-node'],group:a['data-group'],mode:a['data-mode'],section:a['data-section']},disabled:m[0].includes('disabled')});
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
  addEventListener:(type,fn)=>{if(listeners[type])listeners[type].push(fn)},
  appendChild(){},removeChild(){},insertBefore(){}
 };
 class FormData {
  constructor(form){this.id=form.id}
  get(key){return elements[this.id==='subscription-form'?`subscription-${key}`:key]?.value??null}
 }
 const context={document:{querySelector:()=>root,querySelectorAll:q=>root.querySelectorAll(q),createElement:()=>{const pop={style:{},setAttribute(){},appendChild(){},remove(){},focus(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},
    set innerHTML(value){this._html=value;popped.push(value)},get innerHTML(){return this._html??''}};return pop},activeElement:null,addEventListener:(t,fn)=>{(docListeners[t]||(docListeners[t]=[])).push(fn)},removeEventListener(){},documentElement:{clientHeight:800}},
  window:{addEventListener(){},removeEventListener(){},getSelection:()=>({isCollapsed:true}),innerHeight:800},
  navigator:{},AbortController,FormData,URL,structuredClone,
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  FishDock:{setLayout(){},call:async(method,params)=>{
   calls.push({method,params});
   if(failMethods.has(method)){const e=Error('backend said: PRIVATE');e.code='CONTROLLER_TIMEOUT';throw e}
   if(thrown&&thrown.method===method){const error=thrown.error;thrown=null;throw error}
   if(method==='clash.subscriptionSave'){await blocked;if(fail)throw Error('PRIVATE');}
   // 切换启用：假后端要真的改启用集（单选互斥），否则成功后的视图与真实内核不一致。
   if(method==='clash.subscriptionToggle'){const {id,enabled}=params;
    row.subscriptions=row.subscriptions.map(s=>s.id===id?{...s,enabled}:{...s,enabled:enabled?false:s.enabled})}
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
  // 弹层 HTML：createElement 的桩记录每次 paint() 写进去的 innerHTML。
  pops:()=>popped,
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
// 代理组弹层是用户实测截图里「选中咋这么大、很丑」的地方：emoji 撑高行 + 图标与文字不齐。
test('代理组弹层：每行都是 [16px 图标盒][固定勾盒][文字]，emoji 不再撑高行',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 const trigger=f.element('group-pick');assert.ok(trigger,'代理组触发器存在');
 trigger.onclick();await flush();
 const html=f.pops().at(-1);assert.ok(html,'弹层生成了选项');
 const options=(html.match(/class="lb-option"/g)||[]).length;
 assert.ok(options>0,'至少一行选项');
 assert.equal((html.match(/class="lb-ico"/g)||[]).length,options,'每行都有 16px 图标盒');
 assert.equal((html.match(/class="check"/g)||[]).length,options,'每行都有固定勾盒（勾不出现也不让文字移位）');
 assert.match(html,/class="lb-ico" aria-hidden="true">🚀</,'emoji 进了图标盒');
 assert.equal(/<span class="lb-label">🚀/.test(html),false,'正文不再带 emoji');
 assert.ok(html.includes('<span class="check" aria-hidden="true">✓</span>'),'选中项有勾');
});
test('节点弹层：延迟数字与状态点贴在一起靠右，读数不会被挤出去',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 const trigger=f.element('node-pick');assert.ok(trigger,'节点触发器存在');
 trigger.onclick();await flush();
 const html=f.pops().at(-1);assert.ok(html,'节点弹层生成了选项');
 assert.match(html,/class="lb-delay"><span class="dot good"/,'状态点跟着延迟数字');
 assert.ok(html.includes('20 ms'),'延迟文本仍在');
 assert.ok(html.includes('class="lb-ico"'),'节点名里的 emoji 同样进图标盒');
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
// 2.1.4 双向联动（H5 的口径已废止）：点卡＝高亮 + 切换启用，卡内开关等价，
// 高亮与启用态始终同步，失败一起回滚。四条用例把 ①卡→切换 ②开关→高亮 ③失败回滚 ④运行中可用 钉住。
test('点卡片＝高亮该卡＋切换启用（双向联动之一）',async()=>{
 const f=fixture();await flush();
 const first='sub-00000000-0000-0000-0000-000000000001',second='sub-00000000-0000-0000-0000-000000000002';
 f.row.subscriptions.push({id:second,name:'Two',enabled:false,status:'ready',nodeCount:3,hasCache:true});
 f.click('view');await flush();f.click('section-providers');
 f.cardClick(second);await flush();
 const call=f.calls.find(c=>c.method==='clash.subscriptionToggle');
 assert.ok(call,'点卡片必须发切换，不能只高亮');
 assert.equal(call.params.id,second);assert.equal(call.params.enabled,true);
 assert.ok(new RegExp(`data-sub="${second}" data-active="true"`).test(f.root.innerHTML),'新启用项成为高亮卡');
 assert.ok(new RegExp(`data-action="toggle-sub" data-id="${first}"[^>]*aria-checked="false"`).test(f.root.innerHTML),'其余订阅被自动关掉');
 assert.ok(new RegExp(`data-action="toggle-sub" data-id="${second}"[^>]*aria-checked="true"`).test(f.root.innerHTML),'卡内标签与启用态一致');
});
test('卡内开关改启用态时高亮跟随（双向联动之二）',async()=>{
 const f=fixture();await flush();
 const first='sub-00000000-0000-0000-0000-000000000001',second='sub-00000000-0000-0000-0000-000000000002';
 f.row.subscriptions.push({id:second,name:'Two',enabled:false,status:'ready',nodeCount:3,hasCache:true});
 f.click('view');await flush();f.click('section-providers');
 f.clickWhere('toggle-sub',b=>b.dataset.id===second);await flush();
 const tc=f.calls.find(c=>c.method==='clash.subscriptionToggle');
 assert.equal(tc.params.id,second);assert.equal(tc.params.enabled,true);
 assert.ok(new RegExp(`data-sub="${second}" data-active="true"`).test(f.root.innerHTML),'高亮跟随到新启用项');
 assert.ok(new RegExp(`data-sub="${first}" data-active="false"`).test(f.root.innerHTML),'旧卡不再高亮');
});
test('切换失败：启用态与高亮一起回滚，不留「高亮但已停用」（双向联动之三）',async()=>{
 const f=fixture();await flush();
 const first='sub-00000000-0000-0000-0000-000000000001',second='sub-00000000-0000-0000-0000-000000000002';
 f.row.subscriptions.push({id:second,name:'Two',enabled:false,status:'ready',nodeCount:3,hasCache:true});
 f.click('view');await flush();f.click('section-providers');
 f.throwOn('clash.subscriptionToggle',Object.assign(Error('PRIVATE'),{code:'SUBSCRIPTION_SWITCH_FAILED'}));
 f.cardClick(second);await flush();
 assert.ok(alertsOf(f.root.innerHTML).some(t=>t.includes(errorMessages.SUBSCRIPTION_SWITCH_FAILED)),'按码给文案');
 assert.equal(f.root.innerHTML.includes('PRIVATE'),false,'不漏后端原文');
 assert.ok(new RegExp(`data-sub="${second}" data-active="false"`).test(f.root.innerHTML),'高亮回滚');
 assert.ok(new RegExp(`data-action="toggle-sub" data-id="${second}"[^>]*aria-checked="false"`).test(f.root.innerHTML),'启用态回滚');
 assert.ok(new RegExp(`data-action="toggle-sub" data-id="${first}"[^>]*aria-checked="true"`).test(f.root.innerHTML));
});
// t5 F1（high）回归：首屏渲染就要把高亮落在启用项上。
// 这里此前只有「操作之后」的断言，加载路径没人测，所以 F1 能在 134 项全绿里活下来。
test('首屏渲染：高亮落在启用项上，且不存在「标签已启用但无高亮」（t5 F1 回归）',async()=>{
 const first='sub-00000000-0000-0000-0000-000000000001',second='sub-00000000-0000-0000-0000-000000000002';
 // prepare 在页面脚本执行前改 canned 视图，这样断言的是真正的首屏（不是点过刷新之后）
 const f=fixture(row=>{row.subscriptions.push({id:second,name:'Two',enabled:false,status:'ready',nodeCount:3,hasCache:true})});
 await flush();await flush();
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionToggle').length,0,'首屏不允许出现切换动作');
 f.click('section-providers');
 const html=f.root.innerHTML;
 const pairs=[...html.matchAll(/<article class="subscription" data-sub="([^"]+)" data-active="(true|false)"[\s\S]*?aria-checked="(true|false)"/g)]
  .map(m=>({id:m[1],active:m[2],checked:m[3]}));
 assert.equal(pairs.length,2,'两张订阅卡');
 for(const card of pairs)assert.equal(card.active,card.checked,`${card.id}：高亮必须与启用态一致`);
 assert.deepEqual(pairs.filter(c=>c.active==='true').map(c=>c.id),[first],'只有启用那条高亮');
});
test('内核运行中也允许点卡热切换：只有局部「切换中…」，不整页禁用（双向联动之四）',async()=>{
 const f=fixture();await flush();f.row.running=true;
 const second='sub-00000000-0000-0000-0000-000000000002';
 f.row.subscriptions.push({id:second,name:'Two',enabled:false,status:'ready',nodeCount:3,hasCache:true});
 f.click('view');await flush();f.click('section-providers');
 assert.equal(f.buttons().find(b=>b.dataset.action==='toggle-sub'&&b.dataset.id===second).disabled,false,'运行中开关不再置灰');
 const pending=f.cardClick(second);
 assert.ok(f.root.innerHTML.includes('切换中…'),'只显示局部 busy');
 assert.ok(f.root.innerHTML.includes('aria-busy="true"'),'卡片带 aria-busy');
 assert.equal(f.buttons().find(b=>b.dataset.action==='section-overview').disabled,false,'页面其余部分没有被禁用');
 await pending;await flush();
 assert.ok(f.calls.some(c=>c.method==='clash.subscriptionToggle'),'运行中也发热切换');
 assert.ok(new RegExp(`data-sub="${second}" data-active="true"`).test(f.root.innerHTML));
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

// ───────── t12 修复（t5 findings）回归 ─────────
// F1：过滤框键入不能被 key() 的 type-ahead 吞掉；可打印键交还原生 input，special 键仍归 listbox。
test('F1 过滤框键入不吞字符：可打印键交还原生 input，输入后列表按 query 过滤',()=>{
 const f=fixture();const k=f.hooks();
 const filterTarget={closest:sel=>sel==='.lb-filter'?{}:null};
 for(const ch of ['h','k',' ']) assert.equal(k.keyRoute(filterTarget,ch),'native',`过滤框可打印键 ${JSON.stringify(ch)} 应放行`);
 for(const key of ['ArrowDown','ArrowUp','Home','End','Enter','Escape','Tab']) assert.equal(k.keyRoute(filterTarget,key),'list',`过滤框 ${key} 仍归 listbox`);
 assert.equal(k.keyRoute(null,'h'),'list','弹层自身仍可 type-ahead');
 const items=[{label:'HK-03 香港 03'},{label:'JP-01 东京 01'},{label:'HK-09 香港 09'}];
 // 键入 'hk'：输入框保留 hk（放行给原生），oninput 用 filterItems 过滤后只剩含 hk 的项。
 assert.deepEqual(k.filterItems(items,'hk').map(i=>i.label),['HK-03 香港 03','HK-09 香港 09']);
});
// F2/F3/F6：结构重绘先收弹层；逐条更新用与 UI 判定一致的 ops 键；焦点可见 + 无 loading 死分支。
test('F2/F3/F6 结构重绘先 closeListbox、逐条更新键一致、焦点可见且无 loading 死分支',()=>{
 const drawHead=/function draw\(\)\{[\s\S]*?const active=document\.activeElement/.exec(pageJs)?.[0]??'';
 assert.ok(drawHead.includes('closeListbox(false)'),'draw 入口先 closeListbox(false)');
 assert.ok(pageJs.includes("{key:'update:'+id}"),'逐条更新传 opts.key=update:id');
 assert.match(pageCss,/\.combo-trigger:focus-visible/,'combo-trigger 有 focus-visible');
 assert.match(pageCss,/\.lb-option:focus-visible/,'lb-option 有 focus-visible');
 assert.equal(/cfg\.loading/.test(pageJs),false,'cfg.loading 死分支已删除');
});
// F4：dark 三态对 --layer-1 对比度 ≥6:1（值从 page.css token 读取，不引外部依赖）。
test('F4 dark 三态对 layer-1 对比度 ≥6:1',()=>{
 const darkStart=pageCss.indexOf('\n:root{');
 assert.ok(darkStart>=0,'定位 dark token 块');
 const lightStart=pageCss.indexOf('\n:root[data-dock-theme=light]',darkStart);
 assert.ok(lightStart>darkStart,'定位 light token 块');
 const dark=pageCss.slice(darkStart,lightStart);
 const get=n=>{const m=new RegExp('--'+n.replace('-','\\-')+':\\s*(#[0-9a-fA-F]{6})').exec(dark);assert.ok(m,`缺少 token --${n}`);return m[1]};
 const chl=c=>{const v=parseInt(c,16)/255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4};
 const Lum=hex=>{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return 0.2126*chl(r)+0.7152*chl(g)+0.0722*chl(b)};
 const ratio=(a,b)=>(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
 const layer=Lum(get('layer-1'));
 for(const tok of ['c-ok','c-warn','c-bad']){
  const r=ratio(Lum(get(tok)),layer);
  assert.ok(r>=6,`dark --${tok} 对 layer-1 对比度 ${r.toFixed(2)} < 6`);
 }
 assert.equal(get('c-bad').toLowerCase(),'#ff5a4f','dark c-bad 已调亮');
});
// F5：stale 时给真切「重试」按钮，点它重放 clash.view（不再是死文本）。
test('F5 stale 的「重试」是真按钮，点击重放 clash.view',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 assert.ok(f.buttons().some(b=>b.dataset.action==='retry-view'),'重试是真按钮(data-action)');
 assert.ok(f.root.innerHTML.includes('retry-inline'),'重试按钮带 retry-inline');
 const before=f.calls.filter(c=>c.method==='clash.view').length;
 f.click('retry-view');await flush();await flush();
 assert.ok(f.calls.filter(c=>c.method==='clash.view').length>before,'点重试重放 clash.view');
});
// F7：额度条 .usage-fill 参与局部更新（width 与 hot/warm 随轮询同步，不再冻结）。
test('F7 额度条随局部更新同步宽度与 hot/warm',async()=>{
 const f=fixture();await flush();f.row.running=true;
 const id='sub-00000000-0000-0000-0000-000000000001';
 f.row.subscriptions[0].userInfo={total:1000,used:100,upload:0,download:100,expire:0};
 f.click('view');await flush();
 const bar=()=>f.live().find(e=>e.dataset.live==='trafficbar'&&e.dataset.liveId===id);
 assert.ok(bar(),'额度条带 data-live=trafficbar');
 const before=f.htmlSets;
 f.row.subscriptions[0].userInfo={total:1000,used:950,upload:0,download:950,expire:0};
 await f.fire();await flush();await flush();
 assert.equal(f.htmlSets,before,'走局部更新，不重建 DOM');
 assert.match(String(bar().style.width||''),/^95%$/,'宽度更新到 95%');
 assert.ok(String(bar().className).includes('hot'),'≥90% 用 hot 色');
});
