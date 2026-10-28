import { randomUUID } from 'node:crypto';
import { normalizeProbeConfig, normalizeSettings, probeRelay, redact } from './probe.mjs';

const CONFIG_FILE = 'relay.json';
const KEY_FILE = 'relay.json';
const LAST_FILE = 'last.json';

function publicError(error, key) {
  return {
    code: error?.code || 'INVALID_CONFIG',
    message: redact(error?.message || '配置无效', key),
  };
}

export function createRelayService({ context, probe = probeRelay, clock = Date.now } = {}) {
  let settings = normalizeSettings({});
  let key = '';
  let loadError = null;
  let last = null;
  let lastAt = null;
  let job = null;
  let controller = null;

  async function load() {
    try {
      const raw = await context.storage.read('config', CONFIG_FILE);
      if (raw) settings = normalizeSettings(JSON.parse(raw));
    } catch (error) {
      loadError = redact(`配置读取失败：${error?.message || '数据格式错误'}`);
    }
    try {
      const raw = await context.secrets.read('credentials', KEY_FILE);
      if (raw) {
        const parsed = JSON.parse(raw);
        const candidate = typeof parsed?.apiKey === 'string' ? parsed.apiKey : '';
        const credentialBaseUrl = typeof parsed?.baseUrl === 'string' ? parsed.baseUrl : '';
        if (candidate.length > 8192 || /[\r\n\0]/.test(candidate)) {
          loadError ||= '加密凭据格式无效，请重新保存 Key';
        } else if (candidate && credentialBaseUrl !== settings.baseUrl) {
          // Key 与 Base URL 成对保存；不一致说明上次写入只完成了一半，
          // 绝不能把 Key 发到另一个主机。
          loadError ||= '加密凭据与当前 Base URL 不匹配，请重新填写 Key';
        } else {
          key = candidate;
        }
      }
    } catch {
      loadError ||= '加密凭据读取失败，请重新保存 Key';
    }
    try {
      const raw = await context.storage.read('config', LAST_FILE);
      if (raw) {
        const parsed = JSON.parse(raw);
        last = parsed?.report ?? null;
        lastAt = Number.isFinite(parsed?.at) ? parsed.at : null;
      }
    } catch {
      // 上次报告是可选数据，损坏不应阻止插件启用。
    }
  }

  function publicJob() {
    if (!job) return null;
    return {
      id: job.id,
      state: job.state,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? null,
      report: job.report ?? null,
      error: job.error ?? null,
    };
  }

  async function view() {
    return {
      ...settings,
      keyConfigured: Boolean(key),
      running: job?.state === 'running',
      job: publicJob(),
      last,
      lastAt,
      loadError,
    };
  }

  async function save(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return { ok: false, error: { code: 'PARAMS_INVALID', message: '配置格式无效' } };
    }
    const oldSettings = settings;
    const oldKey = key;
    let next;
    let nextKey = oldKey;
    try {
      next = normalizeSettings({ ...settings, ...params });
      if (params.clearKey) nextKey = '';
      else if (params.apiKey !== undefined) {
        const candidate = String(params.apiKey).trim();
        if (candidate) {
          if (candidate.length > 8192 || /[\r\n\0]/.test(candidate)) {
            throw Object.assign(new Error('API Key 格式无效'), { code: 'KEY_INVALID' });
          }
          nextKey = candidate;
        }
      }
    } catch (error) {
      return { ok: false, error: publicError(error, oldKey) };
    }
    const secretChanged = nextKey !== oldKey || next.baseUrl !== oldSettings.baseUrl;
    try {
      if (secretChanged) {
        await context.secrets.write('credentials', KEY_FILE, JSON.stringify({ apiKey: nextKey, baseUrl: next.baseUrl }));
      }
      await context.storage.write('config', CONFIG_FILE, JSON.stringify(next));
    } catch {
      let rollbackFailed = false;
      if (secretChanged) {
        try {
          await context.secrets.write('credentials', KEY_FILE, JSON.stringify({ apiKey: oldKey, baseUrl: oldSettings.baseUrl }));
        } catch {
          rollbackFailed = true;
        }
      }
      settings = oldSettings;
      return {
        ok: false,
        error: {
          code: 'SAVE_FAILED',
          message: rollbackFailed
            ? '配置保存失败，且旧 Key 未能恢复；请重新填写 Key 后再保存'
            : '配置保存失败，原配置已保留',
        },
      };
    }
    settings = next;
    key = nextKey;
    loadError = null;
    return { ok: true, view: await view() };
  }

  async function start(params = {}) {
    if (job?.state === 'running') return { ok: true, job: publicJob() };
    if (params && typeof params === 'object' && Object.keys(params).length > 0) {
      const saved = await save(params);
      if (!saved.ok) return saved;
    }
    if (!settings.baseUrl) {
      return { ok: false, error: { code: 'BASE_URL_REQUIRED', message: '请先填写 Base URL' } };
    }
    if (!key) return { ok: false, error: { code: 'KEY_REQUIRED', message: '请先填写 API Key' } };
    let config;
    try {
      config = normalizeProbeConfig({ ...settings, apiKey: key });
    } catch (error) {
      return { ok: false, error: publicError(error, key) };
    }
    const id = randomUUID();
    const localController = new AbortController();
    job = { id, state: 'running', startedAt: clock(), report: null, error: null };
    controller = localController;
    void (async () => {
      try {
        const report = await probe({ ...config, signal: localController.signal });
        if (job?.id !== id || job.state !== 'running') return;
        const finishedAt = clock();
        job = { ...job, state: 'done', finishedAt, report };
        last = report;
        lastAt = finishedAt;
        try {
          await context.storage.write('config', LAST_FILE, JSON.stringify({ report, at: lastAt }));
        } catch {
          // 报告保存失败不回滚检测结果，页面仍可显示本次结果。
        }
      } catch (error) {
        if (job?.id !== id) return;
        if (localController.signal.aborted) {
          job = { ...job, state: 'cancelled', finishedAt: clock() };
          return;
        }
        job = {
          ...job,
          state: 'error',
          finishedAt: clock(),
          error: { code: error?.code || 'PROBE_FAILED', message: redact(error?.message || '检测失败', key) },
        };
      } finally {
        if (controller === localController) controller = null;
      }
    })();
    return { ok: true, job: publicJob() };
  }

  async function status() {
    return { ok: true, job: publicJob() };
  }

  async function stop() {
    if (job?.state === 'running') {
      controller?.abort();
      job = { ...job, state: 'cancelled', finishedAt: clock() };
    }
    return { ok: true, job: publicJob() };
  }

  return { load, view, save, start, status, stop };
}
