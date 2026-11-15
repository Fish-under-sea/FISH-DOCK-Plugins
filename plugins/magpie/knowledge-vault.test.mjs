import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareKnowledgeVault,vaultPaths,importRecord,deployObsidianPlugin,obsidianPluginId} from './knowledge-vault.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'fish-vault-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const data=path.join(root,'data'),source=path.join(root,'旧知识库');await fs.mkdir(source,{recursive:true});return {root,data,source}}
test('首次完整复制、Unicode 与事务资料保留，之后不依赖源且不覆盖新笔记',async t=>{
 const {root,data,source}=await fixture(t);await fs.mkdir(path.join(source,'wiki'));await fs.mkdir(path.join(source,'.workflow'));
 await fs.writeFile(path.join(source,'wiki','记忆.md'),'# 知识\n不要截断\n');await fs.writeFile(path.join(source,'.workflow','old.json'),'{}');
 const result=await prepareKnowledgeVault({data,sourceVault:source});assert.equal(result.files,2);assert.equal(result.imported,true);assert.equal(result.created,true);
 assert.equal(await fs.readFile(path.join(result.root,'wiki','记忆.md'),'utf8'),'# 知识\n不要截断\n');
 assert.equal(await fs.readFile(path.join(source,'wiki','记忆.md'),'utf8'),'# 知识\n不要截断\n');
 await fs.writeFile(path.join(result.root,'wiki','记忆.md'),'Obsidian 修改');await fs.rename(source,path.join(root,'source-unavailable'));
 const again=await prepareKnowledgeVault({data,sourceVault:source});assert.equal(again.created,false);assert.equal(await fs.readFile(path.join(result.root,'wiki','记忆.md'),'utf8'),'Obsidian 修改');
});
test('无旧源可创建空库并明确未导入',async t=>{const {data}=await fixture(t);const r=await prepareKnowledgeVault({data,sourceVault:''});assert.equal(r.imported,false);assert.equal(r.files,0)});
test('已有未完成目标不覆盖、不假报迁移成功',async t=>{const {data,source}=await fixture(t);const {root}=vaultPaths(data);await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'note.md'),'keep');await assert.rejects(prepareKnowledgeVault({data,sourceVault:source}),{code:'VAULT_CONFLICT'});assert.equal(await fs.readFile(path.join(root,'note.md'),'utf8'),'keep')});
test('取消不发布目标且旧数据不变',async t=>{const {data,source}=await fixture(t);await fs.writeFile(path.join(source,'a.md'),'keep');const c=new AbortController();c.abort();await assert.rejects(prepareKnowledgeVault({data,sourceVault:source,signal:c.signal}),{name:'AbortError'});await assert.rejects(fs.stat(vaultPaths(data).root),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(source,'a.md'),'utf8'),'keep')});
test('不继承旧 .obsidian，保留目录冲突拒绝',async t=>{const {data,source}=await fixture(t);await fs.mkdir(path.join(source,'.obsidian'));await fs.writeFile(path.join(source,'.obsidian','secret'),'do not copy');const r=await prepareKnowledgeVault({data,sourceVault:source});assert.equal(r.files,0);await assert.rejects(fs.stat(path.join(r.root,'.obsidian')),{code:'ENOENT'});const other=path.join(data,'other');await fs.mkdir(path.join(source,'memories'));await fs.writeFile(path.join(source,'memories','a.md'),'conflict');await assert.rejects(prepareKnowledgeVault({data:other,sourceVault:source}),/保留目录/)});
test('拒绝源 junction，且不删除链接目标',async t=>{const {root,data,source}=await fixture(t);const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'a.md'),'secret');await fs.symlink(outside,path.join(source,'link'),'junction');await assert.rejects(prepareKnowledgeVault({data,sourceVault:source}),/链接/);assert.equal(await fs.readFile(path.join(outside,'a.md'),'utf8'),'secret');await assert.rejects(fs.stat(vaultPaths(data).root),{code:'ENOENT'})});
test('部署发行资源幂等，保留笔记、用户配置和其他插件',async t=>{const {data}=await fixture(t);const r=await prepareKnowledgeVault({data,sourceVault:''});await deployObsidianPlugin(r.root);const obs=path.join(r.root,'.obsidian');await fs.writeFile(path.join(obs,'community-plugins.json'),JSON.stringify(['another',obsidianPluginId]));const settings=path.join(obs,'plugins',obsidianPluginId,'data.json');await fs.writeFile(settings,'{"model":"chosen"}');await deployObsidianPlugin(r.root);assert.deepEqual(JSON.parse(await fs.readFile(path.join(obs,'community-plugins.json'),'utf8')),['another',obsidianPluginId]);assert.equal(await fs.readFile(settings,'utf8'),'{"model":"chosen"}');assert.equal(JSON.parse(await fs.readFile(path.join(r.root,importRecord),'utf8')).schema,1)});
