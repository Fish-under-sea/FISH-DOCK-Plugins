import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 GLASS_REGIONS, GLASS_PRESETS, DEFAULT_APPEARANCE, WALLPAPER_MAX_BYTES_TEXT,
 regionOf, isWallpaper, presetOf, normalize, withPreset, patch, cssVars, glassOn, resolveDockGlass,
} from './appearance.mjs';
import {readAppearance, savePatch, saveWallpaper} from './appearance-store.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// 假 storage：与宿主 storage 同签名（read/write 分类 + 名字），坏 JSON 也能构造。
function fakeStorage(initial) {
 const files = new Map(initial ? Object.entries(initial) : []);
 return {
  files,
  async read(category, name) {
   const key = `${category}/${name}`;
   return files.has(key) ? files.get(key) : null;
  },
  async write(category, name, value) {
   files.set(`${category}/${name}`, value);
  },
 };
}

test('默认外观是实底：三个区域都是 100% / 0px，壁纸与遮挡为空', () => {
 const a = normalize(undefined);
 for (const region of GLASS_REGIONS) assert.deepEqual(a.glass[region], {fill: 100, blur: 0});
 assert.equal(a.wallpaper, '');
 assert.equal(a.veil, 40);
 assert.equal(a.glass.preset, 'off');
 assert.equal(glassOn(a), false);
 assert.deepEqual(DEFAULT_APPEARANCE.glass.main, {fill: 100, blur: 0});
});

test('regionOf 夹住越界值（0 是合法不透明度），坏输入回落而不是抛错', () => {
 assert.deepEqual(regionOf({fill: 5, blur: 999}), {fill: 5, blur: 40});
 assert.deepEqual(regionOf({fill: 999, blur: -3}), {fill: 100, blur: 0});
 for (const bad of [null, undefined, 'x', 42, [], {fill: 'abc', blur: null}]) {
  assert.deepEqual(regionOf(bad), {fill: 100, blur: 0}, String(bad));
 }
 assert.deepEqual(regionOf({fill: 77.6, blur: 12.4}), {fill: 78, blur: 12});
});

test('isWallpaper 只收允许的图片类型与体积', () => {
 assert.equal(isWallpaper(PNG), true);
 for (const type of ['image/jpeg', 'image/gif', 'image/webp']) {
  assert.equal(isWallpaper(`data:${type};base64,AAAA`), true, type);
 }
 for (const bad of ['', null, undefined, 'not a url', 'data:image/svg+xml;base64,AAAA',
  'data:text/plain;base64,AAAA', 'data:image/png;base64,', 'data:image/png,AAAA',
  'https://example.com/a.png']) {
  assert.equal(isWallpaper(bad), false, String(bad));
 }
 // 超过上限的文本长度必须被拒（不是静默截断）
 assert.equal(isWallpaper(`data:image/png;base64,${'A'.repeat(WALLPAPER_MAX_BYTES_TEXT)}`), false);
});

test('presetOf 按坐标反推预设，坐标不符就是自定义', () => {
 assert.equal(presetOf(normalize(undefined).glass), 'off');
 assert.equal(presetOf(withPreset(null, 'light').glass), 'light');
 assert.equal(presetOf(withPreset(null, 'balanced').glass), 'balanced');
 const odd = normalize({glass: {main: {fill: 71, blur: 9}}});
 assert.equal(odd.glass.preset, 'custom');
 assert.equal(presetOf(odd.glass), 'custom');
});

test('normalize 认预设名，但以坐标为准：坐标不符时名字重算，不会盖掉滑块', () => {
 // 报 balanced，坐标却只有 main 的 60/3：其余区域沿用默认 100/0，
 // 三区域合起来不落在任何预设上，所以名字是 custom；main 的坐标原样保留。
 const a = normalize({glass: {preset: 'balanced', main: {fill: 60, blur: 3}}});
 assert.equal(a.glass.preset, 'custom');
 assert.deepEqual(a.glass.main, {fill: 60, blur: 3});
 // 坐标恰好等于某个预设时，名字就是那个预设（名字与坐标永远一致）
 assert.equal(normalize({glass: {preset: 'balanced'}}).glass.preset, 'off');
});

test('withPreset 只换玻璃坐标，保留壁纸与遮挡', () => {
 const base = normalize({wallpaper: PNG, veil: 40});
 const next = withPreset(base, 'balanced');
 assert.equal(next.wallpaper, PNG);
 assert.equal(next.veil, 40);
 assert.deepEqual(next.glass.main, {fill: 60, blur: 22}); // 均衡：主界面要真的透出来
 assert.equal(next.glass.preset, 'balanced');
 // 未知预设名原样返回，不改坏
 assert.equal(withPreset(base, 'nope').glass.preset, 'off');
});

test('patch 只收白名单字段，壁纸必须走单独那条命令', () => {
 const base = normalize(undefined);
 const a = patch(base, {veil: 30, glass: {main: {fill: 60, blur: 10}}});
 assert.equal(a.veil, 30);
 assert.deepEqual(a.glass.main, {fill: 60, blur: 10});
 assert.equal(a.glass.preset, 'custom');
 // 去掉 main 的玻璃即回到实底
 const b = patch(a, {glass: {main: {fill: 100, blur: 0}}});
 assert.equal(glassOn(b), false);
 // 壁纸字段被忽略（体积大、要明确成功/失败，不在增量里）
 assert.equal(patch(base, {wallpaper: PNG}).wallpaper, '');
 assert.equal(patch(base, {veil: 999}).veil, 95);
 assert.equal(patch(base, null).veil, 40);
});

test('cssVars 摊出三个区域与遮挡，壁纸缺省为 none', () => {
 const vars = cssVars(normalize({veil: 50, glass: {control: {fill: 88, blur: 12}}}));
 assert.equal(vars['--g-veil'], '50%');
 assert.equal(vars['--g-control-fill'], '88%');
 assert.equal(vars['--g-control-blur'], '12px');
 assert.equal(vars['--g-main-fill'], '100%');
 assert.equal(vars['--g-wall'], 'none');
 assert.equal(cssVars(normalize({wallpaper: PNG}))['--g-wall'], `url("${PNG}")`);
});

test('存取：缺配置与坏 JSON 都回落默认，不抛错', async () => {
 assert.equal((await readAppearance(fakeStorage())).glass.preset, 'off');
 assert.equal((await readAppearance(fakeStorage({'config/appearance.json': '{broken'}))).veil, 40);
 assert.equal((await readAppearance(fakeStorage({'config/appearance.json': '[]'}))).veil, 40);
 const a = await readAppearance(fakeStorage({'config/appearance.json': JSON.stringify({veil: 12, glass: {main: {fill: 70, blur: 8}}})}));
 assert.equal(a.veil, 12);
 assert.deepEqual(a.glass.main, {fill: 70, blur: 8});
});

test('存取：保存增量与壁纸都落到 config/appearance.json', async () => {
 const storage = fakeStorage();
 const saved = await savePatch(storage, {glass: {preset: 'light'}});
 assert.equal(saved.glass.preset, 'light');
 const onDisk = JSON.parse(storage.files.get('config/appearance.json'));
 assert.equal(onDisk.glass.control.fill, 86); // 轻透：控件 94/6

 const withWall = await saveWallpaper(storage, {data: PNG});
 assert.equal(withWall.wallpaper, PNG);
 assert.equal(JSON.parse(storage.files.get('config/appearance.json')).wallpaper, PNG);

 const cleared = await saveWallpaper(storage, {remove: true});
 assert.equal(cleared.wallpaper, '');
 // 清壁纸不动玻璃与遮挡
 assert.equal(cleared.glass.preset, 'light');
});

test('存取：非法壁纸报 APPEARANCE_WALLPAPER_INVALID，且不写坏配置', async () => {
 const storage = fakeStorage();
 await saveWallpaper(storage, {data: PNG});
 const before = storage.files.get('config/appearance.json');
 await assert.rejects(saveWallpaper(storage, {data: 'data:image/svg+xml;base64,AAAA'}), (e) => e.code === 'APPEARANCE_WALLPAPER_INVALID');
 await assert.rejects(saveWallpaper(storage, {data: `data:image/png;base64,${'A'.repeat(WALLPAPER_MAX_BYTES_TEXT)}`}), (e) => e.code === 'APPEARANCE_WALLPAPER_INVALID');
 assert.equal(storage.files.get('config/appearance.json'), before);
});

test('存取：写失败报 APPEARANCE_SAVE_FAILED，并保留原始 cause', async () => {
 const storage = fakeStorage();
 storage.write = async () => { throw Object.assign(new Error('EACCES'), {code: 'EACCES'}); };
 await assert.rejects(savePatch(storage, {veil: 20}), (e) => e.code === 'APPEARANCE_SAVE_FAILED' && e.cause?.code === 'EACCES');
});














test('follow 预设保持独立状态并在滑块或预设切换后退出 follow', () => {
 const base = normalize({
  glass: { preset: 'follow', main: { fill: 84, blur: 10 }, overlay: { fill: 92, blur: 16 }, control: { fill: 88, blur: 8 } },
 });
 assert.equal(base.glass.preset, 'follow');
 assert.equal(base.glass.main.fill, 84);

 const keptFollow = patch(normalize({}), { glass: { preset: 'follow' } });
 assert.equal(keptFollow.glass.preset, 'follow');
 assert.deepEqual(keptFollow.glass.main, DEFAULT_APPEARANCE.glass.main);

 const sliderOut = patch(base, { glass: { main: { fill: 55, blur: 10 } } });
 assert.equal(sliderOut.glass.preset, 'custom');
 assert.equal(sliderOut.glass.main.fill, 55);

 const presetOut = patch(base, { glass: { preset: 'balanced' } });
 assert.equal(presetOut.glass.preset, 'balanced');
});

test('fontDark / fontDarkOn / fontFollow 白名单标准化与增量补丁', () => {
 const next = patch(DEFAULT_APPEARANCE, {
  fontDark: { text: '#ffffff', dim: 'invalid' },
  fontDarkOn: true,
  fontFollow: true,
 });
 assert.deepEqual(next.fontDark, { text: '#ffffff', dim: '' });
 assert.equal(next.fontDarkOn, true);
 assert.equal(next.fontFollow, true);

 const off = patch(next, { fontFollow: false, fontDarkOn: false });
 assert.equal(off.fontFollow, false);
 assert.equal(off.fontDarkOn, false);
 assert.equal(off.fontDark.text, '#ffffff');
});

test('resolveDockGlass 把 Dock theme 快照映射到 Clash 三区域并在关闭时回落实底', () => {
 const on = resolveDockGlass({
  dockMode: 'glass',
  appearance: { glass: { enabled: true, cardOp: 30, cardBlur: 18, overlayOp: 50, overlayBlur: 20, controlOp: 40, controlBlur: 10 } },
 });
 assert.deepEqual(on, {
  enabled: true,
  main: { fill: 30, blur: 18 },
  overlay: { fill: 50, blur: 20 },
  control: { fill: 40, blur: 10 },
 });
 const off = resolveDockGlass({ dockMode: 'dark', appearance: { glass: { enabled: false, cardOp: 20, cardBlur: 12 } } });
 assert.deepEqual(off, {
  enabled: false,
  main: { fill: 100, blur: 0 },
  overlay: { fill: 100, blur: 0 },
  control: { fill: 100, blur: 0 },
 });
});
