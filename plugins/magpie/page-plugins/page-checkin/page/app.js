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
  const state = {data: null, busy: false, refreshing: false, open: new Set(), seeded: false, look: null, lookError: null};

  const delay = (ms) => new Promise((done) => setTimeout(done, ms));

  // 宿主分三态：
  //  - NEED_HOST：根本没有 magpie.read，这个页面用不了（真·版本太低）；
  //  - HOST_BUSY：有 magpie 对象但读取抛错，多为服务正在启动，重试就会好；
  //  - 正常：读到数据。
  // 别再一律说成「需要 magpie 1.1 或更新版本」——那是把启动拥堵误导成版本问题。
  function needHost() {
    return typeof magpie === "undefined" || !magpie || typeof magpie.read !== "function";
  }
  function tagKind(error, kind) {
    if (error && typeof error === "object") { try { error.checkinKind = kind; } catch {} }
    return error;
  }

  async function read() {
    try {
      return await magpie.read("checkin:state", {});
    } catch (error) {
      const t = V.text(lang);
      const notice = $("notice");
      notice.hidden = false;
      if (needHost()) { notice.textContent = t.needsHost; throw tagKind(error, "NEED_HOST"); }
      notice.textContent = t.hostBusy;
      throw tagKind(error, "HOST_BUSY");
    }
  }

  // 写动作只走宿主的调用桥：magpie.call 是新加的通用通道（按 package.json 的
  // magpie.calls 白名单分派）；再退回旧桥 magpie.act。旧的 fetch 回退在 CSP
  // connect-src 'none' 下永远不可达，报错还会误导成网络错误，已删除——两个桥
  // 都没有就是宿主版本过低，直接按 NEED_HOST 报，不假装会发一次注定失败的请求。
  async function act(action, params) {
    if (typeof magpie.call === "function") return magpie.call(action, params);
    if (typeof magpie.act === "function") return magpie.act(action, params);
    const error = new Error(V.text(lang).needsHost);
    throw tagKind(error, "NEED_HOST");
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
  // 读失败不再一次就永久隐藏：HOST_BUSY 时保留「正在读取」，随 60s 轮询重试，
  // 服务起来后这行自己出来；只有根本没有页面桥（NEED_HOST）时才整行不显示。
  function lookUnsupported(error) {
    if (needHost()) return true;
    // act() 在两条调用桥都缺失时已按 NEED_HOST 标记：宿主版本过低，这行整块不出现。
    if (error && error.checkinKind === "NEED_HOST") return true;
    const msg = String((error && error.message) || "");
    return /no such action|unknown action|not supported|does not support|没有.*(动作|接口)/i.test(msg);
  }
  async function loadLook() {
    try {
      state.look = await act("brand:status", {});
      state.lookError = null;
    } catch (error) {
      state.lookError = lookUnsupported(error) ? tagKind(error, "NEED_HOST") : tagKind(error, "HOST_BUSY");
    }
    paintLook();
  }

  function paintLook() {
    const box = $("look");
    const t = V.text(lang);
    const look = state.look;
    const err = state.lookError;
    // 还没读、也没结果更没出错：首帧尚未回来，保持隐藏。
    if (!look && !err) { box.hidden = true; return; }
    // 宿主没有这条调用（真·老 magpie）：整行不出现。
    if (!look && err && err.checkinKind === "NEED_HOST") { box.hidden = true; return; }
    box.hidden = false;
    const note = $("lookNote");
    const seg = $("lookSeg");
    if (look) {
      const pending = Number(look.pendingPlugins);
      if (Number.isFinite(pending) && pending > 0) {
        // #16：首次安装那段时间把「正在准备 N 个供应商插件」显出来，装完 pending 归零就消失。
        note.textContent = t.pendingPlugins.replace("{n}", pending);
        note.classList.add("pending");
      } else {
        note.textContent = t.lookNote;
        note.classList.remove("pending");
      }
      seg.hidden = false;
      seg.replaceChildren(switchFor(!!look.on, async (next) => {
        try { state.look = await act("brand:set", {on: next}); } catch (error) { failure(error); }
        paint();
      }));
    } else {
      // HOST_BUSY：保留「正在读取」，下一次轮询再读。
      note.textContent = t.lookReading;
      note.classList.remove("pending");
      seg.hidden = true;
      seg.replaceChildren();
    }
  }

  function paint() {
    const t = V.text(lang);
    document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = t[e.dataset.t]; });
    const data = state.data;
    const groups = V.vendorGroups(data || {}, lang);
    const totals = V.totals(groups);
    if (!state.seeded && groups.length) { for (const id of V.openIds(groups, opts)) state.open.add(id); state.seeded = true; }
    $("total").textContent = groups.length
      ? `${t.total.replace("{done}", totals.done).replace("{all}", totals.all)} · ${V.creditNote(totals.credit, totals.unknown, lang, t.points)}`
      : "";
    // #15：宿主给了 refreshedAt 才显示「数据截至 HH:MM · 台账」；老 exe 没这字段就整行不出现。
    const fresh = V.freshness(data || {}, lang);
    const freshEl = $("freshness");
    if (fresh) { freshEl.hidden = false; freshEl.textContent = fresh; }
    else { freshEl.hidden = true; freshEl.textContent = ""; }
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
      head.append(row("div", "vmeta", `${t.accounts.replace("{n}", group.total)} · ${group.done}/${group.total} · ${V.creditNote(group.credit, group.unknown, lang, t.credits)}`));
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
        } else if (account.status.key === "claimed" || account.status.key === "done") {
          // 厂商说签到了却没报数额：明说「未告知」，不再补固定值，也不留空。
          tail.append(row("span", "credit unknown", t.unknown));
        }
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

  // 1/2/4 s 退避：只对 HOST_BUSY 重试，NEED_HOST 立即停手。retries=0 用于 60s 轮询。
  const RETRY_DELAYS = [1000, 2000, 4000];
  async function load(retries = 0) {
    for (let attempt = 0; ; attempt++) {
      try {
        state.data = await read();
        $("error").hidden = true;
        $("notice").hidden = true;
        paint();
        return;
      } catch (error) {
        if (error.checkinKind === "HOST_BUSY" && attempt < retries) {
          await delay(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
          continue;
        }
        failure(error);
        return;
      }
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
  // loadLook 不再只跑一次：并进 60s 轮询，读取失败（HOST_BUSY）也会自己回来。
  setInterval(() => { loadLook(); load(0); }, 60_000);
  await loadLook();
  await load(3);
})();
