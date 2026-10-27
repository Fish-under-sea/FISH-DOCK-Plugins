import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {crc32,deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {stage,definitions} from './stage-development.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function archive(root){
 const rows=[];function walk(relative=''){for(const item of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const name=relative?`${relative}/${item.name}`:item.name;if(item.isDirectory())walk(name);else if(item.isFile())rows.push([name,fs.readFileSync(path.join(root,name))]);else throw Error('包内包含链接');}}walk();
 const parts=[],directory=[];let offset=0;
 for(const [name,bytes] of rows){const n=Buffer.from(name),body=deflateRawSync(bytes,{level:9}),checksum=crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(checksum,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(n.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(checksum,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(offset,42);parts.push(local,n,body);directory.push(central,n);offset+=local.length+n.length+body.length;}
 const tail=Buffer.alloc(22),catalog=Buffer.concat(directory);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(rows.length,8);tail.writeUInt16LE(rows.length,10);tail.writeUInt32LE(catalog.length,12);tail.writeUInt32LE(offset,16);return Buffer.concat([...parts,catalog,tail]);
}
export function build(options){
 const version=options.version||'1.0.0';if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('版本格式无效');
 const selected=options.only?definitions.filter(d=>d.key===options.only):definitions;if(!selected.length)throw Error('未知插件');
 for(const definition of selected){
  const dependency={clash:'mihomo',magpie:'magpie',ofm:'ofm'}[definition.key];
  if(dependency&&!options[dependency])throw Error(`${definition.key} 缺少必需服务资源：--${dependency}`);
 }
 if(!options.out||!path.isAbsolute(options.out)||fs.existsSync(options.out))throw Error('请使用新的绝对输出目录');
 const tag=`v${version}`,out=path.resolve(options.out);const staged=path.join(out,'staged');stage({...options,out:staged});const dist=path.join(out,'dist');fs.mkdirSync(dist);
 const entries=[];
 for(const definition of selected){const root=path.join(staged,definition.key),manifest=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8'));manifest.version=version;
  fs.copyFileSync(path.join(repository,'LICENSE'),path.join(root,'LICENSE'));
  fs.copyFileSync(path.join(repository,'THIRD_PARTY_NOTICES.md'),path.join(root,'THIRD_PARTY_NOTICES.md'));
  const license=definition.key==='magpie'?'Magpie.txt':definition.key==='clash'?'mihomo.txt':null;
  if(license){fs.mkdirSync(path.join(root,'licenses'));fs.copyFileSync(path.join(repository,'licenses',license),path.join(root,'licenses',license));}
  fs.writeFileSync(path.join(root,'README.md'),`# ${definition.name}\n\n版本 ${version}；FISH Dock 1.1.0+；宿主 API 1；Windows x64。\n\n在 Dock 的插件页安装并启用；服务按需启动，账号与订阅由用户配置。停用与卸载保留资料。\n\n数据根由宿主解析，分类存于 ${definition.directory}；凭据不随安装包分发。\n`);
  manifest.files={};function inventory(relative=''){for(const item of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const name=relative?`${relative}/${item.name}`:item.name;if(item.isDirectory())inventory(name);else if(item.isFile()&&name!=='plugin.json')manifest.files[name]=hash(fs.readFileSync(path.join(root,name)));}}inventory();
  fs.writeFileSync(path.join(root,'plugin.json'),JSON.stringify(manifest,null,2)+'\n');
  const file=`${definition.key}.fish-plugin`,bytes=archive(root);fs.writeFileSync(path.join(dist,file),bytes);
  entries.push({id:manifest.id,name:manifest.name,description:`${manifest.name}独立插件`,author:'FISH',maintainer:'Fish-under-sea',version,hostApi:1,platform:'windows-x86_64',url:`https://github.com/Fish-under-sea/FISH-DOCK-Plugins/releases/download/${tag}/${file}`,sha256:hash(bytes),bytes:bytes.length,dependencies:['FISH Dock >=1.1.0','Node.js 24（宿主提供）']});
 }
 const catalog={schema:1,plugins:entries};fs.writeFileSync(path.join(dist,'stable.json'),JSON.stringify(catalog,null,2)+'\n');fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),entries.map(e=>`${e.sha256}  ${e.id.slice(5)}.fish-plugin`).join('\n')+'\n');return {dist,plugins:entries};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const options={};for(let i=2;i<process.argv.length;i+=2){if(!['--out','--sdk','--ofm','--magpie','--mihomo','--version','--only'].includes(process.argv[i])||!process.argv[i+1])throw Error('需要 --out --sdk，可选 --ofm --magpie --mihomo --version --only');options[process.argv[i].slice(2)]=['--version','--only'].includes(process.argv[i])?process.argv[i+1]:path.resolve(process.argv[i+1]);}console.log(JSON.stringify(build(options),null,2));}
