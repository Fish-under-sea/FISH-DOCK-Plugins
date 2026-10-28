import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_GATEWAY_PORT,gatewayAddr,gatewayHost,gatewayPortCandidates,readMagpiePrefs} from './network.mjs';

async function dataWith(contents){
 const root=await fs.mkdtemp(path.join(process.env.FISH_TEST_TMP||os.tmpdir(),'magpie-network-'));
 if(contents!==undefined)await fs.writeFile(path.join(root,'settings.json'),contents,'utf8');
 return root;
}

test('没有设置文件时按未共享、没有保存端口处理',async()=>{
 assert.deepEqual(await readMagpiePrefs(await dataWith()),{lan:false,port:0});
});

test('读到 lan 与保存的端口，带 BOM 的设置也能读',async()=>{
 const root=await dataWith('\uFEFF'+JSON.stringify({lan:true,port:3480,theme:'dark'}));
 assert.deepEqual(await readMagpiePrefs(root),{lan:true,port:3480});
});

test('lan 只看布尔真值，端口越界或非整数按没有处理',async()=>{
 for(const [body,want] of [
  [{lan:'true',port:3480},{lan:false,port:3480}],
  [{lan:1},{lan:false,port:0}],
  [{lan:true,port:80},{lan:true,port:0}],
  [{lan:true,port:70000},{lan:true,port:0}],
  [{lan:true,port:'3480'},{lan:true,port:0}],
  [[],{lan:false,port:0}],
  [null,{lan:false,port:0}],
 ])assert.deepEqual(await readMagpiePrefs(await dataWith(JSON.stringify(body))),want,JSON.stringify(body));
});

test('设置文件损坏时退回默认，不抛错',async()=>{
 assert.deepEqual(await readMagpiePrefs(await dataWith('{not json')),{lan:false,port:0});
});

test('绑定范围只由共享开关决定',()=>{
 assert.equal(gatewayHost(true),'0.0.0.0');
 assert.equal(gatewayHost(false),'127.0.0.1');
 assert.equal(gatewayAddr(gatewayHost(true),3426),'0.0.0.0:3426');
});

test('候选端口按保存端口、Magpie 端口、默认端口排序并排除占用与重复',()=>{
 assert.deepEqual(gatewayPortCandidates({configured:3490,prefs:{port:3500},taken:[]}),[3490,3500,DEFAULT_GATEWAY_PORT]);
 assert.deepEqual(gatewayPortCandidates({configured:0,prefs:{port:0},taken:[]}),[DEFAULT_GATEWAY_PORT]);
 // 服务端口和网页上游端口必须让开
 assert.deepEqual(gatewayPortCandidates({configured:3425,prefs:{port:3490},taken:[3425,3490]}),[DEFAULT_GATEWAY_PORT]);
 assert.deepEqual(gatewayPortCandidates({configured:3426,prefs:{port:3426},taken:[]}),[3426]);
 // 非法值不进候选，只剩默认端口
 assert.deepEqual(gatewayPortCandidates({configured:'3490',prefs:{port:0}}),[DEFAULT_GATEWAY_PORT]);
});