#!/usr/bin/env node
'use strict';
const {spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const net=require('net');
const pkg=require('../package.json');

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
    let r=await json(base,'/api/meta');check(`meta reports v${pkg.version}`,r.res.ok&&r.data.version===pkg.version);

    r=await json(base,'/api/projects');
    check('anonymous project list hides Members project',r.res.ok&&!r.data.projects.some(p=>p.id==='p_knob'));
    r=await json(base,'/api/projects/p_knob');check('anonymous direct project route hides Members project',r.res.status===404);
    r=await json(base,'/api/home');check('anonymous Home feed hides Members project',r.res.ok&&!r.data.projects.some(p=>p.id==='p_knob')&&!r.data.continueProject);
    r=await json(base,'/api/search?q=Cast%20Aluminum&kind=projects');check('anonymous search hides Members project',r.res.ok&&!r.data.projects.some(p=>p.id==='p_knob'));

    const loginMike=await json(base,'/api/auth/dev-login',{method:'POST',body:{userId:'u_mike'}});const mike=cookieFrom(loginMike.res);
    check('development Mike login works',loginMike.res.ok&&mike.includes('='));
    r=await json(base,'/api/projects/p_knob',{cookie:mike});check('signed-in member can view Members project',r.res.ok&&r.data.project?.id==='p_knob');

    r=await json(base,'/api/crews/crew_21502',{cookie:mike});check('Existing Maker Crew receives deterministic fallback handle',r.res.ok&&r.data.item?.handle==='mc21502');
    r=await json(base,'/api/identity/check?address=mc21502');check('Crew handle occupies the shared global namespace',r.res.ok&&r.data.available===false&&r.data.entityType==='crew');
    r=await json(base,'/api/me/callsign',{method:'PUT',cookie:mike,body:{address:'qa-maker'}});check('Member can claim a callsign',r.res.ok&&r.data.address==='qa-maker'&&r.data.user?.callsign==='qa-maker');
    r=await json(base,'/api/identity/qa-maker');check('Callsign resolves through the global registry',r.res.ok&&r.data.entityType==='user'&&r.data.entityId==='u_mike');
    r=await json(base,'/api/crews/crew_21502/handle',{method:'PUT',cookie:mike,body:{address:'qa-maker'}});check('Crew cannot claim a person callsign',r.res.status===409);
    r=await json(base,'/api/me/callsign',{method:'PUT',cookie:mike,body:{address:'qa-maker-2'}});check('Member can rename callsign',r.res.ok&&r.data.address==='qa-maker-2');
    r=await json(base,'/api/identity/check?address=qa-maker');check('Retired callsign enters 30-day cooldown before reuse',r.res.ok&&r.data.available===false&&r.data.status==='cooldown'&&Boolean(r.data.availableAt));

    const mapCrewCreate=await json(base,'/api/crews',{method:'POST',cookie:mike,body:{code:'QA901',name:'One Click Map QA Crew',anchorPostalCode:'21502',cityRegion:'Cumberland, MD',country:'US',status:'Paused',visibility:'Private'}});
    const mapCrewId=mapCrewCreate.data.id;check('QA Crew can start hidden with no coordinates',mapCrewCreate.res.status===201&&mapCrewId);
    r=await json(base,`/api/crews/${mapCrewId}/map-enable`,{method:'POST',cookie:mike,body:{}});check('One-click Crew map enable succeeds',r.res.ok&&r.data.mapVisible===true&&Number.isFinite(Number(r.data.map?.latitude))&&r.data.item?.status==='Active'&&r.data.item?.visibility==='Public');
    r=await json(base,'/api/workshop-map');check('One-click map-enabled Crew appears on public Workshop Map',r.res.ok&&r.data.crews.some(c=>c.id===mapCrewId));
    r=await json(base,`/api/crews/${mapCrewId}/map-location`,{method:'PUT',cookie:mike,body:{latitude:39.68050852174287,longitude:-78.76667986159089}});check('Crew map latitude and longitude can be edited',r.res.ok&&Math.abs(Number(r.data.map?.latitude)-39.68050852174287)<1e-12&&Math.abs(Number(r.data.map?.longitude)+78.76667986159089)<1e-12&&r.data.map?.source==='Manual Crew marker');
    r=await json(base,'/api/workshop-map');const editedMapCrew=r.data.crews.find(c=>c.id===mapCrewId);check('Edited Crew coordinates immediately drive the public marker',r.res.ok&&Math.abs(Number(editedMapCrew?.latitude)-39.68050852174287)<1e-12&&Math.abs(Number(editedMapCrew?.longitude)+78.76667986159089)<1e-12);
    r=await json(base,`/api/crews/${mapCrewId}/map-location`,{method:'PUT',cookie:mike,body:{resetToAnchor:true}});check('Crew marker can reset to starred ZIP centroid',r.res.ok&&r.data.map?.postalCode==='21502'&&Number.isFinite(Number(r.data.map?.latitude))&&Number.isFinite(Number(r.data.map?.longitude))&&String(r.data.map?.source||'').includes('21502'));

    r=await json(base,'/api/crews/crew_21502/members/u_rin',{method:'PUT',cookie:mike,body:{role:'Moderator',status:'Active'}});check('Crew role update returns the live updated member',r.res.ok&&r.data.member?.role==='Moderator'&&r.data.member?.user_id==='u_rin');
    r=await json(base,'/api/crews/crew_21502',{cookie:mike});check('Crew role change is immediately visible on the next Crew payload',r.res.ok&&r.data.item?.members.some(m=>m.user_id==='u_rin'&&m.role==='Moderator'));
    await json(base,'/api/crews/crew_21502/members/u_rin',{method:'PUT',cookie:mike,body:{role:'Member',status:'Active'}});

    const privateCreate=await json(base,'/api/projects',{method:'POST',cookie:mike,body:{title:'Integration Private Project',visibility:'Private',status:'Active'}});
    const privateId=privateCreate.data.project?.id;check('owner can create Private project',privateCreate.res.status===201&&privateId);
    const loginLee=await json(base,'/api/auth/dev-login',{method:'POST',body:{userId:'u_lee'}});const lee=cookieFrom(loginLee.res);
    const leeCallsign=await json(base,'/api/me/callsign',{method:'PUT',cookie:lee,body:{address:'qa-lee'}});check('Second member can claim callsign for collaboration QA',leeCallsign.res.ok&&leeCallsign.data.address==='qa-lee');
    r=await json(base,`/api/projects/${privateId}`,{cookie:lee});check('Private project hidden from another member',r.res.status===404);
    r=await json(base,`/api/projects/${privateId}`,{cookie:mike});check('Private project visible to owner',r.res.ok&&r.data.project?.id===privateId);
    r=await json(base,'/api/bench/u_mike',{cookie:lee});check('Member Bench hides another maker’s Private project',r.res.ok&&!r.data.projects.some(p=>p.id===privateId));
    const collabInvite=await json(base,`/api/projects/${privateId}/collaboration-invites`,{method:'POST',cookie:mike,body:{callsign:'@qa-lee',role:'Reviewer',message:'Please review this build.'}});check('Project owner can invite collaborator by callsign',collabInvite.res.status===201&&collabInvite.data.id);
    r=await json(base,`/api/collaboration-invites/${collabInvite.data.id}`,{method:'PUT',cookie:lee,body:{status:'Accepted'}});check('Callsign collaboration invitation can be accepted',r.res.ok&&r.data.status==='Accepted');
    r=await json(base,`/api/projects/${privateId}`,{cookie:mike});check('Accepted collaborator is visibly credited with role and callsign',r.res.ok&&r.data.collaborators.some(c=>c.user_id==='u_lee'&&c.role==='Reviewer'&&c.callsign==='qa-lee'));
    r=await json(base,'/api/skill-exchange',{cookie:mike});check('Skill Exchange returns explicit reciprocal matches',r.res.ok&&Array.isArray(r.data.matches)&&r.data.matches.some(x=>Number(x.matchScore)>0));

    r=await json(base,'/api/projects/p_lora/follow',{method:'POST',cookie:mike,body:{}});check('Member can follow a visible Project',r.res.ok&&r.data.following===true&&r.data.followerCount>=1);
    r=await json(base,'/api/projects/p_lora',{cookie:mike});check('Project payload reports active follow state',r.res.ok&&r.data.project?.following===true&&r.data.project?.followerCount>=1);
    const followLog=await json(base,'/api/projects/p_lora/logs',{method:'POST',cookie:lee,body:{type:'Test',title:'Follower notification QA',body:'A meaningful test update for project followers.'}});check('Project owner can add followed-project update',followLog.res.status===201);
    r=await json(base,'/api/notifications',{cookie:mike});check('Project follower receives restrained update notification',r.res.ok&&r.data.items.some(n=>n.kind==='project'&&String(n.body).includes('LoRa Environmental Sensor')));
    const rootComment=await json(base,'/api/projects/p_lora/comments',{method:'POST',cookie:mike,body:{body:'Could we document the power budget tradeoff here?'}});const rootCommentId=rootComment.data.comment?.id;check('Project comment can be created',rootComment.res.status===201&&rootCommentId);
    const replyComment=await json(base,'/api/projects/p_lora/comments',{method:'POST',cookie:lee,body:{body:'Yes — I will add the measured numbers.',parentId:rootCommentId}});check('Project comment supports one-level reply',replyComment.res.status===201&&replyComment.data.comment?.parent_id===rootCommentId);
    r=await json(base,'/api/projects/p_lora',{cookie:mike});check('Project reply is returned in the comment thread',r.res.ok&&r.data.comments.some(c=>c.id===replyComment.data.comment?.id&&c.parent_id===rootCommentId));
    r=await json(base,`/api/projects/p_lora/comments/${rootCommentId}`,{method:'PUT',cookie:mike,body:{body:'Edited project comment for QA'}});check('Member can edit own project comment',r.res.ok);
    r=await json(base,'/api/projects/p_lora',{cookie:mike});check('Edited project comment is returned immediately',r.res.ok&&r.data.comments.some(c=>c.id===rootCommentId&&c.body==='Edited project comment for QA'));
    const deleteComment=await json(base,'/api/projects/p_lora/comments',{method:'POST',cookie:mike,body:{body:'Temporary removable comment'}});const deleteCommentId=deleteComment.data.comment?.id;
    r=await json(base,`/api/projects/p_lora/comments/${deleteCommentId}`,{method:'DELETE',cookie:mike});check('Member can delete own project comment',r.res.ok);
    r=await json(base,'/api/projects/p_lora',{cookie:mike});check('Deleted project comment disappears immediately',r.res.ok&&!r.data.comments.some(c=>c.id===deleteCommentId));
    const mentionComment=await json(base,'/api/projects/p_lora/comments',{method:'POST',cookie:lee,body:{body:'@qa-maker-2 could you look at the enclosure note?'}});check('Project comment accepts global callsign mention',mentionComment.res.status===201);
    r=await json(base,'/api/notifications',{cookie:mike});check('Global callsign mention creates notification',r.res.ok&&r.data.items.some(n=>n.kind==='mention'&&String(n.body).includes('@qa-maker-2')));

    r=await json(base,'/api/projects/p_lora',{cookie:mike});check('Build Fit is returned for visible projects',r.res.ok&&r.data.project?.fit&&typeof r.data.project.fit.score==='number');
    const clone=await json(base,'/api/projects/p_lora/clone',{method:'POST',cookie:mike,body:{title:'My LoRa Variation',adaptation:'Use the tools already on my Bench.',visibility:'Members'}});
    check('Make It Yours creates a linked personal variation',clone.res.status===201&&clone.data.project?.parentType==='Project'&&clone.data.project?.parentId==='p_lora'&&clone.data.project?.ownerId==='u_mike');
    if(clone.data.project?.id){r=await json(base,`/api/projects/${clone.data.project.id}`,{cookie:mike});check('Personalized project keeps source and starter Notebook entry',r.res.ok&&r.data.project?.parentId==='p_lora'&&r.data.logs?.some(x=>x.title==='Make It Yours'));}

    const teamCreate=await json(base,'/api/community-build-teams',{method:'POST',cookie:mike,body:{sourceType:'BUILD ALONG',sourceId:'ba1',title:'Integration Build Team',lookingFor:'electronics, documentation, testing'}});check('Member can form a Community Build team',teamCreate.res.status===201&&teamCreate.data.id);
    r=await json(base,`/api/community-build-teams/${teamCreate.data.id}/join`,{method:'POST',cookie:lee,body:{}});check('Another member can join a Community Build team',r.res.ok);
    r=await json(base,'/api/community-build-teams?sourceType=BUILD%20ALONG&sourceId=ba1',{cookie:mike});check('Community Build team exposes members and callsigns',r.res.ok&&r.data.teams.some(x=>x.id===teamCreate.data.id&&x.member_count===2&&x.members.some(m=>m.callsign==='qa-lee')));
    r=await json(base,'/api/community-builds',{cookie:mike});check('Community Build aggregate reports team count and membership',r.res.ok&&r.data.items.some(x=>x.type==='BUILD ALONG'&&x.id==='ba1'&&x.teamCount>=1&&x.myTeam===true));

    r=await json(base,'/api/profile',{method:'PUT',cookie:mike,body:{workingOn:'Testing a Phase 3 community build',workingOnDays:7}});check('Working On status can be set from My Bench',r.res.ok&&r.data.user?.workingOn==='Testing a Phase 3 community build'&&Boolean(r.data.user?.workingOnExpiresAt));
    r=await json(base,'/api/bench/u_mike',{cookie:lee});check('Active Working On status is visible on a member Bench',r.res.ok&&r.data.user?.workingOn==='Testing a Phase 3 community build');
    r=await json(base,'/api/home',{cookie:mike});check('Home returns Around the Workshop activity',r.res.ok&&Array.isArray(r.data.aroundWorkshop)&&r.data.aroundWorkshop.length>0);
    r=await json(base,'/api/community-builds',{cookie:mike});check('Community Builds return recent Maker Variations',r.res.ok&&Array.isArray(r.data.recentVariations));
    const liveList=await json(base,'/api/live',{cookie:mike});const liveForAttendance=liveList.data.items?.find(x=>x.event_type!=='After Hours');
    if(liveForAttendance){r=await json(base,`/api/live/${liveForAttendance.id}/attendance`,{method:'POST',cookie:mike,body:{status:'Going'}});check('Member can mark I’m Going on a Live event',r.res.ok&&r.data.status==='Going');r=await json(base,`/api/live/${liveForAttendance.id}`,{cookie:mike});check('Live event exposes visible attendance',r.res.ok&&r.data.myAttendance==='Going'&&r.data.attendance.some(a=>a.user_id==='u_mike'&&a.status==='Going'));}else check('Live event attendance fixture exists',false);

    for(const [name,url,key] of [
      ['Community Builds aggregate','/api/community-builds','items'],['Help aggregate','/api/help','items'],['Calendar aggregate','/api/calendar','items']]){
      r=await json(base,url,{cookie:mike});check(`${name} responds`,r.res.ok&&Array.isArray(r.data[key]));
    }
    const ics=await fetch(base+'/api/calendar.ics',{headers:{cookie:mike}});const icsText=await ics.text();check('Calendar ICS export responds',ics.ok&&icsText.includes('BEGIN:VCALENDAR'));
    r=await json(base,'/api/version-diagnostics',{cookie:mike});check('Version diagnostics aligns',r.res.ok&&r.data.serverVersion===pkg.version);
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
