import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {directoryDigest,registerSeedPage,rewriteSeedSpec,syncPageDirectory} from './page-seed.mjs';

const utf8=file=>fs.readFile(file,'utf8');
async function sandbox(){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-pageseed-'));
 return {root,source:path.join(root,'bundled','page-checkin'),data:path.join(root,'data')};
}
// 与仓库里 page-plugins/page-checkin 同形的合成页面目录。
async function seedSource(source,version='0.1.1'){
 await fs.mkdir(path.join(source,'page'),{recursive:true});
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'@magpie-community/page-checkin',version},null,2)+'\n');
 await fs.writeFile(path.join(source,'page','index.html'),`<html data-v="${version}"></html>`);
 await fs.writeFile(path.join(source,'page','app.js'),`// ${version}\n`);
 await fs.writeFile(path.join(source,'page','icon.svg'),'<svg/>');
 await fs.writeFile(path.join(source,'README.md'),`# ${version}\n`);
 return source;
}
async function mtime(file){return (await fs.stat(file)).mtimeMs}

test('plugins.json 不存在时新建清单，只写一条稳定路径',async()=>{
 const {root,data}=await sandbox();
 const directory=path.join(data,'plugins','page-checkin');
 await fs.mkdir(data,{recursive:true});
 const result=await registerSeedPage({data,directory});
 assert.equal(result.written,true);
 const text=await utf8(path.join(data,'plugins.json'));
 assert.equal(text.endsWith('\n'),true,'结尾换行');
 assert.equal(text,JSON.stringify({plugins:[{spec:directory}]},null,2)+'\n');
 assert.equal(await mtime(path.join(data,'plugins.json.bak')).catch(()=>null),null,'无原文件时不产生备份');
});

test('旧的版本目录绝对路径被换成稳定路径，options 保留且其他条目字节不变',async()=>{
 const {root,data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const stale=path.join(root,'.fish-dock','host','packages','fish.magpie','1.1.0','08a43e59','plugins','magpie','page-plugins','page-checkin');
 const others=[{spec:'@magpie-community/page-usage@latest'},{spec:'@magpie-community/opencode-trae-auth@latest',off:true}];
 const original=JSON.stringify({plugins:[...others,{spec:stale,options:{collapsed:true}}]},null,2)+'\n';
 const file=path.join(data,'plugins.json');
 await fs.writeFile(file,original);
 const directory=path.join(data,'plugins','page-checkin');
 const result=await registerSeedPage({data,directory});
 assert.equal(result.written,true);
 const text=await utf8(file);
 const manifest=JSON.parse(text);
 assert.equal(manifest.plugins.length,3,'不追加重复条目');
 assert.deepEqual(manifest.plugins[2],{spec:directory,options:{collapsed:true}},'稳定路径 + options 保留');
 // 其他条目按对象逐字不变，且整份文件仍是 2 空格缩进 + 结尾换行。
 assert.deepEqual(manifest.plugins.slice(0,2),others);
 assert.equal(text,JSON.stringify({plugins:[...others,{spec:directory,options:{collapsed:true}}]},null,2)+'\n');
 // 备份保存的是改写前的原文。
 assert.equal(await utf8(`${file}.bak`),original);
});

test('已是稳定路径时不写磁盘，文件 mtime 不变',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const directory=path.join(data,'plugins','page-checkin');
 const file=path.join(data,'plugins.json');
 await fs.writeFile(file,JSON.stringify({plugins:[{spec:'@magpie-community/page-usage@latest'},{spec:directory,options:{collapsed:true}}]},null,2)+'\n');
 const before=await mtime(file);
 const result=await registerSeedPage({data,directory});
 assert.equal(result.written,false);
 assert.equal(await mtime(file),before,'稳定路径下不重写');
 assert.equal(await mtime(`${file}.bak`).catch(()=>null),null,'不写就不备份');
});

test('npm 包名条目与重复条目都被收束到第一条稳定路径',async()=>{
 const spec=path.join(os.tmpdir(),'magpie-stable','plugins','page-checkin');
 for(const stale of ['@magpie-community/page-checkin@latest','@magpie-community/page-checkin','@magpie-community/page-checkin#packages/checkin']){
  const next=rewriteSeedSpec({raw:JSON.stringify({plugins:[{spec:'@magpie-community/page-usage@latest'},{spec:stale,options:{collapsed:true}}]},null,2)+'\n',spec});
  assert.equal(next.changed,true,`${stale} 应被改写`);
  const manifest=JSON.parse(next.text);
  assert.equal(manifest.plugins.length,2);
  assert.deepEqual(manifest.plugins[1],{spec,options:{collapsed:true}});
 }
 const rows=rewriteSeedSpec({raw:JSON.stringify({plugins:[{spec:'@magpie-community/page-checkin@latest',off:true},{spec:'C:\\old\\page-checkin'}]}),spec});
 assert.deepEqual(JSON.parse(rows.text).plugins,[{spec,off:true}],'同包多条只留第一条');
});

test('别的插件与相似名不受影响',async()=>{
 const spec=path.join(os.tmpdir(),'magpie-stable','plugins','page-checkin');
 const plugins=[{spec:'@magpie-community/page-usage@latest'},{spec:'@magpie-community/page-checkin-extra@latest'},{spec:'C:\\x\\page-checkin-extra'},{spec:'C:\\x\\prepage-checkin'}];
 const original=JSON.stringify({plugins},null,2)+'\n';
 const next=rewriteSeedSpec({raw:original,spec});
 assert.equal(JSON.parse(next.text).plugins.length,5,'都不命中 → 追加一条');
 assert.deepEqual(JSON.parse(next.text).plugins.slice(0,4),plugins);
 assert.equal(next.changed,true);
});

test('插件清单没有该条目时追加到末尾，原有内容原样保留',async()=>{
 const {data}=await sandbox();
 await fs.mkdir(data,{recursive:true});
 const file=path.join(data,'plugins.json');
 const original=JSON.stringify({plugins:[{spec:'@magpie-community/page-usage@latest'}]},null,2)+'\n';
 await fs.writeFile(file,original);
 const directory=path.join(data,'plugins','page-checkin');
 const result=await registerSeedPage({data,directory});
 assert.equal(result.written,true);
 const manifest=JSON.parse(await utf8(file));
 assert.equal(manifest.plugins.length,2);
 assert.equal(manifest.plugins[0].spec,'@magpie-community/page-usage@latest');
 assert.deepEqual(manifest.plugins[1],{spec:directory});
});

test('目录同步写稳定位置，内容一致时不再写且 mtime 不变',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'0.1.1');
 const first=await syncPageDirectory({source,data});
 assert.equal(first.written,true);
 assert.equal(first.directory,path.join(data,'plugins','page-checkin'));
 assert.equal(await utf8(path.join(first.directory,'page','app.js')),'// 0.1.1\n');
 assert.equal(await directoryDigest(first.directory),await directoryDigest(source),'内容指纹一致');
 const stamp=await mtime(path.join(first.directory,'page','app.js'));
 const second=await syncPageDirectory({source,data});
 assert.equal(second.written,false,'指纹相同不覆盖');
 assert.equal(await mtime(path.join(first.directory,'page','app.js')),stamp);
 assert.equal(second.digest,first.digest);
});

test('内置页面升级后整体替换，删除的文件不残留半套',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'0.1.1');
 await fs.writeFile(path.join(source,'page','legacy.js'),'old');
 const first=await syncPageDirectory({source,data});
 assert.equal(await fs.stat(path.join(first.directory,'page','legacy.js')).then(()=>true),true);
 // 新版本删掉 legacy.js 并改内容：整体替换，不保留上一版文件。
 await fs.rm(path.join(source,'page','legacy.js'));
 await seedSource(source,'0.2.0');
 const second=await syncPageDirectory({source,data});
 assert.equal(second.written,true);
 assert.notEqual(second.digest,first.digest);
 assert.equal(await utf8(path.join(second.directory,'page','app.js')),'// 0.2.0\n');
 await assert.rejects(fs.stat(path.join(second.directory,'page','legacy.js')),{code:'ENOENT'});
 // 发布用的临时目录与备份目录都不残留。
 const left=await fs.readdir(path.join(data,'plugins'));
 assert.deepEqual(left,['page-checkin']);
});

test('指纹只看内容，不看目录名与时间戳',async()=>{
 const {root}=await sandbox();
 const a=await seedSource(path.join(root,'a'),'0.1.1');
 const b=await seedSource(path.join(root,'b'),'0.1.1');
 assert.equal(await directoryDigest(a),await directoryDigest(b));
 await fs.writeFile(path.join(b,'page','app.js'),'// changed\n');
 assert.notEqual(await directoryDigest(a),await directoryDigest(b));
 assert.equal(await directoryDigest(path.join(root,'missing')),null,'不存在时返回 null');
});

test('来源目录不存在时不创建任何目录',async()=>{
 const {source,data}=await sandbox();
 assert.equal(await syncPageDirectory({source,data}),null);
 await assert.rejects(fs.stat(data),{code:'ENOENT'});
});

test('发布中途失败时旧目录完好，不残留临时目录',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'0.1.1');
 const first=await syncPageDirectory({source,data});
 // 故意把内容改掉，让下一次同步必须写盘。
 await seedSource(source,'0.2.0');
 const controller=new AbortController();
 await assert.rejects(syncPageDirectory({source,data,signal:controller.signal,
  // 同步已进入发布阶段、临时目录已写完之后再取消。
  onPhase:()=>controller.abort()}),{name:'AbortError'});
 assert.equal(await utf8(path.join(first.directory,'page','app.js')),'// 0.1.1\n','旧版本仍是完整一套');
 assert.equal(await directoryDigest(first.directory),first.digest);
 const left=await fs.readdir(path.join(data,'plugins'));
 assert.deepEqual(left,['page-checkin'],'没有 .tmp-/.old- 残留');
});

test('并发同步同一份内容仍只发布一套完整目录',async()=>{
 const {source,data}=await sandbox();
 await seedSource(source,'0.1.1');
 const rows=await Promise.all(Array.from({length:4},()=>syncPageDirectory({source,data})));
 assert.ok(rows.every(row=>row.directory===rows[0].directory));
 assert.equal(await directoryDigest(rows[0].directory),await directoryDigest(source));
 assert.ok(rows.some(row=>row.written),'至少一个实例完成发布');
 assert.equal(await utf8(path.join(rows[0].directory,'page','index.html')),'<html data-v="0.1.1"></html>');
 assert.deepEqual(await fs.readdir(path.join(data,'plugins')),['page-checkin']);
});

test('仓库里真实的 page-checkin 目录可直接同步并登记',async()=>{
 const {data}=await sandbox();
 const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'page-plugins','page-checkin');
 const seeded=await syncPageDirectory({source,data});
 assert.equal(seeded.written,true);
 for(const file of ['package.json','README.md','page/index.html','page/app.js','page/style.css','page/icon.png','page/view.js']){
  assert.equal(await fs.stat(path.join(seeded.directory,...file.split('/'))).then(()=>true),true,`缺少 ${file}`);
 }
 await registerSeedPage({data,directory:seeded.directory});
 const manifest=JSON.parse(await utf8(path.join(data,'plugins.json')));
 const entry=manifest.plugins.filter(row=>row.spec===seeded.directory);
 assert.equal(entry.length,1);
 assert.equal(JSON.parse(await utf8(path.join(seeded.directory,'package.json'))).name,'@magpie-community/page-checkin');
});
