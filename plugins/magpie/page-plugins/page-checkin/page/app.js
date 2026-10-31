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
  // 厂商分组默认收起：账号多的时候一进来就是好几屏，先看总数、点开再看细节。
  // 包选项 collapsed: false 仍然让全部分组展开。
  const state = {data: null, busy: false, refreshing: false, open: new Set(), seeded: false, look: null};

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
  // 深色界面优先试 <provider id>-dark.*：品牌标志在深色底上常常反色（白底方块
  // 贴在深色卡片上很刺眼），有深色版就用，没有就退回同一张。
  const PALETTE = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#6366f1"];
  function paletteColor(id) {
    let hash = 0;
    for (const ch of String(id)) hash = (hash * 31 + ch.codePointAt(0)) % 100000;
    return PALETTE[hash % PALETTE.length];
  }
  const prefersDark = () => !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  // 各厂商原图的留白不一样（讯飞的 X 只占画面一半，Kiro 那种本来就撑满），同一个
  // 22px 格子里会有的撑满、有的缩成指甲盖。按原素材的实际墨迹估一组缩放系数，让
  // 它们在格子里看起来一样大；素材本身一张没改。
  const LOGO_SCALE = {
    raccoon: 1.05, autoclaw: 1, autoclaw_cn: 1, cline: 1.15, codearts: 1.05, kiro: 1, "kiro-color": 1,
    loomy: 1.25, "loomy-plugin": 1.25, minimax: 1, "minimax-code": 1,
    "zen-free": 1.15, opencode: 1.15, qoder: 1.05, trae: 1, "trae-cn": 1,
    workbuddy: 1.05, mimo: 1.2, mimocode: 1.2, zcode: 1,
  };
  const logoScale = id => LOGO_SCALE[String(id)] ?? 1;
  function logoSources(id) {
    const bases = prefersDark() ? [`${id}-dark`, String(id)] : [String(id)];
    const list = [];
    for (const base of bases) for (const ext of ["svg", "png", "webp"]) list.push(`${base}.${ext}`);
    return list;
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
    const sources = logoSources(id);
    let next = 0;
    const tryNext = () => {
      if (next >= sources.length) { fallback(); return; }
      img.src = `logos/${encodeURIComponent(sources[next++])}`;
    };
    img.addEventListener("load", () => {
      box.textContent = "";
      box.style.background = "none";
      img.style.transform = `scale(${logoScale(id)})`;
      box.append(img);
    });
    img.addEventListener("error", tryNext);
    tryNext();
    return box;
  }

  // 预装插件美化：素材编在 magpie 的 exe 里，这一行只翻宿主的开关（品牌图标
  // 目录上的一个标记），所以用户更新社区插件、甚至卸了重装都不会把这层弄丢。
  // 宿主太旧、没有 brand:status 这条调用时整块不出现——老 magpie 上没有这层，
  // 摆一个点不动的开关只会让人以为坏了。
  async function loadLook() {
    try { state.look = await act("brand:status", {}); } catch { state.look = null; }
  }

  function paintLook() {
    const box = $("look");
    const on = !!(state.look && state.look.on);
    box.hidden = !state.look;
    if (!state.look) return;
    $("lookSeg").replaceChildren(switchFor(on, async (next) => {
      try { state.look = await act("brand:set", {on: next}); } catch (error) { failure(error); }
      paint();
    }));
  }

  function paint() {
    const t = V.text(lang);
    document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = t[e.dataset.t]; });
    const data = state.data;
    const groups = V.vendorGroups(data || {}, lang);
    const totals = V.totals(groups);
    if (!state.seeded && groups.length) { for (const id of V.openIds(groups, opts)) state.open.add(id); state.seeded = true; }
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
    paintLook();

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
  await loadLook();
  await load();
})();