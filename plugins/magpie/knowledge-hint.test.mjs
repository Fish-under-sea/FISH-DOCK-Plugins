import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readKnowledgeHint,dismissKnowledgeHint} from './knowledge-hint.mjs';

function storageAt(root){
 return {
  async read(category,name){
   assert.equal(category,'config');
   try{return await fs.readFile(path.join(root,category,name),'utf8')}
   catch(error){if(error.code==='ENOENT')return null;throw error}
  },
  async write(category,name,text){
   assert.equal(category,'config');
   await fs.mkdir(path.join(root,category),{recursive:true});
   await fs.writeFile(path.join(root,category,name),text);
  }
 };
}

test('关闭状态保存在 config，重建 storage 后仍关闭，不与网关配置混写',async t=>{
 const base=fileURLToPath(new URL('../../.work/',import.meta.url));
 await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(base,'knowledge-hint-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const storage=storageAt(root);
 assert.deepEqual(await readKnowledgeHint(storage),{dismissed:false});
 await storage.write('config','gateway.json','{"port":3425}');
 assert.deepEqual(await dismissKnowledgeHint(storage),{dismissed:true});
 const restarted=storageAt(root);
 assert.deepEqual(await readKnowledgeHint(restarted),{dismissed:true});
 assert.deepEqual(await readKnowledgeHint(restarted),{dismissed:true});
 assert.equal(await restarted.read('config','gateway.json'),'{"port":3425}');
});

test('写入失败不返回成功、不缓存已关闭状态，可重试',async()=>{
 let raw=null,fail=true;
 const storage={read:async()=>raw,write:async(category,name,text)=>{
  if(fail)throw Error('磁盘不可写');
  raw=text;
 }};
 await assert.rejects(dismissKnowledgeHint(storage),/关闭设置保存失败.*尚未永久关闭.*重试.*磁盘不可写/);
 assert.deepEqual(await readKnowledgeHint(storage),{dismissed:false});
 fail=false;await dismissKnowledgeHint(storage);
 assert.deepEqual(await readKnowledgeHint(storage),{dismissed:true});
});

test('读取失败或损坏记录如实报错，不默认为首次展示',async()=>{
 await assert.rejects(readKnowledgeHint({read:async()=>{throw Error('读取被拒绝')}}),/读取知识库提示设置失败.*读取被拒绝/);
 await assert.rejects(readKnowledgeHint({read:async()=>'{broken'}),/读取知识库提示设置失败/);
});
