// view.js 是给页面用的普通脚本（设置 globalThis.CheckinView），这里按同样方式
// 加载它，只测不碰 DOM 的那部分：分组、状态文案、今日积分汇总。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync(new URL('../page/view.js', import.meta.url), 'utf8'))();
const V = globalThis.CheckinView;

const state = {
  providers: [
    {id: 'workbuddy', name: 'WorkBuddy', on: true},
    {id: 'qoder', name: 'Qoder', on: true},
    {id: 'trae-cn', name: 'Trae', on: true},
    {id: 'empty-vendor', name: 'Empty', on: true},
  ],
  accounts: [
    {key: 'workbuddy|u1', user: 'ASUKA', by: 'plugin:workbuddy', on: true},
    {key: 'workbuddy|u2', user: 'FISH', by: 'plugin:workbuddy', on: false},
    {key: 'qoder|a1', user: 'asuka', by: '', on: true},
  ],
  today: {
    'workbuddy|u1': {day: '2026-10-28', outcome: 'claimed', credit: 100, streak: 18},
    'qoder|a1': {day: '2026-10-28', outcome: 'ineligible', msg: 'device identity runtime not found'},
  },
  credits: {'workbuddy|u1': 120},
  running: false,
};

test('按厂商分组，只留已登录账号的厂商', () => {
  const groups = V.vendorGroups(state, 'zh');
  assert.deepEqual(groups.map((g) => g.id), ['workbuddy', 'qoder']);
  assert.equal(groups[0].total, 2);
  assert.equal(groups[0].done, 1);
  // 账号按 by 归到 plugin:<id>，老宿主没有 by 时按 key 前缀归
  assert.deepEqual(groups[1].accounts.map((a) => a.key), ['qoder|a1']);
});

test('今日积分优先取宿主给的实得值，退回台账里的数字', () => {
  const groups = V.vendorGroups(state, 'zh');
  const [u1, u2] = groups[0].accounts;
  assert.equal(u1.credit, 120);
  // 没参与的账号没有数额，是 null 而不是 0：0 会被读成“厂商给了零个”
  assert.equal(u2.credit, null);
  assert.equal(groups[0].credit, 120);
});

test('状态依次判断：厂商关、账号排除、没有记录、厂商结果', () => {
  const offVendor = V.status({key: 'qoder|a1', on: true}, {id: 'qoder', on: false}, state, 'zh');
  assert.equal(offVendor.key, 'off');
  const offAccount = V.status({key: 'workbuddy|u2', on: false}, {id: 'workbuddy', on: true}, state, 'zh');
  assert.equal(offAccount.key, 'offAccount');
  const pending = V.status({key: 'workbuddy|u9', on: true}, {id: 'workbuddy', on: true}, state, 'zh');
  assert.equal(pending.key, 'pending');
  const claimed = V.status({key: 'workbuddy|u1', on: true}, {id: 'workbuddy', on: true}, state, 'zh');
  assert.equal(claimed.key, 'claimed');
  assert.match(claimed.text, /今日已签到/);
  assert.match(claimed.text, /连续 18 天/);
  assert.equal(claimed.bad, false);
});

test('不符合条件原样带出厂商原因，并标记为需要注意', () => {
  const groups = V.vendorGroups(state, 'zh');
  const row = groups[1].accounts[0];
  assert.equal(row.status.key, 'ineligible');
  assert.match(row.status.text, /不符合签到条件/);
  assert.match(row.status.text, /device identity runtime not found/);
  assert.equal(row.status.bad, true);
});

test('未识别的结果按“今日尚未签到”处理，不显示原文编码', () => {
  const odd = {accounts: [{key: 'x|1', on: true, by: 'plugin:x'}], providers: [{id: 'x', name: 'X', on: true}],
    today: {'x|1': {outcome: 'weird'}}, credits: {}};
  const row = V.vendorGroups(odd, 'en')[0].accounts[0];
  assert.equal(row.status.key, 'pending');
  assert.match(row.status.text, /Not checked in yet/);
});

test('汇总今日已签到账号数与实得积分', () => {
  assert.deepEqual(V.totals(V.vendorGroups(state, 'zh')), {all: 3, done: 1, credit: 120, unknown: 0});
  assert.deepEqual(V.totals([]), {all: 0, done: 0, credit: 0, unknown: 0});
});

test('英文与中文各一套文案，语言按前缀判定', () => {
  assert.match(V.text('zh-CN').claimed, /已签到/);
  assert.match(V.text('en').claimed, /Checked in today/);
  assert.match(V.text(undefined).run, /Check in now/);
});

// 预装插件美化那一行：中英都要有，且说的是「插件/供应商/侧边栏里的图标」，
// 不能写成只管签到页——这一层接管的是整个窗口里的图标。
test('预装插件美化那一行中英都有，且点明是全局图标', () => {
  for (const lang of ['zh-CN', 'en']) {
    const t = V.text(lang);
    assert.ok(t.lookTitle, `${lang} 缺 lookTitle`);
    assert.ok(t.lookNote, `${lang} 缺 lookNote`);
    assert.equal(t.lookNote.includes('签到页'), false, `${lang} 把它写成了只管签到页`);
  }
  assert.match(V.text('zh-CN').lookTitle, /预装插件美化/);
  assert.match(V.text('en').lookTitle, /Preinstalled plugin artwork/);
});

// 厂商只回「今天已领取」、又没有固定值：不计积分（也不显示未告知），仍按已签到计数。
test('厂商不给数额且无固定值时不计积分，仍按已签到计入完成数', () => {
  const noAmount = {
    providers: [{id: 'acme', name: 'Acme', on: true}],
    accounts: [{key: 'acme|a', on: true, by: 'plugin:acme'}],
    today: {'acme|a': {outcome: 'done', msg: '今天已领取'}},
    credits: {},
  };
  const group = V.vendorGroups(noAmount, 'zh')[0];
  assert.equal(group.accounts[0].credit, null);
  assert.equal(group.accounts[0].estimate, null);
  assert.equal(group.accounts[0].status.key, 'done');
  assert.equal(group.done, 1);
  assert.equal(group.credit, 0);
  assert.equal(group.unknown, 1);
});

// 宿主按额度面板反推出的数：单独给一格，不并进「实得」汇总。
test('宿主给出反推值时用它，且不并入实得积分', () => {
  const guessed = {
    providers: [{id: 'acme', name: 'Acme', on: true}],
    accounts: [{key: 'acme|a', on: true, by: 'plugin:acme'}],
    today: {'acme|a': {outcome: 'done'}},
    credits: {},
    creditEstimate: {'acme|a': 50},
  };
  const group = V.vendorGroups(guessed, 'zh')[0];
  assert.equal(group.accounts[0].credit, null);
  assert.equal(group.accounts[0].estimate, 50);
  assert.equal(group.credit, 0);
  assert.equal(group.unknown, 1);
});

test('未告知与反推各有中英文案', () => {
  assert.equal(V.text('zh').unknown, '未告知');
  assert.equal(V.text('en').unknown, 'not reported');
  assert.equal(V.text('zh').unknownCount.replace('{n}', 2), '2 项未告知');
  assert.equal(V.text('zh').estimateHint, '按额度面板反推');
});

// 宿主可能给 by 厂商 id 本身（新格式）、plugin:<id> 或干脆没有 by：都按 key
// 的 "<厂商>|" 前缀归组，不能因为 by 的写法漏掉账号。
test('账号按 key 前缀归组，不受 by 写法影响', () => {
  const s = {
    providers: [{id: 'workbuddy', name: 'WorkBuddy', on: true}],
    accounts: [
      {key: 'workbuddy|a', user: 'A', by: 'workbuddy', on: true},
      {key: 'workbuddy|b', user: 'B', by: 'plugin:workbuddy', on: true},
      {key: 'workbuddy|c', user: 'C', by: '', on: true},
    ],
    today: {}, credits: {},
  };
  const g = V.vendorGroups(s, 'zh')[0];
  assert.deepEqual(g.accounts.map((a) => a.key), ['workbuddy|a', 'workbuddy|b', 'workbuddy|c']);
});

// issue #9 ②：厂商分组默认收起 —— 一进来先看总数，点标题才展开账号列表。
// 包选项 collapsed: false 仍然让全部分组展开，留给老的偏好。
test('厂商分组默认收起，只有包选项明确要求才全展开', () => {
  const groups = V.vendorGroups(state, 'zh');
  assert.deepEqual(V.openIds(groups, {}), []);
  assert.deepEqual(V.openIds(groups, {collapsed: true}), []);
  assert.deepEqual(V.openIds(groups, undefined), []);
  assert.deepEqual(V.openIds(groups, {collapsed: false}), ['workbuddy', 'qoder']);
  assert.deepEqual(V.openIds([], {collapsed: false}), []);
});

// issue #15 ①：宿主没有 dailyCredits / credits 时不补固定额度，也不再用老的
// DEFAULT_DAILY（CodeArts / 商汤小浣熊 +100）。缺值一律 null，页面据此显示未告知。
test('无 dailyCredits 时额度不补固定值，缺值记为未告知', () => {
  for (const id of ['codearts', 'raccoon']) {
    const s = {
      providers: [{id, name: id, on: true}],
      accounts: [{key: `${id}|a`, on: true, by: `plugin:${id}`}],
      today: {[`${id}|a`]: {outcome: 'done', msg: '今天已领取'}},
      credits: {},
    };
    const g = V.vendorGroups(s, 'zh')[0];
    assert.equal(g.accounts[0].credit, null, `${id} 不再 +100`);
    assert.equal(g.credit, 0, id);
    assert.equal(g.unknown, 1, `${id} 计一条未告知`);
  }
  assert.equal(V.text('zh').unknown, '未告知');
});

// issue #15 ①：宿主回了 dailyCredits 就按原值透传，不做任何补偿或改写。
test('有 dailyCredits 时按宿主原值显示，不并入估算', () => {
  const s = {
    providers: [{id: 'codearts', name: 'CodeArts', on: true}],
    accounts: [{key: 'codearts|a', on: true, by: 'plugin:codearts'}],
    today: {'codearts|a': {outcome: 'done'}},
    credits: {},
    dailyCredits: {'codearts|a': 321},
  };
  const g = V.vendorGroups(s, 'zh')[0];
  assert.equal(g.accounts[0].credit, 321);
  assert.equal(g.accounts[0].estimate, null);
  assert.equal(g.credit, 321);
  assert.equal(g.unknown, 0);
});

// issue #15 ③：provider 带 collector=none 表示这家不支持自动采集：页面如实说
// 「不支持自动采集」，而不是永远「今日尚未签到」。缺 collector（老 exe）按旧口径。
test('collector=none 的厂商显示「不支持自动采集」', () => {
  const s = {
    providers: [{id: 'kiro', name: 'Kiro', on: true, collector: 'none'}],
    accounts: [{key: 'kiro|a', on: true, by: 'plugin:kiro'}],
    today: {}, credits: {},
  };
  const row = V.vendorGroups(s, 'zh')[0].accounts[0];
  assert.equal(row.status.key, 'collectorNone');
  assert.match(row.status.text, /不支持自动采集/);
  assert.equal(V.text('en').collectorNone, 'No automatic collection');
  // 老宿主没有 collector 字段：仍说「今日尚未签到」，不误判成不支持采集
  const old = {...s, providers: [{id: 'kiro', name: 'Kiro', on: true}]};
  assert.equal(V.vendorGroups(old, 'zh')[0].accounts[0].status.key, 'pending');
});

// 降级：旧 exe（fish.8）没有 refreshedAt/source。缺字段时 freshness 返回 null，
// 页面不显示「数据截至」，而不是画一个假时间。
test('无 refreshedAt 时按旧口径：不显示数据截至', () => {
  assert.equal(V.freshness({}, 'zh'), null);
  assert.equal(V.freshness(state, 'zh'), null);
  assert.equal(V.freshness({refreshedAt: 'not-a-date'}, 'zh'), null);
});

// 新口径：refreshedAt 存在时显示「数据截至 HH:MM · 台账」，source=live 显示实时。
test('有 refreshedAt 时显示数据截至 HH:MM，并按 source 区分台账/实时', () => {
  const ledger = V.freshness({refreshedAt: '2026-11-02T14:05:00+08:00', source: 'ledger'}, 'zh');
  assert.match(ledger, /^数据截至 \d{2}:\d{2} · 台账$/);
  const live = V.freshness({refreshedAt: '2026-11-02T14:05:00+08:00', source: 'live'}, 'zh');
  assert.match(live, /^数据截至 \d{2}:\d{2} · 实时$/);
  const en = V.freshness({refreshedAt: '2026-11-02T14:05:00+08:00', source: 'ledger'}, 'en');
  assert.match(en, /^Data as of \d{2}:\d{2} · ledger$/);
});

// issue #15 ⑤：刷新按钮语义是「重新读取额度」（RefreshUsage），不是「刷新今日积分」。
test('刷新文案改为重新读取额度，与 RefreshUsage 语义一致', () => {
  assert.equal(V.text('zh').refresh, '重新读取额度');
  assert.equal(V.text('en').refresh, 'Re-read credits');
  assert.equal(V.text('zh').refreshing, '正在读取…');
});

// t4 R1：表头/卡头不能把「未告知」折成 0。creditNote 在 unknown>0 时给未告知计数，
// 只有全部已知才显示总额；否则会出现「账号行说未告知、表头说 0 积分」的自相矛盾。
test('额度未知时表头/卡头显示未告知计数，不显示 0 积分 / 0 今日', () => {
  const s = {
    providers: [{id: 'acme', name: 'Acme', on: true}],
    accounts: [{key: 'acme|a', on: true, by: 'plugin:acme'}],
    today: {'acme|a': {outcome: 'claimed'}},
    credits: {},
  };
  const groups = V.vendorGroups(s, 'zh');
  const totals = V.totals(groups);
  assert.equal(totals.credit, 0);
  assert.equal(totals.unknown, 1);
  // 单账号 claimed 但宿主没报额度：表头不得出现「0 积分」，卡头不得出现「0 今日」。
  assert.equal(V.creditNote(totals.credit, totals.unknown, 'zh', '积分'), '1 项未告知');
  assert.equal(V.creditNote(groups[0].credit, groups[0].unknown, 'zh', '今日'), '1 项未告知');
  // 全部已知时仍显示原总额（含真实的 0）。
  assert.equal(V.creditNote(120, 0, 'zh', '积分'), '120 积分');
  assert.equal(V.creditNote(0, 0, 'zh', '今日'), '0 今日');
  assert.equal(V.creditNote(0, 2, 'en', 'points'), '2 not reported');
  // 部分账号有额度 + 部分未告知：已知总额与未告知计数两段都在，不是二选一。
  assert.equal(V.creditNote(120, 1, 'zh', '积分'), '120 积分 · 1 项未告知');
  assert.equal(V.creditNote(120, 2, 'en', 'points'), '120 points · 2 not reported');
});
