import test from 'node:test';
import assert from 'node:assert/strict';
import {startChild,isolatedEnvironment} from './child.mjs';
test('OFM 隔离环境的临时目录跟随插件数据根',()=>{
 const env=isolatedEnvironment({home:'D:/中文 资料/profile',credentials:'D:/中文 资料/credentials',config:'D:/中文 资料/config',cache:'D:/中文 资料/tmp',key:''});
 assert.equal(env.TEMP,'D:/中文 资料/tmp');assert.equal(env.TMP,env.TEMP);
 assert.equal(env.HOME,'D:/中文 资料/profile');assert.equal(env.NODE_OPTIONS,undefined);
});

test('就绪输出按分片累积，真实合成子进程可停止且重复停止幂等',async()=>{
 const instance=await startChild({executable:process.execPath,
  args:['-e',`process.stdout.write('REA');setTimeout(()=>process.stdout.write('DY'),20);setTimeout(()=>process.exit(),10000)`],
  ready:text=>text.includes('READY'),probe:async()=>true,timeout:5000});
 assert.equal(instance.alive(),true);
 await Promise.all([instance.stop(),instance.stop()]);
 assert.equal(instance.alive(),false);
});
test('启动失败只暴露固定错误码，不暴露参数或上游日志',async()=>{
 await assert.rejects(startChild({executable:process.execPath,
  args:['-e',`console.error('secret-synthetic');process.exit(2)`],
  ready:()=>false,probe:async()=>false,timeout:5000}),
  error=>error.code==='EARLY_EXIT'&&!error.message.includes('secret-synthetic'));
});
test('启动期间取消会回收未就绪的真实合成子进程',async()=>{
 const controller=new AbortController();
 let pid;
 const task=startChild({executable:process.execPath,args:['-e',`console.log(process.pid);setTimeout(()=>process.exit(),10000)`],
  signal:controller.signal,ready:text=>{pid=Number(text.trim());controller.abort();return false},
  probe:async()=>false,timeout:5000});
 await assert.rejects(task,{name:'AbortError'});
 assert.ok(pid>0);
 assert.throws(()=>process.kill(pid,0));
});
