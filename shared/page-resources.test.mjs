import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const entry of ['shared/gateway-page.html','plugins/feishu/page.html','plugins/clash/page.html','plugins/relay-probe/page.html']){
 test(`${entry} 的本地脚本与样式均有对应资源`,()=>{
  const file=path.join(root,entry),html=fs.readFileSync(file,'utf8');
  const references=[...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(references.length>0);
  for(const reference of references){
   assert.ok(!reference.includes('://'));
   // 缓存击中用的 ?v=… 只是查询串，不是文件名的一部分；剥离后再判存在。
   const target=reference.split(/[?#]/)[0];
   assert.ok(fs.existsSync(path.resolve(path.dirname(file),target)),`${entry} 引用了缺失资源 ${reference}`);
  }
 });
}
