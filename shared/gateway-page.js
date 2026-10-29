const $ = id => document.getElementById(id);
let busy = false, timer, opened = '', last = null, dirty = false;
const states = { unconfigured: '等待配置', stopped: '已停止', starting: '正在启动', stopping: '正在停止', running: '运行中', error: '服务异常' };
const phases = { 'prepare-data': '正在准备资料', 'prepare-settings': '正在准备设置', 'verify-binary': '正在校验运行文件', 'start-process': '正在等待服务就绪' };
function render(row) {
 last = row;
 const running = row.state === 'running';
 document.body.dataset.running = String(running);
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
$('refresh').onclick = () => { opened = ''; void run('gateway.view'); };
// 自启动：随 Dock 启动就拉起本机服务。关掉它只是不再开机启动，眼下的服务照旧。
// 宿主（FISH Dock 1.2.1 之前）没有这个接口时把按钮藏起来，不打扰既有操作。
// 1.2.4 起 Dock 的插件卡上也有同一颗开关，两处写的是注册表里同一个 autostart。
function setPressed(on) {
 const button = $('autostart');
 if (!button) return;
 button.setAttribute('aria-pressed', String(!!on));
 button.classList.toggle('on', !!on);
}
async function autostart(onChange) {
 const button = $('autostart');
 if (!button) return;
 button.disabled = true;
 try {
  const row = onChange === undefined ? await FishDock.call('dock.autostart') : await FishDock.call('dock.autostart', { autostart: onChange });
  setPressed(row.autostart === true);
 } catch (error) {
  if (onChange === undefined) { button.hidden = true; }
  else { setPressed(!onChange); $('error').textContent = error.message; }
 }
 finally { button.disabled = false; }
}
const autostartButton = $('autostart');
if (autostartButton) autostartButton.onclick = () => { void autostart(autostartButton.getAttribute('aria-pressed') !== 'true'); };
void autostart();void run('gateway.view');
