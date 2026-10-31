import fs from 'node:fs/promises';
import path from 'node:path';
import {writeManifest} from './page-seed.mjs';

// 出厂预装的社区供应商插件（#11 的预装基线）。包名与顺序以插件页的显示为准：
// 上游把内置订阅陆续交给 @magpie-community 的插件承载，这些包不在 magpie 本体里。
// 宿主只在第一次拉起 magpie 时登记它们，之后不再插手——用户自己停用或移除的，
// 不会被加回来。上游的更新循环发现「plugins.json 里有 spec、plugins/ 下没有这个
// 包」时会按 spec 自动安装（internal/plugin/plugin_missing_test.go 的
// TestMissingPluginsInstalledAgain），所以这里只写包名：不下载、不占插件包体积，
// 首次启动由 magpie 自己装，失败下次再试。
const BASELINE = [
 ['raccoon', '商汤小浣熊'],
 ['autoclaw', 'AutoClaw'],
 ['cline', 'Cline'],
 ['codearts', 'CodeArts / OfficeAce'],
 ['kiro', 'Kiro'],
 ['loomy', 'Loom'],
 ['minimax', 'MiniMax Code'],
 ['zen-free', 'OpenCode Zen Free'],
 ['qoder', 'Qoder'],
 ['trae', 'Trae'],
 ['workbuddy', 'WorkBuddy'],
 ['mimo', 'Xiaomi MiMo'],
 ['zcode', 'ZCode'],
];

export const PREINSTALLED = Object.freeze(BASELINE.map(([stem, name]) => Object.freeze({
 stem,
 name,
 package: `@magpie-community/opencode-${stem}-auth`,
 spec: `@magpie-community/opencode-${stem}-auth@latest`,
})));

// 预装登记的开关：0 关掉。留出口是给测试与「我只想要干净 magpie」的用户。
export function preinstallEnabled(env = process.env) {
 return env.FISH_DOCK_MAGPIE_PREINSTALL !== '0';
}

const SCOPED = /^(@[^/@]+\/[^/@]+)(?:@[^/]*)?$/;
const PLAIN = /^([^/@]+)(?:@[^/]*)?$/;

// npm spec 的包名：@scope/name@1.2.3 → @scope/name，name@1.2.3 → name。
// git spec 与绝对路径返回空串——那不是这些包，宁可当「不匹配」也不误改。
export function packageOf(spec) {
 if (typeof spec !== 'string') return '';
 const text = spec.trim();
 if (!text || path.isAbsolute(text)) return '';
 const scoped = SCOPED.exec(text);
 if (scoped) return scoped[1];
 const plain = PLAIN.exec(text);
 return plain ? plain[1] : '';
}

// plugins.json 只由结构相同的 {spec,off,options} 条目组成。已有同名包的条目
// 一律保留原样（连用户写死的版本号也不动），只补缺席的包。
export function addPreinstalled({raw, packages = PREINSTALLED} = {}) {
 const hasRaw = raw !== undefined && raw !== null;
 const text = hasRaw ? String(raw) : '';
 const body = text.replace(/^\uFEFF/, '');
 let manifest;
 if (body.trim()) manifest = JSON.parse(body);
 else manifest = {plugins: []};
 if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.plugins)) throw Error('plugins.json 结构无效');
 const have = new Set();
 for (const entry of manifest.plugins) {
  if (!entry || typeof entry !== 'object') continue;
  const name = packageOf(entry.spec);
  if (name) have.add(name);
 }
 const added = [];
 for (const item of packages) {
  if (have.has(item.package)) continue;
  have.add(item.package);
  manifest.plugins.push({spec: item.spec});
  added.push(item.package);
 }
 if (!added.length) return {changed: false, text, added};
 return {changed: true, text: JSON.stringify(manifest, null, 2) + '\n', added};
}

// 登记过一次就留标记：之后无论 plugins.json 怎么变（用户移除、装回别的版本），
// 这里都不再动手。标记只认「登记完成」，写失败下次重来。
export const markerName = '.fish-dock-preinstalled.json';

export async function seedPreinstalled({data, packages = PREINSTALLED, onPhase = () => {}, signal} = {}) {
 const marker = path.join(data, markerName);
 try {
  await fs.stat(marker);
  return {skipped: true, added: []};
 } catch (error) {
  if (error.code !== 'ENOENT') throw error;
 }
 const file = path.join(data, 'plugins.json');
 let raw;
 try {
  raw = await fs.readFile(file, 'utf8');
 } catch (error) {
  if (error.code !== 'ENOENT') throw error;
 }
 const next = addPreinstalled({raw, packages});
 if (next.changed) {
  onPhase('prepare-data');
  signal?.throwIfAborted();
  await writeManifest(file, next.text, signal);
 }
 signal?.throwIfAborted();
 const record = JSON.stringify({schema: 1, registered: packages.map(item => item.package)}, null, 2) + '\n';
 try {
  await fs.writeFile(marker, record, {flag: 'wx', mode: 0o600});
 } catch (error) {
  // 另一个实例抢先把同一份登记写完：结果一致，按成功处理。
  if (error.code !== 'EEXIST') throw error;
 }
 return {skipped: false, added: next.added};
}