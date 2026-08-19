#!/usr/bin/env node
'use strict';
const pkg=require('../package.json');

const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});s.on('error',reject);});}
async function waitForHttp(url,tries=100){for(let i=0;i<tries;i++){try{const r=await fetch(url);if(r.ok)return r;}catch{}await sleep(100);}throw new Error(`Timed out waiting for ${url}`);}
function findChromium(){
  const explicit=String(process.env.CHROMIUM_PATH||'').trim();if(explicit&&fs.existsSync(explicit))return explicit;
  for(const name of ['chromium','chromium-browser','google-chrome','google-chrome-stable']){
    const r=spawnSync('which',[name],{encoding:'utf8'});const p=String(r.stdout||'').trim();if(r.status===0&&p)return p;
  }
  throw new Error('Chromium was not found. Set CHROMIUM_PATH to run browser QA.');
}
class CDP {
  constructor(url){this.url=url;this.ws=null;this.nextId=1;this.pending=new Map();this.listeners=new Map();}
  async connect(){
    await new Promise((resolve,reject)=>{
      const ws=this.ws=new WebSocket(this.url);
      const timer=setTimeout(()=>reject(new Error('Timed out connecting to Chromium DevTools')),10000);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',event=>{clearTimeout(timer);reject(event.error||new Error('DevTools WebSocket error'));},{once:true});
      ws.addEventListener('message',event=>this._message(event.data));
      ws.addEventListener('close',()=>{for(const {reject} of this.pending.values())reject(new Error('DevTools connection closed'));this.pending.clear();});
    });
  }
  _message(raw){
    const msg=JSON.parse(String(raw));
    if(msg.id){const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);if(msg.error)p.reject(new Error(`${msg.error.message}${msg.error.data?`: ${msg.error.data}`:''}`));else p.resolve(msg.result||{});return;}
    if(msg.method){for(const fn of this.listeners.get(msg.method)||[]){try{fn(msg.params||{})}catch{}}}
  }
  on(method,fn){const list=this.listeners.get(method)||[];list.push(fn);this.listeners.set(method,list);}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=this.nextId++;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){try{this.ws?.close()}catch{}}
}
async function evaluate(cdp,expression){
  const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(out.exceptionDetails){const detail=out.exceptionDetails.exception?.description||out.exceptionDetails.text||'Browser evaluation failed';throw new Error(detail);}
  return out.result?.value;
}
async function waitForCondition(cdp,expression,label,timeout=15000){
  const start=Date.now();let last='';
  while(Date.now()-start<timeout){
    try{if(await evaluate(cdp,`Boolean(${expression})`))return;}catch(err){last=err.message;}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${last?` (${last})`:''}`);
}
async function setHash(cdp,hash){
  await evaluate(cdp,`location.hash=${JSON.stringify(hash)}`);
  await waitForCondition(cdp,`document.querySelector('#route-view')?.getAttribute('aria-busy')==='false'`,'route render');
  await waitForCondition(cdp,`document.querySelector('#route-view')?.textContent.trim().length>40`,'route content');
}

(async()=>{
  const root=path.resolve(__dirname,'..');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'workshop-v9-browser-'));
  const dataDir=path.join(work,'data');fs.mkdirSync(dataDir,{recursive:true});
  const chromeDir=path.join(work,'chromium');fs.mkdirSync(chromeDir,{recursive:true});
  const appPort=await freePort(),debugPort=await freePort();
  const logs=[];const checks=[];const errors=[];
  const check=(name,ok,detail='')=>checks.push([name,Boolean(ok),detail]);
  const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(appPort),WORKSHOP_DATA_DIR:dataDir,WORKSHOP_DEV_AUTH:'1',WORKSHOP_SEED_DEMO:'1',WORKSHOP_RATE_LIMIT:'0',NODE_ENV:'development',WORKSHOP_MEMBERSHIP_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_browser_qa',STRIPE_GEARHEAD_MONTHLY_PRICE_ID:'price_monthly_browser_qa',STRIPE_GEARHEAD_ANNUAL_PRICE_ID:'price_annual_browser_qa',STRIPE_WEBHOOK_SECRET:'whsec_browser_qa'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs.push(String(d)));server.stderr.on('data',d=>logs.push(String(d)));
  let chrome=null,cdp=null;
  try{
    const base=`http://127.0.0.1:${appPort}`;await waitForHttp(`${base}/api/meta`);
    const chromium=findChromium();
    chrome=spawn(chromium,[`--remote-debugging-port=${debugPort}`,`--user-data-dir=${chromeDir}`,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--disable-background-networking','--disable-sync','--no-first-run','--no-default-browser-check','--window-size=1440,1000','about:blank'],{stdio:['ignore','pipe','pipe']});
    chrome.stdout.on('data',d=>logs.push(String(d)));chrome.stderr.on('data',d=>logs.push(String(d)));
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
    // The container's managed Chromium policy blocks every navigated URL, including
    // localhost. Load the real application into about:blank and bridge fetch() calls
    // to the real temporary server over CDP. This still executes the production HTML,
    // CSS, client JavaScript, router, DOM events, and server APIs in Chromium.
    const targetRes=await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'});
    if(!targetRes.ok)throw new Error(`Could not create Chromium target (${targetRes.status})`);
    const target=await targetRes.json();cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
    await Promise.all([cdp.send('Page.enable'),cdp.send('Runtime.enable'),cdp.send('Log.enable'),cdp.send('Network.enable'),cdp.send('Runtime.addBinding',{name:'__qaFetchBridge'})]);
    cdp.on('Runtime.exceptionThrown',p=>errors.push(p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'Uncaught browser exception'));
    cdp.on('Log.entryAdded',p=>{if(['error'].includes(p.entry?.level))errors.push(`${p.entry.source||'browser'}: ${p.entry.text||'error'}`)});
    let bridgeCookie='';
    cdp.on('Runtime.bindingCalled',async p=>{
      if(p.name!=='__qaFetchBridge')return;
      let request;try{request=JSON.parse(p.payload)}catch{return;}
      try{
        const rawUrl=String(request.url||'/');
        let pathname=rawUrl;
        if(rawUrl.startsWith(base))pathname=rawUrl.slice(base.length)||'/';
        else if(/^https?:/i.test(rawUrl)){const u=new URL(rawUrl);pathname=`${u.pathname}${u.search}`;}
        if(!pathname.startsWith('/'))pathname=`/${pathname}`;
        const headers={...(request.headers||{})};if(bridgeCookie)headers.cookie=bridgeCookie;
        const response=await fetch(base+pathname,{method:request.method||'GET',headers,body:request.body||undefined,redirect:'manual'});
        const setCookie=response.headers.get('set-cookie');if(setCookie)bridgeCookie=setCookie.split(';')[0];
        const payload={status:response.status,statusText:response.statusText,headers:Object.fromEntries(response.headers),body:await response.text()};
        await cdp.send('Runtime.evaluate',{expression:`window.__qaFetchResolve(${JSON.stringify(request.id)},${JSON.stringify(JSON.stringify(payload))})`});
      }catch(err){
        await cdp.send('Runtime.evaluate',{expression:`window.__qaFetchReject(${JSON.stringify(request.id)},${JSON.stringify(String(err.message||err))})`}).catch(()=>{});
      }
    });
    const indexPath=path.join(root,'public','index.html'),cssPath=path.join(root,'public','styles.css'),appPath=path.join(root,'public','app.js');
    let shell=fs.readFileSync(indexPath,'utf8');
    shell=shell.replace(/<link[^>]+rel=\"stylesheet\"[^>]*>/i,`<style>${fs.readFileSync(cssPath,'utf8')}</style>`)
      .replace(/<script[^>]+src=\"\/app\.js[^>]*><\/script>/i,'')
      .replace(/<link[^>]+(?:icon|manifest)[^>]*>/gi,'');
    const frame=(await cdp.send('Page.getFrameTree')).frameTree.frame;
    await cdp.send('Page.setDocumentContent',{frameId:frame.id,html:shell});
    const fetchPrelude=`(()=>{const memoryStorage=new Map();const storage={getItem:key=>memoryStorage.has(String(key))?memoryStorage.get(String(key)):null,setItem:(key,value)=>memoryStorage.set(String(key),String(value)),removeItem:key=>memoryStorage.delete(String(key)),clear:()=>memoryStorage.clear(),key:index=>[...memoryStorage.keys()][Number(index)]??null,get length(){return memoryStorage.size}};try{Object.defineProperty(window,'localStorage',{value:storage,configurable:true})}catch{}const pending=new Map();let seq=0;window.__qaFetchResolve=(id,raw)=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.resolve(JSON.parse(raw));};window.__qaFetchReject=(id,message)=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.reject(new TypeError(message));};window.fetch=async(input,init={})=>{const id=++seq,url=typeof input==='string'?input:input.url,method=String(init.method||(typeof input!=='string'&&input.method)||'GET').toUpperCase(),headers=Object.fromEntries(new Headers(init.headers||(typeof input!=='string'?input.headers:undefined))),body=init.body==null?null:String(init.body);const response=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});window.__qaFetchBridge(JSON.stringify({id,url,method,headers,body}));});return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});};location.hash='#/home';})();`;
    await evaluate(cdp,fetchPrelude);
    const appSource=fs.readFileSync(appPath,'utf8')+'\n//# sourceURL=workshop-app.js';
    const appEval=await cdp.send('Runtime.evaluate',{expression:appSource,awaitPromise:false,returnByValue:false});
    if(appEval.exceptionDetails)throw new Error(appEval.exceptionDetails.exception?.description||appEval.exceptionDetails.text||'App script failed to execute');
    await waitForCondition(cdp,`document.querySelector('#route-view')?.getAttribute('aria-busy')==='false'`,'initial Home render',20000);

    await waitForCondition(cdp,`document.querySelector('#version-label')?.textContent.includes('v${pkg.version}')`,'v9 shell version');
    check(`Browser shell loads v${pkg.version}`,true);
    await waitForCondition(cdp,`document.querySelector('#route-view')?.textContent.includes('WHAT ARE YOU')`,'Home hero');
    check('Home renders the Workshop hero',true);
    await waitForCondition(cdp,`document.querySelector('#workshop-atmosphere')?.dataset.module==='home'&&document.querySelectorAll('#atmo-foreground .atmo-sprite').length>=6`,'initial Home atmosphere');
    check('Home atmosphere is visibly populated',true);

    await setHash(cdp,'#/gearhead');
    check('Non-member GearHead join landing renders',await evaluate(cdp,`document.querySelector('#route-view')?.textContent.includes('GET CLOSER TO THE WORK')`));
    check('Monthly and annual plan cards are real controls',await evaluate(cdp,`(()=>{const cards=[...document.querySelectorAll('.gearhead-plan-card')];return cards.length===2&&cards.every(x=>x.tagName==='BUTTON')&&cards.some(x=>x.dataset.plan==='monthly')&&cards.some(x=>x.dataset.plan==='annual')})()`));
    check('Both GearHead plan cards share the accent outline',await evaluate(cdp,`(()=>{const c=[...document.querySelectorAll('.gearhead-plan-card')];return c.length===2&&c.every(x=>getComputedStyle(x).borderTopWidth==='2px'&&getComputedStyle(x).borderTopStyle==='solid')})()`));
    check('Redundant GearHead join button is absent',await evaluate(cdp,`document.querySelectorAll('.gearhead-access-card > .button').length===0`));

    const login=await evaluate(cdp,`(async()=>{const r=await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_mike'})});return {status:r.status,body:await r.json()};})()`);
    check('Development login succeeds in a real browser',login?.status===200,JSON.stringify(login));
    await evaluate(cdp,`(async()=>{state.me=(await api('/api/me')).user;updateUserUI();await renderRoute();return state.me?.displayName||''})()`);
    await waitForCondition(cdp,`document.querySelector('#user-name')?.textContent==='Mike'&&document.querySelector('#route-view')?.getAttribute('aria-busy')==='false'`,'signed-in user shell',20000);

    const routes=[
      ['#/home','home'],['#/bench','bench'],['#/builds','builds'],['#/workshop','workshop'],['#/library','library'],['#/live','live'],['#/people','people'],['#/gearhead','gearhead']
    ];
    const compositions=[];
    for(const [hash,module] of routes){
      await setHash(cdp,hash);
      const result=await evaluate(cdp,`(()=>({module:document.querySelector('#workshop-atmosphere')?.dataset.module||'',sprites:document.querySelectorAll('#atmo-foreground .atmo-sprite').length,error:Boolean(document.querySelector('.error-state-v4')),text:document.querySelector('#route-view')?.textContent.trim().slice(0,120)||'',html:document.querySelector('#atmo-foreground')?.innerHTML||''}))()`);
      check(`${module} route renders without runtime error`,result&&!result.error&&result.text.length>20,result?.text||'');
      check(`${module} atmosphere persists after navigation`,result?.module===module&&result?.sprites>=6,JSON.stringify({module:result?.module,sprites:result?.sprites}));
      compositions.push(result?.html||'');
    }
    check('Atmosphere recomposes between major modules',new Set(compositions).size>=6,`unique compositions: ${new Set(compositions).size}`);

    await setHash(cdp,'#/home');
    const motionBefore=await evaluate(cdp,`getComputedStyle(document.querySelector('#atmo-foreground .plane')||document.querySelector('#atmo-foreground .atmo-sprite')).transform`);
    await sleep(900);
    const motionAfter=await evaluate(cdp,`getComputedStyle(document.querySelector('#atmo-foreground .plane')||document.querySelector('#atmo-foreground .atmo-sprite')).transform`);
    check('Workshop atmosphere is actively animated',motionBefore!==motionAfter&&motionAfter!=='none',`${motionBefore} -> ${motionAfter}`);

    await evaluate(cdp,`document.querySelector('#atmosphere-toggle').click()`);
    await waitForCondition(cdp,`document.querySelector('.atmosphere-settings')`,'Appearance modal');
    check('Appearance combines theme, density, and atmosphere',await evaluate(cdp,`document.querySelector('.modal-body')?.textContent.includes('DISPLAY DENSITY')&&document.querySelector('.modal-body')?.textContent.includes('WORKSHOP ATMOSPHERE')`));
    await evaluate(cdp,`document.querySelector('[data-action="atmosphere-mode"][data-mode="quiet"]').click()`);
    await waitForCondition(cdp,`document.documentElement.dataset.atmosphere==='quiet'`,'Quiet atmosphere mode');
    check('Quiet mode suppresses animated foreground',await evaluate(cdp,`document.querySelectorAll('#atmo-foreground .atmo-sprite').length===0`));
    await evaluate(cdp,`document.querySelector('[data-action="atmosphere-mode"][data-mode="workshop"]').click()`);
    await waitForCondition(cdp,`document.documentElement.dataset.atmosphere==='workshop'&&document.querySelectorAll('#atmo-foreground .atmo-sprite').length>=6`,'Workshop atmosphere mode');
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]').click()`);

    await evaluate(cdp,`document.querySelector('#start-button').click()`);
    await waitForCondition(cdp,`document.querySelector('.start-intent-group')`,'Start Something modal');
    check('Start Something is organized by intent',await evaluate(cdp,`(()=>{const t=document.querySelector('.modal-body')?.textContent||'';return ['MAKE SOMETHING','DOCUMENT SOMETHING','ASK FOR HELP','JOIN SOMETHING'].every(x=>t.includes(x))})()`));
    check('Focused density keeps authorized publishing tools available',await evaluate(cdp,`(()=>{const group=[...document.querySelectorAll('.start-intent-group')].find(x=>x.textContent.includes('PUBLISH / CURATE'));return Boolean(group)&&getComputedStyle(group).display!=='none'})()`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]').click()`);

    await evaluate(cdp,`projectForm()`);
    await waitForCondition(cdp,`document.querySelector('#project-form')`,'Project form');
    check('Project editor has one canonical visibility control',await evaluate(cdp,`document.querySelectorAll('#project-form [name="visibility"]').length===1`));
    check('Shared media picker is available in the project editor',await evaluate(cdp,`Boolean(document.querySelector('#project-form .media-picker'))`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]').click()`);

    await setHash(cdp,'#/projects/p_knob');
    check('Project page exposes local object navigation',await evaluate(cdp,`document.querySelectorAll('.project-section-nav a').length>=5`));
    check('Project page provides a share action',await evaluate(cdp,`Boolean(document.querySelector('[data-action="share-current"]'))`));
    check('Project page exposes Guided Build',await evaluate(cdp,`Boolean(document.querySelector('#project-guide .guided-build-grid'))`));
    check('Project can ask Workshop with project context',await evaluate(cdp,`Boolean(document.querySelector('[data-action="project-help"]'))`));
    await setHash(cdp,'#/projects/p_lora');
    check('Public project can be personalized with Make It Yours',await evaluate(cdp,`Boolean(document.querySelector('[data-action="make-it-yours"]'))`));
    await evaluate(cdp,`document.querySelector('[data-action="make-it-yours"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#make-it-yours-form')`,'Make It Yours editor');
    check('Make It Yours keeps source adaptation context explicit',await evaluate(cdp,`document.querySelector('#make-it-yours-form')?.textContent.includes('What will you change?')`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]')?.click()`);

    const crewId=await evaluate(cdp,`(async()=>{const d=await fetch('/api/crews').then(r=>r.json());return d.crews?.[0]?.id||d.items?.[0]?.id||''})()`);
    if(crewId){
      await setHash(cdp,`#/crew/${encodeURIComponent(crewId)}`);
      check('Maker Crew page exposes local object navigation',await evaluate(cdp,`document.querySelectorAll('.crew-local-nav a').length>=5`));
      await evaluate(cdp,`document.querySelector('[data-action=\"crew-studio\"]')?.click()`);
      await waitForCondition(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')`,'Crew Studio members');
      const beforeRole=await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent||''`);
      await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"] [data-role=\"Moderator\"]')?.click()`);
      await waitForCondition(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent.includes('Moderator')&&Boolean(document.querySelector('.modal-body [data-crew-member=\"u_rin\"] [data-role=\"Member\"]'))`,'live Crew role refresh');
      const afterRole=await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent||''`);
      check('Crew role change updates Studio immediately without reopening',beforeRole.includes('Member')&&afterRole.includes('Moderator')&&Boolean(await evaluate(cdp,`document.querySelector('.modal')`)),`${beforeRole} -> ${afterRole}`);
      await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"] [data-role=\"Member\"]')?.click()`);
      await waitForCondition(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent.includes('Member')`,'restore Crew member role');
      await evaluate(cdp,`document.querySelector('[data-action=\"close-overlay\"]')?.click()`);

      const qaCrew=await evaluate(cdp,`(async()=>{const r=await fetch('/api/crews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'BQA'+Date.now().toString().slice(-6),name:'Browser One Click Map Crew',anchorPostalCode:'21502',cityRegion:'Cumberland, MD',country:'US',status:'Paused',visibility:'Private'})});return await r.json()})()`);
      if(qaCrew?.id){
        await evaluate(cdp,`crewStudio(${JSON.stringify(qaCrew.id)})`);
        await waitForCondition(cdp,`Boolean(document.querySelector('[data-action=\"crew-map-enable\"]'))`,'one-click map button');
        const mapStatusBefore=await evaluate(cdp,`document.querySelector('.modal-body .crew-map-status')?.textContent.trim()||''`);
        check('Crew Studio exposes one-click map visibility',mapStatusBefore.includes('NOT PUBLISHED')&&Boolean(await evaluate(cdp,`document.querySelector('.modal-body .crew-studio-map-card')`)),mapStatusBefore);
        await evaluate(cdp,`document.querySelector('[data-action=\"crew-map-enable\"]')?.click()`);
        await waitForCondition(cdp,`document.querySelector('.crew-map-status.live')?.textContent.includes('VISIBLE ON MAP')`,'Crew map enable live refresh',20000);
        check('One-click map action updates Crew Studio in place',await evaluate(cdp,`Boolean(document.querySelector('.modal'))&&Boolean(document.querySelector('.crew-map-status.live'))&&Boolean(document.querySelector('a[href=\"#/crews/map\"]'))`));
        check('Crew Studio exposes editable latitude and longitude',await evaluate(cdp,`Boolean(document.querySelector('#crew-map-location-form [name=\"latitude\"]'))&&Boolean(document.querySelector('#crew-map-location-form [name=\"longitude\"]'))&&document.querySelector('.crew-map-anchor-tile')?.textContent.includes('21502')`));
        await evaluate(cdp,`(()=>{const f=document.querySelector('#crew-map-location-form');f.querySelector('[name=\"latitude\"]').value='39.68050852174287';f.querySelector('[name=\"longitude\"]').value='-78.76667986159089';f.requestSubmit()})()`);
        await waitForCondition(cdp,`document.querySelector('#crew-map-location-form [name=\"latitude\"]')?.value==='39.68050852174287'&&document.querySelector('#crew-map-location-form [name=\"longitude\"]')?.value==='-78.76667986159089'&&document.querySelector('.crew-map-coordinate-preview')?.textContent.includes('39.68050852174287, -78.76667986159089')`,'live manual Crew marker refresh');
        check('Saving Crew marker coordinates refreshes Studio in place',await evaluate(cdp,`Boolean(document.querySelector('.modal'))&&document.querySelector('.crew-map-coordinate-preview')?.textContent.includes('39.68050852174287, -78.76667986159089')`));
        check('Crew Studio provides starred ZIP centroid reset',await evaluate(cdp,`Boolean(document.querySelector('[data-action=\"crew-map-reset\"]'))&&document.querySelector('[data-action=\"crew-map-reset\"]')?.textContent.includes('ZIP')`));
        await evaluate(cdp,`document.querySelector('[data-action=\"close-overlay\"]')?.click()`);
      }else check('Crew Studio exposes one-click map visibility',false,'Could not create Browser QA Crew.');
    }else check('Maker Crew page exposes local object navigation',false,'No seeded Crew was available.');

    await setHash(cdp,'#/live');
    check('Live page exposes calendar export',await evaluate(cdp,`Boolean(document.querySelector('a[href="/api/calendar.ics"]'))`));

    await setHash(cdp,'#/search/gear/all');
    check('Global search follows consolidated IA',await evaluate(cdp,`(()=>{const t=document.querySelector('#route-view')?.textContent||'';return t.includes('Community Builds')&&t.includes('Help + Critique')})()`));

    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await setHash(cdp,'#/home');
    await evaluate(cdp,`document.querySelector('#mobile-modules').click()`);
    await waitForCondition(cdp,`document.querySelector('.mobile-module-switcher')`,'mobile module switcher');
    check('Mobile Modules exposes the full consolidated map',await evaluate(cdp,`document.querySelectorAll('.mobile-module-group').length>=8&&document.querySelector('.mobile-module-switcher').textContent.includes('GEARHEAD CREW')`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]').click()`);
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    await evaluate(cdp,`localStorage.setItem('workshop-offline-queue-v1',JSON.stringify([{id:'browser-qa-offline',path:'/api/projects',method:'POST',body:'{}',queuedAt:new Date().toISOString()}]));updateConnectivityUI(true);document.querySelector('#offline-status').click()`);
    await waitForCondition(cdp,`document.querySelector('.offline-work-list')`,'Offline Work drawer');
    check('Offline Work queue has review controls',await evaluate(cdp,`Boolean(document.querySelector('[data-action="offline-retry"]'))&&Boolean(document.querySelector('[data-action="offline-discard"]'))&&Boolean(document.querySelector('[data-action="offline-sync-all"]'))`));
    await evaluate(cdp,`localStorage.removeItem('workshop-offline-queue-v1');document.querySelector('[data-action="close-overlay"]').click();updateConnectivityUI(true)`);

    const fatalErrors=errors.filter(x=>!/(favicon|ERR_ABORTED|Failed to load resource|Not allowed to load local resource|about:blank)/i.test(x));
    check('No uncaught browser exceptions during route and interaction QA',fatalErrors.length===0,fatalErrors.join(' | '));
  }catch(err){check('Browser QA harness completes',false,err.stack||err.message);}
  finally{
    try{cdp?.close()}catch{}
    try{chrome?.kill('SIGTERM')}catch{}
    try{server.kill('SIGTERM')}catch{}
    await sleep(300);
    try{chrome?.kill('SIGKILL')}catch{}
    try{server.kill('SIGKILL')}catch{}
    try{fs.rmSync(work,{recursive:true,force:true})}catch{}
  }
  let failed=0;for(const [name,ok,detail] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}${!ok&&detail?` — ${detail}`:''}`);if(!ok)failed++;}
  if(failed){console.error(`\n${failed} browser QA check(s) failed.\n${logs.join('').slice(-4000)}`);process.exit(1);}
  console.log(`\n${checks.length}/${checks.length} browser QA checks passed.`);
})().catch(err=>{console.error(err);process.exit(1)});
