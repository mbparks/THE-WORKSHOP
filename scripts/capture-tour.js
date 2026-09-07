#!/usr/bin/env node
'use strict';

const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'public','tour','screens');
// Uses a temporary seeded database only. Never point this script at production data.
fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});s.on('error',reject);});}
async function waitForHttp(url,tries=150){for(let i=0;i<tries;i++){try{const r=await fetch(url);if(r.ok)return r;}catch{}await sleep(100);}throw new Error(`Timed out waiting for ${url}`);}
function chromium(){const explicit=String(process.env.CHROMIUM_PATH||'').trim();if(explicit&&fs.existsSync(explicit))return explicit;for(const n of ['chromium','chromium-browser','google-chrome','google-chrome-stable']){const r=spawnSync('which',[n],{encoding:'utf8'});const found=String(r.stdout||'').trim();if(r.status===0&&found)return found;}throw new Error('Chromium was not found. Set CHROMIUM_PATH to regenerate tour screenshots.');}
class CDP{constructor(url){this.url=url;this.ws=null;this.id=1;this.pending=new Map();this.listeners=new Map();}async connect(){await new Promise((res,rej)=>{const ws=this.ws=new WebSocket(this.url);const t=setTimeout(()=>rej(new Error('CDP timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(t);res()},{once:true});ws.addEventListener('error',e=>{clearTimeout(t);rej(e.error||new Error('CDP error'))},{once:true});ws.addEventListener('message',e=>this.onMessage(e.data));});}onMessage(raw){const m=JSON.parse(String(raw));if(m.id){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result||{});return;}if(m.method)for(const fn of this.listeners.get(m.method)||[])try{fn(m.params||{})}catch{}}on(method,fn){const a=this.listeners.get(method)||[];a.push(fn);this.listeners.set(method,a);}send(method,params={}){return new Promise((resolve,reject)=>{const id=this.id++;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}close(){try{this.ws?.close()}catch{}}}
async function evalx(cdp,expression){const o=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(o.exceptionDetails)throw new Error(o.exceptionDetails.exception?.description||o.exceptionDetails.text||'eval failed');return o.result?.value;}
async function wait(cdp,expression,label,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){try{if(await evalx(cdp,`Boolean(${expression})`))return;}catch{}await sleep(120);}throw new Error(`Timeout: ${label}`);}
async function route(cdp,hash){await evalx(cdp,`location.hash=${JSON.stringify(hash)};window.scrollTo(0,0);true`);await wait(cdp,`document.querySelector('#route-view')?.getAttribute('aria-busy')==='false'`,'route idle');await wait(cdp,`document.querySelector('#route-view')?.textContent.trim().length>40`,'route content');await sleep(450);}
async function shot(cdp,name,{scroll=null,selector=null,full=false}={}){
  if(selector){await evalx(cdp,`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start',behavior:'instant'});true`);await sleep(350);}
  if(scroll!==null){await evalx(cdp,`window.scrollTo(0,${Number(scroll)});true`);await sleep(300);}
  const args={format:'webp',quality:84,fromSurface:true,captureBeyondViewport:Boolean(full)};
  if(full){const m=await cdp.send('Page.getLayoutMetrics');const w=Math.ceil(m.cssContentSize.width),h=Math.min(5200,Math.ceil(m.cssContentSize.height));args.clip={x:0,y:0,width:w,height:h,scale:1};}
  const cap=await cdp.send('Page.captureScreenshot',args);
  fs.writeFileSync(path.join(OUT,`${name}.webp`),Buffer.from(cap.data,'base64'));
  console.log(name,fs.statSync(path.join(OUT,`${name}.webp`)).size);
}

(async()=>{
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'workshop-tour-'));
  const data=path.join(work,'data');fs.mkdirSync(data,{recursive:true});
  const chromeDir=path.join(work,'chrome');fs.mkdirSync(chromeDir,{recursive:true});
  const appPort=await freePort(),debugPort=await freePort();
  const server=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,HOST:'127.0.0.1',PORT:String(appPort),WORKSHOP_DATA_DIR:data,WORKSHOP_DEV_AUTH:'1',WORKSHOP_SEED_DEMO:'1',WORKSHOP_RATE_LIMIT:'0',NODE_ENV:'development',WORKSHOP_MEMBERSHIP_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_tour',STRIPE_GEARHEAD_MONTHLY_PRICE_ID:'price_monthly_tour',STRIPE_GEARHEAD_ANNUAL_PRICE_ID:'price_annual_tour',STRIPE_WEBHOOK_SECRET:'whsec_tour'},stdio:['ignore','pipe','pipe']});
  const logs=[];server.stdout.on('data',d=>logs.push(String(d)));server.stderr.on('data',d=>logs.push(String(d)));
  let chrome,cdp;
  try{
    const base=`http://127.0.0.1:${appPort}`;await waitForHttp(`${base}/api/meta`);
    chrome=spawn(chromium(),[`--remote-debugging-port=${debugPort}`,`--user-data-dir=${chromeDir}`,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--disable-background-networking','--disable-sync','--no-first-run','--no-default-browser-check','--hide-scrollbars','--window-size=1600,1000','about:blank'],{stdio:['ignore','pipe','pipe']});
    chrome.stdout.on('data',d=>logs.push(String(d)));chrome.stderr.on('data',d=>logs.push(String(d)));
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
    const target=await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'})).json();cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
    await Promise.all([cdp.send('Page.enable'),cdp.send('Runtime.enable'),cdp.send('Network.enable'),cdp.send('Runtime.addBinding',{name:'__qaFetchBridge'}),cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false})]);
    let cookie='';
    cdp.on('Runtime.bindingCalled',async p=>{if(p.name!=='__qaFetchBridge')return;let request;try{request=JSON.parse(p.payload)}catch{return;}try{let pathname=String(request.url||'/');if(pathname.startsWith(base))pathname=pathname.slice(base.length)||'/';else if(/^https?:/i.test(pathname)){const u=new URL(pathname);pathname=u.pathname+u.search;}if(!pathname.startsWith('/'))pathname='/'+pathname;const headers={...(request.headers||{})};if(cookie)headers.cookie=cookie;const response=await fetch(base+pathname,{method:request.method||'GET',headers,body:request.body||undefined,redirect:'manual'});const sc=response.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const payload={status:response.status,statusText:response.statusText,headers:Object.fromEntries(response.headers),body:await response.text()};await cdp.send('Runtime.evaluate',{expression:`window.__qaFetchResolve(${JSON.stringify(request.id)},${JSON.stringify(JSON.stringify(payload))})`});}catch(err){await cdp.send('Runtime.evaluate',{expression:`window.__qaFetchReject(${JSON.stringify(request.id)},${JSON.stringify(String(err.message||err))})`}).catch(()=>{});}});

    let html=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
    html=html.replace(/<link[^>]+rel="stylesheet"[^>]*>/i,`<style>${fs.readFileSync(path.join(ROOT,'public','styles.css'),'utf8')}\n/* tour capture */\nhtml{scroll-behavior:auto!important}*{animation-duration:0s!important;transition-duration:0s!important}</style>`).replace(/<script[^>]+src="\/app\.js[^>]*><\/script>/i,'').replace(/<link[^>]+(?:icon|manifest)[^>]*>/gi,'');
    const frame=(await cdp.send('Page.getFrameTree')).frameTree.frame;await cdp.send('Page.setDocumentContent',{frameId:frame.id,html});
    const prelude=`(()=>{const m=new Map([['workshop-theme','dark'],['workshop-mode','deep'],['workshop-atmosphere','workshop']]);const s={getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][Number(i)]??null,get length(){return m.size}};try{Object.defineProperty(window,'localStorage',{value:s,configurable:true})}catch{}const pending=new Map();let seq=0;window.__qaFetchResolve=(id,raw)=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.resolve(JSON.parse(raw));};window.__qaFetchReject=(id,msg)=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.reject(new TypeError(msg));};window.fetch=async(input,init={})=>{const id=++seq,url=typeof input==='string'?input:input.url,method=String(init.method||(typeof input!=='string'&&input.method)||'GET').toUpperCase(),headers=Object.fromEntries(new Headers(init.headers||(typeof input!=='string'?input.headers:undefined))),body=init.body==null?null:String(init.body);const r=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});window.__qaFetchBridge(JSON.stringify({id,url,method,headers,body}));});return new Response(r.body,{status:r.status,statusText:r.statusText,headers:r.headers});};location.hash='#/home';})();`;
    await evalx(cdp,prelude);
    const src=fs.readFileSync(path.join(ROOT,'public','app.js'),'utf8')+'\n//# sourceURL=workshop-tour-app.js';const run=await cdp.send('Runtime.evaluate',{expression:src,awaitPromise:false,returnByValue:false});if(run.exceptionDetails)throw new Error(run.exceptionDetails.exception?.description||run.exceptionDetails.text||'app failed');
    await wait(cdp,`document.querySelector('#route-view')?.textContent.includes('WHAT ARE YOU')`,'home');
    await evalx(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_mike'})});state.me=(await api('/api/me')).user;await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'Rowan Vale',callsign:'paperpilot',bio:'Electronics, book arts, repair, creative code, and whatever the current project needs.',cityRegion:'Mountain Maryland',skills:['Electronics','Book Arts','Creative Coding','Repair & Restoration'],tools:['Soldering iron','Sewing machine','Hand tools'],platforms:['KiCad','VS Code','Arduino','Blender'],canHelp:['Electronics','Documentation','Repair'],wantLearn:['Ceramics','Textiles & Fiber'],workingOn:'Testing a pocket environmental sensor',workingOnDays:14,profileVisibility:'Public',locationVisibility:'Public',toolCabinetVisibility:'Members'})});state.me=(await api('/api/me')).user;updateUserUI();await renderRoute();return true})()`);
    await wait(cdp,`document.querySelector('#user-name')?.textContent==='Rowan Vale'`,'profile update');

    await route(cdp,'#/home');await shot(cdp,'01-home');
    await evalx(cdp,`(()=>{const nodes=[...document.querySelectorAll('h2,h3,[data-section-title]')];const target=nodes.find(node=>/AROUND THE WORKSHOP/i.test(node.textContent||''));if(target)target.scrollIntoView({block:'start',behavior:'instant'});else window.scrollTo(0,Math.max(560,innerHeight*.7));return true})()`);
    await sleep(450);await shot(cdp,'01-home-activity');
    await route(cdp,'#/bench');await shot(cdp,'02-bench');
    await route(cdp,'#/projects');await shot(cdp,'03-project');
    await route(cdp,'#/projects/p_lora');await shot(cdp,'04-project-talk',{selector:'#project-discussion'});
    await route(cdp,'#/community-builds');await shot(cdp,'05-community-builds');
    await route(cdp,'#/help');await shot(cdp,'06-help-critique');
    await route(cdp,'#/people');await shot(cdp,'07-people');
    const crewId=await evalx(cdp,`(async()=>{const d=await fetch('/api/crews').then(r=>r.json());return d.crews?.[0]?.id||d.items?.[0]?.id||''})()`);
    if(crewId){await route(cdp,`#/crew/${crewId}`);await shot(cdp,'08-maker-crew');}
    await route(cdp,'#/live');await shot(cdp,'09-live-calendar');
    await route(cdp,'#/library');await shot(cdp,'10-shop-manual');
    await route(cdp,'#/gearhead');await shot(cdp,'11-gearhead');
    await route(cdp,'#/home');await evalx(cdp,`document.querySelector('#atmosphere-toggle')?.click();true`);await wait(cdp,`document.querySelector('.atmosphere-settings')`,'appearance');await sleep(250);await shot(cdp,'12-appearance');await evalx(cdp,`document.querySelector('[data-action="close-overlay"]')?.click();true`);

    // Mobile Home capture.
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await route(cdp,'#/home');await shot(cdp,'13-mobile-home');
  }finally{
    try{cdp?.close()}catch{}try{chrome?.kill('SIGKILL')}catch{}try{server?.kill('SIGKILL')}catch{}
    if(process.env.TOUR_CAPTURE_LOG==='1'&&logs.length)fs.writeFileSync(path.join(OUT,'capture.log'),logs.join(''));
  }
})().catch(err=>{console.error(err);process.exit(1)});
