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

// 已知每天固定 +100 的厂商（CodeArts、商汤小浣熊）：账号不回报数额时用固定值，
// 计入今日积分，不再出现未告知。
test('固定每日额度的厂商按 +100 记', () => {
  for (const id of ['codearts', 'raccoon']) {
    const s = {
      providers: [{id, name: id, on: true}],
      accounts: [{key: `${id}|a`, on: true, by: `plugin:${id}`}],
      today: {[`${id}|a`]: {outcome: 'done', msg: '今天已领取'}},
      credits: {},
    };
    const g = V.vendorGroups(s, 'zh')[0];
    assert.equal(g.accounts[0].credit, 100, id);
    assert.equal(g.credit, 100, id);
    assert.equal(g.unknown, 0, id);
  }
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