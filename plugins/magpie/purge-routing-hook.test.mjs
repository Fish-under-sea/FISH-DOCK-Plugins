import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  PURGE_ASSET_VERSION,
  PURGE_OVERLAY_CSS_PATH,
  PURGE_OVERLAY_JS_PATH,
  hookIndexHtml,
  hookRoutingClientScript,
  purgeOverlayAssets,
} from './purge-routing-hook.mjs';

test('hookIndexHtml 注入叠加层脚本与样式、刷新 client.js 查询串且幂等、fail-open', () => {
  const html = '<!doctype html><html><head><title>magpie</title></head><body><script src="plugins/routing/client.js?v=0a84594d9446"></script><script src="app.js"></script></body></html>';
  const hooked = hookIndexHtml(html);
  assert.match(hooked, new RegExp(PURGE_OVERLAY_CSS_PATH.replace('/', '\\/')));
  assert.match(hooked, new RegExp(PURGE_OVERLAY_JS_PATH.replace('/', '\\/')));
  assert.ok(hooked.includes(`plugins/routing/client.js?v=0a84594d9446&purge=${PURGE_ASSET_VERSION}`));
  assert.ok(hooked.indexOf(PURGE_OVERLAY_JS_PATH) < hooked.indexOf('</body>'));
  assert.equal(hookIndexHtml(hooked), hooked, '重复执行应保持幂等');

  const noQuery = '<html><body><script src="/plugins/routing/client.js"></script></body></html>';
  const hookedNoQuery = hookIndexHtml(noQuery);
  assert.ok(hookedNoQuery.includes(`/plugins/routing/client.js?purge=${PURGE_ASSET_VERSION}`));
  assert.equal(hookIndexHtml(hookedNoQuery), hookedNoQuery);

  const noBody = '<div>partial</div>';
  assert.equal(hookIndexHtml(noBody), noBody, '缺少 </body> 时原样返回');
});

test('hookRoutingClientScript 无损打标原生节点（含 foldNode 与 empty）并保持语法合法与幂等', () => {
  const sampleClient = `
function routingPage(part) {
  const hubSub = el("small"), chip = el("i");
  hub.append(logo, el("b", "", "magpie"), hubSub, chip);
  box.append(top, rbar, stage, foot, log, off);
  function foldNode(key, w) {
    f.w = w;
  }
  function rebuild(rs, force) {
    if (force) {
      srcs.replaceChildren();
    }
    for (const id of ags) {
      setText(a.name, callerName(r));
    }
    if (nodes.some((x, i) => srcs.children[i] !== x) || srcs.children.length !== nodes.length) srcs.replaceChildren(...nodes);
    srcs.classList.toggle("many", ags.length > 1);
    for (const id of ids) {
      row.rid = rOf.get(id);
    }
    header(cur, ags.length);
    layout();
  }
  function render() {
    if (!cur) return;
    hubText();
  }
  function empty() {
    srcs.replaceChildren(a.node);
    renderHist(); // idle
    layout();
  }
  function layout() {
    for (const a of agents.values()) {
      const s = b(a.node), mx = (s.r + h.l) / 2;
      sets.push([a.wire, h.l > s.r ? curve(s.r, s.cy, mx, h.l, h.cy) : \`M\${s.cx} \${s.b} L\${h.cx} \${h.t}\`]);
    }
  }
}
`;
  const hooked = hookRoutingClientScript(sampleClient);
  assert.match(hooked, /dataset\.purgeTargetKind = "hub"/);
  assert.match(hooked, /dataset\.purgeTargetId = "hub-magpie"/);
  assert.match(hooked, /dataset\.purgeTargetKind = "agent"/);
  assert.match(hooked, /dataset\.purgeTargetKind = "provider"/);
  assert.match(hooked, /dataset\.purgeProviderId = _pp/);
  assert.match(hooked, /dataset\.purgeFold = "1"/);
  assert.match(hooked, /fish:routing-layout/);
  assert.match(hooked, /dataset\.purgeStandbyWire = "1"/);
  assert.match(hooked, /wires\.querySelectorAll\("path\[data-purge-standby-wire\]"\)/);
  assert.equal((hooked.match(/purge-standby-agent/g) || []).length, 4, 'rebuild / force / empty / layout 四处均应处理待命块');
  assert.equal((hooked.match(/fish:routing-render/g) || []).length, 4);
  assert.equal(hookRoutingClientScript(hooked), hooked, '重复调用应幂等');

  assert.doesNotThrow(() => new vm.Script(hooked, { filename: 'routing-client-hooked.js' }));

  const changed = 'function other() { return 42; }';
  assert.equal(hookRoutingClientScript(changed), changed, '上游结构变更时不抛错（fail-open）');
});

test('purgeOverlayAssets 资源存在且前端脚本无语法错误', () => {
  const assets = purgeOverlayAssets();
  assert.equal(PURGE_ASSET_VERSION, '8');
  assert.ok(assets.css.includes('#rt.purge-rt-host'));
  assert.ok(assets.css.includes('#purge-wires-svg'));
  assert.ok(assets.css.includes('[data-purge-skin="fish"]'));
  assert.ok(assets.css.includes('.purge-ctx-guide'));
  assert.equal(assets.css.includes('.purge-wire-standby'), false);
  assert.ok(assets.js.includes('__FISH_PURGE_ROUTING_OVERLAY__'));
  assert.ok(assets.js.includes('hydrateDomTargets'));
  assert.ok(assets.js.includes('syncStandbyAgents'));
  assert.ok(assets.js.includes('data-act="goto-agents"'));
  assert.ok(assets.js.includes("setAttribute('viewBox'"));
  assert.ok(assets.js.includes("animate ? ' purge-is-emerging' : ''"));
  assert.equal(assets.js.includes('purge-wire-standby'), false);
  assert.ok(assets.js.includes('active: true'));
  assert.equal(assets.js.includes('active: hasAnyWrap'), false);
  assert.doesNotThrow(() => new vm.Script(assets.js, { filename: 'purge-routing-overlay.js' }));
  assert.doesNotThrow(() => new Function(assets.js));
  assert.ok(fs.existsSync(new URL('./purge-routing-overlay.css', import.meta.url)));

  const sandbox = {
    window: null,
    document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null },
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  vm.runInNewContext(assets.js, sandbox);
  const utils = sandbox.window.__FISH_PURGE_OVERLAY_UTILS__;
  assert.ok(utils);

  // 打码恢复与无 raw 兜底
  const maskedEl = {
    nodeType: 1,
    childNodes: [
      { nodeType: 1, classList: { contains: (c) => c === 'pii' }, dataset: { raw: 'Chensy395' }, childNodes: [] },
    ],
  };
  assert.deepEqual({ ...utils.readUnmaskedText(maskedEl) }, { text: 'Chensy395', maskedOpaque: false });

  const opaqueMaskedEl = {
    nodeType: 1,
    childNodes: [
      { nodeType: 1, classList: { contains: (c) => c === 'pii' }, dataset: {}, childNodes: [] },
    ],
  };
  assert.deepEqual({ ...utils.readUnmaskedText(opaqueMaskedEl) }, { text: '', maskedOpaque: true });

  // 失真打码残留目标识别
  assert.equal(utils.isBrokenProviderTarget({ providerId: '', providerName: '', preset: '', account: 'sma', model: '' }), true);
  assert.equal(utils.isBrokenProviderTarget({ providerId: 'trae-cn', providerName: 'Trae CN', model: 'deepseek-v4.1-flash-max' }), false);

  // 同模型跨厂商绝不误匹配（codearts vs meoo 同用 deepseek-v4.1-flash-1017）
  assert.equal(
    utils.sameProviderTarget(
      { groupId: 'deepseek', providerId: 'meoo', providerName: 'Meoo', model: 'deepseek-v4.1-flash-1017' },
      { groupId: 'deepseek', providerId: 'codearts', providerName: 'CodeArts', model: 'deepseek-v4.1-flash-1017' },
    ),
    false,
  );
  assert.equal(
    utils.sameProviderTarget(
      { groupId: 'deepseek', providerId: '', providerName: 'Trae CN', model: 'deepseek-v4.1-flash-max' },
      { groupId: 'deepseek', providerId: 'trae-cn', providerName: 'Trae CN', model: 'deepseek-v4.1-flash-max', account: 'Chensy395' },
    ),
    true,
  );

  // 连线曲线与原生 midpoint Bezier 对齐（横排与堆叠）
  assert.equal(
    utils.makeWireCurve(100, 50, 200, 150),
    'M 100.0 50.0 C 150.0 50.0, 150.0 150.0, 200.0 150.0',
  );
  assert.equal(
    utils.makeWireCurve(100, 50, 100, 150, true),
    'M 100.0 50.0 C 100.0 100.0, 100.0 100.0, 100.0 150.0',
  );

  // 右键菜单 Agent 列表仅对齐 Magpie 已接入 (wired) Agent 并按 agentOrder 排序
  const sampleMagpieAgents = [
    { id: 'claude', name: 'Claude Code', icon: 'claudecode-color', wired: true, fields: [{ key: 'model', value: 'group/deepseek[1m]' }] },
    { id: 'codex', name: 'Codex', icon: 'codex-color', wired: false, fields: [{ key: 'model', value: 'gpt-5.6-terra' }] },
    { id: 'opencode', name: 'OpenCode', icon: 'opencode', wired: true, fields: [{ key: 'model', value: 'magpie/group/deepseek' }] },
    { id: 'dsh', name: 'DeepSeek Harness', icon: 'deepseek-color', wired: true, fields: [{ key: 'model', value: 'magpie/group/deepseek' }] },
    { id: 'zcode', name: 'ZCode', icon: 'zcode', wired: true, fields: [] },
    { id: 'obsidian-memory', name: 'Obsidian 记忆 Agent', icon: 'obsidian', wired: true, fields: [{ key: 'model', value: 'group/deepseek' }] },
  ];
  const visibleMap = new Map([['dsh', { standby: false, name: 'DeepSeek Harness', route: 'group/deepseek', el: null }]]);
  const catalog = utils.buildAgentCatalog(sampleMagpieAgents, ['obsidian-memory', 'claude', 'opencode', 'dsh', 'zcode'], visibleMap);
  assert.deepEqual(
    [...catalog.map((c) => c.id)],
    ['obsidian-memory', 'claude', 'opencode', 'dsh', 'zcode'],
    '应排除未接入的 codex 并按 agentOrder 排序',
  );
  assert.equal(catalog.find((c) => c.id === 'claude')?.route, 'group/deepseek');
  assert.equal(catalog.find((c) => c.id === 'opencode')?.route, 'group/deepseek');
  assert.equal(catalog.find((c) => c.id === 'dsh')?.onStage, true);
});

test('hookRoutingClientScript 多账号 seat 唯一标识且 provider 行不把 providerId 写入 account', () => {
  const sampleClient = `
function routingPage(part) {
  const seat = (w) => w.kind === "account" && w.who ? w.provider + "@" + w.who : w.id;
  function rebuild(rs, force) {
    for (const id of ids) {
      row.rid = rOf.get(id);
    }
  }
}
`;
  const hooked = hookRoutingClientScript(sampleClient);
  assert.match(hooked, /_pw\.kind === "provider" \? "" : String\(_pw\.who \|\| ""\)/);
  assert.match(hooked, /typeof seat === "function" \? seat\(_pw\) : ""/);
  assert.doesNotThrow(() => new vm.Script(hooked, { filename: 'routing-client-hooked-seat.js' }));
});
