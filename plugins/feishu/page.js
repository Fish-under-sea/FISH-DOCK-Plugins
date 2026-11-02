/* 页面只调用自身命令；凭据读取结果仅含末尾标记。
   状态与空态通过 #status / #last 的 data-tone 交给 CSS 着色，
   不在脚本里拼 style，避免两套布局各写一份样式。 */
const $=id=>document.getElementById(id),flags=['enabled','waiting','done','error'];
const EMPTY_HINT='尚无发送记录 —— 先填好 Webhook 与签名密钥并保存，再点「发送测试通知」验证连通。';
let busy=false,configured=false;
const tone=(id,value)=>$(id).setAttribute('data-tone',value);
function setStatus(kind,text){
 $('status').setAttribute('role',kind==='bad'?'alert':'status');
 tone('status',kind);
 $('status').textContent=text;
}
function applyLayout(layout){
 document.querySelector('main').dataset.layout=layout;
 document.querySelectorAll('[data-layout]').forEach(button=>{if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.layout===layout))});
 FishDock.setLayout(layout);
}
for(const button of document.querySelectorAll('button[data-layout]'))button.onclick=async()=>{
 button.disabled=true;
 try{const value=await FishDock.call('feishu.layout',{layout:button.dataset.layout});applyLayout(value.layout)}
 catch{setStatus('bad','布局保存失败，请重试')}
 finally{button.disabled=false}
};
function paint(view){
 applyLayout(view.layout||'single');
 configured=view.configured;
 for(const key of flags)$(key).checked=!!view[key];
 $('webhook').value='';$('secret').value='';$('clearSecret').checked=false;
 $('saved').textContent=view.configError||(view.configured?`已配置 ${view.webhookTail}，${view.signing?'已启用签名':'未设置签名'}`:'尚未配置群机器人');
 tone('saved',view.configError?'bad':'muted');
 $('test').disabled=!view.configured;
 const last=view.last;
 tone('last',last?(last.ok?'ok':'bad'):'empty');
 $('last').textContent=last?`${last.ok?'发送成功':'发送失败'} · ${new Date(last.at).toLocaleString()} · ${last.code}`:EMPTY_HINT;
}
/* action 返回字符串即成功文案，返回 {tone:'bad',text} 时按失败着色。 */
/* refocus：需要在解禁之后才落焦点的目标。run() 一开始就把 fieldset 禁用，
   禁用的按钮收不到焦点——在 action 里直接 focus() 会落到 BODY（t6 实测）。 */
let refocus=null;
async function run(action){
 if(busy)return;
 busy=true;$('fields').disabled=true;setStatus('busy','正在处理…');
 try{
  const outcome=await action();
  const failed=!!outcome&&outcome.tone==='bad';
  setStatus(failed?'bad':'ok',typeof outcome==='string'?outcome:(outcome&&outcome.text)||'配置已读取');
 }catch{
  setStatus('bad','操作失败，请检查配置、网络和插件运行状态。');
 }finally{
  busy=false;$('fields').disabled=false;$('test').disabled=!configured;
  // 解禁之后再聚焦：顺序反了就是「focus 打在禁用元素上 → activeElement 变 BODY」。
  if(refocus){const target=$(refocus);refocus=null;target?.focus()}
 }
}
$('settings').addEventListener('submit',event=>{
 event.preventDefault();
 void run(async()=>{
  const config=Object.fromEntries(flags.map(key=>[key,$(key).checked]));
  Object.assign(config,{webhook:$('webhook').value,secret:$('secret').value,clearSecret:$('clearSecret').checked});
  paint(await FishDock.call('feishu.save',config));
  return '配置已保存';
 });
});
$('test').onclick=()=>run(async()=>{
 const answer=await FishDock.call('feishu.test');
 paint(await FishDock.call('feishu.view'));
 if(!answer.ok)return {tone:'bad',text:`测试发送失败，错误码：${answer.code}`};
 return '测试通知已发送';
});
$('refresh').onclick=()=>run(async()=>paint(await FishDock.call('feishu.view')));
/* 清除两步确认：打开时焦点落在「取消」，Esc 与取消都退回「清除」按钮；
   确认后由 run() 的 finally 在解禁之后把焦点放回「清除」（见上面的 refocus）。 */
function setExpanded(open){$('clear').setAttribute('aria-expanded',String(open))}
function openClear(){$('clear-confirm').hidden=false;setExpanded(true);$('cancel-clear').focus()}
function closeClear(){$('clear-confirm').hidden=true;setExpanded(false);$('clear').focus()}
$('clear').onclick=openClear;
$('cancel-clear').onclick=closeClear;
$('clear-confirm').onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeClear()}};
$('confirm-clear').onclick=()=>run(async()=>{
 const settings=Object.fromEntries(flags.map(key=>[key,$(key).checked]));
 paint(await FishDock.call('feishu.save',{...settings,enabled:false,clear:true}));
 $('clear-confirm').hidden=true;
 setExpanded(false);
 refocus='clear';
 return '机器人凭据已清除，自动通知已关闭';
});
void run(async()=>paint(await FishDock.call('feishu.view')));