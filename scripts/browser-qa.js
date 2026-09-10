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
async function setHash(cdp,hash,readyExpression='true'){
  await evaluate(cdp,`location.hash=${JSON.stringify(hash)}`);
  await sleep(50);
  await waitForCondition(cdp,`document.querySelector('#route-view')?.getAttribute('aria-busy')==='false'`,'route render');
  await waitForCondition(cdp,`document.querySelector('#route-view')?.textContent.trim().length>40`,'route content');
  await waitForCondition(cdp,readyExpression,'route-specific content');
}
async function openMakeTogether(cdp){
  await evaluate(cdp,`(async()=>{history.replaceState(null,'','#/make-together');await renderMakeTogether();updateAtmosphereModule('builds');document.querySelector('#route-view')?.setAttribute('aria-busy','false')})()`);
  await waitForCondition(cdp,`Boolean(document.querySelector('.make-together-view'))`,'Make Together content');
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
    chrome=spawn(chromium,[`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${chromeDir}`,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--disable-background-networking','--disable-sync','--no-first-run','--no-default-browser-check','--window-size=1440,1000','about:blank'],{stdio:['ignore','pipe','pipe']});
    chrome.stdout.on('data',d=>logs.push(String(d)));chrome.stderr.on('data',d=>logs.push(String(d)));
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`,300);
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
    check('Logged-out Home presents four public entryways',await evaluate(cdp,`document.querySelectorAll('.public-entry-links a').length===4&&document.querySelector('.public-tour-callout')?.textContent.includes('TAKE THE TOUR')`));
    await waitForCondition(cdp,`document.querySelector('#workshop-atmosphere')?.dataset.module==='home'&&document.querySelectorAll('#atmo-foreground .atmo-sprite').length>=6`,'initial Home atmosphere');
    check('Home atmosphere is visibly populated',true);

    await setHash(cdp,'#/start-here');
    check('First Visit renders five public starting points',await evaluate(cdp,`document.querySelectorAll('.start-here-project').length===3&&document.querySelectorAll('.start-here-community').length===1&&document.querySelectorAll('.start-here-connection').length===1`));
    await evaluate(cdp,`document.querySelector('[data-start-interest="repair"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('[data-start-interest="repair"]')?.getAttribute('aria-pressed')==='true'`,'First Visit interest selection');
    check('First Visit persists interests locally',await evaluate(cdp,`JSON.parse(localStorage.getItem('workshop-start-here-interests')||'[]').includes('repair')`));
    await setHash(cdp,'#/projects/p_lora');
    check('Public project gives visitors a Start Here guide',await evaluate(cdp,`Boolean(document.querySelector('#project-start-here'))&&Boolean(document.querySelector('a[href="#/start-here"]'))`));

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
      ['#/home','home'],['#/bench','bench'],['#/builds','builds'],['#/make-together','make together','builds'],['#/workshop','workshop'],['#/library','library'],['#/live','live'],['#/people','people'],['#/gearhead','gearhead']
    ];
    const compositions=[];
    for(const [hash,module,atmosphereModule=module] of routes){
      await setHash(cdp,hash,hash==='#/make-together'?`Boolean(document.querySelector('.make-together-view'))`:'true');
      const result=await evaluate(cdp,`(()=>({module:document.querySelector('#workshop-atmosphere')?.dataset.module||'',sprites:document.querySelectorAll('#atmo-foreground .atmo-sprite').length,error:Boolean(document.querySelector('.error-state-v4')),text:document.querySelector('#route-view')?.textContent.trim().slice(0,120)||'',html:document.querySelector('#atmo-foreground')?.innerHTML||''}))()`);
      check(`${module} route renders without runtime error`,result&&!result.error&&result.text.length>20,result?.text||'');
      check(`${module} atmosphere persists after navigation`,result?.module===atmosphereModule&&result?.sprites>=6,JSON.stringify({module:result?.module,sprites:result?.sprites}));
      compositions.push(result?.html||'');
    }
    check('Atmosphere recomposes between major modules',new Set(compositions).size>=6,`unique compositions: ${new Set(compositions).size}`);

    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_morgan'})});state.me=(await api('/api/me')).user;updateUserUI()})()`);
    await waitForCondition(cdp,`state.me?.id==='u_morgan'`,'Handoff learner login');
    await setHash(cdp,'#/handoff',`Boolean(document.querySelector('.handoff-library-section'))`);
    check('Handoff hub renders a chronological, unranked field-card library',await evaluate(cdp,`(()=>{const t=document.querySelector('.handoff-view')?.textContent||'';return t.includes('Handoff Field Cards')&&t.includes('MOST RECENTLY UPDATED')&&t.includes('NO RANKING')&&t.includes('Tune a Slow Environmental Sensor')})()`));
    await setHash(cdp,'#/handoff/handoff_demo_sensor',`Boolean(document.querySelector('.handoff-detail-view'))`);
    check('Handoff detail exposes a usable sequence and private learning loop',await evaluate(cdp,`(()=>{const t=document.querySelector('.handoff-detail-view')?.textContent||'';return document.querySelectorAll('.handoff-step').length>0&&t.includes('Learning loop')&&t.includes('PRIVATE FEEDBACK')&&t.includes('LEAVE PRIVATE LEARNER FEEDBACK')})()`));
    await evaluate(cdp,`document.querySelector('[data-action="handoff-feedback"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#handoff-feedback-form')`,'Handoff learner feedback form');
    check('Handoff learner feedback form labels adaptation and access',await evaluate(cdp,`(()=>{const t=document.querySelector('#handoff-feedback-form')?.textContent||'';return t.includes('What helped?')&&t.includes('Where did you get stuck?')&&t.includes('Access or clarity note')&&document.querySelectorAll('#handoff-feedback-form textarea').length===4})()`));
    await evaluate(cdp,`(()=>{const f=document.querySelector('#handoff-feedback-form');f.querySelector('[name="helped"]').value='The browser sequence made the next measurement clear.';f.querySelector('[name="stuck"]').value='I needed one more settle-time check.';f.querySelector('[name="adapted"]').value='I used a USB power meter.';f.requestSubmit();return true})()`);
    await waitForCondition(cdp,`document.querySelector('.handoff-my-feedback')?.textContent.includes('YOUR PRIVATE NOTE')`,'private Handoff learner note');
    check('Learner sees only their private Handoff note in place',await evaluate(cdp,`(()=>{const t=document.querySelector('.handoff-detail-view')?.textContent||'';return t.includes('YOUR PRIVATE NOTE')&&!t.includes('MAKER VIEW')&&!/\b\d+\s+feedback\b/i.test(t)})()`));
    await setHash(cdp,'#/gather',`Boolean(document.querySelector('.gather-library-section'))`);
    check('Gather hub renders chronological, unranked host plans',await evaluate(cdp,`(()=>{const t=document.querySelector('.gather-view')?.textContent||'';return document.querySelectorAll('.gather-kit-card').length>=4&&t.includes('Gather Kits')&&t.includes('MOST RECENTLY UPDATED')&&t.includes('NEVER RANKED')&&t.includes('Bring One Broken Thing')})()`));
    check('Gather hub exposes bounded local search and type filters',await evaluate(cdp,`Boolean(document.querySelector('#gather-local-search'))&&document.querySelectorAll('#gather-type-filter option').length>=5`));
    await setHash(cdp,'#/gather/gather_repair_clinic',`Boolean(document.querySelector('.gather-detail-view'))`);
    check('Gather detail makes welcome, roles, stations, preparation, and closing usable',await evaluate(cdp,`(()=>{const t=document.querySelector('.gather-detail-view')?.textContent||'';return document.querySelectorAll('.gather-role-list li').length>=3&&document.querySelectorAll('.gather-station-list li').length>=3&&t.includes('Welcome the room')&&t.includes('Accessibility + participation')&&t.includes('Safety + stop conditions')&&t.includes('Close the loop')})()`));
    await evaluate(cdp,`document.querySelector('[data-action="use-gather"]')?.click()`);
    await waitForCondition(cdp,`location.hash.startsWith('#/gather/gather_')&&document.querySelector('.gather-detail-meta')?.textContent.includes('Private · Draft')`,'private Gather adaptation');
    const browserGatherCopyId=await evaluate(cdp,`location.hash.split('/').pop()`);
    check('Use this kit creates a private attributed draft without unauthorized context',await evaluate(cdp,`(()=>{const links=document.querySelector('.gather-context-links')?.textContent||'';return links.includes('ADAPTED FROM')&&!links.includes('PROJECT ·')&&!links.includes('CREW ·')&&Boolean(document.querySelector('[data-action="edit-gather"]'))})()`));
    await evaluate(cdp,`document.querySelector('[data-action="edit-gather"]')?.click()`);
    await waitForCondition(cdp,`Boolean(document.querySelector('#gather-form'))`,'Gather editor');
    check('Gather editor labels access, safety, and approximate location without an address field',await evaluate(cdp,`(()=>{const f=document.querySelector('#gather-form'),t=f?.textContent||'';return t.includes('Approximate city / region')&&t.includes('Accessibility + participation notes')&&t.includes('Safety notes + stop conditions')&&!f.querySelector('[name="address"]')&&!f.querySelector('[name="exactAddress"]')})()`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]')?.click()`);
    await evaluate(cdp,`fetch('/api/gather/'+${JSON.stringify(browserGatherCopyId)},{method:'DELETE'})`);

    await setHash(cdp,'#/quests',`Boolean(document.querySelector('.local-quest-library-section'))`);
    check('Local Quest hub renders small, place-aware prompts without ranking',await evaluate(cdp,`(()=>{const t=document.querySelector('.local-quests-view')?.textContent||'';return document.querySelectorAll('.local-quest-card').length>=6&&t.includes('Local Quests')&&t.includes('SMALL ENOUGH TO TRY')&&t.includes('NO SCOREBOARD')&&t.includes('MOST RECENTLY UPDATED')})()`));
    check('Local Quest hub exposes bounded search and type filters',await evaluate(cdp,`Boolean(document.querySelector('#quest-local-search'))&&document.querySelectorAll('#quest-type-filter option').length===7`));
    await evaluate(cdp,`document.querySelector('[data-action="new-quest"]')?.click()`);
    await waitForCondition(cdp,`Boolean(document.querySelector('#local-quest-form'))`,'Local Quest editor');
    check('Local Quest editor keeps place hints approximate and omits precise location fields',await evaluate(cdp,`(()=>{const f=document.querySelector('#local-quest-form'),t=f?.textContent||'';return t.includes('Approximate place / route')&&t.includes('Do not include an address, coordinates')&&!f.querySelector('[name="address"]')&&!f.querySelector('[name="latitude"]')&&!f.querySelector('[name="longitude"]')})()`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]')?.click()`);
    await setHash(cdp,'#/quest/quest_repair_small',`Boolean(document.querySelector('.local-quest-detail-view'))`);
    check('Local Quest detail makes the prompt, access, safety, and trace usable',await evaluate(cdp,`(()=>{const t=document.querySelector('.local-quest-detail-view')?.textContent||'';return t.includes('The prompt')&&t.includes('Access + participation')&&t.includes('Safety + stop conditions')&&t.includes('Leave a trace')&&t.includes('Approximate only · never an address')})()`));
    await evaluate(cdp,`document.querySelector('[data-action="start-quest"]')?.click()`);
    await waitForCondition(cdp,`Boolean(document.querySelector('#quest-attempt-form'))`,'private Local Quest attempt');
    check('Local Quest attempt form starts private and offers intentional sharing',await evaluate(cdp,`(()=>{const f=document.querySelector('#quest-attempt-form'),t=f?.textContent||'';return t.includes('Draft notes stay private')&&t.includes('Public or Member visibility applies only after completion')&&f.querySelector('[name="visibility"]')?.value==='Private'})()`));
    await evaluate(cdp,`(()=>{const f=document.querySelector('#quest-attempt-form');f.querySelector('[name="notes"]').value='I found one loose fastener and stopped before opening the powered enclosure.';f.querySelector('[name="evidence"]').value='The same symptom remained after tightening the external fastener.';f.querySelector('[name="reflection"]').value='The useful result was knowing where the safe boundary was.';f.querySelector('[name="status"]').value='Completed';f.querySelector('[name="visibility"]').value='Public';f.requestSubmit();return true})()`);
    await waitForCondition(cdp,`document.querySelector('.local-quest-notes-section')?.textContent.includes('loose fastener')`,'published Local Quest field note');
    check('Completed Local Quest field note appears without a completion counter',await evaluate(cdp,`(()=>{const t=document.querySelector('.local-quest-detail-view')?.textContent||'';return t.includes('FIELD NOTE')&&t.includes('loose fastener')&&!/\b\d+\s+completions?\b/i.test(t)})()`));
    await setHash(cdp,'#/home');
    check('Home surfaces the Local Quest lane',await evaluate(cdp,`Boolean(document.querySelector('.home-local-quests'))&&document.querySelector('.home-local-quests')?.textContent.includes('Find Three Local Textures')`));
    await openMakeTogether(cdp);
    check('Make Together carries Local Quests without a separate social feed',await evaluate(cdp,`Boolean(document.querySelector('.quest-public-section'))&&document.querySelector('.quest-public-section')?.textContent.includes('Take a Local Quest')&&document.querySelector('.quest-public-section')?.textContent.includes('NO COUNTS')`));
    await setHash(cdp,'#/projects/p_lora');
    check('Project page exposes Local Quests in its object navigation',await evaluate(cdp,`Boolean(document.querySelector('#project-quests'))&&document.querySelector('#project-quests')?.textContent.includes('Leave a Tiny Field Card')&&Boolean(document.querySelector('[href="#project-quests"]'))`));
    await setHash(cdp,'#/crew/crew_21502');
    check('Maker Crew page exposes Local Quests in its object navigation',await evaluate(cdp,`Boolean(document.querySelector('#crew-quests'))&&document.querySelector('#crew-quests')?.textContent.includes('Ask a Maker About One Repair')&&Boolean(document.querySelector('[href="#crew-quests"]'))`));
    await setHash(cdp,'#/search/repair/quests',`Boolean(document.querySelector('.search-results'))`);
    check('Global search finds Local Quests as a bounded kind',await evaluate(cdp,`document.querySelector('.search-kind-bar a.active')?.textContent.includes('Local Quests')&&document.querySelector('.result-group')?.textContent.includes('Repair One Small Useful Thing')`));
    await setHash(cdp,'#/library',`Boolean(document.querySelector('.handoff-library-section'))`);
    check('Library keeps Handoff Field Cards beside the Shop Manual',await evaluate(cdp,`document.querySelector('.handoff-library-section')?.textContent.includes('What another maker can use')&&Boolean(document.querySelector('#library-grid'))`));

    await evaluate(cdp,`(async()=>{await fetch('/api/auth/logout',{method:'POST'});state.me=(await api('/api/me')).user;updateUserUI()})()`);
    await setHash(cdp,'#/commons',`Boolean(document.querySelector('.commons-view'))`);
    check('Commons renders the four practical exchange types',await evaluate(cdp,`document.querySelectorAll('.commons-kind-tile').length===4&&document.querySelectorAll('[data-commons-filter]').length===9`));
    check('Commons feed states chronological, unranked exchange',await evaluate(cdp,`(()=>{const t=document.querySelector('.commons-view')?.textContent||'';return t.includes('CHRONOLOGICAL')&&t.includes('not a social feed')&&!/\\b\\d+\\s+responses?\\b/i.test(t)})()`));
    await evaluate(cdp,`document.querySelector('[data-commons-filter="Need"]')?.click()`);
    check('Commons kind filter keeps only matching posts visible',await evaluate(cdp,`[...document.querySelectorAll('.commons-filter-item:not([hidden])')].every(x=>x.dataset.commonsKind==='Need')`));
    await evaluate(cdp,`document.querySelector('[data-commons-filter="all"]')?.click()`);

    await setHash(cdp,'#/commons/commons_demo_have',`Boolean(document.querySelector('.commons-detail-view'))`);
    check('Commons detail keeps anonymous responses private',await evaluate(cdp,`Boolean(document.querySelector('.commons-detail-body'))&&!document.querySelector('.commons-response-card')&&!document.querySelector('.commons-detail-view')?.textContent.includes('Responses to this post')`));
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_morgan'})});state.me=(await api('/api/me')).user;updateUserUI();await renderRoute()})()`);
    await waitForCondition(cdp,`state.me?.id==='u_morgan'`,'Commons responder login');
    await setHash(cdp,'#/commons/commons_demo_have',`Boolean(document.querySelector('.commons-detail-view'))`);
    check('Commons gives a non-owner a private response path',await evaluate(cdp,`Boolean(document.querySelector('[data-action="commons-respond"]'))&&document.querySelector('.commons-detail-view')?.textContent.includes('ONLY YOU CAN SEE THIS')`));
    await setHash(cdp,'#/projects/p_lora');
    check('Projects expose the Commons exchange surface',await evaluate(cdp,`Boolean(document.querySelector('#project-commons'))&&Boolean(document.querySelector('[href="#project-commons"]'))`));
    check('Projects expose the Handoff Field Card surface',await evaluate(cdp,`Boolean(document.querySelector('#project-handoff'))&&document.querySelector('#project-handoff')?.textContent.includes('Tune a Slow Environmental Sensor')&&Boolean(document.querySelector('[href="#project-handoff"]'))`));
    check('Projects expose attached Gather Kits in local object navigation',await evaluate(cdp,`Boolean(document.querySelector('#project-gather'))&&document.querySelector('#project-gather')?.textContent.includes('First Solder Joint Workshop')&&Boolean(document.querySelector('[href="#project-gather"]'))`));
    await openMakeTogether(cdp);
    check('Make Together carries Commons without creating a new feed module',await evaluate(cdp,`Boolean(document.querySelector('.commons-public-section'))&&document.querySelector('.commons-public-section')?.textContent.includes('NO COUNTS')`));
    check('Make Together carries Handoff Cards without feedback totals',await evaluate(cdp,`Boolean(document.querySelector('.handoff-public-section'))&&document.querySelector('.handoff-public-section')?.textContent.includes('Tune a Slow Environmental Sensor')&&document.querySelector('.handoff-public-section')?.textContent.includes('NO COUNTS')&&!document.querySelector('.handoff-public-section')?.textContent.includes('feedback')`));
    check('Make Together carries Gather Kits as project-centered host plans',await evaluate(cdp,`Boolean(document.querySelector('.gather-public-section'))&&document.querySelector('.gather-public-section')?.textContent.includes('Bring One Broken Thing')&&document.querySelector('.gather-public-section')?.textContent.includes('NO COUNTS')`));
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_mike'})});state.me=(await api('/api/me')).user;updateUserUI()})()`);
    await evaluate(cdp,`document.querySelector('#start-button')?.click()`);
    await waitForCondition(cdp,`document.querySelector('.start-intent-group')`,'Start Something Commons link');
    check('Start Something links the Commons into the existing intent flow',await evaluate(cdp,`Boolean(document.querySelector('.start-intent-group a[href="#/commons"]'))`));
    check('Start Something offers Handoff Cards in the document intent',await evaluate(cdp,`[...document.querySelectorAll('.start-intent-group')].find(x=>x.textContent.includes('DOCUMENT SOMETHING'))?.textContent.includes('Handoff Card')`));
    check('Start Something offers Gather Kits in a communal-making intent',await evaluate(cdp,`[...document.querySelectorAll('.start-intent-group')].find(x=>x.textContent.includes('GATHER PEOPLE'))?.textContent.includes('Gather Kit')`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]')?.click()`);

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
    check('Start Something offers Local Quests in the existing intent flow',await evaluate(cdp,`(()=>{const t=document.querySelector('.modal-body')?.textContent||'';return t.includes('Local Quest')&&Boolean(document.querySelector('.start-choice-v4[href="#/quests"]'))})()`));
    check('Focused density keeps authorized publishing tools available',await evaluate(cdp,`(()=>{const group=[...document.querySelectorAll('.start-intent-group')].find(x=>x.textContent.includes('PUBLISH / CURATE'));return Boolean(group)&&getComputedStyle(group).display!=='none'})()`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]').click()`);

    await evaluate(cdp,`projectForm()`);
    await waitForCondition(cdp,`document.querySelector('#project-form')`,'Project form');
    check('Project editor has one canonical visibility control',await evaluate(cdp,`document.querySelectorAll('#project-form [name="visibility"]').length===1`));
    check('Shared media picker is available in the project editor',await evaluate(cdp,`Boolean(document.querySelector('#project-form .media-picker'))`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]').click()`);

    await setHash(cdp,'#/people');
    check('People surfaces possible reciprocal Skill Exchange matches',await evaluate(cdp,`Boolean(document.querySelector('.skill-match-section'))`));
    await setHash(cdp,'#/community-builds');
    check('Community Builds expose team formation without a new module',await evaluate(cdp,`Boolean(document.querySelector('[data-action="form-community-team"]'))&&Boolean(document.querySelector('[data-action="community-teams"]'))`));
    await setHash(cdp,'#/projects/p_flip');
    check('Collaborative Projects show visible MADE BY / WITH credits',await evaluate(cdp,`document.querySelector('.project-byline')?.textContent.includes('MADE BY')&&document.querySelector('.project-byline')?.textContent.includes('WITH')`));

    await setHash(cdp,'#/projects/p_knob');
    check('Project page exposes local object navigation',await evaluate(cdp,`document.querySelectorAll('.project-section-nav a').length>=5`));
    check('Project page provides a share action',await evaluate(cdp,`Boolean(document.querySelector('[data-action="share-current"]'))`));
    check('Owned Project exposes callsign collaborator invitation',await evaluate(cdp,`Boolean(document.querySelector('[data-action="invite-collaborator"]'))`));
    check('Owned Project exposes an Open Bench control',await evaluate(cdp,`Boolean(document.querySelector('[data-action="open-bench-edit"]'))`));
    await evaluate(cdp,`document.querySelector('[data-action="open-bench-edit"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#open-bench-signal-form')`,'Open Bench editor');
    check('Open Bench editor offers bounded participation choices',await evaluate(cdp,`document.querySelectorAll('#open-bench-signal-form [name="openSignal"]').length===6`));
    await evaluate(cdp,`(()=>{const f=document.querySelector('#open-bench-signal-form');f.querySelector('[value="feedback"]').checked=true;f.querySelector('[value="tester"]').checked=true;f.querySelector('[name="openRequest"]').value='Try the revised knob outdoors and report how it feels.';f.requestSubmit()})()`);
    await waitForCondition(cdp,`document.querySelector('.project-open-bench')?.textContent.includes('Try the revised knob outdoors')`,'Open Bench project callout');
    check('Saved Open Bench invitation renders on the Project',await evaluate(cdp,`document.querySelectorAll('.project-open-bench .open-bench-chip').length===2`));
    await evaluate(cdp,`document.querySelector('[data-action="schedule-bench-hour"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#open-bench-hour-form')`,'Open Bench Hour editor');
    check('Open Bench Hour editor explains private requests and hidden capacity',await evaluate(cdp,`document.querySelector('#open-bench-hour-form')?.textContent.includes('Requests stay private')&&document.querySelector('#open-bench-hour-form')?.textContent.includes('not displayed publicly')`));
    await evaluate(cdp,`(()=>{const f=document.querySelector('#open-bench-hour-form'),d=new Date(Date.now()+4*86400000);d.setMinutes(0,0,0);const local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);f.querySelector('[name="topic"]').value='Browser QA knob test hour';f.querySelector('[name="startsAt"]').value=local;f.querySelector('[name="format"]').value='Video / Voice';f.querySelector('[name="publicNote"]').value='Bring one glove test observation.';f.querySelector('[name="privateDetails"]').value='Join the private Browser QA room.';f.querySelector('[name="capacity"]').value='1';f.requestSubmit()})()`);
    await waitForCondition(cdp,`document.querySelector('.open-bench-hour')?.textContent.includes('Browser QA knob test hour')`,'scheduled Open Bench Hour');
    check('Scheduled Open Bench Hour stays attached to the Project',await evaluate(cdp,`Boolean(document.querySelector('#open-bench-hours'))&&document.querySelector('.open-bench-hour')?.textContent.includes('AVAILABLE')`));
    await evaluate(cdp,`document.querySelector('[data-action="invite-collaborator"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#invite-form [name="callsign"]')`,'Callsign collaborator invite');
    check('Collaborator invitation uses global callsign address',await evaluate(cdp,`document.querySelector('#invite-form [name="callsign"]')?.placeholder==='@paperpilot'`));
    await evaluate(cdp,`document.querySelector('[data-action="close-overlay"]')?.click()`);
    check('Project page exposes Guided Build',await evaluate(cdp,`Boolean(document.querySelector('#project-guide .guided-build-grid'))`));
    check('Project can ask Workshop with project context',await evaluate(cdp,`Boolean(document.querySelector('[data-action="project-help"]'))`));
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_lee'})});state.me=(await api('/api/me')).user;updateUserUI();await renderProject('p_knob')})()`);
    await waitForCondition(cdp,`Boolean(document.querySelector('[data-action="request-bench-hour"]'))`,'Open Bench Hour request control');
    await evaluate(cdp,`document.querySelector('[data-action="request-bench-hour"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#bench-hour-request-form')`,'Open Bench Hour request form');
    await evaluate(cdp,`(()=>{const f=document.querySelector('#bench-hour-request-form');f.querySelector('[name="note"]').value='I can bring a work-glove observation.';f.requestSubmit()})()`);
    await waitForCondition(cdp,`document.querySelector('.open-bench-hour')?.textContent.includes('MY REQUEST · PENDING')`,'private Open Bench Hour request');
    check('Maker can request an Open Bench Hour without seeing connection details',await evaluate(cdp,`!document.querySelector('.bench-hour-private')&&Boolean(document.querySelector('[data-action="withdraw-bench-hour"]'))`));
    await waitForCondition(cdp,`Boolean(document.querySelector('[data-action="open-bench-respond"]'))`,'Open Bench response control');
    await evaluate(cdp,`document.querySelector('[data-action="open-bench-respond"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#open-bench-response-form')`,'Open Bench response editor');
    await evaluate(cdp,`(()=>{const f=document.querySelector('#open-bench-response-form');f.querySelector('[name="message"]').value='I can test the grip with work gloves this week.';f.requestSubmit()})()`);
    await waitForCondition(cdp,`[...document.querySelectorAll('.bench-handshake>p')].some(x=>x.textContent.includes('I can test the grip with work gloves'))`,'Bench Handshake attached to project');
    check('Open Bench response becomes a project-attached Handshake',await evaluate(cdp,`document.querySelector('.bench-handshake-status')?.textContent.includes('HAND EXTENDED')`));
    check('Offering maker can withdraw an active Handshake',await evaluate(cdp,`Boolean(document.querySelector('[data-action="withdraw-bench-handshake"]'))`));
    await openMakeTogether(cdp);
    check('Make Together presents the full participation path',await evaluate(cdp,`document.querySelectorAll('.make-together-path>div').length===4&&document.querySelector('.make-together-path')?.textContent.includes('LEAVE A TRACE')`));
    check('Make Together collects the maker’s private pending work',await evaluate(cdp,`document.querySelector('.make-together-my-work')?.textContent.includes('PENDING')&&document.querySelector('.make-together-my-work')?.textContent.includes('Browser QA knob test hour')&&!document.querySelector('.make-together-private')`));
    check('Make Together exposes bounded participation filters',await evaluate(cdp,`document.querySelectorAll('[data-together-filter]').length===8`));
    await evaluate(cdp,`document.querySelector('[data-together-filter="tester"]')?.click()`);
    check('Make Together filters Project invitations without ranking them',await evaluate(cdp,`[...document.querySelectorAll('[data-together-kind="project"]:not([hidden])')].every(x=>x.dataset.togetherSignals.split(' ').includes('tester'))&&document.querySelector('[data-together-section="time"]').hidden`));
    await setHash(cdp,'#/home');
    check('Signed-in Home explains a transparent Way In',await evaluate(cdp,`document.querySelector('.ways-in-home')?.textContent.includes('WHERE I COULD HELP')&&document.querySelector('.way-in-reasons')?.textContent.includes('WHY THIS MAY BE A WAY IN')`));
    check('Home surfaces upcoming Open Bench Hours without a new module',await evaluate(cdp,`document.querySelector('.home-bench-hours')?.textContent.includes('Browser QA knob test hour')&&document.querySelector('.home-bench-hours')?.textContent.includes('Soonest first, never ranked')&&!document.querySelector('.home-bench-hours .bench-hour-private')`));
    await setHash(cdp,'#/builds');
    check('Open Benches can be filtered by invitation type',await evaluate(cdp,`document.querySelectorAll('#open-bench-filters [data-open-filter]').length===8`));
    await evaluate(cdp,`document.querySelector('#open-bench-filters [data-open-filter="tester"]')?.click()`);
    check('Invitation filter keeps matching Open Benches visible',await evaluate(cdp,`[...document.querySelectorAll('#open-bench-grid .open-bench-card:not([hidden])')].every(x=>x.dataset.openSignals.split(' ').includes('tester'))`));
    await setHash(cdp,'#/projects/p_knob');
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_mike'})});state.me=(await api('/api/me')).user;updateUserUI();await renderProject('p_knob')})()`);
    await waitForCondition(cdp,`Boolean(document.querySelector('[data-action="review-bench-handshake"]'))`,'Bench Handshake owner controls');
    check('Project owner can review the Handshake in place',true);
    await waitForCondition(cdp,`Boolean(document.querySelector('[data-action="review-bench-hour"][data-status="Accepted"]'))`,'Open Bench Hour host review');
    await evaluate(cdp,`document.querySelector('[data-action="review-bench-hour"][data-status="Accepted"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('.bench-hour-requests')?.textContent.includes('ACCEPTED')`,'accepted Open Bench Hour request');
    check('Host can accept the private Open Bench Hour request in place',true);
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_lee'})});state.me=(await api('/api/me')).user;updateUserUI();await renderProject('p_knob')})()`);
    await waitForCondition(cdp,`document.querySelector('.bench-hour-private')?.textContent.includes('private Browser QA room')`,'accepted Open Bench Hour details');
    check('Accepted maker receives private connection details',true);
    await openMakeTogether(cdp);
    check('Accepted-only details carry into the private Make Together queue',await evaluate(cdp,`document.querySelector('.make-together-action-state')?.textContent.includes('CONFIRMED')&&document.querySelector('.make-together-private')?.textContent.includes('private Browser QA room')`));
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_mike'})});state.me=(await api('/api/me')).user;updateUserUI()})()`);
    await setHash(cdp,'#/projects/p_lora');
    check('Public project can be personalized with Make It Yours',await evaluate(cdp,`Boolean(document.querySelector('[data-action="make-it-yours"]'))`));
    check('Visible Project exposes follow control',await evaluate(cdp,`Boolean(document.querySelector('[data-action="follow-project"]'))`));
    await evaluate(cdp,`document.querySelector('[data-action="follow-project"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('[data-action="follow-project"]')?.textContent.includes('FOLLOWING')`,'Project follow state');
    check('Project follow updates in place',true);
    check('Project Talk advertises callsign mentions',await evaluate(cdp,`document.querySelector('#comment-body')?.getAttribute('placeholder')?.includes('@callsign')`));
    await evaluate(cdp,`(()=>{const t=document.querySelector('#comment-body');t.value='Browser QA project comment';document.querySelector('#comment-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
    await waitForCondition(cdp,`[...document.querySelectorAll('.comment-v4 p')].some(x=>x.textContent.includes('Browser QA project comment'))`,'Project comment render');
    check('Project comments render without leaving the Project',true);
    await evaluate(cdp,`[...document.querySelectorAll('.comment-v4')].find(x=>x.textContent.includes('Browser QA project comment'))?.querySelector('[data-action="reply-project-comment"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#project-comment-reply')`,'Project reply editor');
    await evaluate(cdp,`(()=>{const f=document.querySelector('#project-comment-reply');f.querySelector('textarea').value='Browser QA reply';f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
    await waitForCondition(cdp,`[...document.querySelectorAll('.comment-reply p')].some(x=>x.textContent.includes('Browser QA reply'))`,'Project reply render');
    check('Project one-level reply renders in place',true);
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_lee'})});state.me=(await api('/api/me')).user;updateUserUI();await renderProject('p_lora')})()`);
    await waitForCondition(cdp,`[...document.querySelectorAll('.comment-v4')].some(x=>x.textContent.includes('Browser QA project comment')&&Boolean(x.querySelector('[data-action="mark-project-response"]')))`,'Useful Response owner control');
    await evaluate(cdp,`[...document.querySelectorAll('.comment-v4')].find(x=>x.textContent.includes('Browser QA project comment'))?.querySelector('[data-action="mark-project-response"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#useful-response-form')`,'Useful Response form');
    check('Useful Response form explains outcome over popularity',await evaluate(cdp,`document.querySelector('#useful-response-form')?.textContent.includes('does not create points, totals, or a ranking')&&document.querySelectorAll('#useful-response-form [name="mark"]').length===3`));
    await evaluate(cdp,`(()=>{const f=document.querySelector('#useful-response-form');f.querySelector('[value="Changed the Build"]').checked=true;f.querySelector('[name="note"]').value='This changed the enclosure power-budget decision.';f.requestSubmit()})()`);
    await waitForCondition(cdp,`document.querySelector('.useful-response-marker')?.textContent.includes('Changed the Build')`,'Useful Response marker');
    check('Useful Response remains attached to Project Talk',await evaluate(cdp,`document.querySelector('.useful-response-marker')?.textContent.includes('power-budget decision')`));
    await evaluate(cdp,`(async()=>{await fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'u_mike'})});state.me=(await api('/api/me')).user;updateUserUI();await renderProject('p_lora')})()`);
    await evaluate(cdp,`document.querySelector('[data-action="make-it-yours"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#make-it-yours-form')`,'Make It Yours editor');
    check('Make It Yours keeps source adaptation context explicit',await evaluate(cdp,`document.querySelector('#make-it-yours-form')?.textContent.includes('What will you change?')`));
    await evaluate(cdp,`(()=>{const f=document.querySelector('#make-it-yours-form');f.querySelector('[name="title"]').value='Browser QA LoRa Variation';f.querySelector('[name="adaptation"]').value='Use a slower sampling interval and a smaller battery.';f.requestSubmit()})()`);
    await waitForCondition(cdp,`document.querySelector('.variation-origin-callout')?.textContent.includes('LoRa Environmental Sensor')`,'Variation source context');
    check('New Maker Variation preserves visible source and intent',await evaluate(cdp,`document.querySelector('.variation-origin-callout')?.textContent.includes('slower sampling interval')&&Boolean(document.querySelector('[data-action="show-what-built"]'))`));
    await evaluate(cdp,`document.querySelector('[data-action="show-what-built"]')?.click()`);
    await waitForCondition(cdp,`document.querySelector('#show-built-form [name="variationOutcome"]')`,'Maker Variation result form');
    await evaluate(cdp,`(()=>{const f=document.querySelector('#show-built-form');f.querySelector('[name="variationOutcome"]').value='The slower interval cut idle draw without losing useful readings.';f.requestSubmit()})()`);
    await waitForCondition(cdp,`document.querySelector('.technical-index')?.textContent.includes('Complete')||document.querySelector('.project-hero-v4')?.textContent.includes('Complete')`,'completed Maker Variation');
    await setHash(cdp,'#/projects/p_lora');
    await waitForCondition(cdp,`document.querySelector('.maker-variation-card')?.textContent.includes('Browser QA LoRa Variation')`,'source Project Maker Variations');
    check('Source Project receives the completed variation outcome',await evaluate(cdp,`document.querySelector('.maker-variation-card')?.textContent.includes('cut idle draw')&&document.querySelector('.project-variations')?.textContent.includes('NEVER RANKED')`));

    const crewId=await evaluate(cdp,`(async()=>{const d=await fetch('/api/crews').then(r=>r.json());return d.crews?.[0]?.id||d.items?.[0]?.id||''})()`);
    if(crewId){
      await setHash(cdp,`#/crew/${encodeURIComponent(crewId)}`);
      check('Maker Crew page exposes local object navigation',await evaluate(cdp,`document.querySelectorAll('.crew-local-nav a').length>=5`));
      check('Maker Crew page exposes local Handoff Cards',await evaluate(cdp,`Boolean(document.querySelector('#crew-handoff'))&&Boolean(document.querySelector('.crew-local-nav a[href$="/handoff"]'))`));
      check('Maker Crew page keeps Gather Kits beside its meetups',await evaluate(cdp,`Boolean(document.querySelector('#crew-gather'))&&Boolean(document.querySelector('.crew-local-nav a[href$="/gather"]'))&&document.querySelector('#crew-gather')?.textContent.includes('Bring One Broken Thing')`));
      await evaluate(cdp,`document.querySelector('[data-action=\"crew-studio\"]')?.click()`);
      await waitForCondition(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')`,'Crew Studio members');
      const beforeRole=await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent||''`);
      await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"] [data-role=\"Moderator\"]')?.click()`);
      await waitForCondition(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent.includes('Moderator')&&Boolean(document.querySelector('.modal-body [data-crew-member=\"u_rin\"] [data-role=\"Member\"]'))`,'live Crew role refresh');
      const afterRole=await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent||''`);
      check('Crew role change updates Studio immediately without reopening',beforeRole.includes('Member')&&afterRole.includes('Moderator')&&Boolean(await evaluate(cdp,`document.querySelector('.modal')`)),`${beforeRole} -> ${afterRole}`);
      check('Crew Studio exposes globally unique handle control',await evaluate(cdp,`Boolean(document.querySelector('#crew-handle-form [name="address"]'))&&document.querySelector('#crew-handle-form [name="address"]')?.value==='mc21502'`));
      await evaluate(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"] [data-role=\"Member\"]')?.click()`);
      await waitForCondition(cdp,`document.querySelector('.modal-body [data-crew-member=\"u_rin\"]')?.textContent.includes('Member')`,'restore Crew member role');
      await evaluate(cdp,`document.querySelector('[data-action=\"close-overlay\"]')?.click()`);

      const qaCrew=await evaluate(cdp,`(async()=>{const r=await fetch('/api/crews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'BQA'+Date.now().toString().slice(-6),name:'Browser One Click Map Crew',anchorPostalCode:'21502',cityRegion:'Cumberland, MD',country:'US',status:'Paused',visibility:'Private'})});return await r.json()})()`);
      if(qaCrew?.id){
        await evaluate(cdp,`crewStudio(${JSON.stringify(qaCrew.id)})`);
        await waitForCondition(cdp,`Boolean(document.querySelector('[data-action=\"crew-map-enable\"]'))`,'one-click map button');
        const mapStatusBefore=await evaluate(cdp,`document.querySelector('.modal-body .crew-map-status')?.textContent.trim()||''`);
        check('Crew Studio exposes one-click map visibility',/(NOT PUBLISHED|VISIBLE ON MAP)/.test(mapStatusBefore)&&Boolean(await evaluate(cdp,`document.querySelector('.modal-body .crew-studio-map-card')`)),mapStatusBefore);
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

    await setHash(cdp,'#/home');
    check('Home surfaces Around the Workshop activity without becoming a feed',await evaluate(cdp,`document.querySelector('.around-workshop')?.textContent.includes('AROUND THE WORKSHOP')`));
    await evaluate(cdp,`fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({workingOn:'Browser QA is making something',workingOnDays:7})}).then(r=>r.json())`);
    await setHash(cdp,'#/bench');
    check('My Bench surfaces temporary Working On status',await evaluate(cdp,`document.querySelector('.working-on-badge')?.textContent.includes('Browser QA is making something')`));
    if(crewId){await setHash(cdp,`#/crew/${encodeURIComponent(crewId)}`);check('Maker Crew local navigation exposes Crew Board',await evaluate(cdp,`[...document.querySelectorAll('.crew-local-nav a')].some(a=>a.textContent.includes('CREW BOARD'))`));}

    await setHash(cdp,'#/live');
    check('Live page exposes calendar export',await evaluate(cdp,`Boolean(document.querySelector('a[href="/api/calendar.ics"]'))`));
    check('Live + Calendar exposes Gather Kits without a new primary module',await evaluate(cdp,`Boolean(document.querySelector('a[href="#/gather"]'))&&[...document.querySelectorAll('.calendar-card')].some(x=>x.textContent.includes('GATHER KIT ATTACHED'))`));
    check('Owned Open Bench Hours appear in the existing calendar',await evaluate(cdp,`[...document.querySelectorAll('.calendar-card')].some(x=>x.textContent.includes('OPEN BENCH HOUR')&&x.textContent.includes('Browser QA knob test hour'))`));
    const liveHref=await evaluate(cdp,`document.querySelector('.calendar-card[href^="#/live/"]')?.getAttribute('href')||''`);
    if(liveHref){await setHash(cdp,liveHref);check('Live event exposes Interested and I’m Going attendance controls',await evaluate(cdp,`Boolean(document.querySelector('[data-action="live-attendance"][data-status="Interested"]'))&&Boolean(document.querySelector('[data-action="live-attendance"][data-status="Going"]'))`));}

    await setHash(cdp,'#/search/gear/all');
    check('Global search follows consolidated IA',await evaluate(cdp,`(()=>{const t=document.querySelector('#route-view')?.textContent||'';return t.includes('Community Builds')&&t.includes('Help + Critique')})()`));
    check('Global search exposes Open Benches and Notes without new modules',await evaluate(cdp,`(()=>{const t=document.querySelector('.search-kind-bar')?.textContent||'';return t.includes('Open Benches')&&t.includes('Notes & Logs')})()`));
    await setHash(cdp,'#/search/low%20power/handoff',`Boolean(document.querySelector('.search-results'))`);
    check('Global search finds Handoff Cards as a bounded kind',await evaluate(cdp,`document.querySelector('.search-kind-bar a.active')?.textContent.includes('Handoff Cards')&&document.querySelector('.result-group')?.textContent.includes('Tune a Slow Environmental Sensor')`));
    await setHash(cdp,'#/search/repair%20clinic/gather',`Boolean(document.querySelector('.search-results'))`);
    check('Global search finds Gather Kits as a bounded kind',await evaluate(cdp,`document.querySelector('.search-kind-bar a.active')?.textContent.includes('Gather Kits')&&document.querySelector('.result-group')?.textContent.includes('Bring One Broken Thing')`));

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
