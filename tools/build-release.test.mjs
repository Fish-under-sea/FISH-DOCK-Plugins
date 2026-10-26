import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inflateRawSync,crc32} from 'node:zlib';
import {archive} from './build-release.mjs';
test('发行 ZIP 使用标准 deflate、UTF-8 文件名、CRC 和固定时间',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-release-'));
 fs.writeFileSync(path.join(root,'中文.txt'),'合成资源');
 const first=archive(root),second=archive(root);assert.deepEqual(first,second);
 assert.equal(first.readUInt32LE(0),0x04034b50);assert.equal(first.readUInt16LE(8),8);
 const size=first.readUInt32LE(18),length=first.readUInt16LE(26),name=first.subarray(30,30+length).toString();
 assert.equal(name,'中文.txt');const content=inflateRawSync(first.subarray(30+length,30+length+size));assert.equal(content.toString(),'合成资源');assert.equal(crc32(content),first.readUInt32LE(14));
 const end=first.length-22;assert.equal(first.readUInt32LE(end),0x06054b50);assert.equal(first.readUInt16LE(end+10),1);assert.equal(first.readUInt32LE(first.readUInt32LE(end+16)),0x02014b50);
});
