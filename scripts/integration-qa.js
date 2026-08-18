#!/usr/bin/env node
'use strict';
const {spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const net=require('net');

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});s.on('error',reject);});}
function cookieFrom(res){const raw=res.headers.get('set-cookie')||'';return raw.split(';')[0];}
async function waitFor(url,tries=60){for(let i=0;i<tries;i++){try{const r=await fetch(url);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(`Server did not become ready: ${url}`);}
async function json(base,pathname,{method='GET',body,cookie,headers={}}={}){
  const h={...headers}; if(body!==undefined){h['content-type']='application/json';body=JSON.stringify(body);} if(cookie)h.cookie=cookie;
  const res=await fetch(base+pathname,{method,body,headers:h,redirect:'manual'});
  const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={text}};
  return {res,data};
}
const checks=[];function check(name,ok,detail=''){checks.push([name,Boolean(ok),detail]);}
(async()=>{
  const port=await freePort();const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'workshop-v9-int-'));const root=path.resolve(__dirname,'..');
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),WORKSHOP_DATA_DIR:dataDir,WORKSHOP_DEV_AUTH:'1',WORKSHOP_SEED_DEMO:'1',NODE_ENV:'development'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  const base=`http://127.0.0.1:${port}`;
  try{
    await waitFor(base+'/api/meta');
    let r=await json(base,'/api/meta');check('meta reports v9.0.0',r.res.ok&&r.data.version==='9.0.0');

    r=await json(base,'/api/projects');
    check('anonymous project list hides Members project',r.res.ok&&!r.data.projects.some(p=>p.id==='p_knob'));
    r=await json(base,'/api/projects/p_knob');check('anonymous direct project route hides Members project',r.res.status===404);
    r=await json(base,'/api/home');check('anonymous Home feed hides Members project',r.res.ok&&!r.data.projects.some(p=>p.id==='p_knob')&&!r.data.continueProject);
    r=await json(base,'/api/search?q=Cast%20Aluminum&kind=projects');check('anonymous search hides Members project',r.res.ok&&!r.data.projects.some(p=>p.id==='p_knob'));

    const loginMike=await json(base,'/api/auth/dev-login',{method:'POST',body:{userId:'u_mike'}});const mike=cookieFrom(loginMike.res);
    check('development Mike login works',loginMike.res.ok&&mike.includes('='));
    r=await json(base,'/api/projects/p_knob',{cookie:mike});check('signed-in member can view Members project',r.res.ok&&r.data.project?.id==='p_knob');

    const privateCreate=await json(base,'/api/projects',{method:'POST',cookie:mike,body:{title:'Integration Private Project',visibility:'Private',status:'Active'}});
    const privateId=privateCreate.data.project?.id;check('owner can create Private project',privateCreate.res.status===201&&privateId);
    const loginLee=await json(base,'/api/auth/dev-login',{method:'POST',body:{userId:'u_lee'}});const lee=cookieFrom(loginLee.res);
    r=await json(base,`/api/projects/${privateId}`,{cookie:lee});check('Private project hidden from another member',r.res.status===404);
    r=await json(base,`/api/projects/${privateId}`,{cookie:mike});check('Private project visible to owner',r.res.ok&&r.data.project?.id===privateId);
    r=await json(base,'/api/bench/u_mike',{cookie:lee});check('Member Bench hides another maker’s Private project',r.res.ok&&!r.data.projects.some(p=>p.id===privateId));

    for(const [name,url,key] of [
      ['Community Builds aggregate','/api/community-builds','items'],['Help aggregate','/api/help','items'],['Calendar aggregate','/api/calendar','items']]){
      r=await json(base,url,{cookie:mike});check(`${name} responds`,r.res.ok&&Array.isArray(r.data[key]));
    }
    const ics=await fetch(base+'/api/calendar.ics',{headers:{cookie:mike}});const icsText=await ics.text();check('Calendar ICS export responds',ics.ok&&icsText.includes('BEGIN:VCALENDAR'));
    r=await json(base,'/api/version-diagnostics',{cookie:mike});check('Version diagnostics aligns',r.res.ok&&r.data.serverVersion==='9.0.0');
    r=await json(base,'/api/instruments',{cookie:mike});check('Retired Field Instrument Lab API is not routable',r.res.status===404);

    r=await json(base,'/api/blocks/u_lee',{method:'POST',cookie:mike,body:{kind:'Mute'}});check('Mute relation can be created',r.res.status===201&&r.data.kind==='Mute');
    r=await json(base,'/api/blocks',{cookie:mike});check('Mute relation can be read',r.res.ok&&r.data.items.some(x=>x.blocked_user_id==='u_lee'&&x.kind==='Mute'));
    r=await json(base,'/api/blocks/u_lee',{method:'DELETE',cookie:mike});check('Mute/block relation can be removed',r.res.ok);

    const idem='integration-idem-'+Date.now();
    const createBody={title:'Idempotent Offline Project',visibility:'Private'};
    const first=await json(base,'/api/projects',{method:'POST',cookie:mike,headers:{'x-idempotency-key':idem},body:createBody});
    const second=await json(base,'/api/projects',{method:'POST',cookie:mike,headers:{'x-idempotency-key':idem},body:createBody});
    check('Idempotent write returns same created object',first.res.status===201&&second.res.status===201&&first.data.project?.id===second.data.project?.id);
    check('Idempotent replay is explicitly marked',second.res.headers.get('x-idempotent-replay')==='1');
    const crossAccount=await json(base,'/api/projects',{method:'POST',cookie:lee,headers:{'x-idempotency-key':idem},body:{...createBody,title:'Lee Scoped Idempotency Project'}});
    check('Idempotency keys are scoped per account',crossAccount.res.status===201&&crossAccount.data.project?.id!==first.data.project?.id&&crossAccount.res.headers.get('x-idempotent-replay')!=='1');
    r=await json(base,'/api/projects',{cookie:mike});check('Idempotent replay does not duplicate project',r.data.projects.filter(p=>p.title==='Idempotent Offline Project').length===1);

    r=await json(base,'/api/scrap-bin',{method:'POST',cookie:mike,body:{title:'Integration scrap',scope:'Will Ship',visibility:'Members'}});check('Scoped Scrap Exchange write works',r.res.status===201&&r.data.id);
    r=await json(base,'/api/scrap-bin?scope=Will%20Ship',{cookie:mike});check('Scoped Scrap Exchange filter works',r.res.ok&&r.data.items.some(x=>x.title==='Integration scrap'));
  }catch(err){check('integration harness completed',false,err.stack||err.message);}
  finally{child.kill('SIGTERM');setTimeout(()=>{try{child.kill('SIGKILL')}catch{}},500);try{fs.rmSync(dataDir,{recursive:true,force:true})}catch{}}
  let failed=0;for(const [name,ok,detail] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}${!ok&&detail?` — ${detail}`:''}`);if(!ok)failed++;}
  if(failed){console.error(`\n${failed} integration QA check(s) failed.\n${logs.slice(-2000)}`);process.exit(1);}else console.log(`\n${checks.length}/${checks.length} integration QA checks passed.`);
})().catch(err=>{console.error(err);process.exit(1)});
