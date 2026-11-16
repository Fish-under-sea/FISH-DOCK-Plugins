import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {detectObsidian,registerObsidianVault,openObsidianVault,obsidianURI,isOwnVaultOpenURL,openObsidianUri} from './obsidian.mjs';
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

// 本库链接的判据：只认这个库自己的 obsidian://open?path=，别的协议/越界/多参数一律交回去。
test('只接管本知识库的 obsidian 链接，越界与别的协议一律拒绝',()=>{
 const root=path.join(path.sep,'vaults','github-capability-vault');
 assert.equal(isOwnVaultOpenURL(obsidianURI(root),root),true,'库根');
 assert.equal(isOwnVaultOpenURL(obsidianURI(root,path.join('wiki','note.md')),root),true,'库内笔记');
 // 空格与中文都要能过：链接里的 %20 与 '+' 两种编码在协议串解码后都是同一个路径
 assert.equal(isOwnVaultOpenURL(obsidianURI(root,'笔记 with space.md'),root),true,'空格与中文');
 // obsidianURI 自己就拒绝越界路径，所以越界串只能手工拼协议串来构造。
 const escape=target=>'obsidian://open?path='+encodeURIComponent(target);
 const cases=[
  [obsidianURI(path.join(path.sep,'elsewhere','other-vault')),root],
  [escape(path.join(root,'..','outside.md')),root],
  [obsidianURI(root,'wiki'+path.sep+'note.txt'),root],
  ['obsidian://new?name=bad',root],
  [obsidianURI(root)+'&vault=other',root],
  ['file:///etc/passwd',root],
  ['https://example.com',root],
  [obsidianURI(root),''],
  [null,root],
 ];
 for(const [raw,r] of cases) assert.equal(isOwnVaultOpenURL(raw,r),false,String(raw));
 // 目标路径是本库的兄弟目录（前缀相同但不是子目录）也必须拒绝
 assert.equal(isOwnVaultOpenURL(obsidianURI(root+'-other'),root),false,'前缀同名兄弟目录');
});

test('打开本库链接：未安装时报错，已安装时以可见窗口拉起且不隐藏',async t=>{
 const {vault}=await fixture(t);
 const uri=obsidianURI(vault);
 await assert.rejects(openObsidianUri(uri,{detected:{installed:false,executable:'',config:''}}),/未检测到 Obsidian/);
 const calls=[];
 const spawnProcess=(file,args,options)=>{
  const child=new EventEmitter();child.unref=()=>{child.detached=true};
  calls.push({file,args,options,child});queueMicrotask(()=>child.emit('spawn'));return child;
 };
 const r=await openObsidianUri(uri,{detected:{installed:true,executable:'C:/Obsidian/Obsidian.exe',config:''},spawnProcess});
 assert.equal(r.opened,true);assert.equal(r.uri,uri);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].args,[uri]);
 assert.equal(calls[0].options.windowsHide,false,'GUI 窗口必须可见，不能被 SW_HIDE 藏掉');
 assert.equal(calls[0].options.stdio,'ignore');assert.equal(calls[0].child.detached,true);
});
