import fs from 'node:fs';
import path from 'node:path';
// OFM 单文件可能同时含上游配置和密钥，按最高敏感等级放在 keys 中。
export function fishRelative(name){
 if(typeof name!=='string'||/[\\:\x00-\x1f]/.test(name)||name.split('/').some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x))||path.isAbsolute(name))throw Error('OFM 数据路径无效');
 const category=name==='settings.json'?'keys':name==='channel-pack/state.json'?'roster':/^(channel-credentials\.json|eac-user\.json|channel-pack\/gemini-sigs\.json)$/.test(name)?'credentials':name==='service.lock'||name.includes('cache')?'tmp':'config';
 return `${category}/${name}`;
}
export function fishDataPath(root,name){
 if(!path.isAbsolute(root))throw Error('OFM 数据根目录须为绝对路径');
 const target=path.join(root,fishRelative(name));
 for(let current=target;current!==path.dirname(current);current=path.dirname(current)){
  try{if(fs.lstatSync(current).isSymbolicLink())throw Error('OFM 数据路径含链接')}catch(error){if(error.code!=='ENOENT')throw error}
 }
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});return target;
}
