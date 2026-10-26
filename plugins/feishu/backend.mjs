import {createPlugin} from './sdk.mjs';
import {createNotifier} from './service.mjs';
let notifier;
createPlugin({id:'fish.feishu',activate:async context=>{notifier=createNotifier({context});await notifier.view()},deactivate:async()=>{notifier=null},onEvent:row=>notifier.event(row),commands:{
 'feishu.layout':params=>notifier.layout(params.layout),
 'feishu.view':()=>notifier.view(),
 'feishu.save':params=>notifier.save(params),
 'feishu.test':()=>notifier.test(),
}});
