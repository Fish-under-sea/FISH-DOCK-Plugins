// 中转站探针的页面状态机。页面跑在 magpie 沙箱帧里（CSP connect-src
// 'none'），所以这里一句 fetch 都没有：所有动作都经 magpie.call 交给 magpie
// 本体执行，页面只负责表单、轮询与呈现。
//
// 三条规矩写在代码里：
//   1. 配置读回之前，按钮一律 disabled——用户不该对着一个还不知道存了什么
//      的表单点"开始"。
//   2. 一轮探测只在 status 离开 running 时结束；轮询有代（generation）号，
//      停止之后迟到的那次响应不许把界面改回"运行中"。

const POLL_MS = 1500;

const PROBE_LABELS = { B1: "签名重放（B1）", C1: "计数对账（C1）", C2: "跨代 tokenizer（C2）" };

export function createRelayPage({ magpie, doc, timers, pollMs = POLL_MS }) {
  const el = (id) => doc.getElementById(id);
  const clock = timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };

  const state = {
    loaded: false,     // 配置读回来了吗
    running: false,    // 这一轮探测还在跑
    status: "idle",    // idle / running / done / error / stopped
    generation: 0,     // 每开始/停止一轮 +1，用来丢弃迟到的响应
    report: null,
    error: "",
    timer: null,
    hasKey: false,
  };

  function notice(text) {
    const node = el("notice");
    if (node) node.textContent = text || "";
  }

  function setBusy(busy) {
    state.running = busy;
    const start = el("start");
    const stop = el("stop");
    const save = el("save");
    // 读回之前 disabled；跑起来之后 save/start 也 disabled（改地址会让这一轮
    // 的结果对不上），stop 反过来只在跑的时候可点。
    if (start) start.disabled = !state.loaded || busy;
    if (save) save.disabled = !state.loaded || busy;
    if (stop) stop.disabled = !state.loaded || !busy;
  }

  function fill(config) {
    if (!config) return;
    const fields = {
      baseUrl: config.baseUrlRaw || config.baseUrl || "",
      model: config.model || "",
      comparisonModel: config.comparisonModel || "",
      authMode: config.authMode || "auto",
      apiVersion: config.apiVersion || "",
      timeoutMs: config.timeoutMs ?? "",
    };
    for (const [id, value] of Object.entries(fields)) {
      const node = el(id);
      if (node) node.value = String(value);
    }
    state.hasKey = Boolean(config.hasKey);
    const keyNode = el("keyState");
    if (keyNode) {
      keyNode.textContent = config.hasKey
        ? `已保存 Key：${config.keyHint || "••••"}（留空则沿用）`
        : "还没有保存 Key";
    }
  }

  function readForm() {
    const value = (id) => {
      const node = el(id);
      return node ? String(node.value ?? "").trim() : "";
    };
    const timeoutText = value("timeoutMs");
    return {
      baseUrl: value("baseUrl"),
      apiKey: value("apiKey"),
      model: value("model"),
      comparisonModel: value("comparisonModel"),
      authMode: value("authMode"),
      apiVersion: value("apiVersion"),
      timeoutMs: timeoutText ? Number(timeoutText) : 0,
    };
  }

  function paintReport(report) {
    const verdictNode = el("verdict");
    const signalsNode = el("signals");
    const caveatNode = el("caveat");
    const probesNode = el("probes");
    if (!report) {
      if (verdictNode) verdictNode.textContent = "还没有探测结果。";
      if (signalsNode) signalsNode.replaceChildren();
      if (probesNode) probesNode.replaceChildren();
      if (caveatNode) caveatNode.textContent = "";
      return;
    }
    const verdict = report.verdict || {};
    if (verdictNode) {
      verdictNode.textContent = `${verdict.label || "证据不足，无法判断"}（伪造分 ${verdict.forgedScore ?? 0} / 原生分 ${verdict.nativeScore ?? 0}）`;
      verdictNode.dataset.code = verdict.code || "";
    }
    if (signalsNode) {
      const rows = (verdict.signals || []).map((signal) => {
        const li = doc.createElement("li");
        li.textContent = `[${signal.id}·${signal.kind}] ${signal.detail}`;
        return li;
      });
      signalsNode.replaceChildren(...rows);
    }
    if (caveatNode) caveatNode.textContent = verdict.caveat || "";
    if (probesNode) {
      const rows = ["B1", "C1", "C2"].map((id) => {
        const probe = report[id] || {};
        const tr = doc.createElement("tr");
        const name = doc.createElement("td");
        name.textContent = PROBE_LABELS[id] || id;
        const status = doc.createElement("td");
        status.textContent = probe.status || "skipped";
        const why = doc.createElement("td");
        why.textContent = probe.message || probe.reason || "";
        tr.replaceChildren(name, status, why);
        return tr;
      });
      probesNode.replaceChildren(...rows);
    }
  }

  // load 把存好的配置读回表单。读回来之前按钮是 disabled，所以它失败时也只
  // 是启用不了——不会留下一个"看起来能点"的按钮。
  async function load() {
    try {
      const view = await magpie.call("relay:view", {});
      fill(view?.config);
      state.loaded = true;
      state.status = view?.state?.status || "idle";
      state.report = view?.state?.report || null;
      paintReport(state.report);
      if (state.status === "running") {
        setBusy(true);
        void poll(state.generation);
      } else {
        setBusy(false);
      }
      notice("");
    } catch (error) {
      state.loaded = false;
      setBusy(false);
      notice(`读不到配置：${error?.message || error}`);
    }
    return state;
  }

  async function save() {
    if (!state.loaded) return state;
    try {
      const view = await magpie.call("relay:save", readForm());
      fill(view?.config);
      const key = el("apiKey");
      if (key) key.value = "";   // 存过就不再留在输入框里
      notice("已保存。");
    } catch (error) {
      notice(`保存失败：${error?.message || error}`);
    }
    return state;
  }

  async function start() {
    if (!state.loaded || state.running) return state;
    state.generation += 1;
    const generation = state.generation;
    setBusy(true);
    state.status = "running";
    state.error = "";
    notice("探测中：签名重放、计数对账、跨代对比依次进行，可能需要几十秒。");
    try {
      await magpie.call("relay:start", {});
    } catch (error) {
      if (generation === state.generation) {
        setBusy(false);
        state.status = "error";
        state.error = String(error?.message || error);
        notice(`没能开始：${state.error}`);
        return state;
      }
      return state;
    }
    if (generation === state.generation) void poll(generation);
    return state;
  }

  // poll 一直读到 status 离开 running。代（generation）对不上的一律丢弃：
  // 用户点了停止之后，那次还在路上的响应不许把界面改回"运行中"。
  async function poll(generation) {
    if (generation !== state.generation) return;
    try {
      const snapshot = await magpie.call("relay:status", {});
      if (generation !== state.generation) return;
      const status = snapshot?.status || "idle";
      state.status = status;
      if (status === "running") {
        state.timer = clock.set(() => void poll(generation), pollMs);
        return;
      }
      state.report = snapshot?.report || state.report;
      paintReport(state.report);
      setBusy(false);
      if (status === "done") notice("探测完成。");
      else if (status === "error") notice(`探测失败：${snapshot?.error || "未知原因"}`);
      else if (status === "stopped") notice("已停止。");
      else notice("");
    } catch (error) {
      if (generation !== state.generation) return;
      setBusy(false);
      state.status = "error";
      state.error = String(error?.message || error);
      notice(`读不到状态：${state.error}`);
    }
  }

  async function stop() {
    // 先让这一轮作废，再发停止：迟到的 status 会因为代号对不上被丢掉。
    state.generation += 1;
    if (state.timer !== null) {
      clock.clear(state.timer);
      state.timer = null;
    }
    setBusy(false);
    state.status = "stopped";
    notice("已停止。");
    try {
      await magpie.call("relay:stop", {});
    } catch (error) {
      notice(`停止请求失败：${error?.message || error}`);
    }
    return state;
  }

  function mount() {
    setBusy(false);      // 配置没读回来之前，三个按钮都 disabled
    const on = (id, fn) => {
      const node = el(id);
      if (node) node.addEventListener("click", () => void fn());
    };
    on("save", save);
    on("start", start);
    on("stop", stop);
    return load();
  }

  return { mount, load, save, start, stop, poll, state, fill, paintReport };
}

// 页面里直接用：把窗口给你的 magpie 桥接进来。
export function mountRelayPage(bridge) {
  const page = createRelayPage({ magpie: bridge, doc: document });
  return page.mount().then(() => page);
}

if (typeof window !== "undefined" && window.magpie && typeof document !== "undefined" && document.getElementById("relay")) {
  void mountRelayPage(window.magpie);
}
