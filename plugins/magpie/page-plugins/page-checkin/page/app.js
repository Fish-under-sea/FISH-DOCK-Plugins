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
  const state = {collapsed: opts.collapsed !== false, data: null, busy: false};

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

  // 写动作优先走宿主声明的 checkin:*；老宿主没有 magpie.act 时退回它自己的
  // 设置端点（同源、同一份 settings），行为一致。
  async function act(action, params) {
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

  function toggle(collapsed) {
    opts = {...opts, collapsed};
    state.collapsed = collapsed;
    clearTimeout(saving);
    saving = setTimeout(() => {magpie.options.set({...opts, collapsed}).catch(() => {})}, 900);
  }
  let saving = null;

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

  function paint() {
    const t = V.text(lang);
    document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = t[e.dataset.t]; });
    const data = state.data;
    const groups = V.vendorGroups(data || {}, lang);
    const totals = V.totals(groups);
    $("total").textContent = groups.length
      ? `${t.total.replace("{done}", totals.done).replace("{all}", totals.all)} · ${totals.credit} ${t.points}`
      : "";
    $("empty").hidden = groups.length > 0;
    $("run").disabled = state.busy || !groups.length;
    $("run").textContent = state.busy ? t.running : t.run;

    const cards = groups.map((group) => {
      const card = row("section", "vendor");
      const head = row("div", "vhead");
      head.append(row("div", "vname", group.name));
      head.append(row("div", "vmeta", `${t.accounts.replace("{n}", group.total)} · ${group.done}/${group.total} · ${group.credit} ${t.credits}`));
      head.append(switchFor(group.on, async (on) => {
        await act("checkin:set-provider", {provider: group.id, on});
        await load();
      }));
      card.append(head);

      const body = row("div", "list");
      body.hidden = state.collapsed;
      for (const account of group.accounts) {
        const line = row("div", "acc");
        const who = row("div", "who");
        who.append(row("div", "user", account.user || account.key));
        who.append(row("div", "sub" + (account.status.bad ? " bad" : ""), account.status.text));
        const tail = row("div", "tail");
        if (account.credit) tail.append(row("span", "credit", `+${account.credit}`));
        tail.append(switchFor(account.on, async (on) => {
          await act("checkin:set-account", {key: account.key, on});
          await load();
        }));
        line.append(who, tail);
        body.append(line);
      }
      card.append(body);
      head.style.cursor = "pointer";
      head.addEventListener("click", () => toggle(!state.collapsed));
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
    try { await act("checkin:refresh", {}); } catch (error) { failure(error); }
    await load();
  });

  magpie.onTheme((next) => { lang = next.lang; paint(); });
  setInterval(load, 60_000);
  await load();
})();