// Clash 页的外观模型：背景图片与分区域液态玻璃。
//
// 契约（与 Magpie 的液态玻璃同一套词汇，便于两边用户心智一致）：
//   fill  0–100：区域底色的不透明百分比。100 = 完全不透明（等于关闭），
//                数字越小，壁纸透得越多。
//   blur  0–40 px：该区域背景的模糊半径。0 = 不模糊（等于关闭）。
// 因此「关闭」不是一个布尔值，而是 fill=100 / blur=0 的坐标点——
// 这样预设、滑块、以及「无 backdrop-filter 环境的降级」都只需一组数字，
// 不需要额外的 on/off 属性开关。
//
// 区域划分（Clash 页自己的视觉层级）：
//   main    内容卡片：.card / .subscription / .tun-box / .empty-card / .confirm-bar
//   overlay 浮层：.listbox / .snackbar
//
// 本文件只做纯数据变换，不碰 DOM、不碰存储，单测直接跑。

export const GLASS_REGIONS = ['main', 'overlay', 'control'];

// 预设：名字 → 三个区域的坐标。off 就是「全 100 / 全 0」。
// 数值与 Magpie 的设置 › 外观同一套坐标（main≈content、overlay≈overlay、control≈control）；
// 让「均衡」在两边看起来一样：主界面要真的透出来，否则等于没开。
export const GLASS_PRESETS = Object.freeze({
 follow: null,
 off: {main: [100, 0], overlay: [100, 0], control: [100, 0]},
 light: {main: [82, 12], overlay: [84, 16], control: [86, 10]},
 balanced: {main: [60, 22], overlay: [62, 26], control: [72, 14]},
 clear: {main: [0, 20], overlay: [0, 22], control: [0, 10]},
 custom: null,
});

export const DEFAULT_APPEARANCE = Object.freeze({
 schema: 1,
 wallpaper: '',
 veil: 40,
 font: {text: '', dim: ''},
 fontDark: {text: '', dim: ''},
 fontDarkOn: false,
 fontFollow: false,
 glass: {
  preset: 'off',
  main: {fill: 100, blur: 0},
   overlay: {fill: 100, blur: 0},
  control: {fill: 100, blur: 0},
 },
});

// 壁纸上限：数据 URL 以 base64 存在插件 config 分类里，2 MiB 原图约 2.7 MiB 文本。
// 超过就明确拒绝，不静默截断。
export const WALLPAPER_LIMIT = 2 * 1024 * 1024;
const WALLPAPER_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const WALLPAPER_MAX_BYTES_TEXT = Math.ceil(WALLPAPER_LIMIT * 4 / 3) + 64;

// 字体颜色：正文与次要两档，空串表示跟随主题。只认 #rrggbb。
const HEX = /^#[0-9a-fA-F]{6}$/;
export const FONT_KEYS = ['text', 'dim'];

export function isColor(value) {
  return typeof value === 'string' && HEX.test(value.trim());
}

export function colorPair(raw) {
  const out = {text: '', dim: ''};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of FONT_KEYS) if (isColor(raw[key])) out[key] = raw[key].trim().toLowerCase();
  return out;
}
const clamp = (value, low, high, fallback) => {
 const n = Number(value);
 if (!Number.isFinite(n)) return fallback;
 return Math.min(high, Math.max(low, Math.round(n)));
};

// regionOf 把任意输入收成一个合法的 {fill, blur}。
export function regionOf(value, fallback) {
 const base = fallback || {fill: 100, blur: 0};
 if (!value || typeof value !== 'object' || Array.isArray(value)) return {...base};
 return {
  fill: clamp(value.fill, 0, 100, base.fill),
  blur: clamp(value.blur, 0, 40, base.blur),
 };
}

// isWallpaper 判断一个数据 URL 是否是允许的图片，且不超上限。
export function isWallpaper(value) {
 if (typeof value !== 'string' || !value) return false;
 if (value.length > WALLPAPER_MAX_BYTES_TEXT) return false;
 const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if (!match) return false;
 if (!WALLPAPER_TYPES.includes(match[1])) return false;
 return match[2].length > 0;
}

// presetOf 找出这组坐标落在哪个预设上；不在任何预设上就是 custom。
export function presetOf(glass) {
 for (const [name, shape] of Object.entries(GLASS_PRESETS)) {
  if (!shape) continue;
  if (GLASS_REGIONS.every((r) => glass[r].fill === shape[r][0] && glass[r].blur === shape[r][1])) return name;
 }
 return 'custom';
}

// normalize 把磁盘上读到的（可能是旧版本、可能被手改坏的）外观收成合法状态。
// 它绝不抛错：Clash 的页面不能因为一份坏配置就打不开。
export function normalize(raw) {
 const out = {
  schema: 1,
  wallpaper: '',
  veil: 40,
  font: {text: '', dim: ''},
  fontDark: {text: '', dim: ''},
  fontDarkOn: false,
  fontFollow: false,
  glass: {
   preset: 'off',
   main: {...DEFAULT_APPEARANCE.glass.main},
    overlay: {...DEFAULT_APPEARANCE.glass.overlay},
   control: {...DEFAULT_APPEARANCE.glass.control},
  },
 };
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
 if (isWallpaper(raw.wallpaper)) out.wallpaper = raw.wallpaper;
 out.font = colorPair(raw.font);
 out.fontDark = colorPair(raw.fontDark);
 out.fontDarkOn = raw.fontDarkOn === true;
 out.fontFollow = raw.fontFollow === true;
 out.veil = clamp(raw.veil, 0, 95, 40);
 const glass = raw.glass && typeof raw.glass === 'object' && !Array.isArray(raw.glass) ? raw.glass : {};
 for (const region of GLASS_REGIONS) out.glass[region] = regionOf(glass[region], out.glass[region]);
 // 预设先认显式 follow（跟随 Dock 宿主），再认命名坐标与反推：坐标是唯一的真相，预设只是它的名字。
 const named = GLASS_PRESETS[glass.preset];
 if (glass.preset === 'follow') {
  out.glass.preset = 'follow';
 } else if (named && GLASS_REGIONS.every((r) => out.glass[r].fill === named[r][0] && out.glass[r].blur === named[r][1])) {
  out.glass.preset = glass.preset;
 } else {
  out.glass.preset = presetOf(out.glass);
 }
 return out;
}

// withPreset 生成某个预设下的完整外观（保留壁纸与遮挡度）。
export function withPreset(appearance, name) {
 if (name === 'follow') {
  const next = normalize(appearance);
  next.glass.preset = 'follow';
  return next;
 }
 const shape = GLASS_PRESETS[name];
 if (!shape) return appearance;
 const next = normalize(appearance);
 for (const region of GLASS_REGIONS) next.glass[region] = {fill: shape[region][0], blur: shape[region][1]};
 next.glass.preset = name;
 return next;
}

// patch 是页面提交的增量：只认白名单里的字段，逐项收口后再合并。
// 壁纸单独一条命令走（体积大、要明确成功或失败），这里不接受。
// 预设名会在「该区域没有显式坐标」时展开成坐标——页面点预设按钮只报名字；
// 同一个请求里既报名字又带坐标时，坐标赢（滑块拖过的地方不会被预设盖掉）。
export function patch(appearance, change) {
 const next = normalize(appearance);
 if (!change || typeof change !== 'object' || Array.isArray(change)) return next;
 if (change.veil !== undefined) next.veil = clamp(change.veil, 0, 95, next.veil);
 if (change.font !== undefined) next.font = colorPair({...next.font, ...(change.font && typeof change.font === 'object' ? change.font : {})});
 if (change.fontDark !== undefined) next.fontDark = colorPair({...next.fontDark, ...(change.fontDark && typeof change.fontDark === 'object' ? change.fontDark : {})});
 if (change.fontDarkOn !== undefined) next.fontDarkOn = change.fontDarkOn === true;
 if (change.fontFollow !== undefined) next.fontFollow = change.fontFollow === true;
 const g = change.glass && typeof change.glass === 'object' && !Array.isArray(change.glass) ? change.glass : null;
 if (g) {
  const hasRegion = GLASS_REGIONS.some((r) => g[r] !== undefined);
  if (g.preset === 'follow' && !hasRegion) {
   next.glass.preset = 'follow';
   return next;
  }
  const named = typeof g.preset === 'string' ? GLASS_PRESETS[g.preset] : null;
  if (named) for (const region of GLASS_REGIONS) {
   if (g[region] === undefined) next.glass[region] = {fill: named[region][0], blur: named[region][1]};
  }
  for (const region of GLASS_REGIONS) {
   if (g[region] !== undefined) next.glass[region] = regionOf(g[region], next.glass[region]);
  }
  // 预设名永远由坐标反推：坐标是唯一的真相，名字只是它的一个标签。
  next.glass.preset = presetOf(next.glass);
 }
 return next;
}

// resolveDockGlass 把 FISH Dock 宿主下发的 theme 快照映射成 Clash 三区域坐标。
export function resolveDockGlass(dockTheme) {
 const g = dockTheme?.appearance?.glass;
 const enabled = !!(g?.enabled || dockTheme?.dockMode === 'glass');
 if (!enabled) {
  return {enabled: false, main: {fill: 100, blur: 0}, overlay: {fill: 100, blur: 0}, control: {fill: 100, blur: 0}};
 }
 return {
  enabled: true,
  main: {fill: clamp(g?.cardOp, 0, 100, 22), blur: clamp(g?.cardBlur, 0, 40, 12)},
  overlay: {fill: clamp(g?.overlayOp, 0, 100, 45), blur: clamp(g?.overlayBlur, 0, 40, 16)},
  control: {fill: clamp(g?.controlOp, 0, 100, 28), blur: clamp(g?.controlBlur, 0, 40, 8)},
 };
}

// cssVars 把外观摊成 CSS 自定义属性，页面与测试共用同一份换算。
export function cssVars(appearance) {
 const a = normalize(appearance);
 const vars = {
  '--g-veil': a.veil + '%',
  '--g-font-text': a.font.text,
  '--g-font-dim': a.font.dim,
  '--g-wall': a.wallpaper ? `url("${a.wallpaper}")` : 'none',
 };
 for (const region of GLASS_REGIONS) {
  vars[`--g-${region}-fill`] = a.glass[region].fill + '%';
  vars[`--g-${region}-blur`] = a.glass[region].blur + 'px';
 }
 return vars;
}

// glassOn 说明这三个区域里有没有任何一个真的在「玻璃」状态。
// 页面用它决定要不要显示「当前为不透明外观」的提示。
export function glassOn(appearance) {
 const a = normalize(appearance);
 return GLASS_REGIONS.some((r) => a.glass[r].fill < 100 || a.glass[r].blur > 0);
}










