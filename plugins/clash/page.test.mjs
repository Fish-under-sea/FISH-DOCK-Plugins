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
