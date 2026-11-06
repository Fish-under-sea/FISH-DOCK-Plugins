import test from "node:test";
import assert from "node:assert/strict";

import { createRelay } from "../page/relay.js";

// 两个子帧 + 一个「magpie 的窗口」，都是纯对象：这层逻辑只认 postMessage 的
// 源与消息形状，不碰 DOM。
function harness() {
  const posted = [];
  const checkin = { name: "checkin-frame" };
  const relay = { name: "relay-frame" };
  const parent = { name: "window" };
  const bridge = createRelay({
    frames: [() => checkin, () => relay],
    parent,
    post: (target, message) => posted.push({ target, message }),
  });
  return { posted, checkin, relay, parent, bridge };
}

test("子帧的一次调用换成新 id 转发给窗口，方法与原参数不变", () => {
  const { posted, checkin, parent, bridge } = harness();

  assert.equal(bridge.receive({ source: checkin, data: { magpie: 1, id: 3, method: "call", params: { name: "relay:view" } } }), true);

  assert.equal(posted.length, 1);
  const { target, message } = posted[0];
  assert.equal(target, parent);
  assert.equal(message.magpie, 1);
  assert.equal(message.method, "call");
  assert.deepEqual(message.params, { name: "relay:view" });
  assert.ok(message.id >= 1_000_000, "转发 id 从 base 起编，跟本页 bridge 的 id 分开");
  assert.equal(bridge.pending(), 1);
});

test("回程按原 id 送回子帧，结果落给发起的那一个", () => {
  const { posted, checkin, parent, bridge } = harness();
  bridge.receive({ source: checkin, data: { magpie: 1, id: 7, method: "read", params: { name: "checkin:state" } } });
  const sent = posted.at(-1).message;

  assert.equal(bridge.receive({ source: parent, data: { magpie: 1, id: sent.id, result: { ok: true } } }), true);

  const back = posted.at(-1);
  assert.equal(back.target, checkin);
  assert.deepEqual(back.message, { magpie: 1, id: 7, result: { ok: true } });
  assert.equal(bridge.pending(), 0);
});

test("失败的应答把 error 送回去，而不是 result", () => {
  const { posted, checkin, parent, bridge } = harness();
  bridge.receive({ source: checkin, data: { magpie: 1, id: 1, method: "call", params: { name: "relay:start" } } });
  const sent = posted.at(-1).message;

  bridge.receive({ source: parent, data: { magpie: 1, id: sent.id, error: "没有这个动作" } });

  const back = posted.at(-1).message;
  assert.equal(back.id, 1);
  assert.equal(back.error, "没有这个动作");
  assert.equal("result" in back, false);
});

test("主题与可见性事件广播给每个子帧", () => {
  const { posted, checkin, relay, parent, bridge } = harness();

  assert.equal(bridge.receive({ source: parent, data: { magpie: 1, event: "theme", data: { dark: true } } }), true);

  assert.deepEqual(posted.map((x) => x.target), [checkin, relay]);
  for (const { message } of posted) assert.equal(message.event, "theme");
});

test("面板的 size 不往上报：页面这一层不靠它排版", () => {
  const { posted, checkin, bridge } = harness();

  assert.equal(bridge.receive({ source: checkin, data: { magpie: 1, method: "size", params: { height: 900 } } }), true);

  assert.equal(posted.length, 0);
});

test("子帧的页面错误原样报给窗口，好让窗口说「这个页面出错了」", () => {
  const { posted, checkin, parent, bridge } = harness();

  bridge.receive({ source: checkin, data: { magpie: 1, method: "error", params: { message: "Script error." } } });

  assert.deepEqual(posted[0], {
    target: parent,
    message: { magpie: 1, method: "error", params: { message: "Script error." } },
  });
});

test("别的窗口、别的形状的消息一概不碰", () => {
  const { posted, bridge } = harness();

  assert.equal(bridge.receive({ source: { name: "stranger" }, data: { magpie: 1, id: 1, method: "call" } }), false);
  assert.equal(bridge.receive({ source: { name: "window" }, data: { hello: "world" } }), false);
  assert.equal(bridge.receive({ source: null, data: { magpie: 1, id: 1, method: "call" } }), false);

  assert.equal(posted.length, 0);
});

test("没有父窗口（单独打开页面）时，子帧的请求丢掉而不炸", () => {
  const posted = [];
  const frame = { name: "frame" };
  const bridge = createRelay({ frames: [() => frame], parent: null, post: (target, message) => posted.push({ target, message }) });

  bridge.receive({ source: frame, data: { magpie: 1, id: 2, method: "call", params: {} } });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].target, null);
});