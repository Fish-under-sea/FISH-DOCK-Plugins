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
    for (const id of ags) {
      setText(a.name, callerName(r));
    }
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
    renderHist(); // idle
    layout();
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
  assert.equal((hooked.match(/fish:routing-render/g) || []).length, 4);
  assert.equal(hookRoutingClientScript(hooked), hooked, '重复调用应幂等');

  assert.doesNotThrow(() => new vm.Script(hooked, { filename: 'routing-client-hooked.js' }));

  const changed = 'function other() { return 42; }';
  assert.equal(hookRoutingClientScript(changed), changed, '上游结构变更时不抛错（fail-open）');
});

test('purgeOverlayAssets 资源存在且前端脚本无语法错误', () => {
  const assets = purgeOverlayAssets();
  assert.ok(assets.css.includes('#rt.purge-rt-host'));
  assert.ok(assets.css.includes('#purge-wires-svg'));
  assert.ok(assets.css.includes('[data-purge-skin="fish"]'));
  assert.ok(assets.js.includes('__FISH_PURGE_ROUTING_OVERLAY__'));
  assert.ok(assets.js.includes('hydrateDomTargets'));
  assert.ok(assets.js.includes('syncStandbyAgents'));
  assert.doesNotThrow(() => new vm.Script(assets.js, { filename: 'purge-routing-overlay.js' }));
  assert.doesNotThrow(() => new Function(assets.js));
  assert.ok(fs.existsSync(new URL('./purge-routing-overlay.css', import.meta.url)));
});
