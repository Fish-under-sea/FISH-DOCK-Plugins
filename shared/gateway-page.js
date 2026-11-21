const $ = id => document.getElementById(id);
let busy = false, timer, opened = '', last = null, dirty = false;
const states = { unconfigured: '等待配置', stopped: '已停止', starting: '正在启动', stopping: '正在停止', running: '运行中', error: '服务异常' };
const phases = { 'prepare-data': '正在准备资料', 'prepare-settings': '正在准备设置', 'verify-binary': '正在校验运行文件', 'start-process': '正在等待服务就绪' };
function render(row) {
 last = row;
 const running = row.state === 'running';
 document.body.dataset.running = String(running);
 if (document.documentElement?.dataset) {
  if (row.magpieGlassOn === true) document.documentElement.dataset.magpieGlass = '1';
  else delete document.documentElement.dataset.magpieGlass;
 }
 $('state').textContent = (row.state === 'starting' && phases[row.phase]) || states[row.state] || row.state;
 $('connection').textContent = running ? `127.0.0.1:${row.port}` : '';
 if (!dirty) { $('executable').value = row.executable; $('port').value = row.port; }
 $('error').textContent = row.error || '';
 const locked = busy || ['starting','stopping'].includes(row.state);
 $('start').hidden = running;
 $('start').disabled = locked || !row.executable;
 $('stop').hidden = !running && !['starting','stopping','error'].includes(row.state);
 $('stop').disabled = busy || row.state === 'stopping';
 $('open').disabled = locked || !running;
 $('executable').disabled = locked || running;
 $('port').disabled = locked || running;
 $('form').querySelector('button').disabled = locked || running;
 clearTimeout(timer);
 if (['starting','stopping','running'].includes(row.state)) timer = setTimeout(() => run('gateway.view'), 1500);
 if (!running) opened = '';
 if (running && opened !== row.url) {
  opened = row.url;
  void FishDock.call('gateway.open').catch(error => { opened = ''; $('error').textContent = error.message; });
 }
}
async function run(method, params = {}) {
 if (busy) return;
 busy = true;
 if (last) render(last);
 try { const row = await FishDock.call(method, params); busy = false; if (method === 'gateway.save') dirty = false; if (method !== 'gateway.open') render(row); }
 catch (error) { busy = false; if (last) render(last); $('error').textContent = error.message; }
 finally { busy = false; if (last) { $('refresh').disabled = false; } }
}
$('form').addEventListener('submit', event => { event.preventDefault(); void run('gateway.save', { executable: $('executable').value.trim(), port: Number($('port').value) }); });
$('form').addEventListener('input', () => { dirty = true; });
for (const action of ['start', 'stop', 'open']) $(action).onclick = () => run(`gateway.${action}`);
$('settings').onclick = () => { const expanded = $('configuration').hidden; $('configuration').hidden = !expanded; $('settings').setAttribute('aria-expanded', String(expanded)); };
$('refresh').onclick = () => { opened = ''; void run('gateway.view'); void knowledgeView(); };
// 用户当前页的显隐选择优先于异步 view；手动重开不改后台 dismissed。
let knowledgeChoice=null,knowledgeRequest=0,knowledgeClosing=false;
function showKnowledge(visible){
 $('knowledge').hidden=!visible;
 $('knowledge-show').setAttribute('aria-expanded',String(visible));
}
async function knowledgeView(){
 if(!$('knowledge'))return;
 const request=++knowledgeRequest;
 try{
  const value=await FishDock.call('knowledge.view');
  if(request!==knowledgeRequest)return;
  $('knowledge-show').hidden=false;
  showKnowledge(knowledgeChoice==='open'||(knowledgeChoice!=='closed'&&!value.dismissed));
  $('knowledge-path').textContent=value.root;
  $('knowledge-status').textContent=!value.initialized?'启动 Magpie 后准备独立知识库；旧目录不会被删除':value.imported?'知识内容已导入插件数据，新库不再依赖旧 Documents 目录':'独立知识库已创建，尚未导入旧知识内容';
  $('knowledge-open').disabled=!value.initialized||!value.obsidian?.installed;
  $('knowledge-open').title=!value.initialized?'请先启动 Magpie 准备知识库':!value.obsidian?.installed?'未检测到 Obsidian':'';
  if(!value.obsidian?.installed)$('knowledge-status').textContent+='。未检测到 Obsidian，Magpie 侧记忆仍可使用';
 }catch(error){
  if(request!==knowledgeRequest)return;
  $('knowledge-show').hidden=false;
  $('knowledge-error').textContent=error.message;
 }
}
if($('knowledge')){
 $('knowledge-refresh').onclick=()=>{ $('knowledge-error').textContent='';void knowledgeView(); };
 $('knowledge-show').onclick=()=>{
  if(knowledgeClosing)return;
  knowledgeChoice='open';showKnowledge(true);$('knowledge-error').textContent='';
  $('knowledge-dismiss').focus();void knowledgeView();
 };
 $('knowledge-dismiss').onclick=async()=>{
  if(knowledgeClosing)return;
  knowledgeClosing=true;knowledgeChoice='closed';++knowledgeRequest;
  showKnowledge(false);$('knowledge-error').textContent='';
  $('knowledge-dismiss').disabled=true;$('knowledge-dismiss').textContent='正在关闭…';
  $('knowledge-show').disabled=true;$('knowledge-show').title='正在保存关闭设置';
  $('settings').focus();
  try{await FishDock.call('knowledge.dismiss')}
  catch(error){
   ++knowledgeRequest;knowledgeChoice='open';showKnowledge(true);
   $('knowledge-error').textContent=error.message;
  }finally{
   knowledgeClosing=false;$('knowledge-dismiss').disabled=false;$('knowledge-dismiss').textContent='关闭';
   $('knowledge-show').disabled=false;$('knowledge-show').title='';
  }
 };
 $('knowledge-open').onclick=async()=>{try{await FishDock.call('knowledge.open');$('knowledge-status').textContent='已请求打开新库；若插件未加载，请在 Obsidian 社区插件中允许并重载 Magpie 共享记忆'}catch(error){$('knowledge-error').textContent=error.message}};
 void knowledgeView();
}
// 转发宿主 Dock 主题给支持 gateway.theme 的插件（供跨源服务页面如 Magpie 实现「跟随」），旧插件静默忽略。
let lastDockThemeSig = '';
if (typeof FishDock?.theme?.onChange === 'function') {
 FishDock.theme.onChange(theme => {
  let sig = '';
  try { sig = JSON.stringify(theme); } catch { return; }
  if (!sig || sig === lastDockThemeSig) return;
  lastDockThemeSig = sig;
  void FishDock.call('gateway.theme', theme).catch(() => {});
 });
}
void run('gateway.view');
