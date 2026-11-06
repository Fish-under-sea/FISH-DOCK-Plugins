import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {builtinPlugins,packageNameOf,registerBuiltinPlugins,rewriteBuiltinSpecs} from './page-seed.mjs';

const MERGED='magpie-checkin-relay-probe';
const PURGE='magpie-purge';
const MERGED_PKG='@fish-under-sea/magpie-checkin-relay-probe';
const PURGE_PKG='@fish-under-sea/magpie-purge';
const MERGED_SPEC=`${MERGED_PKG}@latest`;
const PURGE_SPEC=`${PURGE_PKG}@latest`;

const utf8=file=>fs.readFile(file,'utf8');
async function sandbox(){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-builtin-'));
 return {root,data:path.join(root,'data')};
}

test('两个内置件按 npm 包登记，顺序固定：签到&探针在前，破甲在后',()=>{
 assert.deepEqual(builtinPlugins.map(item=>item.pkg),[MERGED_PKG,PURGE_PKG]);
 for(const item of builtinPlugins) assert.equal(packageNameOf(item.spec),item.pkg);
 assert.equal(packageNameOf(MERGED_SPEC),MERGED_PKG);
 assert.equal(packageNameOf(`${MERGED_PKG}@1.0.0`),MERGED_PKG);
 assert.equal(packageNameOf(`${MERGED_PKG}#dir`),MERGED_PKG);
 assert.equal(packageNameOf('github:owner/repo'),'');
 assert.equal(packageNameOf('C:/data/plugins/magpie-purge'),'');
});

test('plugins.json 不存在时新建清单，写两条 npm spec',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const result=await registerBuiltinPlugins({data});
 assert.equal(result.written,true);
 const text=await utf8(path.join(data,'plugins.json'));
 assert.equal(text.endsWith('\n'),true,'结尾换行');
 assert.deepEqual(JSON.parse(text),{plugins:[{spec:MERGED_SPEC},{spec:PURGE_SPEC}]});
});

test('旧的两个内置页整条删掉，其他插件一个字不动',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const others=[{spec:'@magpie-community/opencode-trae-auth@latest'},{spec:'@magpie-community/page-usage@latest',off:true}];
 const legacy=[
  {spec:'@magpie-community/page-checkin@latest',options:{collapsed:true}},
  {spec:'@fish-under-sea/page-relay-probe@latest',off:true},
  {spec:path.join('C:','data','plugins','page-checkin')},
 ];
 const file=path.join(data,'plugins.json');
 const original=JSON.stringify({plugins:[...others,...legacy]},null,2)+'\n';
 await fs.writeFile(file,original);
 const result=await registerBuiltinPlugins({data});
 assert.equal(result.written,true);
 assert.deepEqual(JSON.parse(await utf8(file)),{plugins:[...others,{spec:MERGED_SPEC},{spec:PURGE_SPEC}]});
 assert.equal(await utf8(`${file}.bak`),original,'备份是改写前的原文');
});

test('2.2.9 的目录副本迁成 npm spec，options 与 off 保留',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const file=path.join(data,'plugins.json');
 const mergedDir=path.join('C:','data','plugins',MERGED);
 const purgeDir=path.join('C:','data','plugins',PURGE);
 await fs.writeFile(file,JSON.stringify({plugins:[
  {spec:'@magpie-community/opencode-trae-auth@latest'},
  {spec:mergedDir,options:{collapsed:false}},
  {spec:purgeDir,off:true},
 ]},null,2)+'\n');
 await registerBuiltinPlugins({data});
 const manifest=JSON.parse(await utf8(file));
 assert.deepEqual(manifest.plugins,[
  {spec:'@magpie-community/opencode-trae-auth@latest'},
  {spec:MERGED_SPEC,options:{collapsed:false}},
  {spec:PURGE_SPEC,off:true},
 ],'目录副本换成 npm spec，用户状态留下');
});

test('用户自己钉的版本原样保留，不被改回 @latest',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const file=path.join(data,'plugins.json');
 await fs.writeFile(file,JSON.stringify({plugins:[
  {spec:`${PURGE_PKG}@0.3.2`,options:{mode:'strict'}},
 ]},null,2)+'\n');
 await registerBuiltinPlugins({data});
 const manifest=JSON.parse(await utf8(file));
 assert.deepEqual(manifest.plugins,[{spec:`${PURGE_PKG}@0.3.2`,options:{mode:'strict'}},{spec:MERGED_SPEC}]);
});

test('同包多条只留第一条，options/off 跟着第一条',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const file=path.join(data,'plugins.json');
 await fs.writeFile(file,JSON.stringify({plugins:[
  {spec:`${MERGED_PKG}@0.9.0`,options:{collapsed:false}},
  {spec:MERGED_SPEC,off:true},
  {spec:path.join('C:','data','plugins',MERGED)},
 ]},null,2)+'\n');
 await registerBuiltinPlugins({data});
 const manifest=JSON.parse(await utf8(file));
 assert.deepEqual(manifest.plugins,[{spec:`${MERGED_PKG}@0.9.0`,options:{collapsed:false}},{spec:PURGE_SPEC}],'同包多条只留第一条，版本不覆盖');
});

test('已是 npm spec 时不写磁盘，文件 mtime 不变',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const file=path.join(data,'plugins.json');
 await fs.writeFile(file,JSON.stringify({plugins:[{spec:MERGED_SPEC},{spec:PURGE_SPEC}]},null,2)+'\n');
 const before=(await fs.stat(file)).mtimeMs;
 const result=await registerBuiltinPlugins({data});
 assert.equal(result.written,false);
 assert.equal((await fs.stat(file)).mtimeMs,before,'没有变化就不重写');
 assert.equal(await fs.stat(`${file}.bak`).then(()=>true).catch(()=>false),false,'不写就不备份');
});

test('相似名与别的插件不受影响',async()=>{
 for(const bad of [`${MERGED_PKG}-extra@latest`,`@other/${MERGED}@latest`,'@fish-under-sea/page-usage@latest']){
  const raw=JSON.stringify({plugins:[{spec:bad}]},null,2)+'\n';
  const next=rewriteBuiltinSpecs({raw});
  const specs=JSON.parse(next.text).plugins.map(row=>row.spec);
  assert.ok(specs.includes(bad),`${bad} 应原样保留`);
  assert.equal(specs.length,3,`${bad} 之外补两条内置件`);
  assert.ok(specs.includes(MERGED_SPEC)&&specs.includes(PURGE_SPEC));
 }
 // 旧内置名只在「整条删」那一侧生效：`page-checkin-extra` 不是它
 const raw=JSON.stringify({plugins:[{spec:'@fish-under-sea/page-checkin-extra@latest'}]});
 const next=rewriteBuiltinSpecs({raw});
 assert.ok(JSON.parse(next.text).plugins.some(row=>row.spec==='@fish-under-sea/page-checkin-extra@latest'));
});

test('取消时不动磁盘',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const file=path.join(data,'plugins.json');
 const original=JSON.stringify({plugins:[]},null,2)+'\n';
 await fs.writeFile(file,original);
 const controller=new AbortController();
 controller.abort();
 await assert.rejects(registerBuiltinPlugins({data,signal:controller.signal}),{name:'AbortError'});
 assert.equal(await utf8(file),original,'取消之后清单原样');
});

// 侧边栏标题只留文字：包名保持 `@fish-under-sea/…`，标题去掉 `@用户名/` 前缀。
test('标题归一化：@用户/签到 → 签到，包名不动，幂等',async()=>{
 const {stripTitleScope,normalizePageManifest}=await import('./page-seed.mjs');
 assert.equal(stripTitleScope('@Fish-under-sea/签到'),'签到');
 assert.equal(stripTitleScope('@Fish-under-sea/中转站探针'),'中转站探针');
 assert.equal(stripTitleScope('签到&探针'),'签到&探针','没有前缀的标题不许动');
 assert.equal(stripTitleScope('@user/'),'@user/','去掉后为空就保留原样');
 const raw=JSON.stringify({name:'@fish-under-sea/page-checkin',magpie:{page:{title:'@Fish-under-sea/签到',titles:{zh:'@Fish-under-sea/签到',en:'@Fish-under-sea/Check-in'}}}},null,2)+'\n';
 const first=normalizePageManifest(raw);
 assert.equal(first.changed,true);
 const parsed=JSON.parse(first.text);
 assert.equal(parsed.name,'@fish-under-sea/page-checkin','npm 包名不许改');
 assert.equal(parsed.magpie.page.title,'签到');
 assert.equal(parsed.magpie.page.titles.zh,'签到');
 assert.equal(parsed.magpie.page.titles.en,'Check-in');
 assert.equal(normalizePageManifest(first.text).changed,false,'幂等：第二遍不应再改');
});