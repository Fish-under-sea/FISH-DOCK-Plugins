// 中转站行为探针：只做协议/计数/签名行为观察，不把任何单一字段当作模型身份证明。
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const COMPARISON_MODEL = 'claude-sonnet-4-6';
const DEFAULT_API_VERSION = '2026-10-21';
const LEGACY_API_VERSION = '2023-06-01';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 120_000;
const USER_AGENT = 'FISH-Dock-Relay-Probe/1.0';
const AUTH_MODES = ['auto', 'x-api-key', 'bearer', 'both'];

const B1_PROMPT = [
  'Work through this problem carefully before answering.',
  'A bat and a ball cost $1.10 total. The bat costs $1.00 more than the ball.',
  'How much does the ball cost? Show the steps, and end with exactly one line: FINAL=<number>',
].join(' ');

const TOKEN_TEXT = [
  'Tokenizer probe. 请只回复 OK。',
  '下面是一段混合中英文、代码和 JSON 的样本：',
  '函数 f(x) 返回 x 的平方；当 x=17 时结果为 289。',
  '```js',
  'const rows = [{"id":1,"name":"鲸鱼","ok":true},{"id":2,"name":"猫娘","ok":false}];',
  'console.log(rows.filter(row => row.ok).map(row => row.name).join(","));',
  '```',
  'JSON: {"temperature":0.2,"tokens":["中文","English","emoji: 🐟"]}',
  '不要解释，只回复 OK。',
].join('\n');

export class ProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
  }
}

export function redact(value, secret = '') {
  let text = String(value ?? '');
  if (secret) text = text.split(secret).join('<REDACTED>');
  text = text.replace(/\b(sk-[A-Za-z0-9_-]{6,})\b/g, '<REDACTED>');
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1<REDACTED>');
  return text;
}

export function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new ProbeError('BASE_URL_REQUIRED', '请填写 Base URL');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ProbeError('BASE_URL_INVALID', 'Base URL 不是有效 URL');
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new ProbeError('BASE_URL_SCHEME', 'Base URL 只支持 HTTPS（本机回环可用 HTTP）');
  }
  if (url.username || url.password) throw new ProbeError('BASE_URL_CREDENTIALS', 'Base URL 不能包含用户名或密码');
  if (url.hash) throw new ProbeError('BASE_URL_HASH', 'Base URL 不能包含 # 片段');
  if (url.search) throw new ProbeError('BASE_URL_QUERY', 'Base URL 不能包含查询参数，请只填写协议、主机和路径');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
    throw new ProbeError('BASE_URL_INSECURE', '非本机地址必须使用 HTTPS');
  }
  let path = url.pathname.replace(/\/+$/, '');
  for (const suffix of ['/v1/messages/count_tokens', '/v1/messages']) {
    if (path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }
  if (path.endsWith('/v1')) path = path.slice(0, -3);
  url.pathname = path || '/';
  return url.toString().replace(/\/$/, '');
}

export function publicBaseUrl(value) {
  try {
    const url = new URL(normalizeBaseUrl(value));
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return '<invalid>';
  }
}

export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProbeError('CONFIG_INVALID', '配置格式无效');
  }
  if (input.authMode !== undefined && !AUTH_MODES.includes(input.authMode)) {
    throw new ProbeError('AUTH_MODE_INVALID', '认证方式必须是 auto、x-api-key、bearer 或 both');
  }
  return {
    baseUrl: input.baseUrl ? normalizeBaseUrl(input.baseUrl) : '',
    model: validModel(input.model, DEFAULT_MODEL),
    comparisonModel: validModel(input.comparisonModel, COMPARISON_MODEL),
    authMode: AUTH_MODES.includes(input.authMode) ? input.authMode : 'auto',
    apiVersion: validVersion(input.apiVersion),
  };
}

function validModel(value, fallback) {
  const model = String(value ?? '').trim() || fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model)) throw new ProbeError('MODEL_INVALID', '模型 ID 格式无效');
  return model;
}

function validVersion(value) {
  const version = String(value ?? '').trim() || DEFAULT_API_VERSION;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) throw new ProbeError('API_VERSION_INVALID', 'API 版本格式应为 YYYY-MM-DD');
  return version;
}

function validTimeout(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 5_000 || timeout > MAX_TIMEOUT_MS) {
    throw new ProbeError('TIMEOUT_INVALID', `超时应在 5000–${MAX_TIMEOUT_MS} 毫秒之间`);
  }
  return timeout;
}

export function normalizeProbeConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProbeError('CONFIG_INVALID', '配置格式无效');
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = String(input.apiKey ?? '').trim();
  if (!apiKey) throw new ProbeError('KEY_REQUIRED', '请填写 API Key');
  if (apiKey.length > 8192 || /[\r\n\0]/.test(apiKey)) throw new ProbeError('KEY_INVALID', 'API Key 格式无效');
  if (input.authMode !== undefined && !AUTH_MODES.includes(input.authMode)) {
    throw new ProbeError('AUTH_MODE_INVALID', '认证方式必须是 auto、x-api-key、bearer 或 both');
  }
  return {
    baseUrl,
    apiKey,
    model: validModel(input.model, DEFAULT_MODEL),
    comparisonModel: validModel(input.comparisonModel, COMPARISON_MODEL),
    authMode: AUTH_MODES.includes(input.authMode) ? input.authMode : 'auto',
    apiVersion: validVersion(input.apiVersion),
    timeoutMs: validTimeout(input.timeoutMs),
    signal: input.signal,
  };
}

function endpointsFor(baseUrl) {
  const root = normalizeBaseUrl(baseUrl);
  return {
    messages: `${root}/v1/messages`,
    countTokens: `${root}/v1/messages/count_tokens`,
  };
}

async function readText(response, limit) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw new Error('响应超过大小限制');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw new Error('响应超过大小限制');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signalFor(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function headersFor(mode, apiKey, version) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'anthropic-version': version,
    'user-agent': USER_AGENT,
  };
  if (mode === 'x-api-key' || mode === 'both') headers['x-api-key'] = apiKey;
  if (mode === 'bearer' || mode === 'both') headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

async function parseResponse(response, apiKey) {
  let text;
  try {
    text = await readText(response, MAX_RESPONSE_BYTES);
  } catch (error) {
    return {
      ok: false,
      status: Number(response.status) || 0,
      json: null,
      message: redact(error?.message || '读取响应失败', apiKey),
      requestId: null,
    };
  }
  let json = null;
  try {
    if (text.trim()) json = JSON.parse(text);
  } catch {
    // 非 JSON 响应保留截断后的文本，便于定位网关错误页。
  }
  const message = response.ok
    ? ''
    : redact(json?.error?.message || json?.message || text, apiKey).slice(0, 600);
  return {
    ok: Boolean(response.ok),
    status: Number(response.status) || 0,
    json,
    message: message || (response.ok ? '' : '上游返回空响应'),
    requestId: typeof json?.request_id === 'string' ? json.request_id : null,
  };
}

function createClient(config, fetchImpl) {
  const endpoints = endpointsFor(config.baseUrl);
  let preferred = config.authMode === 'auto' ? 'x-api-key' : config.authMode;
  let version = config.apiVersion;
  let versionFallbackTried = false;

  async function send(url, body, timeoutMs) {
    const modes = config.authMode === 'auto'
      ? [...new Set([preferred, preferred === 'x-api-key' ? 'bearer' : 'x-api-key'])]
      : [config.authMode];
    let last = null;
    for (let index = 0; index < modes.length; index += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: headersFor(modes[index], config.apiKey, version),
          body: JSON.stringify(body),
          redirect: 'error',
          signal: signalFor(timeoutMs, config.signal),
        });
      } catch (error) {
        return {
          ok: false,
          status: 0,
          json: null,
          message: redact(error?.message || '网络请求失败', config.apiKey),
          requestId: null,
          kind: config.signal?.aborted ? 'aborted' : 'network',
        };
      }
      const result = await parseResponse(response, config.apiKey);
      if ((result.status === 401 || result.status === 403) && index < modes.length - 1) {
        last = result;
        continue;
      }
      if (result.ok) preferred = modes[index];
      return result;
    }
    return last ?? { ok: false, status: 0, json: null, message: '认证失败', requestId: null };
  }

  async function call(url, body) {
    let result = await send(url, body, config.timeoutMs);
    if (
      !result.ok
      && result.status === 400
      && version === DEFAULT_API_VERSION
      && !versionFallbackTried
      // 只认“API 版本/请求头”措辞；“model version is not supported”
      // 这类模型错误不能把整轮探针永久切到旧版本。
      && /anthropic-version|api[\s_-]?version|unsupported[\s_-]?version|version[\s_-]header/i.test(result.message || '')
    ) {
      versionFallbackTried = true;
      const previous = version;
      version = LEGACY_API_VERSION;
      const retried = await send(url, body, config.timeoutMs);
      if (!retried.ok) version = previous;
      result = retried;
    }
    return result;
  }

  return {
    endpoints,
    messages: body => call(endpoints.messages, body),
    countTokens: body => call(endpoints.countTokens, body),
    get version() { return version; },
    get authMode() { return preferred; },
  };
}

function detectSurface(result) {
  const json = result?.json;
  if (json?.type === 'message' && Array.isArray(json.content)) return 'anthropic';
  if (json?.object === 'chat.completion' || Array.isArray(json?.choices)) return 'openai';
  return 'unknown';
}

// Claude 3.0/3.5 不支持 thinking；3.7/4.0/4.1/4.5 只接受 enabled；
// 4.6 与 5.x 使用 adaptive。识别不了的 ID 先按新世代试，再逐级回退，
// 避免把日期后缀的 4.x 模型错发成 adaptive 而直接 400。
function thinkingFamily(model) {
  const id = String(model).toLowerCase();
  if (/claude-3-7/.test(id)) return 'enabled';
  if (/claude-3-5|claude-3-(?:opus|haiku|sonnet)|claude-3(?:\.0)?(?:-|$)/.test(id)) return 'none';
  if (/claude-(?:sonnet|opus|haiku)-4-(?:0|1|5)(?:-|$)/.test(id)) return 'enabled';
  if (/claude-(?:sonnet|opus|haiku)-4-2025/.test(id)) return 'enabled';
  if (/claude-(?:sonnet|opus|haiku)-4-6/.test(id)) return 'adaptive';
  if (/claude-(?:sonnet|opus|haiku|fable)-5(?:-|$)/.test(id)) return 'adaptive';
  return 'unknown';
}

function thinkingCandidates(model) {
  const family = thinkingFamily(model);
  if (family === 'none') return [undefined];
  if (family === 'enabled') {
    return [
      { type: 'enabled', budget_tokens: 1024 },
      { type: 'adaptive' },
    ];
  }
  return [
    { type: 'adaptive', display: 'summarized' },
    { type: 'adaptive' },
    { type: 'enabled', budget_tokens: 1024 },
  ];
}

function classifyFirstError(result) {
  if (result.kind === 'network') return 'network_error';
  if (result.kind === 'aborted') return 'aborted';
  if (result.status === 401 || result.status === 403) return 'auth_error';
  if (result.status === 404) return 'endpoint_not_found';
  if (result.status === 429 || result.status >= 500) return 'transient_error';
  return `http_${result.status}`;
}

function classifyReplay(result) {
  if (result.ok) {
    // 2xx 不等于“签名被接受”：空响应、网关 HTML、200 包着的 error JSON
    // 都可能是上游故障。只有真正的 Anthropic message 才算重放成功。
    return result.json?.type === 'message' && Array.isArray(result.json.content)
      ? 'accepted'
      : 'invalid_response';
  }
  if (result.kind === 'network') return 'network_error';
  if (result.kind === 'aborted') return 'aborted';
  if (result.status === 401 || result.status === 403) return 'auth_error';
  if (result.status === 429 || result.status >= 500) return 'transient_error';
  if (result.status === 400 || result.status === 422) {
    // 只有错误明确指向签名/thinking 校验，才算“篡改被校验”；
    // 泛泛的 “invalid request” 只能算 rejected_other，否则会把网关的
    // 普通参数拒绝误当成原生签名校验。
    return /signature|thinking|verif|tamper|modified/i.test(result.message || '')
      ? 'rejected'
      : 'rejected_other';
  }
  return `http_${result.status}`;
}

// 新 API 在重放被中转层改写时会返回 input_transformations。
// 这里只做“有没有 thinking 被丢”的保守识别，不依赖具体字段名。
function thinkingDropNote(result) {
  const transformations = result?.json?.input_transformations;
  if (!Array.isArray(transformations)) return null;
  const dropped = transformations.find(item => {
    const text = JSON.stringify(item);
    return /thinking/i.test(text) && /drop|remov|discard/i.test(text);
  });
  return dropped ? JSON.stringify(dropped).slice(0, 300) : null;
}

async function replayB1(client, model, blocks, index, tamper, thinking) {
  const content = structuredClone(blocks);
  if (tamper) {
    const block = content[index];
    const field = block.type === 'redacted_thinking' ? 'data' : 'signature';
    const signature = block[field];
    const position = Math.floor(signature.length / 2);
    const replacement = signature[position] === 'A' ? 'B' : 'A';
    block[field] = signature.slice(0, position) + replacement + signature.slice(position + 1);
  }
  const body = {
    model,
    max_tokens: 2048,
    messages: [
      { role: 'user', content: B1_PROMPT },
      { role: 'assistant', content },
      { role: 'user', content: 'Repeat the final line exactly, with no extra text.' },
    ],
  };
  if (thinking) body.thinking = thinking;
  const result = await client.messages(body);
  return {
    status: classifyReplay(result),
    httpStatus: result.status,
    message: result.message,
    usage: numberOrNull(result.json?.usage?.input_tokens),
    dropped: thinkingDropNote(result),
  };
}

// 控制组：把 thinking 块整个删掉再重放。若两条“成功”重放的
// usage.input_tokens 都与控制组完全相同，说明 thinking 块很可能
// 根本没被计费（被中转层丢弃），不能据此判“篡改签名被接受”。
async function replayWithoutThinking(client, model, blocks, thinking) {
  const content = structuredClone(blocks)
    .filter(block => block?.type !== 'thinking' && block?.type !== 'redacted_thinking');
  if (content.length === 0) return null;
  const body = {
    model,
    max_tokens: 2048,
    messages: [
      { role: 'user', content: B1_PROMPT },
      { role: 'assistant', content },
      { role: 'user', content: 'Repeat the final line exactly, with no extra text.' },
    ],
  };
  if (thinking) body.thinking = thinking;
  const result = await client.messages(body);
  return {
    status: classifyReplay(result),
    httpStatus: result.status,
    message: result.message,
    usage: numberOrNull(result.json?.usage?.input_tokens),
  };
}

async function probeB1(client, config) {
  const candidates = thinkingCandidates(config.model);
  let thinking;
  let first;
  let thinkingRejected = false;
  for (const candidate of candidates) {
    const body = {
      model: config.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: B1_PROMPT }],
    };
    if (candidate) body.thinking = candidate;
    first = await client.messages(body);
    if (first.ok) {
      thinking = candidate;
      break;
    }
    thinkingRejected = first.status === 400 && /thinking|display|budget_tokens/i.test(first.message || '');
    if (!thinkingRejected) break;
  }
  if (!first?.ok) {
    return {
      id: 'B1',
      status: thinkingRejected ? 'thinking_unsupported' : classifyFirstError(first),
      surface: 'unknown',
      httpStatus: first?.status ?? 0,
      message: thinkingRejected
        ? '目标拒绝所有 thinking 配置，无法进行签名重放'
        : first?.message || '首个请求失败',
    };
  }
  const surface = detectSurface(first);
  if (surface !== 'anthropic') {
    return {
      id: 'B1',
      status: 'unsupported_surface',
      surface,
      httpStatus: first.status,
      message: surface === 'openai'
        ? '目标返回 OpenAI 兼容形状，不是 Anthropic Messages API'
        : '目标响应不是 Anthropic Messages 形状',
    };
  }
  const blocks = Array.isArray(first.json?.content) ? first.json.content : [];
  const index = blocks.findIndex(block => block?.type === 'thinking' || block?.type === 'redacted_thinking');
  // 上游可控的 type 字符串必须限长并抹掉 Key：恶意中转站可以把 Key
  // 回显到 content type 里，报告随后会被页面/CLI/本地存储原样带出。
  const contentTypes = blocks
    .slice(0, 16)
    .map(block => redact(String(block?.type ?? ''), config.apiKey).slice(0, 64))
    .filter(Boolean);
  if (index < 0) {
    return {
      id: 'B1',
      status: 'no_thinking',
      surface,
      httpStatus: first.status,
      contentTypes,
      message: '响应没有 thinking 块；可能是请求未触发，也可能是中转层剥离',
    };
  }
  const block = blocks[index];
  const signature = block.type === 'redacted_thinking' ? block.data : block.signature;
  if (typeof signature !== 'string' || !signature) {
    return {
      id: 'B1',
      status: 'signature_missing',
      surface,
      httpStatus: first.status,
      contentTypes,
      signatureLength: 0,
      message: 'thinking 块没有签名',
    };
  }
  if (signature.length < 16) {
    return {
      id: 'B1',
      status: 'signature_short',
      surface,
      httpStatus: first.status,
      contentTypes,
      signatureLength: signature.length,
      message: 'thinking 签名短于正常长度',
    };
  }
  const validReplay = await replayB1(client, config.model, blocks, index, false, thinking);
  const tamperedReplay = await replayB1(client, config.model, blocks, index, true, thinking);
  let status;
  let droppedNote = null;
  if (validReplay.status === 'accepted' && tamperedReplay.status === 'rejected') {
    status = 'native_signal';
  } else if (validReplay.status === 'accepted' && tamperedReplay.status === 'accepted') {
    droppedNote = redact(validReplay.dropped || tamperedReplay.dropped, config.apiKey).slice(0, 300);
    if (!droppedNote) {
      const control = await replayWithoutThinking(client, config.model, blocks, thinking);
      if (
        control?.status === 'accepted'
        && control.usage !== null
        && validReplay.usage !== null
        && tamperedReplay.usage !== null
        && validReplay.usage === control.usage
        && tamperedReplay.usage === control.usage
      ) {
        droppedNote = `重放 usage=${control.usage} 与去掉 thinking 的控制组相同`;
      }
    }
    status = droppedNote ? 'block_dropped' : 'tamper_accepted';
  } else if (validReplay.status === 'accepted' && tamperedReplay.status === 'rejected_other') {
    status = 'tamper_rejected_unclear';
  } else if (validReplay.status !== 'accepted') {
    status = `replay_${validReplay.status}`;
  } else {
    status = 'unknown';
  }
  return {
    id: 'B1',
    status,
    surface,
    httpStatus: first.status,
    contentTypes,
    signatureLength: signature.length,
    validReplay,
    tamperedReplay,
    message: status === 'native_signal'
      ? '有效重放成功，篡改签名后被拒绝'
      : status === 'tamper_accepted'
        ? '篡改 thinking 签名后请求仍然成功'
        : status === 'block_dropped'
          ? `重放成功但 thinking 块疑似被丢弃，不能算篡改被接受${droppedNote ? `（${droppedNote}）` : ''}`
          : status === 'tamper_rejected_unclear'
            ? '篡改后被拒绝，但错误信息未指向签名校验'
            : status === 'replay_invalid_response'
              ? '重放返回 2xx，但不是有效的 Anthropic Message'
              : '无法完成有效的签名重放对照',
  };
}

async function countForModel(client, model) {
  const result = await client.countTokens({
    model,
    messages: [{ role: 'user', content: TOKEN_TEXT }],
  });
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    count: numberOrNull(result.json?.input_tokens),
  };
}

async function probeC1(client, config) {
  const counted = await countForModel(client, config.model);
  if (!counted.ok) {
    return {
      id: 'C1',
      status: counted.status === 404 || counted.status === 405 ? 'unsupported' : 'error',
      httpStatus: counted.status,
      message: counted.message,
    };
  }
  if (counted.count === null || counted.count <= 0) {
    return { id: 'C1', status: 'invalid_count', httpStatus: counted.status, message: 'count_tokens 没有返回有效计数' };
  }
  const generated = await client.messages({
    model: config.model,
    max_tokens: 64,
    messages: [{ role: 'user', content: TOKEN_TEXT }],
  });
  if (!generated.ok) {
    return {
      id: 'C1',
      status: 'generation_failed',
      httpStatus: generated.status,
      counted: counted.count,
      message: generated.message,
    };
  }
  const used = numberOrNull(generated.json?.usage?.input_tokens);
  if (used === null || used <= 0) {
    return {
      id: 'C1',
      status: 'usage_missing',
      httpStatus: generated.status,
      counted: counted.count,
      message: '生成响应没有可用的 usage.input_tokens',
    };
  }
  const diff = used - counted.count;
  // 同一段输入在原生实现里应逐 token 相等。允许 ±1 只是为了容忍
  // 版本间极小的计数边界差异；2%/2 token 的宽带有过 2.3% 仍算一致的假绿。
  return {
    id: 'C1',
    status: diff === 0 ? 'match' : Math.abs(diff) <= 1 ? 'near_match' : 'mismatch',
    httpStatus: generated.status,
    counted: counted.count,
    used,
    diff,
    percent: counted.count ? diff / counted.count : null,
  };
}

// 同代模型可能共用 tokenizer；此时计数相同是预期行为，不能当伪造证据。
// Claude 4.7 及以后（含 4.8、5.x、Fable/Mythos 5.x）共用新 tokenizer；
// 4.6 及以前共用旧 tokenizer。把这两组各自合并，避免原生中转站被 C2 误加分。
function tokenizerFamily(model) {
  const id = String(model).toLowerCase();
  if (/claude-(?:sonnet|opus|haiku)-5(?:-|$)/.test(id)
    || /claude-(?:fable|mythos)-5(?:-|$)/.test(id)
    || /claude-mythos-preview/.test(id)
    || /claude-(?:sonnet|opus|haiku)-4-(?:7|8)(?:-|$)/.test(id)) return 'claude-47-plus';
  if (/claude-(?:3|4)(?:-|$)/.test(id)
    || /claude-(?:sonnet|opus|haiku)-4(?:-|$)/.test(id)) return 'claude-pre-47';
  return 'unknown';
}

async function probeC2(client, config) {
  if (config.model === config.comparisonModel) {
    return { id: 'C2', status: 'skipped', reason: '主模型与对照模型相同' };
  }
  const [primary, comparison] = await Promise.all([
    countForModel(client, config.model),
    countForModel(client, config.comparisonModel),
  ]);
  if (!primary.ok || !comparison.ok) {
    return {
      id: 'C2',
      status: primary.ok ? 'comparison_unavailable' : 'error',
      primary: { ok: primary.ok, status: primary.status, count: primary.count },
      comparison: { ok: comparison.ok, status: comparison.status, count: comparison.count },
      message: primary.ok ? comparison.message : primary.message,
    };
  }
  if (primary.count === null || comparison.count === null || primary.count <= 0 || comparison.count <= 0) {
    return {
      id: 'C2',
      status: 'invalid_count',
      primary: { count: primary.count },
      comparison: { count: comparison.count },
      message: '两个模型没有返回有效计数',
    };
  }
  const ratio = primary.count / comparison.count;
  const primaryFamily = tokenizerFamily(config.model);
  const comparisonFamily = tokenizerFamily(config.comparisonModel);
  const sameFamily = primaryFamily !== 'unknown' && primaryFamily === comparisonFamily;
  const bothKnown = primaryFamily !== 'unknown' && comparisonFamily !== 'unknown';
  let status;
  if (sameFamily) {
    // 同代 tokenizer：相同/几乎相同是预期，比例明显异常才记 differ_other。
    status = Math.abs(ratio - 1) <= 0.03 ? 'same_tokenizer' : 'differ_other';
  } else if (bothKnown) {
    if (primary.count === comparison.count) status = 'identical';
    else if (Math.abs(ratio - 1) <= 0.03) status = 'near_identical';
    else if (ratio >= 1.1 && ratio <= 1.6) status = 'differ_expected';
    else status = 'differ_other';
  } else {
    // 世代未知时，相同计数也可能只是同代 tokenizer，不能单独下结论。
    status = primary.count === comparison.count ? 'identical_unknown'
      : Math.abs(ratio - 1) <= 0.03 ? 'near_identical_unknown'
        : ratio >= 1.1 && ratio <= 1.6 ? 'differ_expected'
          : 'differ_other';
  }
  return {
    id: 'C2',
    status,
    primary: { model: config.model, count: primary.count, family: primaryFamily },
    comparison: { model: config.comparisonModel, count: comparison.count, family: comparisonFamily },
    ratio,
  };
}

function skipped(id, reason) {
  return { id, status: 'skipped', reason };
}

function buildVerdict(b1, c1, c2) {
  const signals = [];
  const add = (id, kind, weight, detail) => signals.push({ id, kind, weight, detail });
  if (b1.status === 'tamper_accepted') add('B1', 'forged', 4, '篡改 thinking 签名后仍返回成功');
  if (['signature_missing', 'signature_short'].includes(b1.status)) {
    add('B1', 'forged', 2, b1.message || 'thinking 签名不可用');
  }
  if (b1.status === 'no_thinking') {
    // adaptive thinking 可能选择不思考，不能把“没有块”本身当成伪造证据。
    add('B1', 'info', 0, b1.message || '响应没有 thinking 块，无法验签');
  }
  if (b1.status === 'block_dropped') {
    add('B1', 'info', 0, b1.message || 'thinking 块疑似被中转层丢弃，无法验签');
  }
  if (b1.status === 'thinking_unsupported') {
    add('B1', 'info', 0, b1.message || '目标拒绝 thinking 配置，无法验签');
  }
  if (b1.status === 'native_signal') add('B1', 'native', 4, '有效签名重放成功，篡改签名被拒绝');
  if (c1.status === 'mismatch') {
    add('C1', 'forged', 3, `count_tokens=${c1.counted}，usage.input_tokens=${c1.used}，差 ${c1.diff}（${(c1.percent * 100).toFixed(1)}%）`);
  }
  if (c1.status === 'match') add('C1', 'native', 1, `count_tokens 与 usage.input_tokens 一致（${c1.counted}）`);
  if (c2.status === 'identical') add('C2', 'forged', 2, `两个不同代模型的 token 计数完全相同（${c2.primary.count}）`);
  if (c2.status === 'near_identical') add('C2', 'forged', 1, `两个不同代模型的 token 计数仅差 ${(Math.abs(c2.ratio - 1) * 100).toFixed(1)}%`);
  if (c2.status === 'same_tokenizer') add('C2', 'info', 0, `两个模型属于同代 tokenizer，计数相同是预期行为（${c2.primary.count}）`);
  if (c2.status === 'identical_unknown' || c2.status === 'near_identical_unknown') {
    add('C2', 'info', 0, '模型世代未知，计数相同不足以作为伪造证据');
  }

  const forgedScore = signals.filter(signal => signal.kind === 'forged').reduce((sum, signal) => sum + signal.weight, 0);
  const nativeScore = signals.filter(signal => signal.kind === 'native').reduce((sum, signal) => sum + signal.weight, 0);
  const forgedCount = signals.filter(signal => signal.kind === 'forged').length;
  const caveat = '行为指纹不是身份证明；高质量中转层可以伪造单个信号，结论应结合多项证据。';

  if (b1.status === 'auth_error') {
    return { code: 'auth_error', label: '检测失败：认证被拒绝', confidence: 'low', forgedScore, nativeScore, signals, caveat };
  }
  if (b1.status === 'endpoint_not_found') {
    return { code: 'endpoint_not_found', label: '检测失败：接口路径或模型不存在', confidence: 'low', forgedScore, nativeScore, signals, caveat };
  }
  if (b1.status === 'network_error' || b1.status === 'aborted') {
    return { code: 'network_error', label: '检测失败：网络不可达或已中止', confidence: 'low', forgedScore, nativeScore, signals, caveat };
  }
  if (b1.status === 'unsupported_surface') {
    return { code: 'unsupported_surface', label: '无法检测：目标不是 Anthropic Messages API', confidence: 'low', forgedScore, nativeScore, signals, caveat };
  }
  // “极大概率”要求 B1 出现强伪造信号（篡改签名仍被接受），
  // 再加 C1 的独立强异常（计数与生成 usage 不一致）。只有 C2 相同、
  // C1 却一致时降为“疑似”：C2 可能只是对照模型选到了同代 tokenizer，
  // 不足以单独给模型身份下结论。
  if (
    b1.status === 'tamper_accepted'
    && c1.status === 'mismatch'
    && forgedScore >= 7
    && forgedCount >= 2
    && forgedScore >= nativeScore + 2
  ) {
    return {
      code: 'likely_forged',
      label: '该中转站极大概率伪造了模型',
      confidence: forgedScore >= 9 ? 'high' : 'medium',
      forgedScore,
      nativeScore,
      signals,
      caveat,
    };
  }
  if (forgedScore >= 3 && forgedScore > nativeScore) {
    return {
      code: 'suspicious',
      label: '该中转站疑似非原生或翻译层，但是否伪造模型证据不足',
      confidence: 'medium',
      forgedScore,
      nativeScore,
      signals,
      caveat,
    };
  }
  // “与原生一致”必须同时满足：B1 验签通过、C1 精确一致、C2 符合预期
  // （同代 tokenizer 或跨代比例正常）。缺少任何一项都只能说“证据不足”，
  // 不能因为 B1 单点通过就退出码 0。
  if (
    b1.status === 'native_signal'
    && c1.status === 'match'
    && ['differ_expected', 'same_tokenizer', 'skipped'].includes(c2.status)
    && forgedScore === 0
  ) {
    return {
      code: 'native_consistent',
      label: '未发现伪造证据：行为与原生 Claude 一致',
      confidence: 'medium',
      forgedScore,
      nativeScore,
      signals,
      caveat,
    };
  }
  return {
    code: 'inconclusive',
    label: '证据不足，无法判断',
    confidence: 'low',
    forgedScore,
    nativeScore,
    signals,
    caveat,
  };
}

// Dock 插件协议单帧上限 1 MiB；报告会被 view/status/存储各带一份，
// 因此核心层先压到 256 KiB，避免上游把插件通道撑爆后连状态都读不到。
function limitReport(report) {
  if (Buffer.byteLength(JSON.stringify(report)) <= MAX_REPORT_BYTES) return report;
  const copy = structuredClone(report);
  if (copy.b1) {
    copy.b1.contentTypes = [];
    copy.b1.truncated = true;
    if (typeof copy.b1.message === 'string') copy.b1.message = copy.b1.message.slice(0, 600);
  }
  for (const key of ['validReplay', 'tamperedReplay']) {
    if (copy.b1?.[key] && typeof copy.b1[key].message === 'string') {
      copy.b1[key].message = copy.b1[key].message.slice(0, 200);
    }
  }
  copy.reportTruncated = true;
  return copy;
}

export async function probeRelay(input = {}, options = {}) {
  const config = normalizeProbeConfig(input);
  const fetchImpl = options.fetch ?? input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new ProbeError('FETCH_UNAVAILABLE', '当前环境没有可用的 fetch');
  const client = createClient(config, fetchImpl);
  const b1 = await probeB1(client, config);
  let c1;
  let c2;
  if (['unsupported_surface', 'auth_error', 'endpoint_not_found', 'network_error', 'aborted'].includes(b1.status)) {
    c1 = skipped('C1', 'B1 未建立可用的 Anthropic 会话');
    c2 = skipped('C2', 'B1 未建立可用的 Anthropic 会话');
  } else {
    c1 = await probeC1(client, config);
    c2 = await probeC2(client, config);
  }
  const verdict = buildVerdict(b1, c1, c2);
  return limitReport({
    schema: 1,
    generatedAt: new Date(options.clock ? options.clock() : Date.now()).toISOString(),
    target: {
      baseUrl: redact(publicBaseUrl(config.baseUrl), config.apiKey),
      model: config.model,
      comparisonModel: config.comparisonModel,
      apiVersion: client.version,
      authMode: client.authMode,
    },
    b1,
    c1,
    c2,
    verdict,
  });
}

export const constants = Object.freeze({
  DEFAULT_MODEL,
  COMPARISON_MODEL,
  DEFAULT_API_VERSION,
  LEGACY_API_VERSION,
  TOKEN_TEXT,
});
