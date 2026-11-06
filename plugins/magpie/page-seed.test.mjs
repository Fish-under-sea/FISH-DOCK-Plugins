import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundledPlugins,directoryDigest,registerBundledPlugins,rewriteBundledSpecs,syncPageDirectory} from './page-seed.mjs';

const MERGED='magpie-checkin-relay-probe';
const PURGE='magpie-purge';

const utf8=file=>fs.readFile(file,'utf8');
async function sandbox(){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-pageseed-'));
 return {root,source:path.join(root,'bundled',MERGED),data:path.join(root,'data')};
}
// 与仓库里 bundled-plugins/<名字> 同形的合成插件目录。
async function seedSource(source,version='1.0.0',name=`@fish-under-sea/${MERGED}`){
 await fs.mkdir(path.join(source,'page'),{recursive:true});
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name,version},null,2)+'\n');
 await fs.writeFile(path.join(source,'page','index.html'),`<html data-v="${version}"></html>`);
 await fs.writeFile(path.join(source,'page','app.js'),`// ${version}\n`);
 await fs.writeFile(path.join(source,'page','icon.svg'),'<svg/>');
 await fs.writeFile(path.join(source,'README.md'),`# ${version}\n`);
 return source;
}
async function mtime(file){return (await fs.stat(file)).mtimeMs}
const specsOf=(...names)=>new Map(names.map(name=>[name,path.join(os.tmpdir(),'magpie-stable','plugins',name)]));

test('两个内置件的名字与顺序固定：签到&探针在前，破甲在后',()=>{
 assert.deepEqual([...bundledPlugins],[MERGED,PURGE]);
});

test('plugins.json 不存在时新建清单，按顺序写两条稳定路径',async()=>{
 const {data}=await sandbox();
 const directories=specsOf(MERGED,PURGE);
 await fs.mkdir(data,{recursive:true});
 const result=await registerBundledPlugins({data,directories});
 assert.equal(result.written,true);
 const text=await utf8(path.join(data,'plugins.json'));
 assert.equal(text.endsWith('\n'),true,'结尾换行');
 assert.deepEqual(JSON.parse(text),{plugins:[...directories].map(([name,directory])=>({spec:directory}))});
});

test('旧的两个内置页整条删掉，新条目补上，其他插件一个字不动',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const directories=specsOf(MERGED,PURGE);
 const others=[{spec:'@magpie-community/page-usage@latest'},{spec:'@magpie-community/opencode-trae-auth@latest',off:true}];
 const legacy=[
  {spec:'@magpie-community/page-checkin@latest',options:{collapsed:true}},
  {spec:'@fish-under-sea/page-relay-probe@latest',off:true},
  {spec:path.join('C:','data','plugins','page-checkin')},
 ];
 const file=path.join(data,'plugins.json');
 const original=JSON.stringify({plugins:[...others,...legacy]},null,2)+'\n';
 await fs.writeFile(file,original);

 const result=await registerBundledPlugins({data,directories});
 assert.equal(result.written,true);
 const manifest=JSON.parse(await utf8(file));
 assert.deepEqual(manifest.plugins,others.concat([...directories].map(([name,directory])=>({spec:directory}))));
 assert.equal(await utf8(`${file}.bak`),original,'备份是改写前的原文');
});

test('同名条目收束成一条，options 与 off 保留在第一条上',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const directories=specsOf(MERGED,PURGE);
 const merged=directories.get(MERGED);
 const raw=JSON.stringify({plugins:[
  {spec:'@fish-under-sea/magpie-checkin-relay-probe@0.9.0',options:{collapsed:false}},
  {spec:'@fish-under-sea/magpie-checkin-relay-probe@latest',off:true},
 ]},null,2)+'\n';
 const next=rewriteBundledSpecs({raw,specs:new Map([[MERGED,merged]])});
 assert.deepEqual(JSON.parse(next.text).plugins,[{spec:merged,options:{collapsed:false}}],'同包多条只留第一条');
});

test('已是稳定路径时不写磁盘，文件 mtime 不变',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const directories=specsOf(MERGED,PURGE);
 const file=path.join(data,'plugins.json');
 const now=[...directories].map(([name,directory])=>({spec:directory}));
 await fs.writeFile(file,JSON.stringify({plugins:[{spec:'@magpie-community/page-usage@latest'},...now]},null,2)+'\n');
 const before=await mtime(file);
 const result=await registerBundledPlugins({data,directories});
 assert.equal(result.written,false);
 assert.equal(await mtime(file),before,'稳定路径下不重写');
 assert.equal(await mtime(`${file}.bak`).catch(()=>null),null,'不写就不备份');
});

test('新旧 scope、绝对路径都认，相似名不受影响',async()=>{
 const spec=path.join(os.tmpdir(),'magpie-stable','plugins',MERGED);
 const specs=new Map([[MERGED,spec]]);
 for(const good of [
  `@magpie-community/${MERGED}@latest`,
  `@fish-under-sea/${MERGED}`,
  `@fish-under-sea/${MERGED}@1.0.0`,
  `@fish-under-sea/${MERGED}#dir`,
  path.join('C:','data','plugins',MERGED),
 ]){
  const next=rewriteBundledSpecs({raw:JSON.stringify({plugins:[{spec:good,options:{collapsed:true}}]},null,2)+'\n',specs});
  assert.deepEqual(JSON.parse(next.text).plugins,[{spec,options:{collapsed:true}}],`${good} 应命中并改写`);
 }
 for(const bad of [`@fish-under-sea/${MERGED}-extra@latest`,`@other/${MERGED}@latest`,'@fish-under-sea/page-usage@latest']){
  const raw=JSON.stringify({plugins:[{spec:bad}]},null,2)+'\n';
  const next=rewriteBundledSpecs({raw,specs});
  assert.equal(JSON.parse(next.text).plugins.length,2,`${bad} 不该命中`);
 }
});

test('目录同步写稳定位置，内容一致时不再写且 mtime 不变',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'1.0.0');
 const first=await syncPageDirectory({source,data,name:MERGED});
 assert.equal(first.written,true);
 assert.equal(first.directory,path.join(data,'plugins',MERGED));
 assert.equal(await utf8(path.join(first.directory,'page','app.js')),'// 1.0.0\n');
 assert.equal(await directoryDigest(first.directory),await directoryDigest(source),'内容指纹一致');
 const stamp=await mtime(path.join(first.directory,'page','app.js'));
 const second=await syncPageDirectory({source,data,name:MERGED});
 assert.equal(second.written,false,'指纹相同不覆盖');
 assert.equal(await mtime(path.join(first.directory,'page','app.js')),stamp);
 assert.equal(second.digest,first.digest);
});

test('内置插件升级后整体替换，删除的文件不残留半套',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'1.0.0');
 await fs.writeFile(path.join(source,'page','legacy.js'),'old');
 const first=await syncPageDirectory({source,data,name:MERGED});
 assert.equal(await fs.stat(path.join(first.directory,'page','legacy.js')).then(()=>true),true);
 await fs.rm(path.join(source,'page','legacy.js'));
 await seedSource(source,'1.1.0');
 const second=await syncPageDirectory({source,data,name:MERGED});
 assert.equal(second.written,true);
 assert.notEqual(second.digest,first.digest);
 assert.equal(await utf8(path.join(second.directory,'page','app.js')),'// 1.1.0\n');
 await assert.rejects(fs.stat(path.join(second.directory,'page','legacy.js')),{code:'ENOENT'});
 const left=await fs.readdir(path.join(data,'plugins'));
 assert.deepEqual(left,[MERGED]);
});

test('指纹只看内容，不看目录名与时间戳',async()=>{
 const {root}=await sandbox();
 const a=await seedSource(path.join(root,'a'),'1.0.0');
 const b=await seedSource(path.join(root,'b'),'1.0.0');
 assert.equal(await directoryDigest(a),await directoryDigest(b));
 await fs.writeFile(path.join(b,'page','app.js'),'// changed\n');
 assert.notEqual(await directoryDigest(a),await directoryDigest(b));
 assert.equal(await directoryDigest(path.join(root,'missing')),null,'不存在时返回 null');
});

test('来源目录不存在时不创建任何目录',async()=>{
 const {source,data}=await sandbox();
 assert.equal(await syncPageDirectory({source,data,name:MERGED}),null);
 await assert.rejects(fs.stat(data),{code:'ENOENT'});
});

test('发布中途失败时旧目录完好，不残留临时目录',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'1.0.0');
 const first=await syncPageDirectory({source,data,name:MERGED});
 await seedSource(source,'1.1.0');
 const controller=new AbortController();
 await assert.rejects(syncPageDirectory({source,data,name:MERGED,signal:controller.signal,
  onPhase:()=>controller.abort()}),{name:'AbortError'});
 assert.equal(await utf8(path.join(first.directory,'page','app.js')),'// 1.0.0\n','旧版本仍是完整一套');
 assert.equal(await directoryDigest(first.directory),first.digest);
 const left=await fs.readdir(path.join(data,'plugins'));
 assert.deepEqual(left,[MERGED],'没有 .tmp-/.old- 残留');
});

test('并发同步同一份内容仍只发布一套完整目录',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'1.0.0');
 const rows=await Promise.all(Array.from({length:4},()=>syncPageDirectory({source,data,name:MERGED})));
 assert.ok(rows.every(row=>row.directory===rows[0].directory));
 assert.equal(await directoryDigest(rows[0].directory),await directoryDigest(source));
 assert.ok(rows.some(row=>row.written),'至少一个实例完成发布');
 assert.deepEqual(await fs.readdir(path.join(data,'plugins')),[MERGED]);
});

test('仓库里真实的 bundled-plugins 目录可直接同步并登记',async()=>{
 const {data}=await sandbox();
 const bundled=path.join(path.dirname(fileURLToPath(import.meta.url)),'bundled-plugins');
 const directories=new Map();
 for(const name of bundledPlugins){
  const seeded=await syncPageDirectory({source:path.join(bundled,name),data,name});
  assert.equal(seeded?.written,true,`${name} 未同步`);
  directories.set(name,seeded.directory);
 }
 for(const file of ['package.json','page/index.html','page/app.js','page/style.css','page/icon.png','page/icon.svg']){
  assert.equal(await fs.stat(path.join(directories.get(MERGED),...file.split('/'))).then(()=>true),true,`合并插件缺少 ${file}`);
 }
 for(const file of ['package.json','page/index.html','page/icon.png','hooks.js']){
  assert.equal(await fs.stat(path.join(directories.get(PURGE),...file.split('/'))).then(()=>true),true,`purge 缺少 ${file}`);
 }
 await registerBundledPlugins({data,directories});
 const manifest=JSON.parse(await utf8(path.join(data,'plugins.json')));
 assert.equal(manifest.plugins.length,2);
 assert.deepEqual(manifest.plugins.map(row=>row.spec),[directories.get(MERGED),directories.get(PURGE)]);
});

test('合并插件的包名、标题与调用声明',async()=>{
 const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'bundled-plugins',MERGED);
 const json=JSON.parse(await utf8(path.join(root,'package.json')));
 assert.equal(json.name,'@fish-under-sea/magpie-checkin-relay-probe');
 assert.equal(json.name,json.name.toLowerCase(),'npm 规范：包名全小写');
 assert.equal(json.magpie.page.title,'签到&探针','侧边栏名称');
 assert.equal(json.magpie.page.file,'page/index.html');
 assert.equal(json.magpie.page.icon,'page/icon.svg');
 assert.deepEqual(json.magpie.permissions,['checkin:state']);
 const calls=json.magpie.calls||[];
 assert.ok(calls.length<=16,`调用条数 ${calls.length} 超过页面上限`);
 for(const name of ['checkin:run','checkin:refresh','relay:start','relay:status','relay:stop','brand:status','brand:set','magpie:open-external']){
  assert.ok(calls.includes(name),`缺少 ${name}`);
 }
 // 两页的代码与图标原样在子目录里
 for(const file of ['checkin/index.html','checkin/app.js','checkin/view.js','checkin/icon.svg','relay/index.html','relay/app.js','relay/style.css']){
  assert.equal(await fs.stat(path.join(root,'page',...file.split('/'))).then(()=>true),true,`缺少 page/${file}`);
 }
});

test('侧边栏标题只留文字：@用户/签到 → 签到，包名不动，幂等',async()=>{
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