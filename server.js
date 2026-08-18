'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const dns = require('node:dns').promises;
const net = require('node:net');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(process.env.WORKSHOP_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, 'data'));
const UPLOADS = path.join(DATA, 'uploads');
const DEV_AUTH = process.env.WORKSHOP_DEV_AUTH !== undefined ? process.env.WORKSHOP_DEV_AUTH !== '0' : process.env.NODE_ENV !== 'production';
const SEED_DEMO = process.env.WORKSHOP_SEED_DEMO !== undefined ? process.env.WORKSHOP_SEED_DEMO !== '0' : process.env.NODE_ENV !== 'production';
const DB_PATH = process.env.WORKSHOP_DB || path.join(DATA, 'workshop.db');
const APP_VERSION = '9.0.0';
const TERMS_VERSION = '2026-08-16';
const BACKUPS = process.env.WORKSHOP_BACKUP_DIR ? path.resolve(process.env.WORKSHOP_BACKUP_DIR) : path.join(DATA, 'backups');
const PUBLIC_URL = process.env.WORKSHOP_PUBLIC_URL || '';
const RATE_LIMIT_DISABLED = process.env.WORKSHOP_RATE_LIMIT === '0';
const EMAIL_PROVIDER = String(process.env.WORKSHOP_EMAIL_PROVIDER || 'off').toLowerCase();
const EMAIL_FROM = process.env.WORKSHOP_FROM_EMAIL || 'THE WORKSHOP <workshop@greenshoegarage.com>';
const ADMIN_EMAIL_ENV = String(process.env.WORKSHOP_ADMIN_EMAIL || '').trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const MEMBERSHIP_PROVIDER = String(process.env.WORKSHOP_MEMBERSHIP_PROVIDER || 'manual').trim().toLowerCase();
const GEARHEAD_JOIN_URL = String(process.env.WORKSHOP_GEARHEAD_JOIN_URL || '').trim();
const GEARHEAD_MANAGE_URL = String(process.env.WORKSHOP_GEARHEAD_MANAGE_URL || '').trim();
const MEMBERSHIP_SYNC_SECRET = String(process.env.WORKSHOP_MEMBERSHIP_SYNC_SECRET || '').trim();
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_PRICE_ID = String(process.env.STRIPE_GEARHEAD_PRICE_ID || '').trim();
const STRIPE_MONTHLY_PRICE_ID = String(process.env.STRIPE_GEARHEAD_MONTHLY_PRICE_ID || '').trim();
const STRIPE_ANNUAL_PRICE_ID = String(process.env.STRIPE_GEARHEAD_ANNUAL_PRICE_ID || '').trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const MAX_GEARHEAD_VIDEO_BYTES = Math.max(10_000_000, Number(process.env.WORKSHOP_MAX_VIDEO_MB || 750) * 1024 * 1024);
fs.mkdirSync(BACKUPS, { recursive: true });

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`; }
function json(value, fallback = []) {
  try { return JSON.parse(value ?? ''); } catch { return fallback; }
}
function slugify(s) {
  return String(s || 'project').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'project';
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
function currentUser(req) {
  const token = parseCookies(req).workshop_session;
  if (!token) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND (s.expires_at='' OR s.expires_at>? ) AND u.account_status='Active'`).get(token, now()) || null;
}
function membershipFor(userId) {
  if (!userId) return null;
  const r=db.prepare(`SELECT id,provider,external_id,status,label,starts_at,expires_at,created_at,updated_at FROM membership_connections WHERE user_id=? AND status='Active' AND (expires_at='' OR expires_at>?) ORDER BY updated_at DESC LIMIT 1`).get(userId,now());
  return r ? {id:r.id,provider:r.provider,externalId:r.external_id||'',status:r.status,label:r.label||'',startsAt:r.starts_at||'',expiresAt:r.expires_at||''} : null;
}
function isSupporterUser(u){ return Boolean(u && (['Supporter','Owner','Administrator','Editor'].includes(u.role) || membershipFor(u.id))); }
function gearheadSince(userId){
  const m=membershipFor(userId); if(m?.startsAt)return m.startsAt;
  const u=db.prepare('SELECT created_at,role FROM users WHERE id=?').get(userId); return u&&['Supporter','Owner','Administrator','Editor'].includes(u.role)?u.created_at:'';
}
function gearheadState(u){return {active:isSupporterUser(u),label:'The GearHead Crew',since:u?gearheadSince(u.id):''};}
function stripePlanPriceId(plan=''){const p=String(plan||'').toLowerCase();if(p==='monthly')return STRIPE_MONTHLY_PRICE_ID||STRIPE_PRICE_ID;if(p==='annual'||p==='yearly')return STRIPE_ANNUAL_PRICE_ID||(!STRIPE_MONTHLY_PRICE_ID?STRIPE_PRICE_ID:'');return STRIPE_PRICE_ID||STRIPE_MONTHLY_PRICE_ID||STRIPE_ANNUAL_PRICE_ID;}
function membershipProviderInfo(){const monthly=Boolean(STRIPE_SECRET_KEY&&stripePlanPriceId('monthly')),annual=Boolean(STRIPE_SECRET_KEY&&stripePlanPriceId('annual'));return {provider:MEMBERSHIP_PROVIDER,joinUrl:GEARHEAD_JOIN_URL,manageUrl:GEARHEAD_MANAGE_URL,syncEnabled:Boolean(MEMBERSHIP_SYNC_SECRET),providerNeutral:true,stripeConfigured:Boolean(STRIPE_SECRET_KEY&&(monthly||annual)&&STRIPE_WEBHOOK_SECRET),stripeCheckout:Boolean(monthly||annual),stripePortal:Boolean(STRIPE_SECRET_KEY),stripePlans:{monthly:{enabled:monthly,label:'Monthly',price:'$5',interval:'month'},annual:{enabled:annual,label:'Annual',price:'$50',interval:'year',savings:'Save $10/year'}}};}
async function stripeRequest(pathname, params={}){if(!STRIPE_SECRET_KEY)throw new Error('Stripe is not configured.');const body=new URLSearchParams();for(const [k,v] of Object.entries(params)){if(v===undefined||v===null||v==='')continue;body.set(k,String(v));}const r=await fetch(`https://api.stripe.com${pathname}`,{method:'POST',headers:{Authorization:`Bearer ${STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data?.error?.message||`Stripe request failed (${r.status}).`);return data;}
function verifyStripeSignature(raw,header=''){if(!STRIPE_WEBHOOK_SECRET)return false;const parts=Object.fromEntries(String(header).split(',').map(x=>x.split('=',2)).filter(x=>x.length===2));const t=parts.t,v1=parts.v1;if(!t||!v1)return false;if(Math.abs(Date.now()/1000-Number(t))>300)return false;const expected=crypto.createHmac('sha256',STRIPE_WEBHOOK_SECRET).update(`${t}.${raw.toString('utf8')}`).digest('hex');try{return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(v1,'hex'))}catch{return false}}
function upsertStripeMembership(userId,subId,status='Active',meta={}){const ts=now(),existing=db.prepare("SELECT * FROM membership_connections WHERE provider='Stripe' AND external_id=?").get(subId);if(existing)db.prepare('UPDATE membership_connections SET status=?,label=?,expires_at=?,metadata=?,updated_at=? WHERE id=?').run(status,'GearHead Crew',String(meta.expiresAt||''),JSON.stringify({...json(existing.metadata,{}),...meta}),ts,existing.id);else db.prepare('INSERT INTO membership_connections (id,user_id,provider,external_id,status,label,starts_at,expires_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id('member'),userId,'Stripe',subId,status,'GearHead Crew',ts,String(meta.expiresAt||''),JSON.stringify(meta),ts,ts);refreshSupporterRole(userId);}
function refreshSupporterRole(userId){const u=db.prepare('SELECT * FROM users WHERE id=?').get(userId);if(!u||['Owner','Administrator','Editor'].includes(u.role))return;const active=Boolean(membershipFor(userId));if(active&&u.role==='Member')db.prepare("UPDATE users SET role='Supporter' WHERE id=?").run(userId);if(!active&&u.role==='Supporter')db.prepare("UPDATE users SET role='Member' WHERE id=?").run(userId);}
function releaseDueGearhead(){const ts=now();const rows=db.prepare("SELECT id,title FROM gearhead_entries WHERE status='Published' AND access_level='GearHead' AND public_release_at<>'' AND public_release_at<=?").all(ts);for(const g of rows){db.prepare("UPDATE gearhead_entries SET access_level='Public',updated_at=? WHERE id=?").run(ts,g.id);recordGearheadEvent('','public_release','gearhead_entry',g.id,{automatic:true});}return rows.length;}
function normalizedAccess(v='Public'){const x=String(v||'Public');if(x==='Supporter'||x==='GearHead Crew Only')return 'GearHead';return x;}
function canAccessLevel(level,u,ownerId=''){const a=normalizedAccess(level);if(a==='Public'||a==='Inherit')return true;if(a==='Members')return Boolean(u);if(a==='GearHead')return isSupporterUser(u);if(a==='Private')return Boolean(u&&u.id===ownerId);return false;}
function projectCollaborator(projectId,userId){return Boolean(projectId&&userId&&db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(projectId,userId));}
function canViewProject(p,u){
  if(!p)return false;
  const access=normalizedAccess(p.visibility||'Members');
  if(access==='Public')return true;
  if(!u)return false;
  if(hasRole(u,['Owner','Administrator','Editor','Moderator']))return true;
  if(relationshipHidden(u.id,p.owner_id))return false;
  if(u.id===p.owner_id||projectCollaborator(p.id,u.id))return true;
  if(access==='Members')return true;
  if(access==='GearHead')return isSupporterUser(u);
  return false;
}
function filterVisibleProjects(rows,u){return (rows||[]).filter(r=>canViewProject(r,u));}
function canonicalVisibility(v,fallback='Members'){const a=normalizedAccess(v||fallback);return ['Public','Members','GearHead','Private','Inherit'].includes(a)?a:fallback;}
function canViewLinkedProject(projectId,u){if(!projectId)return true;return canViewProject(db.prepare('SELECT * FROM projects WHERE id=?').get(projectId),u);}
function canViewMemberContent(ownerId,u){return Boolean(u&&(u.id===ownerId||hasRole(u,['Owner','Administrator','Moderator'])));}
function relationshipHidden(viewerId,targetId){
  if(!viewerId||!targetId||viewerId===targetId)return false;
  return Boolean(db.prepare(`SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_user_id=?) OR (kind='Block' AND user_id=? AND blocked_user_id=?) LIMIT 1`).get(viewerId,targetId,targetId,viewerId));
}
function visibleAuthor(viewer,authorId){return !viewer||!relationshipHidden(viewer.id,authorId);}


function recordGearheadEvent(userId,kind,itemType='',itemId='',details={}){try{db.prepare('INSERT INTO gearhead_access_events (id,user_id,kind,item_type,item_id,details,created_at) VALUES (?,?,?,?,?,?,?)').run(id('ghe'),userId||'',kind,itemType,itemId,JSON.stringify(details||{}),now())}catch{}}
const CRAFT_LEVELS=[
  {id:'apprentice',label:'Apprentice',metal:'Bronze',description:'Establish a real Bench practice: begin making, document the work, and make your learning visible.',requirements:[
    {id:'apprentice.bench',title:'Introduce your Bench',expectation:'Write a short Bench introduction and list at least one thing you make, know, or want to learn.'},
    {id:'apprentice.project',title:'Start a real project',expectation:'Create a Project for something you intend to make, repair, investigate, or learn.'},
    {id:'apprentice.log',title:'Keep a build record',expectation:'Add at least one Build Log entry that records work, a decision, test, discovery, question, or result.'},
    {id:'apprentice.learning',title:'Name the learning edge',expectation:'Record at least one skill, process, or practice you genuinely want to learn next.'}
  ]},
  {id:'journeyman',label:'Journeyman',metal:'Silver',description:'Move beyond starting: finish work, preserve evidence from testing and failure, and participate beyond your own Bench.',requirements:[
    {id:'journeyman.result',title:'Bring a project to a result',expectation:'Carry at least one Project through to a documented result or deliberate conclusion.'},
    {id:'journeyman.test',title:'Test something',expectation:'Document a meaningful Test or Experiment and what the evidence told you.'},
    {id:'journeyman.failure',title:'Preserve a failure or revision',expectation:'Record something that did not work, or a revision made because the first approach needed to change.'},
    {id:'journeyman.help',title:'Help another maker',expectation:'Offer useful knowledge through an answer, discussion, critique, skill exchange, collaboration, or equivalent help.'},
    {id:'journeyman.community',title:'Work beyond your own Bench',expectation:'Participate in a Maker Crew, Session, Build Along, Open Brief, collaborative project, or another shared Workshop activity.'}
  ]},
  {id:'master',label:'Master',metal:'Gold',description:'Demonstrate sustained practice and stewardship: make deeply, teach from experience, contribute back, and reflect on the craft.',requirements:[
    {id:'master.practice',title:'Demonstrate sustained practice',expectation:'Complete several substantial Projects over time with enough documentation that another maker can understand the work and decisions.'},
    {id:'master.teach',title:'Teach from experience',expectation:'Create a substantial tutorial, explanation, Build Along, demonstration, or body of notes that helps someone else learn a real process.'},
    {id:'master.steward',title:'Contribute back to the community',expectation:'Make a meaningful contribution to another maker, a Maker Crew, shared project, Workshop program, or body of community knowledge.'},
    {id:'master.shared',title:'Support a shared effort',expectation:'Lead, organize, mentor, collaborate on, or materially support work that is larger than your own individual Project.'},
    {id:'master.depth',title:'Show revision at depth',expectation:'Document how testing, failure, critique, or new evidence changed your approach—not just the successful final result.'},
    {id:'master.reflect',title:'Reflect on your practice',expectation:'Write down how your making practice has changed, what responsibilities come with your experience, and what you still need to learn.'}
  ]}
];
const CRAFT_REQUIREMENTS=new Map(CRAFT_LEVELS.flatMap(level=>level.requirements.map(r=>[r.id,{...r,level:level.id}])));
function craftProgressFor(userId,includeEvidence=false){
  let rows=[];try{rows=db.prepare('SELECT requirement_id,checked,evidence_note,updated_at FROM craft_progress WHERE user_id=?').all(userId)}catch{}
  const byId=new Map(rows.map(r=>[r.requirement_id,r]));
  let priorComplete=true,highest='';
  const levels=CRAFT_LEVELS.map(level=>{
    const requirements=level.requirements.map(req=>{const row=byId.get(req.id);return {...req,checked:Boolean(row?.checked),evidenceNote:includeEvidence?String(row?.evidence_note||''):'',updatedAt:includeEvidence?String(row?.updated_at||''):''}});
    const completed=requirements.length>0&&requirements.every(r=>r.checked),earned=priorComplete&&completed;
    if(earned)highest=level.id;
    priorComplete=priorComplete&&completed;
    return {id:level.id,label:level.label,metal:level.metal,description:level.description,completed,earned,done:requirements.filter(r=>r.checked).length,total:requirements.length,requirements};
  });
  const rank=CRAFT_LEVELS.find(x=>x.id===highest)||null;
  return {currentLevel:rank?.id||'',currentLabel:rank?.label||'In Progress',metal:rank?.metal||'Neutral',levels};
}
function safeUser(u) {
  if (!u) return null;
  const craft=craftProgressFor(u.id,false);
  return { id: u.id, email: u.email, displayName: u.display_name, bio: u.bio, cityRegion: u.city_region, role: u.role, avatarSeed: u.avatar_seed, skills:json(u.skills), tools:json(u.tools), canHelp:json(u.can_help), wantLearn:json(u.want_learn), profileVisibility:u.profile_visibility||'Members', locationVisibility:u.location_visibility||'Members', toolCabinetVisibility:u.tool_cabinet_visibility||'Members', emailVerified:Boolean(u.email_verified), forcePasswordReset:Boolean(u.force_password_reset), age18ConfirmedAt:u.age_18_confirmed_at||'', termsVersionAccepted:u.terms_version_accepted||'', termsAcceptedAt:u.terms_accepted_at||'', termsCurrentAccepted:(u.terms_version_accepted||'')===TERMS_VERSION, anonymizedAt:u.anonymized_at||'', membership:membershipFor(u.id), supporter:isSupporterUser(u), gearhead:gearheadState(u), craftPath:{currentLevel:craft.currentLevel,currentLabel:craft.currentLabel,metal:craft.metal} };
}
function encodeResponse(res, body, type, cacheControl='no-store', headers={}) {
  const raw=Buffer.isBuffer(body)?body:Buffer.from(String(body));
  const base={'Content-Type':type,'Cache-Control':cacheControl,'Vary':'Accept-Encoding',...headers};
  const accepted=String(res._acceptEncoding||'');
  if(raw.length>=1024 && /\bbr\b/.test(accepted)){
    const encoded=zlib.brotliCompressSync(raw,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:4}});
    res.writeHead(res._statusCode||200,{...base,'Content-Encoding':'br','Content-Length':encoded.length});res.end(encoded);return;
  }
  if(raw.length>=1024 && /\bgzip\b/.test(accepted)){
    const encoded=zlib.gzipSync(raw,{level:6});
    res.writeHead(res._statusCode||200,{...base,'Content-Encoding':'gzip','Content-Length':encoded.length});res.end(encoded);return;
  }
  res.writeHead(res._statusCode||200,{...base,'Content-Length':raw.length});res.end(raw);
}
function sendJson(res, code, payload, headers = {}) {
  res._statusCode=code;
  const body=JSON.stringify(payload);
  if(res._idempotency && code>=200 && code<400){
    try{db.prepare(`INSERT OR REPLACE INTO idempotency_responses(key,method,pathname,status_code,body,created_at) VALUES(?,?,?,?,?,?)`).run(res._idempotency.key,res._idempotency.method,res._idempotency.pathname,code,body,now());}catch{}
  }
  encodeResponse(res,body,'application/json; charset=utf-8','no-store',headers);
}
function sendText(res, code, body, type='text/plain; charset=utf-8') {
  res._statusCode=code; encodeResponse(res,body,type,'no-store');
}
async function readBody(req, max = 2_000_000) {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > max) reject(new Error('Request too large')); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function readRawBody(req, max = 30_000_000) {
  return await new Promise((resolve,reject)=>{ const chunks=[]; let size=0; req.on('data',c=>{size+=c.length;if(size>max){reject(new Error('File too large'));req.destroy();return;}chunks.push(c)}); req.on('end',()=>resolve(Buffer.concat(chunks))); req.on('error',reject); });
}
function passwordHash(password, salt=crypto.randomBytes(16).toString('hex')) { const hash=crypto.scryptSync(String(password),salt,64).toString('hex'); return `${salt}:${hash}`; }
function passwordOk(password, stored='') { try { const [salt,hex]=String(stored).split(':'); if(!salt||!hex)return false; return crypto.timingSafeEqual(Buffer.from(hex,'hex'),crypto.scryptSync(String(password),salt,64)); } catch { return false; } }
function newSession(res,user){ const token=crypto.randomBytes(32).toString('hex'),ts=now(),expires=new Date(Date.now()+30*86400000).toISOString(); db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(token,user.id,ts,expires); return {'Set-Cookie':`workshop_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`}; }
function issueAuthToken(userId,kind,minutes=30){ const token=crypto.randomBytes(32).toString('hex'),ts=now(),expires=new Date(Date.now()+minutes*60000).toISOString(); db.prepare('INSERT INTO auth_tokens (token,user_id,kind,expires_at,created_at) VALUES (?,?,?,?,?)').run(token,userId,kind,expires,ts); return token; }
function consumeAuthToken(token,kind){ const r=db.prepare('SELECT * FROM auth_tokens WHERE token=? AND kind=?').get(token,kind); if(!r||new Date(r.expires_at)<new Date())return null; db.prepare('DELETE FROM auth_tokens WHERE token=?').run(token); return r; }
function safeFilename(name='file'){ return String(name).replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,180)||'file'; }

function hasRole(u, roles){ return Boolean(u && roles.includes(u.role)); }
function requireRole(req,res,roles){ const u=requireUser(req,res); if(!u)return null; if(!hasRole(u,roles)){sendJson(res,403,{error:'You do not have permission to operate this part of the workshop.'});return null;} return u; }
function requestIp(req){ return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim(); }
function audit(actorId,action,targetType='',targetId='',details={}){ try{db.prepare('INSERT INTO audit_logs (id,actor_id,action,target_type,target_id,details,created_at) VALUES (?,?,?,?,?,?,?)').run(id('audit'),actorId||'',action,targetType,targetId,JSON.stringify(details||{}),now());}catch{} }
const gearheadDownloadWindows=new Map();
function allowGearheadDownload(req,userId=''){if(RATE_LIMIT_DISABLED)return true;const key=`${userId||'anon'}:${requestIp(req)}`,t=Date.now(),windowMs=60_000,max=60;let r=gearheadDownloadWindows.get(key);if(!r||t-r.start>=windowMs)r={start:t,count:0};r.count++;gearheadDownloadWindows.set(key,r);return r.count<=max;}
function gearheadPrivateHeaders(){return {'Cache-Control':'private, no-store','Pragma':'no-cache','Vary':'Cookie, Accept-Encoding'};}
const rateBuckets=new Map();
function rateAllowed(key,limit,windowMs){ if(RATE_LIMIT_DISABLED)return true; const t=Date.now(); let b=rateBuckets.get(key); if(!b||b.reset<=t){b={count:0,reset:t+windowMs};rateBuckets.set(key,b);} b.count++; return b.count<=limit; }
function originAllowed(req){ if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return true; const origin=req.headers.origin; if(!origin)return true; try{const expected=PUBLIC_URL?new URL(PUBLIC_URL).origin:`http://${req.headers.host}`;return new URL(origin).origin===expected;}catch{return false;} }
function securityHeaders(res,requestId){ res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob: https:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");res.setHeader('X-Request-Id',requestId); }
function createBackup(actorId=''){ const stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(BACKUPS,stamp);fs.mkdirSync(dir,{recursive:true});const out=path.join(dir,'workshop.sqlite');const escaped=out.replaceAll("'","''");db.exec(`VACUUM INTO '${escaped}'`);if(fs.existsSync(UPLOADS))fs.cpSync(UPLOADS,path.join(dir,'uploads'),{recursive:true});fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({createdAt:now(),version:APP_VERSION,database:path.basename(out),uploads:'uploads'},null,2));audit(actorId,'backup.create','system',stamp,{path:dir});return {id:stamp,path:dir}; }

function requireUser(req, res) {
  const u = currentUser(req);
  if (!u) { sendJson(res, 401, { error: 'Sign in to use this part of the workshop.' }); return null; }
  return u;
}
function parseList(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function ensureColumn(table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
function projectRow(r) {
  if (!r) return null;
  return {
    id:r.id, ownerId:r.owner_id, owner:r.owner_name, title:r.title, slug:r.slug, description:r.description,
    stage:r.stage, status:r.status, disciplines:json(r.disciplines), tags:json(r.tags), coverEmoji:r.cover_emoji,
    visibility:r.visibility, license:r.license, estimatedCost:r.estimated_cost, difficulty:r.difficulty, tools:json(r.tools),
    materials:json(r.materials), website:r.website || '', githubRepo:r.github_repo || '', coverUrl:r.cover_url || '', projectType:r.project_type || 'Project',
    parentType:r.parent_type, parentId:r.parent_id, crewId:r.crew_id||'', crewCode:r.crew_code||'', crewName:r.crew_name||'', createdAt:r.created_at, updatedAt:r.updated_at,
    saved:Boolean(r.saved), logCount:Number(r.log_count || 0), commentCount:Number(r.comment_count || 0)
  };
}


function normalizeGitHubRepo(value='') {
  const raw=String(value||'').trim(); if(!raw)return null;
  let owner='',repo='';
  try { const u=new URL(raw.includes('://')?raw:`https://github.com/${raw}`); if(u.hostname!=='github.com'&&u.hostname!=='www.github.com')return null; [owner,repo]=u.pathname.split('/').filter(Boolean).slice(0,2); }
  catch { return null; }
  repo=String(repo||'').replace(/\.git$/,'');
  if(!/^[A-Za-z0-9_.-]+$/.test(owner)||!/^[A-Za-z0-9_.-]+$/.test(repo))return null;
  return {owner,repo,key:`${owner}/${repo}`,url:`https://github.com/${owner}/${repo}`};
}
async function githubJson(endpoint) {
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':`the-workshop/${APP_VERSION}`};
  if(process.env.GITHUB_TOKEN) headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
  const r=await fetch(`https://api.github.com${endpoint}`,{headers,redirect:'error'});
  if(r.status===404)return null;
  if(!r.ok){const remaining=r.headers.get('x-ratelimit-remaining');throw new Error(r.status===403&&remaining==='0'?'GitHub API rate limit reached. Configure GITHUB_TOKEN or try after the cache expires.':`GitHub returned HTTP ${r.status}.`);}
  return r.json();
}
async function fetchGitHubProject(repoInfo) {
  const base=`/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}`;
  const repo=await githubJson(base); if(!repo)throw new Error('GitHub repository not found or not accessible to this server.');
  let readme=null,releases=[],issues=[];
  try { readme=await githubJson(`${base}/readme`); } catch {}
  try { releases=(await githubJson(`${base}/releases?per_page=5`))||[]; } catch {}
  try { issues=((await githubJson(`${base}/issues?state=open&per_page=10`))||[]).filter(x=>!x.pull_request).slice(0,5); } catch {}
  let readmeText=''; if(readme?.content){try{readmeText=Buffer.from(String(readme.content).replace(/\n/g,''),'base64').toString('utf8').slice(0,12000)}catch{}}
  return {repo:{fullName:repo.full_name,htmlUrl:repo.html_url,description:repo.description||'',defaultBranch:repo.default_branch||'',language:repo.language||'',license:repo.license?.spdx_id||repo.license?.name||'',visibility:repo.visibility|| (repo.private?'private':'public'),updatedAt:repo.updated_at||'',openIssues:Number(repo.open_issues_count||0),archived:Boolean(repo.archived)},readme:readmeText,releases:releases.map(x=>({id:x.id,tag:x.tag_name,name:x.name||x.tag_name,url:x.html_url,publishedAt:x.published_at||'',draft:Boolean(x.draft),prerelease:Boolean(x.prerelease)})),issues:issues.map(x=>({number:x.number,title:x.title,url:x.html_url,createdAt:x.created_at||'',updatedAt:x.updated_at||'',labels:(x.labels||[]).map(l=>typeof l==='string'?l:l.name).filter(Boolean)}))};
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, bio TEXT DEFAULT '', city_region TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'Member', avatar_seed TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS craft_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, requirement_id TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, evidence_note TEXT DEFAULT '', updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,requirement_id)
    );
    CREATE TABLE IF NOT EXISTS bench_embeds (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, slug TEXT NOT NULL,
      description TEXT DEFAULT '', stage TEXT DEFAULT 'Idea', status TEXT DEFAULT 'Active', disciplines TEXT DEFAULT '[]', tags TEXT DEFAULT '[]',
      cover_emoji TEXT DEFAULT '🛠️', visibility TEXT DEFAULT 'Members', license TEXT DEFAULT 'Unspecified', estimated_cost TEXT DEFAULT '',
      difficulty TEXT DEFAULT 'Approachable', tools TEXT DEFAULT '[]', parent_type TEXT, parent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_collaborators (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'Other', PRIMARY KEY(project_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS build_log_entries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL, title TEXT DEFAULT '', body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, trying TEXT NOT NULL, tried TEXT DEFAULT '', happened TEXT DEFAULT '',
      help_needed TEXT DEFAULT '', status TEXT DEFAULT 'Open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL, mark TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop_notes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, project_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS build_alongs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, overview TEXT NOT NULL, difficulty TEXT, expected_time TEXT, approximate_cost TEXT,
      skills TEXT DEFAULT '[]', tools TEXT DEFAULT '[]', materials TEXT DEFAULT '[]', instructions TEXT DEFAULT '', safety_notes TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS open_briefs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, objective TEXT NOT NULL, constraints TEXT DEFAULT '[]', optional_constraints TEXT DEFAULT '[]',
      recommended_skills TEXT DEFAULT '[]', time_window TEXT DEFAULT '', safety_notes TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, section TEXT NOT NULL, summary TEXT NOT NULL, tags TEXT DEFAULT '[]', url TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discussion_topics (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), area TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, status TEXT DEFAULT 'Open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discussion_replies (
      id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES discussion_topics(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
      parent_id TEXT REFERENCES discussion_replies(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_reports (
      id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), item_type TEXT NOT NULL, item_id TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT DEFAULT 'Open', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(user_id,item_type,item_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, body TEXT NOT NULL, href TEXT DEFAULT '', read INTEGER DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, question INTEGER DEFAULT 1, discussion INTEGER DEFAULT 1, mention INTEGER DEFAULT 1, project INTEGER DEFAULT 1, collaboration INTEGER DEFAULT 1, event INTEGER DEFAULT 1, moderation INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS email_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled INTEGER DEFAULT 1, crew_attendance INTEGER DEFAULT 1, account_security INTEGER DEFAULT 1, moderation INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, provider_id TEXT DEFAULT '', error TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_items (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(collection_id,item_type,item_id)
    );
    CREATE TABLE IF NOT EXISTS critiques (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
      design_state TEXT NOT NULL DEFAULT 'Concept', feedback_types TEXT DEFAULT '[]', prompt TEXT NOT NULL, status TEXT DEFAULT 'Open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS critique_responses (
      id TEXT PRIMARY KEY, critique_id TEXT NOT NULL REFERENCES critiques(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
      works TEXT DEFAULT '', question TEXT DEFAULT '', try_next TEXT DEFAULT '', questions TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS live_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'Shop Stream', description TEXT DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT DEFAULT '',
      status TEXT DEFAULT 'Scheduled', stream_url TEXT DEFAULT '', archive_url TEXT DEFAULT '', project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS live_comments (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES live_events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_clinic_submissions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      problem TEXT NOT NULL, evidence TEXT DEFAULT '', tried TEXT DEFAULT '', question TEXT NOT NULL, status TEXT DEFAULT 'Submitted',
      event_id TEXT REFERENCES live_events(id) ON DELETE SET NULL, recommendations TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_contact_requests (
      id TEXT PRIMARY KEY, from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT NOT NULL, offer TEXT DEFAULT '', request TEXT DEFAULT '', message TEXT DEFAULT '', status TEXT DEFAULT 'Pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_cabinet_items (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, relationship TEXT NOT NULL DEFAULT 'Have',
      category TEXT DEFAULT '', manufacturer TEXT DEFAULT '', model TEXT NOT NULL, familiarity TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_collaboration_invites (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, from_user_id TEXT NOT NULL REFERENCES users(id), to_user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'Other', message TEXT DEFAULT '', status TEXT DEFAULT 'Pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'To Do',
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_by TEXT NOT NULL REFERENCES users(id), notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS field_instruments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, version TEXT DEFAULT '0.1.0', status TEXT DEFAULT 'Prototype',
      screenshot_url TEXT DEFAULT '', launch_url TEXT DEFAULT '', docs_url TEXT DEFAULT '', changelog TEXT DEFAULT '', known_issues TEXT DEFAULT '',
      visibility TEXT DEFAULT 'Public', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instrument_feedback (
      id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES field_instruments(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'Discuss', body TEXT NOT NULL, status TEXT DEFAULT 'Open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wall_exhibitions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', status TEXT DEFAULT 'Published', visibility TEXT DEFAULT 'Public',
      curator_id TEXT NOT NULL REFERENCES users(id), starts_at TEXT DEFAULT '', ends_at TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wall_items (
      exhibition_id TEXT NOT NULL REFERENCES wall_exhibitions(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      caption TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY(exhibition_id,project_id)
    );
    CREATE TABLE IF NOT EXISTS weekly_questions (
      id TEXT PRIMARY KEY, prompt TEXT NOT NULL, image_url TEXT DEFAULT '', status TEXT DEFAULT 'Published', visibility TEXT DEFAULT 'Public',
      starts_at TEXT DEFAULT '', ends_at TEXT DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weekly_question_responses (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES weekly_questions(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL, image_url TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mystery_items (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT DEFAULT 'mystery object',
      photo_urls TEXT DEFAULT '[]', dimensions TEXT DEFAULT '', markings TEXT DEFAULT '', approximate_age TEXT DEFAULT '', source_context TEXT DEFAULT '', notes TEXT DEFAULT '',
      status TEXT DEFAULT 'Open', identified_as TEXT DEFAULT '', best_proposal_id TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mystery_proposals (
      id TEXT PRIMARY KEY, mystery_id TEXT NOT NULL REFERENCES mystery_items(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identification TEXT NOT NULL, explanation TEXT NOT NULL, references_text TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teardown_clubs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, object_name TEXT DEFAULT '', overview TEXT DEFAULT '', status TEXT DEFAULT 'Active', visibility TEXT DEFAULT 'Public',
      safety_notes TEXT DEFAULT '', reference_url TEXT DEFAULT '', project_id TEXT DEFAULT '', starts_at TEXT DEFAULT '', ends_at TEXT DEFAULT '', curator_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teardown_contributions (
      id TEXT PRIMARY KEY, teardown_id TEXT NOT NULL REFERENCES teardown_clubs(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT DEFAULT 'Observation', title TEXT NOT NULL, body TEXT NOT NULL, photo_urls TEXT DEFAULT '[]', component TEXT DEFAULT '', material TEXT DEFAULT '',
      circuit_notes TEXT DEFAULT '', mechanism_notes TEXT DEFAULT '', repairability TEXT DEFAULT '', reusable_parts TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scrap_listings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT DEFAULT 'Other', description TEXT DEFAULT '',
      exchange_type TEXT DEFAULT 'Free', city_region TEXT DEFAULT '', condition_text TEXT DEFAULT '', quantity_text TEXT DEFAULT '', image_url TEXT DEFAULT '', status TEXT DEFAULT 'Available',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scrap_inquiries (
      id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES scrap_listings(id) ON DELETE CASCADE, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL, status TEXT DEFAULT 'Open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, uploader_id TEXT NOT NULL REFERENCES users(id),
      logical_name TEXT NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT DEFAULT 'application/octet-stream', size_bytes INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1, notes TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_releases (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id),
      version TEXT NOT NULL, title TEXT NOT NULL, notes TEXT DEFAULT '', status TEXT DEFAULT 'Released', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_release_files (
      release_id TEXT NOT NULL REFERENCES project_releases(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL, PRIMARY KEY(release_id,file_id)
    );
    CREATE TABLE IF NOT EXISTS github_cache (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, repo_key TEXT NOT NULL, payload TEXT NOT NULL, fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS membership_connections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL DEFAULT 'Direct', external_id TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active', label TEXT DEFAULT '', starts_at TEXT DEFAULT '', expires_at TEXT DEFAULT '', metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS membership_invite_codes (
      code TEXT PRIMARY KEY, label TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Active', max_uses INTEGER DEFAULT 1, uses INTEGER DEFAULT 0,
      expires_at TEXT DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    );


    CREATE TABLE IF NOT EXISTS gearhead_entries (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, deck TEXT DEFAULT '', entry_type TEXT NOT NULL DEFAULT 'Field Note', body TEXT DEFAULT '', hero_url TEXT DEFAULT '', media_url TEXT DEFAULT '',
      related_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, related_instrument_id TEXT REFERENCES field_instruments(id) ON DELETE SET NULL, tags TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'Draft', access_level TEXT NOT NULL DEFAULT 'GearHead', publish_at TEXT DEFAULT '', public_release_at TEXT DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_tutorial_steps (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES gearhead_entries(id) ON DELETE CASCADE, sort_order INTEGER DEFAULT 0, title TEXT NOT NULL, body TEXT DEFAULT '', image_url TEXT DEFAULT '', safety_note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_files (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES gearhead_entries(id) ON DELETE CASCADE, uploader_id TEXT NOT NULL REFERENCES users(id), logical_name TEXT NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT DEFAULT 'application/octet-stream', size_bytes INTEGER DEFAULT 0, version INTEGER DEFAULT 1, sha256 TEXT DEFAULT '', notes TEXT DEFAULT '', license TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_media (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES gearhead_entries(id) ON DELETE CASCADE, sort_order INTEGER DEFAULT 0, media_type TEXT NOT NULL DEFAULT 'Image', external_url TEXT DEFAULT '', stored_name TEXT DEFAULT '', mime_type TEXT DEFAULT '', caption TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_access_events (
      id TEXT PRIMARY KEY, user_id TEXT DEFAULT '', kind TEXT NOT NULL, item_type TEXT DEFAULT '', item_id TEXT DEFAULT '', details TEXT DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_early_feedback (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES gearhead_entries(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, feedback_type TEXT NOT NULL DEFAULT 'Other', body TEXT DEFAULT '', platform TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'New', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_type TEXT NOT NULL DEFAULT 'Tutorial request', title TEXT NOT NULL, details TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Considering', response_note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_after_hours_rsvps (
      event_id TEXT NOT NULL REFERENCES live_events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'Going', reminder_requested INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS gearhead_contributions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, entry_id TEXT REFERENCES gearhead_entries(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, contribution_type TEXT NOT NULL DEFAULT 'Testing note', title TEXT NOT NULL, body TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Submitted', editor_note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_crew_projects (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active', starts_at TEXT DEFAULT '', ends_at TEXT DEFAULT '',
      reference_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gearhead_crew_project_responses (
      crew_project_id TEXT NOT NULL REFERENCES gearhead_crew_projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(crew_project_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gearhead_contributions_status ON gearhead_contributions(status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gearhead_crew_projects_status ON gearhead_crew_projects(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS membership_provider_events (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'external', external_id TEXT DEFAULT '', event_type TEXT NOT NULL, user_id TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Applied', payload TEXT DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_membership_provider_events ON membership_provider_events(provider,external_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS gearhead_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', entry_type TEXT NOT NULL DEFAULT 'Field Note', snapshot TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gearhead_templates_type ON gearhead_templates(entry_type,name);
    CREATE INDEX IF NOT EXISTS idx_gearhead_feedback_entry ON gearhead_early_feedback(entry_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gearhead_requests_status ON gearhead_requests(status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gearhead_entries_publish ON gearhead_entries(status,publish_at,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gearhead_steps_entry ON gearhead_tutorial_steps(entry_id,sort_order);
    CREATE INDEX IF NOT EXISTS idx_gearhead_files_entry ON gearhead_files(entry_id,logical_name,version DESC);
    CREATE INDEX IF NOT EXISTS idx_gearhead_media_entry ON gearhead_media(entry_id,sort_order,id);

    CREATE TABLE IF NOT EXISTS workshop_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, theme TEXT DEFAULT '', description TEXT DEFAULT '', cover_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft', visibility TEXT NOT NULL DEFAULT 'Public', host_id TEXT NOT NULL REFERENCES users(id),
      starts_at TEXT DEFAULT '', ends_at TEXT DEFAULT '', wall_exhibition_id TEXT REFERENCES wall_exhibitions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_assignments (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES workshop_sessions(id) ON DELETE CASCADE, title TEXT NOT NULL,
      purpose TEXT DEFAULT '', brief TEXT NOT NULL, constraints TEXT DEFAULT '[]', optional_constraints TEXT DEFAULT '[]',
      suggested_tools TEXT DEFAULT '[]', suggested_materials TEXT DEFAULT '[]', references_json TEXT DEFAULT '[]', safety_notes TEXT DEFAULT '',
      estimated_time TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, release_at TEXT DEFAULT '', due_at TEXT DEFAULT '', status TEXT DEFAULT 'Published',
      live_event_id TEXT REFERENCES live_events(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_resources (
      session_id TEXT NOT NULL REFERENCES workshop_sessions(id) ON DELETE CASCADE, library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY(session_id,library_item_id)
    );
    CREATE TABLE IF NOT EXISTS assignment_projects (
      assignment_id TEXT NOT NULL REFERENCES session_assignments(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, started_at TEXT NOT NULL, PRIMARY KEY(assignment_id,project_id)
    );
    CREATE TABLE IF NOT EXISTS work_submissions (
      id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES session_assignments(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      confirmation_code TEXT UNIQUE NOT NULL, image_url TEXT DEFAULT '', did_text TEXT NOT NULL, happened_text TEXT DEFAULT '', learned_text TEXT NOT NULL,
      change_next TEXT DEFAULT '', build_log_id TEXT REFERENCES build_log_entries(id) ON DELETE SET NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS peer_reflections (
      id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES session_assignments(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recognition TEXT NOT NULL, body TEXT DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE(assignment_id,project_id,reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workshop_sessions_status ON workshop_sessions(status,starts_at);
    CREATE INDEX IF NOT EXISTS idx_session_assignments_session ON session_assignments(session_id,sort_order);
    CREATE INDEX IF NOT EXISTS idx_assignment_projects_user ON assignment_projects(user_id,started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_submissions_user ON work_submissions(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_peer_reflections_project ON peer_reflections(project_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS maker_crews (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, anchor_postal_code TEXT NOT NULL,
      city_region TEXT DEFAULT '', country TEXT DEFAULT 'US', description TEXT DEFAULT '', cover_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active', visibility TEXT NOT NULL DEFAULT 'Public', created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maker_crew_postal_codes (
      crew_id TEXT NOT NULL REFERENCES maker_crews(id) ON DELETE CASCADE, postal_code TEXT NOT NULL, latitude REAL, longitude REAL,
      is_anchor INTEGER DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY(crew_id,postal_code)
    );
    CREATE TABLE IF NOT EXISTS maker_crew_members (
      crew_id TEXT NOT NULL REFERENCES maker_crews(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'Member', status TEXT NOT NULL DEFAULT 'Active', affiliation_visibility TEXT NOT NULL DEFAULT 'Members',
      is_primary INTEGER DEFAULT 0, joined_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(crew_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS maker_crew_requests (
      id TEXT PRIMARY KEY, requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, proposed_postal_code TEXT NOT NULL,
      proposed_name TEXT NOT NULL, city_region TEXT DEFAULT '', country TEXT DEFAULT 'US', nearby_postal_codes TEXT DEFAULT '[]',
      rationale TEXT NOT NULL, proposed_organizers TEXT DEFAULT '', existing_group_url TEXT DEFAULT '', estimated_participants INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Submitted', reviewer_notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maker_crew_events (
      id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES maker_crews(id) ON DELETE CASCADE, title TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'Open Bench', description TEXT DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT DEFAULT '',
      venue_name TEXT DEFAULT '', city_region TEXT DEFAULT '', exact_address TEXT DEFAULT '', address_visibility TEXT NOT NULL DEFAULT 'Attendees',
      capacity INTEGER DEFAULT 0, approval_required INTEGER DEFAULT 0, what_to_bring TEXT DEFAULT '', safety_notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Scheduled', visibility TEXT NOT NULL DEFAULT 'Members', related_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      related_session_id TEXT REFERENCES workshop_sessions(id) ON DELETE SET NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maker_crew_event_attendance (
      event_id TEXT NOT NULL REFERENCES maker_crew_events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Interested', approved INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(event_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS maker_crew_announcements (
      id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES maker_crews(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, body TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'Members', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maker_crew_bulletin_posts (
      id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES maker_crews(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_type TEXT NOT NULL DEFAULT 'Question', title TEXT NOT NULL, body TEXT NOT NULL, expires_at TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maker_crew_handbook_entries (
      id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES maker_crews(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL DEFAULT 'Local Knowledge',
      title TEXT NOT NULL, body TEXT NOT NULL, url TEXT DEFAULT '', visibility TEXT NOT NULL DEFAULT 'Members',
      status TEXT NOT NULL DEFAULT 'Published', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personal_notebook_entries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL DEFAULT 'Idea', title TEXT NOT NULL, body TEXT DEFAULT '', tags TEXT DEFAULT '[]',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'Active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS failure_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, crew_id TEXT DEFAULT '', title TEXT NOT NULL,
      failure_type TEXT NOT NULL DEFAULT 'Other', observed TEXT NOT NULL, expected TEXT DEFAULT '', cause TEXT DEFAULT '', evidence TEXT DEFAULT '',
      fix TEXT DEFAULT '', lesson TEXT DEFAULT '', visibility TEXT NOT NULL DEFAULT 'Members', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workshop_prompts (
      id TEXT PRIMARY KEY, created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, brief TEXT NOT NULL, constraints TEXT DEFAULT '[]', optional_constraints TEXT DEFAULT '[]',
      inspiration TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Open', starts_at TEXT DEFAULT '', ends_at TEXT DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'Public', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workshop_prompt_projects (
      prompt_id TEXT NOT NULL REFERENCES workshop_prompts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, PRIMARY KEY(prompt_id,project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_crew_handbook ON maker_crew_handbook_entries(crew_id,status,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notebook_user ON personal_notebook_entries(user_id,status,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_failure_visibility ON failure_records(visibility,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prompt_status ON workshop_prompts(status,starts_at,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crew_postal ON maker_crew_postal_codes(postal_code);
    CREATE INDEX IF NOT EXISTS idx_crew_members_user ON maker_crew_members(user_id,status,is_primary);
    CREATE INDEX IF NOT EXISTS idx_crew_events_start ON maker_crew_events(crew_id,status,starts_at);
    CREATE INDEX IF NOT EXISTS idx_crew_bulletin ON maker_crew_bulletin_posts(crew_id,status,created_at DESC);
    CREATE TABLE IF NOT EXISTS auth_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS moderation_actions (id TEXT PRIMARY KEY, report_id TEXT, moderator_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, action TEXT NOT NULL, notes TEXT DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT DEFAULT '', action TEXT NOT NULL, target_type TEXT DEFAULT '', target_id TEXT DEFAULT '', details TEXT DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_project ON build_log_entries(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_questions_updated ON questions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discussions_updated ON discussion_topics(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discussion_replies_topic ON discussion_replies(topic_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_critiques_project ON critiques(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_critique_responses ON critique_responses(critique_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_live_events_start ON live_events(starts_at ASC);
    CREATE INDEX IF NOT EXISTS idx_live_comments_event ON live_comments(event_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_teardown_contrib ON teardown_contributions(teardown_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_scrap_status ON scrap_listings(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scrap_inquiries ON scrap_inquiries(listing_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_clinic_status ON project_clinic_submissions(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clinic_user ON project_clinic_submissions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_skill_requests_to ON skill_contact_requests(to_user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_membership_user ON membership_connections(user_id,status,updated_at DESC);
  `);
}

function seedDemo() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count) return;
  const ts = now();
  const users = [
    ['u_mike','mike@workshop.local','Mike','Maker, engineer, and keeper of the garage.','Western Maryland','Owner','MP'],
    ['u_morgan','morgan@workshop.local','Morgan Vale','Bookbinder, printmaker, collector of obsolete mechanisms.','Baltimore, MD','Member','MV'],
    ['u_lee','lee@workshop.local','Lee Chen','Electronics tinkerer who keeps repairing things that were never designed to be repaired.','Pittsburgh, PA','Member','LC'],
    ['u_rin','rin@workshop.local','Rin Alvarez','Mechanical designer, machinist, and serial prototype breaker.','Richmond, VA','Member','RA'],
    ['u_ada','ada@workshop.local','Ada Brooks','Artist working with light, cameras, and small machines.','Philadelphia, PA','Supporter','AB']
  ];
  const iu = db.prepare('INSERT INTO users (id,email,display_name,bio,city_region,role,avatar_seed,created_at) VALUES (?,?,?,?,?,?,?,?)');
  for (const u of users) iu.run(...u, ts);

  const projects = [
    ['p_flip','u_mike','Mechanical Flip Clock','A quiet desk clock built from printed carriers, brass pivots, and an aggressively simple escapement.','Testing','Active',['mechanical','fabrication'],['clock','mechanism','3d-printing'],'◫','Public','CERN Open Hardware','$85','Intermediate',['3D printer','hand tools'],null,null],
    ['p_lora','u_lee','LoRa Environmental Sensor','Weatherproof solar node for slow environmental sensing with an intentionally repairable enclosure.','Prototyping','Active',['electronics','embedded systems'],['lora','sensor','solar'],'⌁','Public','MIT','$45','Intermediate',['soldering equipment','multimeter'],null,null],
    ['p_notebook','u_morgan','Hand-Bound Field Notebook','A pocket field notebook with replaceable signatures and a cloth hinge that can survive shop use.','Complete','Complete',['bookbinding','printmaking'],['paper','binding','field-notes'],'▤','Public','CC BY-SA','$18','Approachable',['hand tools'],null,null],
    ['p_scope','u_rin','Restoring a 1970s Oscilloscope','Bringing a tired analog scope back without erasing its history or replacing everything that looks old.','Revising','Active',['electronics','repair'],['oscilloscope','repair','vintage'],'⌇','Public','CC BY-NC','$60','Advanced',['oscilloscope','soldering equipment'],null,null],
    ['p_plotter','u_ada','Mechanical Plotter','A slow two-axis drawing machine driven by discarded printer mechanisms.','Building','Active',['mechanical','electronics','art'],['plotter','reuse','drawing'],'✣','Public','CC BY','$35','Intermediate',['3D printer','soldering equipment'],null,null],
    ['p_camera','u_ada','DIY Camera Obscura','Fold-flat plywood camera obscura for neighborhood projection experiments.','Complete','Complete',['woodworking','photography'],['camera','optics','wood'],'◉','Public','CC BY-SA','$28','Approachable',['laser cutter','hand tools'],null,null],
    ['p_knob','u_mike','Cast Aluminum Control Knob','Sand-cast control knob using a printed pattern, with notes on shrinkage and cleanup.','Revising','Active',['casting','industrial design'],['casting','aluminum','controls'],'●','Members','CC BY-SA','$12','Intermediate',['hand tools'],null,null],
    ['p_toaster','u_lee','Repairing a Broken Toaster','Diagnosing an intermittent toaster instead of sending another appliance to landfill.','Complete','Complete',['repair','electronics'],['repair','appliance','right-to-repair'],'▥','Public','CC BY','$6','Approachable',['multimeter','hand tools'],null,null],
    ['p_tinycnc','u_rin','Building a Tiny CNC Plotter','Pocket-size pen plotter made from optical-drive rails and a questionable amount of patience.','Testing','Paused',['mechanical','electronics','software'],['cnc','plotter','scrap'],'⌖','Public','MIT','$22','Intermediate',['soldering equipment','3D printer'],null,null],
    ['p_gears','u_morgan','Making a Wooden Gear Train','Hand-cut plywood gears exploring backlash, tooth finish, and the charm of imperfect motion.','Prototyping','Active',['woodworking','mechanical'],['gears','wood','mechanism'],'⚙','Public','CC BY-NC','$14','Approachable',['scroll saw','hand tools'],null,null]
  ];
  const ip = db.prepare(`INSERT INTO projects (id,owner_id,title,slug,description,stage,status,disciplines,tags,cover_emoji,visibility,license,estimated_cost,difficulty,tools,parent_type,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  projects.forEach((p,i)=> ip.run(p[0],p[1],p[2],slugify(p[2]),p[3],p[4],p[5],JSON.stringify(p[6]),JSON.stringify(p[7]),p[8],p[9],p[10],p[11],p[12],JSON.stringify(p[13]),p[14],p[15],new Date(Date.now()-(i+7)*86400000).toISOString(),new Date(Date.now()-i*3600000*7).toISOString()));

  const logs = [
    ['l1','p_flip','u_mike','Prototype','Second escapement geometry','The first pawl geometry was too sensitive to print variation. Widened the landing face and reduced the spring preload. Much quieter now.'],
    ['l2','p_flip','u_mike','Failure','THIS DIDN’T WORK','Tried a printed 1.2 mm axle. It crept under load after a few hours and the timing went strange. Next pass uses a brass pin with a printed bearing carrier.'],
    ['l3','p_lora','u_lee','Test','Three nights outside','Solar budget is healthy, but the enclosure traps enough heat to bias the temperature reading after noon. Moving the sensor into a vented nose.'],
    ['l4','p_scope','u_rin','Discovery','The “bad” vertical channel wasn’t bad','Connector oxidation at the plug-in interface created the intermittent trace. Cleaning and reseating fixed the symptom before any component replacement.'],
    ['l5','p_plotter','u_ada','Failure','THIS DIDN’T WORK','Rubber-band belt tension made circles look like potatoes. Funny, but not useful. Trying a spring-loaded idler next.'],
    ['l6','p_gears','u_morgan','Experiment','Shellac on tooth faces','One light coat cuts fuzz dramatically without making the mesh feel plasticky. Two coats is too much.']
  ];
  const il = db.prepare('INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at) VALUES (?,?,?,?,?,?,?)');
  logs.forEach((l,i)=>il.run(l[0],l[1],l[2],l[3],l[4],l[5],new Date(Date.now()-(i+1)*7200000).toISOString()));

  const questions = [
    ['q1','u_lee','How would you vent this enclosure without inviting water in?','Keep a temperature sensor honest inside a small outdoor LoRa enclosure.','A downward-facing slot and a membrane vent.','The slot helps, but solar heating still creates a stubborn warm pocket.','Examples of passive vent geometries that work at this scale.'],
    ['q2','u_morgan','Best way to cut tiny wooden gears without a laser?','Make a 24-tooth plywood gear cleanly with ordinary shop tools.','Scroll saw, coping saw, tiny files.','The root of each tooth is the problem; I keep overcutting.','A practical jig or sequence that preserves the tooth root.'],
    ['q3','u_ada','What makes a mechanism look intentionally slow?','Design a drawing machine where slowness feels like part of the work rather than a limitation.','Lower motor speed, visible gear reduction, pauses at corners.','It still reads as a cheap machine moving slowly.','Ideas from clocks, kinetic sculpture, or industrial machinery.']
  ];
  const iq = db.prepare('INSERT INTO questions (id,user_id,title,trying,tried,happened,help_needed,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  questions.forEach((q,i)=>iq.run(q[0],q[1],q[2],q[3],q[4],q[5],q[6],'Open',new Date(Date.now()-(i+2)*86400000).toISOString(),new Date(Date.now()-i*5*3600000).toISOString()));

  const notes = [
    ['n1','u_mike','A box of impossible bearings','Bought a small auction lot because one bearing looked useful. The useful bearing is ruined. The other 47 are fascinating. This is how inventory happens.','p_flip'],
    ['n2','u_mike','A better failure photo','I have started photographing the failure before fixing it. Turns out the broken state is often the part I most want to explain later.','p_knob'],
    ['n3','u_mike','Bench rule: label the mystery wire','Future-you is a collaborator. Treat them accordingly.',null]
  ];
  const ins = db.prepare('INSERT INTO shop_notes (id,user_id,title,body,project_id,created_at) VALUES (?,?,?,?,?,?)');
  notes.forEach((n,i)=>ins.run(n[0],n[1],n[2],n[3],n[4],new Date(Date.now()-(i+1)*86400000).toISOString()));

  db.prepare(`INSERT INTO build_alongs
    (id,title,overview,difficulty,expected_time,approximate_cost,skills,tools,materials,instructions,safety_notes,created_at,bom,downloadable_files,reference_url,video_url,alternatives,modification_ideas,status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'ba1','Pocket Camera Obscura','Build a small camera obscura from sheet material, then change at least one thing about the reference design.',
    'Approachable','One afternoon','$10–30',JSON.stringify(['basic fabrication','measuring']),JSON.stringify(['knife or saw','drill']),
    JSON.stringify(['thin plywood or cardboard','tracing paper','small lens or pinhole plate']),
    '1. Make a light-tight body.\n2. Add the lens or pinhole plate.\n3. Build a movable or fixed projection surface.\n4. Seal light leaks.\n5. Tune focus and record what changed.\n\nDeviations are encouraged.',
    'Use eye protection when cutting or drilling. Never aim optical experiments at the sun.',ts,
    JSON.stringify([{item:'Body sheet material',qty:'1',notes:'Cardboard, plywood, foam board, or another opaque sheet'},{item:'Tracing paper',qty:'1 sheet',notes:'Projection screen'},{item:'Lens or pinhole plate',qty:'1',notes:'Either approach is valid'},{item:'Black tape or sealant',qty:'as needed',notes:'Control light leaks'}]),
    JSON.stringify(['camera-obscura-reference.svg','camera-obscura-cut-list.pdf']),
    '', '', 'No lens? Start with a pinhole. No sheet stock? Fold a cereal box and darken the inside. A sliding screen is useful but not required.',
    'Try a curved projection screen, interchangeable apertures, a reclaimed lens, an intentionally distorted body, or a version built entirely from scrap.',
    'Active',ts);
  db.prepare(`INSERT INTO open_briefs
    (id,title,objective,constraints,optional_constraints,recommended_skills,time_window,safety_notes,created_at,resources,inspiration,status,closes_at,exhibition_note,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'ob1','MAKE SOMETHING THAT MOVES WITHOUT AN ELECTRIC MOTOR','Create an object whose motion is central to what it does or communicates.',
    JSON.stringify(['No electric motor as the primary actuator','Document at least one failed or changed idea']),
    JSON.stringify(['Use scrap material','Make the motion visible']),JSON.stringify(['mechanisms','materials','craft']),
    'Open through September','Use appropriate guards and restraint for stored-energy mechanisms.',ts,
    JSON.stringify(['Clockwork and escapements','Gravity mechanisms','Wind-up toys','Counterweights','Pneumatics and bellows']),
    'Look at clocks, automata, kinetic sculpture, toys, gravity-fed mechanisms, and machines that make stored energy visible.',
    'Open','2026-09-30','There is no winner. The closing page is an exhibition of different interpretations.',ts);

  const libs = [
    ['lib1','Guide','Documenting a Useful Failure','How To','A short field guide to recording what broke, why you think it broke, and what should happen next.',['failure','documentation','testing'],''],
    ['lib2','Reference','Fastener Head Field Reference','Design References','A compact visual reference for common fastener drives and head styles.',['hardware','fasteners','reference'],''],
    ['lib3','Field Instrument','PARALLAX — Photo & Video Comparison Workbench','Field Instruments','Compare, align, normalize, and inspect two photographs or videos.',['field-instrument','inspection','media'],'https://mbparks.com/fieldinstruments'],
    ['lib4','Article','Design for Repair Without Making Everything Modular','Repair','A practical note on access, fasteners, wear items, labels, and graceful disassembly.',['repair','design','right-to-repair'],''],
    ['lib5','Template','Project Notebook Starter','Project Templates','A lightweight structure for requirements, decisions, tests, failures, and the next thing to try.',['template','project','documentation'],'']
  ];
  const ili = db.prepare('INSERT INTO library_items (id,type,title,section,summary,tags,url,created_at) VALUES (?,?,?,?,?,?,?,?)');
  libs.forEach((l,i)=>ili.run(l[0],l[1],l[2],l[3],l[4],JSON.stringify(l[5]),l[6],new Date(Date.now()-i*86400000).toISOString()));

  db.prepare('INSERT INTO notifications (id,user_id,kind,body,href,read,created_at) VALUES (?,?,?,?,?,?,?)').run('nt1','u_mike','question','Lee asked for help with enclosure venting.','#/workshop',0,ts);
  db.prepare('INSERT INTO notifications (id,user_id,kind,body,href,read,created_at) VALUES (?,?,?,?,?,?,?)').run('nt2','u_mike','project','Morgan added a new experiment to Wooden Gear Train.','#/projects/p_gears',0,new Date(Date.now()-3600000).toISOString());
}

function seedBatch34Demo() {
  const profiles = [
    ['u_mike',['mechanical design','electronics','embedded systems','fabrication','repair'],['3D printer','CNC router','oscilloscope','soldering equipment'],['embedded systems','design review','repair','prototyping'],['bookbinding','casting','traditional crafts']],
    ['u_morgan',['bookbinding','printmaking','woodworking'],['scroll saw','bookbinding tools','hand tools'],['bookbinding','paper','printmaking'],['electronics','small mechanisms']],
    ['u_lee',['electronics','repair','embedded systems'],['oscilloscope','multimeter','soldering equipment'],['electronics troubleshooting','repair','soldering'],['machining','industrial design']],
    ['u_rin',['mechanical design','machining','CAD'],['lathe','mill','3D printer'],['machining','CAD','mechanical design'],['electronics','photography']],
    ['u_ada',['photography','illustration','woodworking'],['camera','laser cutter','hand tools'],['optics','photography','visual design'],['embedded systems','bookbinding']]
  ];
  const up=db.prepare('UPDATE users SET skills=?,tools=?,can_help=?,want_learn=? WHERE id=?');
  for(const [uid,skills,tools,help,learn] of profiles){
    const r=db.prepare('SELECT skills FROM users WHERE id=?').get(uid); if(r && json(r.skills).length===0) up.run(JSON.stringify(skills),JSON.stringify(tools),JSON.stringify(help),JSON.stringify(learn),uid);
  }
  const c=db.prepare('SELECT COUNT(*) c FROM discussion_topics').get().c; if(c)return;
  const ts=Date.now();
  const topics=[
    ['d1','u_rin','DESIGN','Mechanical','When do you stop optimizing a mechanism?','I have a linkage that works reliably now, but every time I look at it I see another way to remove a part. Where do you draw the line between refinement and needless cleverness?','p_flip',new Date(ts-2*3600000).toISOString()],
    ['d2','u_lee','FIX','Repair','Intermittent ribbon cable: replace or reinforce?','I have a flex cable that only fails when the housing twists. The connector is fine. Curious what repair approaches have actually held up instead of merely passing a bench test.','p_toaster',new Date(ts-6*3600000).toISOString()],
    ['d3','u_morgan','MAKE','Woodworking','Tiny gear teeth without a laser cutter','I am cutting small plywood gears by hand and the tooth roots are where everything goes sideways. Jigs, file sequences, or better ways to transfer the profile?','p_gears',new Date(ts-22*3600000).toISOString()],
    ['d4','u_ada','THINK','Craftsmanship','What makes a digital fabrication process feel like craft?','Not asking whether CNC or laser cutting counts as craft. I am more interested in what practices make the process attentive, legible, and personally owned.','p_camera',new Date(ts-30*3600000).toISOString()],
    ['d5','u_mike','ODDITIES','Obsolete Technology','Beautifully overbuilt mechanisms worth studying','I am collecting examples of mechanisms that solve ordinary problems with unreasonable elegance. What obsolete machines are worth opening purely to study how somebody thought?','p_flip',new Date(ts-48*3600000).toISOString()]
  ];
  const it=db.prepare('INSERT INTO discussion_topics (id,user_id,area,category,title,body,project_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for(const [idv,uid,area,cat,title,body,pid,t] of topics)it.run(idv,uid,area,cat,title,body,pid,'Open',t,t);
  const replies=[
    ['dr1','d1','u_mike',null,'When removing the next part makes the explanation harder than the mechanism, I usually stop. Maintainability is a design requirement too.',new Date(ts-90*60000).toISOString()],
    ['dr2','d1','u_morgan',null,'I like making the next revision only if it tests a specific claim. “Fewer parts is better” is not specific enough by itself.',new Date(ts-70*60000).toISOString()],
    ['dr3','d3','u_rin',null,'Try drilling the tooth-root reliefs before cutting the flanks. It gives the saw somewhere to turn and makes the root radius intentional.',new Date(ts-18*3600000).toISOString()]
  ];
  const ir=db.prepare('INSERT INTO discussion_replies (id,topic_id,user_id,parent_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
  for(const r of replies)ir.run(...r,r[5]);
}


function seedBatch1718Demo(){
  if(db.prepare('SELECT COUNT(*) c FROM critiques').get().c===0 && db.prepare("SELECT 1 FROM projects WHERE id='p_flip'").get()){
    const ts=new Date(Date.now()-5*3600000).toISOString();
    db.prepare(`INSERT INTO critiques (id,project_id,user_id,design_state,feedback_types,prompt,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'crit1','p_flip','u_mike','Prototype Review',JSON.stringify(['mechanical design','manufacturability','repairability']),
      'The carrier indexing is reliable now. I want scrutiny on the pivot arrangement and whether I am making service access harder than it needs to be.','Open',ts,ts);
    db.prepare(`INSERT INTO critique_responses (id,critique_id,user_id,works,question,try_next,questions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'cr1','crit1','u_rin','The carrier geometry reads clearly and the repeated pivots make the mechanism easy to understand.','I would question whether the captive pivot hardware is worth the assembly penalty.','Try one removable side rail so the whole carrier stack can be serviced without disturbing alignment.','How often do you expect the carriers to be removed after final assembly?',new Date(Date.now()-3*3600000).toISOString(),new Date(Date.now()-3*3600000).toISOString());
  }
  if(db.prepare('SELECT COUNT(*) c FROM live_events').get().c===0){
    const ts=now(),start=new Date(Date.now()+2*86400000).toISOString(),past=new Date(Date.now()-7*86400000).toISOString();
    db.prepare(`INSERT INTO live_events (id,title,event_type,description,starts_at,ends_at,status,stream_url,archive_url,project_id,created_by,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'live1','Flip Clock Project Clinic','Project Clinic','A bench-side review of indexing, service access, and the latest carrier prototype.',start,new Date(new Date(start).getTime()+5400000).toISOString(),'Scheduled','','','p_flip','u_mike',ts,ts);
    db.prepare(`INSERT INTO live_events (id,title,event_type,description,starts_at,ends_at,status,stream_url,archive_url,project_id,created_by,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'live2','What Broke This Week?','Shop Stream','A short garage stream looking at failed parts, discarded ideas, and what each failure taught us.',past,new Date(new Date(past).getTime()+3600000).toISOString(),'Archived','','https://www.youtube.com/',null, 'u_mike',past,past);
  }

}

function seedBatch1920Demo(){
  if(db.prepare('SELECT COUNT(*) c FROM project_clinic_submissions').get().c===0 && db.prepare("SELECT 1 FROM projects WHERE id='p_flip'").get()){
    const event=db.prepare("SELECT id FROM live_events WHERE event_type='Project Clinic' ORDER BY starts_at LIMIT 1").get();
    const ts=new Date(Date.now()-4*3600000).toISOString();
    db.prepare(`INSERT INTO project_clinic_submissions (id,user_id,project_id,problem,evidence,tried,question,status,event_id,recommendations,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'clinic1','u_mike','p_flip','The carrier stack indexes reliably, but service access still requires removing more hardware than I want.',
      'Three bench cycles completed without missed indexing. Side-rail removal currently exposes the pivot stack.',
      'Tried captive fasteners and a removable rear plate. Both work, but each adds parts and awkward access.',
      'What is the simplest service strategy that preserves alignment?','Selected',event?.id||null,'',ts,ts);
  }
  if(db.prepare('SELECT COUNT(*) c FROM skill_contact_requests').get().c===0){
    const ts=new Date(Date.now()-2*3600000).toISOString();
    db.prepare(`INSERT INTO skill_contact_requests (id,from_user_id,to_user_id,topic,offer,request,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'skillreq1','u_morgan','u_lee','Electronics troubleshooting','I can trade bookbinding help.','Basic electronics troubleshooting','I am trying to get more comfortable diagnosing small circuits. Would you be open to comparing notes sometime?','Pending',ts,ts);
  }
}

function seedBatch2122Demo(){
  if(db.prepare('SELECT COUNT(*) c FROM tool_cabinet_items').get().c===0){const ts=now(),rows=[['tc1','u_mike','Have','Test Equipment','Rigol','DS1054Z','Comfortable','Bench oscilloscope for embedded and repair work'],['tc2','u_mike','Can Help With','Fabrication','Prusa','MK4','Comfortable','FDM printing, fixture design, iteration'],['tc3','u_morgan','Know','Bookbinding','','Finishing press','Daily use','Traditional binding and repair'],['tc4','u_lee','Can Help With','Electronics','Hakko','FX-888D','Comfortable','Soldering and rework']];const q=db.prepare(`INSERT INTO tool_cabinet_items (id,user_id,relationship,category,manufacturer,model,familiarity,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);for(const r of rows)q.run(...r,ts,ts)}
  if(db.prepare('SELECT COUNT(*) c FROM project_collaborators').get().c===0&&db.prepare("SELECT 1 FROM projects WHERE id='p_flip'").get()){db.prepare('INSERT OR IGNORE INTO project_collaborators (project_id,user_id,role) VALUES (?,?,?)').run('p_flip','u_rin','Mechanical')}
  if(db.prepare('SELECT COUNT(*) c FROM project_tasks').get().c===0&&db.prepare("SELECT 1 FROM projects WHERE id='p_flip'").get()){const ts=now();const q=db.prepare(`INSERT INTO project_tasks (id,project_id,title,status,assignee_id,created_by,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);q.run('task1','p_flip','Prototype removable side rail','Doing','u_rin','u_mike','Keep carrier alignment unchanged.',ts,ts);q.run('task2','p_flip','Document carrier service sequence','To Do','u_mike','u_mike','Photograph each disassembly step.',ts,ts)}
}

initSchema();
// v9.0 — canonical access, shared media, and member safety records.
db.exec(`
  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stored_name TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0, alt_text TEXT DEFAULT '', caption TEXT DEFAULT '', visibility TEXT DEFAULT 'Public',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_blocks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'Block', created_at TEXT NOT NULL,
    PRIMARY KEY(user_id,blocked_user_id,kind)
  );
  CREATE TABLE IF NOT EXISTS idempotency_responses (
    key TEXT PRIMARY KEY, method TEXT NOT NULL, pathname TEXT NOT NULL,
    status_code INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_responses(created_at);
  CREATE INDEX IF NOT EXISTS idx_media_assets_user ON media_assets(user_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility,updated_at);
`);
try{db.prepare('DELETE FROM idempotency_responses WHERE created_at<?').run(new Date(Date.now()-7*86400000).toISOString())}catch{}
ensureColumn('media_assets','visibility',"TEXT DEFAULT 'Public'");
ensureColumn('scrap_listings','scope',"TEXT DEFAULT 'Workshop'");
ensureColumn('scrap_listings','visibility',"TEXT DEFAULT 'Public'");
function normalizeLegacyAccess(){
  const tables=['projects','workshop_sessions','live_events','shop_notes','weekly_questions','teardown_clubs'];
  for(const table of tables){try{db.exec(`UPDATE ${table} SET visibility='GearHead' WHERE visibility IN ('Supporter','GearHead Crew Only')`)}catch{}}
  try{db.exec(`UPDATE gearhead_entries SET access_level='GearHead' WHERE access_level IN ('Supporter','GearHead Crew Only')`)}catch{}
}
normalizeLegacyAccess();
ensureColumn('projects','materials',"TEXT DEFAULT '[]'");
ensureColumn('projects','website',"TEXT DEFAULT ''");
ensureColumn('projects','cover_url',"TEXT DEFAULT ''");
ensureColumn('projects','project_type',"TEXT DEFAULT 'Project'");
ensureColumn('build_log_entries','measurements',"TEXT DEFAULT ''");
ensureColumn('build_log_entries','observations',"TEXT DEFAULT ''");
ensureColumn('build_log_entries','test_results',"TEXT DEFAULT ''");
ensureColumn('build_log_entries','problems',"TEXT DEFAULT ''");
ensureColumn('build_log_entries','decisions',"TEXT DEFAULT ''");
ensureColumn('build_log_entries','questions',"TEXT DEFAULT ''");
ensureColumn('build_log_entries','attachments',"TEXT DEFAULT '[]'");
ensureColumn('build_log_entries','updated_at',"TEXT DEFAULT ''");
ensureColumn('users','skills',"TEXT DEFAULT '[]'");
ensureColumn('users','tools',"TEXT DEFAULT '[]'");
ensureColumn('users','can_help',"TEXT DEFAULT '[]'");
ensureColumn('users','want_learn',"TEXT DEFAULT '[]'");
ensureColumn('users','profile_visibility',"TEXT DEFAULT 'Members'");
ensureColumn('users','location_visibility',"TEXT DEFAULT 'Members'");
ensureColumn('users','tool_cabinet_visibility',"TEXT DEFAULT 'Members'");
ensureColumn('users','password_hash',"TEXT DEFAULT ''");
ensureColumn('users','email_verified',"INTEGER DEFAULT 0");
ensureColumn('users','account_status',"TEXT DEFAULT 'Active'");
ensureColumn('users','force_password_reset',"INTEGER DEFAULT 0");
ensureColumn('users','anonymized_at',"TEXT DEFAULT ''");
ensureColumn('users','admin_note',"TEXT DEFAULT ''");
ensureColumn('users','age_18_confirmed_at',"TEXT DEFAULT ''");
ensureColumn('users','terms_version_accepted',"TEXT DEFAULT ''");
ensureColumn('users','terms_accepted_at',"TEXT DEFAULT ''");
ensureColumn('sessions','expires_at',"TEXT DEFAULT ''");
ensureColumn('content_reports','priority',"TEXT DEFAULT 'Normal'");
ensureColumn('content_reports','assignee_id',"TEXT DEFAULT ''");
ensureColumn('content_reports','moderator_notes',"TEXT DEFAULT ''");
ensureColumn('content_reports','resolved_at',"TEXT DEFAULT ''");
ensureColumn('projects','github_repo',"TEXT DEFAULT ''");
ensureColumn('projects','crew_id',"TEXT DEFAULT ''");
ensureColumn('questions','crew_id',"TEXT DEFAULT ''");
ensureColumn('workshop_sessions','crew_id',"TEXT DEFAULT ''");
ensureColumn('scrap_listings','crew_id',"TEXT DEFAULT ''");
ensureColumn('tool_cabinet_items','local_availability',"TEXT DEFAULT 'No'");
ensureColumn('project_files','sha256',"TEXT DEFAULT ''");
// Backfill provenance hashes for older local uploads when the payload is still present.
for (const f of db.prepare("SELECT id,stored_name FROM project_files WHERE sha256='' OR sha256 IS NULL").all()) {
  try { const buf=fs.readFileSync(path.join(UPLOADS,f.stored_name)); db.prepare('UPDATE project_files SET sha256=? WHERE id=?').run(crypto.createHash('sha256').update(buf).digest('hex'),f.id); } catch {}
}
db.prepare('INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (?,?)').run(APP_VERSION,now());
ensureColumn('questions','project_id',"TEXT DEFAULT ''");
ensureColumn('questions','measurements',"TEXT DEFAULT ''");
ensureColumn('questions','drawings',"TEXT DEFAULT ''");
ensureColumn('questions','source_code',"TEXT DEFAULT ''");
ensureColumn('questions','schematic',"TEXT DEFAULT ''");
ensureColumn('questions','external_links',"TEXT DEFAULT '[]'");
ensureColumn('questions','evidence_refs',"TEXT DEFAULT '[]'");
ensureColumn('shop_notes','status',"TEXT DEFAULT 'Published'");
ensureColumn('shop_notes','visibility',"TEXT DEFAULT 'Public'");
ensureColumn('shop_notes','media_refs',"TEXT DEFAULT '[]'");
ensureColumn('shop_notes','external_link',"TEXT DEFAULT ''");
ensureColumn('shop_notes','updated_at',"TEXT DEFAULT ''");
ensureColumn('build_alongs','bom',"TEXT DEFAULT '[]'");
ensureColumn('build_alongs','downloadable_files',"TEXT DEFAULT '[]'");
ensureColumn('build_alongs','reference_url',"TEXT DEFAULT ''");
ensureColumn('build_alongs','video_url',"TEXT DEFAULT ''");
ensureColumn('build_alongs','alternatives',"TEXT DEFAULT ''");
ensureColumn('build_alongs','modification_ideas',"TEXT DEFAULT ''");
ensureColumn('build_alongs','status',"TEXT DEFAULT 'Active'");
ensureColumn('build_alongs','updated_at',"TEXT DEFAULT ''");
ensureColumn('open_briefs','resources',"TEXT DEFAULT '[]'");
ensureColumn('open_briefs','inspiration',"TEXT DEFAULT ''");
ensureColumn('open_briefs','status',"TEXT DEFAULT 'Open'");
ensureColumn('open_briefs','closes_at',"TEXT DEFAULT ''");
ensureColumn('open_briefs','exhibition_note',"TEXT DEFAULT ''");
ensureColumn('open_briefs','updated_at',"TEXT DEFAULT ''");
ensureColumn('library_items','body',"TEXT DEFAULT ''");
ensureColumn('library_items','visibility',"TEXT DEFAULT 'Public'");
ensureColumn('library_items','status',"TEXT DEFAULT 'Published'");
ensureColumn('library_items','featured',"INTEGER DEFAULT 0");
ensureColumn('library_items','updated_at',"TEXT DEFAULT ''");
ensureColumn('library_items','author_id',"TEXT DEFAULT ''");
ensureColumn('live_events','visibility',"TEXT DEFAULT 'Public'");
ensureColumn('project_files','access_level',"TEXT DEFAULT 'Inherit'");
ensureColumn('email_preferences','gearhead',"INTEGER DEFAULT 1");
ensureColumn('gearhead_entries','poster_url',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','runtime_text',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','transcript',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','chapters',"TEXT DEFAULT '[]'");
ensureColumn('gearhead_tutorial_steps','media_url',"TEXT DEFAULT ''");
ensureColumn('gearhead_tutorial_steps','code_text',"TEXT DEFAULT ''");
ensureColumn('gearhead_tutorial_steps','measurements',"TEXT DEFAULT ''");
ensureColumn('gearhead_tutorial_steps','warning',"TEXT DEFAULT ''");
ensureColumn('gearhead_tutorial_steps','tools',"TEXT DEFAULT '[]'");
ensureColumn('gearhead_tutorial_steps','materials',"TEXT DEFAULT '[]'");
ensureColumn('gearhead_entries','early_status',"TEXT DEFAULT 'Experimental'");
ensureColumn('gearhead_entries','known_issues',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','requirements',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','release_notes',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','public_target_at',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','feedback_open',"INTEGER DEFAULT 1");
ensureColumn('gearhead_entries','preview_text',"TEXT DEFAULT ''");
ensureColumn('gearhead_entries','preview_media_url',"TEXT DEFAULT ''");
ensureColumn('email_preferences','gearhead_digest',"INTEGER DEFAULT 1");
ensureColumn('email_preferences','gearhead_digest_frequency',"TEXT DEFAULT 'Monthly'");
if (SEED_DEMO) seedDemo();
if (SEED_DEMO) seedBatch34Demo();
function seedBatch78Demo(){
  const ba=db.prepare('SELECT * FROM build_alongs WHERE id=?').get('ba1');
  if(ba && json(ba.bom).length===0){
    db.prepare(`UPDATE build_alongs SET bom=?,downloadable_files=?,alternatives=?,modification_ideas=?,status=?,updated_at=? WHERE id='ba1'`).run(
      JSON.stringify([{item:'Body sheet material',qty:'1',notes:'Cardboard, plywood, foam board, or another opaque sheet'},{item:'Tracing paper',qty:'1 sheet',notes:'Projection screen'},{item:'Lens or pinhole plate',qty:'1',notes:'Either approach is valid'},{item:'Black tape or sealant',qty:'as needed',notes:'Control light leaks'}]),
      JSON.stringify(['camera-obscura-reference.svg','camera-obscura-cut-list.pdf']),
      'No lens? Start with a pinhole. No sheet stock? Fold a cereal box and darken the inside. A sliding screen is useful but not required.',
      'Try a curved projection screen, interchangeable apertures, a reclaimed lens, an intentionally distorted body, or a version built entirely from scrap.','Active',now());
  }
  const ob=db.prepare('SELECT * FROM open_briefs WHERE id=?').get('ob1');
  if(ob && json(ob.resources).length===0){
    db.prepare(`UPDATE open_briefs SET resources=?,inspiration=?,status=?,closes_at=?,exhibition_note=?,updated_at=? WHERE id='ob1'`).run(
      JSON.stringify(['Clockwork and escapements','Gravity mechanisms','Wind-up toys','Counterweights','Pneumatics and bellows']),
      'Look at clocks, automata, kinetic sculpture, toys, gravity-fed mechanisms, and machines that make stored energy visible.','Open','2026-09-30','There is no winner. The closing page is an exhibition of different interpretations.',now());
  }
}
if (SEED_DEMO) seedBatch78Demo();
function seedBatch910Demo(){
  const items={
    lib1:['A useful failure note should preserve intent, observed behavior, likely cause, evidence, and the next test. Photograph the failed state before fixing it. The objective is not blame; it is reusable knowledge.',1],
    lib2:['Keep this reference near assembly and teardown work. Record the drive and head style rather than writing “screw” when the distinction matters for serviceability.',0],
    lib3:['PARALLAX is a Green Shoe Garage Field Instrument for side-by-side visual comparison, alignment, normalization, overlay inspection, and difference finding.',1],
    lib4:['Repairability often comes from ordinary decisions: reachable fasteners, replaceable wear items, cable slack, labels, test points, and a disassembly order that does not destroy the product.',0],
    lib5:['Start with the question, record decisions as they happen, keep failures beside successful tests, and always leave a clear next action for future-you.',1]
  };
  for(const [idv,[body,featured]] of Object.entries(items)){
    const r=db.prepare('SELECT body FROM library_items WHERE id=?').get(idv);if(r&&!String(r.body||'').trim())db.prepare(`UPDATE library_items SET body=?,featured=?,status='Published',visibility='Public',updated_at=? WHERE id=?`).run(body,featured,now(),idv);
  }
}
if (SEED_DEMO) seedBatch910Demo();
if (SEED_DEMO) seedBatch1718Demo();
if (SEED_DEMO) seedBatch1920Demo();
if (SEED_DEMO) seedBatch2122Demo();
function seedBatch2324Demo(){
  const owner=db.prepare("SELECT id FROM users WHERE role='Owner' ORDER BY created_at LIMIT 1").get()||db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
  if(!owner)return;
  const ts=now();
  if(!db.prepare('SELECT 1 FROM wall_exhibitions WHERE id=?').get('wall_failed')) db.prepare(`INSERT INTO wall_exhibitions (id,title,description,status,visibility,curator_id,starts_at,ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('wall_failed','Failed Beautifully','Projects where the failed version taught something worth keeping.','Published','Public',owner.id,'','',ts,ts);
  if(!db.prepare('SELECT 1 FROM wall_exhibitions WHERE id=?').get('wall_made')) db.prepare(`INSERT INTO wall_exhibitions (id,title,description,status,visibility,curator_id,starts_at,ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('wall_made','This Month in the Workshop','A small editorial selection of things being made, repaired, and discovered around the Workshop.','Published','Public',owner.id,'','',ts,ts);
  const projects=db.prepare('SELECT id,status FROM projects ORDER BY updated_at DESC LIMIT 6').all();
  for(const [i,p] of projects.entries()) db.prepare('INSERT OR IGNORE INTO wall_items (exhibition_id,project_id,caption,sort_order,created_at) VALUES (?,?,?,?,?)').run(i<3?'wall_made':'wall_failed',p.id,i<3?'On the wall this month.':'The useful version is not always the successful one.',i,ts);
}
if (SEED_DEMO) seedBatch2324Demo();
function seedBatch2526Demo(){
  const owner=db.prepare("SELECT id FROM users WHERE role='Owner' ORDER BY created_at LIMIT 1").get()||db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
  if(!owner)return; const ts=now();
  if(!db.prepare('SELECT 1 FROM weekly_questions WHERE id=?').get('qw_oldmachine')) db.prepare(`INSERT INTO weekly_questions (id,prompt,image_url,status,visibility,starts_at,ends_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('qw_oldmachine','Show us your oldest working machine.','','Published','Public','2026-08-10','2026-08-24',owner.id,ts,ts);
  if(!db.prepare('SELECT 1 FROM mystery_items WHERE id=?').get('mystery_connector')) db.prepare(`INSERT INTO mystery_items (id,user_id,title,category,photo_urls,dimensions,markings,approximate_age,source_context,notes,status,identified_as,best_proposal_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('mystery_connector','u_morgan','Odd ceramic connector from a radio chassis','connector',JSON.stringify([]),'About 32 mm long','A17 / 250V','Probably 1950s–1960s','Found loose inside a parts drawer from an old radio repair shop.','Two spring contacts and a keyed ceramic body.','Open','','',ts,ts);
  if(!db.prepare('SELECT 1 FROM teardown_clubs WHERE id=?').get('td_timer')) db.prepare(`INSERT INTO teardown_clubs (id,title,object_name,overview,status,visibility,safety_notes,reference_url,project_id,starts_at,ends_at,curator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('td_timer','TEARDOWN CLUB · Mechanical Timer','Spring-wound kitchen timer','Take apart a common spring-wound timer and collaboratively map its energy storage, escapement, gearing, bell mechanism, materials, serviceability, and reusable parts.','Active','Public','Stored spring energy and sharp stamped-metal edges. Release spring tension carefully before handling the mechanism.','','','2026-08-15','2026-09-15',owner.id,ts,ts);
  if(!db.prepare('SELECT 1 FROM teardown_contributions WHERE id=?').get('tdc_timer_gear')) db.prepare(`INSERT INTO teardown_contributions (id,teardown_id,user_id,category,title,body,photo_urls,component,material,circuit_notes,mechanism_notes,repairability,reusable_parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('tdc_timer_gear','td_timer','u_rin','Mechanism','Reduction train and bell trip','The main spring drives a compact stamped-gear train. A cam near the final wheel lifts and releases the bell hammer near zero.','[]','gear train','steel / brass','','The reduction train couples the spring barrel to the timing escapement and a final trip cam.','Fasteners are mostly bent tabs, so disassembly is possible but repeated service would fatigue the enclosure tabs.','Small gears, spring, bell, shaft stock',ts,ts);
  if(!db.prepare('SELECT 1 FROM scrap_listings WHERE id=?').get('scrap_motors')) db.prepare(`INSERT INTO scrap_listings (id,user_id,title,category,description,exchange_type,city_region,condition_text,quantity_text,image_url,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('scrap_motors','u_lee','Small DC gearmotors from retired prototypes','motors','A mixed handful of 6–12 V brushed DC gearmotors removed from test fixtures. Useful for experiments; shaft sizes vary.','Free','Frederick, MD','Used / working when removed','6 motors','','Available',ts,ts);
}

if (SEED_DEMO) seedBatch2526Demo();
function seedParticipationDemo(){
  if(db.prepare('SELECT COUNT(*) c FROM workshop_sessions').get().c)return;
  const ts=now();
  db.prepare(`INSERT INTO workshop_sessions (id,title,theme,description,cover_url,status,visibility,host_id,starts_at,ends_at,wall_exhibition_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('sess_use','USE WHAT YOU HAVE','Repair · Reuse · Reinvent','Four assignments about making with the tools, materials, broken objects, and knowledge already within reach. The point is resourcefulness, not austerity.','','Active','Public','u_mike','2026-08-15','2026-09-15',null,ts,ts);
  const ia=db.prepare(`INSERT INTO session_assignments (id,session_id,title,purpose,brief,constraints,optional_constraints,suggested_tools,suggested_materials,references_json,safety_notes,estimated_time,sort_order,release_at,due_at,status,live_event_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  ia.run('asg_tool','sess_use','MAKE A TOOL','Build something that changes what your hands can do.','Make a useful tool, jig, fixture, gauge, holder, or aid from material you already have.',JSON.stringify(['Do not buy the primary material','Document one design decision']),JSON.stringify(['Use a broken or obsolete object as a donor']),JSON.stringify(['hand tools']),JSON.stringify(['scrap','offcuts','salvaged hardware']),JSON.stringify(['Project Notebook Starter']), 'Use suitable PPE and do not improvise unsafe guards or electrical insulation.','One afternoon',1,'2026-08-15','2026-08-24','Published',null,ts,ts);
  ia.run('asg_fix','sess_use','FIX SOMETHING THAT ISN’T YOURS','Practice repair as service and observation.','Repair or improve something for another person. Document what the owner actually needed, not only what was technically broken.',JSON.stringify(['Ask before changing the object','Preserve evidence of the original fault']),JSON.stringify(['Teach the owner one thing about the repair']),JSON.stringify(['diagnostic tools','hand tools']),JSON.stringify(['replacement parts already on hand']),JSON.stringify(['Design for Repair Without Making Everything Modular']),'Do not repair safety-critical equipment outside your competence.','1–3 hours',2,'2026-08-18','2026-08-31','Published',null,ts,ts);
  ia.run('asg_nobuy','sess_use','BUILD WITHOUT BUYING ANYTHING','Discover what constraints reveal.','Make a useful, strange, or beautiful object using only what is already in your shop, home, recycling, or scrap pile.',JSON.stringify(['Purchase nothing for the build','List the sources of your materials']),JSON.stringify(['Use at least one part in a way it was not designed for']),JSON.stringify(['whatever you already have']),JSON.stringify(['scrap','reclaimed material']),JSON.stringify(['Documenting a Useful Failure']),'Use salvaged materials only when their condition is appropriate for the load or hazard involved.','One weekend',3,'2026-08-22','2026-09-07','Published',null,ts,ts);
  ia.run('asg_teach','sess_use','TEACH THE PROCESS','Turn doing into shared knowledge.','Take one technique from your Session project and document it so another maker could actually try it.',JSON.stringify(['Show at least one intermediate state','Explain one mistake or uncertainty']),JSON.stringify(['Include a simple test or check']),JSON.stringify(['camera','notebook']),JSON.stringify([]),JSON.stringify(['Project Notebook Starter']),'Include practical safety context when the technique involves hazards.','60–90 minutes',4,'2026-08-29','2026-09-15','Published',null,ts,ts);
}
if (SEED_DEMO) seedParticipationDemo();


function seedMakerCrewsDemo(){
  if(!db.prepare("SELECT 1 FROM maker_crews WHERE code='MC21502'").get()){
    const ts=now();
    db.prepare(`INSERT INTO maker_crews (id,code,name,anchor_postal_code,city_region,country,description,cover_url,status,visibility,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('crew_21502','MC21502','Cumberland Maker Crew','21502','Cumberland, MD','US','Makers, repairers, artists, engineers, craftspeople, and curious people around Cumberland and Western Maryland.','','Active','Public','u_mike',ts,ts);
    const z=db.prepare(`INSERT INTO maker_crew_postal_codes (crew_id,postal_code,latitude,longitude,is_anchor,created_at) VALUES (?,?,?,?,?,?)`);
    z.run('crew_21502','21502',39.6529,-78.7625,1,ts);z.run('crew_21502','21501',39.65,-78.76,0,ts);z.run('crew_21502','21532',39.6581,-78.9284,0,ts);z.run('crew_21502','21524',39.694,-78.79,0,ts);
    const m=db.prepare(`INSERT OR IGNORE INTO maker_crew_members (crew_id,user_id,role,status,affiliation_visibility,is_primary,joined_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    m.run('crew_21502','u_mike','Organizer','Active','Public',1,ts,ts);m.run('crew_21502','u_rin','Member','Active','Members',1,ts,ts);
    db.prepare("UPDATE projects SET crew_id='crew_21502' WHERE id IN ('p_flip','p_tinycnc')").run();
    db.prepare("UPDATE tool_cabinet_items SET local_availability='By arrangement' WHERE user_id='u_mike' AND relationship IN ('Have','Can Help With')").run();
    db.prepare(`INSERT INTO maker_crew_events (id,crew_id,title,event_type,description,starts_at,ends_at,venue_name,city_region,exact_address,address_visibility,capacity,approval_required,what_to_bring,safety_notes,status,visibility,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('cevt_repair','crew_21502','Repair Night','Repair Night','Bring one repairable object, one stubborn diagnosis, or simply another pair of hands.','2026-08-27T19:00:00-04:00','2026-08-27T21:00:00-04:00','Community workshop','Cumberland, MD','','Attendees',18,0,'One object you are willing to open up','Mains-powered and safety-critical repairs stay within the competence of the people doing the work.','Scheduled','Public','u_mike',ts,ts);
    db.prepare(`INSERT INTO maker_crew_bulletin_posts (id,crew_id,user_id,post_type,title,body,expires_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('cb_hamfest','crew_21502','u_rin','Going','Anyone heading to the hamfest?','I may drive over Sunday morning. Happy to coordinate with anyone else from the Crew.','2026-09-01','Active',ts,ts);
  }
}
if (SEED_DEMO) seedMakerCrewsDemo();

function seedGearheadDemo(){
  if(db.prepare('SELECT COUNT(*) c FROM gearhead_entries').get().c)return;
  const editor=db.prepare("SELECT * FROM users WHERE role IN ('Owner','Administrator','Editor') ORDER BY CASE role WHEN 'Owner' THEN 0 ELSE 1 END LIMIT 1").get();if(!editor)return;const ts=now();
  db.prepare(`INSERT INTO gearhead_entries (id,title,deck,entry_type,body,related_project_id,tags,status,access_level,publish_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('gh_fixture','Fixture Design: The Long Version','A complete walk through locating, clamping, mistakes, and the revised fixture.','Tutorial','The public project shows the result. This version preserves the setup decisions, failed assumptions, and the details that made the second pass work.','p_flip',JSON.stringify(['fixture','process','deep-dive']),'Published','GearHead',ts,editor.id,ts,ts);
  const st=db.prepare('INSERT INTO gearhead_tutorial_steps (id,entry_id,sort_order,title,body,image_url,safety_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  st.run('ghs1','gh_fixture',10,'Start with the locating scheme','Decide which features establish the part before choosing clamps.','','',ts,ts);st.run('ghs2','gh_fixture',20,'Clamp without moving the datum','Apply force toward the locating faces and test repeatability before cutting.','','Keep hands clear of clamping and cutting zones.',ts,ts);
  db.prepare(`INSERT INTO gearhead_entries (id,title,deck,entry_type,body,tags,status,access_level,publish_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('gh_bench_roll','Bench Roll 001 · What the Camera Missed','A short photo-note from the workbench.','Bench Roll','Small observations, temporary setups, and the things that usually disappear when a project gets cleaned up for publication.',JSON.stringify(['bench-roll','behind-the-scenes']),'Published','GearHead',ts,editor.id,ts,ts);
}
if (SEED_DEMO) seedGearheadDemo();


function bootstrapOwnerFromEnvironment() {
  const email=String(process.env.WORKSHOP_BOOTSTRAP_OWNER_EMAIL||'').trim().toLowerCase();
  const password=String(process.env.WORKSHOP_BOOTSTRAP_OWNER_PASSWORD||'');
  const displayName=String(process.env.WORKSHOP_BOOTSTRAP_OWNER_NAME||'Workshop Owner').trim()||'Workshop Owner';
  if(!email&&!password)return;
  if(!email||!email.includes('@'))throw new Error('WORKSHOP_BOOTSTRAP_OWNER_EMAIL must be a valid email address.');
  if(password.length<10)throw new Error('WORKSHOP_BOOTSTRAP_OWNER_PASSWORD must contain at least 10 characters.');
  const existing=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(existing){
    if(existing.role!=='Owner') db.prepare("UPDATE users SET role='Owner',account_status='Active' WHERE id=?").run(existing.id);
    if(!existing.password_hash) db.prepare("UPDATE users SET display_name=?,password_hash=?,email_verified=1,account_status='Active' WHERE id=?").run(displayName,passwordHash(password),existing.id);
    return;
  }
  const uid=id('u');
  db.prepare(`INSERT INTO users (id,email,display_name,bio,city_region,role,avatar_seed,created_at,password_hash,email_verified,account_status,skills,tools,can_help,want_learn,profile_visibility,location_visibility,tool_cabinet_visibility)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid,email,displayName,'','','Owner',displayName.slice(0,2).toUpperCase(),now(),passwordHash(password),1,'Active','[]','[]','[]','[]','Members','Members','Members');
}

function recoverOwnerFromEnvironment() {
  const enabled=String(process.env.WORKSHOP_OWNER_RECOVERY||'').trim()==='1';
  if(!enabled)return;
  const recoveryId=String(process.env.WORKSHOP_OWNER_RECOVERY_ID||'').trim();
  const email=String(process.env.WORKSHOP_BOOTSTRAP_OWNER_EMAIL||'').trim().toLowerCase();
  const password=String(process.env.WORKSHOP_BOOTSTRAP_OWNER_PASSWORD||'');
  const displayName=String(process.env.WORKSHOP_BOOTSTRAP_OWNER_NAME||'Workshop Owner').trim()||'Workshop Owner';
  if(recoveryId.length<12)throw new Error('WORKSHOP_OWNER_RECOVERY_ID must contain at least 12 characters. Use a new random value for each recovery.');
  if(!email||!email.includes('@'))throw new Error('Owner recovery requires WORKSHOP_BOOTSTRAP_OWNER_EMAIL.');
  if(password.length<10)throw new Error('Owner recovery requires WORKSHOP_BOOTSTRAP_OWNER_PASSWORD with at least 10 characters.');
  const fingerprint=crypto.createHash('sha256').update(recoveryId).digest('hex');
  const key=`ownerRecovery:${fingerprint}`;
  if(db.prepare('SELECT 1 FROM site_settings WHERE key=?').get(key))return;
  let target=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  let created=false;
  if(!target){
    const uid=id('u');
    db.prepare(`INSERT INTO users (id,email,display_name,bio,city_region,role,avatar_seed,created_at,password_hash,email_verified,account_status,skills,tools,can_help,want_learn,profile_visibility,location_visibility,tool_cabinet_visibility)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid,email,displayName,'','','Owner',displayName.slice(0,2).toUpperCase(),now(),passwordHash(password),1,'Active','[]','[]','[]','[]','Members','Members','Members');
    target=db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    created=true;
  } else {
    db.prepare("UPDATE users SET display_name=?,role='Owner',password_hash=?,email_verified=1,account_status='Active' WHERE id=?")
      .run(displayName,passwordHash(password),target.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(target.id);
  }
  db.prepare('INSERT INTO site_settings (key,value,updated_at) VALUES (?,?,?)').run(key,JSON.stringify({email,targetId:target.id,created}),now());
  audit('', 'owner.recovery', 'user', target.id, {email,created,recoveryFingerprint:fingerprint.slice(0,12)});
  console.warn(`[WORKSHOP] One-time Owner recovery applied for ${email}. Remove WORKSHOP_OWNER_RECOVERY and WORKSHOP_OWNER_RECOVERY_ID after successful sign-in.`);
}
bootstrapOwnerFromEnvironment();
recoverOwnerFromEnvironment();

function projectSelect(userId='') {
  return `SELECT p.*, u.display_name owner_name, mc.code crew_code, mc.name crew_name,
    EXISTS(SELECT 1 FROM saved_items s WHERE s.user_id=? AND s.item_type='project' AND s.item_id=p.id) saved,
    (SELECT COUNT(*) FROM build_log_entries l WHERE l.project_id=p.id) log_count,
    (SELECT COUNT(*) FROM comments c WHERE c.project_id=p.id) comment_count
    FROM projects p JOIN users u ON u.id=p.owner_id LEFT JOIN maker_crews mc ON mc.id=p.crew_id`;
}


function canViewProfile(viewer, u){
  const v=u.profile_visibility||'Members'; if(v==='Public')return true; if(v==='Private')return viewer?.id===u.id; return Boolean(viewer);
}
function benchPayload(viewer, uid){
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(uid); if(!u)return null; if(!canViewProfile(viewer,u))return {restricted:true,id:u.id,displayName:u.display_name,avatarSeed:u.avatar_seed};
  const rows=filterVisibleProjects(db.prepare(projectSelect(viewer?.id||'')+' WHERE p.owner_id=? ORDER BY p.updated_at DESC').all(viewer?.id||'',uid),viewer).map(projectRow);
  const cabinetVisible=u.tool_cabinet_visibility==='Public'||(u.tool_cabinet_visibility==='Members'&&viewer)||viewer?.id===u.id;
  const toolCabinet=cabinetVisible?db.prepare('SELECT * FROM tool_cabinet_items WHERE user_id=? ORDER BY relationship,category,manufacturer,model').all(uid):[];
  const currentAssignments=db.prepare(`SELECT a.id assignment_id,a.title assignment_title,a.due_at,s.id session_id,s.title session_title,s.theme,p.id project_id,p.title project_title,p.stage,ws.confirmation_code FROM assignment_projects ap JOIN session_assignments a ON a.id=ap.assignment_id JOIN workshop_sessions s ON s.id=a.session_id JOIN projects p ON p.id=ap.project_id LEFT JOIN work_submissions ws ON ws.assignment_id=a.id AND ws.project_id=p.id WHERE ap.user_id=? AND s.status IN ('Active','Upcoming') ORDER BY a.due_at,a.sort_order`).all(uid);
  return {restricted:false,user:safeUser(u),craft:craftProgressFor(uid,viewer?.id===uid),projects:rows,toolCabinet,currentAssignments,crew:visiblePrimaryCrew(uid,viewer),cabinetVisible,locationVisible:(u.location_visibility==='Public'||(u.location_visibility==='Members'&&viewer)||viewer?.id===u.id)};
}
const BENCH_EMBED_DEFAULTS={theme:'auto',layout:'card',showBio:true,showLocation:false,showCrew:true,showCraft:true,showGearhead:true,showSkills:true,showProjects:true,projectLimit:3};
function benchEmbedSettings(raw={}){
  const v={...BENCH_EMBED_DEFAULTS,...(raw&&typeof raw==='object'?raw:{})};
  v.theme=['auto','dark','light'].includes(v.theme)?v.theme:'auto';v.layout=['card','compact'].includes(v.layout)?v.layout:'card';
  for(const k of ['showBio','showLocation','showCrew','showCraft','showGearhead','showSkills','showProjects'])v[k]=Boolean(v[k]);
  v.projectLimit=Math.max(0,Math.min(4,Number(v.projectLimit)||0));return v;
}
function benchEmbedRecord(userId,create=false){
  let row=db.prepare('SELECT * FROM bench_embeds WHERE user_id=?').get(userId);
  if(!row&&create){const ts=now();db.prepare('INSERT INTO bench_embeds (user_id,token,enabled,settings,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(userId,crypto.randomBytes(24).toString('hex'),0,JSON.stringify(BENCH_EMBED_DEFAULTS),ts,ts);row=db.prepare('SELECT * FROM bench_embeds WHERE user_id=?').get(userId)}
  return row?{...row,settings:benchEmbedSettings(json(row.settings))}:null;
}
function benchEmbedBase(req){const configured=String(PUBLIC_URL||'').replace(/\/$/,'');if(configured)return configured;const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim();return `${proto}://${req.headers.host||`127.0.0.1:${PORT}`}`;}
function benchEmbedPayload(userId,settings){
  const u=db.prepare("SELECT * FROM users WHERE id=? AND account_status='Active' AND anonymized_at='' ").get(userId);if(!u)return null;
  const s=benchEmbedSettings(settings),craft=craftProgressFor(userId,false),crew=s.showCrew?primaryCrew(userId):null;
  const projects=s.showProjects&&s.projectLimit?db.prepare("SELECT id,title,slug,description,stage,cover_emoji,updated_at FROM projects WHERE owner_id=? AND visibility='Public' ORDER BY updated_at DESC LIMIT ?").all(userId,s.projectLimit):[];
  return {user:{id:u.id,displayName:u.display_name,bio:s.showBio?String(u.bio||''):'',cityRegion:s.showLocation?String(u.city_region||''):'',skills:s.showSkills?json(u.skills):[],profilePublic:(u.profile_visibility||'Members')==='Public'},craft:s.showCraft?{currentLevel:craft.currentLevel,currentLabel:craft.currentLabel,metal:craft.metal}:null,gearhead:s.showGearhead?Boolean(isSupporterUser(u)):false,crew:s.showCrew&&crew&&crew.status==='Active'?{code:crew.code,name:crew.name,cityRegion:crew.city_region}:null,projects,settings:s};
}
function htmlEscape(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderBenchEmbed(req,res,url,token){
  const row=db.prepare('SELECT * FROM bench_embeds WHERE token=?').get(token);if(!row)return sendBenchEmbedHtml(res,410,'Bench widget unavailable','This Bench widget has been disabled or replaced.');const viewer=currentUser(req);if(!Number(row.enabled)&&viewer?.id!==row.user_id)return sendBenchEmbedHtml(res,410,'Bench widget unavailable','This Bench widget has been disabled or replaced.');
  const data=benchEmbedPayload(row.user_id,json(row.settings));if(!data)return sendBenchEmbedHtml(res,404,'Bench unavailable','This Workshop member is no longer available.');
  const q=url.searchParams,override={};for(const k of ['theme','layout'])if(q.has(k))override[k]=q.get(k);const settings=benchEmbedSettings({...data.settings,...override});data.settings=settings;
  const base=benchEmbedBase(req),rank=data.craft?.currentLevel||'',badge=rank==='master'?'/craft-master.webp?v=9.0.0':rank==='journeyman'?'/craft-journeyman.webp?v=9.0.0':rank==='apprentice'?'/craft-apprentice.webp?v=9.0.0':'/craft-default-wood.webp?v=9.0.0';
  const profileHref=data.user.profilePublic?`${base}/#/bench/${encodeURIComponent(data.user.id)}`:'';
  const themeCss=settings.theme==='dark'?':root{color-scheme:dark;--bg:#111510;--panel:#171c16;--ink:#f2efe5;--muted:#aaa99f;--rule:#394238;--accent:#8fb49d}':settings.theme==='light'?':root{color-scheme:light;--bg:#f3f0e8;--panel:#fbf9f2;--ink:#171a15;--muted:#66685f;--rule:#c9c7bd;--accent:#4f7f64}':'@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#111510;--panel:#171c16;--ink:#f2efe5;--muted:#aaa99f;--rule:#394238;--accent:#8fb49d}}@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f3f0e8;--panel:#fbf9f2;--ink:#171a15;--muted:#66685f;--rule:#c9c7bd;--accent:#4f7f64}}';
  const projectHtml=data.projects.length?`<div class="projects">${data.projects.map(p=>`<a href="${base}/#/projects/${encodeURIComponent(p.id)}" target="_blank" rel="noopener"><span>${htmlEscape(p.stage)}</span><strong>${htmlEscape(p.title)}</strong></a>`).join('')}</div>`:'';
  const detail=[data.crew?`<span class="crew">${htmlEscape(data.crew.code)} · ${htmlEscape(data.crew.name)}</span>`:'',data.user.cityRegion?`<span>⌖ ${htmlEscape(data.user.cityRegion)}</span>`:''].filter(Boolean).join('');
  const labels=[data.craft?`<span class="chip">${htmlEscape((data.craft.currentLabel||'Craft Path').toUpperCase())}${data.craft.metal&&data.craft.metal!=='Neutral'?` · ${htmlEscape(data.craft.metal.toUpperCase())}`:''}</span>`:'',data.gearhead?'<span class="chip">⚙ GEARHEAD CREW</span>':''].filter(Boolean).join('');
  const skills=data.user.skills?.length?`<div class="skills">${data.user.skills.slice(0,8).map(x=>`<span>${htmlEscape(x)}</span>`).join('')}</div>`:'';
  const body=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(data.user.displayName)} · THE WORKSHOP</title><style>${themeCss}*{box-sizing:border-box}html,body{margin:0;background:transparent;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}body{padding:1px}.widget{background:var(--panel);border:1px solid var(--rule);border-radius:18px;padding:${settings.layout==='compact'?'16px':'22px'};max-width:760px;min-height:120px}.top{display:grid;grid-template-columns:${settings.layout==='compact'?'62px':'86px'} 1fr;gap:16px;align-items:center}.badge{width:${settings.layout==='compact'?'58px':'82px'};height:${settings.layout==='compact'?'58px':'82px'};object-fit:contain;filter:drop-shadow(0 5px 10px rgba(0,0,0,.16))}h1{font:600 ${settings.layout==='compact'?'25px':'34px'}/1.05 Georgia,serif;margin:0 0 7px}.details{display:flex;gap:9px;flex-wrap:wrap;color:var(--muted);font-size:12px}.crew{color:var(--accent);font-weight:700}.chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.chip{border:1px solid var(--rule);border-radius:999px;padding:5px 8px;font:700 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em}.bio{color:var(--muted);font-size:13px;line-height:1.55;margin:16px 0 0}.skills{display:flex;gap:6px;flex-wrap:wrap;margin-top:13px}.skills span{background:var(--bg);border:1px solid var(--rule);padding:5px 7px;border-radius:6px;font-size:10px}.projects{display:grid;grid-template-columns:repeat(${settings.layout==='compact'?'1':'3'},minmax(0,1fr));gap:8px;margin-top:16px}.projects a{display:flex;flex-direction:column;gap:5px;text-decoration:none;color:var(--ink);border:1px solid var(--rule);padding:10px;border-radius:9px}.projects a:hover{border-color:var(--accent)}.projects span{color:var(--muted);font:700 8px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.projects strong{font-size:11px;line-height:1.25}.foot{display:flex;justify-content:space-between;gap:12px;align-items:center;border-top:1px solid var(--rule);padding-top:12px;margin-top:16px;font-size:9px;color:var(--muted)}.foot a{color:var(--accent);text-decoration:none;font-weight:700;letter-spacing:.06em}@media(max-width:540px){.projects{grid-template-columns:1fr}.widget{border-radius:12px;padding:15px}.top{grid-template-columns:58px 1fr}.badge{width:54px;height:54px}h1{font-size:25px}}</style></head><body><article class="widget"><div class="top"><img class="badge" src="${badge}" alt=""><div><h1>${htmlEscape(data.user.displayName)}</h1><div class="details">${detail}</div><div class="chips">${labels}</div></div></div>${data.user.bio?`<p class="bio">${htmlEscape(data.user.bio)}</p>`:''}${skills}${projectHtml}<div class="foot"><span>MY BENCH · THE WORKSHOP</span>${profileHref?`<a href="${profileHref}" target="_blank" rel="noopener">OPEN BENCH →</a>`:`<a href="${base}" target="_blank" rel="noopener">THE WORKSHOP →</a>`}</div></article></body></html>`;
  res.removeHeader('X-Frame-Options');res.removeHeader('Cross-Origin-Opener-Policy');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors *; base-uri 'none'; form-action 'none'");res.setHeader('Cross-Origin-Resource-Policy','cross-origin');res._statusCode=200;return encodeResponse(res,body,'text/html; charset=utf-8','public, max-age=60');
}
function sendBenchEmbedHtml(res,code,title,message){res.removeHeader('X-Frame-Options');res.removeHeader('Cross-Origin-Opener-Policy');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *");res._statusCode=code;return encodeResponse(res,`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:18px;background:#151914;color:#eee9df;font:14px system-ui}.box{border:1px solid #3b433a;border-radius:14px;padding:18px}strong{display:block;margin-bottom:6px}</style><div class="box"><strong>${htmlEscape(title)}</strong>${htmlEscape(message)}</div>`,'text/html; charset=utf-8','no-store');}

function notifyMentions(text, actorId, href){
  const handles=[...String(text||'').matchAll(/@([A-Za-z0-9_-]+)/g)].map(m=>m[1].toLowerCase()); if(!handles.length)return;
  for(const u of db.prepare('SELECT id,display_name FROM users WHERE id<>?').all(actorId)){
    const candidates=[u.display_name.toLowerCase().replace(/[^a-z0-9_-]/g,''),u.display_name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9_-]/g,'')];
    if(handles.some(h=>candidates.includes(h))) notifyUser(u.id,'mention','You were mentioned in Workshop discussion.',href,actorId);
  }
}


const NOTIFICATION_KINDS=['question','discussion','mention','project','collaboration','event','moderation'];
function notificationPrefs(userId){
  let r=db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(userId);
  if(!r){db.prepare('INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)').run(userId);r=db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(userId)}
  return r;
}
function notifyUser(userId,kind,body,href='',actorId=''){
  if(!userId || userId===actorId)return;
  const k=NOTIFICATION_KINDS.includes(kind)?kind:'project',prefs=notificationPrefs(userId);
  if(Number(prefs[k])!==1)return;
  db.prepare('INSERT INTO notifications (id,user_id,kind,body,href,read,created_at) VALUES (?,?,?,?,?,?,?)').run(id('nt'),userId,k,String(body),String(href||''),0,now());
}

function emailPrefs(userId){
  let r=db.prepare('SELECT * FROM email_preferences WHERE user_id=?').get(userId);
  if(!r){db.prepare('INSERT OR IGNORE INTO email_preferences (user_id) VALUES (?)').run(userId);r=db.prepare('SELECT * FROM email_preferences WHERE user_id=?').get(userId)}
  return r;
}
function siteSetting(key,fallback=''){const r=db.prepare('SELECT value FROM site_settings WHERE key=?').get(key);return r?String(r.value):fallback;}
function boolSetting(key,fallback=true){const v=siteSetting(key,fallback?'1':'0');return !['0','false','off','no'].includes(String(v).toLowerCase());}
function adminEmail(){
  const configured=siteSetting('adminEmail','').trim()||ADMIN_EMAIL_ENV;
  if(configured)return configured;
  return String(db.prepare("SELECT email FROM users WHERE role='Owner' AND account_status='Active' AND anonymized_at='' ORDER BY created_at LIMIT 1").get()?.email||'').trim();
}
function absoluteHash(href=''){const base=(PUBLIC_URL||'').replace(/\/$/,'');if(!base)return href||'';return `${base}/${String(href||'').replace(/^\//,'')}`;}
function emailConfigured(){return EMAIL_PROVIDER==='log'||(EMAIL_PROVIDER==='resend'&&Boolean(RESEND_API_KEY));}
async function deliverEmail({kind='general',to,subject,text}){
  const recipient=String(to||'').trim();if(!recipient||!recipient.includes('@'))return {ok:false,skipped:true};
  const eid=id('mail'),ts=now();db.prepare('INSERT INTO email_deliveries (id,kind,recipient,subject,provider,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(eid,kind,recipient,String(subject),EMAIL_PROVIDER,'Queued',ts,ts);
  if(EMAIL_PROVIDER==='off'){db.prepare("UPDATE email_deliveries SET status='Skipped',error=?,updated_at=? WHERE id=?").run('Email provider is disabled.',now(),eid);return {ok:false,skipped:true,id:eid};}
  try{
    if(EMAIL_PROVIDER==='log'){console.log(`[WORKSHOP EMAIL] ${recipient} | ${subject} | ${String(text).replace(/\s+/g,' ').slice(0,240)}`);db.prepare("UPDATE email_deliveries SET status='Sent',provider_id=?,updated_at=? WHERE id=?").run('log',now(),eid);return {ok:true,id:eid,providerId:'log'};}
    if(EMAIL_PROVIDER==='resend'){
      if(!RESEND_API_KEY)throw new Error('RESEND_API_KEY is not configured.');
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:EMAIL_FROM,to:[recipient],subject:String(subject),text:String(text)})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||`Resend returned HTTP ${response.status}`);
      db.prepare("UPDATE email_deliveries SET status='Sent',provider_id=?,updated_at=? WHERE id=?").run(String(data.id||''),now(),eid);return {ok:true,id:eid,providerId:data.id||''};
    }
    throw new Error(`Unsupported email provider: ${EMAIL_PROVIDER}`);
  }catch(error){db.prepare("UPDATE email_deliveries SET status='Failed',error=?,updated_at=? WHERE id=?").run(String(error.message||error).slice(0,500),now(),eid);console.error('[WORKSHOP EMAIL]',error);return {ok:false,id:eid,error:String(error.message||error)};}
}
function queueEmail(message){deliverEmail(message).catch(error=>console.error('[WORKSHOP EMAIL QUEUE]',error));}
function notifyAdmins(kind,body,href,subject,text,settingKey=''){
  const admins=db.prepare("SELECT id FROM users WHERE role IN ('Owner','Administrator') AND account_status='Active'").all();for(const a of admins)notifyUser(a.id,kind,body,href,'');
  if(!settingKey||boolSetting(settingKey,true)){const to=adminEmail();if(to)queueEmail({kind:settingKey||kind,to,subject,text:`${text}\n\nReview: ${absoluteHash(href)}`});}
}
function emailUser(userId,prefKey,kind,subject,text){const u=db.prepare('SELECT email FROM users WHERE id=?').get(userId);if(!u)return;const prefs=emailPrefs(userId);if(Number(prefs.enabled)!==1||Number(prefs[prefKey]??1)!==1)return;queueEmail({kind,to:u.email,subject,text});}
function assertSavable(type,itemId){
  const map={project:['projects','id'],library:['library_items','id'],question:['questions','id'],'shop-note':['shop_notes','id'],'build-along':['build_alongs','id'],'open-brief':['open_briefs','id']};
  const spec=map[type]; if(!spec)return false; return Boolean(db.prepare(`SELECT 1 FROM ${spec[0]} WHERE ${spec[1]}=?`).get(itemId));
}


function gearheadNotify(kind,body,href=''){const rows=db.prepare("SELECT * FROM users WHERE account_status='Active' AND anonymized_at='' ORDER BY created_at").all().filter(isSupporterUser);for(const u of rows){notifyUser(u.id,'gearhead',body,href,'');const pref=db.prepare('SELECT gearhead FROM email_preferences WHERE user_id=?').get(u.id);if(!pref||Number(pref.gearhead)!==0)emailUser(u.id,'gearhead',kind,'GEARHEAD CREW ONLY — '+body,`${body}\n\nOpen: ${absoluteHash(href||'#/gearhead')}`)}}
function canEditEditorial(u){ return u && ['Owner','Administrator','Editor'].includes(u.role); }
function buildAlongRow(r){
  if(!r)return null;
  return {...r, skills:json(r.skills), tools:json(r.tools), materials:json(r.materials), bom:json(r.bom), downloadableFiles:json(r.downloadable_files)};
}
function openBriefRow(r){
  if(!r)return null;
  return {...r, constraints:json(r.constraints), optionalConstraints:json(r.optional_constraints), recommendedSkills:json(r.recommended_skills), resources:json(r.resources)};
}
function libraryRow(r,viewerId=''){
  if(!r)return null;
  const saved=viewerId?Boolean(db.prepare(`SELECT 1 FROM saved_items WHERE user_id=? AND item_type='library' AND item_id=?`).get(viewerId,r.id)):false;
  return {...r,tags:json(r.tags), saved:Boolean(saved), featured:Boolean(r.featured)};
}
function childProjects(parentType,parentId,viewerId=''){
  return db.prepare(projectSelect(viewerId)+` WHERE p.parent_type=? AND p.parent_id=? ORDER BY p.updated_at DESC`).all(viewerId,parentType,parentId).map(projectRow);
}


function workshopSessionRow(r,viewerId=''){
  if(!r)return null;
  const assignments=db.prepare(`SELECT a.*,(SELECT COUNT(*) FROM assignment_projects ap WHERE ap.assignment_id=a.id) project_count,(SELECT COUNT(*) FROM work_submissions ws WHERE ws.assignment_id=a.id) submission_count FROM session_assignments a WHERE a.session_id=? ORDER BY a.sort_order,a.created_at`).all(r.id).map(a=>({...a,constraints:json(a.constraints),optionalConstraints:json(a.optional_constraints),suggestedTools:json(a.suggested_tools),suggestedMaterials:json(a.suggested_materials),references:json(a.references_json)}));
  const resources=db.prepare(`SELECT li.* FROM session_resources sr JOIN library_items li ON li.id=sr.library_item_id WHERE sr.session_id=? ORDER BY sr.sort_order,li.title`).all(r.id).map(x=>libraryRow(x,viewerId));
  const projectCount=db.prepare(`SELECT COUNT(*) c FROM assignment_projects ap JOIN session_assignments a ON a.id=ap.assignment_id WHERE a.session_id=?`).get(r.id).c;
  const submissionCount=db.prepare(`SELECT COUNT(*) c FROM work_submissions ws JOIN session_assignments a ON a.id=ws.assignment_id WHERE a.session_id=?`).get(r.id).c;
  return {...r,assignments,resources,projectCount:Number(projectCount||0),submissionCount:Number(submissionCount||0)};
}
function assignmentRow(r,viewerId=''){
  if(!r)return null;
  const session=db.prepare(`SELECT id,title,theme,status,visibility FROM workshop_sessions WHERE id=?`).get(r.session_id);
  const projects=db.prepare(projectSelect(viewerId)+` JOIN assignment_projects ap ON ap.project_id=p.id WHERE ap.assignment_id=? AND (p.visibility='Public' OR (p.visibility='Members' AND ?<>'') OR p.owner_id=? OR EXISTS(SELECT 1 FROM project_collaborators pc WHERE pc.project_id=p.id AND pc.user_id=?)) ORDER BY p.updated_at DESC`).all(viewerId,r.id,viewerId,viewerId,viewerId).map(projectRow);
  const submissions=db.prepare(`SELECT ws.*,u.display_name maker FROM work_submissions ws JOIN users u ON u.id=ws.user_id WHERE ws.assignment_id=? ORDER BY ws.created_at DESC`).all(r.id);
  return {...r,session,constraints:json(r.constraints),optionalConstraints:json(r.optional_constraints),suggestedTools:json(r.suggested_tools),suggestedMaterials:json(r.suggested_materials),references:json(r.references_json),projects,submissions};
}
function canSeeSession(r,u){return r && (r.visibility==='Public'||Boolean(u));}
function confirmationCode(){const y=new Date().getUTCFullYear();const n=Number(db.prepare('SELECT COUNT(*) c FROM work_submissions').get().c||0)+1;return `WS-${y}-${String(n).padStart(5,'0')}`;}
function makerIdData(uid,viewer){
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(uid); if(!u)return null;
  if(u.profile_visibility==='Private'&&viewer?.id!==uid)return null;if(u.profile_visibility==='Members'&&!viewer)return null;
  const current=db.prepare(projectSelect(viewer?.id||'')+` WHERE p.owner_id=? AND p.status='Active' AND (p.visibility='Public' OR (p.visibility='Members' AND ?<>'') OR p.owner_id=?) ORDER BY p.updated_at DESC LIMIT 1`).get(viewer?.id||'',uid,viewer?.id||'',viewer?.id||'');
  const sessions=db.prepare(`SELECT DISTINCT s.id,s.title,s.theme,s.status,MAX(ap.started_at) participated_at FROM assignment_projects ap JOIN session_assignments a ON a.id=ap.assignment_id JOIN workshop_sessions s ON s.id=a.session_id WHERE ap.user_id=? GROUP BY s.id ORDER BY participated_at DESC`).all(uid);
  const assignmentCount=Number(db.prepare('SELECT COUNT(*) c FROM assignment_projects WHERE user_id=?').get(uid).c||0);
  const shownCount=Number(db.prepare('SELECT COUNT(*) c FROM work_submissions WHERE user_id=?').get(uid).c||0);
  const reflections=Number(db.prepare('SELECT COUNT(*) c FROM peer_reflections WHERE reviewer_id=?').get(uid).c||0);
  const buildAlongs=Number(db.prepare("SELECT COUNT(*) c FROM projects WHERE owner_id=? AND parent_type='Build Along'").get(uid).c||0);
  const briefs=Number(db.prepare("SELECT COUNT(*) c FROM projects WHERE owner_id=? AND parent_type='Open Brief'").get(uid).c||0);
  const mysteries=Number(db.prepare("SELECT COUNT(*) c FROM mystery_proposals WHERE user_id=?").get(uid).c||0);
  const wallCount=Number(db.prepare(`SELECT COUNT(DISTINCT wi.exhibition_id) c FROM wall_items wi JOIN projects p ON p.id=wi.project_id WHERE p.owner_id=?`).get(uid).c||0);
  return {member:safeUser(u),crew:visiblePrimaryCrew(uid,viewer),currentProject:current?projectRow(current):null,sessions,participation:{assignmentsStarted:assignmentCount,showedWork:shownCount,benchWalks:reflections,buildAlongs,openBriefs:briefs,mysteryIdentifications:mysteries,wallExhibitions:wallCount}};
}



// v4.8–v5.6 — Maker Crews
function crewCode(postal){ return `MC${String(postal||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10)}`; }
function crewRole(crewId,userId){ if(!crewId||!userId)return null; return db.prepare("SELECT * FROM maker_crew_members WHERE crew_id=? AND user_id=? AND status='Active'").get(crewId,userId)||null; }
function isCrewOrganizer(crewId,u){ const m=crewRole(crewId,u?.id); return Boolean(u && (hasRole(u,['Owner','Administrator']) || (m && ['Organizer','Moderator'].includes(m.role)))); }
function canManageWorkshopSession(session,u){ return Boolean(u && (canEditEditorial(u) || (session?.crew_id && isCrewOrganizer(session.crew_id,u)))); }
function canSeeCrewMember(m,viewer){ if(!m)return false; if(m.affiliation_visibility==='Public')return true; if(m.affiliation_visibility==='Private')return viewer?.id===m.user_id; return Boolean(viewer); }
function canSeeCrew(c,viewer){ return Boolean(c && c.status!=='Archived' && (c.visibility==='Public'||viewer)); }
function crewRow(c,viewer){
  if(!c)return null;
  const coverage=db.prepare('SELECT postal_code,latitude,longitude,is_anchor FROM maker_crew_postal_codes WHERE crew_id=? ORDER BY is_anchor DESC,postal_code').all(c.id);
  const memberCount=Number(db.prepare("SELECT COUNT(*) c FROM maker_crew_members WHERE crew_id=? AND status='Active'").get(c.id).c||0);
  const projectCount=Number(db.prepare("SELECT COUNT(*) c FROM projects WHERE crew_id=? AND status='Active'").get(c.id).c||0);
  const nextEvent=db.prepare("SELECT id,title,event_type,starts_at,venue_name,city_region FROM maker_crew_events WHERE crew_id=? AND status='Scheduled' AND starts_at>=? ORDER BY starts_at LIMIT 1").get(c.id,now())||null;
  const membership=viewer?crewRole(c.id,viewer.id):null;
  return {...c,coverage,memberCount,projectCount,nextEvent,membership:membership?{role:membership.role,visibility:membership.affiliation_visibility,isPrimary:Boolean(membership.is_primary)}:null};
}
function primaryCrew(userId){ if(!userId)return null; return db.prepare(`SELECT c.*,m.role,m.affiliation_visibility,m.is_primary FROM maker_crew_members m JOIN maker_crews c ON c.id=m.crew_id WHERE m.user_id=? AND m.status='Active' ORDER BY m.is_primary DESC,m.joined_at LIMIT 1`).get(userId)||null; }
function visiblePrimaryCrew(userId,viewer){ const c=primaryCrew(userId); if(!c||c.status!=='Active')return null; const self=viewer?.id===userId, visible=c.affiliation_visibility==='Public'||(c.affiliation_visibility==='Members'&&Boolean(viewer))||self; return visible?{id:c.id,code:c.code,name:c.name,cityRegion:c.city_region,role:c.role}:null; }
function crewMemberIds(crewId){ return db.prepare("SELECT user_id FROM maker_crew_members WHERE crew_id=? AND status='Active'").all(crewId).map(x=>x.user_id); }
function haversineMiles(aLat,aLon,bLat,bLon){ const R=3958.8,rad=x=>Number(x)*Math.PI/180,dLat=rad(bLat-aLat),dLon=rad(bLon-aLon),aa=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(aa)); }
function crewDiscovery(postal,viewer){
  const q=String(postal||'').trim().toUpperCase();
  let rows=db.prepare("SELECT * FROM maker_crews WHERE status='Active' AND (visibility='Public' OR ?<>'') ORDER BY name").all(viewer?.id||'');
  const origin=q?db.prepare('SELECT latitude,longitude FROM maker_crew_postal_codes WHERE postal_code=? AND latitude IS NOT NULL AND longitude IS NOT NULL LIMIT 1').get(q):null;
  return rows.map(c=>{const r=crewRow(c,viewer);const exact=r.coverage.some(z=>z.postal_code===q);let distance=null;if(origin){const anchor=r.coverage.find(z=>z.is_anchor&&z.latitude!=null)||r.coverage.find(z=>z.latitude!=null);if(anchor)distance=Math.round(haversineMiles(origin.latitude,origin.longitude,anchor.latitude,anchor.longitude)*10)/10;}return {...r,exactPostalMatch:exact,distanceMiles:distance};}).sort((a,b)=>Number(b.exactPostalMatch)-Number(a.exactPostalMatch)+(a.distanceMiles??99999)-(b.distanceMiles??99999)||a.name.localeCompare(b.name));
}
function crewPayload(c,viewer){
  if(!canSeeCrew(c,viewer))return null;
  const base=crewRow(c,viewer), ids=crewMemberIds(c.id), uid=viewer?.id||'';
  const members=db.prepare(`SELECT m.*,u.display_name,u.avatar_seed,u.bio,u.city_region,u.skills,u.can_help,u.want_learn,u.profile_visibility,u.location_visibility,u.tool_cabinet_visibility FROM maker_crew_members m JOIN users u ON u.id=m.user_id WHERE m.crew_id=? AND m.status='Active' ORDER BY CASE m.role WHEN 'Organizer' THEN 0 WHEN 'Moderator' THEN 1 ELSE 2 END,u.display_name`).all(c.id).filter(m=>canSeeCrewMember(m,viewer)&&(m.profile_visibility==='Public'||(m.profile_visibility==='Members'&&viewer)||viewer?.id===m.user_id)).map(m=>({...m,skills:json(m.skills),canHelp:json(m.can_help),wantLearn:json(m.want_learn),city_region:(m.location_visibility==='Public'||(m.location_visibility==='Members'&&viewer)||viewer?.id===m.user_id)?m.city_region:''}));
  const projects=db.prepare(projectSelect(uid)+` WHERE p.crew_id=? AND (p.visibility='Public' OR (p.visibility='Members' AND ?<>'') OR p.owner_id=? OR EXISTS(SELECT 1 FROM project_collaborators pc WHERE pc.project_id=p.id AND pc.user_id=?)) ORDER BY p.updated_at DESC LIMIT 18`).all(uid,c.id,uid,uid,uid).map(projectRow);
  const questions=db.prepare(`SELECT q.*,u.display_name author,(SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) answer_count FROM questions q JOIN users u ON u.id=q.user_id WHERE q.crew_id=? ORDER BY q.updated_at DESC LIMIT 12`).all(c.id);
  const scrap=db.prepare(`SELECT s.*,u.display_name owner FROM scrap_listings s JOIN users u ON u.id=s.user_id WHERE s.crew_id=? AND s.status='Available' ORDER BY s.updated_at DESC LIMIT 12`).all(c.id);
  const tools=db.prepare(`SELECT t.*,u.display_name owner FROM tool_cabinet_items t JOIN users u ON u.id=t.user_id JOIN maker_crew_members m ON m.user_id=u.id AND m.crew_id=? AND m.status='Active' WHERE t.local_availability IN ('Occasionally','By arrangement') AND (u.tool_cabinet_visibility='Public' OR (u.tool_cabinet_visibility='Members' AND ?<>'') OR u.id=?) ORDER BY t.category,t.model LIMIT 20`).all(c.id,uid,uid);
  const events=db.prepare(`SELECT e.*,u.display_name organizer,(SELECT COUNT(*) FROM maker_crew_event_attendance a WHERE a.event_id=e.id AND a.status IN ('Going','Attended')) attendee_count FROM maker_crew_events e JOIN users u ON u.id=e.created_by WHERE e.crew_id=? AND e.status<>'Cancelled' AND (e.visibility='Public' OR ?<>'') ORDER BY e.starts_at DESC LIMIT 20`).all(c.id,uid).map(e=>{const a=viewer?db.prepare('SELECT * FROM maker_crew_event_attendance WHERE event_id=? AND user_id=?').get(e.id,viewer.id):null;const showAddress=e.address_visibility==='Public'||isCrewOrganizer(c.id,viewer)||(a&&Number(a.approved)===1);return {...e,exact_address:showAddress?e.exact_address:'',myAttendance:a||null};});
  const announcements=db.prepare(`SELECT a.*,u.display_name author FROM maker_crew_announcements a JOIN users u ON u.id=a.created_by WHERE a.crew_id=? AND (a.visibility='Public' OR ?<>'') ORDER BY a.created_at DESC LIMIT 8`).all(c.id,uid);
  const bulletin=db.prepare(`SELECT b.*,u.display_name author FROM maker_crew_bulletin_posts b JOIN users u ON u.id=b.user_id WHERE b.crew_id=? AND b.status='Active' AND (b.expires_at='' OR b.expires_at>?) ORDER BY b.created_at DESC LIMIT 20`).all(c.id,now());
  const sessions=db.prepare(`SELECT s.*,u.display_name host FROM workshop_sessions s JOIN users u ON u.id=s.host_id WHERE s.crew_id=? AND s.status<>'Draft' AND (s.visibility='Public' OR ?<>'') ORDER BY s.starts_at DESC`).all(c.id,uid).map(r=>workshopSessionRow(r,uid));
  const handbook=db.prepare(`SELECT h.*,u.display_name author FROM maker_crew_handbook_entries h JOIN users u ON u.id=h.created_by WHERE h.crew_id=? AND h.status='Published' AND (h.visibility='Public' OR ?<>'') ORDER BY h.category,h.updated_at DESC`).all(c.id,uid);
  const localNeeds=bulletin.filter(b=>['Need a Hand','Need a Tool','Have Material','Looking for Knowledge','Project Needs a Home'].includes(b.post_type));
  return {...base,members,projects,questions,scrap,tools,events,announcements,bulletin,localNeeds,handbook,sessions,canOrganize:isCrewOrganizer(c.id,viewer)};
}


function privateIp(address){
  if(!address)return true;
  if(net.isIPv4(address)){const p=address.split('.').map(Number);return p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127);}
  if(net.isIPv6(address)){const a=address.toLowerCase();return a==='::1'||a==='::'||a.startsWith('fc')||a.startsWith('fd')||a.startsWith('fe8')||a.startsWith('fe9')||a.startsWith('fea')||a.startsWith('feb');}
  return true;
}
async function validateRemoteImageUrl(raw){
  let u;try{u=new URL(String(raw||''));}catch{return null}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;
  const host=u.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.local'))return null;
  try{const rows=await dns.lookup(host,{all:true,verbatim:true});if(!rows.length||rows.some(x=>privateIp(x.address)))return null;}catch{return null}
  return u;
}
async function proxyImage(res,raw){
  let current=await validateRemoteImageUrl(raw);if(!current)return sendText(res,400,'Remote image URL is not allowed.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    for(let hop=0;hop<4;hop++){
      const r=await fetch(current,{redirect:'manual',signal:controller.signal,headers:{'User-Agent':`THE-WORKSHOP/${APP_VERSION} image proxy`,'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'}});
      if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)return sendText(res,502,'Remote image redirect was incomplete.');current=await validateRemoteImageUrl(new URL(loc,current).href);if(!current)return sendText(res,403,'Remote image redirect was blocked.');continue;}
      if(!r.ok)return sendText(res,502,`Remote image returned ${r.status}.`);
      const type=String(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();if(!type.startsWith('image/'))return sendText(res,415,'Remote URL did not return an image.');
      const announced=Number(r.headers.get('content-length')||0);if(announced>12*1024*1024)return sendText(res,413,'Remote image is too large.');
      const buf=Buffer.from(await r.arrayBuffer());if(buf.length>12*1024*1024)return sendText(res,413,'Remote image is too large.');
      res.writeHead(200,{'Content-Type':type,'Content-Length':buf.length,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(buf);
    }
    return sendText(res,508,'Too many remote image redirects.');
  }catch(e){return sendText(res,502,e?.name==='AbortError'?'Remote image timed out.':'Remote image could not be loaded.');}finally{clearTimeout(timer)}
}

function routeApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;
  const me = currentUser(req);

  if (pathname === '/api/image-proxy' && method === 'GET') return proxyImage(res,url.searchParams.get('url')||'');
  if(pathname==='/api/version-diagnostics'&&method==='GET')return sendJson(res,200,{serverVersion:APP_VERSION,schemaVersion:db.prepare('SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1').get()?.version||'',time:now()});
  if (pathname === '/api/meta' && method === 'GET') return sendJson(res, 200, { name:'THE WORKSHOP', version:APP_VERSION, mode:DEV_AUTH?'development':'production', backend:'Node + SQLite', nativeUploads:true, passwordAuth:true, moderationConsole:true, productionHardening:true,designCritique:true,liveEvents:true,toolCabinet:true,collaborativeProjects:true,fieldInstrumentLab:false,theWall:true,questionOfTheWeek:true,whatIsThis:true,teardownClub:true,scrapBin:true,richFileVersioning:true,githubIntegration:true,offlinePwa:true,supporterMembership:true,workshopSessions:true,assignments:true,showTheWork:true,walkTheBenches:true,makerId:true,sessionStudio:true,makerCrews:true,crewDiscovery:true,crewMeetups:true,crewBulletin:true,accountManagement:true,adminPasswordReset:true,transactionalEmail:true,remoteImageProxy:true,gearheadCrew:true,gearheadContent:true,gearheadStudio:true,gearheadProtectedFiles:true,gearheadTutorials:true,gearheadEarlyAccess:true,gearheadAfterHours:true,gearheadFileVault:true,gearheadRequests:true,gearheadEarlyFeedback:true,gearheadAfterHoursRsvp:true,gearheadMembershipLifecycle:true,gearheadArchive:true,gearheadPreviews:true,gearheadReleasePipeline:true,gearheadDigest:true,gearheadContributions:true,gearheadCrewProjects:true,gearheadStudio2:true,gearheadSecurityHardening:true,stripeGearheadMembership:true,gearheadMembershipSelfService:true,gearheadVideoPipeline:true,gearheadTemplates:true,craftPath:true,benchEmbeds:true,makerCrew2:true,failureLibrary:true,personalNotebook:true,workshopMap:true,projectLabels:true,workshopPrompts:true,communityBuildAggregate:true,helpAggregate:true,calendarAggregate:true,icsExport:true,mediaLibrary:true,memberMuteBlock:true,projectPrivacyHardened:true,browserQa:true,membershipProvider:MEMBERSHIP_PROVIDER,emailProvider:EMAIL_PROVIDER,emailConfigured:emailConfigured(),termsVersion:TERMS_VERSION });
  if (pathname === '/api/me' && method === 'GET') return sendJson(res, 200, { user:safeUser(me) });

  // v9.0 — consolidated product endpoints.
  if(pathname==='/api/community-builds' && method==='GET'){
    const items=[];
    for(const x of db.prepare(`SELECT w.*,u.display_name author,(SELECT COUNT(*) FROM workshop_prompt_projects p WHERE p.prompt_id=w.id) project_count FROM workshop_prompts w JOIN users u ON u.id=w.created_by ORDER BY w.updated_at DESC`).all())if(canAccessLevel(x.visibility||'Public',me,x.created_by))items.push({id:x.id,type:'PROMPT',status:x.status||'Open',title:x.title,summary:x.brief||'',meta:`${x.project_count||0} interpretations`,startsAt:x.starts_at||'',endsAt:x.ends_at||'',visibility:canonicalVisibility(x.visibility,'Public'),href:`#/prompt/${x.id}`});
    for(const x of db.prepare(`SELECT * FROM build_alongs ORDER BY created_at DESC`).all())items.push({id:x.id,type:'BUILD ALONG',status:x.status||'Active',title:x.title,summary:x.overview||'',meta:[x.difficulty,x.expected_time].filter(Boolean).join(' · '),startsAt:x.starts_at||'',endsAt:x.ends_at||'',visibility:'Public',href:`#/build-along/${x.id}`});
    for(const x of db.prepare(`SELECT * FROM open_briefs ORDER BY created_at DESC`).all())items.push({id:x.id,type:'OPEN BRIEF',status:x.status||'Open',title:x.title,summary:x.objective||'',meta:x.time_window||'',startsAt:x.starts_at||'',endsAt:x.ends_at||'',visibility:'Public',href:`#/open-brief/${x.id}`});
    for(const x of db.prepare(`SELECT s.*,u.display_name host FROM workshop_sessions s JOIN users u ON u.id=s.host_id WHERE s.status<>'Draft' ORDER BY s.starts_at DESC`).all())if(canSeeSession(x,me))items.push({id:x.id,type:'SESSION',status:x.status||'Upcoming',title:x.title,summary:x.theme||x.description||'',meta:x.host||'',startsAt:x.starts_at||'',endsAt:x.ends_at||'',visibility:canonicalVisibility(x.visibility,'Public'),href:`#/session/${x.id}`});
    for(const x of db.prepare(`SELECT t.*,u.display_name curator,(SELECT COUNT(*) FROM teardown_contributions c WHERE c.teardown_id=t.id) contribution_count FROM teardown_clubs t JOIN users u ON u.id=t.curator_id ORDER BY t.updated_at DESC`).all())if(canAccessLevel(x.visibility||'Public',me,x.curator_id))items.push({id:x.id,type:'TEARDOWN',status:x.status||'Active',title:x.title,summary:x.overview||'',meta:`${x.contribution_count||0} contributions`,startsAt:x.starts_at||'',endsAt:x.ends_at||'',visibility:canonicalVisibility(x.visibility,'Public'),href:`#/teardown/${x.id}`});
    for(const x of db.prepare(`SELECT q.*,u.display_name author,(SELECT COUNT(*) FROM weekly_question_responses r WHERE r.question_id=q.id) response_count FROM weekly_questions q JOIN users u ON u.id=q.created_by WHERE q.status<>'Draft' ORDER BY q.updated_at DESC`).all())if(canAccessLevel(x.visibility||'Public',me,x.created_by))items.push({id:x.id,type:'WEEKLY PROMPT',status:'Open',title:x.prompt,summary:'One good question from the shop.',meta:`${x.response_count||0} responses`,startsAt:x.starts_at||'',endsAt:x.ends_at||'',visibility:canonicalVisibility(x.visibility,'Public'),href:`#/weekly/${x.id}`});
    items.sort((a,b)=>{const rank=x=>['Active','Open','Live'].includes(x.status)?0:x.status==='Upcoming'?1:2;return rank(a)-rank(b)||String(b.startsAt||'').localeCompare(String(a.startsAt||''));});
    return sendJson(res,200,{items,canEdit:canEditEditorial(me),types:[...new Set(items.map(x=>x.type))]});
  }

  if(pathname==='/api/help' && method==='GET'){
    const items=[];
    for(const q of db.prepare(`SELECT q.*,u.display_name author,(SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) response_count FROM questions q JOIN users u ON u.id=q.user_id ORDER BY q.updated_at DESC`).all())if(visibleAuthor(me,q.user_id)&&(!q.project_id||canViewLinkedProject(q.project_id,me)))items.push({id:q.id,type:'TROUBLESHOOTING',status:q.status,title:q.title,summary:q.help_needed||q.trying,author:q.author,responseCount:q.response_count||0,updatedAt:q.updated_at,href:`#/question/${q.id}`});
    for(const c of db.prepare(`SELECT c.*,p.title project_title,p.visibility project_visibility,p.owner_id,u.display_name author,(SELECT COUNT(*) FROM critique_responses r WHERE r.critique_id=c.id) response_count FROM critiques c JOIN projects p ON p.id=c.project_id JOIN users u ON u.id=c.user_id ORDER BY c.updated_at DESC`).all())if(visibleAuthor(me,c.user_id)&&canViewProject({id:c.project_id,visibility:c.project_visibility,owner_id:c.owner_id},me))items.push({id:c.id,type:'DESIGN CRITIQUE',status:c.status,title:c.project_title,summary:c.prompt,author:c.author,responseCount:c.response_count||0,updatedAt:c.updated_at,href:`#/critique/${c.id}`});
    for(const m of db.prepare(`SELECT m.*,u.display_name author,(SELECT COUNT(*) FROM mystery_proposals p WHERE p.mystery_id=m.id) response_count FROM mystery_items m JOIN users u ON u.id=m.user_id ORDER BY m.updated_at DESC`).all())if(visibleAuthor(me,m.user_id))items.push({id:m.id,type:'IDENTIFICATION',status:m.status,title:m.title,summary:m.notes||m.markings||m.source_context||'',author:m.author,responseCount:m.response_count||0,updatedAt:m.updated_at,href:`#/mystery/${m.id}`});
    items.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return sendJson(res,200,{items});
  }

  if(pathname==='/api/calendar' && method==='GET'){
    const items=[];
    for(const e of db.prepare(`SELECT e.*,u.display_name host FROM live_events e JOIN users u ON u.id=e.created_by WHERE e.status<>'Archived' ORDER BY e.starts_at`).all())if(canAccessLevel(e.visibility||'Public',me,e.created_by)&&(!e.project_id||canViewLinkedProject(e.project_id,me)))items.push({id:e.id,type:e.event_type||'LIVE',title:e.title,description:e.description||'',startsAt:e.starts_at||'',endsAt:e.ends_at||'',status:e.status,location:'Online / stream',href:`#/live/${e.id}`,source:'live'});
    for(const ss of db.prepare(`SELECT s.*,u.display_name host FROM workshop_sessions s JOIN users u ON u.id=s.host_id WHERE s.status IN ('Active','Upcoming') ORDER BY s.starts_at`).all())if(canSeeSession(ss,me))items.push({id:ss.id,type:'COMMUNITY BUILD SESSION',title:ss.title,description:ss.theme||ss.description||'',startsAt:ss.starts_at||'',endsAt:ss.ends_at||'',status:ss.status,location:ss.crew_id?'Maker Crew':'Workshop',href:`#/session/${ss.id}`,source:'session'});
    const crewIds=me?db.prepare(`SELECT crew_id FROM maker_crew_members WHERE user_id=? AND status='Active'`).all(me.id).map(x=>x.crew_id):[];
    for(const e of db.prepare(`SELECT e.*,c.code,c.name crew_name FROM maker_crew_events e JOIN maker_crews c ON c.id=e.crew_id WHERE e.status<>'Cancelled' ORDER BY e.starts_at`).all())if(e.visibility==='Public'||crewIds.includes(e.crew_id)||isCrewOrganizer(e.crew_id,me))items.push({id:e.id,type:`MAKER CREW · ${e.event_type||'MEETUP'}`,title:e.title,description:e.description||'',startsAt:e.starts_at||'',endsAt:e.ends_at||'',status:e.status||'Scheduled',location:e.venue_name||e.city_region||e.code,href:`#/crew/${e.crew_id}/meetups`,source:'crew'});
    items.sort((a,b)=>String(a.startsAt||'9999').localeCompare(String(b.startsAt||'9999')));
    return sendJson(res,200,{items,timezone:'local',canEdit:canEditEditorial(me)});
  }

  if(pathname==='/api/calendar.ics' && method==='GET'){
    const items=[];
    for(const e of db.prepare(`SELECT e.* FROM live_events e WHERE e.status<>'Archived' ORDER BY e.starts_at`).all())if(canAccessLevel(e.visibility||'Public',me,e.created_by)&&(!e.project_id||canViewLinkedProject(e.project_id,me)))items.push({id:e.id,title:e.title,description:e.description||'',startsAt:e.starts_at,endsAt:e.ends_at});
    for(const x of db.prepare(`SELECT * FROM workshop_sessions WHERE status IN ('Active','Upcoming') ORDER BY starts_at`).all())if(canSeeSession(x,me))items.push({id:x.id,title:x.title,description:x.theme||x.description||'',startsAt:x.starts_at,endsAt:x.ends_at});
    const icsDate=v=>String(v||'').replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z').replace(/\+.*$/,'').replace(/T(\d{6})$/,'T$1Z');
    const escIcs=v=>String(v||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Green Shoe Garage//THE WORKSHOP//EN','CALSCALE:GREGORIAN'];
    for(const x of items){lines.push('BEGIN:VEVENT',`UID:${escIcs(x.id)}@workshop.greenshoegarage.com`,`DTSTAMP:${icsDate(now())}`,`DTSTART:${icsDate(x.startsAt)}`,x.endsAt?`DTEND:${icsDate(x.endsAt)}`:'',`SUMMARY:${escIcs(x.title)}`,`DESCRIPTION:${escIcs(x.description)}`,'END:VEVENT')}
    lines.push('END:VCALENDAR');const body=lines.filter(Boolean).join('\r\n');res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="the-workshop-calendar.ics"','Cache-Control':'private, no-store'});return res.end(body);
  }

  if(pathname==='/api/media' && method==='GET'){
    const u=requireUser(req,res);if(!u)return;const rows=db.prepare(`SELECT * FROM media_assets WHERE user_id=? ORDER BY created_at DESC LIMIT 100`).all(u.id).map(x=>({...x,url:`/media/${encodeURIComponent(x.stored_name)}`}));return sendJson(res,200,{items:rows});
  }
  if(pathname==='/api/media' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;const mime=String(req.headers['content-type']||'application/octet-stream'),original=decodeURIComponent(String(req.headers['x-file-name']||'media.bin')),alt=decodeURIComponent(String(req.headers['x-alt-text']||'')),caption=decodeURIComponent(String(req.headers['x-caption']||'')),visibility=canonicalVisibility(decodeURIComponent(String(req.headers['x-visibility']||'Public')),'Public');
    if(!/^(image|video|audio)\//.test(mime))return sendJson(res,415,{error:'Upload an image, video, or audio file.'});return readRawBody(req,25_000_000).then(buf=>{if(!buf.length)return sendJson(res,400,{error:'Choose media first.'});const mid=id('media'),stored=`${mid}-${safeFilename(original)}`,ts=now();fs.writeFileSync(path.join(UPLOADS,stored),buf);db.prepare(`INSERT INTO media_assets (id,user_id,stored_name,original_name,mime_type,size_bytes,alt_text,caption,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(mid,u.id,stored,original,mime,buf.length,alt,caption,visibility,ts);return sendJson(res,201,{id:mid,url:`/media/${encodeURIComponent(stored)}`,mimeType:mime,altText:alt,caption,visibility});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const mediaItem=pathname.match(/^\/api\/media\/([^/]+)$/);
  if(mediaItem&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;const m=db.prepare('SELECT * FROM media_assets WHERE id=?').get(mediaItem[1]);if(!m)return sendJson(res,404,{error:'Media not found.'});if(m.user_id!==u.id&&!hasRole(u,['Owner','Administrator']))return sendJson(res,403,{error:'You cannot remove this media.'});db.prepare('DELETE FROM media_assets WHERE id=?').run(m.id);try{fs.unlinkSync(path.join(UPLOADS,m.stored_name))}catch{}return sendJson(res,200,{ok:true});}

  if(pathname==='/api/blocks' && method==='GET'){const u=requireUser(req,res);if(!u)return;const rows=db.prepare(`SELECT b.*,x.display_name FROM user_blocks b JOIN users x ON x.id=b.blocked_user_id WHERE b.user_id=? ORDER BY b.created_at DESC`).all(u.id);return sendJson(res,200,{items:rows});}
  const blockItem=pathname.match(/^\/api\/blocks\/([^/]+)$/);
  if(blockItem&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const target=blockItem[1];if(target===u.id)return sendJson(res,400,{error:'You cannot mute or block yourself.'});if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(target))return sendJson(res,404,{error:'Member not found.'});const kind=String(body.kind||'Block')==='Mute'?'Mute':'Block';db.prepare(`INSERT INTO user_blocks (user_id,blocked_user_id,kind,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,blocked_user_id,kind) DO NOTHING`).run(u.id,target,kind,now());return sendJson(res,201,{ok:true,kind});});
  if(blockItem&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;db.prepare('DELETE FROM user_blocks WHERE user_id=? AND blocked_user_id=?').run(u.id,blockItem[1]);return sendJson(res,200,{ok:true});}

  // v8.0 — private notebook
  if(pathname==='/api/notebook' && method==='GET'){
    const u=requireUser(req,res);if(!u)return;
    const items=db.prepare(`SELECT n.*,p.title project_title FROM personal_notebook_entries n LEFT JOIN projects p ON p.id=n.project_id WHERE n.user_id=? AND n.status<>'Deleted' ORDER BY n.updated_at DESC`).all(u.id).map(x=>({...x,tags:json(x.tags)}));
    return sendJson(res,200,{items});
  }
  if(pathname==='/api/notebook' && method==='POST')return readBody(req).then(body=>{
    const u=requireUser(req,res);if(!u)return;const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Give the notebook entry a title.'});
    const nid=id('note'),ts=now();db.prepare(`INSERT INTO personal_notebook_entries (id,user_id,entry_type,title,body,tags,project_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(nid,u.id,String(body.entryType||'Idea'),title,String(body.body||''),JSON.stringify(parseList(body.tags)),body.projectId||null,'Active',ts,ts);return sendJson(res,201,{id:nid});
  });
  const notebookMatch=pathname.match(/^\/api\/notebook\/([^/]+)$/);
  if(notebookMatch&&method==='PUT')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const row=db.prepare('SELECT * FROM personal_notebook_entries WHERE id=? AND user_id=?').get(notebookMatch[1],u.id);if(!row)return sendJson(res,404,{error:'Notebook entry not found.'});db.prepare(`UPDATE personal_notebook_entries SET entry_type=?,title=?,body=?,tags=?,project_id=?,updated_at=? WHERE id=?`).run(String(body.entryType||row.entry_type),String(body.title||row.title),String(body.body??row.body),JSON.stringify(body.tags!==undefined?parseList(body.tags):json(row.tags)),body.projectId!==undefined?(body.projectId||null):row.project_id,now(),row.id);return sendJson(res,200,{ok:true});});
  if(notebookMatch&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;db.prepare("UPDATE personal_notebook_entries SET status='Deleted',updated_at=? WHERE id=? AND user_id=?").run(now(),notebookMatch[1],u.id);return sendJson(res,200,{ok:true});}
  const notebookStart=pathname.match(/^\/api\/notebook\/([^/]+)\/start-project$/);
  if(notebookStart&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const n=db.prepare('SELECT * FROM personal_notebook_entries WHERE id=? AND user_id=?').get(notebookStart[1],u.id);if(!n)return sendJson(res,404,{error:'Notebook entry not found.'});if(n.project_id)return sendJson(res,200,{projectId:n.project_id,existing:true});const pid=id('p'),ts=now(),title=String(body.title||n.title).trim();db.prepare(`INSERT INTO projects (id,owner_id,title,slug,description,stage,status,disciplines,tags,cover_emoji,visibility,license,estimated_cost,difficulty,tools,parent_type,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid,u.id,title,slugify(title),String(n.body||''),'Idea','Active','[]',JSON.stringify([...new Set(['notebook',...json(n.tags)])]),'✎','Members','Unspecified','','Approachable','[]','Notebook',n.id,ts,ts);db.prepare('UPDATE personal_notebook_entries SET project_id=?,updated_at=? WHERE id=?').run(pid,ts,n.id);db.prepare(`INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id('l'),pid,u.id,'Idea','From my Workshop Notebook',String(n.body||n.title),ts,ts);return sendJson(res,201,{projectId:pid});});

  // v8.0 — Failure Library
  if(pathname==='/api/failures' && method==='GET'){
    const uid=me?.id||'';const rows=db.prepare(`SELECT f.*,u.display_name author,p.title project_title FROM failure_records f JOIN users u ON u.id=f.user_id LEFT JOIN projects p ON p.id=f.project_id WHERE f.visibility='Public' OR (?<>'' AND (f.visibility='Members' OR f.user_id=?)) ORDER BY f.updated_at DESC`).all(uid,uid);return sendJson(res,200,{items:rows});
  }
  if(pathname==='/api/failures' && method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const title=String(body.title||'').trim(),observed=String(body.observed||'').trim();if(!title||!observed)return sendJson(res,400,{error:'Failure title and what you observed are required.'});const fid=id('fail'),ts=now();db.prepare(`INSERT INTO failure_records (id,user_id,project_id,crew_id,title,failure_type,observed,expected,cause,evidence,fix,lesson,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(fid,u.id,body.projectId||null,String(body.crewId||''),title,String(body.failureType||'Other'),observed,String(body.expected||''),String(body.cause||''),String(body.evidence||''),String(body.fix||''),String(body.lesson||''),canonicalVisibility(body.visibility,'Members'),ts,ts);if(body.projectId){try{db.prepare(`INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id('l'),body.projectId,u.id,'Failure',title,`${observed}${body.lesson?`\n\nLesson: ${body.lesson}`:''}`,ts,ts)}catch{}}return sendJson(res,201,{id:fid});});
  const failureMatch=pathname.match(/^\/api\/failures\/([^/]+)$/);if(failureMatch&&method==='GET'){const f=db.prepare(`SELECT f.*,u.display_name author,p.title project_title FROM failure_records f JOIN users u ON u.id=f.user_id LEFT JOIN projects p ON p.id=f.project_id WHERE f.id=?`).get(failureMatch[1]);if(!f)return sendJson(res,404,{error:'Failure record not found.'});if(f.visibility!=='Public'&&!me)return sendJson(res,403,{error:'Members only.'});return sendJson(res,200,{item:f});}

  // v8.0 — Workshop Prompts: shared making without winners
  if(pathname==='/api/prompts'&&method==='GET'){const uid=me?.id||'';const rows=db.prepare(`SELECT w.*,u.display_name author,(SELECT COUNT(*) FROM workshop_prompt_projects x WHERE x.prompt_id=w.id) project_count FROM workshop_prompts w JOIN users u ON u.id=w.created_by WHERE w.visibility='Public' OR ?<>'' ORDER BY CASE w.status WHEN 'Open' THEN 0 WHEN 'Upcoming' THEN 1 ELSE 2 END,w.updated_at DESC`).all(uid).map(x=>({...x,constraints:json(x.constraints),optionalConstraints:json(x.optional_constraints)}));return sendJson(res,200,{items:rows,canEdit:canEditEditorial(me)});}
  if(pathname==='/api/prompts'&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const title=String(body.title||'').trim(),brief=String(body.brief||'').trim();if(!title||!brief)return sendJson(res,400,{error:'Prompt title and brief are required.'});const pid=id('prompt'),ts=now();db.prepare(`INSERT INTO workshop_prompts (id,created_by,title,brief,constraints,optional_constraints,inspiration,status,starts_at,ends_at,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid,u.id,title,brief,JSON.stringify(parseList(body.constraints)),JSON.stringify(parseList(body.optionalConstraints)),String(body.inspiration||''),String(body.status||'Open'),String(body.startsAt||''),String(body.endsAt||''),canonicalVisibility(body.visibility,'Public'),ts,ts);return sendJson(res,201,{id:pid});});
  const promptMatch=pathname.match(/^\/api\/prompts\/([^/]+)$/);if(promptMatch&&method==='GET'){const p=db.prepare(`SELECT w.*,u.display_name author FROM workshop_prompts w JOIN users u ON u.id=w.created_by WHERE w.id=?`).get(promptMatch[1]);if(!p||!canAccessLevel(p.visibility||'Public',me,p.created_by))return sendJson(res,404,{error:'Prompt not found.'});const projects=db.prepare(projectSelect(me?.id||'')+` JOIN workshop_prompt_projects x ON x.project_id=p.id WHERE x.prompt_id=? ORDER BY p.updated_at DESC`).all(me?.id||'',p.id).map(projectRow);const mine=me?db.prepare('SELECT project_id FROM workshop_prompt_projects WHERE prompt_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1').get(p.id,me.id):null;return sendJson(res,200,{item:{...p,constraints:json(p.constraints),optionalConstraints:json(p.optional_constraints)},projects,myProjectId:mine?.project_id||''});}
  const promptStart=pathname.match(/^\/api\/prompts\/([^/]+)\/start$/);if(promptStart&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const p=db.prepare('SELECT * FROM workshop_prompts WHERE id=?').get(promptStart[1]);if(!p||p.status!=='Open')return sendJson(res,404,{error:'That prompt is not open.'});const existing=db.prepare('SELECT project_id FROM workshop_prompt_projects WHERE prompt_id=? AND user_id=?').get(p.id,u.id);if(existing)return sendJson(res,200,{projectId:existing.project_id,existing:true});const pid=id('p'),ts=now(),title=String(body.title||p.title).trim();db.prepare(`INSERT INTO projects (id,owner_id,title,slug,description,stage,status,disciplines,tags,cover_emoji,visibility,license,estimated_cost,difficulty,tools,parent_type,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid,u.id,title,slugify(title),String(p.brief),'Idea','Active','[]',JSON.stringify(['Workshop Prompt']),'◇','Members','Unspecified','','Approachable','[]','Prompt',p.id,ts,ts);db.prepare('INSERT INTO workshop_prompt_projects (prompt_id,project_id,user_id,created_at) VALUES (?,?,?,?)').run(p.id,pid,u.id,ts);return sendJson(res,201,{projectId:pid});});

  // v8.0 — public Workshop Map; exact member locations are never returned
  if(pathname==='/api/workshop-map'&&method==='GET'){
    const crews=db.prepare(`SELECT c.id,c.code,c.name,c.city_region,c.anchor_postal_code,z.latitude,z.longitude FROM maker_crews c LEFT JOIN maker_crew_postal_codes z ON z.crew_id=c.id AND z.is_anchor=1 WHERE c.status='Active' AND c.visibility='Public' AND z.latitude IS NOT NULL AND z.longitude IS NOT NULL ORDER BY c.name`).all();
    const events=db.prepare(`SELECT e.id,e.crew_id,e.title,e.event_type,e.starts_at,e.venue_name,e.city_region,c.code,c.name crew_name,z.latitude,z.longitude FROM maker_crew_events e JOIN maker_crews c ON c.id=e.crew_id LEFT JOIN maker_crew_postal_codes z ON z.crew_id=c.id AND z.is_anchor=1 WHERE e.status<>'Cancelled' AND e.visibility='Public' AND z.latitude IS NOT NULL AND z.longitude IS NOT NULL ORDER BY e.starts_at ASC LIMIT 100`).all();
    return sendJson(res,200,{crews,events,privacy:'Pins use Crew anchor ZIP centroids, never member home locations or private meetup addresses.'});
  }

  // v8.0 — Maker Crew handbook
  const crewHandbook=pathname.match(/^\/api\/crews\/([^/]+)\/handbook$/);if(crewHandbook&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!crewRole(crewHandbook[1],u.id))return sendJson(res,403,{error:'Join the Crew to add local knowledge.'});const title=String(body.title||'').trim(),text=String(body.body||'').trim();if(!title||!text)return sendJson(res,400,{error:'Title and local knowledge are required.'});const hid=id('hand'),ts=now();db.prepare(`INSERT INTO maker_crew_handbook_entries (id,crew_id,created_by,category,title,body,url,visibility,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(hid,crewHandbook[1],u.id,String(body.category||'Local Knowledge'),title,text,String(body.url||''),canonicalVisibility(body.visibility,'Members'),'Published',ts,ts);return sendJson(res,201,{id:hid});});

  // v8.0 — printable project labels. QR is offered only for Public projects because it uses a public QR image endpoint.
  const projectLabel=pathname.match(/^\/api\/projects\/([^/]+)\/label$/);if(projectLabel&&method==='GET'){
    const uid=me?.id||'',row=db.prepare(projectSelect(uid)+' WHERE p.id=?').get(uid,projectLabel[1]);if(!row)return sendJson(res,404,{error:'Project not found.'});const p=projectRow(row),owner=me&&me.id===p.ownerId;if(p.visibility!=='Public'&&!owner)return sendJson(res,403,{error:'That project label is not available.'});const base=PUBLIC_URL||`http://${req.headers.host}`,projectUrl=`${base}/#/projects/${encodeURIComponent(p.id)}`;return sendJson(res,200,{project:{id:p.id,title:p.title,owner:p.owner,stage:p.stage,updatedAt:p.updatedAt,visibility:p.visibility},projectUrl,qrUrl:p.visibility==='Public'?`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(projectUrl)}`:'',qrPrivacy:p.visibility==='Public'?'The QR contains only the already-public project URL.':'QR is disabled for non-public projects.'});
  }

  if (pathname === '/api/auth/register' && method === 'POST') return readBody(req).then(body=>{
    const email=String(body.email||'').trim().toLowerCase(),display=String(body.displayName||'').trim(),password=String(body.password||''),age18=body.age18==='yes'||body.age18===true,terms=body.terms==='yes'||body.terms===true;
    if(!email.includes('@')||!display||password.length<10)return sendJson(res,400,{error:'Use a valid email, display name, and a password of at least 10 characters.'});
    if(!age18)return sendJson(res,400,{error:'You must confirm that you are 18 years of age or older to create an account.'});
    if(!terms)return sendJson(res,400,{error:'You must agree to the Terms & Community Conduct to create an account.'});
    if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email))return sendJson(res,409,{error:'That email already has an account.'});
    const uid=id('u'),created=now(); db.prepare(`INSERT INTO users (id,email,display_name,bio,city_region,role,avatar_seed,created_at,password_hash,email_verified,account_status,age_18_confirmed_at,terms_version_accepted,terms_accepted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid,email,display,'','','Member',display.slice(0,2).toUpperCase(),created,passwordHash(password),0,'Active',created,TERMS_VERSION,created);
    audit(uid,'account.terms.accept','user',uid,{termsVersion:TERMS_VERSION,source:'signup'});
    const token=issueAuthToken(uid,'verify',1440); return sendJson(res,201,{ok:true,devVerifyToken:DEV_AUTH?token:undefined,message:'Account created. Verify your email before using recovery features.'});
  }).catch(e=>sendJson(res,400,{error:e.message}));
  if (pathname === '/api/auth/login' && method === 'POST') return readBody(req).then(body=>{
    const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''); const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!user||!passwordOk(password,user.password_hash))return sendJson(res,401,{error:'Email or password was not recognized.'});
    if(user.account_status!=='Active')return sendJson(res,403,{error:'This account is not active.'});
    return sendJson(res,200,{user:safeUser(user)},newSession(res,user));
  }).catch(e=>sendJson(res,400,{error:e.message}));
  if (pathname === '/api/auth/dev-login' && method === 'POST') { if(!DEV_AUTH)return sendJson(res,404,{error:'Development sign-in is disabled.'}); return readBody(req).then(body=>{ const user=db.prepare('SELECT * FROM users WHERE id=?').get(String(body.userId||'u_mike'))||db.prepare('SELECT * FROM users ORDER BY created_at LIMIT 1').get(); return sendJson(res,200,{user:safeUser(user)},newSession(res,user)); }); }
  if (pathname === '/api/auth/verify' && method === 'POST') return readBody(req).then(body=>{const t=consumeAuthToken(String(body.token||''),'verify');if(!t)return sendJson(res,400,{error:'Verification link is invalid or expired.'});db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(t.user_id);return sendJson(res,200,{ok:true});});
  if (pathname === '/api/auth/forgot' && method === 'POST') return readBody(req).then(body=>{const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(body.email||'').trim().toLowerCase());const token=user?issueAuthToken(user.id,'reset',30):'';if(user&&token){const resetUrl=absoluteHash(`#/reset/${token}`);emailUser(user.id,'account_security','password_reset','Reset your THE WORKSHOP password',`A password reset was requested for your THE WORKSHOP account.\n\nReset password: ${resetUrl}\n\nThis one-time link expires in 30 minutes. If you did not request it, you can ignore this message.`);}return sendJson(res,200,{ok:true,devResetToken:DEV_AUTH?token||undefined:undefined,emailDeliveryConfigured:emailConfigured()});});
  if (pathname === '/api/auth/reset' && method === 'POST') return readBody(req).then(body=>{const password=String(body.password||'');if(password.length<10)return sendJson(res,400,{error:'Use at least 10 characters.'});const t=consumeAuthToken(String(body.token||''),'reset');if(!t)return sendJson(res,400,{error:'Reset link is invalid or expired.'});db.prepare('UPDATE users SET password_hash=?,force_password_reset=0 WHERE id=?').run(passwordHash(password),t.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.user_id);return sendJson(res,200,{ok:true});});
  if (pathname === '/api/auth/logout' && method === 'POST') { const token=parseCookies(req).workshop_session;if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(token);return sendJson(res,200,{ok:true},{'Set-Cookie':'workshop_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}); }
  if (pathname === '/api/account/terms' && method === 'POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!(body.accept==='yes'||body.accept===true))return sendJson(res,400,{error:'Terms acceptance is required.'});const accepted=now();db.prepare('UPDATE users SET terms_version_accepted=?,terms_accepted_at=? WHERE id=?').run(TERMS_VERSION,accepted,u.id);audit(u.id,'account.terms.accept','user',u.id,{termsVersion:TERMS_VERSION});return sendJson(res,200,{ok:true,termsVersion:TERMS_VERSION,user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))});}).catch(e=>sendJson(res,400,{error:e.message}));
  if (pathname === '/api/account/password' && method === 'PUT') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!passwordOk(String(body.currentPassword||''),u.password_hash))return sendJson(res,403,{error:'Current password is incorrect.'});const next=String(body.newPassword||''),confirm=String(body.confirmNewPassword||'');if(next.length<10)return sendJson(res,400,{error:'Use at least 10 characters.'});if(next!==confirm)return sendJson(res,400,{error:'New passwords do not match.'});db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(next),u.id);return sendJson(res,200,{ok:true});});
  if (pathname === '/api/account/forced-password' && method === 'PUT') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!u.force_password_reset)return sendJson(res,400,{error:'This account does not currently require a password reset.'});const next=String(body.newPassword||''),confirm=String(body.confirmNewPassword||'');if(next.length<10)return sendJson(res,400,{error:'Use at least 10 characters.'});if(next!==confirm)return sendJson(res,400,{error:'New passwords do not match.'});db.prepare('UPDATE users SET password_hash=?,force_password_reset=0 WHERE id=?').run(passwordHash(next),u.id);const token=parseCookies(req).workshop_session||'';db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(u.id,token);audit(u.id,'account.forced_password.complete','user',u.id,{});return sendJson(res,200,{ok:true,user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))});});
  if (pathname === '/api/account' && method === 'DELETE') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(String(body.confirm||'')!=='DELETE')return sendJson(res,400,{error:'Type DELETE to confirm account removal.'});const owned=db.prepare('SELECT id FROM projects WHERE owner_id=?').all(u.id).map(x=>x.id);if(owned.length){const fsrows=db.prepare(`SELECT stored_name FROM project_files WHERE project_id IN (${owned.map(()=>'?').join(',')})`).all(...owned);for(const f of fsrows){try{fs.unlinkSync(path.join(UPLOADS,f.stored_name))}catch{}}}db.exec('BEGIN');try{db.prepare('DELETE FROM maker_crew_event_attendance WHERE user_id=?').run(u.id);db.prepare('DELETE FROM maker_crew_bulletin_posts WHERE user_id=?').run(u.id);db.prepare('DELETE FROM maker_crew_requests WHERE requested_by=?').run(u.id);db.prepare('DELETE FROM maker_crew_members WHERE user_id=?').run(u.id);db.prepare('DELETE FROM content_reports WHERE reporter_id=?').run(u.id);db.prepare('DELETE FROM discussion_replies WHERE user_id=?').run(u.id);db.prepare('DELETE FROM discussion_topics WHERE user_id=?').run(u.id);db.prepare('DELETE FROM answers WHERE user_id=?').run(u.id);db.prepare('DELETE FROM questions WHERE user_id=?').run(u.id);db.prepare('DELETE FROM comments WHERE user_id=?').run(u.id);db.prepare('DELETE FROM build_log_entries WHERE user_id=?').run(u.id);db.prepare('DELETE FROM project_tasks WHERE created_by=? OR assignee_id=?').run(u.id,u.id);db.prepare('DELETE FROM project_collaboration_invites WHERE from_user_id=? OR to_user_id=?').run(u.id,u.id);db.prepare('DELETE FROM tool_cabinet_items WHERE user_id=?').run(u.id);db.prepare('DELETE FROM project_collaborators WHERE user_id=?').run(u.id);db.prepare('DELETE FROM live_comments WHERE user_id=?').run(u.id);db.prepare('DELETE FROM critique_responses WHERE user_id=?').run(u.id);db.prepare('DELETE FROM critiques WHERE user_id=?').run(u.id);db.prepare('DELETE FROM peer_reflections WHERE reviewer_id=?').run(u.id);db.prepare('DELETE FROM work_submissions WHERE user_id=?').run(u.id);db.prepare('DELETE FROM assignment_projects WHERE user_id=?').run(u.id);db.prepare('DELETE FROM shop_notes WHERE user_id=?').run(u.id);db.prepare('DELETE FROM projects WHERE owner_id=?').run(u.id);db.prepare('DELETE FROM users WHERE id=?').run(u.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return sendJson(res,200,{ok:true},{'Set-Cookie':'workshop_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});});

  if (pathname === '/api/home' && method === 'GET') {
    const uid = me?.id || '';
    const projectRows = db.prepare(projectSelect(uid)+' ORDER BY p.updated_at DESC LIMIT 40').all(uid);
    const projects = filterVisibleProjects(projectRows,me).slice(0,8).map(projectRow);
    let continueProject=null;
    if(me){
      const candidates=db.prepare(projectSelect(uid)+` WHERE p.status='Active' AND (p.owner_id=? OR EXISTS(SELECT 1 FROM project_collaborators pc WHERE pc.project_id=p.id AND pc.user_id=?)) ORDER BY p.updated_at DESC LIMIT 12`).all(uid,me.id,me.id);
      const c=filterVisibleProjects(candidates,me)[0];continueProject=c?projectRow(c):null;
    }
    const rawNotes = db.prepare(`SELECT n.*,u.display_name author,p.title project_title,p.visibility project_visibility,p.owner_id project_owner_id FROM shop_notes n JOIN users u ON u.id=n.user_id LEFT JOIN projects p ON p.id=n.project_id WHERE n.status='Published' ORDER BY n.created_at DESC LIMIT 30`).all();
    const notes=rawNotes.filter(n=>canAccessLevel(n.visibility||'Public',me,n.user_id)&&(!n.project_id||canViewProject({id:n.project_id,visibility:n.project_visibility,owner_id:n.project_owner_id},me))).slice(0,5);
    const questions = db.prepare(`SELECT q.*,u.display_name author,(SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) answer_count FROM questions q JOIN users u ON u.id=q.user_id ORDER BY q.updated_at DESC LIMIT 20`).all().filter(q=>!q.project_id||canViewLinkedProject(q.project_id,me)).slice(0,5);
    const along = db.prepare('SELECT * FROM build_alongs ORDER BY created_at DESC LIMIT 1').get();
    const brief = db.prepare('SELECT * FROM open_briefs ORDER BY created_at DESC LIMIT 1').get();
    const library = db.prepare("SELECT * FROM library_items WHERE status='Published' ORDER BY featured DESC, created_at DESC LIMIT 20").all().filter(r=>canAccessLevel(r.visibility||'Public',me,r.created_by||'')).slice(0,4).map(r=>libraryRow(r,uid));
    const liveEvent = db.prepare(`SELECT e.*,p.title project_title FROM live_events e LEFT JOIN projects p ON p.id=e.project_id WHERE e.status IN ('Live','Scheduled') ORDER BY CASE e.status WHEN 'Live' THEN 0 ELSE 1 END,e.starts_at ASC`).all().find(e=>canAccessLevel(e.visibility||'Public',me,e.created_by)&&(!e.project_id||canViewLinkedProject(e.project_id,me)));
    const wallExhibition=db.prepare("SELECT * FROM wall_exhibitions WHERE status='Published' AND visibility='Public' ORDER BY updated_at DESC LIMIT 1").get();
    const activeSession=db.prepare("SELECT s.*,u.display_name host FROM workshop_sessions s JOIN users u ON u.id=s.host_id WHERE s.status IN ('Active','Upcoming') ORDER BY CASE s.status WHEN 'Active' THEN 0 ELSE 1 END,s.starts_at").all().find(x=>canSeeSession(x,me));
    return sendJson(res,200,{projects,continueProject,notes,questions,buildAlong:buildAlongRow(along),openBrief:openBriefRow(brief),library,liveEvent,wallExhibition,activeSession:activeSession?workshopSessionRow(activeSession,uid):null});
  }

  if (pathname === '/api/projects' && method === 'GET') {
    const uid = me?.id || '';
    const mine = url.searchParams.get('mine') === '1';
    const rows = mine && me
      ? db.prepare(projectSelect(uid)+' WHERE p.owner_id=? ORDER BY p.updated_at DESC').all(uid,me.id)
      : db.prepare(projectSelect(uid)+' ORDER BY p.updated_at DESC').all(uid);
    return sendJson(res,200,{projects:filterVisibleProjects(rows,me).map(projectRow)});
  }

  if (pathname === '/api/projects' && method === 'POST') {
    const u = requireUser(req,res); if (!u) return;
    return readBody(req).then(body=>{
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res,400,{error:'Give the project a name.'});
      const pid=id('p'), ts=now();
      db.prepare(`INSERT INTO projects (id,owner_id,title,slug,description,stage,status,disciplines,tags,cover_emoji,visibility,license,estimated_cost,difficulty,tools,materials,website,github_repo,cover_url,project_type,parent_type,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pid,u.id,title,slugify(title),String(body.description||''),String(body.stage||'Idea'),String(body.status||'Active'),JSON.stringify(parseList(body.disciplines)),JSON.stringify(parseList(body.tags)),String(body.coverEmoji||'✦'),canonicalVisibility(body.visibility,'Members'),String(body.license||'Unspecified'),String(body.estimatedCost||''),String(body.difficulty||'Approachable'),JSON.stringify(parseList(body.tools)),JSON.stringify(parseList(body.materials)),String(body.website||''),normalizeGitHubRepo(body.githubRepo)?.url||'',String(body.coverUrl||''),String(body.projectType||'Project'),body.parentType||null,body.parentId||null,ts,ts);
      if (String(body.firstEntry || '').trim()) db.prepare(`INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id('l'),pid,u.id,String(body.entryType||'Idea'),'First note',String(body.firstEntry).trim(),ts,ts);
      const row=db.prepare(projectSelect(u.id)+' WHERE p.id=?').get(u.id,pid);
      sendJson(res,201,{project:projectRow(row)});
    }).catch(e=>sendJson(res,400,{error:e.message}));
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === 'GET') {
    const uid=me?.id||''; const pid=projectMatch[1];
    const row=db.prepare(projectSelect(uid)+' WHERE p.id=?').get(uid,pid);
    if (!row || !canViewProject(row,me)) return sendJson(res,404,{error:'Project not found.'});
    const logs=db.prepare(`SELECT l.*,u.display_name author FROM build_log_entries l JOIN users u ON u.id=l.user_id WHERE l.project_id=? ORDER BY l.created_at DESC`).all(pid);
    const comments=db.prepare(`SELECT c.*,u.display_name author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=? ORDER BY c.created_at ASC`).all(pid);
    const files=db.prepare(`SELECT f.*,u.display_name uploader FROM project_files f JOIN users u ON u.id=f.uploader_id WHERE f.project_id=? ORDER BY f.logical_name,f.version DESC`).all(pid).map(f=>({...f,locked:!canAccessLevel(f.access_level||'Inherit',me,row.owner_id),url:canAccessLevel(f.access_level||'Inherit',me,row.owner_id)?`/uploads/${encodeURIComponent(f.stored_name)}`:''}));
    const releases=db.prepare(`SELECT r.*,u.display_name creator FROM project_releases r JOIN users u ON u.id=r.created_by WHERE r.project_id=? ORDER BY r.created_at DESC`).all(pid).map(r=>({...r,files:db.prepare(`SELECT f.*,u.display_name uploader FROM project_release_files rf JOIN project_files f ON f.id=rf.file_id JOIN users u ON u.id=f.uploader_id WHERE rf.release_id=? ORDER BY f.logical_name`).all(r.id)}));
    const critiques=db.prepare(`SELECT c.*,u.display_name author,(SELECT COUNT(*) FROM critique_responses r WHERE r.critique_id=c.id) response_count FROM critiques c JOIN users u ON u.id=c.user_id WHERE c.project_id=? ORDER BY c.updated_at DESC`).all(pid).map(c=>({...c,feedback_types:json(c.feedback_types)}));
    const clinics=db.prepare(`SELECT c.*,e.title event_title FROM project_clinic_submissions c LEFT JOIN live_events e ON e.id=c.event_id WHERE c.project_id=? AND (c.status IN ('Selected','Reviewed') OR c.user_id=?) ORDER BY c.updated_at DESC`).all(pid,me?.id||'');
    const collaborators=db.prepare(`SELECT pc.user_id,pc.role,u.display_name,u.avatar_seed FROM project_collaborators pc JOIN users u ON u.id=pc.user_id WHERE pc.project_id=? ORDER BY u.display_name`).all(pid);
    const tasks=db.prepare(`SELECT t.*,u.display_name assignee_name,c.display_name creator_name FROM project_tasks t LEFT JOIN users u ON u.id=t.assignee_id JOIN users c ON c.id=t.created_by WHERE t.project_id=? ORDER BY CASE t.status WHEN 'To Do' THEN 0 WHEN 'Doing' THEN 1 ELSE 2 END,t.updated_at DESC`).all(pid);
    const pendingInvite=me?db.prepare(`SELECT i.*,u.display_name inviter_name FROM project_collaboration_invites i JOIN users u ON u.id=i.from_user_id WHERE i.project_id=? AND i.to_user_id=? AND i.status='Pending' ORDER BY i.created_at DESC LIMIT 1`).get(pid,me.id):null;
    const canCollaborate=Boolean(me&&(row.owner_id===me.id||collaborators.some(c=>c.user_id===me.id)));
    const assignmentLink=db.prepare(`SELECT a.id assignment_id,a.title assignment_title,s.id session_id,s.title session_title,s.theme session_theme,ws.confirmation_code FROM assignment_projects ap JOIN session_assignments a ON a.id=ap.assignment_id JOIN workshop_sessions s ON s.id=a.session_id LEFT JOIN work_submissions ws ON ws.assignment_id=a.id AND ws.project_id=ap.project_id WHERE ap.project_id=?`).get(pid);
    return sendJson(res,200,{project:projectRow(row),logs:logs.map(l=>({...l,attachments:json(l.attachments)})),comments,files,releases,critiques,clinics,collaborators,tasks,pendingInvite,canCollaborate,assignmentLink:assignmentLink||null});
  }
  if (projectMatch && method === 'PUT') {
    const u=requireUser(req,res); if(!u)return;
    const p=db.prepare('SELECT * FROM projects WHERE id=?').get(projectMatch[1]);
    if(!p)return sendJson(res,404,{error:'Project not found.'});
    if(p.owner_id!==u.id)return sendJson(res,403,{error:'Only the project owner can edit project details.'});
    return readBody(req).then(body=>{
      const title=String(body.title||p.title).trim(); if(!title)return sendJson(res,400,{error:'Give the project a name.'});
      const ts=now();
      db.prepare(`UPDATE projects SET title=?,slug=?,description=?,stage=?,status=?,disciplines=?,tags=?,cover_emoji=?,visibility=?,license=?,estimated_cost=?,difficulty=?,tools=?,materials=?,website=?,github_repo=?,cover_url=?,project_type=?,updated_at=? WHERE id=?`)
      .run(title,slugify(title),String(body.description??p.description),String(body.stage||p.stage),String(body.status||p.status),
        JSON.stringify(parseList(body.disciplines ?? json(p.disciplines))),JSON.stringify(parseList(body.tags ?? json(p.tags))),String(body.coverEmoji||p.cover_emoji),
        canonicalVisibility(body.visibility,p.visibility||'Members'),String(body.license||p.license),String(body.estimatedCost??p.estimated_cost),String(body.difficulty||p.difficulty),
        JSON.stringify(parseList(body.tools ?? json(p.tools))),JSON.stringify(parseList(body.materials ?? json(p.materials))),String((body.website??p.website)||''),
        body.githubRepo===undefined?String(p.github_repo||''):(normalizeGitHubRepo(body.githubRepo)?.url||''),String((body.coverUrl??p.cover_url)||''),String(body.projectType||p.project_type||'Project'),ts,p.id);
      if(body.githubRepo!==undefined)db.prepare('DELETE FROM github_cache WHERE project_id=?').run(p.id);
      const row=db.prepare(projectSelect(u.id)+' WHERE p.id=?').get(u.id,p.id);
      sendJson(res,200,{project:projectRow(row)});
    }).catch(e=>sendJson(res,400,{error:e.message}));
  }

  const logMatch=pathname.match(/^\/api\/projects\/([^/]+)\/logs$/);
  if (logMatch && method==='POST') {
    const u=requireUser(req,res); if(!u)return;
    const p=db.prepare('SELECT * FROM projects WHERE id=?').get(logMatch[1]);
    if(!p)return sendJson(res,404,{error:'Project not found.'});
    if(p.owner_id!==u.id && !db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,u.id)) return sendJson(res,403,{error:'Only project owners and collaborators can add build-log entries.'});
    return readBody(req).then(body=>{
      const text=String(body.body||'').trim(); if(!text)return sendJson(res,400,{error:'Write something that happened.'});
      const lid=id('l'),ts=now();
      db.prepare(`INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at,measurements,observations,test_results,problems,decisions,questions,attachments,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(lid,p.id,u.id,String(body.type||'Build'),String(body.title||''),text,ts,String(body.measurements||''),String(body.observations||''),String(body.testResults||''),String(body.problems||''),String(body.decisions||''),String(body.questions||''),JSON.stringify(parseList(body.attachments)),ts);
      db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(ts,p.id);
      sendJson(res,201,{entry:{id:lid,project_id:p.id,user_id:u.id,author:u.display_name,type:String(body.type||'Build'),title:String(body.title||''),body:text,measurements:String(body.measurements||''),observations:String(body.observations||''),test_results:String(body.testResults||''),problems:String(body.problems||''),decisions:String(body.decisions||''),questions:String(body.questions||''),attachments:parseList(body.attachments),created_at:ts,updated_at:ts}});
    });
  }

  const logDetail=pathname.match(/^\/api\/projects\/([^/]+)\/logs\/([^/]+)$/);
  if(logDetail && (method==='PUT' || method==='DELETE')){
    const u=requireUser(req,res); if(!u)return;
    const p=db.prepare('SELECT * FROM projects WHERE id=?').get(logDetail[1]);
    const l=db.prepare('SELECT * FROM build_log_entries WHERE id=? AND project_id=?').get(logDetail[2],logDetail[1]);
    if(!p||!l)return sendJson(res,404,{error:'Build-log entry not found.'});
    if(p.owner_id!==u.id && l.user_id!==u.id && !db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,u.id)) return sendJson(res,403,{error:'You cannot change this build-log entry.'});
    if(method==='DELETE'){
      db.prepare('DELETE FROM build_log_entries WHERE id=?').run(l.id); db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now(),p.id);
      return sendJson(res,200,{ok:true});
    }
    return readBody(req).then(body=>{
      const text=String(body.body??l.body).trim(); if(!text)return sendJson(res,400,{error:'A build-log entry cannot be empty.'});
      const ts=now();
      db.prepare(`UPDATE build_log_entries SET type=?,title=?,body=?,measurements=?,observations=?,test_results=?,problems=?,decisions=?,questions=?,attachments=?,updated_at=? WHERE id=?`)
        .run(String(body.type||l.type),String(body.title??l.title),text,String((body.measurements??l.measurements)||''),String((body.observations??l.observations)||''),String((body.testResults??l.test_results)||''),String((body.problems??l.problems)||''),String((body.decisions??l.decisions)||''),String((body.questions??l.questions)||''),JSON.stringify(parseList(body.attachments ?? json(l.attachments))),ts,l.id);
      db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(ts,p.id);
      sendJson(res,200,{ok:true});
    }).catch(e=>sendJson(res,400,{error:e.message}));
  }

  const commentMatch=pathname.match(/^\/api\/projects\/([^/]+)\/comments$/);
  if(commentMatch && method==='POST'){
    const u=requireUser(req,res); if(!u)return;
    const project=db.prepare('SELECT * FROM projects WHERE id=?').get(commentMatch[1]);if(!project||!canViewProject(project,u))return sendJson(res,404,{error:'Project not found.'});
    return readBody(req).then(body=>{const text=String(body.body||'').trim(); if(!text)return sendJson(res,400,{error:'Write a comment first.'}); const cid=id('c'),ts=now(); db.prepare('INSERT INTO comments VALUES (?,?,?,?,?)').run(cid,commentMatch[1],u.id,text,ts); if(project)notifyUser(project.owner_id,'project',`${u.display_name} commented on ${project.title}.`,`#/projects/${commentMatch[1]}`,u.id); sendJson(res,201,{comment:{id:cid,project_id:commentMatch[1],user_id:u.id,author:u.display_name,body:text,created_at:ts}});});
  }

  const saveMatch=pathname.match(/^\/api\/projects\/([^/]+)\/save$/);
  if(saveMatch && method==='POST'){
    const u=requireUser(req,res); if(!u)return;
    const project=db.prepare('SELECT * FROM projects WHERE id=?').get(saveMatch[1]);if(!project||!canViewProject(project,u))return sendJson(res,404,{error:'Project not found.'});
    const exists=db.prepare(`SELECT 1 FROM saved_items WHERE user_id=? AND item_type='project' AND item_id=?`).get(u.id,saveMatch[1]);
    if(exists){ db.prepare(`DELETE FROM saved_items WHERE user_id=? AND item_type='project' AND item_id=?`).run(u.id,saveMatch[1]); db.prepare(`DELETE FROM collection_items WHERE item_type='project' AND item_id=? AND collection_id IN (SELECT id FROM collections WHERE user_id=?)`).run(saveMatch[1],u.id); }
    else db.prepare(`INSERT INTO saved_items VALUES (?,?,?,?)`).run(u.id,'project',saveMatch[1],now());
    return sendJson(res,200,{saved:!exists});
  }

  if(pathname==='/api/questions' && method==='GET'){
    const rows=db.prepare(`SELECT q.*,u.display_name author,p.title project_title,(SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) answer_count FROM questions q JOIN users u ON u.id=q.user_id LEFT JOIN projects p ON p.id=q.project_id ORDER BY q.updated_at DESC`).all();
    return sendJson(res,200,{questions:rows.map(q=>({...q,external_links:json(q.external_links),evidence_refs:json(q.evidence_refs)}))});
  }
  if(pathname==='/api/questions' && method==='POST'){
    const u=requireUser(req,res); if(!u)return;
    return readBody(req).then(body=>{const title=String(body.title||'').trim(), trying=String(body.trying||'').trim(); if(!title||!trying)return sendJson(res,400,{error:'A question needs a title and what you are trying to do.'}); const qid=id('q'),ts=now(); db.prepare(`INSERT INTO questions (id,user_id,title,trying,tried,happened,help_needed,status,created_at,updated_at,project_id,measurements,drawings,source_code,schematic,external_links,evidence_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(qid,u.id,title,trying,String(body.tried||''),String(body.happened||''),String(body.helpNeeded||''),'Open',ts,ts,String(body.projectId||''),String(body.measurements||''),String(body.drawings||''),String(body.sourceCode||''),String(body.schematic||''),JSON.stringify(parseList(body.externalLinks)),JSON.stringify(parseList(body.evidenceRefs))); sendJson(res,201,{id:qid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const answerMatch=pathname.match(/^\/api\/questions\/([^/]+)\/answers$/);
  if(answerMatch && method==='POST'){
    const u=requireUser(req,res); if(!u)return;
    return readBody(req).then(body=>{const text=String(body.body||'').trim(); if(!text)return sendJson(res,400,{error:'Write an answer first.'}); const aid=id('a'),ts=now(); db.prepare('INSERT INTO answers (id,question_id,user_id,body,mark,created_at) VALUES (?,?,?,?,?,?)').run(aid,answerMatch[1],u.id,text,'',ts); db.prepare('UPDATE questions SET updated_at=? WHERE id=?').run(ts,answerMatch[1]); const q=db.prepare('SELECT user_id,title FROM questions WHERE id=?').get(answerMatch[1]); if(q)notifyUser(q.user_id,'question',`${u.display_name} answered: ${q.title}`,`#/question/${answerMatch[1]}`,u.id); sendJson(res,201,{id:aid});});
  }
  const markMatch=pathname.match(/^\/api\/questions\/([^/]+)\/answers\/([^/]+)\/mark$/);
  if(markMatch && method==='PUT'){
    const u=requireUser(req,res); if(!u)return; const q=db.prepare('SELECT * FROM questions WHERE id=?').get(markMatch[1]); if(!q)return sendJson(res,404,{error:'Question not found.'}); if(q.user_id!==u.id)return sendJson(res,403,{error:'Only the person who asked can mark an answer.'});
    return readBody(req).then(body=>{const mark=String(body.mark||''); if(!['','Solved It','Helped','Useful Direction'].includes(mark))return sendJson(res,400,{error:'Unknown answer mark.'}); if(mark==='Solved It')db.prepare(`UPDATE answers SET mark='' WHERE question_id=?`).run(q.id); db.prepare('UPDATE answers SET mark=? WHERE id=? AND question_id=?').run(mark,markMatch[2],q.id); db.prepare('UPDATE questions SET status=?,updated_at=? WHERE id=?').run(mark==='Solved It'?'Solved':'Open',now(),q.id); return sendJson(res,200,{ok:true,status:mark==='Solved It'?'Solved':'Open'});});
  }
  const questionDetail=pathname.match(/^\/api\/questions\/([^/]+)$/);
  if(questionDetail && method==='GET'){
    const q=db.prepare(`SELECT q.*,u.display_name author,p.title project_title FROM questions q JOIN users u ON u.id=q.user_id LEFT JOIN projects p ON p.id=q.project_id WHERE q.id=?`).get(questionDetail[1]); if(!q)return sendJson(res,404,{error:'Question not found.'});
    const answers=db.prepare(`SELECT a.*,u.display_name author FROM answers a JOIN users u ON u.id=a.user_id WHERE a.question_id=? ORDER BY a.created_at`).all(q.id);
    return sendJson(res,200,{question:{...q,external_links:json(q.external_links),evidence_refs:json(q.evidence_refs)},answers});
  }

  function canPublishShopNotes(u){return u && ['Owner','Administrator','Editor'].includes(u.role)}
  if(pathname==='/api/shop-notes' && method==='GET'){
    const mine=url.searchParams.get('mine')==='1'; let rows;
    if(mine){const u=requireUser(req,res);if(!u)return;rows=db.prepare(`SELECT n.*,u.display_name author,p.title project_title FROM shop_notes n JOIN users u ON u.id=n.user_id LEFT JOIN projects p ON p.id=n.project_id WHERE n.user_id=? ORDER BY COALESCE(NULLIF(n.updated_at,''),n.created_at) DESC`).all(u.id)}
    else rows=db.prepare(`SELECT n.*,u.display_name author,p.title project_title FROM shop_notes n JOIN users u ON u.id=n.user_id LEFT JOIN projects p ON p.id=n.project_id WHERE n.status='Published' AND (n.visibility='Public' OR (?<>'' AND n.visibility='Members') OR (?<>'' AND n.visibility='Supporter' AND EXISTS(SELECT 1 FROM users me WHERE me.id=? AND me.role IN ('Supporter','Owner','Administrator','Editor')))) ORDER BY n.created_at DESC`).all(me?.id||'',me?.id||'',me?.id||'');
    return sendJson(res,200,{notes:rows.map(n=>({...n,media_refs:json(n.media_refs)})),canPublish:canPublishShopNotes(me)});
  }
  if(pathname==='/api/shop-notes' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;if(!canPublishShopNotes(u))return sendJson(res,403,{error:'Shop Notes are published by Green Shoe Garage editors.'});
    return readBody(req).then(body=>{const title=String(body.title||'').trim(),text=String(body.body||'').trim();if(!title||!text)return sendJson(res,400,{error:'A Shop Note needs a title and note.'});const nid=id('n'),ts=now(),status=body.status==='Draft'?'Draft':'Published',visibility=['Public','Members','Supporter'].includes(body.visibility)?body.visibility:'Public';db.prepare(`INSERT INTO shop_notes (id,user_id,title,body,project_id,created_at,status,visibility,media_refs,external_link,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(nid,u.id,title,text,String(body.projectId||'')||null,ts,status,visibility,JSON.stringify(parseList(body.mediaRefs)),String(body.externalLink||''),ts);return sendJson(res,201,{id:nid})}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const noteMatch=pathname.match(/^\/api\/shop-notes\/([^/]+)$/);
  if(noteMatch && method==='PUT'){
    const u=requireUser(req,res);if(!u)return;const n=db.prepare('SELECT * FROM shop_notes WHERE id=?').get(noteMatch[1]);if(!n)return sendJson(res,404,{error:'Shop Note not found.'});if(n.user_id!==u.id&&!['Owner','Administrator','Editor'].includes(u.role))return sendJson(res,403,{error:'You cannot edit this Shop Note.'});
    return readBody(req).then(body=>{db.prepare(`UPDATE shop_notes SET title=?,body=?,project_id=?,status=?,visibility=?,media_refs=?,external_link=?,updated_at=? WHERE id=?`).run(String(body.title??n.title).trim(),String(body.body??n.body),String(body.projectId??n.project_id)||null,body.status==='Draft'?'Draft':'Published',['Public','Members','Supporter'].includes(body.visibility)?body.visibility:n.visibility,JSON.stringify(parseList(body.mediaRefs??json(n.media_refs))),String(body.externalLink??n.external_link),now(),n.id);return sendJson(res,200,{ok:true})});
  }
  if(noteMatch && method==='DELETE'){
    const u=requireUser(req,res);if(!u)return;const n=db.prepare('SELECT * FROM shop_notes WHERE id=?').get(noteMatch[1]);if(!n)return sendJson(res,404,{error:'Shop Note not found.'});if(n.user_id!==u.id&&!['Owner','Administrator','Editor'].includes(u.role))return sendJson(res,403,{error:'You cannot remove this Shop Note.'});db.prepare('DELETE FROM shop_notes WHERE id=?').run(n.id);return sendJson(res,200,{ok:true});
  }
  if(pathname==='/api/build-alongs' && method==='GET') return sendJson(res,200,{items:db.prepare('SELECT * FROM build_alongs ORDER BY created_at DESC').all().map(buildAlongRow),canEdit:canEditEditorial(me)});
  if(pathname==='/api/build-alongs' && method==='POST'){
    const u=requireUser(req,res); if(!u)return; if(!canEditEditorial(u))return sendJson(res,403,{error:'Build Alongs are published by Workshop editors.'});
    return readBody(req).then(body=>{const title=String(body.title||'').trim(),overview=String(body.overview||'').trim();if(!title||!overview)return sendJson(res,400,{error:'A Build Along needs a title and overview.'});const bid=id('ba'),ts=now();
      db.prepare(`INSERT INTO build_alongs (id,title,overview,difficulty,expected_time,approximate_cost,skills,tools,materials,instructions,safety_notes,created_at,bom,downloadable_files,reference_url,video_url,alternatives,modification_ideas,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(bid,title,overview,String(body.difficulty||'Approachable'),String(body.expectedTime||''),String(body.approximateCost||''),JSON.stringify(parseList(body.skills)),JSON.stringify(parseList(body.tools)),JSON.stringify(parseList(body.materials)),String(body.instructions||''),String(body.safetyNotes||''),ts,JSON.stringify(Array.isArray(body.bom)?body.bom:parseList(body.bom).map(item=>({item,qty:'',notes:''}))),JSON.stringify(parseList(body.downloadableFiles)),String(body.referenceUrl||''),String(body.videoUrl||''),String(body.alternatives||''),String(body.modificationIdeas||''),String(body.status||'Active'),ts);sendJson(res,201,{id:bid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const baMatch=pathname.match(/^\/api\/build-alongs\/([^/]+)$/);
  if(baMatch && method==='GET'){const row=db.prepare('SELECT * FROM build_alongs WHERE id=?').get(baMatch[1]);if(!row)return sendJson(res,404,{error:'Build Along not found.'});return sendJson(res,200,{item:buildAlongRow(row),versions:childProjects('Build Along',row.id,me?.id||''),canEdit:canEditEditorial(me)});}
  if(baMatch && method==='PUT'){
    const u=requireUser(req,res);if(!u)return;if(!canEditEditorial(u))return sendJson(res,403,{error:'Build Alongs are published by Workshop editors.'});const old=db.prepare('SELECT * FROM build_alongs WHERE id=?').get(baMatch[1]);if(!old)return sendJson(res,404,{error:'Build Along not found.'});
    return readBody(req).then(body=>{db.prepare(`UPDATE build_alongs SET title=?,overview=?,difficulty=?,expected_time=?,approximate_cost=?,skills=?,tools=?,materials=?,instructions=?,safety_notes=?,bom=?,downloadable_files=?,reference_url=?,video_url=?,alternatives=?,modification_ideas=?,status=?,updated_at=? WHERE id=?`)
      .run(String(body.title??old.title).trim(),String(body.overview??old.overview).trim(),String(body.difficulty??old.difficulty),String(body.expectedTime??old.expected_time),String(body.approximateCost??old.approximate_cost),JSON.stringify(parseList(body.skills??json(old.skills))),JSON.stringify(parseList(body.tools??json(old.tools))),JSON.stringify(parseList(body.materials??json(old.materials))),String(body.instructions??old.instructions),String(body.safetyNotes??old.safety_notes),JSON.stringify(Array.isArray(body.bom)?body.bom:parseList(body.bom??json(old.bom).map(x=>x.item)).map(item=>({item,qty:'',notes:''}))),JSON.stringify(parseList(body.downloadableFiles??json(old.downloadable_files))),String(body.referenceUrl??old.reference_url),String(body.videoUrl??old.video_url),String(body.alternatives??old.alternatives),String(body.modificationIdeas??old.modification_ideas),String(body.status??old.status),now(),old.id);sendJson(res,200,{item:buildAlongRow(db.prepare('SELECT * FROM build_alongs WHERE id=?').get(old.id))});}).catch(e=>sendJson(res,400,{error:e.message}));
  }

  if(pathname==='/api/open-briefs' && method==='GET') return sendJson(res,200,{items:db.prepare('SELECT * FROM open_briefs ORDER BY created_at DESC').all().map(openBriefRow),canEdit:canEditEditorial(me)});
  if(pathname==='/api/open-briefs' && method==='POST'){
    const u=requireUser(req,res); if(!u)return; if(!canEditEditorial(u))return sendJson(res,403,{error:'Open Briefs are published by Workshop editors.'});
    return readBody(req).then(body=>{const title=String(body.title||'').trim(),objective=String(body.objective||'').trim();if(!title||!objective)return sendJson(res,400,{error:'An Open Brief needs a title and objective.'});const oid=id('ob'),ts=now();
      db.prepare(`INSERT INTO open_briefs (id,title,objective,constraints,optional_constraints,recommended_skills,time_window,safety_notes,created_at,resources,inspiration,status,closes_at,exhibition_note,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(oid,title,objective,JSON.stringify(parseList(body.constraints)),JSON.stringify(parseList(body.optionalConstraints)),JSON.stringify(parseList(body.recommendedSkills)),String(body.timeWindow||''),String(body.safetyNotes||''),ts,JSON.stringify(parseList(body.resources)),String(body.inspiration||''),String(body.status||'Open'),String(body.closesAt||''),String(body.exhibitionNote||'There is no winner. Responses are shown as an exhibition of interpretations.'),ts);sendJson(res,201,{id:oid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const obMatch=pathname.match(/^\/api\/open-briefs\/([^/]+)$/);
  if(obMatch && method==='GET'){const row=db.prepare('SELECT * FROM open_briefs WHERE id=?').get(obMatch[1]);if(!row)return sendJson(res,404,{error:'Open Brief not found.'});return sendJson(res,200,{item:openBriefRow(row),responses:childProjects('Open Brief',row.id,me?.id||''),canEdit:canEditEditorial(me)});}
  if(obMatch && method==='PUT'){
    const u=requireUser(req,res);if(!u)return;if(!canEditEditorial(u))return sendJson(res,403,{error:'Open Briefs are published by Workshop editors.'});const old=db.prepare('SELECT * FROM open_briefs WHERE id=?').get(obMatch[1]);if(!old)return sendJson(res,404,{error:'Open Brief not found.'});
    return readBody(req).then(body=>{db.prepare(`UPDATE open_briefs SET title=?,objective=?,constraints=?,optional_constraints=?,recommended_skills=?,time_window=?,safety_notes=?,resources=?,inspiration=?,status=?,closes_at=?,exhibition_note=?,updated_at=? WHERE id=?`)
      .run(String(body.title??old.title).trim(),String(body.objective??old.objective).trim(),JSON.stringify(parseList(body.constraints??json(old.constraints))),JSON.stringify(parseList(body.optionalConstraints??json(old.optional_constraints))),JSON.stringify(parseList(body.recommendedSkills??json(old.recommended_skills))),String(body.timeWindow??old.time_window),String(body.safetyNotes??old.safety_notes),JSON.stringify(parseList(body.resources??json(old.resources))),String(body.inspiration??old.inspiration),String(body.status??old.status),String(body.closesAt??old.closes_at),String(body.exhibitionNote??old.exhibition_note),now(),old.id);sendJson(res,200,{item:openBriefRow(db.prepare('SELECT * FROM open_briefs WHERE id=?').get(old.id))});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  if(pathname==='/api/library' && method==='GET'){
    const section=String(url.searchParams.get('section')||'').trim(), type=String(url.searchParams.get('type')||'').trim(), tag=String(url.searchParams.get('tag')||'').trim(), mine=url.searchParams.get('mine')==='1';
    let where=[],args=[];
    if(mine){const u=requireUser(req,res);if(!u)return;where.push('author_id=?');args.push(u.id)} else {where.push("status='Published'");where.push("(visibility='Public' OR (?<>'' AND visibility='Members'))");args.push(me?.id||'')}
    if(section){where.push('section=?');args.push(section)} if(type){where.push('type=?');args.push(type)} if(tag){where.push('tags LIKE ?');args.push(`%${tag}%`)}
    const rows=db.prepare(`SELECT * FROM library_items ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY featured DESC, COALESCE(NULLIF(updated_at,''),created_at) DESC`).all(...args).map(r=>libraryRow(r,me?.id||''));
    return sendJson(res,200,{items:rows,canEdit:canEditEditorial(me)});
  }
  if(pathname==='/api/library' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;if(!canEditEditorial(u))return sendJson(res,403,{error:'Library resources are curated by Workshop editors.'});
    return readBody(req).then(body=>{const title=String(body.title||'').trim(),summary=String(body.summary||'').trim(),section=String(body.section||'').trim(),type=String(body.type||'').trim();if(!title||!summary||!section||!type)return sendJson(res,400,{error:'A Library item needs a type, title, section, and summary.'});const lid=id('lib'),ts=now();db.prepare(`INSERT INTO library_items (id,type,title,section,summary,tags,url,created_at,body,visibility,status,featured,updated_at,author_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(lid,type,title,section,summary,JSON.stringify(parseList(body.tags)),String(body.url||''),ts,String(body.body||''),['Public','Members'].includes(body.visibility)?body.visibility:'Public',body.status==='Draft'?'Draft':'Published',body.featured?1:0,ts,u.id);sendJson(res,201,{id:lid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const libraryMatch=pathname.match(/^\/api\/library\/([^/]+)$/);
  if(libraryMatch && method==='GET'){const r=db.prepare('SELECT * FROM library_items WHERE id=?').get(libraryMatch[1]);if(!r)return sendJson(res,404,{error:'Library item not found.'});if(r.status!=='Published'&&!canEditEditorial(me))return sendJson(res,404,{error:'Library item not found.'});return sendJson(res,200,{item:libraryRow(r,me?.id||''),canEdit:canEditEditorial(me)});}
  if(libraryMatch && method==='PUT'){
    const u=requireUser(req,res);if(!u)return;if(!canEditEditorial(u))return sendJson(res,403,{error:'Library resources are curated by Workshop editors.'});const old=db.prepare('SELECT * FROM library_items WHERE id=?').get(libraryMatch[1]);if(!old)return sendJson(res,404,{error:'Library item not found.'});
    return readBody(req).then(body=>{db.prepare(`UPDATE library_items SET type=?,title=?,section=?,summary=?,tags=?,url=?,body=?,visibility=?,status=?,featured=?,updated_at=? WHERE id=?`).run(String(body.type??old.type),String(body.title??old.title).trim(),String(body.section??old.section),String(body.summary??old.summary).trim(),JSON.stringify(parseList(body.tags??json(old.tags))),String(body.url??old.url),String(body.body??old.body),['Public','Members'].includes(body.visibility)?body.visibility:old.visibility,body.status==='Draft'?'Draft':'Published',body.featured?1:0,now(),old.id);sendJson(res,200,{item:libraryRow(db.prepare('SELECT * FROM library_items WHERE id=?').get(old.id),u.id)});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  if(libraryMatch && method==='DELETE'){
    const u=requireUser(req,res);if(!u)return;if(!canEditEditorial(u))return sendJson(res,403,{error:'Library resources are curated by Workshop editors.'});db.prepare(`DELETE FROM saved_items WHERE item_type='library' AND item_id=?`).run(libraryMatch[1]);db.prepare('DELETE FROM library_items WHERE id=?').run(libraryMatch[1]);return sendJson(res,200,{ok:true});
  }
  const librarySave=pathname.match(/^\/api\/library\/([^/]+)\/save$/);
  if(librarySave && method==='POST'){const u=requireUser(req,res);if(!u)return;const exists=db.prepare(`SELECT 1 FROM saved_items WHERE user_id=? AND item_type='library' AND item_id=?`).get(u.id,librarySave[1]);if(exists){db.prepare(`DELETE FROM saved_items WHERE user_id=? AND item_type='library' AND item_id=?`).run(u.id,librarySave[1]);db.prepare(`DELETE FROM collection_items WHERE item_type='library' AND item_id=? AND collection_id IN (SELECT id FROM collections WHERE user_id=?)`).run(librarySave[1],u.id)}else db.prepare(`INSERT INTO saved_items VALUES (?,?,?,?)`).run(u.id,'library',librarySave[1],now());return sendJson(res,200,{saved:!exists});}


  if(pathname==='/api/craft-progress' && method==='GET'){
    const u=requireUser(req,res);if(!u)return;return sendJson(res,200,{craft:craftProgressFor(u.id,true)});
  }
  if(pathname==='/api/craft-progress' && method==='PUT'){
    const u=requireUser(req,res);if(!u)return;
    return readBody(req).then(body=>{
      const requirementId=String(body.requirementId||'');if(!CRAFT_REQUIREMENTS.has(requirementId))return sendJson(res,400,{error:'Unknown craft-path requirement.'});
      const checked=body.checked===true||body.checked===1||body.checked==='1'||body.checked==='true';
      const evidence=String(body.evidenceNote||'').trim().slice(0,1200),ts=now();
      db.prepare(`INSERT INTO craft_progress (user_id,requirement_id,checked,evidence_note,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,requirement_id) DO UPDATE SET checked=excluded.checked,evidence_note=excluded.evidence_note,updated_at=excluded.updated_at`).run(u.id,requirementId,checked?1:0,evidence,ts);
      audit(u.id,'craft.progress.update','user',u.id,{requirementId,checked});
      return sendJson(res,200,{ok:true,craft:craftProgressFor(u.id,true)});
    }).catch(e=>sendJson(res,400,{error:e.message}));
  }
  if(pathname==='/api/profile' && method==='PUT'){
    const u=requireUser(req,res); if(!u)return;
    return readBody(req).then(body=>{
      db.prepare(`UPDATE users SET display_name=?,bio=?,city_region=?,skills=?,tools=?,can_help=?,want_learn=?,profile_visibility=?,location_visibility=?,tool_cabinet_visibility=? WHERE id=?`).run(
        String(body.displayName||u.display_name).trim()||u.display_name,String(body.bio??u.bio),String(body.cityRegion??u.city_region),JSON.stringify(parseList(body.skills)),JSON.stringify(parseList(body.tools)),JSON.stringify(parseList(body.canHelp)),JSON.stringify(parseList(body.wantLearn)),String(body.profileVisibility||u.profile_visibility||'Members'),String(body.locationVisibility||u.location_visibility||'Members'),String(body.toolCabinetVisibility||u.tool_cabinet_visibility||'Members'),u.id);
      const fresh=db.prepare('SELECT * FROM users WHERE id=?').get(u.id); return sendJson(res,200,{user:safeUser(fresh)});
    }).catch(e=>sendJson(res,400,{error:e.message}));
  }
  if(pathname==='/api/bench-embed'&&method==='GET'){
    const u=requireUser(req,res);if(!u)return;const row=benchEmbedRecord(u.id,true),base=benchEmbedBase(req),src=`${base}/embed/bench/${row.token}`,code=`<iframe src="${src}" title="${u.display_name} — THE WORKSHOP Bench" loading="lazy" style="width:100%;max-width:760px;height:440px;border:0" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;return sendJson(res,200,{enabled:Boolean(row.enabled),settings:row.settings,token:row.token,src,code});
  }
  if(pathname==='/api/bench-embed'&&method==='PUT'){
    const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const row=benchEmbedRecord(u.id,true),settings=benchEmbedSettings(body.settings||body),enabled=body.enabled===undefined?Boolean(row.enabled):Boolean(body.enabled),ts=now();db.prepare('UPDATE bench_embeds SET enabled=?,settings=?,updated_at=? WHERE user_id=?').run(enabled?1:0,JSON.stringify(settings),ts,u.id);audit(u.id,'bench.embed.update','user',u.id,{enabled,settings});const fresh=benchEmbedRecord(u.id),base=benchEmbedBase(req),src=`${base}/embed/bench/${fresh.token}`,code=`<iframe src="${src}" title="${u.display_name} — THE WORKSHOP Bench" loading="lazy" style="width:100%;max-width:760px;height:${settings.layout==='compact'?300:440}px;border:0" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;return sendJson(res,200,{enabled:Boolean(fresh.enabled),settings:fresh.settings,token:fresh.token,src,code});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  if(pathname==='/api/bench-embed/rotate'&&method==='POST'){
    const u=requireUser(req,res);if(!u)return;const row=benchEmbedRecord(u.id,true),token=crypto.randomBytes(24).toString('hex'),ts=now();db.prepare('UPDATE bench_embeds SET token=?,updated_at=? WHERE user_id=?').run(token,ts,u.id);audit(u.id,'bench.embed.rotate','user',u.id,{});const base=benchEmbedBase(req),src=`${base}/embed/bench/${token}`,code=`<iframe src="${src}" title="${u.display_name} — THE WORKSHOP Bench" loading="lazy" style="width:100%;max-width:760px;height:${row.settings.layout==='compact'?300:440}px;border:0" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;return sendJson(res,200,{enabled:Boolean(row.enabled),settings:row.settings,token,src,code});
  }
  const benchMatch=pathname.match(/^\/api\/bench\/([^/]+)$/);
  if(benchMatch && method==='GET'){
    const payload=benchPayload(me,benchMatch[1]); if(!payload)return sendJson(res,404,{error:'Bench not found.'}); if(payload.restricted)return sendJson(res,403,{error:'This Bench is private.'}); return sendJson(res,200,payload);
  }
  // Batch 21 — Tool Cabinet
  if(pathname==='/api/tool-cabinet' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const model=String(body.model||'').trim();if(!model)return sendJson(res,400,{error:'Name the tool or model.'});const tid=id('tool'),ts=now(),rel=['Have','Know','Can Help With'].includes(body.relationship)?body.relationship:'Have';db.prepare(`INSERT INTO tool_cabinet_items (id,user_id,relationship,category,manufacturer,model,familiarity,notes,local_availability,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(tid,u.id,rel,String(body.category||''),String(body.manufacturer||''),model,String(body.familiarity||''),String(body.notes||''),['No','Occasionally','By arrangement'].includes(body.localAvailability)?body.localAvailability:'No',ts,ts);return sendJson(res,201,{id:tid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const toolMatch=pathname.match(/^\/api\/tool-cabinet\/([^/]+)$/);
  if(toolMatch&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const t=db.prepare('SELECT * FROM tool_cabinet_items WHERE id=?').get(toolMatch[1]);if(!t)return sendJson(res,404,{error:'Tool entry not found.'});if(t.user_id!==u.id)return sendJson(res,403,{error:'Only the owner can edit this Tool Cabinet entry.'});return readBody(req).then(body=>{db.prepare(`UPDATE tool_cabinet_items SET relationship=?,category=?,manufacturer=?,model=?,familiarity=?,notes=?,local_availability=?,updated_at=? WHERE id=?`).run(['Have','Know','Can Help With'].includes(body.relationship)?body.relationship:t.relationship,String(body.category??t.category),String(body.manufacturer??t.manufacturer),String(body.model??t.model).trim()||t.model,String(body.familiarity??t.familiarity),String(body.notes??t.notes),['No','Occasionally','By arrangement'].includes(body.localAvailability)?body.localAvailability:(t.local_availability||'No'),now(),t.id);return sendJson(res,200,{ok:true});});}
  if(toolMatch&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;const t=db.prepare('SELECT * FROM tool_cabinet_items WHERE id=?').get(toolMatch[1]);if(!t)return sendJson(res,404,{error:'Tool entry not found.'});if(t.user_id!==u.id)return sendJson(res,403,{error:'Only the owner can remove this Tool Cabinet entry.'});db.prepare('DELETE FROM tool_cabinet_items WHERE id=?').run(t.id);return sendJson(res,200,{ok:true});}

  // Batch 22 — Collaborative Projects
  const inviteCollection=pathname.match(/^\/api\/projects\/([^/]+)\/collaboration-invites$/);
  if(inviteCollection&&method==='POST'){const u=requireUser(req,res);if(!u)return;const p=db.prepare('SELECT * FROM projects WHERE id=?').get(inviteCollection[1]);if(!p)return sendJson(res,404,{error:'Project not found.'});if(p.owner_id!==u.id)return sendJson(res,403,{error:'Only the project owner can invite collaborators.'});return readBody(req).then(body=>{const to=String(body.toUserId||'');if(!to||to===u.id)return sendJson(res,400,{error:'Choose another Workshop member.'});if(db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,to))return sendJson(res,409,{error:'That member is already collaborating on this project.'});if(db.prepare("SELECT 1 FROM project_collaboration_invites WHERE project_id=? AND to_user_id=? AND status='Pending'").get(p.id,to))return sendJson(res,409,{error:'That member already has a pending invitation.'});const target=db.prepare("SELECT * FROM users WHERE id=? AND account_status='Active'").get(to);if(!target)return sendJson(res,404,{error:'Member not found.'});const role=['Project Lead','Mechanical','Electronics','Software','Fabrication','Testing','Documentation','Research','Photography','Other'].includes(body.role)?body.role:'Other',iid=id('invite'),ts=now();db.prepare(`INSERT INTO project_collaboration_invites (id,project_id,from_user_id,to_user_id,role,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(iid,p.id,u.id,to,role,String(body.message||''),'Pending',ts,ts);notifyUser(to,'collaboration',`${u.display_name} invited you to collaborate on ${p.title}.`,`#/projects/${p.id}`,u.id);return sendJson(res,201,{id:iid});});}
  const inviteMatch=pathname.match(/^\/api\/collaboration-invites\/([^/]+)$/);
  if(inviteMatch&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const i=db.prepare('SELECT * FROM project_collaboration_invites WHERE id=?').get(inviteMatch[1]);if(!i)return sendJson(res,404,{error:'Invitation not found.'});if(i.to_user_id!==u.id)return sendJson(res,403,{error:'Only the invited member can answer this invitation.'});if(i.status!=='Pending')return sendJson(res,400,{error:'This invitation has already been answered.'});return readBody(req).then(body=>{const status=['Accepted','Declined'].includes(body.status)?body.status:null;if(!status)return sendJson(res,400,{error:'Choose Accepted or Declined.'});db.prepare('UPDATE project_collaboration_invites SET status=?,updated_at=? WHERE id=?').run(status,now(),i.id);if(status==='Accepted')db.prepare('INSERT OR REPLACE INTO project_collaborators (project_id,user_id,role) VALUES (?,?,?)').run(i.project_id,u.id,i.role);const p=db.prepare('SELECT title FROM projects WHERE id=?').get(i.project_id);notifyUser(i.from_user_id,'collaboration',`${u.display_name} ${status==='Accepted'?'accepted':'declined'} the invitation to ${p?.title||'your project'}.`,`#/projects/${i.project_id}`,u.id);return sendJson(res,200,{ok:true,status});});}
  const collaboratorMatch=pathname.match(/^\/api\/projects\/([^/]+)\/collaborators\/([^/]+)$/);
  if(collaboratorMatch&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;const p=db.prepare('SELECT * FROM projects WHERE id=?').get(collaboratorMatch[1]);if(!p)return sendJson(res,404,{error:'Project not found.'});if(p.owner_id!==u.id&&collaboratorMatch[2]!==u.id)return sendJson(res,403,{error:'Only the owner or collaborator can end collaboration.'});db.prepare('DELETE FROM project_collaborators WHERE project_id=? AND user_id=?').run(p.id,collaboratorMatch[2]);audit(u.id,'project.collaborator.remove','project',p.id,{userId:collaboratorMatch[2]});return sendJson(res,200,{ok:true});}
  const taskCollection=pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
  if(taskCollection&&method==='POST'){const u=requireUser(req,res);if(!u)return;const p=db.prepare('SELECT * FROM projects WHERE id=?').get(taskCollection[1]);if(!p)return sendJson(res,404,{error:'Project not found.'});const member=p.owner_id===u.id||db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,u.id);if(!member)return sendJson(res,403,{error:'Project tasks are for the project team.'});return readBody(req).then(body=>{const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Give the task a clear action.'});let assignee=String(body.assigneeId||'')||null;if(assignee&&assignee!==p.owner_id&&!db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,assignee))return sendJson(res,400,{error:'Assign tasks to someone on the project team.'});const tid=id('task'),ts=now();db.prepare(`INSERT INTO project_tasks (id,project_id,title,status,assignee_id,created_by,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(tid,p.id,title,'To Do',assignee,u.id,String(body.notes||''),ts,ts);return sendJson(res,201,{id:tid});});}
  const taskMatch=pathname.match(/^\/api\/project-tasks\/([^/]+)$/);
  if(taskMatch&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const t=db.prepare('SELECT t.*,p.owner_id FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?').get(taskMatch[1]);if(!t)return sendJson(res,404,{error:'Task not found.'});const member=t.owner_id===u.id||db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(t.project_id,u.id);if(!member)return sendJson(res,403,{error:'Project tasks are for the project team.'});return readBody(req).then(body=>{const status=['To Do','Doing','Done'].includes(body.status)?body.status:t.status;db.prepare('UPDATE project_tasks SET title=?,status=?,assignee_id=?,notes=?,updated_at=? WHERE id=?').run(String(body.title??t.title).trim()||t.title,status,String(body.assigneeId??t.assignee_id??'')||null,String(body.notes??t.notes),now(),t.id);return sendJson(res,200,{ok:true});});}
  if(taskMatch&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;const t=db.prepare('SELECT t.*,p.owner_id FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?').get(taskMatch[1]);if(!t)return sendJson(res,404,{error:'Task not found.'});if(t.owner_id!==u.id&&t.created_by!==u.id)return sendJson(res,403,{error:'Only the owner or task creator can remove this task.'});db.prepare('DELETE FROM project_tasks WHERE id=?').run(t.id);return sendJson(res,200,{ok:true});}

  if(pathname==='/api/discussions' && method==='GET'){
    const area=String(url.searchParams.get('area')||'').toUpperCase(), category=String(url.searchParams.get('category')||'');
    let where=[],args=[]; if(area){where.push('t.area=?');args.push(area)} if(category){where.push('t.category=?');args.push(category)};
    const sql=`SELECT t.*,u.display_name author,u.avatar_seed,(SELECT COUNT(*) FROM discussion_replies r WHERE r.topic_id=t.id) reply_count,p.title project_title FROM discussion_topics t JOIN users u ON u.id=t.user_id LEFT JOIN projects p ON p.id=t.project_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY t.updated_at DESC`;
    return sendJson(res,200,{topics:db.prepare(sql).all(...args)});
  }
  if(pathname==='/api/discussions' && method==='POST'){
    const u=requireUser(req,res); if(!u)return;
    return readBody(req).then(body=>{const title=String(body.title||'').trim(),text=String(body.body||'').trim(),area=String(body.area||'').toUpperCase(),category=String(body.category||'').trim(); if(!title||!text||!['DESIGN','MAKE','FIX','THINK','ODDITIES'].includes(area)||!category)return sendJson(res,400,{error:'A discussion needs an area, category, title, and opening note.'}); const did=id('d'),ts=now(),pid=String(body.projectId||'').trim()||null; db.prepare('INSERT INTO discussion_topics (id,user_id,area,category,title,body,project_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(did,u.id,area,category,title,text,pid,'Open',ts,ts); notifyMentions(text,u.id,`#/discussion/${did}`); sendJson(res,201,{id:did});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const discussionMatch=pathname.match(/^\/api\/discussions\/([^/]+)$/);
  if(discussionMatch && method==='GET'){
    const t=db.prepare(`SELECT t.*,u.display_name author,u.avatar_seed,p.title project_title FROM discussion_topics t JOIN users u ON u.id=t.user_id LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?`).get(discussionMatch[1]); if(!t)return sendJson(res,404,{error:'Discussion not found.'}); const replies=db.prepare(`SELECT r.*,u.display_name author,u.avatar_seed FROM discussion_replies r JOIN users u ON u.id=r.user_id WHERE r.topic_id=? ORDER BY r.created_at ASC`).all(t.id); return sendJson(res,200,{topic:t,replies});
  }
  const replyMatch=pathname.match(/^\/api\/discussions\/([^/]+)\/replies$/);
  if(replyMatch && method==='POST'){
    const u=requireUser(req,res); if(!u)return; return readBody(req).then(body=>{const text=String(body.body||'').trim(); if(!text)return sendJson(res,400,{error:'Write a reply first.'}); const topic=db.prepare('SELECT id FROM discussion_topics WHERE id=?').get(replyMatch[1]); if(!topic)return sendJson(res,404,{error:'Discussion not found.'}); const rid=id('dr'),ts=now(),parent=String(body.parentId||'').trim()||null; db.prepare('INSERT INTO discussion_replies (id,topic_id,user_id,parent_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(rid,topic.id,u.id,parent,text,ts,ts); db.prepare('UPDATE discussion_topics SET updated_at=? WHERE id=?').run(ts,topic.id); const fullTopic=db.prepare('SELECT user_id,title FROM discussion_topics WHERE id=?').get(topic.id); if(fullTopic)notifyUser(fullTopic.user_id,'discussion',`${u.display_name} replied to: ${fullTopic.title}`,`#/discussion/${topic.id}`,u.id); if(parent){const pr=db.prepare('SELECT user_id FROM discussion_replies WHERE id=?').get(parent);if(pr)notifyUser(pr.user_id,'discussion',`${u.display_name} replied to your Workshop comment.`,`#/discussion/${topic.id}`,u.id)} notifyMentions(text,u.id,`#/discussion/${topic.id}`); sendJson(res,201,{id:rid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }

  // Batch 17 — structured Design Critique
  if(pathname==='/api/critiques' && method==='GET'){
    const rows=db.prepare(`SELECT c.*,p.title project_title,p.visibility project_visibility,p.owner_id,u.display_name author,(SELECT COUNT(*) FROM critique_responses r WHERE r.critique_id=c.id) response_count FROM critiques c JOIN projects p ON p.id=c.project_id JOIN users u ON u.id=c.user_id ORDER BY c.updated_at DESC`).all().filter(r=>canViewProject({id:r.project_id,visibility:r.project_visibility,owner_id:r.owner_id},me)).map(r=>({...r,feedback_types:json(r.feedback_types)}));
    return sendJson(res,200,{items:rows});
  }
  if(pathname==='/api/critiques' && method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const project=db.prepare('SELECT * FROM projects WHERE id=?').get(String(body.projectId||''));if(!project)return sendJson(res,404,{error:'Project not found.'});if(project.owner_id!==u.id&&!hasRole(u,['Owner','Administrator','Moderator']))return sendJson(res,403,{error:'Request critique from a project you own.'});const prompt=String(body.prompt||'').trim();if(!prompt)return sendJson(res,400,{error:'Tell the Workshop what you want reviewed.'});const cid=id('crit'),ts=now();db.prepare(`INSERT INTO critiques (id,project_id,user_id,design_state,feedback_types,prompt,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(cid,project.id,u.id,String(body.designState||'Concept'),JSON.stringify(parseList(body.feedbackTypes)),prompt,'Open',ts,ts);return sendJson(res,201,{id:cid});}).catch(e=>sendJson(res,400,{error:e.message}));
  const critiqueMatch=pathname.match(/^\/api\/critiques\/([^/]+)$/);
  if(critiqueMatch&&method==='GET'){const c=db.prepare(`SELECT c.*,p.title project_title,p.owner_id,p.visibility project_visibility,u.display_name author FROM critiques c JOIN projects p ON p.id=c.project_id JOIN users u ON u.id=c.user_id WHERE c.id=?`).get(critiqueMatch[1]);if(!c||!canViewProject({id:c.project_id,visibility:c.project_visibility,owner_id:c.owner_id},me))return sendJson(res,404,{error:'Critique not found.'});const responses=db.prepare(`SELECT r.*,u.display_name author,u.avatar_seed FROM critique_responses r JOIN users u ON u.id=r.user_id WHERE r.critique_id=? ORDER BY r.created_at ASC`).all(c.id);return sendJson(res,200,{critique:{...c,feedback_types:json(c.feedback_types)},responses});}
  if(critiqueMatch&&method==='PUT') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM critiques WHERE id=?').get(critiqueMatch[1]);if(!c)return sendJson(res,404,{error:'Critique not found.'});if(c.user_id!==u.id&&!hasRole(u,['Owner','Administrator','Moderator']))return sendJson(res,403,{error:'Only the requester can update this critique.'});const status=['Open','Closed'].includes(body.status)?body.status:c.status;db.prepare('UPDATE critiques SET design_state=?,feedback_types=?,prompt=?,status=?,updated_at=? WHERE id=?').run(String(body.designState||c.design_state),JSON.stringify(parseList(body.feedbackTypes??json(c.feedback_types))),String(body.prompt||c.prompt),status,now(),c.id);return sendJson(res,200,{ok:true});});
  const critiqueResponse=pathname.match(/^\/api\/critiques\/([^/]+)\/responses$/);
  if(critiqueResponse&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM critiques WHERE id=?').get(critiqueResponse[1]);if(!c)return sendJson(res,404,{error:'Critique not found.'});if(c.status!=='Open')return sendJson(res,400,{error:'This critique is closed.'});const vals=['works','question','tryNext','questions'].map(k=>String(body[k]||'').trim());if(!vals.some(Boolean))return sendJson(res,400,{error:'Add at least one useful critique note.'});const rid=id('cr'),ts=now();db.prepare(`INSERT INTO critique_responses (id,critique_id,user_id,works,question,try_next,questions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(rid,c.id,u.id,vals[0],vals[1],vals[2],vals[3],ts,ts);if(c.user_id!==u.id)notifyUser(c.user_id,'project',`${u.display_name} responded to your design critique.`,`#/critique/${c.id}`,u.id);return sendJson(res,201,{id:rid});}).catch(e=>sendJson(res,400,{error:e.message}));

  // Batch 18 — Live From the Garage
  if(pathname==='/api/live' && method==='GET'){const rows=db.prepare(`SELECT e.*,u.display_name host,p.title project_title,(SELECT COUNT(*) FROM live_comments c WHERE c.event_id=e.id) comment_count FROM live_events e JOIN users u ON u.id=e.created_by LEFT JOIN projects p ON p.id=e.project_id ORDER BY CASE e.status WHEN 'Live' THEN 0 WHEN 'Scheduled' THEN 1 ELSE 2 END,e.starts_at ASC`).all().map(e=>{const allowed=canAccessLevel(e.visibility||'Public',me,e.created_by);return {...e,locked:!allowed,stream_url:allowed?e.stream_url:'',archive_url:allowed?e.archive_url:''}});return sendJson(res,200,{items:rows});}
  if(pathname==='/api/live' && method==='POST') return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const title=String(body.title||'').trim(),starts=String(body.startsAt||'').trim();if(!title||!starts)return sendJson(res,400,{error:'A live event needs a title and start time.'});const eid=id('live'),ts=now();db.prepare(`INSERT INTO live_events (id,title,event_type,description,starts_at,ends_at,status,stream_url,archive_url,project_id,created_by,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eid,title,String(body.eventType||'Shop Stream'),String(body.description||''),starts,String(body.endsAt||''),String(body.status||'Scheduled'),String(body.streamUrl||''),String(body.archiveUrl||''),String(body.projectId||'')||null,u.id,ts,ts,canonicalVisibility(body.visibility,(String(body.eventType||'')==='After Hours'?'GearHead':'Public')));audit(u.id,'live.create','event',eid,{title});return sendJson(res,201,{id:eid});}).catch(e=>sendJson(res,400,{error:e.message}));
  const liveMatch=pathname.match(/^\/api\/live\/([^/]+)$/);
  if(liveMatch&&method==='GET'){const event=db.prepare(`SELECT e.*,u.display_name host,p.title project_title FROM live_events e JOIN users u ON u.id=e.created_by LEFT JOIN projects p ON p.id=e.project_id WHERE e.id=?`).get(liveMatch[1]);if(!event)return sendJson(res,404,{error:'Live event not found.'});if(!canAccessLevel(event.visibility||'Public',me,event.created_by))return sendJson(res,403,{error:'GEARHEAD CREW ONLY. Join the GearHead Crew to open this event.'});const comments=db.prepare(`SELECT c.*,u.display_name author,u.avatar_seed FROM live_comments c JOIN users u ON u.id=c.user_id WHERE c.event_id=? ORDER BY c.created_at ASC`).all(event.id);return sendJson(res,200,{event,comments});}
  if(liveMatch&&method==='PUT') return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const e=db.prepare('SELECT * FROM live_events WHERE id=?').get(liveMatch[1]);if(!e)return sendJson(res,404,{error:'Live event not found.'});db.prepare(`UPDATE live_events SET title=?,event_type=?,description=?,starts_at=?,ends_at=?,status=?,stream_url=?,archive_url=?,project_id=?,updated_at=?,visibility=? WHERE id=?`).run(String(body.title||e.title),String(body.eventType||e.event_type),String(body.description??e.description),String(body.startsAt||e.starts_at),String(body.endsAt??e.ends_at),String(body.status||e.status),String(body.streamUrl??e.stream_url),String(body.archiveUrl??e.archive_url),String(body.projectId??e.project_id)||null,now(),normalizedAccess(body.visibility||e.visibility||'Public'),e.id);audit(u.id,'live.update','event',e.id,{status:body.status||e.status});return sendJson(res,200,{ok:true});});
  const liveComment=pathname.match(/^\/api\/live\/([^/]+)\/comments$/);
  if(liveComment&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const event=db.prepare('SELECT * FROM live_events WHERE id=?').get(liveComment[1]);if(!event||!canAccessLevel(event.visibility||'Public',u,event.created_by)||!(!event.project_id||canViewLinkedProject(event.project_id,u)))return sendJson(res,404,{error:'Live event not found.'});const text=String(body.body||'').trim();if(!text)return sendJson(res,400,{error:'Add something to the live discussion.'});const cid=id('lc');db.prepare('INSERT INTO live_comments (id,event_id,user_id,body,created_at) VALUES (?,?,?,?,?)').run(cid,event.id,u.id,text,now());return sendJson(res,201,{id:cid});});


  if(pathname==='/api/clinics' && method==='GET'){
    const uid=me?.id||'',staff=hasRole(me,['Owner','Administrator','Editor','Moderator']);
    const rows=staff
      ? db.prepare(`SELECT c.*,u.display_name author,p.title project_title,e.title event_title FROM project_clinic_submissions c JOIN users u ON u.id=c.user_id JOIN projects p ON p.id=c.project_id LEFT JOIN live_events e ON e.id=c.event_id ORDER BY c.updated_at DESC`).all()
      : db.prepare(`SELECT c.*,u.display_name author,p.title project_title,e.title event_title FROM project_clinic_submissions c JOIN users u ON u.id=c.user_id JOIN projects p ON p.id=c.project_id LEFT JOIN live_events e ON e.id=c.event_id WHERE c.user_id=? OR (c.status IN ('Selected','Reviewed') AND (p.visibility='Public' OR (p.visibility='Members' AND ?<>'') OR p.owner_id=? OR EXISTS(SELECT 1 FROM project_collaborators pc WHERE pc.project_id=p.id AND pc.user_id=?))) ORDER BY c.updated_at DESC`).all(uid,uid,uid,uid);
    return sendJson(res,200,{items:rows,canManage:staff});
  }
  if(pathname==='/api/clinics' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;
    return readBody(req).then(body=>{const projectId=String(body.projectId||''),p=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);if(!p)return sendJson(res,404,{error:'Project not found.'});if(p.owner_id!==u.id&&!db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(projectId,u.id))return sendJson(res,403,{error:'Submit a project you own or collaborate on.'});const problem=String(body.problem||'').trim(),question=String(body.question||'').trim();if(!problem||!question)return sendJson(res,400,{error:'Describe the project problem and the specific question.'});const cid=id('clinic'),ts=now();db.prepare(`INSERT INTO project_clinic_submissions (id,user_id,project_id,problem,evidence,tried,question,status,event_id,recommendations,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(cid,u.id,projectId,problem,String(body.evidence||''),String(body.tried||''),question,'Submitted',null,'',ts,ts);for(const staff of db.prepare("SELECT id FROM users WHERE role IN ('Owner','Administrator','Editor','Moderator') AND account_status='Active'").all())notifyUser(staff.id,'project',`${u.display_name} submitted a Project Clinic case.`,`#/clinic/${cid}`,u.id);return sendJson(res,201,{id:cid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const clinicMatch=pathname.match(/^\/api\/clinics\/([^/]+)$/);
  if(clinicMatch && method==='GET'){
    const c=db.prepare(`SELECT c.*,u.display_name author,p.title project_title,p.visibility project_visibility,p.owner_id project_owner,e.title event_title,e.archive_url event_archive FROM project_clinic_submissions c JOIN users u ON u.id=c.user_id JOIN projects p ON p.id=c.project_id LEFT JOIN live_events e ON e.id=c.event_id WHERE c.id=?`).get(clinicMatch[1]);if(!c)return sendJson(res,404,{error:'Clinic submission not found.'});const staff=hasRole(me,['Owner','Administrator','Editor','Moderator']),projectVisible=c.project_visibility==='Public'||(c.project_visibility==='Members'&&me)||c.project_owner===me?.id||(me&&db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(c.project_id,me.id));if((c.status==='Submitted'||!projectVisible)&&c.user_id!==me?.id&&!staff)return sendJson(res,403,{error:'This Clinic submission is not visible to you.'});return sendJson(res,200,{item:c,canManage:staff,isOwner:c.user_id===me?.id});
  }
  if(clinicMatch && method==='PUT'){
    const u=requireRole(req,res,['Owner','Administrator','Editor','Moderator']);if(!u)return;const old=db.prepare('SELECT * FROM project_clinic_submissions WHERE id=?').get(clinicMatch[1]);if(!old)return sendJson(res,404,{error:'Clinic submission not found.'});
    return readBody(req).then(body=>{const status=['Submitted','Selected','Reviewed','Declined'].includes(body.status)?body.status:old.status,eventId=String(body.eventId??old.event_id??'')||null,recs=String(body.recommendations??old.recommendations??'');db.prepare('UPDATE project_clinic_submissions SET status=?,event_id=?,recommendations=?,updated_at=? WHERE id=?').run(status,eventId,recs,now(),old.id);const p=db.prepare('SELECT title FROM projects WHERE id=?').get(old.project_id);notifyUser(old.user_id,'event',status==='Selected'?`Your Project Clinic submission for ${p?.title||'your project'} was selected.`:status==='Reviewed'?`Project Clinic recommendations were attached to ${p?.title||'your project'}.`:`Your Project Clinic submission is now ${status.toLowerCase()}.`,`#/clinic/${old.id}`,u.id);audit(u.id,'clinic.update','project_clinic',old.id,{status,eventId});return sendJson(res,200,{ok:true});});
  }

  if(pathname==='/api/skill-exchange' && method==='GET'){
    const viewer=me,uid=viewer?.id||'',q=String(url.searchParams.get('q')||'').trim().toLowerCase();
    const people=db.prepare(`SELECT u.id,u.display_name,u.bio,u.city_region,u.role,u.avatar_seed,u.skills,u.tools,u.can_help,u.want_learn,u.profile_visibility,u.location_visibility,(SELECT COUNT(*) FROM projects p WHERE p.owner_id=u.id) project_count FROM users u WHERE u.account_status='Active' AND (u.profile_visibility='Public' OR (?<>'' AND u.profile_visibility='Members') OR u.id=?) ORDER BY u.display_name`).all(uid,uid).map(p=>({...p,skills:json(p.skills),tools:json(p.tools),can_help:json(p.can_help),want_learn:json(p.want_learn),city_region:(p.location_visibility==='Public'||(p.location_visibility==='Members'&&viewer)||p.id===viewer?.id)?p.city_region:''})).filter(p=>!q||[p.display_name,p.bio,...p.skills,...p.can_help,...p.want_learn].join(' ').toLowerCase().includes(q));
    const matches=viewer?people.filter(p=>p.id!==viewer.id).map(p=>{const give=json(viewer.want_learn).filter(x=>(p.can_help||[]).some(y=>y.toLowerCase().includes(String(x).toLowerCase())||String(x).toLowerCase().includes(y.toLowerCase())));const receive=json(viewer.can_help).filter(x=>(p.want_learn||[]).some(y=>y.toLowerCase().includes(String(x).toLowerCase())||String(x).toLowerCase().includes(y.toLowerCase())));return {...p,matchGive:give,matchReceive:receive,matchScore:give.length+receive.length}}).filter(x=>x.matchScore>0).sort((a,b)=>b.matchScore-a.matchScore):[];
    return sendJson(res,200,{people,matches});
  }
  if(pathname==='/api/skill-contact-requests' && method==='GET'){
    const u=requireUser(req,res);if(!u)return;const incoming=db.prepare(`SELECT r.*,f.display_name from_name,t.display_name to_name FROM skill_contact_requests r JOIN users f ON f.id=r.from_user_id JOIN users t ON t.id=r.to_user_id WHERE r.to_user_id=? ORDER BY r.created_at DESC`).all(u.id),outgoing=db.prepare(`SELECT r.*,f.display_name from_name,t.display_name to_name FROM skill_contact_requests r JOIN users f ON f.id=r.from_user_id JOIN users t ON t.id=r.to_user_id WHERE r.from_user_id=? ORDER BY r.created_at DESC`).all(u.id);return sendJson(res,200,{incoming,outgoing});
  }
  if(pathname==='/api/skill-contact-requests' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const to=String(body.toUserId||'');if(!to||to===u.id)return sendJson(res,400,{error:'Choose another Workshop member.'});const target=db.prepare("SELECT * FROM users WHERE id=? AND account_status='Active'").get(to);if(!target||!canViewProfile(u,target))return sendJson(res,404,{error:'Member not available.'});const topic=String(body.topic||'').trim();if(!topic)return sendJson(res,400,{error:'Say what skill or topic this request is about.'});const existing=db.prepare("SELECT 1 FROM skill_contact_requests WHERE from_user_id=? AND to_user_id=? AND status='Pending'").get(u.id,to);if(existing)return sendJson(res,409,{error:'You already have a pending request with this member.'});const rid=id('skill'),ts=now();db.prepare(`INSERT INTO skill_contact_requests (id,from_user_id,to_user_id,topic,offer,request,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(rid,u.id,to,topic,String(body.offer||''),String(body.request||''),String(body.message||''),'Pending',ts,ts);notifyUser(to,'collaboration',`${u.display_name} sent a skill-exchange request about ${topic}.`,'#/people/help',u.id);return sendJson(res,201,{id:rid});});
  }
  const skillReq=pathname.match(/^\/api\/skill-contact-requests\/([^/]+)$/);
  if(skillReq&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const r=db.prepare('SELECT * FROM skill_contact_requests WHERE id=?').get(skillReq[1]);if(!r)return sendJson(res,404,{error:'Contact request not found.'});if(r.to_user_id!==u.id)return sendJson(res,403,{error:'Only the recipient can answer this request.'});return readBody(req).then(body=>{const status=['Accepted','Declined'].includes(body.status)?body.status:null;if(!status)return sendJson(res,400,{error:'Choose Accepted or Declined.'});db.prepare('UPDATE skill_contact_requests SET status=?,updated_at=? WHERE id=?').run(status,now(),r.id);notifyUser(r.from_user_id,'collaboration',`${u.display_name} ${status==='Accepted'?'accepted':'declined'} your skill-exchange request.`,'#/people/help',u.id);return sendJson(res,200,{ok:true,status});});}

  // The standalone Field Instrument Lab was retired. Historical tables remain for
  // additive data safety and legacy GearHead relationships; Field Instruments are
  // published as ordinary Shop Manual resources instead of through a parallel API.

  if(pathname==='/api/wall' && method==='GET'){const rows=db.prepare(`SELECT e.*,u.display_name curator,(SELECT COUNT(*) FROM wall_items wi WHERE wi.exhibition_id=e.id) item_count FROM wall_exhibitions e JOIN users u ON u.id=e.curator_id WHERE e.status='Published' AND (e.visibility='Public' OR ?<>'' AND e.visibility='Members') ORDER BY e.updated_at DESC`).all(me?.id||'');return sendJson(res,200,{items:rows,canEdit:canEditEditorial(me)});}
  if(pathname==='/api/wall' && method==='POST') return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'An exhibition needs a title.'});const wid=id('wall'),ts=now();db.prepare(`INSERT INTO wall_exhibitions (id,title,description,status,visibility,curator_id,starts_at,ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(wid,title,String(body.description||''),String(body.status||'Published'),canonicalVisibility(body.visibility,'Public'),u.id,String(body.startsAt||''),String(body.endsAt||''),ts,ts);audit(u.id,'wall.create','exhibition',wid,{title});return sendJson(res,201,{id:wid});});
  const wallMatch=pathname.match(/^\/api\/wall\/([^/]+)$/);
  if(wallMatch&&method==='GET'){const e=db.prepare(`SELECT e.*,u.display_name curator FROM wall_exhibitions e JOIN users u ON u.id=e.curator_id WHERE e.id=?`).get(wallMatch[1]);if(!e)return sendJson(res,404,{error:'Exhibition not found.'});if(e.visibility!=='Public'&&!me)return sendJson(res,403,{error:'Enter the Workshop to view this exhibition.'});const rows=db.prepare(projectSelect(me?.id||'')+` JOIN wall_items wi ON wi.project_id=p.id WHERE wi.exhibition_id=? ORDER BY wi.sort_order,p.updated_at DESC`).all(me?.id||'',e.id).map(projectRow);const captions=Object.fromEntries(db.prepare('SELECT project_id,caption,sort_order FROM wall_items WHERE exhibition_id=?').all(e.id).map(x=>[x.project_id,x]));return sendJson(res,200,{item:e,projects:rows.map(p=>({...p,wallCaption:captions[p.id]?.caption||'',wallOrder:captions[p.id]?.sort_order||0})),canEdit:canEditEditorial(me)});}
  if(wallMatch&&method==='PUT') return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const e=db.prepare('SELECT * FROM wall_exhibitions WHERE id=?').get(wallMatch[1]);if(!e)return sendJson(res,404,{error:'Exhibition not found.'});db.prepare('UPDATE wall_exhibitions SET title=?,description=?,status=?,visibility=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?').run(String(body.title??e.title),String(body.description??e.description),String(body.status??e.status),String(body.visibility??e.visibility),String(body.startsAt??e.starts_at),String(body.endsAt??e.ends_at),now(),e.id);return sendJson(res,200,{ok:true});});
  const wallItems=pathname.match(/^\/api\/wall\/([^/]+)\/items$/);
  if(wallItems&&method==='POST') return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const pid=String(body.projectId||'');if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(pid))return sendJson(res,404,{error:'Project not found.'});const max=db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM wall_items WHERE exhibition_id=?').get(wallItems[1]).m;db.prepare('INSERT INTO wall_items (exhibition_id,project_id,caption,sort_order,created_at) VALUES (?,?,?,?,?) ON CONFLICT(exhibition_id,project_id) DO UPDATE SET caption=excluded.caption,sort_order=excluded.sort_order').run(wallItems[1],pid,String(body.caption||''),Number(body.sortOrder??max+1),now());return sendJson(res,201,{ok:true});});
  if(wallItems&&method==='DELETE') return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;db.prepare('DELETE FROM wall_items WHERE exhibition_id=? AND project_id=?').run(wallItems[1],String(body.projectId||''));return sendJson(res,200,{ok:true});});

  if(pathname==='/api/reports' && method==='POST'){
    const u=requireUser(req,res); if(!u)return; return readBody(req).then(body=>{const itemType=String(body.itemType||'').trim(),itemId=String(body.itemId||'').trim(),reason=String(body.reason||'').trim(); if(!itemType||!itemId||!reason)return sendJson(res,400,{error:'Choose a reason for the report.'}); const rid=id('report'); db.prepare('INSERT INTO content_reports (id,reporter_id,item_type,item_id,reason,status,created_at) VALUES (?,?,?,?,?,?,?)').run(rid,u.id,itemType,itemId,reason,'Open',now());notifyAdmins('moderation',`New moderation report from ${u.display_name}: ${reason}`,'#/admin',`THE WORKSHOP moderation report — ${reason}`,`Reporter: ${u.display_name} (${u.email})\nContent: ${itemType} / ${itemId}\nReason: ${reason}`,'emailModerationReports'); sendJson(res,201,{id:rid});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  if(pathname==='/api/people' && method==='GET'){
    const people=db.prepare(`SELECT u.id,u.display_name,u.bio,u.city_region,u.role,u.avatar_seed,u.skills,u.tools,u.can_help,u.want_learn,u.profile_visibility,u.location_visibility,
      (SELECT COUNT(*) FROM projects p WHERE p.owner_id=u.id) project_count
      FROM users u WHERE u.profile_visibility='Public' OR (?<>'' AND u.profile_visibility='Members') OR u.id=? ORDER BY u.display_name`).all(me?.id||'',me?.id||'').map(p=>({...p,skills:json(p.skills),tools:json(p.tools),can_help:json(p.can_help),want_learn:json(p.want_learn),city_region:(p.location_visibility==='Public'||(p.location_visibility==='Members'&&me)||p.id===me?.id)?p.city_region:''})); return sendJson(res,200,{people});
  }
  const uploadMatch=pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
  if(uploadMatch && method==='POST'){
    const u=requireUser(req,res);if(!u)return;const p=db.prepare('SELECT * FROM projects WHERE id=?').get(uploadMatch[1]);if(!p)return sendJson(res,404,{error:'Project not found.'});if(p.owner_id!==u.id&&!db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,u.id))return sendJson(res,403,{error:'You cannot upload to this project.'});
    const decodeHeader=v=>{try{return decodeURIComponent(String(v||''))}catch{return String(v||'')}}; const original=safeFilename(decodeHeader(req.headers['x-file-name'])||'file'), logical=safeFilename(decodeHeader(req.headers['x-logical-name'])||original), mime=String(req.headers['content-type']||'application/octet-stream').slice(0,120),notes=decodeHeader(req.headers['x-file-notes']).slice(0,500),access=normalizedAccess(decodeHeader(req.headers['x-file-access'])||'Inherit');
    return readRawBody(req).then(buf=>{if(!buf.length)return sendJson(res,400,{error:'Choose a file first.'});const prior=db.prepare('SELECT MAX(version) v FROM project_files WHERE project_id=? AND logical_name=?').get(p.id,logical);const version=Number(prior?.v||0)+1,fid=id('f'),stored=`${fid}-${safeFilename(original)}`,sha256=crypto.createHash('sha256').update(buf).digest('hex');fs.writeFileSync(path.join(UPLOADS,stored),buf);db.prepare(`INSERT INTO project_files (id,project_id,uploader_id,logical_name,original_name,stored_name,mime_type,size_bytes,version,notes,sha256,access_level,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(fid,p.id,u.id,logical,original,stored,mime,buf.length,version,notes,sha256,access,now());return sendJson(res,201,{file:{id:fid,logical_name:logical,original_name:original,mime_type:mime,size_bytes:buf.length,version,notes,sha256,url:`/uploads/${encodeURIComponent(stored)}`}});}).catch(e=>sendJson(res,400,{error:e.message}));
  }
  const fileMatch=pathname.match(/^\/api\/files\/([^/]+)$/);
  if(fileMatch&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;const f=db.prepare(`SELECT f.*,p.owner_id FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=?`).get(fileMatch[1]);if(!f)return sendJson(res,404,{error:'File not found.'});if(f.owner_id!==u.id&&f.uploader_id!==u.id)return sendJson(res,403,{error:'You cannot remove this file revision.'});if(db.prepare('SELECT 1 FROM project_release_files WHERE file_id=? LIMIT 1').get(f.id))return sendJson(res,409,{error:'This revision is pinned by a project release. Remove the release record before removing the revision.'});try{fs.unlinkSync(path.join(UPLOADS,f.stored_name))}catch{}db.prepare('DELETE FROM project_files WHERE id=?').run(f.id);return sendJson(res,200,{ok:true});}


  const releaseList=pathname.match(/^\/api\/projects\/([^/]+)\/releases$/);
  if(releaseList&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const p=db.prepare('SELECT * FROM projects WHERE id=?').get(releaseList[1]);if(!p)return sendJson(res,404,{error:'Project not found.'});if(p.owner_id!==u.id&&!db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,u.id))return sendJson(res,403,{error:'Only the project team can create a release.'});const version=String(body.version||'').trim(),title=String(body.title||'').trim()||version;if(!version)return sendJson(res,400,{error:'Give the release a version.'});const fileIds=Array.isArray(body.fileIds)?body.fileIds.map(String):[];if(!fileIds.length)return sendJson(res,400,{error:'Choose at least one project file revision for the release.'});const valid=db.prepare(`SELECT id FROM project_files WHERE project_id=? AND id IN (${fileIds.map(()=>'?').join(',')})`).all(p.id,...fileIds).map(x=>x.id);if(valid.length!==fileIds.length)return sendJson(res,400,{error:'One or more selected revisions are not part of this project.'});const rid=id('rel'),ts=now();db.exec('BEGIN');try{db.prepare(`INSERT INTO project_releases (id,project_id,created_by,version,title,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(rid,p.id,u.id,version,title,String(body.notes||''),String(body.status||'Released'),ts,ts);const ins=db.prepare('INSERT INTO project_release_files (release_id,file_id,created_at) VALUES (?,?,?)');for(const fid of valid)ins.run(rid,fid,ts);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}audit(u.id,'project.release.create','project',p.id,{releaseId:rid,version,fileCount:valid.length});return sendJson(res,201,{id:rid});});
  const releaseDetail=pathname.match(/^\/api\/project-releases\/([^/]+)$/);
  if(releaseDetail&&method==='GET'){const r=db.prepare(`SELECT r.*,p.title project_title,p.visibility,p.owner_id,u.display_name creator FROM project_releases r JOIN projects p ON p.id=r.project_id JOIN users u ON u.id=r.created_by WHERE r.id=?`).get(releaseDetail[1]);if(!r)return sendJson(res,404,{error:'Release not found.'});const viewer=me,allowed=canViewProject({id:r.project_id,visibility:r.visibility,owner_id:r.owner_id},viewer);if(!allowed)return sendJson(res,404,{error:'Release not found.'});const files=db.prepare(`SELECT f.*,u.display_name uploader FROM project_release_files rf JOIN project_files f ON f.id=rf.file_id JOIN users u ON u.id=f.uploader_id WHERE rf.release_id=? ORDER BY f.logical_name`).all(r.id);return sendJson(res,200,{release:r,files});}
  const releaseManifest=pathname.match(/^\/api\/project-releases\/([^/]+)\/manifest$/);
  if(releaseManifest&&method==='GET'){const r=db.prepare(`SELECT r.*,p.title project_title,p.visibility,p.owner_id FROM project_releases r JOIN projects p ON p.id=r.project_id WHERE r.id=?`).get(releaseManifest[1]);if(!r)return sendJson(res,404,{error:'Release not found.'});const viewer=me,allowed=canViewProject({id:r.project_id,visibility:r.visibility,owner_id:r.owner_id},viewer);if(!allowed)return sendJson(res,404,{error:'Release not found.'});const files=db.prepare(`SELECT f.logical_name,f.original_name,f.version,f.mime_type,f.size_bytes,f.sha256,f.notes,u.display_name uploader,f.created_at FROM project_release_files rf JOIN project_files f ON f.id=rf.file_id JOIN users u ON u.id=f.uploader_id WHERE rf.release_id=? ORDER BY f.logical_name`).all(r.id);const manifest={format:'the-workshop-project-release',formatVersion:1,project:{id:r.project_id,title:r.project_title},release:{id:r.id,version:r.version,title:r.title,notes:r.notes,status:r.status,createdAt:r.created_at},files};const body=JSON.stringify(manifest,null,2);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${safeFilename(r.project_title)}-${safeFilename(r.version)}-manifest.json"`,'Cache-Control':'private, no-store'});return res.end(body);}
  if(releaseDetail&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;const r=db.prepare('SELECT r.*,p.owner_id FROM project_releases r JOIN projects p ON p.id=r.project_id WHERE r.id=?').get(releaseDetail[1]);if(!r)return sendJson(res,404,{error:'Release not found.'});if(r.owner_id!==u.id)return sendJson(res,403,{error:'Only the project owner can remove a release record.'});db.prepare('DELETE FROM project_releases WHERE id=?').run(r.id);audit(u.id,'project.release.delete','project',r.project_id,{releaseId:r.id,version:r.version});return sendJson(res,200,{ok:true});}

  const githubMatch=pathname.match(/^\/api\/projects\/([^/]+)\/github$/);
  if(githubMatch&&method==='GET') return (async()=>{const p=db.prepare('SELECT id,owner_id,github_repo,visibility FROM projects WHERE id=?').get(githubMatch[1]);if(!p)return sendJson(res,404,{error:'Project not found.'});const viewer=me,allowed=canViewProject(p,viewer);if(!allowed)return sendJson(res,404,{error:'Project not found.'});const info=normalizeGitHubRepo(p.github_repo);if(!info)return sendJson(res,200,{connected:false});const canRefresh=Boolean(viewer&&(viewer.id===p.owner_id||db.prepare('SELECT 1 FROM project_collaborators WHERE project_id=? AND user_id=?').get(p.id,viewer.id)||hasRole(viewer,['Owner','Administrator','Editor'])));const force=url.searchParams.get('refresh')==='1'&&canRefresh;const cached=db.prepare('SELECT * FROM github_cache WHERE project_id=?').get(p.id);const fresh=cached&&(Date.now()-new Date(cached.fetched_at).getTime()<15*60*1000)&&cached.repo_key===info.key;if(cached&&fresh&&!force)return sendJson(res,200,{connected:true,repoUrl:info.url,cached:true,fetchedAt:cached.fetched_at,data:json(cached.payload,{})});try{const payload=await fetchGitHubProject(info);const ts=now();db.prepare(`INSERT INTO github_cache (project_id,repo_key,payload,fetched_at) VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET repo_key=excluded.repo_key,payload=excluded.payload,fetched_at=excluded.fetched_at`).run(p.id,info.key,JSON.stringify(payload),ts);return sendJson(res,200,{connected:true,repoUrl:info.url,cached:false,fetchedAt:ts,data:payload});}catch(e){if(cached&&cached.repo_key===info.key)return sendJson(res,200,{connected:true,repoUrl:info.url,cached:true,stale:true,fetchedAt:cached.fetched_at,warning:e.message,data:json(cached.payload,{})});return sendJson(res,502,{error:e.message});}})();

  if(pathname==='/api/saved' && method==='GET'){
    const u=requireUser(req,res); if(!u)return;
    const saved=db.prepare('SELECT * FROM saved_items WHERE user_id=? ORDER BY created_at DESC').all(u.id);
    const rows=filterVisibleProjects(db.prepare(projectSelect(u.id)+` WHERE EXISTS(SELECT 1 FROM saved_items s2 WHERE s2.user_id=? AND s2.item_type='project' AND s2.item_id=p.id) ORDER BY p.updated_at DESC`).all(u.id,u.id),u);
    const library=db.prepare(`SELECT l.* FROM library_items l JOIN saved_items s ON s.item_id=l.id AND s.item_type='library' WHERE s.user_id=? ORDER BY s.created_at DESC`).all(u.id).map(r=>libraryRow(r,u.id));
    const questions=db.prepare(`SELECT q.id,q.title,q.status,q.updated_at,u.display_name author FROM questions q JOIN users u ON u.id=q.user_id JOIN saved_items s ON s.item_id=q.id AND s.item_type='question' WHERE s.user_id=? ORDER BY s.created_at DESC`).all(u.id);
    const shopNotes=db.prepare(`SELECT n.id,n.title,n.body,n.created_at,u.display_name author FROM shop_notes n JOIN users u ON u.id=n.user_id JOIN saved_items s ON s.item_id=n.id AND s.item_type='shop-note' WHERE s.user_id=? ORDER BY s.created_at DESC`).all(u.id);
    const buildAlongs=db.prepare(`SELECT b.* FROM build_alongs b JOIN saved_items s ON s.item_id=b.id AND s.item_type='build-along' WHERE s.user_id=? ORDER BY s.created_at DESC`).all(u.id).map(buildAlongRow);
    const openBriefs=db.prepare(`SELECT b.* FROM open_briefs b JOIN saved_items s ON s.item_id=b.id AND s.item_type='open-brief' WHERE s.user_id=? ORDER BY s.created_at DESC`).all(u.id).map(openBriefRow);
    const collections=db.prepare(`SELECT c.*,(SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id=c.id) item_count FROM collections c WHERE c.user_id=? ORDER BY c.updated_at DESC`).all(u.id);
    return sendJson(res,200,{projects:rows.map(projectRow),library,questions,shopNotes,buildAlongs,openBriefs,collections,saved});
  }
  if(pathname==='/api/question-of-the-week' && method==='GET'){
    const rows=db.prepare(`SELECT q.*,u.display_name author,(SELECT COUNT(*) FROM weekly_question_responses r WHERE r.question_id=q.id) response_count FROM weekly_questions q JOIN users u ON u.id=q.created_by WHERE q.status='Published' AND (q.visibility='Public' OR (?<>'' AND q.visibility='Members')) ORDER BY CASE WHEN q.starts_at<>'' THEN q.starts_at ELSE q.created_at END DESC`).all(me?.id||'');
    return sendJson(res,200,{items:rows,canEdit:canEditEditorial(me)});
  }
  if(pathname==='/api/question-of-the-week' && method==='POST'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;return readBody(req).then(body=>{const prompt=String(body.prompt||'').trim();if(!prompt)return sendJson(res,400,{error:'Add a question for the Workshop.'});const qid=id('qw'),ts=now();db.prepare(`INSERT INTO weekly_questions (id,prompt,image_url,status,visibility,starts_at,ends_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(qid,prompt,String(body.imageUrl||''),String(body.status||'Published'),String(body.visibility||'Public'),String(body.startsAt||''),String(body.endsAt||''),u.id,ts,ts);return sendJson(res,201,{id:qid});});}
  const qweek=pathname.match(/^\/api\/question-of-the-week\/([^/]+)$/);
  if(qweek&&method==='GET'){const q=db.prepare(`SELECT q.*,u.display_name author FROM weekly_questions q JOIN users u ON u.id=q.created_by WHERE q.id=?`).get(qweek[1]);if(!q)return sendJson(res,404,{error:'Question of the Week not found.'});if(q.visibility==='Members'&&!me)return sendJson(res,403,{error:'Enter the Workshop to view this question.'});const responses=db.prepare(`SELECT r.*,u.display_name author,u.avatar_seed FROM weekly_question_responses r JOIN users u ON u.id=r.user_id WHERE r.question_id=? ORDER BY r.created_at ASC`).all(q.id);return sendJson(res,200,{item:q,responses,canEdit:canEditEditorial(me)});}
  if(qweek&&method==='PUT'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const old=db.prepare('SELECT * FROM weekly_questions WHERE id=?').get(qweek[1]);if(!old)return sendJson(res,404,{error:'Question not found.'});return readBody(req).then(body=>{db.prepare('UPDATE weekly_questions SET prompt=?,image_url=?,status=?,visibility=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?').run(String(body.prompt??old.prompt),String(body.imageUrl??old.image_url),String(body.status??old.status),String(body.visibility??old.visibility),String(body.startsAt??old.starts_at),String(body.endsAt??old.ends_at),now(),old.id);return sendJson(res,200,{ok:true});});}
  const qweekResp=pathname.match(/^\/api\/question-of-the-week\/([^/]+)\/responses$/);
  if(qweekResp&&method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const q=db.prepare('SELECT * FROM weekly_questions WHERE id=?').get(qweekResp[1]);if(!q)return sendJson(res,404,{error:'Question not found.'});const text=String(body.body||'').trim();if(!text)return sendJson(res,400,{error:'Add a response.'});const rid=id('qwr'),ts=now();db.prepare('INSERT INTO weekly_question_responses (id,question_id,user_id,body,image_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(rid,q.id,u.id,text,String(body.imageUrl||''),ts,ts);return sendJson(res,201,{id:rid});});}

  if(pathname==='/api/teardown-club' && method==='GET'){
    const rows=db.prepare(`SELECT t.*,u.display_name curator,(SELECT COUNT(*) FROM teardown_contributions c WHERE c.teardown_id=t.id) contribution_count FROM teardown_clubs t JOIN users u ON u.id=t.curator_id WHERE t.visibility='Public' OR (?<>'' AND t.visibility='Members') ORDER BY CASE t.status WHEN 'Active' THEN 0 ELSE 1 END,t.starts_at DESC,t.created_at DESC`).all(me?.id||'');
    return sendJson(res,200,{items:rows,canEdit:canEditEditorial(me)});
  }
  if(pathname==='/api/teardown-club' && method==='POST'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;return readBody(req).then(body=>{const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Give the teardown a title.'});const tid=id('teardown'),ts=now();db.prepare(`INSERT INTO teardown_clubs (id,title,object_name,overview,status,visibility,safety_notes,reference_url,project_id,starts_at,ends_at,curator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tid,title,String(body.objectName||''),String(body.overview||''),String(body.status||'Active'),String(body.visibility||'Public'),String(body.safetyNotes||''),String(body.referenceUrl||''),String(body.projectId||''),String(body.startsAt||''),String(body.endsAt||''),u.id,ts,ts);audit(u.id,'teardown.create','teardown',tid,{title});return sendJson(res,201,{id:tid});});}
  const teardown=pathname.match(/^\/api\/teardown-club\/([^/]+)$/);
  if(teardown&&method==='GET'){const t=db.prepare(`SELECT t.*,u.display_name curator,p.title project_title FROM teardown_clubs t JOIN users u ON u.id=t.curator_id LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?`).get(teardown[1]);if(!t)return sendJson(res,404,{error:'Teardown Club record not found.'});if(t.visibility==='Members'&&!me)return sendJson(res,403,{error:'Enter the Workshop to view this teardown.'});const contributions=db.prepare(`SELECT c.*,u.display_name author,u.avatar_seed FROM teardown_contributions c JOIN users u ON u.id=c.user_id WHERE c.teardown_id=? ORDER BY c.created_at ASC`).all(t.id).map(x=>({...x,photo_urls:json(x.photo_urls)}));return sendJson(res,200,{item:t,contributions,canEdit:canEditEditorial(me)});}
  if(teardown&&method==='PUT'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const old=db.prepare('SELECT * FROM teardown_clubs WHERE id=?').get(teardown[1]);if(!old)return sendJson(res,404,{error:'Teardown not found.'});return readBody(req).then(body=>{db.prepare(`UPDATE teardown_clubs SET title=?,object_name=?,overview=?,status=?,visibility=?,safety_notes=?,reference_url=?,project_id=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?`).run(String(body.title??old.title),String(body.objectName??old.object_name),String(body.overview??old.overview),String(body.status??old.status),String(body.visibility??old.visibility),String(body.safetyNotes??old.safety_notes),String(body.referenceUrl??old.reference_url),String(body.projectId??old.project_id),String(body.startsAt??old.starts_at),String(body.endsAt??old.ends_at),now(),old.id);audit(u.id,'teardown.update','teardown',old.id,{});return sendJson(res,200,{ok:true});});}
  const teardownContrib=pathname.match(/^\/api\/teardown-club\/([^/]+)\/contributions$/);
  if(teardownContrib&&method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const t=db.prepare('SELECT * FROM teardown_clubs WHERE id=?').get(teardownContrib[1]);if(!t)return sendJson(res,404,{error:'Teardown not found.'});const title=String(body.title||'').trim(),text=String(body.body||'').trim();if(!title||!text)return sendJson(res,400,{error:'Add a short title and what you observed.'});const cid=id('tdc'),ts=now();db.prepare(`INSERT INTO teardown_contributions (id,teardown_id,user_id,category,title,body,photo_urls,component,material,circuit_notes,mechanism_notes,repairability,reusable_parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cid,t.id,u.id,String(body.category||'Observation'),title,text,JSON.stringify(parseList(String(body.photoUrls||'').replace(/\n/g,','))),String(body.component||''),String(body.material||''),String(body.circuitNotes||''),String(body.mechanismNotes||''),String(body.repairability||''),String(body.reusableParts||''),ts,ts);return sendJson(res,201,{id:cid});});}

  if(pathname==='/api/scrap-bin' && method==='GET'){
    const status=String(url.searchParams.get('status')||'Available'); const cat=String(url.searchParams.get('category')||'');
    let sql=`SELECT s.*,u.display_name owner,u.avatar_seed,(SELECT COUNT(*) FROM scrap_inquiries i WHERE i.listing_id=s.id) inquiry_count FROM scrap_listings s JOIN users u ON u.id=s.user_id WHERE 1=1`,args=[];
    if(status&&status!=='All'){sql+=' AND s.status=?';args.push(status)} if(cat){sql+=' AND s.category=?';args.push(cat)} const scope=String(url.searchParams.get('scope')||'');if(scope){sql+=' AND s.scope=?';args.push(scope)} sql+=' ORDER BY s.updated_at DESC';
    return sendJson(res,200,{items:db.prepare(sql).all(...args).filter(x=>canAccessLevel(x.visibility||'Public',me,x.user_id)&&visibleAuthor(me,x.user_id))});
  }
  if(pathname==='/api/scrap-bin' && method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Describe what is available.'});const sid=id('scrap'),ts=now();db.prepare(`INSERT INTO scrap_listings (id,user_id,title,category,description,exchange_type,city_region,condition_text,quantity_text,image_url,status,created_at,updated_at,scope,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid,u.id,title,String(body.category||'Other'),String(body.description||''),String(body.exchangeType||'Free'),String(body.cityRegion||''),String(body.conditionText||''),String(body.quantityText||''),String(body.imageUrl||''),'Available',ts,ts,String(body.scope||'Workshop'),canonicalVisibility(body.visibility,'Public'));return sendJson(res,201,{id:sid});});}
  const scrap=pathname.match(/^\/api\/scrap-bin\/([^/]+)$/);
  if(scrap&&method==='GET'){const item=db.prepare(`SELECT s.*,u.display_name owner,u.avatar_seed FROM scrap_listings s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(scrap[1]);if(!item||!canAccessLevel(item.visibility||'Public',me,item.user_id)||!visibleAuthor(me,item.user_id))return sendJson(res,404,{error:'Scrap Bin listing not found.'});let inquiries=[];if(me&&(me.id===item.user_id||hasRole(me,['Owner','Administrator','Moderator'])))inquiries=db.prepare(`SELECT i.*,u.display_name sender FROM scrap_inquiries i JOIN users u ON u.id=i.sender_id WHERE i.listing_id=? ORDER BY i.created_at DESC`).all(item.id);const myInquiry=me?db.prepare('SELECT * FROM scrap_inquiries WHERE listing_id=? AND sender_id=? ORDER BY created_at DESC LIMIT 1').get(item.id,me.id):null;return sendJson(res,200,{item,inquiries,myInquiry,isOwner:me?.id===item.user_id});}
  if(scrap&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const old=db.prepare('SELECT * FROM scrap_listings WHERE id=?').get(scrap[1]);if(!old)return sendJson(res,404,{error:'Listing not found.'});if(old.user_id!==u.id&&!hasRole(u,['Owner','Administrator','Moderator']))return sendJson(res,403,{error:'Only the owner can update this listing.'});return readBody(req).then(body=>{db.prepare(`UPDATE scrap_listings SET title=?,category=?,description=?,exchange_type=?,city_region=?,condition_text=?,quantity_text=?,image_url=?,status=?,scope=?,visibility=?,updated_at=? WHERE id=?`).run(String(body.title??old.title),String(body.category??old.category),String(body.description??old.description),String(body.exchangeType??old.exchange_type),String(body.cityRegion??old.city_region),String(body.conditionText??old.condition_text),String(body.quantityText??old.quantity_text),String(body.imageUrl??old.image_url),String(body.status??old.status),String(body.scope??old.scope??'Workshop'),canonicalVisibility(body.visibility??old.visibility,'Public'),now(),old.id);return sendJson(res,200,{ok:true});});}
  const scrapInquiry=pathname.match(/^\/api\/scrap-bin\/([^/]+)\/inquiries$/);
  if(scrapInquiry&&method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const item=db.prepare('SELECT * FROM scrap_listings WHERE id=?').get(scrapInquiry[1]);if(!item)return sendJson(res,404,{error:'Listing not found.'});if(item.user_id===u.id)return sendJson(res,400,{error:'This is your own listing.'});const msg=String(body.message||'').trim();if(!msg)return sendJson(res,400,{error:'Add a short note for the member.'});const iid=id('scrapi'),ts=now();db.prepare('INSERT INTO scrap_inquiries (id,listing_id,sender_id,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(iid,item.id,u.id,msg,'Open',ts,ts);notifyUser(item.user_id,'collaboration',`${u.display_name} is interested in ${item.title}.`,`#/scrap/${item.id}`,u.id);return sendJson(res,201,{id:iid});});}
  const scrapInquiryStatus=pathname.match(/^\/api\/scrap-inquiries\/([^/]+)$/);
  if(scrapInquiryStatus&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const row=db.prepare(`SELECT i.*,s.user_id owner_id,s.id listing_id FROM scrap_inquiries i JOIN scrap_listings s ON s.id=i.listing_id WHERE i.id=?`).get(scrapInquiryStatus[1]);if(!row)return sendJson(res,404,{error:'Inquiry not found.'});if(row.owner_id!==u.id&&!hasRole(u,['Owner','Administrator','Moderator']))return sendJson(res,403,{error:'Only the listing owner can manage inquiries.'});return readBody(req).then(body=>{const status=String(body.status||'Closed');db.prepare('UPDATE scrap_inquiries SET status=?,updated_at=? WHERE id=?').run(status,now(),row.id);return sendJson(res,200,{ok:true});});}

  if(pathname==='/api/mysteries' && method==='GET'){const rows=db.prepare(`SELECT m.*,u.display_name author,u.avatar_seed,(SELECT COUNT(*) FROM mystery_proposals p WHERE p.mystery_id=m.id) proposal_count FROM mystery_items m JOIN users u ON u.id=m.user_id ORDER BY CASE m.status WHEN 'Open' THEN 0 ELSE 1 END,m.updated_at DESC`).all().map(x=>({...x,photo_urls:json(x.photo_urls)}));return sendJson(res,200,{items:rows});}
  if(pathname==='/api/mysteries' && method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Give the mystery a short title.'});const mid=id('mystery'),ts=now();db.prepare(`INSERT INTO mystery_items (id,user_id,title,category,photo_urls,dimensions,markings,approximate_age,source_context,notes,status,identified_as,best_proposal_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(mid,u.id,title,String(body.category||'mystery object'),JSON.stringify(parseList(String(body.photoUrls||'').replace(/\n/g,','))),String(body.dimensions||''),String(body.markings||''),String(body.approximateAge||''),String(body.sourceContext||''),String(body.notes||''),'Open','','',ts,ts);return sendJson(res,201,{id:mid});});}
  const mystery=pathname.match(/^\/api\/mysteries\/([^/]+)$/);
  if(mystery&&method==='GET'){const m=db.prepare(`SELECT m.*,u.display_name author,u.avatar_seed FROM mystery_items m JOIN users u ON u.id=m.user_id WHERE m.id=?`).get(mystery[1]);if(!m)return sendJson(res,404,{error:'Mystery not found.'});m.photo_urls=json(m.photo_urls);const proposals=db.prepare(`SELECT p.*,u.display_name author,u.avatar_seed FROM mystery_proposals p JOIN users u ON u.id=p.user_id WHERE p.mystery_id=? ORDER BY p.created_at ASC`).all(m.id);return sendJson(res,200,{item:m,proposals,isOwner:me?.id===m.user_id});}
  if(mystery&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const old=db.prepare('SELECT * FROM mystery_items WHERE id=?').get(mystery[1]);if(!old)return sendJson(res,404,{error:'Mystery not found.'});if(old.user_id!==u.id&&!hasRole(u,['Owner','Administrator','Moderator']))return sendJson(res,403,{error:'Only the author can update this mystery.'});return readBody(req).then(body=>{db.prepare('UPDATE mystery_items SET title=?,category=?,photo_urls=?,dimensions=?,markings=?,approximate_age=?,source_context=?,notes=?,updated_at=? WHERE id=?').run(String(body.title??old.title),String(body.category??old.category),JSON.stringify(parseList(String(body.photoUrls??json(old.photo_urls).join(',' )).replace(/\n/g,','))),String(body.dimensions??old.dimensions),String(body.markings??old.markings),String(body.approximateAge??old.approximate_age),String(body.sourceContext??old.source_context),String(body.notes??old.notes),now(),old.id);return sendJson(res,200,{ok:true});});}
  const mysteryProposal=pathname.match(/^\/api\/mysteries\/([^/]+)\/proposals$/);
  if(mysteryProposal&&method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const m=db.prepare('SELECT * FROM mystery_items WHERE id=?').get(mysteryProposal[1]);if(!m)return sendJson(res,404,{error:'Mystery not found.'});const identification=String(body.identification||'').trim(),explanation=String(body.explanation||'').trim();if(!identification||!explanation)return sendJson(res,400,{error:'Propose an identification and explain why.'});const pid=id('proposal'),ts=now();db.prepare('INSERT INTO mystery_proposals (id,mystery_id,user_id,identification,explanation,references_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(pid,m.id,u.id,identification,explanation,String(body.referencesText||''),ts,ts);db.prepare('UPDATE mystery_items SET updated_at=? WHERE id=?').run(ts,m.id);return sendJson(res,201,{id:pid});});}
  const identify=pathname.match(/^\/api\/mysteries\/([^/]+)\/identify$/);
  if(identify&&method==='PUT'){const u=requireUser(req,res);if(!u)return;const m=db.prepare('SELECT * FROM mystery_items WHERE id=?').get(identify[1]);if(!m)return sendJson(res,404,{error:'Mystery not found.'});if(m.user_id!==u.id&&!hasRole(u,['Owner','Administrator','Moderator']))return sendJson(res,403,{error:'Only the author can mark this identified.'});return readBody(req).then(body=>{const proposalId=String(body.proposalId||''),p=proposalId?db.prepare('SELECT * FROM mystery_proposals WHERE id=? AND mystery_id=?').get(proposalId,m.id):null;const identified=String(body.identifiedAs||p?.identification||'').trim();if(!identified)return sendJson(res,400,{error:'Record what the object was identified as.'});db.prepare("UPDATE mystery_items SET status='Identified',identified_as=?,best_proposal_id=?,updated_at=? WHERE id=?").run(identified,p?.id||'',now(),m.id);return sendJson(res,200,{ok:true});});}

  if(pathname==='/api/saved/toggle' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const type=String(body.itemType||''),itemId=String(body.itemId||'');if(!assertSavable(type,itemId))return sendJson(res,400,{error:'That item cannot be saved.'});const exists=db.prepare('SELECT 1 FROM saved_items WHERE user_id=? AND item_type=? AND item_id=?').get(u.id,type,itemId);if(exists){db.prepare('DELETE FROM saved_items WHERE user_id=? AND item_type=? AND item_id=?').run(u.id,type,itemId);db.prepare(`DELETE FROM collection_items WHERE item_type=? AND item_id=? AND collection_id IN (SELECT id FROM collections WHERE user_id=?)`).run(type,itemId,u.id)}else db.prepare('INSERT INTO saved_items (user_id,item_type,item_id,created_at) VALUES (?,?,?,?)').run(u.id,type,itemId,now());return sendJson(res,200,{saved:!exists})});
  }
  if(pathname==='/api/collections' && method==='POST'){
    const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const name=String(body.name||'').trim();if(!name)return sendJson(res,400,{error:'Give the collection a name.'});const cid=id('col'),ts=now();db.prepare('INSERT INTO collections (id,user_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(cid,u.id,name,String(body.description||''),ts,ts);return sendJson(res,201,{id:cid})});
  }
  const collectionMatch=pathname.match(/^\/api\/collections\/([^/]+)$/);
  if(collectionMatch && method==='GET'){
    const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(collectionMatch[1],u.id);if(!c)return sendJson(res,404,{error:'Collection not found.'});const items=db.prepare('SELECT * FROM collection_items WHERE collection_id=? ORDER BY created_at DESC').all(c.id);return sendJson(res,200,{collection:c,items});
  }
  if(collectionMatch && method==='PUT'){
    const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(collectionMatch[1],u.id);if(!c)return sendJson(res,404,{error:'Collection not found.'});return readBody(req).then(body=>{db.prepare('UPDATE collections SET name=?,description=?,updated_at=? WHERE id=?').run(String(body.name||c.name).trim(),String(body.description??c.description),now(),c.id);return sendJson(res,200,{ok:true})});
  }
  if(collectionMatch && method==='DELETE'){
    const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(collectionMatch[1],u.id);if(!c)return sendJson(res,404,{error:'Collection not found.'});db.prepare('DELETE FROM collections WHERE id=?').run(c.id);return sendJson(res,200,{ok:true});
  }
  const collectionItemMatch=pathname.match(/^\/api\/collections\/([^/]+)\/items$/);
  if(collectionItemMatch && method==='POST'){
    const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(collectionItemMatch[1],u.id);if(!c)return sendJson(res,404,{error:'Collection not found.'});return readBody(req).then(body=>{const type=String(body.itemType||''),itemId=String(body.itemId||'');if(!db.prepare('SELECT 1 FROM saved_items WHERE user_id=? AND item_type=? AND item_id=?').get(u.id,type,itemId))return sendJson(res,400,{error:'Save the item before adding it to a collection.'});db.prepare('INSERT OR IGNORE INTO collection_items (collection_id,item_type,item_id,created_at) VALUES (?,?,?,?)').run(c.id,type,itemId,now());db.prepare('UPDATE collections SET updated_at=? WHERE id=?').run(now(),c.id);return sendJson(res,200,{ok:true})});
  }
  if(collectionItemMatch && method==='DELETE'){
    const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(collectionItemMatch[1],u.id);if(!c)return sendJson(res,404,{error:'Collection not found.'});return readBody(req).then(body=>{db.prepare('DELETE FROM collection_items WHERE collection_id=? AND item_type=? AND item_id=?').run(c.id,String(body.itemType||''),String(body.itemId||''));db.prepare('UPDATE collections SET updated_at=? WHERE id=?').run(now(),c.id);return sendJson(res,200,{ok:true})});
  }
  if(pathname==='/api/notifications' && method==='GET'){
    const u=requireUser(req,res); if(!u)return; return sendJson(res,200,{items:db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(u.id),preferences:notificationPrefs(u.id),emailPreferences:emailPrefs(u.id),emailDelivery:{provider:EMAIL_PROVIDER,configured:emailConfigured()}});
  }
  if(pathname==='/api/notifications/read-all' && method==='POST'){const u=requireUser(req,res);if(!u)return;db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(u.id);return sendJson(res,200,{ok:true});}
  const notificationRead=pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if(notificationRead && method==='POST'){const u=requireUser(req,res);if(!u)return;db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(notificationRead[1],u.id);return sendJson(res,200,{ok:true});}
  if(pathname==='/api/notification-preferences' && method==='PUT'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{notificationPrefs(u.id);emailPrefs(u.id);for(const k of NOTIFICATION_KINDS){if(k in body)db.prepare(`UPDATE notification_preferences SET ${k}=? WHERE user_id=?`).run(body[k]?1:0,u.id)}for(const k of ['enabled','crew_attendance','account_security','moderation','gearhead']){if(k in (body.email||{}))db.prepare(`UPDATE email_preferences SET ${k}=? WHERE user_id=?`).run(body.email[k]?1:0,u.id)}return sendJson(res,200,{preferences:notificationPrefs(u.id),emailPreferences:emailPrefs(u.id)})});}
  if(pathname==='/api/search' && method==='GET'){
    const q=String(url.searchParams.get('q')||'').trim(), kind=String(url.searchParams.get('kind')||'all').trim();
    const empty={q,kind,projects:[],buildLogs:[],questions:[],discussions:[],shopNotes:[],communityBuilds:[],help:[],library:[],people:[],crews:[],live:[],scrap:[],wall:[],gearhead:[]}; if(!q)return sendJson(res,200,empty);
    const like=`%${q}%`,uid=me?.id||''; const out={...empty}; const want=k=>kind==='all'||kind===k;
    if(want('projects'))out.projects=filterVisibleProjects(db.prepare(projectSelect(uid)+` WHERE p.title LIKE ? OR p.description LIKE ? OR p.tags LIKE ? OR p.disciplines LIKE ? OR p.materials LIKE ? OR p.tools LIKE ? ORDER BY p.updated_at DESC LIMIT 80`).all(uid,like,like,like,like,like,like),me).slice(0,30).map(projectRow);
    if(want('logs'))out.buildLogs=db.prepare(`SELECT l.*,p.title project_title,p.visibility project_visibility,p.owner_id,u.display_name author FROM build_log_entries l JOIN projects p ON p.id=l.project_id JOIN users u ON u.id=l.user_id WHERE l.title LIKE ? OR l.body LIKE ? OR l.measurements LIKE ? OR l.observations LIKE ? OR l.test_results LIKE ? OR l.problems LIKE ? OR l.decisions LIKE ? ORDER BY l.created_at DESC LIMIT 80`).all(like,like,like,like,like,like,like).filter(x=>canViewProject({id:x.project_id,visibility:x.project_visibility,owner_id:x.owner_id},me)&&visibleAuthor(me,x.user_id)).slice(0,30);
    if(want('questions'))out.questions=db.prepare(`SELECT q.*,u.display_name author FROM questions q JOIN users u ON u.id=q.user_id WHERE q.title LIKE ? OR q.trying LIKE ? OR q.tried LIKE ? OR q.happened LIKE ? OR q.help_needed LIKE ? ORDER BY q.updated_at DESC LIMIT 30`).all(like,like,like,like,like).filter(x=>visibleAuthor(me,x.user_id)&&canViewLinkedProject(x.project_id,me));
    if(want('discussions'))out.discussions=db.prepare(`SELECT t.*,u.display_name author FROM discussion_topics t JOIN users u ON u.id=t.user_id WHERE t.title LIKE ? OR t.body LIKE ? OR t.area LIKE ? OR t.category LIKE ? ORDER BY t.updated_at DESC LIMIT 30`).all(like,like,like,like).filter(x=>visibleAuthor(me,x.user_id));
    if(want('notes'))out.shopNotes=db.prepare(`SELECT n.*,u.display_name author FROM shop_notes n JOIN users u ON u.id=n.user_id WHERE n.status='Published' AND (n.visibility='Public' OR (?<>'' AND n.visibility='Members')) AND (n.title LIKE ? OR n.body LIKE ?) ORDER BY n.created_at DESC LIMIT 30`).all(uid,like,like);
    if(want('library'))out.library=db.prepare(`SELECT * FROM library_items WHERE status='Published' AND (visibility='Public' OR (?<>'' AND visibility='Members')) AND (title LIKE ? OR summary LIKE ? OR body LIKE ? OR tags LIKE ? OR section LIKE ? OR type LIKE ?) ORDER BY featured DESC, created_at DESC LIMIT 30`).all(uid,like,like,like,like,like,like).map(r=>libraryRow(r,uid));
    if(want('people'))out.people=db.prepare(`SELECT id,display_name,bio,city_region,role,avatar_seed,skills,profile_visibility,location_visibility FROM users WHERE (profile_visibility='Public' OR (?<>'' AND profile_visibility='Members') OR id=?) AND (display_name LIKE ? OR bio LIKE ? OR city_region LIKE ? OR skills LIKE ? OR tools LIKE ? OR can_help LIKE ? OR want_learn LIKE ?) LIMIT 30`).all(uid,uid,like,like,like,like,like,like,like).filter(x=>visibleAuthor(me,x.id)).map(x=>({...x,skills:json(x.skills),city_region:(x.location_visibility==='Public'||(x.location_visibility==='Members'&&me)||x.id===me?.id)?x.city_region:''}));
    if(want('gearhead'))out.gearhead=db.prepare(`SELECT id,title,deck,entry_type,access_level,created_at FROM gearhead_entries WHERE status='Published' AND (title LIKE ? OR deck LIKE ? OR tags LIKE ?) ORDER BY created_at DESC LIMIT 30`).all(like,like,like).map(g=>({...g,locked:!canAccessLevel(g.access_level,me)}));
    if(want('crews'))out.crews=db.prepare(`SELECT DISTINCT c.* FROM maker_crews c LEFT JOIN maker_crew_postal_codes z ON z.crew_id=c.id WHERE c.status='Active' AND (c.visibility='Public' OR ?<>'') AND (c.code LIKE ? OR c.name LIKE ? OR c.city_region LIKE ? OR c.anchor_postal_code LIKE ? OR z.postal_code LIKE ?) ORDER BY c.name LIMIT 30`).all(uid,like,like,like,like,like).map(c=>crewRow(c,me));
    if(want('community')||kind==='all'){
      const community=[];
      for(const x of db.prepare(`SELECT id,title,brief summary,status,visibility,created_by FROM workshop_prompts WHERE title LIKE ? OR brief LIKE ? ORDER BY updated_at DESC LIMIT 20`).all(like,like))if(canAccessLevel(x.visibility||'Public',me,x.created_by))community.push({id:x.id,type:'PROMPT',title:x.title,summary:x.summary,status:x.status,href:`#/prompt/${x.id}`});
      for(const x of db.prepare(`SELECT id,title,overview summary,status FROM build_alongs WHERE title LIKE ? OR overview LIKE ? ORDER BY created_at DESC LIMIT 20`).all(like,like))community.push({id:x.id,type:'BUILD ALONG',title:x.title,summary:x.summary,status:x.status||'Active',href:`#/build-along/${x.id}`});
      for(const x of db.prepare(`SELECT id,title,objective summary,status FROM open_briefs WHERE title LIKE ? OR objective LIKE ? ORDER BY created_at DESC LIMIT 20`).all(like,like))community.push({id:x.id,type:'OPEN BRIEF',title:x.title,summary:x.summary,status:x.status||'Open',href:`#/open-brief/${x.id}`});
      for(const x of db.prepare(`SELECT id,title,theme,description,status,visibility,host_id FROM workshop_sessions WHERE title LIKE ? OR theme LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT 20`).all(like,like,like))if(canSeeSession(x,me))community.push({id:x.id,type:'SESSION',title:x.title,summary:x.theme||x.description,status:x.status,href:`#/session/${x.id}`});
      for(const x of db.prepare(`SELECT id,title,overview summary,status,visibility,curator_id FROM teardown_clubs WHERE title LIKE ? OR overview LIKE ? ORDER BY updated_at DESC LIMIT 20`).all(like,like))if(canAccessLevel(x.visibility||'Public',me,x.curator_id))community.push({id:x.id,type:'TEARDOWN',title:x.title,summary:x.summary,status:x.status,href:`#/teardown/${x.id}`});
      for(const x of db.prepare(`SELECT id,prompt title,'One good question from the shop.' summary,status,visibility,created_by FROM weekly_questions WHERE prompt LIKE ? ORDER BY updated_at DESC LIMIT 20`).all(like))if(canAccessLevel(x.visibility||'Public',me,x.created_by))community.push({id:x.id,type:'WEEKLY PROMPT',title:x.title,summary:x.summary,status:x.status,href:`#/weekly/${x.id}`});
      out.communityBuilds=community.slice(0,40);
    }
    if(want('help')||kind==='all'){
      out.help=[...out.questions.map(x=>({id:x.id,type:'TROUBLESHOOTING',title:x.title,summary:x.help_needed||x.trying,href:`#/question/${x.id}`})),...db.prepare(`SELECT c.id,p.id project_id,p.title,p.visibility,p.owner_id,c.prompt,c.user_id,u.display_name author FROM critiques c JOIN projects p ON p.id=c.project_id JOIN users u ON u.id=c.user_id WHERE p.title LIKE ? OR c.prompt LIKE ? ORDER BY c.updated_at DESC LIMIT 20`).all(like,like).filter(x=>canViewProject({id:x.project_id,visibility:x.visibility,owner_id:x.owner_id},me)&&visibleAuthor(me,x.user_id)).map(x=>({id:x.id,type:'DESIGN CRITIQUE',title:x.title,summary:x.prompt,href:`#/critique/${x.id}`})),...db.prepare(`SELECT id,title,notes,status,user_id FROM mystery_items WHERE title LIKE ? OR notes LIKE ? OR markings LIKE ? ORDER BY updated_at DESC LIMIT 20`).all(like,like,like).filter(x=>visibleAuthor(me,x.user_id)).map(x=>({id:x.id,type:'IDENTIFICATION',title:x.title,summary:x.notes||'',href:`#/mystery/${x.id}`}))].slice(0,40);
    }
    if(want('live')||kind==='all')out.live=db.prepare(`SELECT id,title,event_type type,description,starts_at,status,visibility,created_by FROM live_events WHERE title LIKE ? OR description LIKE ? OR event_type LIKE ? ORDER BY starts_at DESC LIMIT 20`).all(like,like,like).filter(x=>canAccessLevel(x.visibility||'Public',me,x.created_by));
    if(want('scrap')||kind==='all')out.scrap=db.prepare(`SELECT s.*,u.display_name owner FROM scrap_listings s JOIN users u ON u.id=s.user_id WHERE s.title LIKE ? OR s.description LIKE ? OR s.category LIKE ? ORDER BY s.updated_at DESC LIMIT 20`).all(like,like,like).filter(x=>visibleAuthor(me,x.user_id));
    if(want('wall')||kind==='all')out.wall=db.prepare(`SELECT * FROM wall_exhibitions WHERE status='Published' AND (title LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT 20`).all(like,like).filter(x=>canAccessLevel(x.visibility||'Public',me,x.curator_id));
    return sendJson(res,200,out);
  }
  if(pathname==='/api/export' && method==='GET'){
    const u=requireUser(req,res); if(!u)return; const projects=db.prepare('SELECT * FROM projects WHERE owner_id=?').all(u.id); const pids=projects.map(p=>p.id); const logs=pids.length?db.prepare(`SELECT * FROM build_log_entries WHERE project_id IN (${pids.map(()=>'?').join(',')})`).all(...pids):[]; const questions=db.prepare('SELECT * FROM questions WHERE user_id=?').all(u.id); const questionAnswers=db.prepare('SELECT * FROM answers WHERE user_id=?').all(u.id); const shopNotes=db.prepare('SELECT * FROM shop_notes WHERE user_id=?').all(u.id); const discussions=db.prepare('SELECT * FROM discussion_topics WHERE user_id=?').all(u.id); const discussionReplies=db.prepare('SELECT * FROM discussion_replies WHERE user_id=?').all(u.id); const savedItems=db.prepare('SELECT * FROM saved_items WHERE user_id=?').all(u.id); const collections=db.prepare('SELECT * FROM collections WHERE user_id=?').all(u.id); const collectionItems=collections.length?db.prepare(`SELECT * FROM collection_items WHERE collection_id IN (${collections.map(()=>'?').join(',')})`).all(...collections.map(c=>c.id)):[]; const projectFiles=pids.length?db.prepare(`SELECT id,project_id,uploader_id,logical_name,original_name,mime_type,size_bytes,version,notes,sha256,created_at FROM project_files WHERE project_id IN (${pids.map(()=>'?').join(',')})`).all(...pids):[]; const projectReleases=pids.length?db.prepare(`SELECT * FROM project_releases WHERE project_id IN (${pids.map(()=>'?').join(',')}) ORDER BY created_at`).all(...pids):[]; const releaseIds=projectReleases.map(r=>r.id); const projectReleaseFiles=releaseIds.length?db.prepare(`SELECT * FROM project_release_files WHERE release_id IN (${releaseIds.map(()=>'?').join(',')})`).all(...releaseIds):[]; const clinicSubmissions=db.prepare('SELECT * FROM project_clinic_submissions WHERE user_id=?').all(u.id); const skillContactRequests=db.prepare('SELECT * FROM skill_contact_requests WHERE from_user_id=? OR to_user_id=?').all(u.id,u.id); const teardownContributions=db.prepare('SELECT * FROM teardown_contributions WHERE user_id=?').all(u.id); const scrapListings=db.prepare('SELECT * FROM scrap_listings WHERE user_id=?').all(u.id); const scrapInquiries=db.prepare('SELECT * FROM scrap_inquiries WHERE sender_id=?').all(u.id); const crewMemberships=db.prepare(`SELECT m.*,c.code,c.name,c.city_region FROM maker_crew_members m JOIN maker_crews c ON c.id=m.crew_id WHERE m.user_id=?`).all(u.id); const crewAttendance=db.prepare(`SELECT a.*,e.title event_title,e.crew_id FROM maker_crew_event_attendance a JOIN maker_crew_events e ON e.id=a.event_id WHERE a.user_id=?`).all(u.id); const crewBulletinPosts=db.prepare('SELECT * FROM maker_crew_bulletin_posts WHERE user_id=?').all(u.id); const crewRequests=db.prepare('SELECT * FROM maker_crew_requests WHERE requested_by=?').all(u.id); const craftProgress=db.prepare('SELECT requirement_id,checked,evidence_note,updated_at FROM craft_progress WHERE user_id=?').all(u.id); return sendJson(res,200,{exportedAt:now(),version:APP_VERSION,user:safeUser(u),craftProgress,projects:projects.map(p=>({...p,disciplines:json(p.disciplines),tags:json(p.tags),tools:json(p.tools)})),buildLogEntries:logs,questions,questionAnswers,shopNotes,discussions,discussionReplies,savedItems,collections,collectionItems,notificationPreferences:notificationPrefs(u.id),projectFiles,projectReleases,projectReleaseFiles,clinicSubmissions,skillContactRequests,teardownContributions,scrapListings,scrapInquiries,crewMemberships,crewAttendance,crewBulletinPosts,crewRequests});
  }
  if(pathname==='/api/health' && method==='GET'){ const ownerCount=db.prepare("SELECT COUNT(*) n FROM users WHERE role='Owner' AND account_status='Active'").get().n; return sendJson(res,200,{ok:true,version:APP_VERSION,time:now(),database:'ok',storage:{dataDir:DATA,databasePath:DB_PATH,railwayVolume:Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH),railwayVolumeMountPath:process.env.RAILWAY_VOLUME_MOUNT_PATH||'',externalDataDir:DATA!==path.join(ROOT,'data')},accounts:{activeOwners:ownerCount}}); }
  // v6.0 — THE GEARHEAD CREW
  if(pathname==='/api/gearhead' && method==='GET'){
    releaseDueGearhead();
    const rows=db.prepare(`SELECT g.*,u.display_name author FROM gearhead_entries g JOIN users u ON u.id=g.created_by WHERE g.status='Published' AND (g.publish_at='' OR g.publish_at<=?) ORDER BY g.created_at DESC`).all(now());
    const entries=rows.map(g=>({id:g.id,title:g.title,deck:g.deck,entryType:g.entry_type,heroUrl:g.hero_url,posterUrl:g.poster_url||'',runtimeText:g.runtime_text||'',tags:json(g.tags),createdAt:g.created_at,publicReleaseAt:g.public_release_at,locked:!canAccessLevel(g.access_level,me,g.created_by)}));
    const typeGroups={deepDives:['Tutorial'],shopFilms:['Shop Film'],benchCam:['Bench Cam'],benchRolls:['Bench Roll'],fieldNotes:['Field Note','Behind the Scenes','Crew Update'],earlyAccess:['Early Access','Field Instrument Preview'],downloads:['Download']};
    const sections={};for(const [k,types] of Object.entries(typeGroups))sections[k]=entries.filter(x=>types.includes(x.entryType)).slice(0,8);
    const afterHours=db.prepare("SELECT id,title,description,status,event_type,starts_at,visibility FROM live_events WHERE event_type='After Hours' AND status IN ('Scheduled','Live','Archived') ORDER BY starts_at DESC LIMIT 8").all().map(e=>({...e,locked:!canAccessLevel(e.visibility,me)}));
    let continueItem=null;
    if(me){const ev=db.prepare(`SELECT item_id,MAX(created_at) last_open FROM gearhead_access_events WHERE user_id=? AND kind='open' AND item_type='gearhead_entry' GROUP BY item_id ORDER BY last_open DESC LIMIT 1`).get(me.id);if(ev){const g=entries.find(x=>x.id===ev.item_id&&!x.locked);if(g)continueItem={...g,lastOpened:ev.last_open};}}
    return sendJson(res,200,{active:isSupporterUser(me),membership:me?membershipFor(me.id):null,gearhead:me?gearheadState(me):{active:false,label:'The GearHead Crew',since:''},entries:entries.slice(0,12),sections,continueItem,afterHours,principle:'THE WORKSHOP COMMUNITY STAYS OPEN TO EVERYONE.',canEdit:canEditEditorial(me),provider:membershipProviderInfo()});
  }
  if(pathname==='/api/gearhead/entries' && method==='GET'){
    releaseDueGearhead();
    const type=String(url.searchParams.get('type')||''),q=String(url.searchParams.get('q')||'').trim().toLowerCase();let rows=db.prepare(`SELECT g.*,u.display_name author FROM gearhead_entries g JOIN users u ON u.id=g.created_by WHERE g.status='Published' AND (g.publish_at='' OR g.publish_at<=?) ORDER BY g.created_at DESC`).all(now());if(type)rows=rows.filter(x=>x.entry_type===type);if(q)rows=rows.filter(x=>(x.title+' '+x.deck+' '+x.tags).toLowerCase().includes(q));return sendJson(res,200,{items:rows.map(g=>{const allowed=canAccessLevel(g.access_level,me,g.created_by);return {id:g.id,title:g.title,deck:g.deck,entryType:g.entry_type,heroUrl:g.hero_url,tags:json(g.tags),createdAt:g.created_at,publicReleaseAt:g.public_release_at,locked:!allowed,body:allowed?g.body:undefined,previewText:g.preview_text||'',previewMediaUrl:g.preview_media_url||''};}),active:isSupporterUser(me)});
  }
  if(pathname==='/api/gearhead/archive'&&method==='GET'){releaseDueGearhead();const q=String(url.searchParams.get('q')||'').trim().toLowerCase(),type=String(url.searchParams.get('type')||''),year=String(url.searchParams.get('year')||'');let rows=db.prepare(`SELECT g.*,u.display_name author FROM gearhead_entries g JOIN users u ON u.id=g.created_by WHERE g.status='Published' AND (g.publish_at='' OR g.publish_at<=?) ORDER BY g.created_at DESC`).all(now());if(type)rows=rows.filter(x=>x.entry_type===type);if(year)rows=rows.filter(x=>String(x.created_at||'').startsWith(year));if(q)rows=rows.filter(x=>(x.title+' '+x.deck+' '+x.body+' '+x.tags).toLowerCase().includes(q));const items=rows.map(g=>{const allowed=canAccessLevel(g.access_level,me,g.created_by);return {id:g.id,title:g.title,deck:g.deck,entryType:g.entry_type,createdAt:g.created_at,tags:json(g.tags),locked:!allowed,previewText:g.preview_text||'',body:allowed?g.body:undefined,accessLevel:g.access_level};});return sendJson(res,200,{items,types:[...new Set(rows.map(x=>x.entry_type))],years:[...new Set(rows.map(x=>String(x.created_at||'').slice(0,4)).filter(Boolean))],active:isSupporterUser(me)});}
  if(pathname==='/api/gearhead/entries' && method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Give the GearHead Crew entry a title.'});const gid=id('gh'),ts=now(),status=['Draft','Published','Archived'].includes(body.status)?body.status:'Draft',access=normalizedAccess(body.accessLevel||'GearHead');db.prepare(`INSERT INTO gearhead_entries (id,title,deck,entry_type,body,hero_url,media_url,poster_url,runtime_text,transcript,chapters,related_project_id,related_instrument_id,tags,status,access_level,publish_at,public_release_at,early_status,known_issues,requirements,release_notes,public_target_at,feedback_open,preview_text,preview_media_url,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(gid,title,String(body.deck||''),String(body.entryType||'Field Note'),String(body.body||''),String(body.heroUrl||''),String(body.mediaUrl||''),String(body.posterUrl||''),String(body.runtimeText||''),String(body.transcript||''),JSON.stringify(parseList(body.chapters)),String(body.relatedProjectId||'')||null,String(body.relatedInstrumentId||'')||null,JSON.stringify(parseList(body.tags)),status,access,String(body.publishAt||''),String(body.publicReleaseAt||''),String(body.earlyStatus||'Experimental'),String(body.knownIssues||''),String(body.requirements||''),String(body.releaseNotes||''),String(body.publicTargetAt||''),body.feedbackOpen===false?0:1,String(body.previewText||''),String(body.previewMediaUrl||''),u.id,ts,ts);const photos=Array.isArray(body.photoUrls)?body.photoUrls:parseList(body.photoUrls);photos.filter(Boolean).forEach((raw,i)=>{const [url,...captionParts]=String(raw).split('|');db.prepare(`INSERT INTO gearhead_media (id,entry_id,sort_order,media_type,external_url,caption,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id('ghm'),gid,(i+1)*10,'Image',url.trim(),captionParts.join('|').trim(),ts,ts)});audit(u.id,'gearhead.entry.create','gearhead_entry',gid,{status});if(status==='Published')gearheadNotify('gearhead_publish',`${title} is now available to the GearHead Crew.`,`#/gearhead/${gid}`);return sendJson(res,201,{id:gid});});
  if(pathname==='/api/gearhead/contributions'&&method==='GET'){const u=requireUser(req,res);if(!u)return;if(!isSupporterUser(u)&&!canEditEditorial(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY'});let rows;if(canEditEditorial(u))rows=db.prepare(`SELECT c.*,x.display_name author,g.title entry_title,p.title project_title FROM gearhead_contributions c JOIN users x ON x.id=c.user_id LEFT JOIN gearhead_entries g ON g.id=c.entry_id LEFT JOIN projects p ON p.id=c.project_id ORDER BY c.created_at DESC`).all();else rows=db.prepare(`SELECT c.*,x.display_name author,g.title entry_title,p.title project_title FROM gearhead_contributions c JOIN users x ON x.id=c.user_id LEFT JOIN gearhead_entries g ON g.id=c.entry_id LEFT JOIN projects p ON p.id=c.project_id WHERE c.user_id=? ORDER BY c.created_at DESC`).all(u.id);return sendJson(res,200,{items:rows,canManage:canEditEditorial(u)},gearheadPrivateHeaders());}
  if(pathname==='/api/gearhead/contributions'&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!isSupporterUser(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY'});const cid=id('ghc'),ts=now(),type=String(body.contributionType||'Testing note'),title=String(body.title||'').trim(),text=String(body.body||'').trim();if(!title||!text)return sendJson(res,400,{error:'Add a title and contribution note.'});db.prepare(`INSERT INTO gearhead_contributions (id,user_id,entry_id,project_id,contribution_type,title,body,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(cid,u.id,String(body.entryId||'')||null,String(body.projectId||'')||null,type,title,text,'Submitted',ts,ts);audit(u.id,'gearhead.contribution.submit','gearhead_contribution',cid,{type});return sendJson(res,201,{id:cid},gearheadPrivateHeaders());});
  const ghContribution=pathname.match(/^\/api\/gearhead\/contributions\/([^/]+)$/);if(ghContribution&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const row=db.prepare('SELECT * FROM gearhead_contributions WHERE id=?').get(ghContribution[1]);if(!row)return sendJson(res,404,{error:'Contribution not found.'});const status=String(body.status||row.status),note=String(body.editorNote??row.editor_note);db.prepare('UPDATE gearhead_contributions SET status=?,editor_note=?,updated_at=? WHERE id=?').run(status,note,now(),row.id);notifyUser(row.user_id,'gearhead',`Your GearHead contribution is now ${status}.`,'#/gearhead-contributions','');audit(u.id,'gearhead.contribution.review','gearhead_contribution',row.id,{status});return sendJson(res,200,{ok:true},gearheadPrivateHeaders());});

  if(pathname==='/api/gearhead/crew-projects'&&method==='GET'){const rows=db.prepare(`SELECT c.*,u.display_name author,p.title reference_title,(SELECT COUNT(*) FROM gearhead_crew_project_responses r WHERE r.crew_project_id=c.id) response_count FROM gearhead_crew_projects c JOIN users u ON u.id=c.created_by LEFT JOIN projects p ON p.id=c.reference_project_id ORDER BY CASE c.status WHEN 'Active' THEN 0 ELSE 1 END,c.created_at DESC`).all();let mine={};if(me){for(const r of db.prepare('SELECT crew_project_id,project_id FROM gearhead_crew_project_responses WHERE user_id=?').all(me.id))mine[r.crew_project_id]=r.project_id;}return sendJson(res,200,{items:rows.map(x=>({...x,myProjectId:mine[x.id]||''})),active:isSupporterUser(me),canManage:canEditEditorial(me)},gearheadPrivateHeaders());}
  if(pathname==='/api/gearhead/crew-projects'&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const cid=id('ghcp'),ts=now(),title=String(body.title||'').trim(),brief=String(body.brief||'').trim();if(!title||!brief)return sendJson(res,400,{error:'Title and brief are required.'});db.prepare(`INSERT INTO gearhead_crew_projects (id,title,brief,status,starts_at,ends_at,reference_project_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(cid,title,brief,String(body.status||'Active'),String(body.startsAt||''),String(body.endsAt||''),String(body.referenceProjectId||'')||null,u.id,ts,ts);gearheadNotify('Crew Project',`New GearHead Crew Project: ${title}`,'#/gearhead-projects');return sendJson(res,201,{id:cid},gearheadPrivateHeaders());});
  const ghCrewProjectStart=pathname.match(/^\/api\/gearhead\/crew-projects\/([^/]+)\/start$/);if(ghCrewProjectStart&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!isSupporterUser(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY'});const c=db.prepare('SELECT * FROM gearhead_crew_projects WHERE id=?').get(ghCrewProjectStart[1]);if(!c)return sendJson(res,404,{error:'Crew Project not found.'});const existing=db.prepare('SELECT project_id FROM gearhead_crew_project_responses WHERE crew_project_id=? AND user_id=?').get(c.id,u.id);if(existing)return sendJson(res,200,{projectId:existing.project_id},gearheadPrivateHeaders());const pid=id('p'),ts=now(),title=String(body.title||`${c.title} — ${u.display_name}`);db.prepare(`INSERT INTO projects (id,owner_id,title,slug,description,stage,status,disciplines,tags,cover_emoji,visibility,license,estimated_cost,difficulty,tools,parent_type,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid,u.id,title,slugify(title),String(body.description||c.brief),'Idea','Active','[]',JSON.stringify(['GearHead Crew Project']),'⚙️','Members','Unspecified','','Approachable','[]','GearHead Crew Project',c.id,ts,ts);db.prepare('INSERT INTO gearhead_crew_project_responses (crew_project_id,user_id,project_id,created_at) VALUES (?,?,?,?)').run(c.id,u.id,pid,ts);db.prepare('INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at) VALUES (?,?,?,?,?,?,?)').run(id('log'),pid,u.id,'Idea','Crew Project brief',c.brief,ts);recordGearheadEvent(u.id,'crew_project_start','gearhead_crew_project',c.id,{projectId:pid});return sendJson(res,201,{projectId:pid},gearheadPrivateHeaders());});
  const ghCrewProject=pathname.match(/^\/api\/gearhead\/crew-projects\/([^/]+)$/);if(ghCrewProject&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const c=db.prepare('SELECT * FROM gearhead_crew_projects WHERE id=?').get(ghCrewProject[1]);if(!c)return sendJson(res,404,{error:'Crew Project not found.'});db.prepare('UPDATE gearhead_crew_projects SET title=?,brief=?,status=?,starts_at=?,ends_at=?,reference_project_id=?,updated_at=? WHERE id=?').run(String(body.title??c.title),String(body.brief??c.brief),String(body.status??c.status),String(body.startsAt??c.starts_at),String(body.endsAt??c.ends_at),String(body.referenceProjectId??c.reference_project_id)||null,now(),c.id);return sendJson(res,200,{ok:true},gearheadPrivateHeaders());});

  if(pathname==='/api/gearhead/studio2'&&method==='GET'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const memberships=db.prepare(`SELECT COUNT(*) c FROM users WHERE account_status='Active'`).get().c;const contributions=db.prepare("SELECT COUNT(*) c FROM gearhead_contributions WHERE status IN ('Submitted','Reviewing')").get().c,feedback=db.prepare("SELECT COUNT(*) c FROM gearhead_early_feedback WHERE status='New'").get().c,requests=db.prepare("SELECT COUNT(*) c FROM gearhead_requests WHERE status IN ('Considering','On the Bench')").get().c,drafts=db.prepare("SELECT COUNT(*) c FROM gearhead_entries WHERE status='Draft'").get().c,scheduled=db.prepare("SELECT COUNT(*) c FROM gearhead_entries WHERE status='Published' AND publish_at<>'' AND publish_at>?").get(now()).c,goingPublic=db.prepare("SELECT COUNT(*) c FROM gearhead_entries WHERE access_level='GearHead' AND public_release_at<>'' AND public_release_at>?").get(now()).c,crewProjects=db.prepare("SELECT COUNT(*) c FROM gearhead_crew_projects WHERE status='Active'").get().c,afterHours=db.prepare("SELECT COUNT(*) c FROM live_events WHERE event_type='After Hours' AND starts_at>?").get(now()).c;const activeGearheads=db.prepare("SELECT COUNT(DISTINCT user_id) c FROM membership_connections WHERE status='Active' AND (expires_at='' OR expires_at>?)").get(now()).c+db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('Supporter','Owner','Administrator','Editor') AND account_status='Active'").get().c;const providerFailures=db.prepare("SELECT COUNT(*) c FROM membership_provider_events WHERE status NOT IN ('Applied','Active')").get().c;return sendJson(res,200,{activeGearheads,totalAccounts:memberships,drafts,scheduled,goingPublic,contributions,feedback,requests,crewProjects,afterHours,providerFailures},gearheadPrivateHeaders());}

  const gearEntry=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)$/);
  if(gearEntry&&method==='GET'){const g=db.prepare(`SELECT g.*,u.display_name author,p.title project_title,f.name instrument_name FROM gearhead_entries g JOIN users u ON u.id=g.created_by LEFT JOIN projects p ON p.id=g.related_project_id LEFT JOIN field_instruments f ON f.id=g.related_instrument_id WHERE g.id=?`).get(gearEntry[1]);if(!g)return sendJson(res,404,{error:'GearHead Crew entry not found.'});if(g.status!=='Published'&&!canEditEditorial(me))return sendJson(res,404,{error:'GearHead Crew entry not found.'});if(g.public_release_at&&g.public_release_at<=now()&&g.access_level==='GearHead'){db.prepare("UPDATE gearhead_entries SET access_level='Public',updated_at=? WHERE id=?").run(now(),g.id);g.access_level='Public';}const allowed=canAccessLevel(g.access_level,me,g.created_by);const steps=allowed?db.prepare('SELECT * FROM gearhead_tutorial_steps WHERE entry_id=? ORDER BY sort_order,id').all(g.id).map(s=>({...s,tools:json(s.tools),materials:json(s.materials)})):[];const files=allowed?db.prepare(`SELECT id,logical_name,original_name,mime_type,size_bytes,version,notes,license,created_at,stored_name FROM gearhead_files WHERE entry_id=? ORDER BY logical_name,version DESC`).all(g.id).map(f=>({...f,url:`/gearhead-files/${encodeURIComponent(f.stored_name)}`})):[];const media=allowed?db.prepare('SELECT * FROM gearhead_media WHERE entry_id=? ORDER BY sort_order,id').all(g.id).map(x=>({...x,url:x.stored_name?`/gearhead-media/${encodeURIComponent(x.stored_name)}`:x.external_url})):[];recordGearheadEvent(me?.id||'',allowed?'open':'locked_view','gearhead_entry',g.id,{});return sendJson(res,200,{item:{id:g.id,title:g.title,deck:g.deck,entryType:g.entry_type,body:allowed?g.body:'',heroUrl:g.hero_url,mediaUrl:allowed?g.media_url:'',posterUrl:allowed?(g.poster_url||''):'',runtimeText:allowed?(g.runtime_text||''):'',transcript:allowed?(g.transcript||''):'',chapters:allowed?json(g.chapters):[],relatedProjectId:g.related_project_id||'',projectTitle:g.project_title||'',relatedInstrumentId:g.related_instrument_id||'',instrumentName:g.instrument_name||'',tags:json(g.tags),status:g.status,accessLevel:g.access_level,publishAt:g.publish_at,publicReleaseAt:g.public_release_at,earlyStatus:g.early_status||'Experimental',knownIssues:g.known_issues||'',requirements:g.requirements||'',releaseNotes:g.release_notes||'',publicTargetAt:g.public_target_at||'',feedbackOpen:Number(g.feedback_open)!==0,previewText:g.preview_text||'',previewMediaUrl:g.preview_media_url||'',author:g.author,createdAt:g.created_at,updatedAt:g.updated_at},locked:!allowed,active:isSupporterUser(me),steps,files,media,canEdit:canEditEditorial(me)});}
  if(gearEntry&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const g=db.prepare('SELECT * FROM gearhead_entries WHERE id=?').get(gearEntry[1]);if(!g)return sendJson(res,404,{error:'Entry not found.'});db.prepare(`UPDATE gearhead_entries SET title=?,deck=?,entry_type=?,body=?,hero_url=?,media_url=?,poster_url=?,runtime_text=?,transcript=?,chapters=?,tags=?,status=?,access_level=?,publish_at=?,public_release_at=?,early_status=?,known_issues=?,requirements=?,release_notes=?,public_target_at=?,feedback_open=?,preview_text=?,preview_media_url=?,updated_at=? WHERE id=?`).run(String(body.title||g.title),String(body.deck??g.deck),String(body.entryType||g.entry_type),String(body.body??g.body),String(body.heroUrl??g.hero_url),String(body.mediaUrl??g.media_url),String(body.posterUrl??g.poster_url),String(body.runtimeText??g.runtime_text),String(body.transcript??g.transcript),JSON.stringify(parseList(body.chapters??json(g.chapters))),JSON.stringify(parseList(body.tags??json(g.tags))),String(body.status||g.status),normalizedAccess(body.accessLevel||g.access_level),String(body.publishAt??g.publish_at),String(body.publicReleaseAt??g.public_release_at),String(body.earlyStatus??g.early_status),String(body.knownIssues??g.known_issues),String(body.requirements??g.requirements),String(body.releaseNotes??g.release_notes),String(body.publicTargetAt??g.public_target_at),body.feedbackOpen===undefined?Number(g.feedback_open):(body.feedbackOpen?1:0),String(body.previewText??g.preview_text),String(body.previewMediaUrl??g.preview_media_url),now(),g.id);return sendJson(res,200,{ok:true});});
  const ghSteps=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)\/steps$/);if(ghSteps&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const sid=id('ghs'),ts=now();db.prepare(`INSERT INTO gearhead_tutorial_steps (id,entry_id,sort_order,title,body,image_url,media_url,safety_note,code_text,measurements,warning,tools,materials,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid,ghSteps[1],Number(body.sortOrder||0),String(body.title||'Step'),String(body.body||''),String(body.imageUrl||''),String(body.mediaUrl||''),String(body.safetyNote||''),String(body.codeText||''),String(body.measurements||''),String(body.warning||''),JSON.stringify(parseList(body.tools)),JSON.stringify(parseList(body.materials)),ts,ts);return sendJson(res,201,{id:sid});});
  const ghStep=pathname.match(/^\/api\/gearhead\/steps\/([^/]+)$/);if(ghStep&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const s=db.prepare('SELECT * FROM gearhead_tutorial_steps WHERE id=?').get(ghStep[1]);if(!s)return sendJson(res,404,{error:'Step not found.'});db.prepare(`UPDATE gearhead_tutorial_steps SET sort_order=?,title=?,body=?,image_url=?,media_url=?,safety_note=?,code_text=?,measurements=?,warning=?,tools=?,materials=?,updated_at=? WHERE id=?`).run(Number(body.sortOrder??s.sort_order),String(body.title??s.title),String(body.body??s.body),String(body.imageUrl??s.image_url),String(body.mediaUrl??s.media_url),String(body.safetyNote??s.safety_note),String(body.codeText??s.code_text),String(body.measurements??s.measurements),String(body.warning??s.warning),JSON.stringify(parseList(body.tools??json(s.tools))),JSON.stringify(parseList(body.materials??json(s.materials))),now(),s.id);return sendJson(res,200,{ok:true});});if(ghStep&&method==='DELETE'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;db.prepare('DELETE FROM gearhead_tutorial_steps WHERE id=?').run(ghStep[1]);return sendJson(res,200,{ok:true});}
  const ghMedia=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)\/media$/);if(ghMedia&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const mid=id('ghm'),ts=now();db.prepare(`INSERT INTO gearhead_media (id,entry_id,sort_order,media_type,external_url,caption,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(mid,ghMedia[1],Number(body.sortOrder||0),String(body.mediaType||'Image'),String(body.url||''),String(body.caption||''),ts,ts);return sendJson(res,201,{id:mid});});
  const ghVideoUpload=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)\/video-upload$/);if(ghVideoUpload&&method==='POST'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const g=db.prepare('SELECT * FROM gearhead_entries WHERE id=?').get(ghVideoUpload[1]);if(!g)return sendJson(res,404,{error:'Entry not found.'});const mime=String(req.headers['content-type']||'video/mp4'),original=decodeURIComponent(String(req.headers['x-file-name']||'video.mp4'));if(!mime.startsWith('video/'))return sendJson(res,400,{error:'Choose a video file.'});return readRawBody(req,MAX_GEARHEAD_VIDEO_BYTES).then(buf=>{if(!buf.length)return sendJson(res,400,{error:'Choose a video file.'});const mid=id('ghm'),stored=`${mid}-${safeFilename(original)}`,videoPath=path.join(UPLOADS,stored),ts=now();fs.writeFileSync(videoPath,buf);let duration='';try{const pr=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',videoPath],{encoding:'utf8',timeout:20000});const sec=Math.round(Number(String(pr.stdout||'').trim())||0);if(sec)duration=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;}catch{}
      let posterStored='';try{posterStored=`${mid}-poster.jpg`;const rr=spawnSync('ffmpeg',['-y','-ss','1','-i',videoPath,'-frames:v','1','-vf','scale=1280:-2',path.join(UPLOADS,posterStored)],{timeout:60000,stdio:'ignore'});if(rr.status!==0||!fs.existsSync(path.join(UPLOADS,posterStored)))posterStored='';}catch{posterStored='';}
      db.prepare(`INSERT INTO gearhead_media (id,entry_id,sort_order,media_type,stored_name,mime_type,caption,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(mid,g.id,0,'Video',stored,mime,original,ts,ts);if(posterStored)db.prepare(`INSERT INTO gearhead_media (id,entry_id,sort_order,media_type,stored_name,mime_type,caption,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(id('ghm'),g.id,-1,'Poster',posterStored,'image/jpeg','Auto-generated poster',ts,ts);db.prepare('UPDATE gearhead_entries SET media_url=?,poster_url=?,runtime_text=?,updated_at=? WHERE id=?').run(`/gearhead-media/${encodeURIComponent(stored)}`,posterStored?`/gearhead-media/${encodeURIComponent(posterStored)}`:'',duration,ts,g.id);return sendJson(res,201,{id:mid,mediaUrl:`/gearhead-media/${encodeURIComponent(stored)}`,posterUrl:posterStored?`/gearhead-media/${encodeURIComponent(posterStored)}`:'',runtime:duration,sizeBytes:buf.length});}).catch(e=>sendJson(res,400,{error:e.message}));}
  if(pathname==='/api/gearhead/templates'&&method==='GET'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;return sendJson(res,200,{items:db.prepare('SELECT * FROM gearhead_templates ORDER BY entry_type,name').all().map(x=>({...x,snapshot:json(x.snapshot,{})}))});}
  if(pathname==='/api/gearhead/templates'&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const source=body.entryId?db.prepare('SELECT * FROM gearhead_entries WHERE id=?').get(String(body.entryId)):null;const snapshot=source?{entryType:source.entry_type,deck:source.deck,body:source.body,tags:json(source.tags),accessLevel:source.access_level,earlyStatus:source.early_status,requirements:source.requirements,feedbackOpen:Boolean(source.feedback_open)}:(body.snapshot||{});const tid=id('ght'),ts=now();db.prepare('INSERT INTO gearhead_templates (id,name,description,entry_type,snapshot,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(tid,String(body.name||source?.title||'GearHead Template'),String(body.description||''),String(snapshot.entryType||source?.entry_type||'Field Note'),JSON.stringify(snapshot),u.id,ts,ts);return sendJson(res,201,{id:tid});});
  const ghTemplateUse=pathname.match(/^\/api\/gearhead\/templates\/([^/]+)\/create-entry$/);if(ghTemplateUse&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const t=db.prepare('SELECT * FROM gearhead_templates WHERE id=?').get(ghTemplateUse[1]);if(!t)return sendJson(res,404,{error:'Template not found.'});const x=json(t.snapshot,{}),gid=id('gh'),ts=now();db.prepare(`INSERT INTO gearhead_entries (id,title,deck,entry_type,body,tags,status,access_level,publish_at,created_by,created_at,updated_at,early_status,requirements,feedback_open) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(gid,String(body.title||`${t.name} Copy`),String(x.deck||''),String(x.entryType||t.entry_type),String(x.body||''),JSON.stringify(x.tags||[]),'Draft',String(x.accessLevel||'GearHead'),'',u.id,ts,ts,String(x.earlyStatus||'Experimental'),String(x.requirements||''),x.feedbackOpen===false?0:1);return sendJson(res,201,{id:gid});});
  const ghDuplicate=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)\/duplicate$/);if(ghDuplicate&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const g=db.prepare('SELECT * FROM gearhead_entries WHERE id=?').get(ghDuplicate[1]);if(!g)return sendJson(res,404,{error:'Entry not found.'});const gid=id('gh'),ts=now();db.prepare(`INSERT INTO gearhead_entries (id,title,deck,entry_type,body,hero_url,media_url,related_project_id,related_instrument_id,tags,status,access_level,publish_at,public_release_at,created_by,created_at,updated_at,poster_url,runtime_text,transcript,chapters,early_status,known_issues,requirements,release_notes,public_target_at,feedback_open,preview_text,preview_media_url) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?`).run(gid,String(body.title||`${g.title} — Copy`),g.deck,g.entry_type,g.body,g.hero_url,g.media_url,g.related_project_id,g.related_instrument_id,g.tags,'Draft',g.access_level,'','',u.id,ts,ts,g.poster_url,g.runtime_text,g.transcript,g.chapters,g.early_status,g.known_issues,g.requirements,g.release_notes,g.public_target_at,g.feedback_open,g.preview_text,g.preview_media_url);for(const st of db.prepare('SELECT * FROM gearhead_tutorial_steps WHERE entry_id=? ORDER BY sort_order').all(g.id))db.prepare('INSERT INTO gearhead_tutorial_steps (id,entry_id,sort_order,title,body,image_url,safety_note,created_at,updated_at,media_url,tools,materials,measurements,code_text,warning) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id('ghs'),gid,st.sort_order,st.title,st.body,st.image_url,st.safety_note,ts,ts,st.media_url||'',st.tools||'[]',st.materials||'[]',st.measurements||'',st.code_text||'',st.warning||'');return sendJson(res,201,{id:gid});});
  const ghMediaUpload=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)\/media-upload$/);if(ghMediaUpload&&method==='POST'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const mime=String(req.headers['content-type']||'application/octet-stream'),original=decodeURIComponent(String(req.headers['x-file-name']||'image.bin')),caption=decodeURIComponent(String(req.headers['x-caption']||'')),sortOrder=Number(req.headers['x-sort-order']||0);return readRawBody(req).then(buf=>{if(!buf.length)return sendJson(res,400,{error:'Choose media first.'});if(!mime.startsWith('image/'))return sendJson(res,400,{error:'Bench Roll uploads must be images.'});const mid=id('ghm'),stored=`${mid}-${safeFilename(original)}`,ts=now();fs.writeFileSync(path.join(UPLOADS,stored),buf);db.prepare(`INSERT INTO gearhead_media (id,entry_id,sort_order,media_type,stored_name,mime_type,caption,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(mid,ghMediaUpload[1],sortOrder,'Image',stored,mime,caption,ts,ts);return sendJson(res,201,{id:mid,url:`/gearhead-media/${encodeURIComponent(stored)}`});});}
  const ghMediaItem=pathname.match(/^\/api\/gearhead\/media\/([^/]+)$/);if(ghMediaItem&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;db.prepare('UPDATE gearhead_media SET sort_order=?,caption=?,updated_at=? WHERE id=?').run(Number(body.sortOrder||0),String(body.caption||''),now(),ghMediaItem[1]);return sendJson(res,200,{ok:true});});if(ghMediaItem&&method==='DELETE'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const x=db.prepare('SELECT stored_name FROM gearhead_media WHERE id=?').get(ghMediaItem[1]);db.prepare('DELETE FROM gearhead_media WHERE id=?').run(ghMediaItem[1]);if(x?.stored_name){try{fs.unlinkSync(path.join(UPLOADS,x.stored_name))}catch{}}return sendJson(res,200,{ok:true});}
  const ghFiles=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)\/files$/);if(ghFiles&&method==='POST'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const g=db.prepare('SELECT * FROM gearhead_entries WHERE id=?').get(ghFiles[1]);if(!g)return sendJson(res,404,{error:'Entry not found.'});const original=decodeURIComponent(String(req.headers['x-file-name']||'download.bin')),logical=decodeURIComponent(String(req.headers['x-logical-name']||original)),notes=decodeURIComponent(String(req.headers['x-file-notes']||'')),license=decodeURIComponent(String(req.headers['x-file-license']||'')),mime=String(req.headers['content-type']||'application/octet-stream');return readRawBody(req).then(buf=>{if(!buf.length)return sendJson(res,400,{error:'Choose a file first.'});const prior=db.prepare('SELECT MAX(version) v FROM gearhead_files WHERE entry_id=? AND logical_name=?').get(g.id,logical),version=Number(prior?.v||0)+1,fid=id('ghf'),stored=`${fid}-${safeFilename(original)}`,sha=crypto.createHash('sha256').update(buf).digest('hex');fs.writeFileSync(path.join(UPLOADS,stored),buf);db.prepare(`INSERT INTO gearhead_files (id,entry_id,uploader_id,logical_name,original_name,stored_name,mime_type,size_bytes,version,sha256,notes,license,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(fid,g.id,u.id,logical,original,stored,mime,buf.length,version,sha,notes,license,now());return sendJson(res,201,{id:fid,version,url:`/gearhead-files/${encodeURIComponent(stored)}`});});}
  if(pathname==='/api/gearhead/vault'&&method==='GET'){
    const u=requireUser(req,res);if(!u)return;if(!isSupporterUser(u)&&!canEditEditorial(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY. Join the GearHead Crew to open the File Vault.'});
    const q=String(url.searchParams.get('q')||'').trim().toLowerCase(),type=String(url.searchParams.get('type')||'').trim().toLowerCase();let rows=db.prepare(`SELECT f.id,f.logical_name,f.original_name,f.mime_type,f.size_bytes,f.version,f.sha256,f.notes,f.license,f.created_at,f.stored_name,g.id entry_id,g.title entry_title,g.entry_type FROM gearhead_files f JOIN gearhead_entries g ON g.id=f.entry_id WHERE g.status='Published' ORDER BY f.created_at DESC`).all();if(q)rows=rows.filter(x=>(x.logical_name+' '+x.entry_title+' '+x.notes+' '+x.license).toLowerCase().includes(q));if(type)rows=rows.filter(x=>String(x.mime_type||'').toLowerCase().includes(type));const items=rows.map(x=>({...x,url:`/gearhead-files/${encodeURIComponent(x.stored_name)}`}));recordGearheadEvent(u.id,'open','gearhead_vault','',{count:items.length});return sendJson(res,200,{items,categories:[...new Set(items.map(x=>x.entry_type))]});
  }
  const ghFeedback=pathname.match(/^\/api\/gearhead\/entries\/([^/]+)\/feedback$/);
  if(ghFeedback&&method==='GET'){const u=requireUser(req,res);if(!u)return;const g=db.prepare('SELECT * FROM gearhead_entries WHERE id=?').get(ghFeedback[1]);if(!g)return sendJson(res,404,{error:'Entry not found.'});if(!canAccessLevel(g.access_level,u,g.created_by)&&!canEditEditorial(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY.'});const staff=canEditEditorial(u);const items=staff?db.prepare(`SELECT f.*,x.display_name author FROM gearhead_early_feedback f JOIN users x ON x.id=f.user_id WHERE f.entry_id=? ORDER BY f.created_at DESC`).all(g.id):db.prepare(`SELECT f.*,x.display_name author FROM gearhead_early_feedback f JOIN users x ON x.id=f.user_id WHERE f.entry_id=? AND f.user_id=? ORDER BY f.created_at DESC`).all(g.id,u.id);return sendJson(res,200,{items,canManage:staff,feedbackOpen:Number(g.feedback_open)!==0});}
  if(ghFeedback&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const g=db.prepare('SELECT * FROM gearhead_entries WHERE id=?').get(ghFeedback[1]);if(!g)return sendJson(res,404,{error:'Entry not found.'});if(!isSupporterUser(u)&&!canEditEditorial(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY.'});if(Number(g.feedback_open)===0)return sendJson(res,400,{error:'Feedback is closed for this preview.'});const fid=id('ghfb'),ts=now(),kind=String(body.feedbackType||'Other'),text=String(body.body||'').trim();if(!text)return sendJson(res,400,{error:'Tell us what happened.'});db.prepare(`INSERT INTO gearhead_early_feedback (id,entry_id,user_id,feedback_type,body,platform,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(fid,g.id,u.id,kind,text,String(body.platform||''),'New',ts,ts);notifyUser(g.created_by,'gearhead',`New ${kind} feedback on ${g.title}.`,`#/gearhead/${g.id}`,'');return sendJson(res,201,{id:fid});});
  if(pathname==='/api/gearhead/requests'&&method==='GET'){const u=requireUser(req,res);if(!u)return;if(!isSupporterUser(u)&&!canEditEditorial(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY.'});const staff=canEditEditorial(u);const items=staff?db.prepare(`SELECT r.*,x.display_name author FROM gearhead_requests r JOIN users x ON x.id=r.user_id ORDER BY r.created_at DESC`).all():db.prepare(`SELECT r.*,x.display_name author FROM gearhead_requests r JOIN users x ON x.id=r.user_id WHERE r.user_id=? ORDER BY r.created_at DESC`).all(u.id);return sendJson(res,200,{items,canManage:staff});}
  if(pathname==='/api/gearhead/requests'&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!isSupporterUser(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY.'});const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Give the request a short title.'});const rid=id('ghr'),ts=now();db.prepare(`INSERT INTO gearhead_requests (id,user_id,request_type,title,details,status,response_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(rid,u.id,String(body.requestType||'Tutorial request'),title,String(body.details||''),'Considering','',ts,ts);for(const editor of db.prepare("SELECT id FROM users WHERE role IN ('Owner','Administrator','Editor') AND account_status='Active'").all())notifyUser(editor.id,'gearhead',`GearHead request: ${title}`,'#/gearhead-requests','');return sendJson(res,201,{id:rid});});
  const ghRequestItem=pathname.match(/^\/api\/gearhead\/requests\/([^/]+)$/);if(ghRequestItem&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const r=db.prepare('SELECT * FROM gearhead_requests WHERE id=?').get(ghRequestItem[1]);if(!r)return sendJson(res,404,{error:'Request not found.'});db.prepare('UPDATE gearhead_requests SET status=?,response_note=?,updated_at=? WHERE id=?').run(String(body.status||r.status),String(body.responseNote??r.response_note),now(),r.id);notifyUser(r.user_id,'gearhead',`Your GearHead request “${r.title}” is now ${String(body.status||r.status)}.`,'#/gearhead-requests','');return sendJson(res,200,{ok:true});});
  const ahRsvp=pathname.match(/^\/api\/live\/([^/]+)\/gearhead-rsvp$/);if(ahRsvp&&method==='GET'){const u=requireUser(req,res);if(!u)return;const e=db.prepare("SELECT * FROM live_events WHERE id=? AND event_type='After Hours'").get(ahRsvp[1]);if(!e)return sendJson(res,404,{error:'After Hours event not found.'});if(!canAccessLevel(e.visibility||'GearHead',u,e.created_by))return sendJson(res,403,{error:'GEARHEAD CREW ONLY.'});const mine=db.prepare('SELECT * FROM gearhead_after_hours_rsvps WHERE event_id=? AND user_id=?').get(e.id,u.id)||null;const count=db.prepare("SELECT COUNT(*) c FROM gearhead_after_hours_rsvps WHERE event_id=? AND status IN ('Going','Interested')").get(e.id).c;return sendJson(res,200,{mine,count:Number(count)});}
  if(ahRsvp&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const e=db.prepare("SELECT * FROM live_events WHERE id=? AND event_type='After Hours'").get(ahRsvp[1]);if(!e)return sendJson(res,404,{error:'After Hours event not found.'});if(!isSupporterUser(u)&&!canEditEditorial(u))return sendJson(res,403,{error:'GEARHEAD CREW ONLY.'});const status=['Going','Interested','Not Going'].includes(String(body.status))?String(body.status):'Going',rem=body.reminderRequested===false?0:1,ts=now();db.prepare(`INSERT INTO gearhead_after_hours_rsvps (event_id,user_id,status,reminder_requested,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET status=excluded.status,reminder_requested=excluded.reminder_requested,updated_at=excluded.updated_at`).run(e.id,u.id,status,rem,ts,ts);return sendJson(res,200,{ok:true,status,reminderRequested:Boolean(rem)});});
  if(pathname==='/api/gearhead/analytics'&&method==='GET'){const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const active=db.prepare("SELECT * FROM users WHERE account_status='Active'").all().filter(isSupporterUser).length;const byKind=db.prepare('SELECT kind,COUNT(*) count FROM gearhead_access_events GROUP BY kind ORDER BY count DESC').all();const published=db.prepare("SELECT COUNT(*) c FROM gearhead_entries WHERE status='Published'").get().c;const files=db.prepare('SELECT COUNT(*) c FROM gearhead_files').get().c;const upcoming=db.prepare("SELECT COUNT(*) c FROM live_events WHERE event_type='After Hours' AND status IN ('Scheduled','Live')").get().c;return sendJson(res,200,{activeGearheads:active,publishedEntries:Number(published),files:Number(files),upcomingAfterHours:Number(upcoming),byKind});}

  if(pathname==='/api/stripe/webhook'&&method==='POST'){return readRawBody(req,2_000_000).then(raw=>{if(!verifyStripeSignature(raw,String(req.headers['stripe-signature']||'')))return sendJson(res,400,{error:'Invalid Stripe signature.'});const evt=JSON.parse(raw.toString('utf8'));const obj=evt.data?.object||{};let userId='',subId='';if(evt.type==='checkout.session.completed'&&obj.mode==='subscription'){userId=String(obj.client_reference_id||obj.metadata?.workshop_user_id||'');subId=String(obj.subscription||'');if(userId&&subId)upsertStripeMembership(userId,subId,'Active',{customerId:String(obj.customer||''),checkoutSessionId:String(obj.id||''),plan:String(obj.metadata?.workshop_plan||'')});}
    if(evt.type.startsWith('customer.subscription.')){subId=String(obj.id||'');const existing=db.prepare("SELECT * FROM membership_connections WHERE provider='Stripe' AND external_id=?").get(subId);userId=String(obj.metadata?.workshop_user_id||existing?.user_id||'');if(userId&&subId){const active=['active','trialing','past_due'].includes(String(obj.status||''));const status=active?'Active':(obj.status==='canceled'?'Cancelled':'Expired');const expiresAt=obj.current_period_end?new Date(Number(obj.current_period_end)*1000).toISOString():'';upsertStripeMembership(userId,subId,status,{customerId:String(obj.customer||''),stripeStatus:String(obj.status||''),expiresAt,plan:String(obj.metadata?.workshop_plan||json(existing?.metadata,{}).plan||'')});}}
    if(userId)db.prepare('INSERT INTO membership_provider_events (id,provider,external_id,event_type,user_id,status,payload,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id('mpe'),'Stripe',subId,String(evt.type||'webhook'),userId,'Applied',JSON.stringify(evt),now());return sendJson(res,200,{received:true});}).catch(e=>sendJson(res,400,{error:e.message}));}
  if(pathname==='/api/membership/stripe-checkout'&&method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const requested=String(body.plan||'').toLowerCase();const plan=requested==='annual'||requested==='yearly'?'annual':requested==='monthly'?'monthly':'';const priceId=stripePlanPriceId(plan);if(!STRIPE_SECRET_KEY||!priceId)return sendJson(res,503,{error:plan?`Stripe ${plan} Checkout is not configured.`:'Stripe Checkout is not configured.'});const base=PUBLIC_URL||`http://${req.headers.host}`;const planLabel=plan||((priceId===STRIPE_ANNUAL_PRICE_ID&&STRIPE_ANNUAL_PRICE_ID)?'annual':(priceId===STRIPE_MONTHLY_PRICE_ID&&STRIPE_MONTHLY_PRICE_ID)?'monthly':'legacy');return stripeRequest('/v1/checkout/sessions',{'mode':'subscription','line_items[0][price]':priceId,'line_items[0][quantity]':'1','success_url':`${base}/#/gearhead?checkout=success`,'cancel_url':`${base}/#/gearhead?checkout=cancelled`,'client_reference_id':u.id,'customer_email':u.email,'metadata[workshop_user_id]':u.id,'metadata[workshop_plan]':planLabel,'subscription_data[metadata][workshop_user_id]':u.id,'subscription_data[metadata][workshop_plan]':planLabel,'allow_promotion_codes':'true'}).then(x=>sendJson(res,200,{url:x.url,id:x.id,plan:planLabel})).catch(e=>sendJson(res,502,{error:e.message}));});}
  if(pathname==='/api/membership/stripe-portal'&&method==='POST'){const u=requireUser(req,res);if(!u)return;const m=db.prepare("SELECT * FROM membership_connections WHERE user_id=? AND provider='Stripe' ORDER BY updated_at DESC LIMIT 1").get(u.id);const customerId=json(m?.metadata,{}).customerId;if(!customerId)return sendJson(res,400,{error:'No Stripe customer is attached to this account yet.'});const base=PUBLIC_URL||`http://${req.headers.host}`;return stripeRequest('/v1/billing_portal/sessions',{customer:customerId,return_url:`${base}/#/gearhead`}).then(x=>sendJson(res,200,{url:x.url})).catch(e=>sendJson(res,502,{error:e.message}));}
  if(pathname==='/api/membership' && method==='GET'){const u=requireUser(req,res);if(!u)return;const membership=membershipFor(u.id);const pref=emailPrefs(u.id);const history=db.prepare('SELECT id,provider,status,label,starts_at,expires_at,created_at,updated_at,metadata FROM membership_connections WHERE user_id=? ORDER BY updated_at DESC LIMIT 12').all(u.id).map(x=>({...x,metadata:json(x.metadata,{})}));return sendJson(res,200,{membership,supporter:isSupporterUser(u),provider:membershipProviderInfo(),history,digest:{enabled:Number(pref.gearhead_digest)!==0,frequency:pref.gearhead_digest_frequency||'Monthly'}});}
  if(pathname==='/api/membership/cancel'&&method==='POST'){const u=requireUser(req,res);if(!u)return;const m=membershipFor(u.id);if(!m)return sendJson(res,400,{error:'No active GearHead membership.'});const row=db.prepare('SELECT * FROM membership_connections WHERE id=?').get(m.id),meta=json(row.metadata,{});if(meta.manageUrl||GEARHEAD_MANAGE_URL)return sendJson(res,409,{error:'This membership is managed by an external provider.',manageUrl:meta.manageUrl||GEARHEAD_MANAGE_URL});db.prepare("UPDATE membership_connections SET status='Cancelled',updated_at=? WHERE id=?").run(now(),m.id);refreshSupporterRole(u.id);audit(u.id,'membership.cancel','membership',m.id,{provider:m.provider});return sendJson(res,200,{ok:true,user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))});}
  if(pathname==='/api/gearhead/digest-preferences'&&method==='PUT')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;emailPrefs(u.id);const freq=['Weekly','Monthly','Off'].includes(String(body.frequency))?String(body.frequency):'Monthly',enabled=body.enabled===false||freq==='Off'?0:1;db.prepare('UPDATE email_preferences SET gearhead_digest=?,gearhead_digest_frequency=?,updated_at=? WHERE user_id=?').run(enabled,freq,now(),u.id);return sendJson(res,200,{ok:true,enabled:Boolean(enabled),frequency:freq});});
  if(pathname==='/api/membership/provider-sync'&&method==='POST')return readBody(req).then(body=>{if(!MEMBERSHIP_SYNC_SECRET||String(req.headers.authorization||'')!==`Bearer ${MEMBERSHIP_SYNC_SECRET}`)return sendJson(res,403,{error:'Provider sync is not authorized.'});const email=String(body.email||'').trim().toLowerCase(),provider=String(body.provider||MEMBERSHIP_PROVIDER||'external'),externalId=String(body.externalId||''),status=['Active','Cancelled','Expired'].includes(String(body.status))?String(body.status):'Active';const target=db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email);if(!target)return sendJson(res,404,{error:'No Workshop account matches that provider email.'});const ts=now(),existing=externalId?db.prepare('SELECT * FROM membership_connections WHERE provider=? AND external_id=?').get(provider,externalId):null,meta={...(body.metadata||{}),manageUrl:String(body.manageUrl||'')};if(existing)db.prepare('UPDATE membership_connections SET status=?,label=?,starts_at=?,expires_at=?,metadata=?,updated_at=? WHERE id=?').run(status,String(body.label||existing.label||'GearHead Crew'),String(body.startsAt||existing.starts_at||ts),String(body.expiresAt||''),JSON.stringify(meta),ts,existing.id);else db.prepare('INSERT INTO membership_connections (id,user_id,provider,external_id,status,label,starts_at,expires_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id('member'),target.id,provider,externalId,status,String(body.label||'GearHead Crew'),String(body.startsAt||ts),String(body.expiresAt||''),JSON.stringify(meta),ts,ts);db.prepare('INSERT INTO membership_provider_events (id,provider,external_id,event_type,user_id,status,payload,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id('mpe'),provider,externalId,'sync',target.id,status,JSON.stringify(body),ts);refreshSupporterRole(target.id);return sendJson(res,200,{ok:true,userId:target.id,status});});
  if(pathname==='/api/membership/redeem' && method==='POST'){const u=requireUser(req,res);if(!u)return;return readBody(req).then(body=>{const code=String(body.code||'').trim().toUpperCase();const c=db.prepare("SELECT * FROM membership_invite_codes WHERE code=? AND status='Active'").get(code);if(!c||Number(c.uses)>=Number(c.max_uses)|| (c.expires_at&&c.expires_at<=now()))return sendJson(res,400,{error:'That supporter code is not valid.'});const ts=now(),mid=id('member');db.prepare(`INSERT INTO membership_connections (id,user_id,provider,external_id,status,label,starts_at,expires_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(mid,u.id,'Invite',code,'Active',c.label||'Workshop Supporter',ts,'','{}',ts,ts);db.prepare("UPDATE membership_invite_codes SET uses=uses+1,status=CASE WHEN uses+1>=max_uses THEN 'Used' ELSE status END WHERE code=?").run(code);if(u.role==='Member')db.prepare("UPDATE users SET role='Supporter' WHERE id=?").run(u.id);audit(u.id,'membership.redeem','membership',mid,{code});return sendJson(res,200,{membership:membershipFor(u.id),user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))});});}
  if(pathname==='/api/admin/memberships' && method==='GET'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;const items=db.prepare(`SELECT m.*,u.display_name,u.email FROM membership_connections m JOIN users u ON u.id=m.user_id ORDER BY m.updated_at DESC`).all().map(x=>({...x,metadata:json(x.metadata,{})}));const codes=db.prepare('SELECT * FROM membership_invite_codes ORDER BY created_at DESC').all();return sendJson(res,200,{items,codes});}
  if(pathname==='/api/admin/memberships' && method==='POST'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return readBody(req).then(body=>{const target=db.prepare('SELECT * FROM users WHERE id=?').get(String(body.userId||''));if(!target)return sendJson(res,404,{error:'Member not found.'});const provider=['Substack','Patreon','Stripe','Direct','Invite','Manual','Gift','Complimentary','Lifetime'].includes(body.provider)?body.provider:'Direct',ts=now(),mid=id('member');db.prepare(`INSERT INTO membership_connections (id,user_id,provider,external_id,status,label,starts_at,expires_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(mid,target.id,provider,String(body.externalId||''),String(body.status||'Active'),String(body.label||'Workshop Supporter'),String(body.startsAt||ts),String(body.expiresAt||''),JSON.stringify(body.metadata||{}),ts,ts);if(String(body.status||'Active')==='Active'&&target.role==='Member')db.prepare("UPDATE users SET role='Supporter' WHERE id=?").run(target.id);audit(u.id,'membership.create','membership',mid,{provider,userId:target.id});return sendJson(res,201,{id:mid});});}
  if(pathname==='/api/admin/membership-codes' && method==='POST'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return readBody(req).then(body=>{const code=String(body.code||crypto.randomBytes(5).toString('hex')).toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,24);if(!code)return sendJson(res,400,{error:'Add a usable invite code.'});db.prepare(`INSERT INTO membership_invite_codes (code,label,status,max_uses,uses,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(code,String(body.label||'Workshop Supporter'),'Active',Math.max(1,Number(body.maxUses||1)),0,String(body.expiresAt||''),u.id,now());audit(u.id,'membership.code.create','membership_code',code,{});return sendJson(res,201,{code});});}
  if(pathname==='/api/admin/overview' && method==='GET'){
    const u=requireRole(req,res,['Owner','Administrator','Moderator']);if(!u)return;
    const stats={users:db.prepare('SELECT COUNT(*) c FROM users').get().c,activeProjects:db.prepare("SELECT COUNT(*) c FROM projects WHERE status='Active'").get().c,openReports:db.prepare("SELECT COUNT(*) c FROM content_reports WHERE status IN ('Open','Reviewing')").get().c,suspended:db.prepare("SELECT COUNT(*) c FROM users WHERE account_status<>'Active'").get().c,auditEvents:db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c};
    const recent=db.prepare(`SELECT r.*,u.display_name reporter,a.display_name assignee FROM content_reports r JOIN users u ON u.id=r.reporter_id LEFT JOIN users a ON a.id=r.assignee_id ORDER BY CASE r.status WHEN 'Open' THEN 0 WHEN 'Reviewing' THEN 1 ELSE 2 END,r.created_at DESC LIMIT 8`).all();
    return sendJson(res,200,{stats,recent});
  }



  // v4.8–v5.6 — Maker Crews / local workshop
  if(pathname==='/api/crews'&&method==='GET') return sendJson(res,200,{items:crewDiscovery(url.searchParams.get('postal')||'',me),myCrew:me&&primaryCrew(me.id)?crewRow(primaryCrew(me.id),me):null});
  if(pathname==='/api/crew-home'&&method==='GET'){
    if(!me)return sendJson(res,200,{crew:null});const c=primaryCrew(me.id);if(!c)return sendJson(res,200,{crew:null});const p=crewPayload(c,me);return sendJson(res,200,{crew:{id:p.id,code:p.code,name:p.name,cityRegion:p.city_region,nextEvent:p.nextEvent,projectCount:p.projectCount,bulletin:p.bulletin.slice(0,3),tools:p.tools.slice(0,3),scrap:p.scrap.slice(0,3)}});
  }
  if(pathname==='/api/crew-requests'&&method==='GET'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return sendJson(res,200,{items:db.prepare(`SELECT r.*,u.display_name requester FROM maker_crew_requests r JOIN users u ON u.id=r.requested_by ORDER BY CASE r.status WHEN 'Submitted' THEN 0 WHEN 'Reviewing' THEN 1 ELSE 2 END,r.created_at DESC`).all().map(x=>({...x,nearbyPostalCodes:json(x.nearby_postal_codes)}))});}
  if(pathname==='/api/crew-requests'&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const postal=String(body.postalCode||'').trim().toUpperCase(),name=String(body.name||'').trim(),why=String(body.rationale||'').trim();if(!postal||!name||!why)return sendJson(res,400,{error:'Crew request needs an anchor postal code, proposed name, and rationale.'});const rid=id('creq'),ts=now();db.prepare(`INSERT INTO maker_crew_requests (id,requested_by,proposed_postal_code,proposed_name,city_region,country,nearby_postal_codes,rationale,proposed_organizers,existing_group_url,estimated_participants,status,reviewer_notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(rid,u.id,postal,name,String(body.cityRegion||''),String(body.country||'US'),JSON.stringify(parseList(body.nearbyPostalCodes)),why,String(body.organizers||''),String(body.existingGroupUrl||''),Math.max(0,Number(body.estimatedParticipants||0)),'Submitted','',ts,ts);audit(u.id,'crew.request','maker_crew_request',rid,{postal,name});notifyAdmins('moderation',`New Maker Crew request: ${name} (${postal})`,'#/admin',`New Maker Crew request — ${name} / ${postal}`,`Requester: ${u.display_name} (${u.email})\nProposed Crew: ${name}\nAnchor postal code: ${postal}\nRegion: ${String(body.cityRegion||'')}\nExpected participants: ${Math.max(0,Number(body.estimatedParticipants||0))}\n\n${why}`,'emailCrewRequests');return sendJson(res,201,{id:rid});}).catch(e=>sendJson(res,400,{error:e.message}));
  if(pathname==='/api/crews'&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;const postal=String(body.anchorPostalCode||'').trim().toUpperCase(),name=String(body.name||'').trim();if(!postal||!name)return sendJson(res,400,{error:'A Maker Crew needs a name and anchor postal code.'});const cid=id('crew'),ts=now(),code=String(body.code||crewCode(postal)).trim().toUpperCase();db.prepare(`INSERT INTO maker_crews (id,code,name,anchor_postal_code,city_region,country,description,cover_url,status,visibility,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cid,code,name,postal,String(body.cityRegion||''),String(body.country||'US'),String(body.description||''),String(body.coverUrl||''),String(body.status||'Active'),canonicalVisibility(body.visibility,'Public'),u.id,ts,ts);db.prepare(`INSERT INTO maker_crew_postal_codes (crew_id,postal_code,latitude,longitude,is_anchor,created_at) VALUES (?,?,?,?,?,?)`).run(cid,postal,body.latitude===''||body.latitude==null?null:Number(body.latitude),body.longitude===''||body.longitude==null?null:Number(body.longitude),1,ts);db.prepare(`INSERT INTO maker_crew_members (crew_id,user_id,role,status,affiliation_visibility,is_primary,joined_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(cid,u.id,'Organizer','Active','Public',1,ts,ts);audit(u.id,'crew.create','maker_crew',cid,{code,name});return sendJson(res,201,{id:cid,code});}).catch(e=>sendJson(res,400,{error:e.message}));
  const crewMatch=pathname.match(/^\/api\/crews\/([^/]+)$/);
  if(crewMatch&&method==='GET'){const c=db.prepare('SELECT * FROM maker_crews WHERE id=? OR code=?').get(crewMatch[1],String(crewMatch[1]).toUpperCase());const payload=crewPayload(c,me);if(!payload)return sendJson(res,404,{error:'Maker Crew not found.'});return sendJson(res,200,{item:payload});}
  if(crewMatch&&method==='PUT')return readBody(req).then(body=>{const c=db.prepare('SELECT * FROM maker_crews WHERE id=?').get(crewMatch[1]);if(!c)return sendJson(res,404,{error:'Crew not found.'});const u=requireUser(req,res);if(!u||!isCrewOrganizer(c.id,u))return sendJson(res,403,{error:'Crew organizer access required.'});db.prepare(`UPDATE maker_crews SET name=?,city_region=?,description=?,cover_url=?,status=?,visibility=?,updated_at=? WHERE id=?`).run(String(body.name??c.name),String(body.cityRegion??c.city_region),String(body.description??c.description),String(body.coverUrl??c.cover_url),String(body.status??c.status),String(body.visibility??c.visibility),now(),c.id);audit(u.id,'crew.update','maker_crew',c.id,{});return sendJson(res,200,{ok:true});}).catch(e=>sendJson(res,400,{error:e.message}));
  const joinMatch=pathname.match(/^\/api\/crews\/([^/]+)\/join$/);
  if(joinMatch&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const c=db.prepare('SELECT * FROM maker_crews WHERE id=?').get(joinMatch[1]);if(!c||c.status!=='Active')return sendJson(res,404,{error:'Crew not available.'});const ts=now(),primary=body.primary!==false?1:0;if(primary)db.prepare('UPDATE maker_crew_members SET is_primary=0 WHERE user_id=?').run(u.id);db.prepare(`INSERT INTO maker_crew_members (crew_id,user_id,role,status,affiliation_visibility,is_primary,joined_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(crew_id,user_id) DO UPDATE SET status='Active',affiliation_visibility=excluded.affiliation_visibility,is_primary=excluded.is_primary,updated_at=excluded.updated_at`).run(c.id,u.id,'Member','Active',canonicalVisibility(body.visibility,'Members'),primary,ts,ts);audit(u.id,'crew.join','maker_crew',c.id,{});return sendJson(res,200,{ok:true});}).catch(e=>sendJson(res,400,{error:e.message}));
  if(joinMatch&&method==='DELETE'){const u=requireUser(req,res);if(!u)return;db.prepare("UPDATE maker_crew_members SET status='Left',is_primary=0,updated_at=? WHERE crew_id=? AND user_id=?").run(now(),joinMatch[1],u.id);audit(u.id,'crew.leave','maker_crew',joinMatch[1],{});return sendJson(res,200,{ok:true});}
  const coverageMatch=pathname.match(/^\/api\/crews\/([^/]+)\/postal-codes$/);
  if(coverageMatch&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u||!isCrewOrganizer(coverageMatch[1],u))return sendJson(res,403,{error:'Crew organizer access required.'});const postal=String(body.postalCode||'').trim().toUpperCase();if(!postal)return sendJson(res,400,{error:'Add a postal code.'});db.prepare(`INSERT INTO maker_crew_postal_codes (crew_id,postal_code,latitude,longitude,is_anchor,created_at) VALUES (?,?,?,?,0,?) ON CONFLICT(crew_id,postal_code) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude`).run(coverageMatch[1],postal,body.latitude===''||body.latitude==null?null:Number(body.latitude),body.longitude===''||body.longitude==null?null:Number(body.longitude),now());return sendJson(res,201,{ok:true});});
  const crewEvents=pathname.match(/^\/api\/crews\/([^/]+)\/events$/);
  if(crewEvents&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u||!isCrewOrganizer(crewEvents[1],u))return sendJson(res,403,{error:'Crew organizer access required.'});const title=String(body.title||'').trim(),starts=String(body.startsAt||'').trim();if(!title||!starts)return sendJson(res,400,{error:'A meetup needs a title and start time.'});const eid=id('cevt'),ts=now();db.prepare(`INSERT INTO maker_crew_events (id,crew_id,title,event_type,description,starts_at,ends_at,venue_name,city_region,exact_address,address_visibility,capacity,approval_required,what_to_bring,safety_notes,status,visibility,related_project_id,related_session_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eid,crewEvents[1],title,String(body.eventType||'Open Bench'),String(body.description||''),starts,String(body.endsAt||''),String(body.venueName||''),String(body.cityRegion||''),String(body.exactAddress||''),String(body.addressVisibility||'Attendees'),Math.max(0,Number(body.capacity||0)),body.approvalRequired?1:0,String(body.whatToBring||''),String(body.safetyNotes||''),'Scheduled',canonicalVisibility(body.visibility,'Members'),String(body.relatedProjectId||'')||null,String(body.relatedSessionId||'')||null,u.id,ts,ts);audit(u.id,'crew.event.create','maker_crew_event',eid,{crewId:crewEvents[1]});return sendJson(res,201,{id:eid});}).catch(e=>sendJson(res,400,{error:e.message}));
  const eventAttend=pathname.match(/^\/api\/crew-events\/([^/]+)\/attendance$/);
  if(eventAttend&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const e=db.prepare('SELECT * FROM maker_crew_events WHERE id=?').get(eventAttend[1]);if(!e)return sendJson(res,404,{error:'Meetup not found.'});if(!crewRole(e.crew_id,u.id))return sendJson(res,403,{error:'Join the Crew before responding to this meetup.'});const status=['Interested','Going','Attended','Cancelled'].includes(body.status)?body.status:'Going';const approved=e.approval_required?0:1,ts=now();db.prepare(`INSERT INTO maker_crew_event_attendance (event_id,user_id,status,approved,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET status=excluded.status,approved=CASE WHEN maker_crew_event_attendance.approved=1 THEN 1 ELSE excluded.approved END,updated_at=excluded.updated_at`).run(e.id,u.id,status,approved,ts,ts);if(e.approval_required&&!approved){const organizers=db.prepare(`SELECT m.user_id,u.display_name FROM maker_crew_members m JOIN users u ON u.id=m.user_id WHERE m.crew_id=? AND m.status='Active' AND m.role IN ('Organizer','Moderator')`).all(e.crew_id);for(const o of organizers){notifyUser(o.user_id,'event',`${u.display_name} requested to attend ${e.title}.`,`#/crew/${e.crew_id}`,u.id);emailUser(o.user_id,'crew_attendance','crew_attendance',`Attendance request — ${e.title}`,`${u.display_name} requested to attend ${e.title}.\n\nReview the Crew meetup: ${absoluteHash(`#/crew/${e.crew_id}`)}`);}}return sendJson(res,200,{ok:true,pending:Boolean(e.approval_required&&!approved)});});
  const eventApproval=pathname.match(/^\/api\/crew-events\/([^/]+)\/attendance\/([^/]+)$/);
  if(eventApproval&&method==='PUT')return readBody(req).then(body=>{const e=db.prepare('SELECT * FROM maker_crew_events WHERE id=?').get(eventApproval[1]);const u=requireUser(req,res);if(!e||!u||!isCrewOrganizer(e.crew_id,u))return sendJson(res,403,{error:'Crew organizer access required.'});const approved=body.approved?1:0,status=String(body.status||'Going');db.prepare('UPDATE maker_crew_event_attendance SET approved=?,status=?,updated_at=? WHERE event_id=? AND user_id=?').run(approved,status,now(),e.id,eventApproval[2]);notifyUser(eventApproval[2],'event',approved?`Your attendance request for ${e.title} was approved.`:`Your attendance request for ${e.title} was declined.`,`#/crew/${e.crew_id}`,u.id);emailUser(eventApproval[2],'crew_attendance','crew_attendance',`${approved?'Approved':'Update'} — ${e.title}`,approved?`Your attendance request for ${e.title} was approved. Open the Crew meetup for details: ${absoluteHash(`#/crew/${e.crew_id}`)}`:`Your attendance request for ${e.title} was not approved. Open the Crew page for details: ${absoluteHash(`#/crew/${e.crew_id}`)}`);return sendJson(res,200,{ok:true});});
  const crewAnnouncements=pathname.match(/^\/api\/crews\/([^/]+)\/announcements$/);
  if(crewAnnouncements&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u||!isCrewOrganizer(crewAnnouncements[1],u))return sendJson(res,403,{error:'Crew organizer access required.'});const title=String(body.title||'').trim(),text=String(body.body||'').trim();if(!title||!text)return sendJson(res,400,{error:'Announcement needs a title and message.'});const aid=id('cann'),ts=now();db.prepare(`INSERT INTO maker_crew_announcements (id,crew_id,created_by,title,body,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(aid,crewAnnouncements[1],u.id,title,text,canonicalVisibility(body.visibility,'Members'),ts,ts);return sendJson(res,201,{id:aid});});
  const crewBulletin=pathname.match(/^\/api\/crews\/([^/]+)\/bulletin$/);
  if(crewBulletin&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!crewRole(crewBulletin[1],u.id))return sendJson(res,403,{error:'Join the Crew to post on its bulletin board.'});const title=String(body.title||'').trim(),text=String(body.body||'').trim();if(!title||!text)return sendJson(res,400,{error:'Bulletin post needs a title and message.'});const bid=id('cb'),ts=now();db.prepare(`INSERT INTO maker_crew_bulletin_posts (id,crew_id,user_id,post_type,title,body,expires_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(bid,crewBulletin[1],u.id,String(body.postType||'Question'),title,text,String(body.expiresAt||''),'Active',ts,ts);return sendJson(res,201,{id:bid});});
  const crewCreateProject=pathname.match(/^\/api\/crews\/([^/]+)\/projects$/);
  if(crewCreateProject&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!crewRole(crewCreateProject[1],u.id))return sendJson(res,403,{error:'Join the Crew to start a Crew project.'});const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Give the project a name.'});const pid=id('p'),ts=now();db.prepare(`INSERT INTO projects (id,owner_id,title,slug,description,stage,status,disciplines,tags,cover_emoji,visibility,license,estimated_cost,difficulty,tools,materials,website,github_repo,cover_url,project_type,parent_type,parent_id,crew_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid,u.id,title,slugify(title),String(body.description||''),String(body.stage||'Idea'),'Active','[]',JSON.stringify(parseList(body.tags)),String(body.coverEmoji||'✦'),canonicalVisibility(body.visibility,'Members'),'Unspecified','',String(body.difficulty||'Approachable'),'[]','[]','','','',String(body.projectType||'Project'),null,null,crewCreateProject[1],ts,ts);return sendJson(res,201,{id:pid});});
  const crewCreateQuestion=pathname.match(/^\/api\/crews\/([^/]+)\/questions$/);
  if(crewCreateQuestion&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!crewRole(crewCreateQuestion[1],u.id))return sendJson(res,403,{error:'Join the Crew to ask locally.'});const title=String(body.title||'').trim(),trying=String(body.trying||'').trim();if(!title||!trying)return sendJson(res,400,{error:'Local question needs a title and what you are trying to do.'});const qid=id('q'),ts=now();db.prepare(`INSERT INTO questions (id,user_id,title,trying,tried,happened,help_needed,status,created_at,updated_at,crew_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(qid,u.id,title,trying,String(body.tried||''),String(body.happened||''),String(body.helpNeeded||''),'Open',ts,ts,crewCreateQuestion[1]);return sendJson(res,201,{id:qid});});
  const crewCreateScrap=pathname.match(/^\/api\/crews\/([^/]+)\/scrap$/);
  if(crewCreateScrap&&method==='POST')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;if(!crewRole(crewCreateScrap[1],u.id))return sendJson(res,403,{error:'Join the Crew to offer something locally.'});const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'Describe what is available.'});const sid=id('scrap'),ts=now();db.prepare(`INSERT INTO scrap_listings (id,user_id,title,category,description,exchange_type,city_region,condition_text,quantity_text,image_url,status,created_at,updated_at,crew_id,scope,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid,u.id,title,String(body.category||'Other'),String(body.description||''),String(body.exchangeType||'Free'),String(body.cityRegion||''),String(body.conditionText||''),String(body.quantityText||''),'','Available',ts,ts,crewCreateScrap[1],'My Crew',canonicalVisibility(body.visibility,'Members'));return sendJson(res,201,{id:sid});});


  const crewRequestMatch=pathname.match(/^\/api\/crew-requests\/([^/]+)$/);
  if(crewRequestMatch&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;const r=db.prepare('SELECT * FROM maker_crew_requests WHERE id=?').get(crewRequestMatch[1]);if(!r)return sendJson(res,404,{error:'Crew request not found.'});const status=['Submitted','Reviewing','Approved','Declined'].includes(body.status)?body.status:r.status;db.prepare('UPDATE maker_crew_requests SET status=?,reviewer_notes=?,updated_at=? WHERE id=?').run(status,String(body.reviewerNotes??r.reviewer_notes),now(),r.id);let crewId='';if(status==='Approved'&&body.createCrew&&!db.prepare('SELECT 1 FROM maker_crews WHERE anchor_postal_code=?').get(r.proposed_postal_code)){const ts=now();crewId=id('crew');const code=crewCode(r.proposed_postal_code);db.prepare(`INSERT INTO maker_crews (id,code,name,anchor_postal_code,city_region,country,description,cover_url,status,visibility,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crewId,code,r.proposed_name,r.proposed_postal_code,r.city_region,r.country,r.rationale,'','Active','Public',u.id,ts,ts);db.prepare(`INSERT INTO maker_crew_postal_codes (crew_id,postal_code,is_anchor,created_at) VALUES (?,?,1,?)`).run(crewId,r.proposed_postal_code,ts);for(const z of json(r.nearby_postal_codes))db.prepare(`INSERT OR IGNORE INTO maker_crew_postal_codes (crew_id,postal_code,is_anchor,created_at) VALUES (?,?,0,?)`).run(crewId,String(z).toUpperCase(),ts);db.prepare(`INSERT INTO maker_crew_members (crew_id,user_id,role,status,affiliation_visibility,is_primary,joined_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(crewId,r.requested_by,'Organizer','Active','Members',1,ts,ts);}audit(u.id,'crew.request.review','maker_crew_request',r.id,{status,crewId});notifyUser(r.requested_by,'moderation',status==='Approved'?`Your Maker Crew request for ${r.proposed_name} was approved.`:`Your Maker Crew request for ${r.proposed_name} was ${status.toLowerCase()}.`,crewId?`#/crew/${crewId}`:'#/crews',u.id);emailUser(r.requested_by,'moderation','crew_request_review',`Maker Crew request ${status.toLowerCase()} — ${r.proposed_name}`,`Your Maker Crew request for ${r.proposed_name} (${r.proposed_postal_code}) is now ${status}. ${crewId?`Open the Crew: ${absoluteHash(`#/crew/${crewId}`)}`:''}`);return sendJson(res,200,{ok:true,status,crewId});});
  const crewMemberManage=pathname.match(/^\/api\/crews\/([^/]+)\/members\/([^/]+)$/);
  if(crewMemberManage&&method==='PUT')return readBody(req).then(body=>{const u=requireUser(req,res);if(!u||!isCrewOrganizer(crewMemberManage[1],u))return sendJson(res,403,{error:'Crew organizer access required.'});const role=['Member','Organizer','Moderator'].includes(body.role)?body.role:null,status=['Active','Suspended','Left'].includes(body.status)?body.status:null;const m=db.prepare('SELECT * FROM maker_crew_members WHERE crew_id=? AND user_id=?').get(crewMemberManage[1],crewMemberManage[2]);if(!m)return sendJson(res,404,{error:'Crew member not found.'});db.prepare('UPDATE maker_crew_members SET role=?,status=?,updated_at=? WHERE crew_id=? AND user_id=?').run(role||m.role,status||m.status,now(),m.crew_id,m.user_id);audit(u.id,'crew.member.update','maker_crew',m.crew_id,{userId:m.user_id,role:role||m.role,status:status||m.status});return sendJson(res,200,{ok:true});});

  // v4.1–v4.7 — Sessions, Assignments, Show the Work, Walk the Benches, Maker ID, Session Studio
  if(pathname==='/api/sessions' && method==='GET'){
    const rows=db.prepare(`SELECT s.*,u.display_name host FROM workshop_sessions s JOIN users u ON u.id=s.host_id WHERE s.status<>'Draft' AND (s.visibility='Public' OR ?<>'') ORDER BY CASE s.status WHEN 'Active' THEN 0 WHEN 'Upcoming' THEN 1 WHEN 'Complete' THEN 2 ELSE 3 END,s.starts_at DESC`).all(me?.id||'').filter(r=>canSeeSession(r,me)).map(r=>workshopSessionRow(r,me?.id||''));
    return sendJson(res,200,{items:rows,canEdit:canEditEditorial(me)});
  }
  if(pathname==='/api/sessions' && method==='POST') return readBody(req).then(body=>{
    const u=requireUser(req,res);if(!u)return;const crewId=String(body.crewId||'');if(!canEditEditorial(u)&&!(crewId&&isCrewOrganizer(crewId,u)))return sendJson(res,403,{error:'Session publishing requires Workshop editor or Crew organizer access.'});const title=String(body.title||'').trim();if(!title)return sendJson(res,400,{error:'A Session needs a title.'});const sid=id('sess'),ts=now();
    db.prepare(`INSERT INTO workshop_sessions (id,title,theme,description,cover_url,status,visibility,host_id,starts_at,ends_at,wall_exhibition_id,crew_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid,title,String(body.theme||''),String(body.description||''),String(body.coverUrl||''),String(body.status||'Draft'),canonicalVisibility(body.visibility,'Public'),u.id,String(body.startsAt||''),String(body.endsAt||''),String(body.wallExhibitionId||'')||null,crewId,ts,ts);audit(u.id,'session.create','session',sid,{title});return sendJson(res,201,{id:sid});
  }).catch(e=>sendJson(res,400,{error:e.message}));
  const sessionMatch=pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if(sessionMatch&&method==='GET'){const r=db.prepare(`SELECT s.*,u.display_name host FROM workshop_sessions s JOIN users u ON u.id=s.host_id WHERE s.id=?`).get(sessionMatch[1]);if(!r||!canSeeSession(r,me))return sendJson(res,404,{error:'Session not found.'});return sendJson(res,200,{item:workshopSessionRow(r,me?.id||''),canEdit:canManageWorkshopSession(r,me)});}
  if(sessionMatch&&method==='PUT') return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const r=db.prepare('SELECT * FROM workshop_sessions WHERE id=?').get(sessionMatch[1]);if(!r)return sendJson(res,404,{error:'Session not found.'});db.prepare(`UPDATE workshop_sessions SET title=?,theme=?,description=?,cover_url=?,status=?,visibility=?,starts_at=?,ends_at=?,wall_exhibition_id=?,updated_at=? WHERE id=?`).run(String(body.title??r.title).trim(),String(body.theme??r.theme),String(body.description??r.description),String(body.coverUrl??r.cover_url),String(body.status??r.status),canonicalVisibility(body.visibility,r.visibility||'Public'),String(body.startsAt??r.starts_at),String(body.endsAt??r.ends_at),String(body.wallExhibitionId??r.wall_exhibition_id)||null,now(),r.id);audit(u.id,'session.update','session',r.id,{status:body.status||r.status});return sendJson(res,200,{ok:true});}).catch(e=>sendJson(res,400,{error:e.message}));

  const sessionAssignments=pathname.match(/^\/api\/sessions\/([^/]+)\/assignments$/);
  if(sessionAssignments&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const s=db.prepare('SELECT * FROM workshop_sessions WHERE id=?').get(sessionAssignments[1]);if(!s)return sendJson(res,404,{error:'Session not found.'});if(!canManageWorkshopSession(s,u))return sendJson(res,403,{error:'Session editor or Crew organizer access required.'});const title=String(body.title||'').trim(),brief=String(body.brief||'').trim();if(!title||!brief)return sendJson(res,400,{error:'An Assignment needs a title and brief.'});const aid=id('asg'),ts=now();const ord=Number(body.sortOrder||db.prepare('SELECT COUNT(*) c FROM session_assignments WHERE session_id=?').get(s.id).c+1);db.prepare(`INSERT INTO session_assignments (id,session_id,title,purpose,brief,constraints,optional_constraints,suggested_tools,suggested_materials,references_json,safety_notes,estimated_time,sort_order,release_at,due_at,status,live_event_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(aid,s.id,title,String(body.purpose||''),brief,JSON.stringify(parseList(body.constraints)),JSON.stringify(parseList(body.optionalConstraints)),JSON.stringify(parseList(body.suggestedTools)),JSON.stringify(parseList(body.suggestedMaterials)),JSON.stringify(parseList(body.references)),String(body.safetyNotes||''),String(body.estimatedTime||''),ord,String(body.releaseAt||''),String(body.dueAt||''),String(body.status||'Published'),String(body.liveEventId||'')||null,ts,ts);audit(u.id,'assignment.create','assignment',aid,{sessionId:s.id,title});return sendJson(res,201,{id:aid});}).catch(e=>sendJson(res,400,{error:e.message}));
  const assignmentMatch=pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if(assignmentMatch&&method==='GET'){const a=db.prepare('SELECT * FROM session_assignments WHERE id=?').get(assignmentMatch[1]);if(!a)return sendJson(res,404,{error:'Assignment not found.'});const s=db.prepare('SELECT * FROM workshop_sessions WHERE id=?').get(a.session_id);if(!canSeeSession(s,me))return sendJson(res,404,{error:'Assignment not found.'});const mine=me?db.prepare(`SELECT p.id,p.title,p.stage,p.status,ws.confirmation_code FROM assignment_projects ap JOIN projects p ON p.id=ap.project_id LEFT JOIN work_submissions ws ON ws.assignment_id=ap.assignment_id AND ws.project_id=ap.project_id WHERE ap.assignment_id=? AND ap.user_id=? ORDER BY ap.started_at DESC LIMIT 1`).get(a.id,me.id):null;return sendJson(res,200,{item:assignmentRow(a,me?.id||''),myProject:mine||null,canEdit:canManageWorkshopSession(s,me)});}
  if(assignmentMatch&&method==='PUT') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const a=db.prepare('SELECT * FROM session_assignments WHERE id=?').get(assignmentMatch[1]);if(!a)return sendJson(res,404,{error:'Assignment not found.'});const ss=db.prepare('SELECT * FROM workshop_sessions WHERE id=?').get(a.session_id);if(!canManageWorkshopSession(ss,u))return sendJson(res,403,{error:'Session editor or Crew organizer access required.'});db.prepare(`UPDATE session_assignments SET title=?,purpose=?,brief=?,constraints=?,optional_constraints=?,suggested_tools=?,suggested_materials=?,references_json=?,safety_notes=?,estimated_time=?,sort_order=?,release_at=?,due_at=?,status=?,live_event_id=?,updated_at=? WHERE id=?`).run(String(body.title??a.title),String(body.purpose??a.purpose),String(body.brief??a.brief),JSON.stringify(parseList(body.constraints??json(a.constraints))),JSON.stringify(parseList(body.optionalConstraints??json(a.optional_constraints))),JSON.stringify(parseList(body.suggestedTools??json(a.suggested_tools))),JSON.stringify(parseList(body.suggestedMaterials??json(a.suggested_materials))),JSON.stringify(parseList(body.references??json(a.references_json))),String(body.safetyNotes??a.safety_notes),String(body.estimatedTime??a.estimated_time),Number(body.sortOrder??a.sort_order),String(body.releaseAt??a.release_at),String(body.dueAt??a.due_at),String(body.status??a.status),String(body.liveEventId??a.live_event_id)||null,now(),a.id);audit(u.id,'assignment.update','assignment',a.id,{});return sendJson(res,200,{ok:true});}).catch(e=>sendJson(res,400,{error:e.message}));
  const assignmentStart=pathname.match(/^\/api\/assignments\/([^/]+)\/start$/);
  if(assignmentStart&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const a=db.prepare('SELECT * FROM session_assignments WHERE id=?').get(assignmentStart[1]);if(!a)return sendJson(res,404,{error:'Assignment not found.'});const existing=db.prepare(`SELECT p.* FROM assignment_projects ap JOIN projects p ON p.id=ap.project_id WHERE ap.assignment_id=? AND ap.user_id=? ORDER BY ap.started_at DESC LIMIT 1`).get(a.id,u.id);if(existing)return sendJson(res,200,{project:projectRow(db.prepare(projectSelect(u.id)+' WHERE p.id=?').get(u.id,existing.id)),existing:true});const title=String(body.title||a.title).trim(),pid=id('p'),ts=now();db.prepare(`INSERT INTO projects (id,owner_id,title,slug,description,stage,status,disciplines,tags,cover_emoji,visibility,license,estimated_cost,difficulty,tools,materials,website,github_repo,cover_url,project_type,parent_type,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid,u.id,title,slugify(title),String(body.description||a.purpose||a.brief),'Idea','Active','[]',JSON.stringify(['assignment']), '✦','Members','Unspecified','', 'Approachable',JSON.stringify(json(a.suggested_tools)),JSON.stringify(json(a.suggested_materials)),'','','','Project','Assignment',a.id,ts,ts);db.prepare('INSERT INTO assignment_projects (assignment_id,project_id,user_id,started_at) VALUES (?,?,?,?)').run(a.id,pid,u.id,ts);const prompt=String(body.firstEntry||`Assignment started: ${a.title}\n\nWhat are you trying to make, fix, test, or understand?`).trim();const lid=id('l');db.prepare(`INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(lid,pid,u.id,'Idea','Starting the assignment',prompt,ts,ts);audit(u.id,'assignment.start','assignment',a.id,{projectId:pid});return sendJson(res,201,{project:projectRow(db.prepare(projectSelect(u.id)+' WHERE p.id=?').get(u.id,pid))});}).catch(e=>sendJson(res,400,{error:e.message}));
  const showWork=pathname.match(/^\/api\/assignments\/([^/]+)\/show-work$/);
  if(showWork&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const a=db.prepare('SELECT * FROM session_assignments WHERE id=?').get(showWork[1]);if(!a)return sendJson(res,404,{error:'Assignment not found.'});const pid=String(body.projectId||'');const link=db.prepare('SELECT * FROM assignment_projects WHERE assignment_id=? AND project_id=? AND user_id=?').get(a.id,pid,u.id);if(!link)return sendJson(res,403,{error:'Show the Work must be attached to your Assignment project.'});const prior=db.prepare('SELECT * FROM work_submissions WHERE assignment_id=? AND project_id=?').get(a.id,pid);if(prior)return sendJson(res,409,{error:'This project has already shown the work.'});const did=String(body.did||'').trim(),learned=String(body.learned||'').trim();if(!did||!learned)return sendJson(res,400,{error:'Say what you did and what you learned.'});const ts=now(),lid=id('l'),sid=id('work'),code=confirmationCode();const text=[did,body.happened?`What happened: ${body.happened}`:'',`What I learned: ${learned}`,body.changeNext?`What I would change next: ${body.changeNext}`:''].filter(Boolean).join('\n\n');db.prepare(`INSERT INTO build_log_entries (id,project_id,user_id,type,title,body,created_at,observations,test_results,questions,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(lid,pid,u.id,'Result','SHOW THE WORK',text,ts,String(body.happened||''),learned,String(body.changeNext||''),ts);db.prepare(`INSERT INTO work_submissions (id,assignment_id,project_id,user_id,confirmation_code,image_url,did_text,happened_text,learned_text,change_next,build_log_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid,a.id,pid,u.id,code,String(body.imageUrl||''),did,String(body.happened||''),learned,String(body.changeNext||''),lid,ts);db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(ts,pid);audit(u.id,'assignment.show_work','assignment',a.id,{projectId:pid,confirmationCode:code});return sendJson(res,201,{ok:true,confirmationCode:code,buildLogId:lid});}).catch(e=>sendJson(res,400,{error:e.message}));
  const benches=pathname.match(/^\/api\/assignments\/([^/]+)\/benches$/);
  if(benches&&method==='GET'){const u=requireUser(req,res);if(!u)return;const rows=db.prepare(projectSelect(u.id)+` JOIN assignment_projects ap ON ap.project_id=p.id JOIN work_submissions ws ON ws.project_id=p.id AND ws.assignment_id=ap.assignment_id WHERE ap.assignment_id=? AND ap.user_id<>? AND p.visibility IN ('Public','Members') ORDER BY RANDOM() LIMIT 3`).all(u.id,benches[1],u.id).map(projectRow);return sendJson(res,200,{projects:rows});}
  const reflect=pathname.match(/^\/api\/assignments\/([^/]+)\/reflections$/);
  if(reflect&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const pid=String(body.projectId||''),rec=String(body.recognition||'').trim();if(!pid||!rec)return sendJson(res,400,{error:'Choose a project and a useful recognition.'});const project=db.prepare('SELECT * FROM projects WHERE id=?').get(pid);if(!project||!canViewProject(project,u))return sendJson(res,404,{error:'Project not found.'});if(project.owner_id===u.id)return sendJson(res,400,{error:'Walk the Benches is for looking at someone else’s work.'});const linked=db.prepare('SELECT 1 FROM assignment_projects WHERE assignment_id=? AND project_id=?').get(reflect[1],pid);if(!linked)return sendJson(res,400,{error:'That project is not part of this Assignment.'});const rid=id('reflect'),ts=now();db.prepare(`INSERT INTO peer_reflections (id,assignment_id,project_id,reviewer_id,recognition,body,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(assignment_id,project_id,reviewer_id) DO UPDATE SET recognition=excluded.recognition,body=excluded.body,created_at=excluded.created_at`).run(rid,reflect[1],pid,u.id,rec,String(body.body||''),ts);notifyUser(project.owner_id,'project',`${u.display_name} walked your bench: ${rec}.`,`#/projects/${pid}`,u.id);return sendJson(res,201,{ok:true});}).catch(e=>sendJson(res,400,{error:e.message}));
  const makerIdMatch=pathname.match(/^\/api\/maker-id(?:\/([^/]+))?$/);
  if(makerIdMatch&&method==='GET'){const uid=makerIdMatch[1]||me?.id;if(!uid)return sendJson(res,401,{error:'Sign in to view your Maker ID.'});const d=makerIdData(uid,me);if(!d)return sendJson(res,404,{error:'Maker ID not available.'});return sendJson(res,200,d);}

  // Session Studio resources
  const sessionResources=pathname.match(/^\/api\/sessions\/([^/]+)\/resources$/);
  if(sessionResources&&method==='POST') return readBody(req).then(body=>{const u=requireUser(req,res);if(!u)return;const ss=db.prepare('SELECT * FROM workshop_sessions WHERE id=?').get(sessionResources[1]);if(!ss||!canManageWorkshopSession(ss,u))return sendJson(res,403,{error:'Session editor or Crew organizer access required.'});const lid=String(body.libraryItemId||'');if(!db.prepare('SELECT 1 FROM library_items WHERE id=?').get(lid))return sendJson(res,404,{error:'Library item not found.'});db.prepare(`INSERT INTO session_resources (session_id,library_item_id,sort_order,created_at) VALUES (?,?,?,?) ON CONFLICT(session_id,library_item_id) DO UPDATE SET sort_order=excluded.sort_order`).run(sessionResources[1],lid,Number(body.sortOrder||0),now());return sendJson(res,201,{ok:true});}).catch(e=>sendJson(res,400,{error:e.message}));

  if(pathname==='/api/admin/reports' && method==='GET'){
    const u=requireRole(req,res,['Owner','Administrator','Moderator']);if(!u)return;const status=String(url.searchParams.get('status')||'');
    const rows=db.prepare(`SELECT r.*,u.display_name reporter,a.display_name assignee FROM content_reports r JOIN users u ON u.id=r.reporter_id LEFT JOIN users a ON a.id=r.assignee_id ${status?'WHERE r.status=?':''} ORDER BY CASE r.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 ELSE 2 END,r.created_at DESC`).all(...(status?[status]:[]));return sendJson(res,200,{items:rows});
  }
  const adminReport=pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
  if(adminReport&&method==='PUT'){const u=requireRole(req,res,['Owner','Administrator','Moderator']);if(!u)return;return readBody(req).then(body=>{const r=db.prepare('SELECT * FROM content_reports WHERE id=?').get(adminReport[1]);if(!r)return sendJson(res,404,{error:'Report not found.'});const status=['Open','Reviewing','Resolved','Dismissed'].includes(body.status)?body.status:r.status,priority=['Normal','High','Urgent'].includes(body.priority)?body.priority:(r.priority||'Normal'),assignee=String(body.assigneeId??r.assignee_id??''),notes=String(body.notes??r.moderator_notes??'');db.prepare('UPDATE content_reports SET status=?,priority=?,assignee_id=?,moderator_notes=?,resolved_at=? WHERE id=?').run(status,priority,assignee,notes,['Resolved','Dismissed'].includes(status)?now():'',r.id);if(body.action){const act=String(body.action),targetType=String(r.item_type),targetId=String(r.item_id);db.prepare('INSERT INTO moderation_actions VALUES (?,?,?,?,?,?,?,?)').run(id('mod'),r.id,u.id,targetType,targetId,act,notes,now());const target=targetType==='discussion_topic'?db.prepare('SELECT user_id FROM discussion_topics WHERE id=?').get(targetId):targetType==='discussion_reply'?db.prepare('SELECT user_id FROM discussion_replies WHERE id=?').get(targetId):targetType==='question'?db.prepare('SELECT user_id FROM questions WHERE id=?').get(targetId):targetType==='project'?db.prepare('SELECT owner_id user_id FROM projects WHERE id=?').get(targetId):null;if(act==='Warn member'&&target?.user_id)notifyUser(target.user_id,'moderation',`A moderator reviewed reported content. ${notes||'Please review the Workshop community expectations.'}`,'#/home',u.id);if((act==='Suspend member'||act==='Ban member')&&target?.user_id){db.prepare('UPDATE users SET account_status=? WHERE id=?').run(act==='Ban member'?'Banned':'Suspended',target.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.user_id);}if(act==='Remove content'){if(targetType==='discussion_reply')db.prepare('DELETE FROM discussion_replies WHERE id=?').run(targetId);else if(targetType==='discussion_topic')db.prepare('DELETE FROM discussion_topics WHERE id=?').run(targetId);else if(targetType==='question')db.prepare('DELETE FROM questions WHERE id=?').run(targetId);else if(targetType==='project'){const files=db.prepare('SELECT stored_name FROM project_files WHERE project_id=?').all(targetId);for(const f of files){try{fs.unlinkSync(path.join(UPLOADS,f.stored_name))}catch{}}db.prepare('DELETE FROM projects WHERE id=?').run(targetId);}}}audit(u.id,'moderation.report.update','report',r.id,{status,priority,action:body.action||''});return sendJson(res,200,{ok:true});}).catch(e=>sendJson(res,400,{error:e.message}));}
  if(pathname==='/api/admin/users' && method==='GET'){const u=requireRole(req,res,['Owner','Administrator','Moderator']);if(!u)return;const rows=db.prepare(`SELECT id,email,display_name,role,account_status,email_verified,force_password_reset,anonymized_at,created_at,(SELECT COUNT(*) FROM projects p WHERE p.owner_id=users.id) project_count,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=users.id) session_count FROM users ORDER BY created_at DESC`).all();return sendJson(res,200,{items:rows});}
  const adminMembershipItem=pathname.match(/^\/api\/admin\/memberships\/([^/]+)$/);if(adminMembershipItem&&method==='PUT')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;const m=db.prepare('SELECT * FROM membership_connections WHERE id=?').get(adminMembershipItem[1]);if(!m)return sendJson(res,404,{error:'Membership not found.'});const status=['Active','Cancelled','Expired'].includes(String(body.status))?String(body.status):m.status;db.prepare('UPDATE membership_connections SET status=?,expires_at=?,label=?,updated_at=? WHERE id=?').run(status,String(body.expiresAt??m.expires_at),String(body.label??m.label),now(),m.id);refreshSupporterRole(m.user_id);audit(u.id,'membership.update','membership',m.id,{status,expiresAt:String(body.expiresAt??m.expires_at)});return sendJson(res,200,{ok:true});});
  if(pathname==='/api/admin/gearhead/digest'&&method==='POST')return readBody(req).then(body=>{const u=requireRole(req,res,['Owner','Administrator','Editor']);if(!u)return;const days=Math.max(1,Math.min(90,Number(body.days||30))),since=new Date(Date.now()-days*86400000).toISOString(),items=db.prepare("SELECT id,title,deck,entry_type FROM gearhead_entries WHERE status='Published' AND created_at>=? ORDER BY created_at DESC LIMIT 12").all(since);let sent=0;for(const member of db.prepare("SELECT * FROM users WHERE account_status='Active'").all().filter(isSupporterUser)){const pref=emailPrefs(member.id);if(Number(pref.gearhead_digest)===0||String(pref.gearhead_digest_frequency||'Monthly')==='Off')continue;const lines=items.map(x=>`• ${x.title} — ${x.deck}`).join('\n');emailUser(member.id,'gearhead','gearhead_digest','FROM THE GEARHEAD CREW',`New from Green Shoe Garage:\n\n${lines||'No new Crew entries in this window.'}\n\nOpen the archive: ${absoluteHash('#/gearhead-archive')}`);sent++;}audit(u.id,'gearhead.digest.send','system','gearhead_digest',{sent,days});return sendJson(res,200,{ok:true,sent,items:items.length});});
  const adminUserAction=pathname.match(/^\/api\/admin\/users\/([^/]+)\/(details|reset-link|force-reset|sessions|anonymize)$/);
  if(adminUserAction&&method==='GET'&&adminUserAction[2]==='details'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;const target=db.prepare(`SELECT id,email,display_name,role,account_status,email_verified,force_password_reset,anonymized_at,admin_note,created_at,(SELECT COUNT(*) FROM projects p WHERE p.owner_id=users.id) project_count,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=users.id) session_count,(SELECT COUNT(*) FROM auth_tokens t WHERE t.user_id=users.id) token_count FROM users WHERE id=?`).get(adminUserAction[1]);if(!target)return sendJson(res,404,{error:'Member not found.'});const audits=db.prepare(`SELECT action,details,created_at FROM audit_logs WHERE target_type='user' AND target_id=? ORDER BY created_at DESC LIMIT 20`).all(target.id).map(x=>({...x,details:json(x.details,{})}));return sendJson(res,200,{user:target,audits});}
  if(adminUserAction&&method==='POST'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return readBody(req).then(body=>{const target=db.prepare('SELECT * FROM users WHERE id=?').get(adminUserAction[1]);if(!target)return sendJson(res,404,{error:'Member not found.'});if(target.role==='Owner'&&u.role!=='Owner')return sendJson(res,403,{error:'Only the Owner can operate on an Owner account.'});if(target.id===u.id&&['force-reset','sessions','anonymize'].includes(adminUserAction[2]))return sendJson(res,400,{error:'Use another administrator account for actions that would lock or remove your own account.'});const reason=String(body.reason||'').trim();if(!reason)return sendJson(res,400,{error:'Administrative reason is required.'});const action=adminUserAction[2];if(action==='reset-link'){db.prepare("DELETE FROM auth_tokens WHERE user_id=? AND kind='reset'").run(target.id);const token=issueAuthToken(target.id,'reset',30);if(body.invalidateSessions)db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);const base=PUBLIC_URL?PUBLIC_URL.replace(/\/$/,''):'';const resetUrl=`${base}/#/reset/${token}`;emailUser(target.id,'account_security','admin_password_reset','Reset your THE WORKSHOP password',`An administrator initiated a password reset for your THE WORKSHOP account.\n\nReset password: ${resetUrl}\n\nThis one-time link expires in 30 minutes. If this is unexpected, contact a Workshop administrator.`);audit(u.id,'admin.user.reset_link','user',target.id,{reason,invalidateSessions:Boolean(body.invalidateSessions),emailQueued:true});return sendJson(res,201,{ok:true,resetUrl,expiresMinutes:30,emailQueued:true,emailDeliveryConfigured:emailConfigured()});}if(action==='force-reset'){db.prepare('UPDATE users SET force_password_reset=1,admin_note=? WHERE id=?').run(reason,target.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);audit(u.id,'admin.user.force_reset','user',target.id,{reason});return sendJson(res,200,{ok:true});}if(action==='sessions'){const result=db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);audit(u.id,'admin.user.sessions.revoke','user',target.id,{reason,count:Number(result.changes||0)});return sendJson(res,200,{ok:true,revoked:Number(result.changes||0)});}if(action==='anonymize'){if(String(body.confirm||'')!=='ANONYMIZE')return sendJson(res,400,{error:'Type ANONYMIZE to confirm permanent account removal.'});const tomb=`removed-${target.id}-${Date.now()}@invalid.local`;db.exec('BEGIN');try{db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(target.id);db.prepare('DELETE FROM membership_connections WHERE user_id=?').run(target.id);db.prepare('DELETE FROM notification_preferences WHERE user_id=?').run(target.id);db.prepare('DELETE FROM notifications WHERE user_id=?').run(target.id);db.prepare('DELETE FROM saved_items WHERE user_id=?').run(target.id);db.prepare('DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE user_id=?)').run(target.id);db.prepare('DELETE FROM collections WHERE user_id=?').run(target.id);db.prepare('UPDATE users SET email=?,display_name=?,bio=?,city_region=?,role=?,avatar_seed=?,password_hash=?,email_verified=0,account_status=?,skills=?,tools=?,can_help=?,want_learn=?,profile_visibility=?,location_visibility=?,tool_cabinet_visibility=?,force_password_reset=0,anonymized_at=?,admin_note=? WHERE id=?').run(tomb,'Removed member','','','Member','RM',passwordHash(crypto.randomBytes(32).toString('hex')),'Banned','[]','[]','[]','[]','Private','Private','Private',now(),reason,target.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}audit(u.id,'admin.user.anonymize','user',target.id,{reason,previousRole:target.role,previousStatus:target.account_status});return sendJson(res,200,{ok:true});}return sendJson(res,400,{error:'Unsupported account action.'});}).catch(e=>sendJson(res,400,{error:e.message}));}
  const adminUser=pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if(adminUser&&method==='PUT'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return readBody(req).then(body=>{const target=db.prepare('SELECT * FROM users WHERE id=?').get(adminUser[1]);if(!target)return sendJson(res,404,{error:'Member not found.'});if(target.role==='Owner'&&u.role!=='Owner')return sendJson(res,403,{error:'Only the Owner can change an Owner account.'});const roles=['Member','Supporter','Moderator','Editor','Administrator','Owner'],statuses=['Active','Suspended','Banned','Disabled'];const role=roles.includes(body.role)?body.role:target.role,status=statuses.includes(body.accountStatus)?body.accountStatus:target.account_status;if(target.id===u.id&&status!=='Active')return sendJson(res,400,{error:'You cannot suspend your own active session from here.'});db.prepare('UPDATE users SET role=?,account_status=?,admin_note=? WHERE id=?').run(role,status,String(body.reason||target.admin_note||''),target.id);if(status!=='Active')db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);audit(u.id,'admin.user.update','user',target.id,{role,status});return sendJson(res,200,{ok:true,user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id))});});}
  if(pathname==='/api/admin/audit' && method==='GET'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;const rows=db.prepare(`SELECT a.*,u.display_name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 250`).all().map(x=>({...x,details:json(x.details,{})}));return sendJson(res,200,{items:rows});}
  if(pathname==='/api/admin/backup' && method==='POST'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;try{return sendJson(res,201,{backup:createBackup(u.id)});}catch(e){return sendJson(res,500,{error:`Backup failed: ${e.message}`});}}
  if(pathname==='/api/admin/email' && method==='GET'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return sendJson(res,200,{provider:EMAIL_PROVIDER,configured:emailConfigured(),from:EMAIL_FROM,adminEmail:adminEmail(),settings:{emailCrewRequests:boolSetting('emailCrewRequests',true),emailModerationReports:boolSetting('emailModerationReports',true)},recent:db.prepare('SELECT id,kind,recipient,subject,provider,status,error,created_at FROM email_deliveries ORDER BY created_at DESC LIMIT 25').all()});}
  if(pathname==='/api/admin/email' && method==='PUT'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return readBody(req).then(body=>{const allowed={adminEmail:String(body.adminEmail||'').trim(),emailCrewRequests:body.emailCrewRequests?'1':'0',emailModerationReports:body.emailModerationReports?'1':'0'};for(const [k,v] of Object.entries(allowed))db.prepare('INSERT INTO site_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(k,v,now());audit(u.id,'admin.email.settings','system','email',{adminEmail:allowed.adminEmail,emailCrewRequests:allowed.emailCrewRequests,emailModerationReports:allowed.emailModerationReports});return sendJson(res,200,{ok:true,adminEmail:adminEmail()});});}
  if(pathname==='/api/admin/email/test' && method==='POST'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;const to=adminEmail();if(!to)return sendJson(res,400,{error:'Configure an administrator email first.'});queueEmail({kind:'test',to,subject:'THE WORKSHOP email test',text:`Transactional email is configured for THE WORKSHOP v${APP_VERSION}.`});audit(u.id,'admin.email.test','system','email',{to});return sendJson(res,202,{ok:true,to,configured:emailConfigured()});}
  if(pathname==='/api/admin/settings' && method==='GET'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return sendJson(res,200,{items:Object.fromEntries(db.prepare('SELECT key,value FROM site_settings').all().map(r=>[r.key,r.value]))});}
  if(pathname==='/api/admin/settings' && method==='PUT'){const u=requireRole(req,res,['Owner','Administrator']);if(!u)return;return readBody(req).then(body=>{for(const [k,v] of Object.entries(body)){if(!['siteName','registrationMode','maintenanceMessage'].includes(k))continue;db.prepare('INSERT INTO site_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(k,String(v),now())}audit(u.id,'admin.settings.update','system','settings',body);return sendJson(res,200,{ok:true});});}
  if(pathname==='/api/admin/reset-demo' && method==='POST'){
    const u=requireUser(req,res); if(!u)return; if(u.role!=='Owner'&&u.role!=='Administrator')return sendJson(res,403,{error:'Admin only.'});
    db.exec(`DELETE FROM membership_provider_events; DELETE FROM gearhead_after_hours_rsvps; DELETE FROM gearhead_requests; DELETE FROM gearhead_early_feedback; DELETE FROM gearhead_access_events; DELETE FROM gearhead_media; DELETE FROM gearhead_files; DELETE FROM gearhead_tutorial_steps; DELETE FROM gearhead_entries; DELETE FROM maker_crew_event_attendance; DELETE FROM maker_crew_events; DELETE FROM maker_crew_announcements; DELETE FROM maker_crew_bulletin_posts; DELETE FROM maker_crew_requests; DELETE FROM maker_crew_members; DELETE FROM maker_crew_postal_codes; DELETE FROM maker_crews; DELETE FROM peer_reflections; DELETE FROM work_submissions; DELETE FROM assignment_projects; DELETE FROM session_resources; DELETE FROM session_assignments; DELETE FROM workshop_sessions; DELETE FROM scrap_inquiries; DELETE FROM scrap_listings; DELETE FROM teardown_contributions; DELETE FROM teardown_clubs; DELETE FROM mystery_proposals; DELETE FROM mystery_items; DELETE FROM weekly_question_responses; DELETE FROM weekly_questions; DELETE FROM wall_items; DELETE FROM wall_exhibitions; DELETE FROM instrument_feedback; DELETE FROM field_instruments; DELETE FROM project_tasks; DELETE FROM project_collaboration_invites; DELETE FROM tool_cabinet_items; DELETE FROM skill_contact_requests; DELETE FROM project_clinic_submissions; DELETE FROM live_comments; DELETE FROM live_events; DELETE FROM critique_responses; DELETE FROM critiques; DELETE FROM moderation_actions; DELETE FROM audit_logs; DELETE FROM auth_tokens; DELETE FROM membership_invite_codes; DELETE FROM membership_connections; DELETE FROM github_cache; DELETE FROM project_release_files; DELETE FROM project_releases; DELETE FROM project_files; DELETE FROM content_reports; DELETE FROM discussion_replies; DELETE FROM discussion_topics; DELETE FROM collection_items; DELETE FROM collections; DELETE FROM email_deliveries; DELETE FROM email_preferences; DELETE FROM notification_preferences; DELETE FROM notifications; DELETE FROM saved_items; DELETE FROM answers; DELETE FROM questions; DELETE FROM comments; DELETE FROM build_log_entries; DELETE FROM project_collaborators; DELETE FROM projects; DELETE FROM shop_notes; DELETE FROM build_alongs; DELETE FROM open_briefs; DELETE FROM library_items; DELETE FROM sessions; DELETE FROM users;`); seedDemo(); seedBatch34Demo(); seedBatch78Demo(); seedBatch910Demo(); seedBatch1718Demo(); seedBatch1920Demo(); seedBatch2122Demo(); seedBatch2324Demo(); seedBatch2526Demo(); seedParticipationDemo(); seedMakerCrewsDemo(); seedGearheadDemo(); audit(u.id,'admin.demo.reset','system','demo'); return sendJson(res,200,{ok:true});
  }

  return sendJson(res,404,{error:'API route not found.'});
}

const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const staticCache=new Map();
function cachedStatic(file){
  let hit=staticCache.get(file); if(hit)return hit;
  const data=fs.readFileSync(file),stat=fs.statSync(file),etag=`"${crypto.createHash('sha1').update(data).digest('hex').slice(0,20)}"`;
  hit={data,etag,mtime:stat.mtime.toUTCString(),br:data.length>=1024?zlib.brotliCompressSync(data,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:4}}):null,gzip:data.length>=1024?zlib.gzipSync(data,{level:6}):null};
  staticCache.set(file,hit); return hit;
}
function serveUpload(req,res,file,row){
  fs.stat(file,(err,stat)=>{
    if(err)return sendText(res,404,'Not found');
    const common={'Content-Type':row.mime_type||'application/octet-stream','Content-Disposition':'inline','X-Content-Type-Options':'nosniff','Cache-Control':row.privateNoStore?'private, no-store':'private, max-age=300','Pragma':row.privateNoStore?'no-cache':undefined,'Vary':'Cookie','Accept-Ranges':'bytes'};for(const k of Object.keys(common))if(common[k]===undefined)delete common[k];
    const range=String(req.headers.range||'');
    if(range){
      const m=range.match(/^bytes=(\d*)-(\d*)$/); if(!m)return res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();
      let start=m[1]?Number(m[1]):0,end=m[2]?Number(m[2]):stat.size-1;
      if(!m[1]&&m[2]){const tail=Math.min(Number(m[2]),stat.size);start=stat.size-tail;end=stat.size-1;}
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||start>=stat.size)return res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();
      end=Math.min(end,stat.size-1);res.writeHead(206,{...common,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});
      return fs.createReadStream(file,{start,end}).pipe(res);
    }
    res.writeHead(200,{...common,'Content-Length':stat.size});fs.createReadStream(file).pipe(res);
  });
}
function serveStatic(req,res,url){
  if(url.pathname.startsWith('/gearhead-media/')){const name=decodeURIComponent(url.pathname.slice('/gearhead-media/'.length));const file=path.normalize(path.join(UPLOADS,name));if(!file.startsWith(UPLOADS))return sendText(res,403,'Forbidden');const row=db.prepare(`SELECT m.mime_type,m.entry_id,g.created_by,g.access_level FROM gearhead_media m JOIN gearhead_entries g ON g.id=m.entry_id WHERE m.stored_name=?`).get(name);if(!row)return sendText(res,404,'Not found');const viewer=currentUser(req);if(!canAccessLevel(row.access_level,viewer,row.created_by)&&!canEditEditorial(viewer))return sendText(res,403,'GEARHEAD CREW ONLY');if(row.access_level==='GearHead'&&!allowGearheadDownload(req,viewer?.id||''))return sendText(res,429,'Too many protected downloads. Try again shortly.');row.privateNoStore=row.access_level==='GearHead';return serveUpload(req,res,file,row);}
  if(url.pathname.startsWith('/gearhead-files/')){const name=decodeURIComponent(url.pathname.slice('/gearhead-files/'.length));const file=path.normalize(path.join(UPLOADS,name));if(!file.startsWith(UPLOADS))return sendText(res,403,'Forbidden');const row=db.prepare(`SELECT f.mime_type,f.entry_id,g.created_by FROM gearhead_files f JOIN gearhead_entries g ON g.id=f.entry_id WHERE f.stored_name=?`).get(name);if(!row)return sendText(res,404,'Not found');const viewer=currentUser(req);if(!isSupporterUser(viewer)&&!canEditEditorial(viewer))return sendText(res,403,'GEARHEAD CREW ONLY');if(!allowGearheadDownload(req,viewer?.id||''))return sendText(res,429,'Too many protected downloads. Try again shortly.');row.privateNoStore=true;recordGearheadEvent(viewer?.id||'','download','gearhead_file',name,{entryId:row.entry_id});return serveUpload(req,res,file,row);}
  if(url.pathname.startsWith('/media/')){const name=decodeURIComponent(url.pathname.slice('/media/'.length));const file=path.normalize(path.join(UPLOADS,name));if(!file.startsWith(UPLOADS))return sendText(res,403,'Forbidden');const row=db.prepare(`SELECT mime_type,user_id,visibility FROM media_assets WHERE stored_name=?`).get(name);if(!row)return sendText(res,404,'Not found');const viewer=currentUser(req);if(!canAccessLevel(row.visibility||'Public',viewer,row.user_id)&&!canEditEditorial(viewer))return sendText(res,403,'This media is not visible to you.');return serveUpload(req,res,file,{mime_type:row.mime_type,privateNoStore:row.visibility!=='Public'});}
  if(url.pathname.startsWith('/uploads/')){const name=decodeURIComponent(url.pathname.slice(9));const file=path.normalize(path.join(UPLOADS,name));if(!file.startsWith(UPLOADS))return sendText(res,403,'Forbidden');const row=db.prepare(`SELECT f.mime_type,f.access_level,p.visibility,p.owner_id,p.id project_id FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.stored_name=?`).get(name);if(!row)return sendText(res,404,'Not found');const viewer=currentUser(req);const projectAllowed=canViewProject({id:row.project_id,visibility:row.visibility,owner_id:row.owner_id},viewer);const fileAllowed=row.access_level==='Inherit'||canAccessLevel(row.access_level,viewer,row.owner_id);if(!projectAllowed||!fileAllowed)return sendText(res,403,row.access_level==='GearHead'?'GEARHEAD CREW ONLY':'This project file is not visible to you.');if(row.access_level==='GearHead')recordGearheadEvent(viewer?.id||'','download','project_file',name,{projectId:row.project_id});return serveUpload(req,res,file,row);}

  let rel = decodeURIComponent(url.pathname);
  if(rel==='/' || !path.extname(rel)) rel='/index.html';
  const file=path.normalize(path.join(PUBLIC,rel));
  if(!file.startsWith(PUBLIC)) return sendText(res,403,'Forbidden');
  let hit;try{hit=cachedStatic(file)}catch{return sendText(res,404,'Not found')}
  if(req.headers['if-none-match']===hit.etag){res.writeHead(304,{'ETag':hit.etag,'Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600, must-revalidate'});return res.end();}
  const headers={'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600, must-revalidate','ETag':hit.etag,'Last-Modified':hit.mtime,'Vary':'Accept-Encoding'};
  const accepted=String(req.headers['accept-encoding']||'');
  if(hit.br&&/\bbr\b/.test(accepted)){res.writeHead(200,{...headers,'Content-Encoding':'br','Content-Length':hit.br.length});return res.end(hit.br)}
  if(hit.gzip&&/\bgzip\b/.test(accepted)){res.writeHead(200,{...headers,'Content-Encoding':'gzip','Content-Length':hit.gzip.length});return res.end(hit.gzip)}
  res.writeHead(200,{...headers,'Content-Length':hit.data.length});res.end(hit.data);
}

const server=http.createServer((req,res)=>{
  const requestId=crypto.randomUUID();res._acceptEncoding=req.headers['accept-encoding']||'';securityHeaders(res,requestId);
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(!originAllowed(req))return sendJson(res,403,{error:'Request origin was not accepted.'});
  const ip=requestIp(req);
  if(url.pathname.startsWith('/api/auth/')&&!rateAllowed(`auth:${ip}`,18,15*60*1000))return sendJson(res,429,{error:'Too many account attempts. Try again later.','requestId':requestId});
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!rateAllowed(`write:${ip}`,180,60*1000))return sendJson(res,429,{error:'Too many write requests. Slow down and try again.','requestId':requestId});
  if(url.pathname.startsWith('/api/')&&['POST','PUT','PATCH','DELETE'].includes(req.method)){
    const key=String(req.headers['x-idempotency-key']||'').trim();
    if(key){
      if(key.length>160)return sendJson(res,400,{error:'Idempotency key is too long.'});
      // Scope caller-supplied keys to the signed-in member. Anonymous mutations are
      // isolated by a short, non-reversible client fingerprint so one browser cannot
      // replay another browser's response merely by guessing a key.
      const viewer=currentUser(req);
      const anonymousScope=crypto.createHash('sha256').update(`${requestIp(req)}:${String(req.headers['user-agent']||'')}`).digest('hex').slice(0,24);
      const storageKey=`${viewer?.id||`anon-${anonymousScope}`}:${key}`;
      const prior=db.prepare(`SELECT method,pathname,status_code,body FROM idempotency_responses WHERE key=?`).get(storageKey);
      if(prior){
        if(prior.method!==req.method||prior.pathname!==url.pathname)return sendJson(res,409,{error:'This idempotency key was already used for a different operation.'});
        let payload;try{payload=JSON.parse(prior.body)}catch{payload={ok:true}}
        return sendJson(res,prior.status_code,payload,{'X-Idempotent-Replay':'1'});
      }
      res._idempotency={key:storageKey,method:req.method,pathname:url.pathname};
    }
  }
  if(url.pathname.startsWith('/api/')) return routeApi(req,res,url);
  const embedMatch=url.pathname.match(/^\/embed\/bench\/([a-f0-9]{48})$/);if(embedMatch&&req.method==='GET')return renderBenchEmbed(req,res,url,embedMatch[1]);
  serveStatic(req,res,url);
});
server.listen(PORT,HOST,()=>console.log(`THE WORKSHOP v${APP_VERSION} running at http://${HOST}:${PORT}`));
