// What the check-in page shows, worked out from checkin:state without the DOM,
// so a test can check it. A classic script: it sets globalThis.CheckinView.
(() => {
  const TEXT = {
    en: {
      title: "Check-in", all: "Check every signed-in account in once a day",
      run: "Check in now", running: "Checking in…", refresh: "Re-read credits", refreshing: "Re-reading…",
      expand: "Expand", collapse: "Collapse",
      switchOn: "On", switchOff: "Off",
      vendor: "Vendor", accounts: "{n} accounts", credits: "today",
      claimed: "Checked in today", done: "Checked in today (the vendor had it)",
      ineligible: "Not eligible", inactive: "No check-in event now",
      captcha: "Needs a captcha: check in in its own app",
      pending: "Not checked in yet", off: "Auto check-in is off",
      offAccount: "Left out of the daily check-in", none: "No account signed in yet.",
      failed: "Couldn't read check-ins", needsHost: "This page needs magpie 1.1 or newer.",
      hostBusy: "The service is starting; retrying automatically.",
      collectorNone: "No automatic collection",
      streak: "{n}-day streak", total: "{done} of {all} checked in today", points: "points",
      unknown: "not reported", unknownCount: "{n} not reported", estimateHint: "Estimated from the credits panel",
      dataAsOf: "Data as of {time} · {source}", sourceLedger: "ledger", sourceLive: "live",
      lookTitle: "Preinstalled plugin artwork",
      lookNote: "Their own icons in Plugins, Models and the sidebar — off puts the originals back.",
      lookReading: "Reading…",
      pendingPlugins: "Preparing {n} vendor plugin(s) (first install, about 1 minute)",
    },
    zh: {
      title: "自动签到", all: "每天替每个已登录账号签到一次",
      run: "立即签到", running: "正在签到…", refresh: "重新读取额度", refreshing: "正在读取…",
      expand: "展开", collapse: "收起",
      switchOn: "开", switchOff: "关",
      vendor: "厂商", accounts: "{n} 个账号", credits: "今日",
      claimed: "今日已签到", done: "今日已签到（厂商侧已完成）",
      ineligible: "不符合签到条件", inactive: "当前没有签到活动",
      captcha: "需要验证码，请在厂商 App 内签到",
      pending: "今日尚未签到", off: "自动签到已关闭",
      offAccount: "不参与每日自动签到", none: "还没有登录的账号。",
      failed: "读取签到状态失败", needsHost: "这个页面需要 magpie 1.1 或更新版本。",
      hostBusy: "服务正在启动，稍后自动重试",
      collectorNone: "不支持自动采集",
      streak: "连续 {n} 天", total: "今日已签到 {done} / {all}", points: "积分",
      unknown: "未告知", unknownCount: "{n} 项未告知", estimateHint: "按额度面板反推",
      dataAsOf: "数据截至 {time} · {source}", sourceLedger: "台账", sourceLive: "实时",
      lookTitle: "预装插件美化",
      lookNote: "插件、供应商、侧边栏里的图标都换成这一套；关掉就回到原版。",
      lookReading: "正在读取…",
      pendingPlugins: "正在准备 {n} 个供应商插件（首次安装，约 1 分钟）",
    },
  };
  const OUTCOMES = ["claimed", "done", "ineligible", "inactive", "captcha"];

  function text(lang) {
    return String(lang || "").toLowerCase().startsWith("zh") ? TEXT.zh : TEXT.en;
  }

  // The account's today, from the state the host gives. The credit is whatever
  // the host reports — dailyCredits when the host sends that map (newer host),
  // else the credits map, else the ledger entry's own number. This page never
  // invents a value: when all three are absent the number is genuinely unknown
  // (null) and the page says 未告知 instead of showing a made-up +100 / +400.
  function todayOf(state, key) {
    const entry = (state && state.today && state.today[key]) || null;
    const daily = state && state.dailyCredits;
    const credits = state && state.credits;
    let raw;
    if (daily && Object.prototype.hasOwnProperty.call(daily, key)) raw = daily[key];
    else if (credits && Object.prototype.hasOwnProperty.call(credits, key)) raw = credits[key];
    else if (entry) raw = entry.credit;
    const credit = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const guessed = (state && state.creditEstimate && state.creditEstimate[key]);
    const estimate = typeof guessed === "number" && Number.isFinite(guessed) ? guessed : null;
    return {entry, credit, estimate};
  }

  // accountsOf groups a vendor's accounts: by the account key's own prefix
  // ("<vendor id>|"), else by the by the host reports ("plugin:<id>" or the
  // vendor id itself) for an older host.
  function accountsOf(state, vendor) {
    const all = (state && state.accounts) || [];
    return all.filter((a) => {
      const key = String(a.key || "");
      if (key.startsWith(`${vendor.id}|`)) return true;
      const by = String(a.by || "");
      return by === vendor.id || by === `plugin:${vendor.id}`;
    });
  }

  // status is one account's line: what happened today, in the page's language.
  // A vendor's switch off or an account left out says so before the outcome:
  // what the ledger kept yesterday is not today's answer.
  function status(account, vendor, state, lang) {
    const t = text(lang);
    const {entry, credit, estimate} = todayOf(state, account.key);
    if (!vendor.on) return {key: "off", text: t.off, bad: false, credit: null, estimate: null};
    if (!account.on) return {key: "offAccount", text: t.offAccount, bad: false, credit: null, estimate: null};
    // The host may say this vendor cannot be collected automatically (collector
    // "none"): show that instead of pretending it is merely "not checked in yet".
    // Missing collector (old exe) keeps the old wording below.
    if (vendor.collector === "none" && !entry) {
      return {key: "collectorNone", text: t.collectorNone, bad: false, credit: null, estimate: null};
    }
    if (!entry) return {key: "pending", text: t.pending, bad: false, credit: null, estimate: null};
    const outcome = OUTCOMES.includes(entry.outcome) ? entry.outcome : "pending";
    let line = t[outcome] || t.pending;
    if (entry.outcome === "ineligible" && entry.msg) line = `${line} · ${entry.msg}`;
    if (entry.streak) line = `${line}, ${t.streak.replace("{n}", entry.streak)}`;
    return {key: outcome, text: line, bad: outcome === "ineligible" || outcome === "captcha", credit, estimate};
  }

  // vendorGroups is the page's body: every vendor with its accounts, the day's
  // credits and how many are done, vendors with nothing signed in left out.
  function vendorGroups(state, lang) {
    const vendors = (state && state.providers) || [];
    const groups = vendors.map((vendor) => {
      const accounts = accountsOf(state, vendor).map((account) => {
        const {entry, credit, estimate} = todayOf(state, account.key);
        const line = status(account, vendor, state, lang);
        // No fallback to a fixed daily amount: the credit is only what the host
        // reports, and a missing number stays null so the page can say 未告知.
        return {...account, entry, credit, estimate, status: line};
      });
      const done = accounts.filter((a) => a.status.key === "claimed" || a.status.key === "done").length;
      const credit = accounts.reduce((sum, a) => sum + (a.credit ?? 0), 0);
      // How many took credits today without the vendor saying how many: the
      // page says so instead of adding a zero nobody claimed.
      const unknown = accounts.filter((a) => a.credit === null && (a.status.key === "claimed" || a.status.key === "done")).length;
      return {id: vendor.id, name: vendor.name || vendor.id, on: !!vendor.on, accounts, done, credit, unknown, total: accounts.length};
    });
    return groups.filter((g) => g.total > 0);
  }

  // openIds is which vendors start expanded. The page opens folded: a signed-in
  // user often has four or five vendors, and every group open pushes the list
  // past one screen before anything is read (issue #9). A saved option can
  // still ask for every group open with collapsed: false.
  function openIds(groups, opts) {
    if (!opts || opts.collapsed !== false) return [];
    return (groups || []).map((group) => group.id);
  }

  // totals is the header: how many accounts checked in today, and the credits
  // they took — the day's real total, not the vendor's allowance.
  function totals(groups) {
    const all = groups.reduce((sum, g) => sum + g.total, 0);
    const done = groups.reduce((sum, g) => sum + g.done, 0);
    const credit = groups.reduce((sum, g) => sum + g.credit, 0);
    const unknown = groups.reduce((sum, g) => sum + g.unknown, 0);
    return {all, done, credit, unknown};
  }

  // creditNote is the header / card-head credit slot. When some accounts checked
  // in but the vendor never reported an amount (unknown > 0), saying "0 积分" would
  // be a number nobody claimed. So:
  //   - partial known (value > 0) + unknown > 0 → 「<known 总额> · <N 项未告知>」两段都在；
  //   - all unknown (value === 0) + unknown > 0 → 只给「N 项未告知」，不写假 0；
  //   - unknown === 0 → 原总额。
  // value is the sum, suffix is the noun (points for the header, today for a card).
  function creditNote(value, unknown, lang, suffix) {
    const t = text(lang);
    const n = Number(unknown);
    const total = `${value} ${suffix}`;
    if (Number.isFinite(n) && n > 0) {
      const unknownText = t.unknownCount.replace("{n}", n);
      return Number(value) > 0 ? `${total} · ${unknownText}` : unknownText;
    }
    return total;
  }

  // freshness is the header's「数据截至 HH:MM · 台账」. It is null when the host
  // sends no refreshedAt (old exe, fish.8 and earlier): the page then shows no
  // as-of line at all — it degrades quietly instead of inventing a time. Source
  // is ledger / live; anything else is treated as the ledger default.
  function freshness(state, lang) {
    const at = state && state.refreshedAt;
    if (!at) return null;
    const date = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(date.getTime())) return null;
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const t = text(lang);
    const source = state.source === "live" ? t.sourceLive : t.sourceLedger;
    return t.dataAsOf.replace("{time}", `${hh}:${mm}`).replace("{source}", source);
  }

  globalThis.CheckinView = {text, todayOf, accountsOf, status, vendorGroups, totals, openIds, freshness, creditNote};
})();
