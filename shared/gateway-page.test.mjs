import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({knowledge=false,callKnowledge}={}) {
 const ids=['state','connection','executable','port','error','start','stop','open','form','refresh','settings','configuration'];
 if(knowledge)ids.push('knowledge','knowledge-status','knowledge-path','knowledge-open','knowledge-refresh','knowledge-dismiss','knowledge-show','knowledge-error');
 const elements=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',hidden:false,disabled:false,listeners:{},attributes:{},
  addEventListener(type,callback){this.listeners[type]=callback},setAttribute(name,value){this.attributes[name]=value},focus(){this.focused=true},querySelector(){return elements.save}}]));
 elements.configuration.hidden=true;
 if(knowledge){elements.knowledge.hidden=true;elements['knowledge-show'].hidden=true;}
 elements.save={};let row={state:'stopped',executable:'C:/service.exe',port:3425,url:null,error:null},fail=false;
 const knowledgeRow={root:'D:/synthetic-vault',initialized:true,obsidian:{installed:true},dismissed:false};
 const calls=[],timers=[];
 const context={document:{getElementById:id=>elements[id],body:{dataset:{}}},
  setTimeout:callback=>{timers.push(callback);return timers.length},clearTimeout(){},
  FishDock:{call:async(method,params)=>{
   calls.push({method,params});if(fail&&method==='gateway.save')throw Error('保存失败');
   if(method.startsWith('knowledge.')){
    if(callKnowledge)return callKnowledge(method,params);
    if(method==='knowledge.dismiss')knowledgeRow.dismissed=true;
    return {...knowledgeRow};
   }
   return row;
  }}};
 vm.runInNewContext(fs.readFileSync(new URL('./gateway-page.js',import.meta.url),'utf8'),context);
 return {elements,calls,timers,knowledgeRow,row:value=>{row=value},fail:()=>{fail=true}};
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

test('首次展示可关闭，刷新不复活，设置重开不清除持久关闭状态',async()=>{
 const f=fixture({knowledge:true});await flush();
 assert.equal(f.elements.knowledge.hidden,false);
 assert.equal(f.elements['knowledge-show'].hidden,false);
 assert.equal(f.elements['knowledge-show'].attributes['aria-expanded'],'true');
 await f.elements['knowledge-dismiss'].onclick();
 assert.equal(f.knowledgeRow.dismissed,true);
 assert.equal(f.elements.knowledge.hidden,true);
 assert.equal(f.elements.settings.focused,true);
 f.elements.refresh.onclick();await flush();
 assert.equal(f.elements.knowledge.hidden,true);
 f.elements.settings.onclick();
 assert.equal(f.elements.configuration.hidden,false);
 f.elements['knowledge-show'].onclick();await flush();
 assert.equal(f.elements.knowledge.hidden,false);
 assert.equal(f.elements['knowledge-show'].attributes['aria-expanded'],'true');
 f.elements['knowledge-refresh'].onclick();await flush();
 assert.equal(f.elements.knowledge.hidden,false);
 assert.equal(f.knowledgeRow.dismissed,true);
 assert.deepEqual(f.calls.filter(row=>row.method.startsWith('knowledge.')&&row.method!=='knowledge.view').map(row=>row.method),['knowledge.dismiss']);
 const reloaded=fixture({knowledge:true,callKnowledge:async()=>({...f.knowledgeRow})});await flush();
 assert.equal(reloaded.elements.knowledge.hidden,true);
 assert.equal(reloaded.elements['knowledge-show'].hidden,false);
});

test('关闭立即屏蔽在途与后续 view，保存完成也不复活提示',async()=>{
 let resolveView,resolveDismiss,views=0;
 const f=fixture({knowledge:true,callKnowledge:method=>{
  if(method==='knowledge.dismiss')return new Promise(resolve=>{resolveDismiss=resolve});
  if(++views===2)return new Promise(resolve=>{resolveView=resolve});
  return {root:'synthetic',initialized:true,obsidian:{installed:true},dismissed:false};
 }});await flush();
 const view=f.elements['knowledge-refresh'].onclick();await flush();
 const dismiss=f.elements['knowledge-dismiss'].onclick();
 assert.equal(f.elements.knowledge.hidden,true);
 assert.equal(f.elements['knowledge-show'].disabled,true);
 assert.equal(f.elements['knowledge-dismiss'].textContent,'正在关闭…');
 resolveView({root:'stale',dismissed:false});await view;await flush();
 assert.equal(f.elements.knowledge.hidden,true);
 f.elements.refresh.onclick();await flush();
 assert.equal(f.elements.knowledge.hidden,true);
 resolveDismiss({dismissed:true});await dismiss;
 assert.equal(f.elements.knowledge.hidden,true);
 assert.equal(f.elements['knowledge-show'].disabled,false);
});

test('关闭写入失败保留提示并显示可重试错误，重试成功才关闭',async()=>{
 let fail=true;
 const f=fixture({knowledge:true,callKnowledge:async method=>{
  if(method==='knowledge.dismiss'&&fail)throw Error('关闭设置保存失败，请重试：磁盘不可写');
  return {root:'synthetic',dismissed:false};
 }});await flush();
 await f.elements['knowledge-dismiss'].onclick();
 assert.equal(f.elements.knowledge.hidden,false);
 assert.match(f.elements['knowledge-error'].textContent,/保存失败.*重试.*磁盘不可写/);
 assert.equal(f.elements['knowledge-dismiss'].disabled,false);
 f.elements.refresh.onclick();await flush();
 assert.equal(f.elements.knowledge.hidden,false);
 assert.match(f.elements['knowledge-error'].textContent,/保存失败/);
 fail=false;await f.elements['knowledge-dismiss'].onclick();
 assert.equal(f.elements.knowledge.hidden,true);
 assert.equal(f.elements['knowledge-error'].textContent,'');
});

test('读取提示状态失败保持隐藏，设置入口可重试',async()=>{
 let fail=true;
 const f=fixture({knowledge:true,callKnowledge:async()=>{
  if(fail)throw Error('读取知识库提示设置失败，请重试');
  return {root:'synthetic',dismissed:true};
 }});await flush();
 assert.equal(f.elements.knowledge.hidden,true);
 assert.match(f.elements['knowledge-error'].textContent,/读取.*失败/);
 assert.equal(f.elements['knowledge-show'].hidden,false);
 fail=false;f.elements['knowledge-show'].onclick();await flush();
 assert.equal(f.elements.knowledge.hidden,false);
 assert.equal(f.elements['knowledge-error'].textContent,'');
});


test('gateway-page 转发 FishDock.theme 并同步 magpieGlassOn 与透明 CSS 规则', async () => {
 let onTheme = null;
 const calls = [];
 const elements = Object.fromEntries(
  ['state', 'connection', 'executable', 'port', 'error', 'start', 'stop', 'open', 'form', 'refresh', 'settings', 'configuration']
   .map((id) => [id, { value: '', textContent: '', hidden: false, disabled: false, listeners: {}, attributes: {},
    addEventListener(type, cb) { this.listeners[type] = cb; }, setAttribute(k, v) { this.attributes[k] = v; }, focus() {}, querySelector() { return { disabled: false }; } }]),
 );
 const docEl = { dataset: {} };
 const row = { state: 'running', executable: 'C:/magpie.exe', port: 3425, url: 'http://127.0.0.1:3425/', error: null, magpieGlassOn: true };
 const context = {
  document: { getElementById: (id) => elements[id], documentElement: docEl, body: { dataset: {} } },
  setTimeout: () => 1, clearTimeout() {},
  FishDock: {
   theme: { onChange(fn) { onTheme = fn; } },
   call: async (method, params) => {
    calls.push({ method, params });
    if (method === 'gateway.view') return structuredClone(row);
    return structuredClone(row);
   },
  },
 };
 const source = fs.readFileSync(new URL('./gateway-page.js', import.meta.url), 'utf8');
 vm.runInNewContext(source, context, { filename: 'gateway-page.js' });
 await flush();

 assert.equal(docEl.dataset.magpieGlass, '1', 'magpieGlassOn=true 时设置 data-magpie-glass=1');
 assert.equal(typeof onTheme, 'function', '订阅了 FishDock.theme.onChange');
 const snap = { dockMode: 'glass', appearance: { glass: { enabled: true, cardOp: 22 } } };
 onTheme(snap);
 onTheme(structuredClone(snap));
 await flush();
 assert.equal(calls.filter((c) => c.method === 'gateway.theme').length, 1, '相同快照不重复推送 gateway.theme');
 assert.deepEqual(calls.find((c) => c.method === 'gateway.theme').params, snap);

 const css = fs.readFileSync(new URL('./gateway-page.css', import.meta.url), 'utf8');
 assert.match(css, /:root\[data-dock-glass="1"\][^\{]*:root\[data-magpie-glass="1"\][^\{]*\{[^}]*background:\s*transparent/);
 assert.match(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\),\s*\(forced-colors:\s*active\)/);
});
