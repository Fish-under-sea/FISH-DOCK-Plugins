import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import {archive,build} from './build-release.mjs';
import {definitions, stage} from './stage-development.mjs';
test('发行清单不包含开发探针',()=>{
 assert.equal(definitions.some(definition=>definition.key==='relay-probe'),false);
});
test('stage 只输出选中的插件，并写入正确的 manifest 文件哈希',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'fish-stage-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const sdk=path.join(base,'sdk');fs.mkdirSync(path.join(sdk,'node'),{recursive:true});fs.mkdirSync(path.join(sdk,'browser'),{recursive:true});
 const sdkSource='export const sdk = true;\n';fs.writeFileSync(path.join(sdk,'node','plugin.mjs'),sdkSource);fs.writeFileSync(path.join(sdk,'browser','bridge.js'),'window.FishDock = {};\n');
 const devOut=path.join(base,'dev');stage({out:devOut,sdk,include:['relay-probe']});
 assert.equal(fs.existsSync(path.join(devOut,'feishu')),false);assert.equal(fs.existsSync(path.join(devOut,'relay-probe','plugin.json')),true);
 const manifest=JSON.parse(fs.readFileSync(path.join(devOut,'relay-probe','plugin.json'),'utf8'));
 assert.equal(manifest.id,'fish.relay-probe');assert.equal(manifest.backend.entry,'plugins/relay-probe/backend.mjs');assert.equal(manifest.pages[0].entry,'plugins/relay-probe/page.html');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(manifest.files['plugins/relay-probe/probe.mjs'],hash(fs.readFileSync(new URL('../plugins/relay-probe/probe.mjs',import.meta.url))));
 assert.equal(manifest.files['plugins/relay-probe/sdk.mjs'],hash(sdkSource));
 const dev=JSON.parse(fs.readFileSync(path.join(devOut,'development.json'),'utf8'));assert.deepEqual(dev.plugins.map(plugin=>plugin.id),['fish.relay-probe']);
 const releaseOut=path.join(base,'release');stage({out:releaseOut,sdk,include:definitions.map(definition=>definition.key)});
 assert.equal(fs.existsSync(path.join(releaseOut,'relay-probe')),false);
 const release=JSON.parse(fs.readFileSync(path.join(releaseOut,'development.json'),'utf8'));assert.deepEqual(release.plugins.map(plugin=>plugin.id),definitions.map(definition=>`fish.${definition.key}`));
});
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
