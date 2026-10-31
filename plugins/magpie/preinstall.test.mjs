import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PREINSTALLED,addPreinstalled,markerName,packageOf,preinstallEnabled,seedPreinstalled} from './preinstall.mjs';

const utf8=file=>fs.readFile(file,'utf8');
async function sandbox(){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-preinstall-'));
 const data=path.join(root,'data');
 await fs.mkdir(data,{recursive:true});
 return {root,data,list:path.join(data,'plugins.json'),marker:path.join(data,markerName)};
}

test('预装基线是 13 个社区供应商插件，包名与 issue 的表格一一对应',()=>{
 assert.equal(PREINSTALLED.length,13);
 assert.deepEqual(PREINSTALLED.map(item=>item.package),[
  '@magpie-community/opencode-raccoon-auth',
  '@magpie-community/opencode-autoclaw-auth',
  '@magpie-community/opencode-cline-auth',
  '@magpie-community/opencode-codearts-auth',
  '@magpie-community/opencode-kiro-auth',
  '@magpie-community/opencode-loomy-auth',
  '@magpie-community/opencode-minimax-auth',
  '@magpie-community/opencode-zen-free-auth',
  '@magpie-community/opencode-qoder-auth',
  '@magpie-community/opencode-trae-auth',
  '@magpie-community/opencode-workbuddy-auth',
  '@magpie-community/opencode-mimo-auth',
  '@magpie-community/opencode-zcode-auth',
 ]);
 for(const item of PREINSTALLED)assert.equal(item.spec,`${item.package}@latest`,'按 latest 登记，交给上游的更新循环');
 // 页面插件不在这里：它们由 page-seed 以稳定目录登记，走了会变成两条同包条目。
 assert.equal(PREINSTALLED.some(item=>/page-/.test(item.package)),false);
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
 assert.equal(record.schema,1);
 assert.equal(record.registered.length,13);
 const before=(await fs.stat(list)).mtimeMs;
 const second=await seedPreinstalled({data});
 assert.equal(second.skipped,true);
 assert.equal(second.added.length,0);
 assert.equal((await fs.stat(list)).mtimeMs,before,'跳过时不动清单');
});

test('标记已在时连缺插件都不补：用户移除过的不加回来',async()=>{
 const {data,list,marker}=await sandbox();
 await fs.writeFile(marker,JSON.stringify({schema:1,registered:[]})+'\n');
 const text=JSON.stringify({plugins:[]},null,2)+'\n';
 await fs.writeFile(list,text);
 const result=await seedPreinstalled({data});
 assert.equal(result.skipped,true);
 assert.equal(await utf8(list),text);
});

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