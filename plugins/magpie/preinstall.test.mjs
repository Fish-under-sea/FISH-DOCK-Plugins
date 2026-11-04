import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PREINSTALLED,addPreinstalled,ensurePreinstallState,markerName,packageOf,pendingStems,preinstallEnabled,preinstallStateFile,readPreinstallState,recordPreinstallState,seedPreinstalled,stateRelativePath} from './preinstall.mjs';

const utf8=file=>fs.readFile(file,'utf8');
async function sandbox(){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-preinstall-'));
 const data=path.join(root,'data');
 await fs.mkdir(data,{recursive:true});
 return {root,data,list:path.join(data,'plugins.json'),marker:path.join(data,markerName)};
}

test('预装基线是 13 家：12 个社区包 + Meoo（不在拼名规则里，带显式 git 规格）',()=>{
 assert.equal(PREINSTALLED.length,13);
 assert.deepEqual(PREINSTALLED.map(item=>item.package),[
  '@magpie-community/opencode-raccoon-auth',
  '@magpie-community/opencode-autoclaw-auth',
  '@magpie-community/opencode-cline-auth',
  '@magpie-community/opencode-codearts-auth',
  '@magpie-community/opencode-kiro-auth',
  '@magpie-community/opencode-loomy-auth',
  'magpie-plugin-meoo-agent',
  '@magpie-community/opencode-minimax-auth',
  '@magpie-community/opencode-qoder-auth',
  '@magpie-community/opencode-trae-auth',
  '@magpie-community/opencode-workbuddy-auth',
  '@magpie-community/opencode-mimo-auth',
  '@magpie-community/opencode-zcode-auth',
 ]);
 for(const item of PREINSTALLED){
  if(item.package==='magpie-plugin-meoo-agent')continue; // 显式规格那条不按 <package>@latest 拼
  assert.equal(item.spec,`${item.package}@latest`,'按 latest 登记，交给上游的更新循环');
 }
 // 页面插件不在这里：它们由 page-seed 以稳定目录登记，走了会变成两条同包条目。
 assert.equal(PREINSTALLED.some(item=>/page-/.test(item.package)),false);
});

// 本版把 zen-free 移出预装基线：新装环境不再自动登记它，已装用户不动（不卸载、
// 不禁用、不删数据）。它的品牌图标素材照旧保留——已装用户还有这个 provider，
// 图标接管按 provider 生效，删素材反而会让 pruneIcons 把图当没人用。
// 素材那一半钉在 Go 的 TestBrandVendorsCoverPreinstalled（fish.9 里，want 含
// 'opencode-zen-free'）：两条测试合起来才是「移出预装 ≠ 删除美化」的完整约束。
test('zen-free 已移出预装基线，但美化素材的名单不动',()=>{
 assert.equal(PREINSTALLED.some(item=>item.stem==='zen-free'),false,'zen-free 不该再登记');
 assert.equal(PREINSTALLED.some(item=>item.package==='@magpie-community/opencode-zen-free-auth'),false);
 assert.equal(PREINSTALLED.some(item=>item.name==='OpenCode Zen Free'),false);
});

// Meoo 秒悟（建站 Agent）：provider id 是 meoo-agent，包名不在
// @magpie-community/opencode-<stem>-auth 这条规则里，且 npm 上没有它
// （主仓 package.json 是 private），所以登记一条显式 git 规格。
test('Meoo 以显式规格登记：package 是身份、spec 是真正装的那串',()=>{
 const meoo=PREINSTALLED.find(item=>item.stem==='meoo-agent');
 assert.ok(meoo,'基线里没有 meoo-agent');
 assert.equal(meoo.name,'Meoo 秒悟（建站 Agent）');
 assert.equal(meoo.package,'magpie-plugin-meoo-agent');
 assert.equal(meoo.spec,'github:RexVane/magpie-plugin-meoo-agent');
 const next=addPreinstalled({raw:undefined});
 const manifest=JSON.parse(next.text);
 assert.equal(manifest.plugins.some(entry=>entry.spec==='github:RexVane/magpie-plugin-meoo-agent'),true,'插件清单里要真的写上这条 git spec');
 // 已经写着这条 git spec 的清单不再补一遍：git spec 算不出包名，只能按整串比。
 const again=addPreinstalled({raw:next.text});
 assert.equal(again.changed,false,'已经登记过的 git spec 不该被重复补');
 assert.equal(again.added.length,0);
});

test('packageOf 只认 npm 包名，git 与绝对路径都不匹配',()=>{
 assert.equal(packageOf('@magpie-community/opencode-qoder-auth@latest'),'@magpie-community/opencode-qoder-auth');
 assert.equal(packageOf('@magpie-community/opencode-qoder-auth@0.2.50'),'@magpie-community/opencode-qoder-auth');
 assert.equal(packageOf('@magpie-community/opencode-qoder-auth'),'@magpie-community/opencode-qoder-auth');
 assert.equal(packageOf('opencode-cline-auth@0.1.11'),'opencode-cline-auth');
 assert.equal(packageOf('opencode-cline-auth'),'opencode-cline-auth');
 assert.equal(packageOf('github:owner/repo'),'');
 assert.equal(packageOf('C:/data/plugins/page-checkin'),'');
 assert.equal(packageOf('/data/plugins/page-checkin'),'');
 assert.equal(packageOf(''),'');
 assert.equal(packageOf(undefined),'');
});

test('清单不存在时写出 13 条，只写 spec，结尾换行',()=>{
 const next=addPreinstalled({raw:undefined});
 assert.equal(next.changed,true);
 assert.equal(next.added.length,13);
 const manifest=JSON.parse(next.text);
 assert.equal(manifest.plugins.length,13);
 assert.deepEqual(manifest.plugins[0],{spec:'@magpie-community/opencode-raccoon-auth@latest'});
 assert.equal(next.text.endsWith('\n'),true,'结尾换行');
 assert.equal(next.text,JSON.stringify({plugins:PREINSTALLED.map(item=>({spec:item.spec}))},null,2)+'\n');
});

test('空清单对象（plugins: []）补齐缺的包',()=>{
 const next=addPreinstalled({raw:'{"plugins":[]}\n'});
 assert.equal(next.changed,true);
 assert.equal(JSON.parse(next.text).plugins.length,13);
});

test('已有同包条目（含写死的版本号）原样保留，不重复登记',()=>{
 const raw=JSON.stringify({plugins:[{spec:'@magpie-community/opencode-qoder-auth@0.2.50',off:false,options:{collapsed:true}}]},null,2)+'\n';
 const next=addPreinstalled({raw});
 assert.equal(next.changed,true);
 assert.equal(next.added.includes('@magpie-community/opencode-qoder-auth'),false,'已有就不加');
 assert.equal(next.added.length,12);
 const manifest=JSON.parse(next.text);
 const qoder=manifest.plugins.filter(entry=>packageOf(entry.spec)==='@magpie-community/opencode-qoder-auth');
 assert.equal(qoder.length,1,'同包只留一条');
 assert.equal(qoder[0].spec,'@magpie-community/opencode-qoder-auth@0.2.50','用户写死的版本号不动');
 assert.deepEqual(qoder[0].options,{collapsed:true},'options 不动');
 assert.equal(qoder[0].off,false);
});

test('用户自己装的本地目录插件与 git 插件不参与匹配，也不会被改写',()=>{
 const raw=JSON.stringify({plugins:[
  {spec:'C:/data/plugins/page-checkin'},
  {spec:'github:owner/repo'},
  {spec:'@magpie-community/page-relay-probe'},
 ]},null,2)+'\n';
 const next=addPreinstalled({raw});
 const manifest=JSON.parse(next.text);
 assert.equal(manifest.plugins[0].spec,'C:/data/plugins/page-checkin');
 assert.equal(manifest.plugins[1].spec,'github:owner/repo');
 assert.equal(manifest.plugins[2].spec,'@magpie-community/page-relay-probe');
 assert.equal(next.added.length,13);
});

test('13 条都在时不算变化，逐字不改清单',()=>{
 const raw=JSON.stringify({plugins:PREINSTALLED.map(item=>({spec:item.spec}))},null,2)+'\n';
 const next=addPreinstalled({raw});
 assert.equal(next.changed,false);
 assert.equal(next.added.length,0);
 assert.equal(next.text,raw);
});

test('plugins.json 结构无效时直接报错，不写出半份清单',()=>{
 assert.throws(()=>addPreinstalled({raw:'{"plugins":{}}'}),/plugins\.json 结构无效/);
 assert.throws(()=>addPreinstalled({raw:'[]'}),/plugins\.json 结构无效/);
 assert.throws(()=>addPreinstalled({raw:'not json'}),/JSON/);
});

test('开关只认 FISH_DOCK_MAGPIE_PREINSTALL=0',()=>{
 assert.equal(preinstallEnabled({}),true);
 assert.equal(preinstallEnabled({FISH_DOCK_MAGPIE_PREINSTALL:'1'}),true);
 assert.equal(preinstallEnabled({FISH_DOCK_MAGPIE_PREINSTALL:'0'}),false);
});

test('首次登记写清单与标记；再跑一次直接跳过，不动磁盘',async()=>{
 const {data,list,marker}=await sandbox();
 const first=await seedPreinstalled({data});
 assert.equal(first.skipped,false);
 assert.equal(first.added.length,13);
 const text=await utf8(list);
 assert.equal(JSON.parse(text).plugins.length,13);
 const record=JSON.parse(await utf8(marker));
 assert.equal(record.schema,2);
 assert.equal(record.registered.length,13);
 const before=(await fs.stat(list)).mtimeMs;
 const second=await seedPreinstalled({data});
 assert.equal(second.skipped,true);
 assert.equal(second.added.length,0);
 assert.equal((await fs.stat(list)).mtimeMs,before,'跳过时不动清单');
});

// #71 起「标记已在」不再等于「什么都不做」：marker 记基线，基线没变时对用户删过
// 的项不补（skipped、不写盘），但 registered 按清单实际内容说真话。
test('基线对齐后：marker 在、用户删过的项不加回来，registered 只报真在清单里的',async()=>{
 const {data,list,marker}=await sandbox();
 await seedPreinstalled({data});
 // 用户删掉 qoder：marker 的基线仍对齐，差集为空 → 不补、不写盘。
 const afterFirst=JSON.parse(await utf8(list));
 afterFirst.plugins=afterFirst.plugins.filter(entry=>entry.spec!=='@magpie-community/opencode-qoder-auth@latest');
 await fs.writeFile(list,JSON.stringify(afterFirst,null,2)+'\n');
 const before=(await fs.stat(list)).mtimeMs;
 const markerBefore=(await fs.stat(marker)).mtimeMs;
 const result=await seedPreinstalled({data});
 assert.equal(result.skipped,true,'基线没变，用户删过的项不加回来');
 assert.equal(result.added.length,0);
 assert.equal((await fs.stat(list)).mtimeMs,before,'不动清单');
 assert.equal((await fs.stat(marker)).mtimeMs,markerBefore,'不动 marker');
 assert.equal(result.registered.length,12,'registered 不含被删的 qoder');
 assert.equal(result.registered.includes('@magpie-community/opencode-qoder-auth'),false);
});

// 老数据根迁移（#71 的核心场景）：2.1.3 的 marker 只有 13 项 registered（没有
// meoo），基线升级后按差集补登记 Meoo，旧条目与用户自己的条目都不动。
test('老 marker（13 项无 meoo）+ 新基线（含 meoo）→ 补登记 meoo 的 git spec',async()=>{
 const {data,list,marker}=await sandbox();
 // 2.1.3 的真实形态：schema 1，registered 里没有 meoo。
 const legacy=PREINSTALLED.filter(item=>item.stem!=='meoo-agent').map(item=>item.package);
 await fs.writeFile(marker,JSON.stringify({schema:1,registered:legacy})+'\n');
 // 那时的 plugins.json：13 减 meoo 家，外加用户自己的本地插件。
 const specs=PREINSTALLED.filter(item=>item.stem!=='meoo-agent').map(item=>({spec:item.spec}));
 specs.push({spec:'C:/data/plugins/page-checkin'});
 await fs.writeFile(list,JSON.stringify({plugins:specs},null,2)+'\n');
 const result=await seedPreinstalled({data});
 assert.equal(result.skipped,false);
 assert.deepEqual(result.added,['magpie-plugin-meoo-agent'],'只补 meoo 一家');
 const manifest=JSON.parse(await utf8(list));
 const meoo=manifest.plugins.filter(entry=>entry.spec==='github:RexVane/magpie-plugin-meoo-agent');
 assert.equal(meoo.length,1,'git spec 写进清单且只有一条');
 assert.equal(manifest.plugins.some(entry=>entry.spec==='C:/data/plugins/page-checkin'),true,'用户自己的条目不动');
 assert.equal(manifest.plugins.length,14);
 // marker 升级到 schema 2，baseline 对齐到当前 13 家基线。
 const record=JSON.parse(await utf8(marker));
 assert.equal(record.schema,2);
 assert.equal(record.baseline.length,13);
 assert.deepEqual(record.baseline,PREINSTALLED.map(item=>item.spec));
 assert.equal(record.registered.length,13,'registered 与清单一致');
 // 再跑一次：基线已对齐 → 幂等，什么都不写。
 const before=(await fs.stat(list)).mtimeMs;
 const markerBefore=(await fs.stat(marker)).mtimeMs;
 const again=await seedPreinstalled({data});
 assert.equal(again.skipped,true);
 assert.equal(again.added.length,0);
 assert.equal((await fs.stat(list)).mtimeMs,before,'重复启动不写清单');
 assert.equal((await fs.stat(marker)).mtimeMs,markerBefore,'重复启动不写 marker');
 const final=JSON.parse(await utf8(list));
 assert.equal(final.plugins.filter(entry=>entry.spec==='github:RexVane/magpie-plugin-meoo-agent').length,1,'spec 不重复');
});

// 旧格式 marker 容忍：坏 JSON、非对象、baseline 缺失都按「基线为空」全量补登记，
// 不抛错；addPreinstalled 幂等，已有条目不会重复。
test('旧格式与坏 marker 都不抛错，按缺字段处理',async()=>{
 for(const bad of ['not json',{'schema':1,'registered':['x']},[1,2],null]){
  // 每种坏 marker 用全新沙箱：老根上 marker 已是 schema 2、清单已齐，测不出退化路径。
  const {data,list}=await sandbox();
  await fs.writeFile(list,JSON.stringify({plugins:[{spec:'@magpie-community/opencode-raccoon-auth@latest'}]},null,2)+'\n');
  await fs.writeFile(path.join(data,markerName),typeof bad==='string'?bad:JSON.stringify(bad));
  const result=await seedPreinstalled({data});
  assert.equal(result.skipped,false,'退化为全量补登记');
  assert.equal(result.added.length,12,'已登记的 raccoon 不重复，补其余 12 家');
  const manifest=JSON.parse(await utf8(list));
  assert.equal(manifest.plugins.length,13,'补齐后正好 13 条');
  const record=JSON.parse(await utf8(path.join(data,markerName)));
  assert.equal(record.schema,2,'补登记后 marker 升级到 schema 2');
 }
});

// #71 S3：状态文件说真话。registered 是补登记后清单里真正在案的包，added 是本次
// 实际补上的；不再是「拿基线抄一遍」。
test('状态文件的 registered/added 取实际登记结果，与 plugins.json 一致',async()=>{
 const {data,list,marker}=await sandbox();
 // 老根：12 家已在（无 meoo），走一次补登记。
 const specs=PREINSTALLED.filter(item=>item.stem!=='meoo-agent').map(item=>({spec:item.spec}));
 await fs.writeFile(list,JSON.stringify({plugins:specs},null,2)+'\n');
 const legacy=PREINSTALLED.filter(item=>item.stem!=='meoo-agent').map(item=>item.package);
 await fs.writeFile(marker,JSON.stringify({schema:1,registered:legacy})+'\n');
 await seedPreinstalled({data});
 const state=await readPreinstallState({data});
 assert.deepEqual(state.added,['magpie-plugin-meoo-agent'],'added 只记本次补的');
 assert.equal(state.registered.length,13);
 assert.deepEqual(state.registered,PREINSTALLED.map(item=>item.package));
 const manifest=JSON.parse(await utf8(list));
 // registered 按基线序、清单按写入序：比集合，再核数——口径与 registeredFrom 一致。
 const inList=new Set(manifest.plugins.filter(entry=>PREINSTALLED.some(item=>item.spec===entry.spec)).map(entry=>entry.spec));
 assert.equal(inList.size,13);
 for(const item of PREINSTALLED)assert.equal(inList.has(item.spec),true,'清单里 13 家基线都在');
});

// #71 S3 的另一半：ensurePreinstallState 拿到空 registered 时照实写，不再拿基线
// 顶上（老版本这里会把 13 家全写进去，撒谎的来源之一）。
test('ensurePreinstallState 对 seeded.registered=[] 照实写空',async()=>{
 const {data}=await sandbox();
 await ensurePreinstallState({data,seeded:{registered:[],added:[]},at:new Date('2026-11-04T12:00:00Z')});
 const state=await readPreinstallState({data});
 assert.deepEqual(state.registered,[],'没有登记在案就写空，不拿基线凑数');
 assert.deepEqual(state.added,[]);
});

// 新装用户行为不变：没有 marker、没有清单 → 一次性登记 13 家，marker 与状态文件
// 与旧版产物等价（marker 多了 baseline 字段）。
test('新装用户：首启登记 13 家，二启幂等',async()=>{
 const {data}=await sandbox();
 const first=await seedPreinstalled({data});
 assert.equal(first.skipped,false);
 assert.equal(first.added.length,13);
 assert.deepEqual(first.registered,PREINSTALLED.map(item=>item.package));
 const state=await readPreinstallState({data});
 assert.deepEqual(state.registered,PREINSTALLED.map(item=>item.package));
 assert.equal(state.added.length,13);
 const second=await seedPreinstalled({data});
 assert.equal(second.skipped,true);
 assert.equal(second.added.length,0);
 assert.deepEqual(second.registered,PREINSTALLED.map(item=>item.package));
});

// zen-free 等移出基线的项：增量补登记路径从头到尾不碰它们。
test('zen-free 已装时不被增量补登记触碰（不卸载、不改写）',async()=>{
 const {data,list,marker}=await sandbox();
 const specs=PREINSTALLED.filter(item=>item.stem!=='meoo-agent').map(item=>({spec:item.spec}));
 specs.unshift({spec:'@magpie-community/opencode-zen-free-auth@latest',off:false,options:{collapsed:true}});
 await fs.writeFile(list,JSON.stringify({plugins:specs},null,2)+'\n');
 const legacy=PREINSTALLED.filter(item=>item.stem!=='meoo-agent').map(item=>item.package);
 await fs.writeFile(marker,JSON.stringify({schema:1,registered:legacy})+'\n');
 await seedPreinstalled({data});
 const manifest=JSON.parse(await utf8(list));
 const zen=manifest.plugins.filter(entry=>entry.spec==='@magpie-community/opencode-zen-free-auth@latest');
 assert.equal(zen.length,1,'zen-free 还在');
 assert.equal(zen[0].off,false);
 assert.deepEqual(zen[0].options,{collapsed:true});
 assert.equal(manifest.plugins.length,14,'13 基线 + 1 zen-free，不多不少');
});

// 已有清单里的其它条目在登记后字节不变，且留一份原文件备份
test('已有清单里的其它条目在登记后字节不变，且留一份原文件备份',async()=>{
 const {data,list}=await sandbox();
 const raw=JSON.stringify({plugins:[{spec:'C:/data/plugins/page-checkin',options:{collapsed:true}}]},null,2)+'\n';
 await fs.writeFile(list,raw);
 await seedPreinstalled({data});
 const manifest=JSON.parse(await utf8(list));
 assert.equal(manifest.plugins[0].spec,'C:/data/plugins/page-checkin');
 assert.deepEqual(manifest.plugins[0].options,{collapsed:true});
 assert.equal(await utf8(`${list}.bak`),raw,'改动前的清单留在 .bak');
});

// #16：首启登记要落一份可读状态（config/preinstall-state.json），让「登记已发生、
// 还在等安装」这件事可判定，而不是只剩一个看不见的标记文件。
test('首启登记写状态文件：13 家包名 + registeredAt，内容可读回',async()=>{
 const {data}=await sandbox();
 const result=await seedPreinstalled({data});
 assert.equal(result.registered.length,13);
 const file=preinstallStateFile(data);
 assert.equal(file.replaceAll('\\','/').endsWith(stateRelativePath),true,'状态文件落在 config/ 下');
 const state=await readPreinstallState({data});
 assert.equal(state.schema,1);
 assert.equal(state.status,'registered');
 assert.equal(typeof state.registeredAt,'string');
 assert.equal(Number.isNaN(Date.parse(state.registeredAt)),false,'registeredAt 是合法时间');
 assert.deepEqual(state.registered,PREINSTALLED.map(item=>item.package));
 assert.equal(state.added.length,13);
});

test('状态文件缺失时读回 null，写入失败不产生半份临时文件',async()=>{
 const {data}=await sandbox();
 assert.equal(await readPreinstallState({data}),null);
 await recordPreinstallState({data,registered:['a'],added:[],at:new Date('2026-11-02T08:00:00Z')});
 const state=await readPreinstallState({data});
 assert.deepEqual(state.registered,['a']);
 assert.equal(state.registeredAt,'2026-11-02T08:00:00.000Z');
 const left=(await fs.readdir(path.join(data,'config'))).filter(name=>name.endsWith('.tmp'));
 assert.deepEqual(left,[],'没有 .tmp 残留');
});

// pendingStems 只做集合差：给已装 provider 就回还差哪几家，不猜、不编。
test('pendingStems 按已装 provider 求差，装完为空',()=>{
 assert.equal(pendingStems({installed:[]}).length,13);
 assert.deepEqual(pendingStems({installed:['raccoon','cline','loomy']}).slice(0,2),['autoclaw','codearts']);
 assert.deepEqual(pendingStems({installed:PREINSTALLED.map(item=>item.stem)}),[]);
 assert.equal(pendingStems({installed:['loomy-plugin']}).includes('loomy'),true,'别名不算已装到 loomy');
});
// 启动那一步：标记文件只写一次，状态文件却可能缺（清过、写到一半、2.1.3 之前
// 就登记过）。缺了补一份，已有就一个字都不动——不刷 registeredAt。
test('ensurePreinstallState 补写缺失的状态文件，已有就不碰',async()=>{
 const {data}=await sandbox();
 const wrote=await ensurePreinstallState({data,seeded:{registered:['@scope/a@1'],added:['@scope/a@1']},at:new Date('2026-11-02T09:00:00Z')});
 assert.equal(wrote,preinstallStateFile(data),'第一次补写要落成状态文件');
 let state=await readPreinstallState({data});
 assert.deepEqual(state.registered,['@scope/a@1']);
 assert.equal(state.registeredAt,'2026-11-02T09:00:00.000Z');
 const again=await ensurePreinstallState({data,seeded:{registered:['@scope/b@2']},at:new Date('2026-11-02T10:00:00Z')});
 assert.equal(again,null,'已经有状态文件时不再写');
 state=await readPreinstallState({data});
 assert.deepEqual(state.registered,['@scope/a@1'],'已有内容不许被后来的登记覆盖');
 assert.equal(state.registeredAt,'2026-11-02T09:00:00.000Z','registeredAt 不许被刷新');
});

// 首次登记没带得回名单（标记已存在的那种启动）也要写下完整的 13 家，
// 否则 host 算不出「还差几个」。
test('ensurePreinstallState 没有登记结果时按预装基线补齐',async()=>{
 const {data}=await sandbox();
 await ensurePreinstallState({data,seeded:null,at:new Date('2026-11-02T09:00:00Z')});
 const state=await readPreinstallState({data});
 assert.deepEqual(state.registered,PREINSTALLED.map(item=>item.package));
});

// 接线守卫：65549f0 的教训就是实现了却没人调。runtime.mjs 必须在
// seedPreinstalled 之后真的调 ensurePreinstallState。
test('runtime.mjs 在 seedPreinstalled 之后调 ensurePreinstallState',async()=>{
 const source=await fs.readFile(new URL('./runtime.mjs',import.meta.url),'utf8');
 const seed=source.indexOf('seedPreinstalled({data:portable.data');
 const ensure=source.indexOf('ensurePreinstallState({data:portable.data,seeded');
 assert.ok(seed>=0,'runtime.mjs 没有调 seedPreinstalled');
 assert.ok(ensure>seed,'runtime.mjs 没在 seedPreinstalled 之后调 ensurePreinstallState');
});
