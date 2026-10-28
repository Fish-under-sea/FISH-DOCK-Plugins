/* 页面只调用本插件命令；Key 不回显，结果只做行为证据展示。 */
const $ = id => document.getElementById(id);
let polling = false;
let timer = null;
let loaded = false;
let busy = false;
let running = false;

function setStatus(text, bad = false) {
  const node = $('status');
  node.textContent = text;
  node.setAttribute('role', bad ? 'alert' : 'status');
  node.classList.toggle('bad', bad);
}

function showStop(on) {
  $('stop').hidden = !on;
}

// 配置没读回来之前不允许保存/启动，避免空表单把已存配置覆盖掉。
function applyEnabled() {
  const disabled = !loaded || busy || running;
  $('fields').disabled = disabled;
  $('save').disabled = disabled;
  $('run').disabled = disabled;
}

function clearResult() {
  $('result').hidden = true;
  $('verdict').textContent = '';
  $('evidence').replaceChildren();
  $('details').replaceChildren();
  $('json').textContent = '';
}

function collect() {
  return {
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value,
    model: $('model').value.trim(),
    comparisonModel: $('comparisonModel').value.trim(),
    clearKey: $('clearKey').checked,
  };
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function addRow(label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = value;
  $('details').append(term, detail);
}

function render(report) {
  if (!report?.verdict) return;
  $('result').hidden = false;
  $('verdict').textContent = report.verdict.label;
  $('verdict').dataset.code = report.verdict.code || '';
  const evidence = $('evidence');
  evidence.replaceChildren();
  const signals = report.verdict.signals || [];
  if (signals.length === 0) {
    const item = document.createElement('li');
    item.textContent = '没有形成可评分的行为信号';
    evidence.append(item);
  }
  for (const signal of signals) {
    const item = document.createElement('li');
    item.textContent = `[${signal.id}] ${signal.detail}`;
    evidence.append(item);
  }
  $('details').replaceChildren();
  addRow('目标', `${report.target?.baseUrl || '—'} · ${report.target?.model || '—'}`);
  addRow('B1 签名', `${report.b1?.status || '—'}${report.b1?.message ? ` — ${report.b1.message}` : ''}`);
  if (report.b1?.signatureLength !== undefined) addRow('签名长度', String(report.b1.signatureLength));
  const c1 = report.c1;
  if (c1 && c1.status !== 'skipped') {
    addRow('C1 count/usage', c1.counted === undefined || c1.used === undefined
      ? (c1.message || c1.status)
      : `${c1.counted} / ${c1.used}，差 ${c1.diff}（${percent(c1.percent)}）`);
  } else {
    addRow('C1 count/usage', `跳过 — ${c1?.reason || ''}`);
  }
  const c2 = report.c2;
  if (c2 && c2.status !== 'skipped') {
    addRow('C2 tokenizer', c2.ratio === undefined
      ? (c2.message || c2.status)
      : `${c2.primary?.count} / ${c2.comparison?.count} = ${c2.ratio.toFixed(3)}（${c2.status}）`);
  } else {
    addRow('C2 tokenizer', `跳过 — ${c2?.reason || ''}`);
  }
  addRow('评分', `伪造 ${report.verdict.forgedScore ?? 0} / 原生 ${report.verdict.nativeScore ?? 0} · 置信度 ${report.verdict.confidence || '—'}`);
  $('json').textContent = JSON.stringify(report, null, 2);
}

function paint(next) {
  if (!next || typeof next !== 'object') {
    setStatus('读取配置失败，请刷新重试', true);
    return;
  }
  $('baseUrl').value = next.baseUrl || '';
  $('model').value = next.model || '';
  $('comparisonModel').value = next.comparisonModel || '';
  $('apiKey').value = '';
  $('clearKey').checked = false;
  $('keyState').textContent = next.keyConfigured ? '已保存 Key（不会回显）' : '尚未保存 Key';
  loaded = true;
  running = Boolean(next.running);
  applyEnabled();
  // 先清掉旧结果，再按当前状态重绘；避免“进行中/失败”旁边挂着上一次的报告。
  clearResult();
  if (running) {
    setStatus('检测仍在进行…');
    showStop(true);
    void poll();
    return;
  }
  showStop(false);
  if (next.loadError) {
    setStatus(next.loadError, true);
    return;
  }
  const job = next.job;
  if (job?.state === 'error') {
    setStatus(job.error?.message || '上次检测失败', true);
    return;
  }
  if (job?.state === 'cancelled') {
    setStatus('上次检测已停止');
    if (job.report) render(job.report);
    return;
  }
  if (job?.state === 'done' && job.report) {
    setStatus('上次检测完成');
    render(job.report);
    return;
  }
  if (next.last) {
    setStatus(`上次检测：${new Date(next.lastAt || Date.now()).toLocaleString()}`);
    render(next.last);
    return;
  }
  setStatus('尚未检测');
}

function finish() {
  polling = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  running = false;
  showStop(false);
  applyEnabled();
}

async function poll() {
  if (polling) return;
  polling = true;
  // 单次请求最长 120 秒，B1 重放和 C1/C2 串行时可能超过三分钟；
  // 页面只负责轮询，不因自己的短截止时间把仍在后台跑的任务当成失败。
  const deadline = Date.now() + 600000;
  const tick = async () => {
    if (!polling) return;
    try {
      const result = await FishDock.call('relay.status');
      // 轮询期间用户可能已点“停止”；迟到的响应不能把界面拉回“进行中”。
      if (!polling) return;
      const job = result?.job;
      if (!job) {
        setStatus('没有可读的检测任务', true);
        finish();
        return;
      }
      if (job.state === 'running') {
        running = true;
        applyEnabled();
        showStop(true);
        setStatus('检测进行中…');
        if (Date.now() > deadline) {
          // 后台可能仍在跑：保留停止按钮，不要伪装成已结束。
          polling = false;
          setStatus('检测仍在后台运行，请稍后刷新查看', true);
          return;
        }
        timer = setTimeout(tick, 900);
        return;
      }
      if (job.state === 'done') {
        setStatus('检测完成');
        render(job.report);
        finish();
        return;
      }
      if (job.state === 'cancelled') {
        setStatus('检测已停止');
        finish();
        return;
      }
      setStatus(job.error?.message || '检测失败', true);
      finish();
    } catch {
      if (!polling) return;
      // 读状态失败 ≠ 任务结束：保留 Stop，禁用编辑，让用户刷新或停止。
      polling = false;
      setStatus('读取检测状态失败；后台任务可能仍在运行，可点“停止”或“刷新”', true);
      showStop(true);
      applyEnabled();
    }
  };
  await tick();
}

async function persist(showMessage = true) {
  const result = await FishDock.call('relay.save', collect());
  if (!result?.ok) {
    setStatus(result?.error?.message || '配置保存失败', true);
    return false;
  }
  $('apiKey').value = '';
  $('clearKey').checked = false;
  const keyConfigured = Boolean(result.view?.keyConfigured);
  $('keyState').textContent = keyConfigured ? '已保存 Key（不会回显）' : '尚未保存 Key';
  if (showMessage) setStatus('配置已保存');
  return true;
}

async function save(showMessage = true) {
  if (!loaded || busy || running) return false;
  busy = true;
  applyEnabled();
  try {
    return await persist(showMessage);
  } catch {
    setStatus('配置保存失败，请检查插件运行状态', true);
    return false;
  } finally {
    busy = false;
    applyEnabled();
  }
}

async function start() {
  if (!loaded || busy || running) return;
  busy = true;
  running = true;
  applyEnabled();
  setStatus('正在保存配置并启动检测…');
  try {
    if (!await persist(false)) {
      running = false;
      return;
    }
    // 配置确实保存成功后才清旧结果；保存失败时保留上一次报告。
    clearResult();
    const result = await FishDock.call('relay.start', {});
    if (!result?.ok || !result.job) {
      running = false;
      setStatus(result?.error?.message || '无法启动检测', true);
      return;
    }
    if (result.job.state !== 'running') {
      // 后端已有别的任务状态：以 view 为准，不要凭假设显示“进行中”。
      running = false;
      paint(await FishDock.call('relay.view').catch(() => null));
      return;
    }
    setStatus('检测进行中…');
    showStop(true);
    void poll();
  } catch {
    running = false;
    setStatus('启动检测失败，请检查插件运行状态', true);
  } finally {
    busy = false;
    applyEnabled();
  }
}

$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  await save(true);
});

$('run').onclick = () => void start();
$('stop').onclick = async () => {
  $('stop').disabled = true;
  try {
    const result = await FishDock.call('relay.stop');
    if (result?.ok) {
      finish();
      setStatus(result.job?.state === 'cancelled' ? '检测已停止' : '检测已结束');
    } else {
      setStatus(result?.error?.message || '停止失败', true);
    }
  } catch {
    setStatus('停止失败', true);
  } finally {
    $('stop').disabled = false;
  }
};
$('refresh').onclick = async () => {
  $('refresh').disabled = true;
  try {
    paint(await FishDock.call('relay.view'));
  } catch {
    setStatus('刷新失败', true);
  } finally {
    $('refresh').disabled = false;
  }
};

function boot() {
  if (!window.FishDock) {
    setStatus('插件桥接尚未注入，请重新打开页面', true);
    return;
  }
  // 配置读回来之前保持禁用，避免空表单覆盖已存配置。
  applyEnabled();
  window.FishDock.call('relay.view')
    .then(paint)
    .catch(() => {
      loaded = false;
      applyEnabled();
      setStatus('插件尚未就绪，请重新打开页面', true);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
