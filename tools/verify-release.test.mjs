import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build,archive} from './build-release.mjs';
import {buildNpmPackages} from './build-npm-packages.mjs';
import {verifyArchive,verifyRelease} from './verify-release.mjs';
test('真实 ZIP 逐资源和 npm 字节核验，篡改清单资源或 npm 副本被拒绝',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-verify-')),sdk=path.join(root,'sdk');
 for(const name of ['node/plugin.mjs','browser/bridge.js']){
  const file=path.join(sdk,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic-sdk');
 }
 const result=build({out:path.join(root,'build'),sdk,only:'feishu'});
 const npm=path.join(root,'npm');await buildNpmPackages({dist:result.dist,out:npm,only:'feishu'});
 assert.equal(verifyRelease({dist:result.dist,npm}).plugins[0].id,'fish.feishu');
 fs.appendFileSync(path.join(npm,'feishu/feishu.fish-plugin'),'modified');
 assert.throws(()=>verifyRelease({dist:result.dist,npm}),/npm/);
 const staged=path.join(root,'build/staged/feishu');
 fs.appendFileSync(path.join(staged,'plugins/feishu/page.js'),'modified');
 assert.throws(()=>verifyArchive(archive(staged)),/摘要/);
});
