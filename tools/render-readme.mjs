import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'assets/readme')
const heroVariant = process.env.README_VARIANT || ''
const outputPrefix = 'config-'
const edge = process.env.EDGE_BINARY || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-readme-'))
const browser = spawn(edge, ['--headless=new','--disable-gpu','--disable-gpu-sandbox','--disable-features=CalculateNativeWinOcclusion','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio:'ignore' })
const pause = () => new Promise(resolve => setTimeout(resolve, 80))
async function until(check) { const end=Date.now()+25000; while(Date.now()<end) { const value=await check(); if(value)return value; if(browser.exitCode!==null)throw Error(`Edge exited ${browser.exitCode}`); await pause() } throw Error('浏览器就绪超时') }
let ws, serial=0
const pending=new Map(), errors=[], results=[]
try {
  const port=await until(()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{return null}})
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve);ws.addEventListener('error',reject)})
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
  ws.addEventListener('message', event=>{const data=JSON.parse(event.data);if(data.id&&pending.has(data.id)){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result)}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text)})
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  await call('Page.enable');await call('Runtime.enable')
  await call('Emulation.setDeviceMetricsOverride',{width:2200,height:1300,deviceScaleFactor:1,mobile:false})
  await call('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}})
  for(const lang of ['zh'])for(const theme of ['light','dark']){
    await call('Page.navigate',{url:pathToFileURL(path.join(assets,'header.html')).href+`?lang=${lang}&theme=${theme}&variant=${encodeURIComponent(heroVariant)}`})
    await until(()=>evaluate(`document.readyState==='complete' && document.documentElement.lang==='${lang==='en'?'en':'zh-CN'}' && document.documentElement.dataset.theme==='${theme}'`))
    await evaluate('document.fonts.ready.then(()=>true)')
    assert.ok(await evaluate("[...document.images].every(i=>i.complete&&i.naturalWidth>0)"),'图片缺失')
    assert.ok(await evaluate("document.fonts.check('24px Jersey')"),'像素字体缺失')
    assert.ok(await evaluate("document.querySelector('h1').scrollWidth<=document.querySelector('h1').clientWidth"),'标题溢出')
    assert.ok(await evaluate("[...document.querySelectorAll('.pane')].every(p=>p.getBoundingClientRect().bottom<=document.querySelector('.window').getBoundingClientRect().bottom-15)"),'内容面板越过外框留白')
    assert.ok(await evaluate("[...document.querySelectorAll('.metric-value')].every(p=>{const r=p.getBoundingClientRect(),n=p.querySelector('.number').getBoundingClientRect(),l=p.querySelector('.metric-label').getBoundingClientRect();return n.right<r.right&&l.right<r.right&&l.bottom<r.bottom&&n.bottom<=l.top+1})"),'状态块内容溢出或重叠')
    for(const id of ['hero','stat-version','stat-desktop','stat-mail','stat-channels']){
      if(lang==='en'&&['key-zh','key-en'].includes(id))continue
      const clip=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:Math.max(0,r.x-4),y:Math.max(0,r.y-4),width:r.width+8,height:r.height+15,scale:1}})()`)
      const image=await call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true})
      const file=`${outputPrefix}${id}-${lang}-${theme}.png`,bytes=Buffer.from(image.data,'base64')
      fs.writeFileSync(path.join(assets,file),bytes)
      results.push({path:`assets/readme/${file}`,kind:'image',channel:'browser-layout-screenshot',size:bytes.length,license:'排版 MIT；用户图片许可单独保留',createdAt:new Date().toISOString(),contentHash:crypto.createHash('sha256').update(bytes).digest('hex')})
    }
  }
  assert.deepEqual(errors,[])
  fs.writeFileSync(path.join(assets,'header-metadata.json'),JSON.stringify({format:'fish-dock/readme-assets',renderedWith:'Microsoft Edge CDP',assets:results},null,2)+'\n')
  console.log(JSON.stringify({images:results.length,imageLoad:true,pixelFont:true,titleOverflow:false,consoleErrors:0}))
  await call('Browser.close')
} finally {
  ws?.close()
  if(browser.exitCode===null)browser.kill()
}
