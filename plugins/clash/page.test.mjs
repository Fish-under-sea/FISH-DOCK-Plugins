import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(r=>setImmediate(r));
// Minimal DOM adapter for testing actual page event handlers; visual/WebView QA remains separate.
function fixture() {
 const calls=[],timers=new Map();let serial=0,html='',elements={},buttons=[],blocked=null,fail=false;
 const row={kernel:'D:/mihomo.exe',mixedPort:7895,controllerPort:9099,configured:true,running:false,groups:[],
  subscriptions:[{id:'sub-00000000-0000-0000-0000-000000000001',name:'One',enabled:true,status:'ready',nodeCount:2,hasCache:true}],
  layout:'single',mode:'rule'};
 const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
 const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
 const root={
  get innerHTML(){return html},
  set innerHTML(value){
   html=value;elements={};buttons=[];
   for(const m of value.matchAll(/<(?:input|form|details|select)\b[^>]*>/g)){
    const a=attrs(m[0]);if(a.id)elements[a.id]={...a,value:a.value??'',open:m[0].includes(' open'),disabled:m[0].includes('disabled'),focus(){}};
   }
   for(const m of value.matchAll(/<button\b[^>]*>/g)){
    const a=attrs(m[0]);if(a['data-action'])buttons.push({dataset:{action:a['data-action'],id:a['data-id'],node:a['data-node']},disabled:m[0].includes('disabled')});
   }
  },
  querySelector:q=>elements[q.slice(1)]??null,querySelectorAll:()=>buttons
 };
 class FormData {
  constructor(form){this.id=form.id}
  get(key){return elements[this.id==='subscription-form'?`subscription-${key}`:key]?.value??null}
 }
 const context={document:{querySelector:()=>root,activeElement:null},window:{addEventListener(){}},FormData,
  setTimeout:fn=>{timers.set(++serial,fn);return serial},clearTimeout:id=>timers.delete(id),
  FishDock:{setLayout(){},call:async(method,params)=>{
   calls.push({method,params});
   if(method==='clash.subscriptionSave'){await blocked;if(fail)throw Error('PRIVATE');}
   return structuredClone(row);
  }}};
 vm.runInNewContext(readFileSync(new URL('./page.js',import.meta.url),'utf8'),context);
 return {calls,row,timers,root,element:id=>elements[id],
  click:action=>{const button=buttons.find(b=>b.dataset.action===action);assert.ok(button,action);return button.onclick()},
  block:()=>{let release;blocked=new Promise(r=>release=r);return release},fail:()=>{fail=true}};
}
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
 f.click('section-nodes');assert.ok(f.root.innerHTML.includes('代理节点'));
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
