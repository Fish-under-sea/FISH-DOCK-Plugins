import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

export async function checkVault({data,origin,cookie,gatewayPort}){
 const cfg=JSON.parse(await fs.readFile(path.join(data,'fish-obsidian-connection.json'),'utf8'));
 assert.equal(cfg.vault,path.join(data,'knowledge','github-capability-vault'));
 const headers={authorization:`Bearer ${cfg.token}`,'content-type':'application/json'};
 const call=async(route,body)=>{
  const response=await fetch(new URL(route,cfg.url),{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
  if(response.status!==200)assert.fail(`Vault ${route}: ${response.status} ${await response.text()}`);
  return response.json();
 };
 await fs.mkdir(path.join(cfg.vault,'wiki'),{recursive:true});
 const note=path.join(cfg.vault,'wiki','fixture.md');
 await fs.writeFile(note,'# Independent vault\nfixture-knowledge-needle '+ 'Long knowledge stays a note. '.repeat(100));
 let search=await call('/search',{q:'fixture-knowledge-needle'});
 assert.ok(search.hits.some(h=>h.type==='note'&&h.path==='wiki/fixture.md'));
 assert.equal((await fetch(new URL('/search',cfg.url),{method:'POST',headers:{'content-type':'application/json'},body:'{"q":"needle"}'})).status,401);
 await call('/memory',{text:'fixture short memory remains a review candidate'});
 const view=await (await fetch(origin+'/api/memory',{headers:{cookie}})).json();
 const short=view.memories.find(m=>m.text==='fixture short memory remains a review candidate');
 assert.equal(short?.status,'candidate');
 assert.equal(await fs.readFile(path.join(cfg.vault,'wiki','fixture.md'),'utf8').then(s=>s.startsWith('# Independent vault')),true);
 assert.ok((await fs.readFile(path.join(cfg.vault,'memories',short.id+'.md'),'utf8')).includes('fixture short memory'));
 await fs.writeFile(note,'# Changed in Obsidian\nfixture-updated-needle');
 search=await call('/search',{q:'fixture-updated-needle'});
 assert.ok(search.hits.some(h=>h.path==='wiki/fixture.md'));
 // Native memory MCP deliberately rejects browser Fetch metadata. Use the
 // desktop/stdio client's HTTP shape, not undici's Sec-Fetch-Mode: cors.
 const payload=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'memory_search',arguments:{query:'fixture-updated-needle'}}});
 const mcp=await new Promise((resolve,reject)=>{
  const req=http.request(`http://127.0.0.1:${gatewayPort}/mcp/magpie/memory`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,text}));
  });req.on('error',reject);req.end(payload);
 });
 assert.equal(mcp.status,200,mcp.text);assert.match(mcp.text,/knowledge note: wiki\/fixture.md/);
 const direct=await fetch(`http://127.0.0.1:${new URL(origin).port}/api/fish-vault/models`);
 assert.equal(direct.status,403,'Dock auto-cookie proxy must not grant the private desktop token');
 console.log('PASS vault: real native note search; Obsidian hand edits immediately visible to MCP; short memory candidate shared on disk; tokenless desktop calls rejected; no paid model called');
}
