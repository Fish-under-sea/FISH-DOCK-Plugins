import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constants,
  normalizeBaseUrl,
  normalizeProbeConfig,
  normalizeSettings,
  probeRelay,
  publicBaseUrl,
} from './probe.mjs';

const KEY = 'test-key-relay-probe-123456';
const ORIGINAL_SIGNATURE = `sig-${'A'.repeat(64)}`;

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function anthropicMessage(content, usage = { input_tokens: 20, output_tokens: 10 }) {
  return {
    id: 'msg_synthetic',
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: 'end_turn',
    usage,
  };
}

function countBody(inputTokens) {
  return { input_tokens: inputTokens };
}

function nativeFetch() {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) {
      if (body.model === 'claude-sonnet-5-5') return reply(200, countBody(130));
      if (body.model === 'claude-sonnet-4-6') return reply(200, countBody(100));
      return reply(404, { type: 'error', error: { type: 'not_found_error', message: `model: ${body.model}` } });
    }
    if (body.messages.length === 3) {
      const thinking = body.messages[1].content.find(block => block.type === 'thinking');
      if (thinking?.signature === ORIGINAL_SIGNATURE) return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=6647' }]));
      return reply(400, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'thinking block signature is invalid' },
      });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 130, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: '391 * 17 = 6647', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=6647' },
    ]));
  };
}

function forgedFetch() {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) {
      if (body.model === 'claude-sonnet-5-5') return reply(200, countBody(100));
      if (body.model === 'claude-sonnet-4-6') return reply(200, countBody(100));
      return reply(404, { type: 'error', error: { type: 'not_found_error', message: 'model: unknown' } });
    }
    if (body.messages.length === 3) {
      // 去掉 thinking 块的控制组用量更低；两条重放都按“块被计费”返回 130。
      const hasThinking = body.messages[1].content.some(block => block.type === 'thinking');
      return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=6647' }], {
        input_tokens: hasThinking ? 130 : 100,
        output_tokens: 1,
      }));
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 140, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'not really thinking', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=6647' },
    ]));
  };
}

test('URL 规范化：接受 /v1、完整 messages 路径和本机 HTTP', () => {
  assert.equal(normalizeBaseUrl('https://Example.com/v1/'), 'https://example.com');
  assert.equal(normalizeBaseUrl('https://example.com/api/v1'), 'https://example.com/api');
  assert.equal(normalizeBaseUrl('https://example.com/v1/messages'), 'https://example.com');
  assert.equal(normalizeBaseUrl('https://example.com/v1/messages/count_tokens'), 'https://example.com');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:18901/v1'), 'http://127.0.0.1:18901');
  assert.equal(publicBaseUrl('https://example.com/api/v1'), 'https://example.com/api');
  assert.throws(() => normalizeBaseUrl('http://example.com/v1'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:pass@example.com/v1'), /用户名或密码/);
  assert.throws(() => normalizeBaseUrl('https://example.com/v1#x'), /#/);
  assert.throws(() => normalizeBaseUrl('https://example.com/v1?token=x'), /查询参数/);
});

test('配置校验：Key 必填、模型/版本/超时格式受控', () => {
  assert.throws(() => normalizeProbeConfig(null), /配置格式/);
  assert.throws(() => normalizeProbeConfig([]), /配置格式/);
  assert.throws(() => normalizeSettings(null), /配置格式/);
  assert.throws(() => normalizeSettings({ authMode: 'basic' }), /认证方式/);
  assert.throws(() => normalizeProbeConfig({ baseUrl: 'https://example.com' }), /API Key/);
  assert.throws(() => normalizeProbeConfig({ baseUrl: 'https://example.com', apiKey: KEY, model: 'bad model' }), /模型 ID/);
  assert.throws(() => normalizeProbeConfig({ baseUrl: 'https://example.com', apiKey: KEY, apiVersion: 'latest' }), /YYYY-MM-DD/);
  assert.throws(() => normalizeProbeConfig({ baseUrl: 'https://example.com', apiKey: KEY, authMode: 'basic' }), /认证方式/);
  assert.throws(() => normalizeProbeConfig({ baseUrl: 'https://example.com', apiKey: KEY, timeoutMs: 10 }), /5000/);
  const config = normalizeProbeConfig({
    baseUrl: 'https://example.com/v1',
    apiKey: KEY,
    model: 'claude-sonnet-5-5',
    comparisonModel: 'claude-sonnet-4-6',
  });
  assert.equal(config.baseUrl, 'https://example.com');
  assert.equal(config.model, 'claude-sonnet-5-5');
});

test('原生形状：有效重放 200、篡改签名 400，C1 一致，C2 比例正常', async () => {
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch: nativeFetch(), clock: () => 0 },
  );
  assert.equal(report.b1.status, 'native_signal');
  assert.equal(report.b1.validReplay.status, 'accepted');
  assert.equal(report.b1.tamperedReplay.status, 'rejected');
  assert.equal(report.c1.status, 'match');
  assert.equal(report.c1.counted, 130);
  assert.equal(report.c1.used, 130);
  assert.equal(report.c2.status, 'differ_expected');
  assert.equal(report.c2.ratio, 1.3);
  assert.equal(report.verdict.code, 'native_consistent');
  assert.ok(!JSON.stringify(report).includes(KEY));
});

test('伪造形状：篡改签名仍 200、C1 差异大、C2 完全相同，判为极大概率伪造', async () => {
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch: forgedFetch(), clock: () => 0 },
  );
  assert.equal(report.b1.status, 'tamper_accepted');
  assert.equal(report.c1.status, 'mismatch');
  assert.equal(report.c2.status, 'identical');
  assert.equal(report.verdict.code, 'likely_forged');
  assert.equal(report.verdict.label, '该中转站极大概率伪造了模型');
  assert.equal(report.verdict.confidence, 'high');
  assert.ok(!JSON.stringify(report).includes(KEY));
});

test('篡改签名被接受但 C1 一致时只判疑似，不把 C2 相同单独当伪造铁证', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) return reply(200, countBody(100));
    if (body.messages.length === 3) {
      const hasThinking = body.messages[1].content.some(block => block.type === 'thinking');
      return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }], {
        input_tokens: hasThinking ? 100 : 50,
        output_tokens: 1,
      }));
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 100, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'not really thinking', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'tamper_accepted');
  assert.equal(report.c1.status, 'match');
  assert.equal(report.c2.status, 'identical');
  assert.equal(report.verdict.code, 'suspicious');
  assert.match(report.verdict.label, /疑似/);
});

test('没有 thinking 块时不再假装能验签，但 C1/C2 异常仍可形成结论', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) return reply(200, countBody(100));
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 130, output_tokens: 1 }));
    return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=6647' }]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'no_thinking');
  assert.equal(report.c1.status, 'mismatch');
  assert.equal(report.c2.status, 'identical');
  assert.equal(report.verdict.code, 'suspicious');
  assert.match(report.verdict.label, /疑似/);
});

test('OpenAI 兼容形状：明确报告不适用，不伪造 B1/C1/C2 结论', async () => {
  const fetch = async () => reply(200, {
    id: 'chatcmpl-synthetic',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
  });
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'unsupported_surface');
  assert.equal(report.c1.status, 'skipped');
  assert.equal(report.c2.status, 'skipped');
  assert.equal(report.verdict.code, 'unsupported_surface');
});

test('认证失败时自动尝试两种头部，但报告和错误都不回显 Key', async () => {
  const seen = [];
  const fetch = async (url, options) => {
    seen.push(options.headers);
    return reply(401, {
      type: 'error',
      error: { type: 'authentication_error', message: `invalid key ${KEY}` },
    });
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'auth_error');
  assert.equal(report.verdict.code, 'auth_error');
  assert.equal(seen.length, 2);
  assert.equal(seen[0]['x-api-key'], KEY);
  assert.equal(seen[1].authorization, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(report).includes(KEY));
  assert.match(report.b1.message, /<REDACTED>/);
});

test('篡改被泛泛的 invalid request 拒绝时只算 unclear，不算原生签名校验', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) {
      if (body.model === 'claude-sonnet-5-5') return reply(200, countBody(130));
      return reply(200, countBody(100));
    }
    if (body.messages.length === 3) {
      const thinking = body.messages[1].content.find(block => block.type === 'thinking');
      if (thinking?.signature === ORIGINAL_SIGNATURE) return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }]));
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'invalid request body' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 130, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'tamper_rejected_unclear');
  assert.equal(report.verdict.code, 'inconclusive');
});

test('有效重放也被拒绝时不硬判伪造', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) {
      if (body.model === 'claude-sonnet-5-5') return reply(200, countBody(130));
      return reply(200, countBody(100));
    }
    if (body.messages.length === 3) {
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'thinking block cannot be replayed' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 130, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=6647' },
    ]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'replay_rejected');
  assert.equal(report.verdict.code, 'inconclusive');
});

test('上游把 Key 回显到 content type 时会被抹掉并限长', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) return reply(200, countBody(100));
    if (body.messages.length === 3) {
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'thinking block signature is invalid' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 100, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: KEY, text: 'echo' },
      { type: 'x'.repeat(1_500_000), text: 'large' },
    ]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'no_thinking');
  assert.ok(report.b1.contentTypes.length <= 16);
  assert.ok(!JSON.stringify(report).includes(KEY));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 256 * 1024);
});

test('重放返回 200 空响应时不算篡改被接受', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) {
      if (body.model === 'claude-sonnet-5-5') return reply(200, countBody(130));
      return reply(200, countBody(100));
    }
    if (body.messages.length === 3) return new Response('', { status: 200 });
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 130, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.validReplay.status, 'invalid_response');
  assert.equal(report.b1.status, 'replay_invalid_response');
  assert.notEqual(report.verdict.code, 'likely_forged');
});

test('重放用量与去掉 thinking 的控制组相同，判为块被丢弃而非篡改被接受', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) {
      if (body.model === 'claude-sonnet-5-5') return reply(200, countBody(130));
      return reply(200, countBody(100));
    }
    if (body.messages.length === 3) {
      // 无论 assistant 内容里有没有 thinking 块，usage 都一样：块被中转层丢弃了。
      return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }], { input_tokens: 100, output_tokens: 1 }));
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 130, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'block_dropped');
  assert.notEqual(report.verdict.code, 'likely_forged');
});

test('同代 tokenizer 计数相同是预期，不算伪造证据', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) return reply(200, countBody(100));
    if (body.messages.length === 3) {
      const thinking = body.messages[1].content.find(block => block.type === 'thinking');
      if (thinking?.signature === ORIGINAL_SIGNATURE) return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }]));
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'thinking block signature is invalid' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 100, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    {
      baseUrl: 'https://relay.example/v1',
      apiKey: KEY,
      model: 'claude-sonnet-5-5',
      comparisonModel: 'claude-sonnet-5',
    },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.c2.status, 'same_tokenizer');
  assert.equal(report.verdict.code, 'native_consistent');
});

test('Opus 4.7/4.8 与 5.x 共用 post-4.7 tokenizer，计数相同不判伪造', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) return reply(200, countBody(100));
    if (body.messages.length === 3) {
      const thinking = body.messages[1].content.find(block => block.type === 'thinking');
      if (thinking?.signature === ORIGINAL_SIGNATURE) return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }]));
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'thinking block signature is invalid' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 100, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    {
      baseUrl: 'https://relay.example/v1',
      apiKey: KEY,
      model: 'claude-sonnet-5-5',
      comparisonModel: 'claude-opus-4-8',
    },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.c2.status, 'same_tokenizer');
  assert.equal(report.c2.primary.family, 'claude-47-plus');
  assert.equal(report.c2.comparison.family, 'claude-47-plus');
  assert.equal(report.verdict.code, 'native_consistent');
});

test('Sonnet 4.5 与 4.6 共用旧 tokenizer，计数相同不判伪造', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) return reply(200, countBody(100));
    if (body.messages.length === 3) {
      const thinking = body.messages[1].content.find(block => block.type === 'thinking');
      if (thinking?.signature === ORIGINAL_SIGNATURE) return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }]));
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'thinking block signature is invalid' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 100, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    {
      baseUrl: 'https://relay.example/v1',
      apiKey: KEY,
      model: 'claude-sonnet-4-5',
      comparisonModel: 'claude-sonnet-4-6',
    },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.c2.status, 'same_tokenizer');
  assert.equal(report.c2.primary.family, 'claude-pre-47');
  assert.equal(report.c2.comparison.family, 'claude-pre-47');
  assert.equal(report.verdict.code, 'native_consistent');
});

test('B1 通过但 C1 不可用时不能判为原生一致', async () => {
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) {
      return reply(404, { type: 'error', error: { type: 'not_found_error', message: 'count_tokens is not supported' } });
    }
    if (body.messages.length === 3) {
      const thinking = body.messages[1].content.find(block => block.type === 'thinking');
      if (thinking?.signature === ORIGINAL_SIGNATURE) return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }]));
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'thinking block signature is invalid' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 130, output_tokens: 1 }));
    return reply(200, anthropicMessage([
      { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
      { type: 'text', text: 'FINAL=0.05' },
    ]));
  };
  const report = await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY },
    { fetch, clock: () => 0 },
  );
  assert.equal(report.b1.status, 'native_signal');
  assert.equal(report.c1.status, 'unsupported');
  assert.equal(report.c2.status, 'error');
  assert.equal(report.verdict.code, 'inconclusive');
});

test('thinking 配置按模型世代选择：4.x 日期版用 enabled，3.5 不发 thinking', async () => {
  const seen = [];
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/count_tokens')) return reply(200, countBody(100));
    if (body.messages.length === 1) {
      seen.push(body);
      if (body.model === 'claude-3-5-sonnet-20241022') {
        return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }]));
      }
      return reply(200, anthropicMessage([
        { type: 'thinking', thinking: 'x', signature: ORIGINAL_SIGNATURE },
        { type: 'text', text: 'FINAL=0.05' },
      ]));
    }
    if (body.messages.length === 3) {
      const thinking = body.messages[1].content.find(block => block.type === 'thinking');
      if (thinking?.signature === ORIGINAL_SIGNATURE) return reply(200, anthropicMessage([{ type: 'text', text: 'FINAL=0.05' }]));
      return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'thinking block signature is invalid' } });
    }
    if (body.max_tokens === 64) return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }], { input_tokens: 100, output_tokens: 1 }));
    return reply(200, anthropicMessage([{ type: 'text', text: 'OK' }]));
  };
  await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY, model: 'claude-sonnet-4-20250514' },
    { fetch, clock: () => 0 },
  );
  await probeRelay(
    { baseUrl: 'https://relay.example/v1', apiKey: KEY, model: 'claude-3-5-sonnet-20241022' },
    { fetch, clock: () => 0 },
  );
  const dated = seen.find(body => body.model === 'claude-sonnet-4-20250514');
  const legacy = seen.find(body => body.model === 'claude-3-5-sonnet-20241022');
  assert.equal(dated.thinking.type, 'enabled');
  assert.equal(legacy.thinking, undefined);
});

test('常量与探测文本保持可测试的稳定值', () => {
  assert.equal(constants.DEFAULT_MODEL, 'claude-sonnet-5-5');
  assert.equal(constants.COMPARISON_MODEL, 'claude-sonnet-4-6');
  assert.match(constants.TOKEN_TEXT, /Tokenizer probe/);
});
