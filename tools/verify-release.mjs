import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)throw Error(message)};

// Read standard non-ZIP64 archives produced by this repository without extracting.
export function readArchive(bytes) {
 const files=new Map();let offset=0,total=0;
 while(offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50) {
  check(offset+30<=bytes.length,'ZIP 文件头截断');
  const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8);
  const checksum=bytes.readUInt32LE(offset+14),packed=bytes.readUInt32LE(offset+18),size=bytes.readUInt32LE(offset+22);
  const length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),body=offset+30+length+extra;
  check(!(flags&9)&&[0,8].includes(method),'ZIP 加密、流描述或压缩格式不支持');
  check(body+packed<=bytes.length&&size<=128*1024*1024,'ZIP 资源长度无效');
  const name=bytes.subarray(offset+30,offset+30+length).toString('utf8');
  check(name&&!name.includes('\\')&&!name.includes(':')&&!name.split('/').some(p=>!p||p==='.'||p==='..'),'ZIP 资源路径无效');
  check(!files.has(name),'ZIP 重复资源');
  const content=method===0?bytes.subarray(body,body+packed):inflateRawSync(bytes.subarray(body,body+packed),{maxOutputLength:128*1024*1024});
  check(content.length===size&&crc32(content)===checksum,`ZIP CRC 或长度错误：${name}`);
  total+=size;check(total<=512*1024*1024,'ZIP 展开大小超过限额');
  files.set(name,content);offset=body+packed;
 }
 check(files.size>0&&offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x02014b50,'ZIP 中央目录缺失');
 check(bytes.length>=22&&bytes.readUInt32LE(bytes.length-22)===0x06054b50,'ZIP 结尾缺失');
 check(bytes.readUInt16LE(bytes.length-12)===files.size,'ZIP 资源数量不一致');
 return files;
}
export function verifyArchive(bytes) {
 const files=readArchive(bytes);
 check(files.has('plugin.json'),'插件清单缺失');
 const manifest=JSON.parse(files.get('plugin.json').toString('utf8'));
 check(manifest.schema===1&&manifest.hostApi===1&&manifest.files&&typeof manifest.files==='object','插件清单格式无效');
 check(Object.keys(manifest.files).length===files.size-1,'清单未完整列出资源');
 for(const [name,digest]of Object.entries(manifest.files)){
  check(name!=='plugin.json'&&files.has(name),`清单资源缺失：${name}`);
  check(hash(files.get(name))===digest,`资源摘要错误：${name}`);
 }
 for(const entry of [manifest.backend?.entry,...(manifest.pages||[]).map(page=>page.entry)])check(typeof entry==='string'&&files.has(entry),`插件入口缺失：${entry}`);
 // Validate each local HTML resource reference against the actual packed files.
 for(const page of manifest.pages||[]){
  const html=files.get(page.entry).toString('utf8');
  for(const [,reference]of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)){
   check(!/^(?:[a-z]+:|\/)/i.test(reference),'页面引用了非本地资源');
   const relative=path.posix.normalize(path.posix.join(path.posix.dirname(page.entry),reference));
   check(files.has(relative),`页面资源缺失：${relative}`);
  }
 }
 const required={
  'fish.clash':'service/mihomo.exe',
  'fish.magpie':'service/magpie.exe',
  'fish.ofm':'service/packages/desktop/service-host.mjs',
 }[manifest.id];
 if(required)check(files.has(required),`服务入口缺失：${required}`);
 return {id:manifest.id,version:manifest.version,files:files.size,bytes:bytes.length,sha256:hash(bytes)};
}
export function verifyRelease({dist,npm}) {
 const catalog=JSON.parse(fs.readFileSync(path.join(dist,'stable.json'),'utf8'));
 const sums=new Map(fs.readFileSync(path.join(dist,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/).map(line=>{
  const match=/^([a-f0-9]{64})  ([a-z]+\.fish-plugin)$/.exec(line);check(match,'摘要列表格式无效');return [match[2],match[1]];
 }));
 const results=[];
 for(const entry of catalog.plugins){
  check(/^fish\.(feishu|clash|magpie|ofm)$/.test(entry.id),'目录插件 ID 无效');
  const key=entry.id.slice(5),name=`${key}.fish-plugin`,bytes=fs.readFileSync(path.join(dist,name)),result=verifyArchive(bytes);
  check(result.id===entry.id&&result.version===entry.version,'包和目录的身份或版本不一致');
  check(result.sha256===entry.sha256&&result.sha256===sums.get(name)&&result.bytes===entry.bytes,'归档与目录/摘要列表不一致');
  if(npm){
   check(hash(fs.readFileSync(path.join(npm,key,name)))===result.sha256,'npm 与插件归档字节不一致');
   const pkg=JSON.parse(fs.readFileSync(path.join(npm,key,'package.json'),'utf8'));
   check(pkg.version===entry.version&&pkg.name===`@fish-under-sea/fish-dock-plugin-${key}`,'npm 包身份或版本不一致');
  }
  results.push(result);
 }
 check(results.length>0&&results.length===sums.size,'目录与摘要条目数量不一致');
 return {scope:'local-artifacts-only',plugins:results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};
 for(let i=2;i<process.argv.length;i+=2){check(['--dist','--npm'].includes(process.argv[i])&&process.argv[i+1],'参数：--dist <目录> [--npm <目录>]');options[process.argv[i].slice(2)]=path.resolve(process.argv[i+1]);}
 check(options.dist,'必须指定 --dist');
 console.log(JSON.stringify(verifyRelease(options),null,2));
}
