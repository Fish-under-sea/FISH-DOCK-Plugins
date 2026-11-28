import fs from 'node:fs';

export const PURGE_ASSET_VERSION = '8';
export const PURGE_OVERLAY_JS_PATH = '/_fish/purge-routing-overlay.js';
export const PURGE_OVERLAY_CSS_PATH = '/_fish/purge-routing-overlay.css';

const OVERLAY_CSS_FILE = new URL('./purge-routing-overlay.css', import.meta.url);
const OVERLAY_JS_FILE = new URL('./purge-routing-overlay.js', import.meta.url);

export function purgeOverlayAssets() {
  return {
    css: fs.readFileSync(OVERLAY_CSS_FILE, 'utf8'),
    js: fs.readFileSync(OVERLAY_JS_FILE, 'utf8'),
  };
}

/**
 * 往 Magpie 管理页 HTML 增量注入 Purge 路由叠加层资源，保留原页面结构一字不改（幂等、fail-open）。
 * 同时为 plugins/routing/client.js 附加 purge 版本参数，避免 WebView2 命中升级前缓存的未注入脚本。
 */
export function hookIndexHtml(html) {
  if (typeof html !== 'string' || !html) return html;
  let out = html;

  const routingSrcRe = /<script\b([^>]*?)\bsrc=(["'])(\/?plugins\/routing\/client\.js(?:\?[^"']*)?)\2([^>]*)>/i;
  if (routingSrcRe.test(out)) {
    out = out.replace(routingSrcRe, (full, pre, quote, srcUrl, post) => {
      if (/[?&]purge=/i.test(srcUrl)) return full;
      const sep = srcUrl.includes('?') ? '&' : '?';
      return `<script${pre}src=${quote}${srcUrl}${sep}purge=${PURGE_ASSET_VERSION}${quote}${post}>`;
    });
  }

  const closeBody = /<\/body>/i;
  if (!closeBody.test(out)) return out;
  const tags = [
    out.includes(PURGE_OVERLAY_CSS_PATH) ? '' : `<link rel="stylesheet" href="${PURGE_OVERLAY_CSS_PATH}?v=${PURGE_ASSET_VERSION}">`,
    out.includes(PURGE_OVERLAY_JS_PATH) ? '' : `<script src="${PURGE_OVERLAY_JS_PATH}?v=${PURGE_ASSET_VERSION}" defer></script>`,
  ]
    .filter(Boolean)
    .join('\n');
  if (!tags) return out;
  return out.replace(closeBody, `${tags}\n</body>`);
}

/**
 * 为原生 plugins/routing/client.js 注入轻量无侵入标记与渲染事件，供 Purge 叠加层追踪真实节点。
 * 任一锚点不匹配均静默跳过（fail-open），绝不破坏原版路由功能。
 */
export function hookRoutingClientScript(source) {
  if (typeof source !== 'string' || !source) return source;
  if (source.includes('fish:routing-render')) return source;

  let out = source;

  // 1. 中央 magpie 总路由节点标记 + 挂载事件
  const hubRe = /hub\.append\(logo,\s*el\("b",\s*"",\s*"magpie"\),\s*hubSub,\s*chip\);/;
  if (hubRe.test(out)) {
    out = out.replace(
      hubRe,
      '$& hub.dataset.purgeTargetKind = "hub"; hub.dataset.purgeTargetId = "hub-magpie";',
    );
  }

  const mountBoxRe = /box\.append\(top,\s*rbar,\s*stage,\s*foot,\s*log,\s*off\);/;
  if (mountBoxRe.test(out)) {
    out = out.replace(
      mountBoxRe,
      '$& try { if (window.__fishRoutingLayoutHandler) window.removeEventListener("fish:routing-layout", window.__fishRoutingLayoutHandler); window.__fishRoutingLayoutHandler = () => { try { layout(); } catch {} }; window.addEventListener("fish:routing-layout", window.__fishRoutingLayoutHandler); queueMicrotask(() => window.dispatchEvent(new CustomEvent("fish:routing-render", { detail: { box, stage, hub, srcs, list } }))); } catch {}',
    );
  }

  // 2. 左侧 Agent 来源卡片标记
  const agentRe = /setText\(a\.name,\s*callerName\(r\)\);/;
  if (agentRe.test(out)) {
    out = out.replace(
      agentRe,
      '$& try { a.node.dataset.purgeTargetKind = "agent"; a.node.dataset.purgeTargetId = String(r.agent || id); a.node.dataset.purgeStageKey = String(id); a.node.dataset.purgeAgentName = String(callerName(r) || r.agent || id); a.node.dataset.purgeRoute = String(r.model || ""); } catch {}',
    );
  }

  // 3. 右侧供应商 / 模型行与折叠行标记
  const rowRe = /row\.rid = rOf\.get\(id\);/;
  if (rowRe.test(out)) {
    out = out.replace(
      rowRe,
      '$& try { const _pw = row.w || {}; const _pr = (typeof src === "function" ? src().get(row.rid) : null) || (typeof pinned !== "undefined" ? pinned : null) || (typeof cur !== "undefined" ? cur : null); const _pg = String(_pr?.group?.id || ""); const _pp = String(_pw.provider || ""); const _pm = String(_pw.model || ""); const _pn = String(_pw.name || _pw.provider || ""); const _pwWho = _pw.kind === "provider" ? "" : String(_pw.who || ""); const _pSeat = String((typeof seat === "function" ? seat(_pw) : "") || _pw.id || _pwWho); row.li.dataset.purgeTargetKind = "provider"; row.li.dataset.purgeTargetId = `prov:${_pg}:${_pp}:${_pm}:${_pSeat}`; row.li.dataset.purgeGroupId = _pg; row.li.dataset.purgeProviderId = _pp; row.li.dataset.purgeProviderName = _pn; row.li.dataset.purgePreset = String(_pw.preset || ""); row.li.dataset.purgeSeatId = _pSeat; row.li.dataset.purgeModel = _pm; row.li.dataset.purgeAccount = _pwWho; } catch {}',
    );
  }

  const foldRe = /f\.w = w;/;
  if (foldRe.test(out)) {
    out = out.replace(
      foldRe,
      '$& try { const _fw = f.w || {}; const _fr = (typeof pinned !== "undefined" ? pinned : null) || (typeof cur !== "undefined" ? cur : null); const _fg = String(_fr?.group?.id || ""); const _fp = String(_fw.provider || ""); const _fm = String(_fw.model || ""); const _fn = String(_fw.name || _fw.provider || ""); f.li.dataset.purgeTargetKind = "provider"; f.li.dataset.purgeTargetId = `fold:${_fg}:${_fp}:${_fm}:${String(key || "")}`; f.li.dataset.purgeGroupId = _fg; f.li.dataset.purgeProviderId = _fp; f.li.dataset.purgeProviderName = _fn; f.li.dataset.purgePreset = String(_fw.preset || ""); f.li.dataset.purgeModel = _fm; f.li.dataset.purgeAccount = ""; f.li.dataset.purgeFold = "1"; } catch {}',
    );
  }

  // 4. rebuild / render / empty 后派发同步事件
  const rebuildDoneRe = /header\(cur,\s*ags\.length\);\s*layout\(\);/;
  if (rebuildDoneRe.test(out)) {
    out = out.replace(
      rebuildDoneRe,
      '$& try { window.dispatchEvent(new CustomEvent("fish:routing-render", { detail: { box, stage, hub, srcs, list } })); } catch {}',
    );
  }

  const renderHeadRe = /(function render\(\)\s*\{\s*if\s*\(!cur\)\s*return;\s*hubText\(\);)/;
  if (renderHeadRe.test(out)) {
    out = out.replace(
      renderHeadRe,
      '$1 try { window.dispatchEvent(new CustomEvent("fish:routing-render", { detail: { box, stage, hub, srcs, list } })); } catch {}',
    );
  }

  const emptyDoneRe = /(renderHist\(\);(?:\s*\/\/[^\n]*)?\s*layout\(\);)/;
  if (emptyDoneRe.test(out)) {
    out = out.replace(
      emptyDoneRe,
      '$1 try { window.dispatchEvent(new CustomEvent("fish:routing-render", { detail: { box, stage, hub, srcs, list } })); } catch {}',
    );
  }

  // 5. 在 rebuild / force-reset / empty 时保留 .purge-standby-agent 节点，避免每秒刷新擦除导致闪烁与连线错位
  const rebuildSrcsRe = /if\s*\(nodes\.some\(\(x,\s*i\)\s*=>\s*srcs\.children\[i\]\s*!==\s*x\)\s*\|\|\s*srcs\.children\.length\s*!==\s*nodes\.length\)\s*srcs\.replaceChildren\(\.\.\.nodes\);\s*srcs\.classList\.toggle\("many",\s*ags\.length\s*>\s*1\);/;
  if (rebuildSrcsRe.test(out)) {
    out = out.replace(
      rebuildSrcsRe,
      '{ const _sb = [...srcs.children].filter((el) => el.classList && el.classList.contains("purge-standby-agent")); const _all = [...nodes, ..._sb]; if (_all.some((x, i) => srcs.children[i] !== x) || srcs.children.length !== _all.length) srcs.replaceChildren(..._all); srcs.classList.toggle("many", _all.length > 1); }',
    );
  }

  const forceClearSrcsRe = /srcs\.replaceChildren\(\);/;
  if (forceClearSrcsRe.test(out)) {
    out = out.replace(
      forceClearSrcsRe,
      'for (const _c of [...srcs.children]) if (!_c.classList?.contains("purge-standby-agent")) _c.remove();',
    );
  }

  const emptySrcsRe = /srcs\.replaceChildren\(a\.node\);/;
  if (emptySrcsRe.test(out)) {
    out = out.replace(
      emptySrcsRe,
      '{ const _sb = [...srcs.children].filter((el) => el.classList && el.classList.contains("purge-standby-agent")); srcs.replaceChildren(a.node, ..._sb); srcs.classList.toggle("many", 1 + _sb.length > 1); }',
    );
  }

  // 6. 在原生 layout() 中为 .purge-standby-agent 绘制原生 .rt-wires 白色连线（统一视觉与坐标）
  const layoutAgentsRe = /for\s*\(const a of agents\.values\(\)\)\s*\{\s*const s = b\(a\.node\),\s*mx = \(s\.r \+ h\.l\) \/ 2;\s*sets\.push\(\[a\.wire,\s*h\.l > s\.r \? curve\(s\.r,\s*s\.cy,\s*mx,\s*h\.l,\s*h\.cy\) : `M\$\{s\.cx\} \$\{s\.b\} L\$\{h\.cx\} \$\{h\.t\}`\]\);\s*\}/;
  if (layoutAgentsRe.test(out)) {
    out = out.replace(
      layoutAgentsRe,
      (m) =>
        m +
        ' for (const _sn of srcs.querySelectorAll(".purge-standby-agent")) { let _sw = _sn._purgeWire; if (!_sw || _sw.parentNode !== wires) { _sw = path(); _sw.dataset.purgeStandbyWire = "1"; _sn._purgeWire = _sw; } const _sb = b(_sn), _mx = (_sb.r + h.l) / 2; sets.push([_sw, h.l > _sb.r ? curve(_sb.r, _sb.cy, _mx, h.l, h.cy) : `M${_sb.cx} ${_sb.b} L${h.cx} ${h.t}`]); } for (const _ow of [...wires.querySelectorAll("path[data-purge-standby-wire]")]) { if (![...srcs.children].some((el) => el._purgeWire === _ow)) _ow.remove(); }',
    );
  }

  return out;
}
