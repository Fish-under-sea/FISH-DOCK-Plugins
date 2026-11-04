import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeManifest} from './page-seed.mjs';

// 出厂预装的社区供应商插件（#11 的预装基线）。包名与顺序以插件页的显示为准：
// 上游把内置订阅陆续交给 @magpie-community 的插件承载，这些包不在 magpie 本体里。
// 宿主每次拉起 magpie 时按「当前基线 − 已登记」增量补登记（#71）：基线新增的
// （2.1.4 才进来的 Meoo）会补上；用户自己停用或移除的、以及已对齐过的，不会加
// 回来。上游的更新循环发现「plugins.json 里有 spec、plugins/ 下没有这个
// 包」时会按 spec 自动安装（internal/plugin/plugin_missing_test.go 的
// TestMissingPluginsInstalledAgain），所以这里只写包名：不下载、不占插件包体积，
// 登记完由 magpie 自己装，失败下次再试。
//
// 每条是 [stem, 显示名] 或 [stem, 显示名, 显式规格]。缺第三条时按
// @magpie-community/opencode-<stem>-auth 拼；不在这条命名规则里的插件（Meoo 就是）
// 用第三条 {package, spec} 写明：package 是「算不算同一个包」的键，spec 是真正
// 写进 plugins.json 的安装串（npm 包名或 git 仓库都行）。
//
// `zen-free`（OpenCode Zen Free）本版**移出**预装基线：新装环境不再自动登记它，
// 已装用户不动——不卸载、不禁用、不删数据；它的品牌图标素材也照旧保留（已装用户
// 还有这个 provider，图标接管按 provider 生效）。
const BASELINE = [
 ['raccoon', '商汤小浣熊'],
 ['autoclaw', 'AutoClaw'],
 ['cline', 'Cline'],
 ['codearts', 'CodeArts / OfficeAce'],
 ['kiro', 'Kiro'],
 ['loomy', 'Loom'],
 ['meoo-agent', 'Meoo 秒悟（建站 Agent）', {
  // npm 上查不到这个包：主仓 package.json 是 private，没有发布（registry 404）。
  // 上游主仓是 RexVane/magpie-plugin-meoo-agent，所以按 git spec 装；
  // 它哪天发了 npm 包，把 spec 换成 'magpie-plugin-meoo-agent@latest' 即可，
  // package 不用动（那是同一个包的身份）。
  package: 'magpie-plugin-meoo-agent',
  spec: 'github:RexVane/magpie-plugin-meoo-agent',
 }],
 ['minimax', 'MiniMax Code'],
 ['qoder', 'Qoder'],
 ['trae', 'Trae'],
 ['workbuddy', 'WorkBuddy'],
 ['mimo', 'Xiaomi MiMo'],
 ['zcode', 'ZCode'],
];

// 拼缺省包名用的两条正则，放在 PREINSTALLED 之前：那份清单在模块初始化时就
// 要按这条规则算包名，正则晚一步声明会踩 TDZ。
const SCOPED = /^(@[^/@]+\/[^/@]+)(?:@[^/]*)?$/;
const PLAIN = /^([^/@]+)(?:@[^/]*)?$/;

export const PREINSTALLED = Object.freeze(BASELINE.map(([stem, name, given]) => {
 const spec = given?.spec ?? `@magpie-community/opencode-${stem}-auth@latest`;
 // 两元素的旧条目走的仍是同一条拼名规则，产物逐字节不变。
 const pkg = given?.package ?? packageOf(spec);
 return Object.freeze({stem, name, package: pkg, spec});
}));

// 预装登记的开关：0 关掉。留出口是给测试与「我只想要干净 magpie」的用户。
export function preinstallEnabled(env = process.env) {
 return env.FISH_DOCK_MAGPIE_PREINSTALL !== '0';
}

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
 // 已经写在那里的安装串也记一份：git spec 的包名算不出来（packageOf 认不得
 // github:owner/repo），只有整串相同才算「同一个包已经登记过」。
 const specs = new Set();
 for (const entry of manifest.plugins) {
  if (!entry || typeof entry !== 'object') continue;
  if (typeof entry.spec === 'string' && entry.spec.trim()) specs.add(entry.spec.trim());
  const name = packageOf(entry.spec);
  if (name) have.add(name);
 }
 const added = [];
 for (const item of packages) {
  if (have.has(item.package) || specs.has(item.spec)) continue;
  have.add(item.package);
  manifest.plugins.push({spec: item.spec});
  added.push(item.package);
 }
 if (!added.length) return {changed: false, text, added};
 return {changed: true, text: JSON.stringify(manifest, null, 2) + '\n', added};
}

// 登记完成就留标记（#71 起带 baseline）：marker 记下「上次登记对齐到哪份基线」，
// 下次启动只对差集补登记；无差集时连 plugins.json 都不读不写。旧版 marker 只有
// registered——按「基线为空」处理，全部当前项算差集。写失败下次重来。
export const markerName = '.fish-dock-preinstalled.json';

// 读 marker，宽容旧格式与坏 JSON：认不出的内容一律当「没有对齐记录」，
// 让差集退化为全量补登记（addPreinstalled 幂等，只会补缺席的），不抛错。
export async function readPreinstallMarker(data) {
  if (typeof data !== 'string' || !data) return {baseline: [], legacy: true};
  let text;
  try {
    text = await fs.readFile(path.join(data, markerName), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null; // 没写过 marker：全新环境。
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  // schema 2 起才有 baseline；旧格式（schema 1，只有 registered）、非对象、
  // 坏 JSON 都按「基线为空」处理。
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.baseline)) {
    return {baseline: [], legacy: true};
  }
  const baseline = [];
  for (const value of parsed.baseline) {
    if (typeof value === 'string' && value.trim()) baseline.push(value.trim());
  }
  return {baseline, legacy: false};
}

// #16：把「已登记哪几家、登记于何时」落成一份可读的状态文件。它不假装知道
// 安装进度——那要装完才知道（上游的更新循环在后台按 npm spec 装）——但它给
// 页面/日志一个可判定的起点：这份清单存在，就说明首启登记已经发生，剩下的
// 只是等这 13 个包被装上。放在 config/ 下，跟 gateway.json 同一层。
export const stateRelativePath = 'config/preinstall-state.json';
export function preinstallStateFile(data) {
 return path.join(data, stateRelativePath);
}

// pendingStems 是「登记了但还没出现在 providers 里」的还差几家。纯函数：
// 调用方给已装的 provider id（或 stems），它只做集合差，不猜、不编。
export function pendingStems({packages = PREINSTALLED, installed = []} = {}) {
 const have = new Set((installed || []).map((value) => String(value)));
 return packages.filter((item) => !have.has(item.stem)).map((item) => item.stem);
}

export async function recordPreinstallState({data, registered = [], added = [], at = new Date()} = {}) {
 if (typeof data !== 'string' || !data) return '';
 const file = preinstallStateFile(data);
 const body = JSON.stringify({
  schema: 1,
  status: 'registered',
  registeredAt: at instanceof Date ? at.toISOString() : String(at),
  registered,
  added,
 }, null, 2) + '\n';
 await fs.mkdir(path.dirname(file), {recursive: true});
 const temporary = `${file}.${randomUUID()}.tmp`;
 try {
  await fs.writeFile(temporary, body, {mode: 0o600});
  await fs.rename(temporary, file);
 } finally {
  await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
 }
 return file;
}

export async function readPreinstallState({data} = {}) {
 if (typeof data !== 'string' || !data) return null;
 try {
  return JSON.parse(await fs.readFile(preinstallStateFile(data), 'utf8'));
 } catch (error) {
  if (error.code === 'ENOENT') return null;
  throw error;
 }
}

// ensurePreinstallState 是启动时补那一次写：登记有 marker 兜底（按基线增量补），
// 状态文件却是每次启动都可能缺的——清过、写到一半、或者登记发生在 2.1.3 之前
// （那时还没有这份文件）。缺了就在这里补一份，让 host 的 brand:status 有据可查
// （「正在准备 N 个供应商插件」的 N 由 Go 侧按真实安装算，这里只负责让登记名单在）。
// 已经有就什么都不做：不刷 registeredAt，也不改已经写下的 added。
// registered/added 取 seedPreinstalled 的实际结果（#71）：seeded 为 null（拿不到
// 本次登记结果的老路径）才退回按基线推导；seeded.registered 是空数组属于真实
// 情况（清单里一家都没有），照实写，不再拿基线顶上。
export async function ensurePreinstallState({data, seeded = null, at = new Date()} = {}) {
 if (typeof data !== 'string' || !data) return null;
 if (await readPreinstallState({data})) return null;
 const registered = seeded?.registered ?? PREINSTALLED.map((item) => item.package);
 return recordPreinstallState({data, registered, added: seeded?.added ?? [], at});
}

// registeredFrom（#71）：从 plugins.json 的原文算「基线里真正登记在案」的包名。
// 命中口径与 addPreinstalled 一致——npm 包名匹配，或整串 spec 相同（git spec 算不出
// 包名，只能按整串比）。清单读不出来（不存在/空/坏 JSON）时按「一个都没有」算，
// 不抛错：registered 宁可少报也不编造。
export function registeredFrom(raw, packages = PREINSTALLED) {
  let manifest = null;
  try {
    const body = String(raw ?? '').replace(/^\uFEFF/, '');
    manifest = body.trim() ? JSON.parse(body) : null;
  } catch {
    manifest = null;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.plugins)) return [];
  const seen = new Set();
  for (const entry of manifest.plugins) {
    if (!entry || typeof entry !== 'object' || typeof entry.spec !== 'string' || !entry.spec.trim()) continue;
    seen.add(entry.spec.trim());
    const name = packageOf(entry.spec);
    if (name) seen.add(name);
  }
  return packages
    .filter((item) => seen.has(item.package) || seen.has(item.spec))
    .map((item) => item.package);
}

export async function seedPreinstalled({data, packages = PREINSTALLED, onPhase = () => {}, signal} = {}) {
 const markerFile = path.join(data, markerName);
 // #71：登记不再是「见 marker 即跳过」。marker 里记的是上次对齐的基线 spec，
 // 与当前基线求差集：差集为空 → 什么都不写（marker mtime 不变，只读清单把
 // registered 说真话）；有差集（基线新增，或旧格式 marker）→ 只补差集；用户删过、
 // 又不在当前基线里的项（比如 zen-free）从头到尾不在待补名单里，不会被卸载或改写。
 const marker = await readPreinstallMarker(data);
 const baseline = marker ? new Set(marker.baseline) : null;
 const pending = baseline ? packages.filter((item) => !baseline.has(item.spec)) : packages;
 const file = path.join(data, 'plugins.json');
 let raw;
 try {
  raw = await fs.readFile(file, 'utf8');
 } catch (error) {
  if (error.code !== 'ENOENT') throw error;
 }
 if (!pending.length) {
  return {skipped: true, added: [], registered: registeredFrom(raw, packages)};
 }
 const next = addPreinstalled({raw, packages: pending});
 if (next.changed) {
  onPhase('prepare-data');
  signal?.throwIfAborted();
  await writeManifest(file, next.text, signal);
 }
 signal?.throwIfAborted();
 // registered 说真话（#71）：按补登记后的 plugins.json 实际内容算——基线里哪几家
 // 真的在清单里（包名或整串 spec 命中）就记谁，用户删掉的不记，不再由基线推导。
 const registered = registeredFrom(next.text, packages);
 const record = JSON.stringify({
  schema: 2,
  baseline: packages.map((item) => item.spec),
  registered,
 }, null, 2) + '\n';
 if (marker) {
  // marker 已在（旧格式，或基线又变了）：原子换成新内容，升级到 schema 2。
  // 两个实例并发换的内容一致，rename 各自原子，谁先落都一样。
  const temporary = `${markerFile}.${randomUUID()}.tmp`;
  try {
   await fs.writeFile(temporary, record, {mode: 0o600});
   await fs.rename(temporary, markerFile);
  } finally {
   await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
 } else try {
  await fs.writeFile(markerFile, record, {flag: 'wx', mode: 0o600});
 } catch (error) {
  // 另一个实例抢先把同一份登记写完：结果一致，按成功处理。
  if (error.code !== 'EEXIST') throw error;
 }
 // 状态文件写失败不拦启动：它只是可见性，登记本身已经落盘了。
 try {
  signal?.throwIfAborted();
  await recordPreinstallState({data, registered, added: next.added});
 } catch (error) {
  if (error.name === 'AbortError') throw error;
 }
 return {skipped: false, added: next.added, registered};
}