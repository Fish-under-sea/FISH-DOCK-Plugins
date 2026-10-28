#!/usr/bin/env node
import fs from 'node:fs';
import { probeRelay, redact } from './probe.mjs';

const HELP = `FISH Dock 中转站行为探针

用法：
  node cli.mjs --base <Base URL> [--key <Key> | --key-file <Path>] [选项]

推荐把 Key 写进只有本人可读的文件，用 --key-file 读取：
  node cli.mjs --base https://<REDACTED>/v1 --key-file C:/work/relay.key

（PowerShell 的 PSReadLine 会把整行命令写进历史；直接赋值环境变量也可能留痕。）

选项：
  --base <URL>           Anthropic 兼容 Base URL，可带 /v1（也可用 FISH_RELAY_BASE）
  --key <Key>            API Key（不推荐；会留在 shell 历史）
  --key-file <Path>      从文件读取 API Key
  --model <ID>           主模型，默认 claude-sonnet-5-5
  --comparison <ID>      对照模型，默认 claude-sonnet-4-6
  --auth <mode>          auto | x-api-key | bearer | both，默认 auto
  --api-version <日期>   默认 2026-10-21；失败时会尝试 2023-06-01
  --timeout <毫秒>       单个请求超时，默认 45000
  --json                 只输出 JSON 报告
  -h, --help             显示帮助

退出码：0 未发现伪造证据；1 疑似；2 极大概率伪造；3 无法判断/失败。
本工具只向 --base 指定的地址发送请求，不会上传 Key 到其他地方。`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const has = name => args.includes(name);
  if (has('--help') || has('-h')) return { help: true };
  const value = name => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error(`${name} 缺少参数值`);
    return args[index + 1];
  };
  return {
    help: false,
    baseUrl: value('--base') ?? process.env.FISH_RELAY_BASE ?? '',
    key: value('--key') ?? '',
    keyFile: value('--key-file') ?? '',
    model: value('--model'),
    comparisonModel: value('--comparison'),
    authMode: value('--auth'),
    apiVersion: value('--api-version'),
    timeoutMs: value('--timeout'),
    json: has('--json'),
  };
}

function readKey(options) {
  if (options.keyFile) return fs.readFileSync(options.keyFile, 'utf8').trim();
  if (options.key) {
    console.error('警告：--key 可能留在 shell 历史；请改用 --key-file 读取受保护的文件。');
    return options.key.trim();
  }
  return String(process.env.FISH_RELAY_KEY ?? '').trim();
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function printHuman(report) {
  const { verdict, b1, c1, c2, target } = report;
  console.log('');
  console.log(`结论：${verdict.label}`);
  console.log(`置信度：${verdict.confidence}`);
  console.log(`目标：${target.baseUrl}（主模型 ${target.model}，对照 ${target.comparisonModel}）`);
  console.log('');
  console.log('证据：');
  if (verdict.signals.length === 0) console.log('- 没有形成可评分的行为信号');
  for (const signal of verdict.signals) console.log(`- [${signal.id}] ${signal.detail}`);
  console.log('');
  console.log('明细：');
  console.log(`- B1 thinking 签名：${b1.status}${b1.message ? ` — ${b1.message}` : ''}`);
  if (b1.signatureLength !== undefined) console.log(`  签名长度：${b1.signatureLength}`);
  if (c1.status !== 'skipped') {
    console.log(`- C1 token 计数：${c1.status}${c1.counted !== undefined && c1.used !== undefined ? ` — count_tokens=${c1.counted}, usage=${c1.used}, 差=${c1.diff}（${formatPercent(c1.percent)}）` : c1.message ? ` — ${c1.message}` : ''}`);
  } else {
    console.log(`- C1 token 计数：跳过 — ${c1.reason}`);
  }
  if (c2.status !== 'skipped') {
    console.log(`- C2 跨代 tokenizer：${c2.status}${c2.ratio !== undefined ? ` — ${c2.primary.count} / ${c2.comparison.count} = ${c2.ratio.toFixed(3)}` : ''}`);
  } else {
    console.log(`- C2 跨代 tokenizer：跳过 — ${c2.reason}`);
  }
  console.log('');
  console.log(`边界：${verdict.caveat}`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 3;
    return;
  }
  if (options.help) {
    console.log(HELP);
    return;
  }
  let apiKey;
  try {
    apiKey = readKey(options);
  } catch (error) {
    console.error(`读取 Key 失败：${redact(error?.message || error)}`);
    process.exitCode = 3;
    return;
  }
  if (!options.baseUrl || !apiKey) {
    console.error('缺少 --base 或 API Key。使用 --help 查看用法。');
    process.exitCode = 3;
    return;
  }
  let report;
  try {
    report = await probeRelay({
      baseUrl: options.baseUrl,
      apiKey,
      model: options.model,
      comparisonModel: options.comparisonModel,
      authMode: options.authMode,
      apiVersion: options.apiVersion,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    console.error(`检测失败：${redact(error?.message || error, apiKey)}`);
    process.exitCode = 3;
    return;
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  const code = report.verdict.code;
  process.exitCode = code === 'native_consistent' ? 0
    : code === 'suspicious' ? 1
      : code === 'likely_forged' ? 2
        : 3;
}

await main();
