/* 页面只调用自身命令；凭据读取结果仅含末尾标记。 */
const $=id=>document.getElementById(id),flags=['enabled','waiting','done','error'];
let busy=false,configured=false;
function applyLayout(layout){document.querySelector('main').dataset.layout=layout;document.querySelectorAll('[data-layout]').forEach(button=>{if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.layout===layout))});FishDock.setLayout(layout)}
for(const button of document.querySelectorAll('button[data-layout]'))button.onclick=async()=>{button.disabled=true;try{const value=await FishDock.call('feishu.layout',{layout:button.dataset.layout});applyLayout(value.layout)}catch{$('status').textContent='布局保存失败，请重试'}finally{button.disabled=false}};
function paint(view){applyLayout(view.layout||'single');configured=view.configured;for(const key of flags)$(key).checked=!!view[key];$('webhook').value='';$('secret').value='';$('clearSecret').checked=false;$('saved').textContent=view.configError||(view.configured?`已配置 ${view.webhookTail}，${view.signing?'已启用签名':'未设置签名'}`:'尚未配置群机器人');$('test').disabled=!view.configured;const last=view.last;$('last').textContent=last?`${last.ok?'发送成功':'发送失败'} · ${new Date(last.at).toLocaleString()} · ${last.code}`:'尚无发送记录'}
async function run(action){if(busy)return;busy=true;$('fields').disabled=true;$('status').setAttribute('role','status');$('status').textContent='正在处理…';try{const message=await action();$('status').textContent=message||'配置已读取'}catch{$('status').setAttribute('role','alert');$('status').textContent='操作失败，请检查配置、网络和插件运行状态。'}finally{busy=false;$('fields').disabled=false;$('test').disabled=!configured}}
$('settings').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const config=Object.fromEntries(flags.map(key=>[key,$(key).checked]));Object.assign(config,{webhook:$('webhook').value,secret:$('secret').value,clearSecret:$('clearSecret').checked});paint(await FishDock.call('feishu.save',config));return '配置已保存'})});
$('test').onclick=()=>run(async()=>{const answer=await FishDock.call('feishu.test');paint(await FishDock.call('feishu.view'));if(!answer.ok){$('status').setAttribute('role','alert');return `测试发送失败，错误码：${answer.code}`}return '测试通知已发送'});
$('refresh').onclick=()=>run(async()=>paint(await FishDock.call('feishu.view')));
$('clear').onclick=()=>{$('clear-confirm').hidden=false;$('cancel-clear').focus()};
$('cancel-clear').onclick=()=>{$('clear-confirm').hidden=true;$('clear').focus()};
$('confirm-clear').onclick=()=>run(async()=>{
 const settings=Object.fromEntries(flags.map(key=>[key,$(key).checked]));
 paint(await FishDock.call('feishu.save',{...settings,enabled:false,clear:true}));
 $('clear-confirm').hidden=true;return '机器人凭据已清除，自动通知已关闭';
});
void run(async()=>paint(await FishDock.call('feishu.view')));
