// 一个插件、两个页面：页内用标签切换，两页各自在自己的帧里跑，代码与图标
// 原样不动。
//
// 为什么是帧：两页的页面脚本都按「整个文档就是我」写的（document.getElementById、
// 全局 id、各自的样式表），塞进同一个文档必然互相踩 id 与样式。帧把两边都隔开，
// 代价是帧里的 bridge.js 连的是「父窗口」，而不是 magpie 的窗口——所以这里做一层
// 转发：帧 → 本页 → magpie 的窗口，回程原路返回。转发规则单独放在 relay.js，
// 纯逻辑、可单测（test/relay.test.mjs）。
import { createRelay } from "./relay.js";

const TABS = ["checkin", "relay"];
const SRC = { relay: "relay/index.html" };

const tabOf = (name) => document.getElementById(`tab-${name}`);
const paneOf = (name) => document.getElementById(`pane-${name}`);

// 第二页第一次被打开时才建 src：签到页要读状态、探针页会轮询，谁没被看就不跑。
function load(name) {
  const pane = paneOf(name);
  const src = pane?.getAttribute("src") || "";
  if (!src && SRC[name]) pane.setAttribute("src", SRC[name]);
}

function show(name) {
  for (const each of TABS) {
    const tab = tabOf(each);
    const pane = paneOf(each);
    const on = each === name;
    if (tab) {
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    if (pane) pane.hidden = !on;
  }
  load(name);
  try {
    history.replaceState(null, "", `#${name}`);
  } catch {
    /* 沙箱里改不了地址栏也无所谓：切换已经发生了 */
  }
}

function wire() {
  for (const name of TABS) {
    const tab = tabOf(name);
    if (!tab) continue;
    tab.addEventListener("click", () => show(name));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const at = TABS.indexOf(name);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = TABS[(at + step + TABS.length) % TABS.length];
      show(next);
      tabOf(next)?.focus();
    });
  }
  // 从地址栏带 #relay 进来（页面自己重载、或用户记住的锚点）：直接开那一页。
  const hash = String(location.hash || "").replace(/^#/, "");
  if (TABS.includes(hash) && hash !== "checkin") show(hash);
}

const relay = createRelay({
  frames: TABS.map((name) => () => paneOf(name)?.contentWindow || null),
  parent: globalThis.parent,
  post: (target, message) => target?.postMessage(message, "*"),
});

addEventListener("message", (event) => relay.receive(event));

if (document.readyState === "loading") addEventListener("DOMContentLoaded", wire);
else wire();