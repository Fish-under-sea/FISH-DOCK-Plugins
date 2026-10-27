import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildNpmPackages} from './build-npm-packages.mjs';
test('已有输出被拒绝，不递归删除源码或旧构建',async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'fish-npm-preserve-'));
 fs.writeFileSync(path.join(out,'keep.txt'),'keep');
 await assert.rejects(buildNpmPackages({dist:out,out}));
 assert.equal(fs.readFileSync(path.join(out,'keep.txt'),'utf8'),'keep');
});

test('按指定版本仅生成 Magpie npm 补丁包',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-npm-magpie-')),dist=path.join(root,'dist'),source=path.join(root,'source'),out=path.join(root,'out');
 fs.mkdirSync(dist);fs.mkdirSync(path.join(source,'licenses'),{recursive:true});
 fs.writeFileSync(path.join(dist,'magpie.fish-plugin'),'synthetic');
 for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md','licenses/Magpie.txt'])fs.writeFileSync(path.join(source,name),'synthetic');
 const result=await buildNpmPackages({dist,out,sourceRoot:source,version:'1.0.1',only:'magpie'});
 assert.deepEqual(result.packages.map(p=>p.id),['magpie']);
 const manifest=JSON.parse(fs.readFileSync(path.join(out,'magpie/package.json')));
 assert.equal(manifest.version,'1.0.1');assert.match(manifest.homepage,/v1\.0\.1$/);
 assert.match(fs.readFileSync(path.join(out,'magpie/README.md'),'utf8'),/magpie@1\.0\.1/);
 assert.deepEqual(fs.readdirSync(out),['magpie']);
});

test('按插件生成独立 npm 包，不带其他插件资源', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-npm-packages-'));
  const dist = path.join(root, 'dist');
  const source = path.join(root, 'source');
  const out = path.join(root, 'npm');
  fs.mkdirSync(dist, {recursive: true});
  fs.mkdirSync(path.join(source, 'licenses'), {recursive: true});
  for (const id of ['feishu', 'clash', 'magpie', 'ofm']) fs.writeFileSync(path.join(dist, `${id}.fish-plugin`), `${id} archive`);
  fs.writeFileSync(path.join(source, 'LICENSE'), 'MIT');
  fs.writeFileSync(path.join(source, 'THIRD_PARTY_NOTICES.md'), 'notices');
  fs.writeFileSync(path.join(source, 'licenses', 'mihomo.txt'), 'license');
  fs.writeFileSync(path.join(source, 'licenses', 'Magpie.txt'), 'license');
  await buildNpmPackages({dist, out, sourceRoot: source});
  const packageRoot = path.join(out, 'feishu');
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json')));
  assert.equal(manifest.name, '@fish-under-sea/fish-dock-plugin-feishu');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(fs.readFileSync(path.join(packageRoot, 'feishu.fish-plugin'), 'utf8'), 'feishu archive');
  assert.equal(fs.existsSync(path.join(packageRoot, 'clash.fish-plugin')), false);
  assert.equal(fs.existsSync(path.join(packageRoot, 'bin', 'install.mjs')), true);
});
