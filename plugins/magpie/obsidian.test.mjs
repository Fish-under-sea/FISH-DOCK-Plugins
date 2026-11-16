import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {detectObsidian,registerObsidianVault,openObsidianVault,obsidianURI} from './obsidian.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'fish-obsidian-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const vault=path.join(root,'新知识库');await fs.mkdir(vault);return {root,vault,detected:{installed:true,executable:path.join(root,'Obsidian.exe'),config:path.join(root,'config','obsidian.json')}}}
test('登记插件新库保留旧库和未知设置，备份且幂等',async t=>{const {vault,detected}=await fixture(t);await fs.mkdir(path.dirname(detected.config));const raw=JSON.stringify({vaults:{old:{path:'C:/old',open:true,ts:1}},theme:'system'});await fs.writeFile(detected.config,raw);const r=await registerObsidianVault(vault,{detected});assert.equal(r.registered,true);const first=await fs.readFile(detected.config,'utf8');const doc=JSON.parse(first);assert.deepEqual(doc.vaults.old,{path:'C:/old',open:true,ts:1});assert.equal(doc.theme,'system');assert.equal(await fs.readFile(detected.config+'.before-fish-vault','utf8'),raw);await registerObsidianVault(vault,{detected});assert.equal(await fs.readFile(detected.config,'utf8'),first);assert.equal(Object.keys(doc.vaults).length,2)});
test('坏 JSON 和错误 vaults 类型不覆盖',async t=>{const {vault,detected}=await fixture(t);await fs.mkdir(path.dirname(detected.config));for(const raw of ['{','null','{"vaults":null}','{"vaults":[]}']){await fs.writeFile(detected.config,raw);await assert.rejects(registerObsidianVault(vault,{detected}));assert.equal(await fs.readFile(detected.config,'utf8'),raw)}});
test('未安装不写登记文件且不影响库',async t=>{const {vault,detected}=await fixture(t);const r=await registerObsidianVault(vault,{detected:{...detected,installed:false}});assert.equal(r.registered,false);await assert.rejects(fs.stat(detected.config),{code:'ENOENT'});assert.ok((await fs.stat(vault)).isDirectory())});
test('仅明确打开才启动应用，URI 正确编码 Unicode 路径',async t=>{const {vault,detected}=await fixture(t);const launched=[];await registerObsidianVault(vault,{detected});assert.deepEqual(launched,[]);await openObsidianVault(vault,{detected,launch:async(...args)=>launched.push(args)});assert.equal(launched.length,1);const uri=new URL(launched[0][1][0]);assert.equal(uri.protocol,'obsidian:');assert.equal(uri.searchParams.get('path'),vault);assert.throws(()=>obsidianURI(vault,'../outside.md'));assert.throws(()=>obsidianURI('relative'))});
test('GUI 启动不使用隐藏窗口标志，重复打开不修改库登记',async t=>{
 const {vault,detected}=await fixture(t);const calls=[];
 const spawnProcess=(file,args,options)=>{
  const child=new EventEmitter();child.unref=()=>{child.detached=true};
  calls.push({file,args,options,child});queueMicrotask(()=>child.emit('spawn'));return child;
 };
 await openObsidianVault(vault,{detected,spawnProcess});
 const original=await fs.readFile(detected.config,'utf8');
 await openObsidianVault(vault,{detected,spawnProcess});
 assert.equal(calls.length,2);for(const call of calls){assert.equal(call.options.windowsHide,false,'GUI vault window must be visible, not SW_HIDE');assert.equal(call.options.stdio,'ignore');assert.equal(call.child.detached,true);assert.equal(call.file,detected.executable)}
 assert.equal(await fs.readFile(detected.config,'utf8'),original);
});
test('GUI 启动失败不能虚报已经打开',async t=>{
 const {vault,detected}=await fixture(t);
 await assert.rejects(openObsidianVault(vault,{detected,spawnProcess:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Error('app launch failed')));return child}}),/app launch failed/);
});
test('检测按安装位置，不因只有旧库配置就声称应用存在',async t=>{const {root}=await fixture(t);const env={USERPROFILE:root,APPDATA:path.join(root,'roaming'),LOCALAPPDATA:path.join(root,'local'),ProgramFiles:path.join(root,'programs')};const first=await detectObsidian({env,platform:'win32'});assert.equal(first.installed,false);const exe=path.join(env.ProgramFiles,'Obsidian','Obsidian.exe');await fs.mkdir(path.dirname(exe),{recursive:true});await fs.writeFile(exe,'fixture');const r=await detectObsidian({env,platform:'win32'});assert.equal(r.executable,exe);assert.equal(r.config,path.join(env.APPDATA,'obsidian','obsidian.json'))});
