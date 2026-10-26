import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createNotifier} from './service.mjs';
function fixture(response={code:0}) {
  const disk=new Map(),calls=[],writes=[];let now=1700000000000;
  const context={storage:{read:async(c,n)=>disk.get(`${c}/${n}`)??null,write:async(c,n,v)=>{writes.push([c,n,v]);disk.set(`${c}/${n}`,v)}},secrets:{read:async(c,n)=>disk.get(`protected/${c}/${n}`)??null,write:async(c,n,v)=>{writes.push(['protected',c,n]);disk.set(`protected/${c}/${n}`,v)}}};
  const service=createNotifier({context,clock:()=>now,fetch:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>response}}});
  return {service,disk,calls,writes,advance:ms=>{now+=ms}};
}
const config={webhook:'https://open.feishu.cn/open-apis/bot/v2/hook/synthetic-token',secret:'synthetic-signature',enabled:true,waiting:true,done:false,error:true};
test('凭据写加密分类，配置写配置分类，视图隐藏密钥，空输入保留已有密钥',async()=>{
 const f=fixture();await f.service.save(config);const view=await f.service.view();
 assert.equal(view.configured,true);assert.equal(view.done,false);assert.equal(view.signing,true);
 assert.ok(!JSON.stringify(view).includes('synthetic-'));assert.equal(f.disk.has('protected/credentials/robot.json'),true);assert.equal(f.disk.has('config/notifications.json'),true);
 await f.service.save({enabled:false,waiting:true,done:true,error:true,webhook:'',secret:''});assert.equal((await f.service.view()).configured,true);
});
test('测试消息带飞书签名，业务非零响应视为失败，反馈中无凭据',async()=>{
 const f=fixture({code:19024,msg:'synthetic-secret'});await f.service.save(config);const result=await f.service.test();
 assert.equal(result.ok,false);assert.equal(result.code,'19024');assert.ok(!JSON.stringify(result).includes('synthetic'));
 const request=f.calls[0],body=JSON.parse(request.body);assert.equal(request.redirect,'error');assert.equal(body.timestamp,'1700000000');
 assert.equal(body.sign,createHmac('sha256','1700000000\nsynthetic-signature').update('').digest('base64'));
});
test('筛选独立于桌面通知，事件带工作区仓库并去重、限流',async()=>{
 const f=fixture();await f.service.save(config);
 const event={type:'agent.alert',mood:'waiting',project:'fish',workspace:'D:/work/fish',repo:'fish/repo',session:'test'};
 assert.equal((await f.service.event({...event,mood:'done'})).skipped,'filtered');
 assert.equal((await f.service.event(event)).ok,true);assert.equal((await f.service.event(event)).skipped,'duplicate');
 assert.match(JSON.parse(f.calls[0].body).content.text,/D:\/work\/fish/);assert.match(JSON.parse(f.calls[0].body).content.text,/fish\/repo/);
 for(let i=1;i<20;i++){f.advance(1);assert.equal((await f.service.event({...event,session:`test${i}`})).ok,true)}
 assert.equal((await f.service.event({...event,session:'limit'})).skipped,'rate-limit');
});
test('清除后恢复未配置，保存失败恢复旧凭据与开关',async()=>{
 const f=fixture();await f.service.save(config);await f.service.save({...config,clear:true});assert.equal((await f.service.view()).configured,false);
 await f.service.save(config);const old=f.disk.get('protected/credentials/robot.json');const previous=f.disk.get('config/notifications.json');
 const storage={read:async(c,n)=>f.disk.get(`${c}/${n}`)??null,write:async()=>{throw Error('write-failed')}};
 const secrets={read:async(c,n)=>f.disk.get(`protected/${c}/${n}`)??null,write:async(c,n,v)=>{f.disk.set(`protected/${c}/${n}`,v)}};
 const service=createNotifier({context:{storage,secrets}});await assert.rejects(service.save({...config,webhook:config.webhook+'-new',enabled:false}));
 assert.equal(f.disk.get('protected/credentials/robot.json'),old);assert.equal(f.disk.get('config/notifications.json'),previous);
});
test('发送前完整验证配置，无效地址既不保存也不发送，错误和网络失败不回显密钥',async()=>{
 const f=fixture();await assert.rejects(f.service.save({...config,webhook:'https://open.feishu.cn.evil.test/open-apis/bot/v2/hook/token'}));assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
 await assert.rejects(f.service.save({...config,waiting:'true'}));assert.equal(f.writes.length,0);
 const disk=new Map();const context={storage:{read:async()=>null,write:async()=>{}},secrets:{read:async()=>disk.get('robot'),write:async(c,n,v)=>disk.set('robot',v)}};
 const service=createNotifier({context,fetch:async()=>{throw Error('synthetic-token')}});await service.save(config);const answer=await service.test();assert.equal(answer.ok,false);assert.equal(answer.code,'NETWORK');assert.ok(!JSON.stringify(answer).includes('synthetic'));
});
