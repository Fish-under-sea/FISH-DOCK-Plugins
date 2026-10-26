import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildNpmPackages} from './build-npm-packages.mjs';

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
