import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./gateway-page.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./gateway-page.html',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
 const ids=['state','connection','executable','port','error','start','stop','open','form','refresh','settings','configuration','autostart','title','intro'];
 // 自启动在 2.0.0 是按钮胶囊：状态写在 aria-pressed 上，形状与「启动服务」同规格兄弟按钮一致。
 const elements=Object.fromEntries(ids.map(id=>[id,{id,value:'',hidden:false,disabled:false,attrs:id==='autostart'?{'aria-pressed':'false'}:{},listeners:{},classList:{toggles:[],toggle(name,on){this.toggles.push([name,on])}},
  addEventListener(type,callback){this.listeners[type]=callback},setAttribute(name,value){this.attrs[name]=String(value)},getAttribute(name){return this.attrs[name]??null},querySelector(){return elements.save}}]));
 elements.save={};
 let row={state:'stopped',executable:'C:/service.exe',port:3425,url:null,error:null};
 const calls=[];
 const context={document:{getElementById:id=>elements[id],body:{dataset:{}}},
  setTimeout:()=>0,clearTimeout(){},
  FishDock:{call:async(method,params)=>{
   calls.push({method,params});
   if(method==='dock.autostart'){
    if(options.autostartFails)throw Error('接口不可用');
    if(params!==undefined)return options.writeRejects?Promise.reject(Error('保存失败')):{autostart:params.autostart===true};
    return {autostart:options.autostartReadable!==false};
   }
   return row;
  }}};
 vm.runInNewContext(source,context);
 return {elements,calls};
}
test('服务页的自启动开关是同规格胶囊按钮，位于「启动服务」左侧',()=>{
 assert.match(html,/<button id="autostart" class="ghost hook" aria-pressed="false"/,'自启动是带 aria-pressed 的按钮');
 assert.ok(!/type="checkbox"/.test(html),'不再使用复选框');
 assert.ok(html.indexOf('id="autostart"')<html.indexOf('id="start"'),'排在「启动服务」左侧');
});
test('脚本加载后立即读取自启动状态，无需点击刷新',async()=>{
 const f=fixture({autostartReadable:true});await flush();
 const reads=f.calls.filter(call=>call.method==='dock.autostart');
 assert.equal(reads.length,1,'加载即应读取一次 dock.autostart');
 assert.equal(reads[0].params,undefined,'读取不带参数');
 assert.equal(f.elements.autostart.attrs['aria-pressed'],'true');
 assert.deepEqual(f.elements.autostart.classList.toggles.at(-1),['on',true]);
 assert.equal(f.elements.autostart.disabled,false);
});
test('未点击刷新前自启动按钮已绑定，两态各自发出写入请求',async()=>{
 const f=fixture({autostartReadable:false});await flush();
 assert.equal(f.elements.autostart.attrs['aria-pressed'],'false','首屏读到关闭');
 assert.equal(typeof f.elements.autostart.onclick,'function','加载即绑定 onclick');
 f.elements.autostart.onclick();await flush();
 let writes=f.calls.filter(call=>call.method==='dock.autostart'&&call.params!==undefined);
 assert.equal(writes.length,1);
 assert.deepEqual({...writes[0].params},{autostart:true});
 assert.equal(f.elements.autostart.attrs['aria-pressed'],'true','按下态已回写');
 f.elements.autostart.onclick();await flush();
 writes=f.calls.filter(call=>call.method==='dock.autostart'&&call.params!==undefined);
 assert.equal(writes.length,2);
 assert.deepEqual({...writes[1].params},{autostart:false},'再点一下写回关闭');
 assert.equal(f.elements.autostart.attrs['aria-pressed'],'false');
});
test('刷新按钮只重新读取网关状态，不再顺带触发自启动',async()=>{
 const f=fixture();await flush();
 const before=f.calls.length;
 f.elements.refresh.onclick();await flush();
 const after=f.calls.slice(before);
 assert.deepEqual(after.map(call=>call.method),['gateway.view']);
});
test('宿主没有 dock.autostart 时隐藏按钮，且不改动按下态',async()=>{
 const f=fixture({autostartFails:true});await flush();
 assert.equal(f.elements.autostart.hidden,true);
 assert.equal(f.elements.autostart.attrs['aria-pressed'],'false');
 assert.equal(f.elements.error.textContent,'');
});
test('保存自启动失败时回滚按下态并写入错误提示',async()=>{
 const f=fixture({autostartReadable:false,writeRejects:true});await flush();
 f.elements.autostart.onclick();await flush();
 assert.equal(f.elements.autostart.attrs['aria-pressed'],'false','按下态回滚');
 assert.equal(f.elements.error.textContent,'保存失败');
 assert.equal(f.elements.autostart.disabled,false,'失败后重新可用');
 assert.equal(f.elements.autostart.hidden,false,'写入失败不隐藏按钮');
 const writes=f.calls.filter(call=>call.method==='dock.autostart'&&call.params!==undefined);
 assert.equal(writes.length,1);
 assert.equal(writes[0].params.autostart,true);
});
test('源文件里 autostart 函数只定义一次，且不在刷新回调内',()=>{
 const definitions=[...source.matchAll(/async function autostart\s*\(/g)];
 assert.equal(definitions.length,1,'autostart 只保留一份定义');
 const refreshLine=source.split('\n').find(line=>line.includes("$('refresh').onclick"));
 assert.ok(refreshLine,'存在刷新按钮绑定');
 assert.ok(!refreshLine.includes('autostart'),'刷新回调不含自启动逻辑');
 assert.ok(!/autostart/.test(refreshLine));
});