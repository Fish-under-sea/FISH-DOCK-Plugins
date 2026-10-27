import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
 const ids=['state','connection','executable','port','error','start','stop','open','form','refresh','settings','configuration'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:'',hidden:false,disabled:false,listeners:{},
  addEventListener(type,callback){this.listeners[type]=callback},setAttribute(){},querySelector(){return elements.save}}]));
 elements.save={};let row={state:'stopped',executable:'C:/service.exe',port:3425,url:null,error:null},fail=false;
 const calls=[],timers=[];
 const context={document:{getElementById:id=>elements[id],body:{dataset:{}}},
  setTimeout:callback=>{timers.push(callback);return timers.length},clearTimeout(){},
  FishDock:{call:async(method,params)=>{calls.push({method,params});if(fail&&method==='gateway.save')throw Error('保存失败');return row;}}};
 vm.runInNewContext(fs.readFileSync(new URL('./gateway-page.js',import.meta.url),'utf8'),context);
 return {elements,calls,timers,row:value=>{row=value},fail:()=>{fail=true}};
}
test('后台刷新和保存失败保留未保存的路径及端口',async()=>{
 const f=fixture();await flush();
 f.elements.executable.value='D:/中文 路径/service.exe';f.elements.port.value='4567';
 f.elements.form.listeners.input();
 f.elements.refresh.onclick();await flush();
 assert.equal(f.elements.executable.value,'D:/中文 路径/service.exe');
 f.fail();f.elements.form.listeners.submit({preventDefault(){}});await flush();
 assert.equal(f.elements.port.value,'4567');assert.equal(f.elements.error.textContent,'保存失败');
 assert.equal(f.calls.at(-1).params.executable,'D:/中文 路径/service.exe');
});
test('启动中允许请求停止，运行状态定时复核以发现进程退出',async()=>{
 const f=fixture();await flush();
 f.row({state:'starting',executable:'C:/service.exe',port:3425,url:null});
 f.elements.refresh.onclick();await flush();
 assert.equal(f.elements.stop.hidden,false);assert.equal(f.elements.stop.disabled,false);
 f.row({state:'running',executable:'C:/service.exe',port:3425,url:'http://127.0.0.1:3425/?k=synthetic'});
 f.elements.refresh.onclick();await flush();
 assert.ok(f.calls.some(row=>row.method==='gateway.open'));assert.ok(f.timers.length>0);
 f.row({state:'error',executable:'C:/service.exe',port:3425,url:null,error:'服务进程已退出'});
 f.timers.at(-1)();await flush();
 assert.equal(f.elements.state.textContent,'服务异常');assert.equal(f.elements.start.disabled,false);
});
