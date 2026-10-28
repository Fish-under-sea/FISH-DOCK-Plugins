// 页面：读 checkin:state 画分组，写动作落到宿主同一套设置（plugin-checkin /
// checkin-account / plugin-checkin 执行端点），因此和设置页的「每日自动签到」
// 是同一个真相，任一侧改动另一侧刷新后一致。
(async () => {
  const V = globalThis.CheckinView;
  const $ = (id) => document.getElementById(id);
  const theme = await magpie.ready;
  let lang = theme.lang;
  let opts = {};
  try { opts = (await magpie.options.get()) || {}; } catch {}
  const state = {collapsed: opts.collapsed !== false, data: null, busy: false, refreshing: false, open: new Set(), seeded: false};

  // 宿主还没有 checkin:state 时，读会被拒绝；此时按版本不足提示，不显示空白。
  async function read() {
    try {
      return await magpie.read("checkin:state", {});
    } catch (error) {
      const notice = $("notice");
      notice.hidden = false;
      notice.textContent = V.text(lang).needsHost;
      throw error;
    }
  }

  // 写动作优先走宿主的调用桥。0.1.1709 的页面桥只有 read，没有 act：magpie.call
  // 是新加的通用通道（按 package.json 的 magpie.calls 白名单分派）；再退回旧
  // 桥 magpie.act，最后退回宿主自己的设置端点。三层都留着，宿主旧时行为不变。
  async function act(action, params) {
    if (typeof magpie.call === "function") return magpie.call(action, params);
    if (typeof magpie.act === "function") return magpie.act(action, params);
    const paths = {
      "checkin:set-provider": "/api/settings/plugin-checkin",
      "checkin:set-account": "/api/settings/checkin-account",
      "checkin:run": "/api/usage/plugin-checkin",
      "checkin:refresh": "/api/usage/quotas/refresh",
    };
    const path = paths[action];
    if (!path) throw new Error(`no such action: ${action}`);
    const response = await fetch(path, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(params || {}),
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json().catch(() => null);
  }

  function failure(error) {
    $("error").hidden = false;
    $("error").textContent = `${V.text(lang).failed}: ${error.message}`;
  }

  function row(tag, cls, textNode) {
    const node = document.createElement(tag);
    node.className = cls;
    if (textNode != null) node.textContent = textNode;
    return node;
  }

  function switchFor(on, onChange) {
    const t = V.text(lang);
    const box = row("div", "seg");
    for (const [value, label] of [[false, t.switchOff], [true, t.switchOn]]) {
      const button = row("button", value === on ? "sel" : "", label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(value === on));
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (value === on) return;
        try { await onChange(value); } catch (error) { failure(error); }
      });
      box.append(button);
    }
    return box;
  }

  // 厂商标记：约定 page/logos/<provider id>.{svg,png,webp} 放官方标志，按顺序
  // 试，加载成功就用图；一份都没有时退回按 id 取色的首字母块。素材与代码解耦。
  const PALETTE = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#6366f1"];
  function paletteColor(id) {
    let hash = 0;
    for (const ch of String(id)) hash = (hash * 31 + ch.codePointAt(0)) % 100000;
    return PALETTE[hash % PALETTE.length];
  }
  function logo(id, name) {
    const box = row("span", "vlogo");
    const initial = String(name || id).trim().charAt(0).toUpperCase();
    const fallback = () => {
      box.textContent = initial;
      box.style.background = paletteColor(id);
    };
    box.setAttribute("aria-hidden", "true");
    box.textContent = initial;
    box.style.background = paletteColor(id);
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    const exts = ["svg", "png", "webp"];
    let next = 0;
    const tryNext = () => {
      if (next >= exts.length) { fallback(); return; }
      img.src = `logos/${encodeURIComponent(String(id))}.${exts[next++]}`;
    };
    img.addEventListener("load", () => {
      box.textContent = "";
      box.style.background = "none";
      box.append(img);
    });
    img.addEventListener("error", tryNext);
    tryNext();
    return box;
  }

  function paint() {
    const t = V.text(lang);
    document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = t[e.dataset.t]; });
    const data = state.data;
    const groups = V.vendorGroups(data || {}, lang);
    const totals = V.totals(groups);
    if (!state.seeded && groups.length) { for (const group of groups) state.open.add(group.id); state.seeded = true; }
    $("total").textContent = groups.length
      ? `${t.total.replace("{done}", totals.done).replace("{all}", totals.all)} · ${totals.credit} ${t.points}`
      : "";
    $("empty").hidden = groups.length > 0;
    $("run").disabled = state.busy || !groups.length;
    $("run").textContent = state.busy ? t.running : t.run;
    $("refresh").disabled = state.refreshing || !groups.length;
    $("refresh").textContent = state.refreshing ? t.refreshing : t.refresh;
    $("refresh").classList.toggle("busy", state.refreshing);
    $("refresh").setAttribute("aria-busy", String(state.refreshing));

    const cards = groups.map((group) => {
      const open = state.open.has(group.id);
      const card = row("section", "vendor");
      const head = row("div", "vhead");
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      head.setAttribute("aria-expanded", String(open));
      head.setAttribute("aria-label", `${group.name} · ${open ? t.collapse : t.expand}`);
      head.append(logo(group.id, group.name));
      head.append(row("span", "vcaret", open ? "▾" : "▸"));
      head.append(row("div", "vname", group.name));
      head.append(row("div", "vmeta", `${t.accounts.replace("{n}", group.total)} · ${group.done}/${group.total} · ${group.credit} ${t.credits}`));
      head.append(switchFor(group.on, async (on) => {
        await act("checkin:set-provider", {provider: group.id, on});
        await load();
      }));
      card.append(head);

      const body = row("div", "list");
      body.hidden = !open;
      for (const account of group.accounts) {
        const line = row("div", "acc");
        const who = row("div", "who");
        who.append(row("div", "user", account.user || account.key));
        who.append(row("div", "sub" + (account.status.bad ? " bad" : ""), account.status.text));
        const tail = row("div", "tail");
        if (account.credit !== null) {
          tail.append(row("span", "credit", `+${account.credit}`));
        } else if (account.estimate !== null) {
          // 厂商没说给了多少：显示按额度面板反推的数，并标明是估的。
          const guess = row("span", "credit est", `≈+${account.estimate}`);
          guess.title = t.estimateHint;
          tail.append(guess);
        }
        // 既没有实得、也反推不出的，不再显示「未告知」：留白即可。
        tail.append(switchFor(account.on, async (on) => {
          await act("checkin:set-account", {key: account.key, on});
          await load();
        }));
        line.append(who, tail);
        body.append(line);
      }
      card.append(body);
      const flip = () => {
        if (state.open.has(group.id)) state.open.delete(group.id); else state.open.add(group.id);
        paint();
      };
      head.addEventListener("click", (event) => { if (event.target.closest(".seg")) return; flip(); });
      head.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); flip(); }
      });
      return card;
    });
    $("vendors").replaceChildren(...cards);
  }

  async function load() {
    try {
      state.data = await read();
      $("error").hidden = true;
      paint();
    } catch (error) {
      failure(error);
    }
  }

  $("run").addEventListener("click", async () => {
    if (state.busy) return;
    state.busy = true;
    paint();
    try {
      await act("checkin:run", {});
      await load();
    } catch (error) { failure(error); }
    state.busy = false;
    paint();
  });
  $("refresh").addEventListener("click", async () => {
    if (state.refreshing) return;
    state.refreshing = true;
    paint();
    // 命缓存时这条请求一两百毫秒就回来了，转圈一闪而过看着像没反应；
    // 补到 600ms 再收起，超过它就是真的在等。
    const started = Date.now();
    try { await act("checkin:refresh", {}); } catch (error) { failure(error); }
    const waited = Date.now() - started;
    if (waited < 600) await new Promise((done) => setTimeout(done, 600 - waited));
    state.refreshing = false;
    await load();
  });

  magpie.onTheme((next) => { lang = next.lang; paint(); });
  setInterval(load, 60_000);
  await load();
})();