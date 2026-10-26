const $ = id => document.getElementById(id);
let busy = false, timer, opened = '', last = null;
const states = { unconfigured: '等待配置', stopped: '已停止', starting: '正在启动', running: '运行中', error: '服务异常' };
function render(row) {
 last = row;
 const running = row.state === 'running';
 document.body.dataset.running = String(running);
 $('state').textContent = states[row.state] || row.state;
 $('connection').textContent = running ? `127.0.0.1:${row.port}` : '';
 $('executable').value = row.executable;
 $('port').value = row.port;
 $('error').textContent = row.error || '';
 const locked = busy || row.state === 'starting';
 $('start').hidden = running;
 $('start').disabled = locked || !row.executable;
 $('stop').hidden = !running && row.state !== 'starting';
 $('stop').disabled = locked;
 $('open').disabled = locked || !running;
 $('executable').disabled = locked || running;
 $('port').disabled = locked || running;
 $('form').querySelector('button').disabled = locked || running;
 clearTimeout(timer);
 if (row.state === 'starting') timer = setTimeout(() => run('gateway.view'), 1000);
 if (!running) opened = '';
 if (running && opened !== String(row.port)) {
  opened = String(row.port);
  void FishDock.call('gateway.open').catch(error => { opened = ''; $('error').textContent = error.message; });
 }
}
async function run(method, params = {}) {
 if (busy) return;
 busy = true;
 if (last) render(last);
 try { const row = await FishDock.call(method, params); busy = false; if (method !== 'gateway.open') render(row); }
 catch (error) { busy = false; if (last) render(last); $('error').textContent = error.message; }
 finally { busy = false; if (last) { $('refresh').disabled = false; } }
}
$('form').addEventListener('submit', event => { event.preventDefault(); void run('gateway.save', { executable: $('executable').value.trim(), port: Number($('port').value) }); });
for (const action of ['start', 'stop', 'open']) $(action).onclick = () => run(`gateway.${action}`);
$('settings').onclick = () => { const expanded = $('configuration').hidden; $('configuration').hidden = !expanded; $('settings').setAttribute('aria-expanded', String(expanded)); };
$('refresh').onclick = () => { opened = ''; void run('gateway.view'); };
void run('gateway.view');
