// relay.js：把子帧的 magpie 消息转发给上一层窗口，再把回程的应答送回子帧。
//
// bridge.js 在子帧里连的是 `parent`——也就是本页，不是 magpie 的窗口。这层转发
// 补的就是这一段：
//
//   子帧 {magpie:1, id, method, params}
//     → 本页换一个自己的 id，转发给 magpie 的窗口
//   窗口 {magpie:1, id, result|error}
//     → 本页换回子帧原来的 id，postMessage 给它
//   窗口 {magpie:1, event}（theme / visibility / action）
//     → 广播给每个子帧
//
// 两条纪律：
//   1. 只转以「父窗口」为源的事件——别的窗口发来的一概不碰；
//   2. 转发用的 id 从 base 起编，跟本页自己那份 bridge 的 id 分开，回程才不会
//      串到别人身上。
//
// 帧的 window 用函数取（createRelay({frames: [() => iframe.contentWindow]})）：
// 帧可能还没建、也可能被窗口回收后重建，拿到的是当时的那个。

const MAGPIE = 1;

export function createRelay({ frames = [], parent = null, post = defaultPost, base = 1_000_000 } = {}) {
  const links = new Map(); // 本页的转发 id → {frame, id}
  let next = base;

  // 现在能用的帧窗口：每次现取，帧被重建也跟得上。
  function windows() {
    const out = [];
    for (const frame of frames) {
      let w = null;
      try {
        w = typeof frame === "function" ? frame() : frame?.contentWindow || frame;
      } catch {
        w = null;
      }
      if (w) out.push(w);
    }
    return out;
  }

  function frameSource(source) {
    if (!source) return null;
    for (const w of windows()) if (w === source) return w;
    return null;
  }

  // 子帧 → 本页 → 窗口。error / size 不带 id：error 原样上抛（窗口据此说「页面
  // 出错了」），size 是面板的活，页面这一层不上报。
  function forward(frame, message) {
    const method = String(message.method || "");
    if (method === "error") {
      post(parent, { magpie: MAGPIE, method: "error", params: message.params || {} });
      return;
    }
    if (method === "size") return;
    const id = next++;
    links.set(id, { frame, id: message.id });
    post(parent, { magpie: MAGPIE, id, method, params: message.params || {} });
  }

  function receive(event) {
    const data = event?.data;
    if (!data || typeof data !== "object" || data.magpie !== MAGPIE) {
      // 不是 magpie 的消息：源是谁都不归这层管。
      return false;
    }
    const frame = frameSource(event.source);
    if (frame) {
      if (typeof data.method !== "string") return false;
      forward(frame, data);
      return true;
    }
    // 回程：只认来自父窗口的那一路
    if (!parent || event.source !== parent) return false;
    if (data.event) {
      for (const w of windows()) post(w, data);
      return true;
    }
    const link = links.get(data.id);
    if (!link) return false;
    links.delete(data.id);
    const reply = { magpie: MAGPIE, id: link.id };
    if (data.error !== undefined) reply.error = data.error;
    else reply.result = data.result;
    post(link.frame, reply);
    return true;
  }

  return { receive, pending: () => links.size };
}

function defaultPost(target, message) {
  try {
    target?.postMessage?.(message, "*");
  } catch {
    /* 帧已经不在了：丢掉这条，下一次轮询/刷新会再来 */
  }
}