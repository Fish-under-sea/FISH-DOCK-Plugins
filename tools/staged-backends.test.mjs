import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {stage,definitions} from './stage-development.mjs';

test('真实宿主 SDK 加载四个暂存 backend，跨工作目录握手、激活、读取和停用',
 {skip:!process.env.FISH_TEST_SDK,timeout:30000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish SDK 中文 空格-'));
 const staged=path.join(root,'resources');
 stage({out:staged,sdk:process.env.FISH_TEST_SDK});
 for(const definition of definitions){
  const data=path.join(root,'data',definition.directory);fs.mkdirSync(data,{recursive:true});
  const child=spawn(process.execPath,[path.join(staged,definition.key,'plugins',definition.key,'backend.mjs')],
   {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const exited=once(child,'exit'),pending=new Map(),files=new Map();
  const reader=createInterface({input:child.stdout});
  let sequence=0,stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString()});
  t.after(()=>{reader.close();if(child.exitCode===null)child.kill();});
  const send=row=>child.stdin.write(JSON.stringify(row)+'\n');
  reader.on('line',line=>{
   const row=JSON.parse(line);
   if(row.method){
    const {category,name,value}=row.params,key=`${row.method.includes('Secret')?'secret:':''}${category}/${name}`;
    if(row.method.startsWith('host.storage.write'))files.set(key,value);
    send({id:row.id,result:{value:files.get(key)??null}});
   }else{
    const waiter=pending.get(row.id);
    if(waiter){pending.delete(row.id);clearTimeout(waiter.timer);row.error?waiter.reject(Error(row.error.message)):waiter.resolve(row.result);}
   }
  });
  const request=(method,params={})=>new Promise((resolve,reject)=>{
   const id=++sequence,timer=setTimeout(()=>reject(Error(`协议超时：${definition.key}/${method}`)),5000);
   pending.set(id,{resolve,reject,timer});send({id,method,params});
  });
  await request('host.hello',{protocol:1,pluginId:`fish.${definition.key}`,dataDirectory:data,capabilities:definition.capabilities});
  assert.equal((await request('plugin.activate')).active,true);
  const method=definition.key==='feishu'?'feishu.view':definition.key==='clash'?'clash.view':'gateway.view';
  const view=await request(method);
  assert.ok(view&&typeof view==='object');
  if(['magpie','ofm'].includes(definition.key)){
   assert.ok(view.executable.startsWith(staged));
   assert.equal(view.state,'stopped');
  }
  assert.equal((await request('plugin.deactivate')).active,false);
  child.stdin.end();const [code]=await exited;
  assert.equal(code,0,`${definition.key} backend exit: ${stderr.slice(0,120)}`);
 }
});
