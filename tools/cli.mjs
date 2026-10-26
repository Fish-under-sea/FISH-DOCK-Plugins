#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const catalog=JSON.parse(await fs.readFile(new URL('../catalog/stable.json',import.meta.url),'utf8'));
const [command='list',key,...args]=process.argv.slice(2);
if(command==='list'){
 for(const entry of catalog.plugins)console.log(`${entry.id}\t${entry.version}\t${entry.name}`);
}else if(command==='download'){
 const entry=catalog.plugins.find(item=>item.id===key||item.id===`fish.${key}`);if(!entry)throw Error('未知插件，请先运行 list');
 const out=args.indexOf('--out');const directory=path.resolve(out>=0?args[out+1]:process.cwd());
 const response=await fetch(entry.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(`下载失败：HTTP ${response.status}`);
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>entry.bytes)throw Error('下载大小超出目录记录');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks),digest=createHash('sha256').update(bytes).digest('hex');if(size!==entry.bytes||digest!==entry.sha256)throw Error('下载文件大小或 SHA-256 不符');
 await fs.mkdir(directory,{recursive:true});const file=path.join(directory,`${entry.id.slice(5)}.fish-plugin`);await fs.writeFile(file,bytes,{flag:'wx'});console.log(`已校验：${file}\nSHA-256：${digest}`);
}else throw Error('用法：fish-dock-plugins list | download <feishu|clash|magpie|ofm> [--out <目录>]');
