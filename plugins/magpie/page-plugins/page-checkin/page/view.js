// What the check-in page shows, worked out from checkin:state without the DOM,
// so a test can check it. A classic script: it sets globalThis.CheckinView.
(() => {
  const TEXT = {
    en: {
      title: "Check-in", all: "Check every signed-in account in once a day",
      run: "Check in now", running: "Checking in…", refresh: "Refresh credits", refreshing: "Refreshing…",
      expand: "Expand", collapse: "Collapse",
      switchOn: "On", switchOff: "Off",
      vendor: "Vendor", accounts: "{n} accounts", credits: "today",
      claimed: "Checked in today", done: "Checked in today (the vendor had it)",
      ineligible: "Not eligible", inactive: "No check-in event now",
      captcha: "Needs a captcha: check in in its own app",
      pending: "Not checked in yet", off: "Auto check-in is off",
      offAccount: "Left out of the daily check-in", none: "No account signed in yet.",
      failed: "Couldn't read check-ins", needsHost: "This page needs magpie 1.1 or newer.",
      streak: "{n}-day streak", total: "{done} of {all} checked in today", points: "points",
      unknown: "not reported", unknownCount: "{n} not reported", estimateHint: "Estimated from the credits panel",
    },
    zh: {
      title: "自动签到", all: "每天替每个已登录账号签到一次",
      run: "立即签到", running: "正在签到…", refresh: "刷新今日积分", refreshing: "正在刷新…",
      expand: "展开", collapse: "收起",
      switchOn: "开", switchOff: "关",
      vendor: "厂商", accounts: "{n} 个账号", credits: "今日",
      claimed: "今日已签到", done: "今日已签到（厂商侧已完成）",
      ineligible: "不符合签到条件", inactive: "当前没有签到活动",
      captcha: "需要验证码，请在厂商 App 内签到",
      pending: "今日尚未签到", off: "自动签到已关闭",
      offAccount: "不参与每日自动签到", none: "还没有登录的账号。",
      failed: "读取签到状态失败", needsHost: "这个页面需要 magpie 1.1 或更新版本。",
      streak: "连续 {n} 天", total: "今日已签到 {done} / {all}", points: "积分",
      unknown: "未告知", unknownCount: "{n} 项未告知", estimateHint: "按额度面板反推",
    },
  };
  const OUTCOMES = ["claimed", "done", "ineligible", "inactive", "captcha"];

  function text(lang) {
    return String(lang || "").toLowerCase().startsWith("zh") ? TEXT.zh : TEXT.en;
  }

  // The account's today, from the state the host gives: the entry the ledger
  // kept, the credits actually taken today, and — when the vendor's check-in
  // answer carries no amount at all — magpie's own estimate read off the
  // credits panel. null means the number is genuinely not known: showing 0
  // there would be a claim the vendor never made.
  function todayOf(state, key) {
    const entry = (state && state.today && state.today[key]) || null;
    const raw = (state && state.credits && state.credits[key]) ?? (entry && entry.credit);
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
        return {...account, entry, credit, estimate, status: status(account, vendor, state, lang)};
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

  // totals is the header: how many accounts checked in today, and the credits
  // they took — the day's real total, not the vendor's allowance.
  function totals(groups) {
    const all = groups.reduce((sum, g) => sum + g.total, 0);
    const done = groups.reduce((sum, g) => sum + g.done, 0);
    const credit = groups.reduce((sum, g) => sum + g.credit, 0);
    const unknown = groups.reduce((sum, g) => sum + g.unknown, 0);
    return {all, done, credit, unknown};
  }

  globalThis.CheckinView = {text, todayOf, accountsOf, status, vendorGroups, totals};
})();