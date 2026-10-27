import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
 const ids=['enabled','waiting','done','error','fields','status','webhook','secret','clearSecret','saved','test','last','settings','refresh','clear','clear-confirm','cancel-clear','confirm-clear'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:'',checked:false,hidden:true,disabled:false,listeners:{},
  addEventListener(type,callback){this.listeners[type]=callback},setAttribute(){},focus(){this.focused=true}}]));
 const main={dataset:{}},calls=[];
 let view={enabled:true,waiting:true,done:false,error:true,configured:true,signing:true,layout:'single',last:null};
 const context={document:{getElementById:id=>elements[id],querySelector:()=>main,querySelectorAll:()=>[]},
  FishDock:{setLayout(){},call:async(method,params)=>{
   calls.push({method,params});
   if(method==='feishu.save')view={...view,...params,configured:!params.clear};
   return view;
  }}};
 vm.runInNewContext(fs.readFileSync(new URL('./page.js',import.meta.url),'utf8'),context);
 return {elements,calls};
}
test('清除机器人需页内确认，取消不写入，确认关闭通知且不发送消息',async()=>{
 const f=fixture();await flush();
 assert.equal(f.elements.error.checked,true);
 f.elements.clear.onclick();assert.equal(f.elements['clear-confirm'].hidden,false);
 assert.equal(f.elements['cancel-clear'].focused,true);
 f.elements['cancel-clear'].onclick();assert.equal(f.elements['clear-confirm'].hidden,true);
 assert.equal(f.calls.filter(row=>row.method==='feishu.save').length,0);
 f.elements.clear.onclick();await f.elements['confirm-clear'].onclick();
 const saved=f.calls.find(row=>row.method==='feishu.save');
 assert.equal(saved.params.clear,true);assert.equal(saved.params.enabled,false);assert.equal(saved.params.error,true);
 assert.equal(f.elements.test.disabled,true);
 assert.equal(f.calls.some(row=>row.method==='feishu.test'),false);
});
