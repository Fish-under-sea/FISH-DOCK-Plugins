// 假 DOM 下的状态机测试：不开浏览器、不联网，只喂事件。
// 覆盖三条验收：配置读回前禁用、启动轮询到完成、停止后迟到状态不回弹。

import test from "node:test";
import assert from "node:assert/strict";

import { createRelayPage } from "./app.js";

class FakeEl {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn();
  }
  replaceChildren(...children) {
    this.children = children;
  }
}

const IDS = [
  "relay", "baseUrl", "apiKey", "keyState", "model", "comparisonModel", "authMode",
  "apiVersion", "timeoutMs", "save", "start", "stop", "notice", "verdict", "signals",
  "caveat", "probes",
];

function fakeDocument() {
  const nodes = new Map(IDS.map((id) => [id, new FakeEl(id)]));
  return {
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tag) => new FakeEl(tag),
    nodes,
  };
}

// timers 由测试手动推进：轮询不真的等 1.5 秒。
function fakeTimers() {
  const pending = new Map();
  let next = 0;
  return {
    set(fn) {
      const id = ++next;
      pending.set(id, fn);
      return id;
    },
    clear(id) {
      pending.delete(id);
    },
    async runAll() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) await fn();
    },
    get size() {
      return pending.size;
    },
  };
}

// fakeBridge 记录调用，并按脚本回答。
function fakeBridge(script) {
  const calls = [];
  return {
    calls,
    async call(name, params) {
      calls.push({ name, params });
      const answer = script[name];
      if (typeof answer === "function") return answer(params, calls);
      if (answer === undefined) throw new Error(`no such call: ${name}`);
      return answer;
    },
  };
}

const config = {
  baseUrl: "https://relay.example.com",
  baseUrlRaw: "https://relay.example.com",
  model: "claude-sonnet-5-5",
  comparisonModel: "claude-sonnet-4-6",
  authMode: "auto",
  apiVersion: "2026-10-21",
  timeoutMs: 45000,
  keyHint: "sk-a…9f2a",
  hasKey: true,
};

const doneReport = {
  schema: 1,
  b1: { status: "native_signal", message: "有效重放成功，篡改签名后被拒绝" },
  c1: { status: "match", message: "" },
  c2: { status: "differ_expected", message: "" },
  verdict: {
    code: "native_consistent",
    label: "未发现伪造证据：行为与原生 Claude 一致",
    forgedScore: 0,
    nativeScore: 5,
    signals: [{ id: "B1", kind: "native", weight: 4, detail: "有效签名重放成功，篡改签名被拒绝" }],
    caveat: "行为指纹不是身份证明。",
  },
};

test("配置读回之前，按钮一律禁用", async () => {
  const doc = fakeDocument();
  const timers = fakeTimers();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = fakeBridge({
    "relay:view": async () => {
      await gate;
      return { config, state: { status: "idle" } };
    },
  });
  const page = createRelayPage({ magpie: bridge, doc, timers });

  const mounted = page.mount();
  // 还没读回来
  assert.equal(doc.getElementById("start").disabled, true);
  assert.equal(doc.getElementById("save").disabled, true);
  assert.equal(doc.getElementById("stop").disabled, true);

  release();
  await mounted;
  assert.equal(page.state.loaded, true);
  assert.equal(doc.getElementById("start").disabled, false);
  assert.equal(doc.getElementById("save").disabled, false);
  assert.equal(doc.getElementById("stop").disabled, true, "没在跑的时候停止不可点");
  assert.equal(doc.getElementById("baseUrl").value, "https://relay.example.com");
  assert.match(doc.getElementById("keyState").textContent, /sk-a…9f2a/);
});

test("启动后轮询到完成，结论与三组探针都画出来", async () => {
  const doc = fakeDocument();
  const timers = fakeTimers();
  let statusCalls = 0;
  const bridge = fakeBridge({
    "relay:view": { config, state: { status: "idle" } },
    "relay:save": { config, state: { status: "idle" } },
    "relay:start": { status: "running" },
    "relay:status": () => {
      statusCalls += 1;
      if (statusCalls < 2) return { status: "running" };
      return { status: "done", report: doneReport };
    },
  });
  const page = createRelayPage({ magpie: bridge, doc, timers });
  await page.mount();

  doc.getElementById("start").click();
  await new Promise((resolve) => setImmediate(resolve));
  // 第一次 status 说 running：排了一次轮询，停止按钮此时可点
  assert.equal(page.state.status, "running");
  assert.equal(doc.getElementById("stop").disabled, false);

  await timers.runAll();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(page.state.status, "done");
  assert.equal(doc.getElementById("start").disabled, false, "完成后能再点开始");
  assert.match(doc.getElementById("verdict").textContent, /未发现伪造证据/);
  assert.equal(doc.getElementById("probes").children.length, 3);
  assert.deepEqual(
    bridge.calls.map((call) => call.name).filter((name) => name.startsWith("relay:")),
    ["relay:view", "relay:start", "relay:status", "relay:status"],
  );
});

test("停止之后迟到的状态不会把界面改回运行中", async () => {
  const doc = fakeDocument();
  const timers = fakeTimers();
  let releaseLate;
  const late = new Promise((resolve) => { releaseLate = resolve; });
  let statusCalls = 0;
  const bridge = fakeBridge({
    "relay:view": { config, state: { status: "idle" } },
    "relay:start": { status: "running" },
    "relay:stop": { status: "stopped" },
    "relay:status": async () => {
      statusCalls += 1;
      if (statusCalls === 1) return { status: "running" };     // 正常的一轮
      await late;                                              // 迟到的那一轮
      return { status: "running", report: null };
    },
  });
  const page = createRelayPage({ magpie: bridge, doc, timers });
  await page.mount();

  doc.getElementById("start").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.state.status, "running");

  // 用户点停止
  await page.stop();
  assert.equal(page.state.status, "stopped");
  assert.equal(doc.getElementById("notice").textContent, "已停止。");

  // 迟到的那次 status 现在才回来：必须被丢掉
  releaseLate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.state.status, "stopped", "迟到的 running 不该回弹");
  assert.equal(doc.getElementById("start").disabled, false);
  assert.equal(doc.getElementById("stop").disabled, true);
  assert.equal(timers.size, 0, "停止后不该再排轮询");
});

test("读不到配置时按钮保持禁用，并把原因说出来", async () => {
  const doc = fakeDocument();
  const timers = fakeTimers();
  const bridge = fakeBridge({
    "relay:view": () => { throw new Error("no such call"); },
  });
  const page = createRelayPage({ magpie: bridge, doc, timers });
  await page.mount();
  assert.equal(page.state.loaded, false);
  assert.equal(doc.getElementById("start").disabled, true);
  assert.match(doc.getElementById("notice").textContent, /读不到配置/);
});

test("保存时把表单值原样交给 magpie，并在成功后清空 Key 输入框", async () => {
  const doc = fakeDocument();
  const timers = fakeTimers();
  const bridge = fakeBridge({
    "relay:view": { config, state: { status: "idle" } },
    "relay:save": (params) => ({ config: { ...config, hasKey: true }, state: { status: "idle" }, echo: params.baseUrl }),
  });
  const page = createRelayPage({ magpie: bridge, doc, timers });
  await page.mount();
  doc.getElementById("apiKey").value = "sk-live-1234567890";
  doc.getElementById("baseUrl").value = "https://relay.example.com";
  doc.getElementById("save").click();
  await new Promise((resolve) => setImmediate(resolve));

  const saveCall = bridge.calls.find((call) => call.name === "relay:save");
  assert.ok(saveCall, "没有调用 relay:save");
  assert.equal(saveCall.params.apiKey, "sk-live-1234567890");
  assert.equal(doc.getElementById("apiKey").value, "", "存过之后 Key 不该留在输入框");
  assert.equal(doc.getElementById("notice").textContent, "已保存。");
});
