import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(r=>setImmediate(r));
// Minimal DOM adapter for testing actual page event handlers; visual/WebView QA remains separate.
function fixture() {
 const calls=[],timers=new Map();let serial=0,html='',elements={},buttons=[],blocked=null,fail=false;
 const row={kernel:'D:/mihomo.exe',mixedPort:7895,controllerPort:9099,configured:true,running:false,
  version:'v1.19.0',rulesCount:11,uptimeMs:3723000,os:'Windows 10.0.26200',
  tun:{enable:false,stack:'mixed'},systemProxy:false,groups:[
  {name:'🚀 节点选择',selected:'♻️ 自动选择',nodes:[
   {name:'♻️ 自动选择',label:'♻️ 自动选择',sourceId:null,source:null,type:'group',delay:null},
   {name:'DIRECT',label:'DIRECT',sourceId:null,source:null,type:'Direct',delay:null},
   {name:'[sub-00000000-0000-0000-0000-000000000001] 香港节点',label:'香港节点',sourceId:'sub-00000000-0000-0000-0000-000000000001',source:'One',type:'ss',delay:20}]}],
  subscriptions:[{id:'sub-00000000-0000-0000-0000-000000000001',name:'One',enabled:true,status:'ready',nodeCount:2,hasCache:true}],
  layout:'single',mode:'rule'};
 const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
 const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
 const root={
  get innerHTML(){return html},
  set innerHTML(value){
   html=value;elements={};buttons=[];
   // div 也收：节点列表的滚动容器就是带 id 的 div，重绘后要能拿回它的 scrollTop。
   for(const m of value.matchAll(/<(?:input|form|details|select|div)\b[^>]*>/g)){
    const a=attrs(m[0]);if(a.id)elements[a.id]={...a,tagName:(/^<(\w+)/.exec(m[0])?.[1]??'').toUpperCase(),value:a.value??'',open:m[0].includes(' open'),disabled:m[0].includes('disabled'),scrollTop:0,scrollLeft:0,focus(){}};
   }
   for(const m of value.matchAll(/<button\b[^>]*>/g)){
    const a=attrs(m[0]);if(a['data-action'])buttons.push({dataset:{action:a['data-action'],id:a['data-id'],node:a['data-node'],group:a['data-group'],mode:a['data-mode']},disabled:m[0].includes('disabled')});
   }
  },
  querySelector:q=>elements[q.slice(1)]??null,querySelectorAll:()=>buttons
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
   if(method==='clash.ipInfo')return {available:true,ip:'203.0.113.7',country:'日本',countryCode:'JP',
    asn:'AS2516',isp:'KDDI',org:'KDDI Corporation',location:'日本 · 东京 · 千代田',timezone:'Asia/Tokyo'};
   if(method==='clash.siteTest')return {node:'[sub-00000000-0000-0000-0000-000000000001] 香港节点',sites:[
    {key:'apple',label:'Apple',url:'https://www.apple.com/library/test/success.html',delay:128,ok:true},
    {key:'github',label:'GitHub',url:'https://github.com/favicon.ico',delay:null,ok:false},
    {key:'google',label:'Google',url:'https://www.google.com/generate_204',delay:null,ok:false},
    {key:'youtube',label:'YouTube',url:'https://www.youtube.com/favicon.ico',delay:null,ok:false}]};
   return structuredClone(row);
  }}};
 vm.runInNewContext(readFileSync(new URL('./page.js',import.meta.url),'utf8'),context);
 return {calls,row,timers,root,element:id=>elements[id],buttons:()=>buttons,
  // 页面用 document.activeElement 判断「下拉是否展开」，夹具照真实 DOM 的最小面提供。
  setActive:el=>{context.document.activeElement=el},
  click:action=>{const button=buttons.find(b=>b.dataset.action===action);assert.ok(button,action);return button.onclick()},
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
 const f=fixture();await flush();
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
// 同一个重绘的另一个副作用：节点列表会滚回顶部，用户往下滑一格轮询一次就被弹回去。
test('轮询重绘不把节点列表滚回原点',async()=>{
 const f=fixture();await flush();f.row.running=true;
 f.click('view');await flush();
 f.click('section-nodes');
 const list=f.element('node-list');
 assert.ok(list,'节点页应有滚动容器');
 assert.equal(list.tagName,'DIV');
 list.scrollTop=260;
 const pollers=[...f.timers.values()];
 assert.ok(pollers.length>=1,'running 时应排了轮询');
 await pollers.at(-1)();await flush();
 assert.equal(f.element('node-list').scrollTop,260,'重绘后滚动位置要放回去');
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
