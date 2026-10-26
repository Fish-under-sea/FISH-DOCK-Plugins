import test from 'node:test';
import assert from 'node:assert/strict';
import {createClash} from './service.mjs';
function fixture(){
 const disk=new Map(),requests=[];let up=false,stopped=0,owned=null;
 const context={dataDirectory:'D:/synthetic/.fish-dock/.fishplugin-clash',storage:{read:async(c,n)=>disk.get(`${c}/${n}`)??null,write:async(c,n,v)=>disk.set(`${c}/${n}`,v)},secrets:{read:async(c,n)=>disk.get(`secret/${c}/${n}`)??null,write:async(c,n,v)=>disk.set(`secret/${c}/${n}`,v)}};
 const request=async(path,options={})=>{requests.push({path,...options});if(!up)throw Error('offline');return path==='/version'?{version:'synthetic'}:path==='/proxies'?{proxies:{PROXY:{type:'Selector',now:'one',all:['one','two']},one:{type:'Shadowsocks',history:[{delay:20}]},two:{type:'Shadowsocks',history:[]}}}:path==='/configs'?{mode:'rule'}:path==='/connections'?{connections:[]}:{};};
 const runtime={start:async config=>{up=true;owned=config;return {stop:async()=>{stopped++;up=false},alive:()=>up}},proxy:{enable:async()=>{},restore:async()=>{}}};
 const service=createClash({context,request,runtime});return {service,disk,requests,up:()=>up,stopped:()=>stopped,owned:()=>owned};
}
const config={kernel:'D:/synthetic/mihomo.exe',subscription:'https://example.test/sub?token=synthetic',mixedPort:7895,controllerPort:9099};
test('Clash 初始等待配置，布局持久化但切换不启动内核',async()=>{
 const f=fixture();assert.equal((await f.service.view()).running,false);await f.service.layout({layout:'double'});assert.equal((await f.service.view()).layout,'double');assert.equal(f.up(),false);await assert.rejects(f.service.layout({layout:'grid'}));
});
test('Clash 凭据分类保存、启动反馈、节点切换与布局共享状态',async()=>{
 const f=fixture();await f.service.save(config);assert.ok(!f.disk.get('config/clash.json').includes('token=synthetic'));assert.ok(f.disk.get('secret/credentials/subscription.json'));
 await f.service.start();const view=await f.service.view();assert.equal(view.running,true);assert.equal(view.groups[0].name,'PROXY');assert.equal(view.groups[0].nodes[0].delay,20);assert.ok(!JSON.stringify(view).includes('token=synthetic'));
 await f.service.select({group:'PROXY',name:'two'});assert.deepEqual(f.requests.filter(r=>r.method==='PUT').at(-1).body,{name:'two'});assert.equal(f.requests.filter(r=>r.method==='PUT').at(-1).method,'PUT');await assert.rejects(f.service.select({group:'PROXY',name:'foreign'}));
 await f.service.layout({layout:'double'});assert.equal(f.stopped(),0);await f.service.stop();assert.equal(f.stopped(),1);assert.equal((await f.service.view()).running,false);
});
test('Clash 配置变化不静默重启、订阅重载只更新 provider',async()=>{
 const f=fixture();await f.service.save(config);await f.service.start();await assert.rejects(f.service.save({...config,mixedPort:7896}));await f.service.reload();assert.equal(f.requests.filter(r=>r.method==='PUT').at(-1).path,'/providers/proxies/subscription');assert.equal(f.requests.filter(r=>r.method==='PUT').at(-1).method,'PUT');assert.equal(f.stopped(),0);await f.service.stop();
});
test('Clash 无效端口及 URL 在持久化或启动前报错',async()=>{
 const f=fixture();for(const bad of [{...config,mixedPort:9099},{...config,controllerPort:0},{...config,subscription:'file:///etc/passwd'}])await assert.rejects(f.service.save(bad));assert.equal(f.disk.size,0);assert.equal(f.up(),false);
});
