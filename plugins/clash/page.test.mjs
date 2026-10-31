import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(r=>setImmediate(r));
// Minimal DOM adapter for testing actual page event handlers; visual/WebView QA remains separate.
function fixture() {
 const calls=[],timers=new Map();let serial=0,html='',elements={},buttons=[],cards=[],blocked=null,fail=false,ipReply=null;
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
 const root={
  get innerHTML(){return html},
  set innerHTML(value){
   html=value;elements={};buttons=[];cards=[];
   // div 也收：节点列表的滚动容器就是带 id 的 div，重绘后要能拿回它的 scrollTop。
   // article 也收：订阅卡整张可点，靠 data-sub 找到它。
   for(const m of value.matchAll(/<(?:input|form|details|select|div|article|section)\b[^>]*>/g)){
    const a=attrs(m[0]);
    if(a.id)elements[a.id]={...a,tagName:(/^<(\w+)/.exec(m[0])?.[1]??'').toUpperCase(),value:a.value??'',open:m[0].includes(' open'),disabled:m[0].includes('disabled'),scrollTop:0,scrollLeft:0,focus(){}};
    if(a['data-sub'])cards.push({dataset:{sub:a['data-sub']},enabled:a['aria-checked']==='true',onclick:null,onkeydown:null});
   }
   for(const m of value.matchAll(/<button\b[^>]*>/g)){
    const a=attrs(m[0]);if(a['data-action'])buttons.push({dataset:{action:a['data-action'],id:a['data-id'],node:a['data-node'],group:a['data-group'],mode:a['data-mode'],section:a['data-section']},disabled:m[0].includes('disabled')});
   }
  },
  querySelector:q=>elements[q.slice(1)]??null,
  querySelectorAll:q=>q==='[data-sub]'?cards:buttons
 };
 class FormData {
  constructor(form){this.id=form.id}
  get(key){return elements[this.id==='subscription-form'?`subscription-${key}`:key]?.value??null}
 }
 const context={document:{querySelector:()=>root,activeElement:null},window:{addEventListener(){}},FormData,URL,
  setTimeout:fn=>{timers.set(++serial,fn);return serial},clearTimeout:id=>timers.delete(id),
  FishDock:{setLayout(){},call:async(method,params)=>{
   calls.push({method,params});
   if(method==='clash.subscriptionSave'){await blocked;if(fail)throw Error('PRIVATE');}
   if(method==='clash.ipInfo')return ipReply??{available:true,ip:'203.0.113.7',country:'日本',countryCode:'JP',
    asn:'AS2516',isp:'KDDI',org:'KDDI Corporation',location:'日本 · 东京 · 千代田',timezone:'Asia/Tokyo'};
   if(method==='clash.details')return params.section==='rules'
    ?{count:3,rules:[{type:'MATCH',payload:'',proxy:'🐟 漏网之鱼'},
      {type:'GEOSITE',payload:'cn',proxy:'🎯 全球直连'},{type:'IP-CIDR',payload:'192.168.0.0/16',proxy:'🎯 全球直连'}]}
    :{count:2,uploadTotal:2048,downloadTotal:4096,connections:[
      {id:'c1',network:'tcp',host:'example.test',destination:'203.0.113.9:443',source:'127.0.0.1',
       chains:['🚀 节点选择','香港节点'],rule:'DomainSuffix test',upload:1024,download:2048,start:'2026-10-31T09:00:00.000Z'},
      {id:'c2',network:'tcp',host:'google.com',destination:'142.250.0.1:443',source:'127.0.0.1',
       chains:['🚀 节点选择','DIRECT'],rule:'GEOSITE google',upload:0,download:0,start:'2026-10-31T09:05:00.000Z'}]};
   if(method==='clash.nodeTest')return {group:params.group??'',tested:2,delays:[
    {name:'[sub-00000000-0000-0000-0000-000000000001] 香港节点',delay:42},{name:'DIRECT',delay:null}]};
   if(method==='clash.siteTest')return {node:'[sub-00000000-0000-0000-0000-000000000001] 香港节点',sites:[
    {key:'apple',label:'Apple',url:'https://www.apple.com/library/test/success.html',delay:128,ok:true},
    {key:'github',label:'GitHub',url:'https://github.com/favicon.ico',delay:null,ok:false},
    {key:'google',label:'Google',url:'https://www.google.com/generate_204',delay:null,ok:false},
    {key:'youtube',label:'YouTube',url:'https://www.youtube.com/favicon.ico',delay:null,ok:false}]};
   return structuredClone(row);
  }}};
 vm.runInNewContext(readFileSync(new URL('./page.js',import.meta.url),'utf8'),context);
 return {calls,row,timers,root,element:id=>elements[id],buttons:()=>buttons,cards:()=>cards,
  // 页面用 document.activeElement 判断「下拉是否展开」，夹具照真实 DOM 的最小面提供。
  setActive:el=>{context.document.activeElement=el},
  click:(action,section)=>{const button=buttons.find(b=>b.dataset.action===action
   &&(section===undefined||b.dataset.section===section));assert.ok(button,`${action}${section?`(${section})`:''}`);return button.onclick()},
  // 订阅卡整张可点：卡内按钮不算（真实 DOM 用 closest 判断，夹具传 null 表示点在卡片本身）。
  cardClick:id=>{const card=cards.find(c=>c.dataset.sub===id);assert.ok(card,`订阅卡 ${id}`);return card.onclick({target:{closest:()=>null}})},
  setIpReply:value=>{ipReply=value},
  block:()=>{let release;blocked=new Promise(r=>release=r);return release},fail:()=>{fail=true}};
}
// 从渲染结果里按出现顺序取节点原始名：验证过滤与排序只靠 DOM 顺序，不靠后端。
const nodeNames=html=>[...html.matchAll(/<button\b[^>]*>/g)].map(m=>m[0])
 .filter(tag=>/data-action="node"/.test(tag)).map(tag=>/data-node="([^"]*)"/.exec(tag)?.[1]??'');
test('sandbox 页面点击保存订阅直接调用 RPC，并读取实时输入而非依赖 oninput',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='Click save';
 f.element('subscription-url').value='https://example.test/sub?token=synthetic';
 const release=f.block();
 f.click('save-subscription');
 f.click('save-subscription');
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionSave').length,1);
 assert.equal(f.calls.find(c=>c.method==='clash.subscriptionSave').params.name,'Click save');
 assert.equal(f.calls.find(c=>c.method==='clash.subscriptionSave').params.url,'https://example.test/sub?token=synthetic');
 assert.match(f.root.innerHTML, /type="button"[^>]*data-action="save-subscription"/);
 release();await flush();
});
test('sandbox 页面内核设置保存按钮直接调用 RPC',async()=>{
 const f=fixture();await flush();f.click('section-settings');
 f.element('kernel').value='D:/new/mihomo.exe';
 f.element('mixedPort').value='7897';
 f.click('save-config');await flush();
 const saved=f.calls.find(c=>c.method==='clash.save');assert.ok(saved);
 assert.equal(saved.params.kernel,'D:/new/mihomo.exe');assert.equal(saved.params.mixedPort,7897);
});
test('sandbox 页面输入框回车走同一保存路径，无原生表单提交',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='Keyboard save';f.element('subscription-url').value='https://example.test/sub';
 let prevented=false;
 f.element('subscription-form').onkeydown({key:'Enter',target:{tagName:'INPUT'},preventDefault(){prevented=true}});
 await flush();assert.equal(prevented,true);
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionSave').length,1);
});
test('page retains drafts after refresh/failure and suppresses double submission while awaiting save',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='Draft';
 f.element('subscription-url').value='https://example.test/?token=synthetic';
 f.element('subscription-form').oninput();
 f.click('view');await flush();
 assert.equal(f.element('subscription-name').value,'Draft');
 assert.equal(f.element('subscription-url').value,'https://example.test/?token=synthetic');
 const release=f.block();f.fail();
 f.element('subscription-form').onsubmit({preventDefault(){}});
 f.element('subscription-form').onsubmit({preventDefault(){}});
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionSave').length,1);
 release();await flush();
 assert.equal(f.element('subscription-name').value,'Draft');
 assert.equal(f.root.innerHTML.includes('PRIVATE'),false);
});
test('background updating polls without blocking navigation; deletion needs inline confirmation',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.row.subscriptions[0].updating=true;f.click('update');await flush();
 assert.ok(f.timers.size);assert.ok(f.root.innerHTML.includes('更新中'));
 assert.ok(f.root.innerHTML.includes('取消更新'));
 f.click('section-nodes');assert.ok(f.root.innerHTML.includes('代理组'));
 f.row.subscriptions[0].updating=false;f.row.subscriptions[0].status='error';
 await [...f.timers.values()].at(-1)();f.click('section-providers');
 assert.ok(f.root.innerHTML.includes('更新失败'));
 f.click('delete');assert.equal(f.calls.some(c=>c.method==='clash.subscriptionRemove'),false);
 f.click('cancel-delete');assert.equal(f.calls.some(c=>c.method==='clash.subscriptionRemove'),false);
 f.click('delete');f.click('confirm-delete');await flush();
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionRemove').length,1);
});
test('保存订阅失败时显示后端可操作提示，但仍不泄露地址或凭据',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='9YUN';
 f.element('subscription-url').value='https://example.test/?token=PRIVATE';
 f.element('subscription-form').oninput();
 f.fail();
 f.element('subscription-form').onsubmit({preventDefault(){}});
 await flush();
 // 后端固定提示必须透出，用户才知道改哪里；但不得把地址/token 带进错误提示。
 assert.ok(f.root.innerHTML.includes('保存订阅失败'));
 const alerts=[...f.root.innerHTML.matchAll(/role="alert">([^<]*)</g)].map(m=>m[1]);
 assert.equal(alerts.some(t=>t.includes('PRIVATE')),false);
});
test('空订阅列表给出下一步指引，保存成功后提示更新并显示订阅卡',async()=>{
 const f=fixture();await flush();f.row.subscriptions=[];
 f.click('view');await flush();
 f.click('section-providers');
 assert.ok(f.root.innerHTML.includes('还没有订阅'));
 assert.ok(f.root.innerHTML.includes('下载并校验节点'));
 f.row.subscriptions=[{id:'sub-00000000-0000-0000-0000-000000000002',name:'9YUN',enabled:true,status:'pending',nodeCount:0,hasCache:false,error:''}];
 f.element('subscription-name').value='9YUN';
 f.element('subscription-url').value='https://example.test/sub';
 f.element('subscription-form').oninput();
 f.element('subscription-form').onsubmit({preventDefault(){}});
 await flush();
 assert.ok(f.root.innerHTML.includes('订阅已保存'));
 assert.ok(f.root.innerHTML.includes('9YUN'));
 assert.ok(f.root.innerHTML.includes('还没下载过节点'));
});
test('节点页渲染组卡网格：组名、当前选中、节点标签与来源、延迟与选中态',async()=>{
 const f=fixture();await flush();
 f.click('section-nodes');
 const html=f.root.innerHTML;
 assert.ok(html.includes('🚀 节点选择'),'组卡标题');
 assert.ok(html.includes('♻️ 自动选择'),'组内成员/当前选中');
 assert.ok(html.includes('香港节点'),'订阅节点标签去前缀');
 assert.ok(html.includes('One'),'来源订阅名');
 assert.ok(html.includes('20 ms'),'延迟显示');
 assert.ok(/aria-current="true"/.test(html),'当前选中节点高亮');
 assert.ok(html.includes('group-card'),'组卡容器');
 // 点击节点触发 select RPC，参数是带前缀的原始名（香港节点是最后一个 node 按钮）。
 f.row.running=true;f.click('view');await flush();
 const node=f.buttons().filter(b=>b.dataset.action==='node').at(-1);
 assert.ok(node,'存在订阅节点按钮');
 node.onclick();
 const call=f.calls.find(c=>c.method==='clash.select');
 assert.ok(call);
 assert.equal(call.params.group,'🚀 节点选择');
 assert.equal(call.params.name,'[sub-00000000-0000-0000-0000-000000000001] 香港节点');
});
test('点击组卡切换当前组，节点网格随之更新且不发 select',async()=>{
 const f=fixture();await flush();
 f.row.groups.push({name:'🎯 全球直连',selected:'DIRECT',nodes:[
  {name:'DIRECT',label:'DIRECT',sourceId:null,source:null,type:'Direct',delay:null},
  {name:'🚀 节点选择',label:'🚀 节点选择',sourceId:null,source:null,type:'group',delay:null}]});
 f.click('view');await flush();
 f.click('section-nodes');
 f.click('group-card');
 assert.ok(!f.calls.some(c=>c.method==='clash.select'),'切换组卡不发 select');
 assert.ok(f.root.innerHTML.includes('全球直连'),'节点网格切到新组');
});
test('订阅卡显示流量额度条；服务器没给额度时不渲染',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 // 无额度：不渲染 usage。
 assert.equal(f.root.innerHTML.includes('usage-bar'),false);
 // 有额度：显示条 + 百分比 + 到期。
 f.row.subscriptions[0].userInfo={upload:1073741824,download:2147483648,total:107374182400,used:3221225472,expire:1767225600};
 f.click('view');await flush();f.click('section-providers');
 const html=f.root.innerHTML;
 assert.ok(html.includes('usage-bar'),'额度条容器');
 assert.ok(html.includes('usage-fill'),'填充条');
 assert.ok(html.includes('3.00 GB'),'已用');
 assert.ok(html.includes('100.00 GB'),'总量');
 assert.ok(html.includes('剩余'),'剩余');
 assert.ok(/width:\s*3%/.test(html),'3% 填充');
 assert.ok(html.includes('到期'),'到期日期');
});
test('概览页默认渲染 Verge 式信息卡：订阅、当前节点、网络设置、代理模式、网站测试、IP、Clash、系统',async()=>{
 const f=fixture();await flush();
 const html=f.root.innerHTML;
 for(const title of ['订阅','当前节点','网络设置','代理模式','网站测试','IP 信息','Clash 信息','系统信息'])
  assert.ok(html.includes(title),`缺少卡片：${title}`);
 assert.ok(html.includes('v1.19.0'),'内核版本');
 assert.ok(html.includes('11 条'),'规则数量');
 assert.ok(html.includes('127.0.0.1:7895'),'系统代理地址');
 assert.ok(html.includes('Windows 10.0.26200'),'操作系统');
 assert.ok(html.includes('1 小时 2 分'),'运行时间');
});
test('节点页支持搜索过滤与按延迟排序，过滤结果只保留匹配项',async()=>{
 const f=fixture();await flush();f.click('section-nodes');
 assert.deepEqual(nodeNames(f.root.innerHTML),[
  '♻️ 自动选择','DIRECT','[sub-00000000-0000-0000-0000-000000000001] 香港节点']);
 f.element('node-search').value='香港';
 f.element('node-search').oninput({target:{value:'香港'},isComposing:false});
 assert.deepEqual(nodeNames(f.root.innerHTML),['[sub-00000000-0000-0000-0000-000000000001] 香港节点']);
 f.element('node-search').oninput({target:{value:''},isComposing:false});
 f.click('sort-delay');
 assert.deepEqual(nodeNames(f.root.innerHTML),[
  '[sub-00000000-0000-0000-0000-000000000001] 香港节点','♻️ 自动选择','DIRECT']);
 const sorted=f.root.innerHTML;
 assert.ok(/data-action="sort-delay"[^>]*aria-pressed="true"/.test(sorted),'排序按钮进入选中态');
});
test('节点页提供「只显示可用节点」过滤，未测速与超时节点被隐藏',async()=>{
 const f=fixture();await flush();f.click('section-nodes');
 f.click('only-available');
 assert.deepEqual(nodeNames(f.root.innerHTML),['[sub-00000000-0000-0000-0000-000000000001] 香港节点']);
});
// 手动测速：结果立刻覆盖列表里的旧延迟，并且参与「按延迟」排序。
test('节点测速按钮把结果写回列表并参与排序',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.click('view');await flush();
 f.click('section-nodes');
 assert.ok(f.root.innerHTML.includes('20 ms'),'视图里原有的延迟');
 f.click('node-test');await flush();
 const call=f.calls.find(c=>c.method==='clash.nodeTest');
 assert.ok(call,'点测速发 RPC');
 assert.equal(call.params.group,'🚀 节点选择','测的是当前组');
 assert.ok(f.root.innerHTML.includes('42 ms'),'测速结果覆盖列表显示');
 f.click('sort-delay');
 assert.deepEqual(nodeNames(f.root.innerHTML),[
  '[sub-00000000-0000-0000-0000-000000000001] 香港节点','♻️ 自动选择','DIRECT']);
});
test('内核运行时订阅区不再沉默禁用：给出先停止内核的说明与入口',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 f.click('section-providers');
 const html=f.root.innerHTML;
 assert.ok(html.includes('data-banner="kernel-running"'),'运行中横幅');
 assert.ok(html.includes('先停止内核'),'说明文案');
 assert.ok(f.buttons().some(b=>b.dataset.action==='stop-inline'),'就地停止入口');
 f.click('stop-inline');await flush();
 assert.ok(f.calls.some(c=>c.method==='clash.stop'),'点击后真的停止内核');
});
test('订阅名称为空或地址协议不合法时就地报错，不发保存请求',async()=>{
 const f=fixture();await flush();f.click('section-providers');
 f.element('subscription-name').value='';
 f.element('subscription-url').value='https://example.test/sub';
 f.click('save-subscription');await flush();
 assert.equal(f.calls.some(c=>c.method==='clash.subscriptionSave'),false,'空名称不提交');
 assert.ok(f.root.innerHTML.includes('请输入 1–80 字的订阅名称'),'名称就地提示');
 assert.ok(/id="subscription-name"[^>]*aria-invalid="true"/.test(f.root.innerHTML),'标记无效字段');
 f.element('subscription-name').value='A';
 f.element('subscription-url').value='ftp://example.test/sub';
 f.click('save-subscription');await flush();
 assert.equal(f.calls.some(c=>c.method==='clash.subscriptionSave'),false,'错误协议不提交');
 assert.ok(f.root.innerHTML.includes('订阅地址必须以 http:// 或 https:// 开头'),'地址就地提示');
 f.element('subscription-url').value='https://example.test/sub';
 f.click('save-subscription');await flush();
 assert.equal(f.calls.filter(c=>c.method==='clash.subscriptionSave').length,1,'合法值正常提交');
});
test('网站测试展示各站点延迟与超时状态',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();
 assert.ok(f.root.innerHTML.includes('未测试'),'未测试时的初始态');
 f.click('site-test');await flush();
 const html=f.root.innerHTML;
 assert.ok(html.includes('128 ms'),'成功站点显示延迟');
 assert.ok(html.includes('超时'),'失败站点显示超时');
 assert.ok(html.includes('Apple')&&html.includes('YouTube'),'四个站点都在');
});
test('IP 卡片默认脱敏展示，点开后显示完整地址',async()=>{
 const f=fixture();await flush();f.row.running=true;f.click('view');await flush();await flush();
 const html=f.root.innerHTML;
 assert.ok(html.includes('203.0.113.***'),'默认脱敏');
 assert.equal(html.includes('203.0.113.7'),false,'默认不泄露完整 IP');
 assert.ok(html.includes('AS2516'),'ASN 展示');
 f.click('ip-reveal');
 assert.ok(f.root.innerHTML.includes('203.0.113.7'),'点开后显示完整 IP');
});
test('网络设置与代理模式反映实际状态，开关按钮带切换语义',async()=>{
 const f=fixture();await flush();f.row.running=true;f.row.systemProxy=true;f.row.mode='global';
 f.click('view');await flush();
 const html=f.root.innerHTML;
 assert.ok(/<button[^>]*data-action="proxy"[^>]*aria-checked="true"/.test(html),'系统代理已开');
 assert.ok(/<button[^>]*data-action="mode-set"[^>]*data-mode="global"[^>]*aria-pressed="true"/.test(html),'全局模式选中');
 f.click('mode-set');await flush();
 assert.ok(f.calls.some(c=>c.method==='clash.mode'&&c.params.mode==='rule'),'默认切回规则模式');
});
// 内核运行时每 1.2 秒轮询重绘，重绘会换掉整块 DOM。下拉框的展开列表挂在元素上，
// 元素一换就消失——用户看到的是「点一下很快消失，节点选不了」。
test('节点下拉展开期间不重绘，收起后补一次',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.click('view');await flush();
 const picker=f.element('node-pick');
 assert.ok(picker,'概览卡应有节点下拉');
 f.setActive(picker);
 const pollers=[...f.timers.values()];
 assert.ok(pollers.length>=1,'running 时应排了轮询');
 await pollers.at(-1)();await flush();
 assert.equal(f.element('node-pick'),picker,'展开期间不重建 DOM，下拉不会被换掉');
 f.setActive(null);
 picker.onblur();
 assert.notEqual(f.element('node-pick'),picker,'收起后补一次重绘，数据不积压');
});
// 同一个重绘的另一个副作用：内容区会滚回顶部，用户往下滑一格轮询一次就被弹回去。
test('轮询重绘不把内容区滚回原点',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.click('view');await flush();
 f.click('section-nodes');
 const pane=f.element('pane');
 assert.ok(pane,'内容区应有统一滚动容器');
 pane.scrollTop=260;
 const pollers=[...f.timers.values()];
 assert.ok(pollers.length>=1,'running 时应排了轮询');
 await pollers.at(-1)();await flush();
 assert.equal(f.element('pane').scrollTop,260,'重绘后滚动位置要放回去');
});
// 更糟的一种：用户还在滚，整块 DOM 被换掉，滚动条直接归零——表现就是「一滑就被拉回」。
test('用户滚动期间不重绘 DOM',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.click('view');await flush();
 const pane=f.element('pane');
 pane.onscroll();
 const pollers=[...f.timers.values()];
 await pollers.at(-1)();await flush();
 assert.equal(f.element('pane'),pane,'滚动刚结束时不重建 DOM，滚动不被打断');
});
// 运行中也能切 TUN：按钮不能因为内核在跑就禁用（后端会重启内核来换）。
test('内核运行时 TUN 开关仍可点',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.row.tun={enable:false,stack:'mixed'};
 f.row.tunService={installed:true,state:'running',canElevate:true};
 f.click('view');await flush();
 const button=f.buttons().find(b=>b.dataset.action==='tun-toggle');
 assert.ok(button,'概览的网络设置卡应有 TUN 开关');
 assert.equal(button.disabled,false,'运行中要能直接切 TUN');
 assert.ok(f.root.innerHTML.includes('切换会重启内核'),'要告诉用户这一下会重启内核');
});
// 概览不再把所有已启用订阅铺开：只讲当前节点所用的那条，其余一句话带过。
test('概览只显示当前节点所用的订阅，其余订阅折叠成一行',async()=>{
 const f=fixture();await flush();f.row.running=true;
 const second='sub-00000000-0000-0000-0000-000000000002';
 f.row.subscriptions.push({id:second,name:'Two',enabled:true,status:'ready',nodeCount:3,hasCache:true});
 f.row.groups[0].nodes.push({name:`[${second}] 云图节点`,label:'云图节点',sourceId:second,source:'Two',type:'ss',delay:30});
 f.row.groups[0].selected=`[${second}] 云图节点`;
 f.click('view');await flush();
 const html=f.root.innerHTML;
 assert.ok(html.includes('另有 1 个已启用订阅'),'其余订阅折叠成一行');
 assert.ok(html.includes('>Two<'),'当前节点属于第二条订阅：概览就显示它');
 assert.ok(!html.includes('>One<'),'没在用的那条不铺开');
});
test('订阅页点卡片即切换启用，启用中的卡片高亮',async()=>{
 const f=fixture();await flush();
 const first='sub-00000000-0000-0000-0000-000000000001';
 f.row.subscriptions.push({id:'sub-00000000-0000-0000-0000-000000000002',name:'Two',enabled:false,status:'ready',nodeCount:3,hasCache:true});
 f.click('view');await flush();f.click('section-providers');
 const html=f.root.innerHTML;
 assert.ok(new RegExp(`data-sub="${first}"[^>]*role="switch" aria-checked="true"`).test(html),'启用卡高亮');
 assert.ok(/role="switch" aria-checked="false"/.test(html),'未启用卡不高亮');
 assert.equal(/data-action="toggle"/.test(html),false,'不再保留启用/停用按钮');
 assert.ok(html.includes('点卡片切换'),'卡片上写明可点');
 f.cardClick(first);await flush();
 const call=f.calls.find(c=>c.method==='clash.subscriptionToggle');
 assert.ok(call,'点卡片发切换请求');
 assert.equal(call.params.id,first);
 assert.equal(call.params.enabled,false,'当前启用，点一下变停用');
});
// 内核设置从「每页最底下的折叠条」变成独立页签：不再把面板顶长，也不再每页都拖着它。
test('内核设置是独立页签，概览页不再拖着那坨输入框',async()=>{
 const f=fixture();await flush();
 assert.equal(f.element('kernel'),undefined,'概览页不该有内核输入框');
 assert.ok(f.buttons().some(b=>b.dataset.action==='section-settings'),'页签里有内核设置');
 assert.equal(f.buttons().some(b=>b.dataset.action==='section-rules'),false,'规则页签已移除');
 assert.equal(f.buttons().some(b=>b.dataset.action==='section-connections'),false,'连接页签已移除');
 f.click('section-settings');
 assert.ok(f.element('kernel'),'切过去才渲染内核输入');
 assert.ok(f.root.innerHTML.includes('TUN 模式'),'TUN 段跟着走');
 assert.ok(f.element('pane'),'内容区是统一的内滚容器');
});
test('页面版本跟随插件版本，单双栏切换与顶部工具条一并去掉',async()=>{
 const f=fixture();await flush();
 const html=f.root.innerHTML;
 assert.ok(html.includes('插件 v2.0.3'),'显示插件版本');
 assert.equal(html.includes('页面 v'),false,'不再有独立的页面版本号');
 assert.equal(/data-action="double"/.test(html),false,'没有双栏按钮');
 assert.equal(/data-action="single"/.test(html),false,'没有单栏按钮');
 const head=html.indexOf('id="headbar"'),tabs=html.indexOf('data-action="section-overview"'),start=html.indexOf('data-action="start"');
 assert.ok(head>0&&tabs>head&&start>tabs,'页签与启停、刷新在同一个头部行里');
 assert.equal((html.match(/class="toolbar/g)||[]).length,1,'只有一行工具条，不折成上下两行');
 assert.ok(html.includes('id="pane"'),'内容区是统一的内滚容器，不把面板顶长');
 assert.equal(f.calls.some(c=>c.method==='clash.layout'),false,'不再发 layout RPC');
});
test('系统信息补齐处理器、内存、内核来源与插件版本',async()=>{
 const f=fixture();await flush();
 const html=f.root.innerHTML;
 assert.ok(html.includes('Synthetic CPU · 16 核'),'处理器');
 assert.ok(html.includes('64.00 GB'),'内存');
 assert.ok(html.includes('内置 mihomo'),'内核来源');
 assert.ok(html.includes('插件 v2.0.3'));
});
// 出口 IP 查不到不是错误：能力缺失或代理不通都属于「暂时没有」，不该顶一条红字告警。
test('出口 IP 不可用时按普通提示显示，不用红色告警',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.setIpReply({available:false,reason:'当前运行时不支持查询出口 IP'});
 f.click('view');await flush();await flush();
 const html=f.root.innerHTML;
 assert.ok(html.includes('当前运行时不支持查询出口 IP'),'原因透出');
 const alerts=[...html.matchAll(/role="alert">([^<]*)</g)].map(m=>m[1]);
 assert.equal(alerts.some(text=>text.includes('不支持')),false,'不作为告警渲染');
 assert.ok(html.includes('重试'),'给重试入口');
});
