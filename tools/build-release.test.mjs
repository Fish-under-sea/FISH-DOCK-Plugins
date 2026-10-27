import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inflateRawSync,crc32} from 'node:zlib';
import {archive,build} from './build-release.mjs';
test('单独发布 Magpie 补丁，清单和目录版本一致',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-magpie-release-')),sdk=path.join(root,'sdk');
 for(const name of ['node/plugin.mjs','browser/bridge.js']){const file=path.join(sdk,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic-sdk');}
 const magpie=path.join(root,'magpie.exe');fs.writeFileSync(magpie,'synthetic-binary');
 const result=build({out:path.join(root,'out'),sdk,magpie,version:'1.0.1',only:'magpie'});
 assert.deepEqual(result.plugins.map(p=>p.id),['fish.magpie']);
 assert.equal(result.plugins[0].version,'1.0.1');
 assert.match(result.plugins[0].url,/\/v1\.0\.1\/magpie\.fish-plugin$/);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'out/staged/magpie/plugin.json')));
 assert.equal(manifest.version,'1.0.1');assert.ok(manifest.files['plugins/magpie/environment.mjs']);
 assert.deepEqual(fs.readdirSync(result.dist).sort(),['SHA256SUMS.txt','magpie.fish-plugin','stable.json']);
 assert.deepEqual(fs.readdirSync(path.join(root,'out/staged')).sort(),['development.json','magpie']);
});
test('发行构建缺少必需运行时会在创建输出前失败',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-missing-runtime-'));
 const out=path.join(root,'out');
 assert.throws(()=>build({out,sdk:root,only:'clash'}),/mihomo/);
 assert.equal(fs.existsSync(out),false);
});
test('发行 ZIP 使用标准 deflate、UTF-8 文件名、CRC 和固定时间',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-release-'));
 fs.writeFileSync(path.join(root,'中文.txt'),'合成资源');
 const first=archive(root),second=archive(root);assert.deepEqual(first,second);
 assert.equal(first.readUInt32LE(0),0x04034b50);assert.equal(first.readUInt16LE(8),8);
 const size=first.readUInt32LE(18),length=first.readUInt16LE(26),name=first.subarray(30,30+length).toString();
 assert.equal(name,'中文.txt');const content=inflateRawSync(first.subarray(30+length,30+length+size));assert.equal(content.toString(),'合成资源');assert.equal(crc32(content),first.readUInt32LE(14));
 const end=first.length-22;assert.equal(first.readUInt32LE(end),0x06054b50);assert.equal(first.readUInt16LE(end+10),1);assert.equal(first.readUInt32LE(first.readUInt32LE(end+16)),0x02014b50);
});
