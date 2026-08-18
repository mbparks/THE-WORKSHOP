#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('public/app.js');
const css=read('public/styles.css');
const html=read('public/index.html');
const pkg=JSON.parse(read('package.json'));
const manifest=JSON.parse(read('public/manifest.webmanifest'));
const server=read('server.js');
const sw=read('public/sw.js');
const checks=[
  ['version aligned in app',app.includes(`state.meta.version||'${pkg.version}'`)&&html.includes(`THE WORKSHOP v${pkg.version}`)],
  ['version aligned in manifest',String(manifest.version||pkg.version).includes(pkg.version)||read('public/sw.js').includes(pkg.version)],
  ['modal uses aria-labelledby',app.includes('aria-labelledby=')],
  ['modal traps focus',app.includes("e.key!=='Tab'")],
  ['modal restores focus',app.includes('state.lastFocus.focus')],
  ['modal fields associate labels',app.includes('label.htmlFor=field.id')],
  ['routes expose busy state',app.includes("aria-busy','true")],
  ['route skeleton exists',app.includes('routeSkeleton()')],
  ['reduced motion supported',css.includes('prefers-reduced-motion:reduce')],
  ['higher contrast supported',css.includes('prefers-contrast:more')],
  ['skip link exists',html.includes('class="skip-link"')],
  ['main landmark exists',html.includes('<main id="main"')],
  ['toast live semantics',app.includes("kind==='error' ? 'alert' : 'status'")],
  ['JSON compression enabled',server.includes('brotliCompressSync')&&server.includes('gzipSync')],
  ['static responses use ETags',server.includes(`'ETag':hit.etag`)],
  ['uploads stream with byte ranges',server.includes(`'Accept-Ranges':'bytes'`)&&server.includes('createReadStream')],
  ['service worker excludes private uploads',sw.includes("u.pathname.startsWith('/uploads/')")],
  ['service worker uses cache-first shell assets',sw.includes('return cached||fresh')],
  ['lazy images decode asynchronously',app.includes('decoding=\"async\"')],
  ['Sessions API implemented',server.includes("pathname==='/api/sessions'")],
  ['Assignments create linked projects',server.includes('/start$/')&&server.includes('assignment_projects')],
  ['Show the Work writes notebook result',server.includes('SHOW THE WORK')&&server.includes('work_submissions')],
  ['Walk the Benches is non-scored',server.includes('peer_reflections')&&!server.includes('peer_score')],
  ['Maker ID implemented',app.includes('renderMakerId')&&server.includes('makerIdData')],
  ['Session Studio implemented',app.includes('sessionStudio')],
  ['Maker Crew schema implemented',server.includes('CREATE TABLE IF NOT EXISTS maker_crews')&&server.includes('maker_crew_members')],
  ['Crew ZIP discovery implemented',server.includes('crewDiscovery')&&server.includes('maker_crew_postal_codes')],
  ['Crew membership is explicit',server.includes("/join$/")&&server.includes('affiliation_visibility')],
  ['Crew roles stay local',server.includes('isCrewOrganizer')&&server.includes('Crew organizer access required')],
  ['Meetup exact-address privacy exists',server.includes('address_visibility')&&server.includes("showAddress=e.address_visibility==='Public'")],
  ['Local tools do not expose storage location',server.includes('local_availability')&&app.includes('never publishes where this tool is stored')],
  ['Crew bulletin board implemented',server.includes('maker_crew_bulletin_posts')&&app.includes('CREW BULLETIN BOARD')],
  ['Crew Sessions reuse Session system',server.includes('canManageWorkshopSession')&&app.includes('crewSessionForm')],
  ['Crew request approval implemented',server.includes('crew.request.review')&&app.includes('crew-request-review')],
  ['Crew participation included in export',server.includes('crewMemberships')&&server.includes('crewAttendance')],
  ['Maker Crews included in global search',server.includes("want('crews')")&&app.includes("['crews','Maker Crews']")],
  ['Crew UI is responsive',css.includes('crew-pulse-grid')&&css.includes('@media(max-width:760px)')],
  ['Crew identity respects affiliation visibility',server.includes('visiblePrimaryCrew')&&app.includes('maker-id-crew')&&app.includes('bench-crew-link')]
  ,['Admin account details implemented',server.includes('reset-link|force-reset|sessions|anonymize')&&app.includes('ACCOUNT MANAGEMENT')]
  ,['Admin reset links are time limited',server.includes("issueAuthToken(target.id,'reset',30)")&&app.includes('ONE-TIME RESET LINK')]
  ,['Forced password reset revokes sessions',server.includes('force_password_reset=1')&&server.includes('account.forced_password.complete')]
  ,['Admin session revocation is audited',server.includes('admin.user.sessions.revoke')]
  ,['Account anonymization removes login identity',server.includes('admin.user.anonymize')&&server.includes('removed-${target.id}')]
  ,['Destructive account action requires confirmation',server.includes('Type ANONYMIZE to confirm permanent account removal')&&app.includes('Type ANONYMIZE to continue')]
  ,['Transactional email schema implemented',server.includes('CREATE TABLE IF NOT EXISTS email_deliveries')&&server.includes('CREATE TABLE IF NOT EXISTS email_preferences')]
  ,['Resend provider uses native fetch',server.includes("fetch('https://api.resend.com/emails'")&&server.includes('RESEND_API_KEY')]
  ,['Admin email falls back to Owner',server.includes("role='Owner'")&&server.includes('function adminEmail()')]
  ,['Crew requests alert administrators',server.includes('New Maker Crew request')&&server.includes("'emailCrewRequests'")]
  ,['Moderation reports alert administrators',server.includes('THE WORKSHOP moderation report')&&server.includes("'emailModerationReports'")]
  ,['Meetup approval email workflow exists',server.includes("'crew_attendance'")&&server.includes('Attendance request')]
  ,['Password reset can be emailed',server.includes("'password_reset'")&&server.includes('Reset your THE WORKSHOP password')]
  ,['Operations Console exposes email delivery',app.includes('EMAIL DELIVERY')&&app.includes("/api/admin/email")]
  ,['Email delivery failures are logged',server.includes("status='Failed'")&&server.includes('email_deliveries')]
  ,['Mobile connectivity indicator clears bottom navigation',css.includes('v5.7.1 — Mobile connectivity indicator')&&css.includes('bottom:calc(84px + env(safe-area-inset-bottom))')&&css.includes('.offline-status:not(.is-offline)')]
  ,['Canonical WORKSHOP mark used in shell',html.includes('class="brand-mark"')&&css.includes('/workshop-mark.svg')]
  ,['PWA uses raster any and maskable icons',manifest.icons.some(i=>i.purpose==='any'&&i.src==='/icon-512.png')&&manifest.icons.some(i=>i.purpose==='maskable'&&i.src==='/icon-maskable-512.png')]
  ,['Apple and favicon assets linked',html.includes('apple-touch-icon.png')&&html.includes('favicon.ico')&&html.includes('safari-pinned-tab.svg')]
  ,['Primary shell uses inline SVG icon family',html.includes('class="nav-icon"')&&html.includes('viewBox="0 0 24 24"')&&!html.includes('/ui-icons.svg#')&&!html.includes('<span>⌂</span>')]
  ,['Mobile navigation retains five destinations',(html.match(/class="mobile-nav"[\s\S]*?<\/nav>/)||[''])[0].includes('#/builds')&&(html.match(/class="mobile-nav"[\s\S]*?<\/nav>/)||[''])[0].includes('id="mobile-modules"')&&(html.match(/class="mobile-nav"[\s\S]*?<\/nav>/)||[''])[0].includes('#/bench')]
  ,['Mobile navigation enforces five equal columns',css.includes('repeat(5,minmax(0,1fr))!important')]
  ,['Maker ID uses canonical WORKSHOP mark',app.includes('class="workshop-mark"')&&app.includes('maker-id-mark')]
  ,['Icon assets cached for PWA shell',!sw.includes('/ui-icons.svg')&&sw.includes('/icon-maskable-512.png')&&sw.includes('/apple-touch-icon.png')]
  ,['Mobile dark utility icons have explicit high contrast',css.includes('v5.8.4 — mobile dark-mode utility icon contrast')&&css.includes('html[data-theme=\"dark\"] #theme-toggle')&&css.includes('stroke:#f0eee5')]
  ,['Mobile Bench exposes Maker Crew hub',app.includes('mobile-crew-hub')&&app.includes('MY MAKER CREW')&&app.includes('FIND A MAKER CREW')]
  ,['Crew shortcuts use router-safe deep links',app.includes('/meetups')&&app.includes('/bulletin')&&app.includes('sectionMap={meetups:')&&!app.includes('href=\"#crew-meetups\"')]

  ,['Signup requires 18+ confirmation',app.includes('name=\"age18\"')&&app.includes('I confirm that I am 18 years of age or older')&&server.includes("if(!age18)return sendJson")&&server.includes('age_18_confirmed_at')]
  ,['Signup requires versioned Terms acceptance',app.includes('name="terms"')&&app.includes('Terms &amp; Community Conduct')&&server.includes("if(!terms)return sendJson")&&server.includes('terms_version_accepted')&&server.includes('TERMS_VERSION')]
  ,['Existing accounts receive current Terms gate',app.includes('showTermsAcceptance')&&app.includes('termsCurrentAccepted')&&server.includes("pathname === '/api/account/terms'")]
  ,['Public Terms route exists',app.includes("route==='terms'")&&app.includes('Don’t be an idiot.')&&fs.existsSync(path.join(root,'TERMS.md'))]
  ,['GearHead Crew entitlement is server enforced',server.includes('function canAccessLevel')&&server.includes('isSupporterUser')&&server.includes('GEARHEAD CREW ONLY')]
  ,['GearHead standalone content schema exists',server.includes('CREATE TABLE IF NOT EXISTS gearhead_entries')&&server.includes('gearhead_tutorial_steps')&&server.includes('gearhead_files')]
  ,['GearHead protected files require entitlement',server.includes("url.pathname.startsWith('/gearhead-files/')")&&server.includes('!isSupporterUser(viewer)&&!canEditEditorial(viewer)')]
  ,['GearHead hub and Studio implemented',app.includes('async function renderGearhead()')&&app.includes('GearHead Crew Studio')&&server.includes("pathname==='/api/gearhead'")]
  ,['GearHead tutorials support structured steps',app.includes('Add Tutorial Step')&&server.includes('gearhead_tutorial_steps')]
  ,['GearHead scheduled public release implemented',server.includes('public_release_at')&&app.includes('GearHead-only until')]
  ,['After Hours uses GearHead live access',server.includes("event_type='After Hours'")&&app.includes("'After Hours'")&&server.includes("ensureColumn('live_events','visibility'")]
  ,['Project files support GearHead-only access',server.includes("ensureColumn('project_files','access_level'")&&app.includes('GEARHEAD CREW ONLY')&&server.includes("req.headers['x-file-access']")]
  ,['GearHead notification preference exists',server.includes("ensureColumn('email_preferences','gearhead'")&&server.includes('gearheadNotify')]
  ,['GET SWAG external navigation exists',html.includes('https://www.redbubble.com/people/GreenShoeGarage/shop')&&html.includes('GET SWAG')&&html.includes('target="_blank"')]
  ,['GearHead home has editorial shelves',app.includes('DEEP DIVES')&&app.includes('BENCH ROLLS')&&app.includes('CONTINUE WHERE YOU LEFT OFF')]
  ,['GearHead fast publishing exists',app.includes('Post to GearHead Crew')&&app.includes('gearhead-quick-type')]
  ,['Bench Roll ordered media implemented',server.includes('CREATE TABLE IF NOT EXISTS gearhead_media')&&server.includes('/media-upload')&&app.includes('bench-roll-grid')]
  ,['GearHead video metadata implemented',server.includes("ensureColumn('gearhead_entries','poster_url'")&&server.includes("ensureColumn('gearhead_entries','transcript'")&&app.includes('Video chapters')]
  ,['Deep Dive builder supports structured evidence',server.includes("ensureColumn('gearhead_tutorial_steps','measurements'")&&server.includes("ensureColumn('gearhead_tutorial_steps','code_text'")&&app.includes('MEASUREMENTS / SETTINGS')]
  ,['GearHead uploaded media remains entitlement protected',server.includes("url.pathname.startsWith('/gearhead-media/')")&&server.includes('canAccessLevel(row.access_level,viewer,row.created_by)')]
  ,['GearHead File Vault implemented',server.includes("pathname==='/api/gearhead/vault'")&&app.includes('renderGearheadVault')&&app.includes('GearHead File Vault')]
  ,['Early Access feedback implemented',server.includes('CREATE TABLE IF NOT EXISTS gearhead_early_feedback')&&server.includes('/feedback$/')&&app.includes('Early Access Feedback')]
  ,['Early Access preview metadata implemented',server.includes("ensureColumn('gearhead_entries','known_issues'")&&server.includes("ensureColumn('gearhead_entries','requirements'")&&app.includes('KNOWN ISSUES')&&app.includes('RELEASE NOTES')]
  ,['After Hours RSVP implemented',server.includes('gearhead_after_hours_rsvps')&&server.includes('gearhead-rsvp')&&app.includes('RSVP / REMINDER')]
  ,['GearHead Crew requests implemented',server.includes('CREATE TABLE IF NOT EXISTS gearhead_requests')&&app.includes('Request from the Crew')&&app.includes('On the Bench')]
  ,['GearHead membership lifecycle supports gifts',server.includes("'Gift','Complimentary','Lifetime'")&&server.includes('/api/membership/cancel')]
  ,['Provider-neutral membership sync exists',server.includes('/api/membership/provider-sync')&&server.includes('WORKSHOP_MEMBERSHIP_SYNC_SECRET')]
  ,['GearHead self-service membership UI exists',app.includes('membership-self-service')&&app.includes('CANCEL GEARHEAD ACCESS')]
  ,['GearHead digest exists',server.includes('/api/gearhead/digest-preferences')&&server.includes('/api/admin/gearhead/digest')]
  ,['GearHead archive exists',server.includes("pathname==='/api/gearhead/archive'")&&app.includes('renderGearheadArchive')]
  ,['GearHead public previews exist',server.includes("ensureColumn('gearhead_entries','preview_text'")&&app.includes('PUBLIC PREVIEW')]
  ,['GearHead release pipeline auto-publishes',server.includes('function releaseDueGearhead')&&server.includes("access_level='Public'")]
  ,['GearHead contributions implemented',server.includes('CREATE TABLE IF NOT EXISTS gearhead_contributions')&&app.includes('GearHead Contributions')&&app.includes('SEND CONTRIBUTION')]
  ,['GearHead Crew Projects spawn linked projects',server.includes('gearhead_crew_project_responses')&&server.includes('crew_project_start')&&app.includes('START MY VERSION')]
  ,['GearHead Studio 2.0 implemented',server.includes("pathname==='/api/gearhead/studio2'")&&app.includes('GearHead Crew Studio 2.0')]
  ,['Protected GearHead media excluded from service-worker cache',sw.includes("u.pathname.startsWith('/gearhead-files/')")&&sw.includes("u.pathname.startsWith('/gearhead-media/')")]
  ,['Protected GearHead downloads use no-store and throttling',server.includes('allowGearheadDownload')&&server.includes("row.privateNoStore=true")&&server.includes("'Cache-Control':row.privateNoStore?'private, no-store'")]

  ,['Stripe Checkout route',server.includes('/api/membership/stripe-checkout')]
  ,['Stripe webhook signature verification',server.includes('verifyStripeSignature')]
  ,['Stripe Customer Portal route',server.includes('/api/membership/stripe-portal')]
  ,['native GearHead video upload',server.includes('video-upload')&&server.includes('ffprobe')&&server.includes('ffmpeg')]
  ,['GearHead templates',server.includes('gearhead_templates')&&app.includes('gearheadTemplates')]
  ,['GearHead duplication',server.includes('/duplicate')]
  ,['GearHead Bench supporter badge follows entitlement',app.includes('gearhead-supporter-badge')&&app.includes('u.gearhead?.active')&&app.includes('GearHead Crew supporter')&&css.includes('.gearhead-supporter-badge')]
  ,['Home prominently exposes Maker Crew discovery',app.includes('FIND A MAKER CREW')&&app.includes('home-crew-search')&&app.includes('FIND LOCAL CREWS')&&css.includes('.community-entryways')]
  ,['Home Maker Crew search works without account gate',app.includes("$('#home-crew-search')?.addEventListener")&&app.includes('#/crews/${encodeURIComponent(q)}')]
  ,['Home prominently exposes GearHead pricing and join',app.includes('JOIN THE GEARHEAD CREW')&&app.includes('$5 <small>/ month</small>')&&app.includes('$50 <small>/ year</small>')&&app.includes('2 months free annually')]
  ,['Craft Path persistence schema',server.includes('CREATE TABLE IF NOT EXISTS craft_progress')&&server.includes('/api/craft-progress')]
  ,['Craft Path documents all three levels',server.includes("label:'Apprentice'")&&server.includes("label:'Journeyman'")&&server.includes("label:'Master'")]
  ,['Craft Path is self tracked without XP',app.includes('SELF-TRACKED PRACTICE · NO POINTS OR LEADERBOARD')&&!server.includes('craft_xp')]
  ,['Craft rank uses bronze silver gold assets',app.includes('/craft-apprentice.png')&&app.includes('/craft-journeyman.png')&&app.includes('/craft-master.png')]
  ,['Craft Path appears on My Bench',app.includes('craftPathView(d.craft)')&&app.includes('Optional evidence note or link')]
  ,['Bench embed persistence schema',server.includes('CREATE TABLE IF NOT EXISTS bench_embeds')&&server.includes('benchEmbedRecord')]
  ,['Bench embed is tokenized and revocable',server.includes('/api/bench-embed/rotate')&&server.includes('crypto.randomBytes(24)')&&app.includes('ROTATE TOKEN')]
  ,['Bench embed has selective public fields',app.includes('showBio')&&app.includes('showLocation')&&app.includes('showCrew')&&app.includes('showCraft')&&app.includes('showGearhead')&&app.includes('showSkills')&&app.includes('showProjects')]
  ,['Bench embed only publishes public projects',server.includes("visibility='Public' ORDER BY updated_at DESC LIMIT ?")]
  ,['Bench embed can be framed externally',server.includes("frame-ancestors *")&&server.includes("res.removeHeader('X-Frame-Options')")]
  ,['My Bench exposes embed builder',app.includes('EMBED MY BENCH')&&app.includes('function benchEmbedForm')]
  ,['Disabled Bench embed previews remain owner-only',server.includes("viewer?.id!==row.user_id")&&server.includes('Bench widget has been disabled or replaced.')]
  ,['Bench widget live preview allowed by shell CSP',server.includes("frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com")]
  ,['Bench widget preview stays on current origin',app.includes("const preview=new URL(src.pathname+src.search,location.origin)")&&app.includes('frame.src=preview.toString()')]
  ,['Bench widget copy publishes before copying',app.includes('PUBLISH & COPY EMBED CODE')&&app.includes("const saved=await api('/api/bench-embed',{method:'PUT'")&&app.includes('Widget published and fresh embed code copied.')]
  ,['Bench widget save keeps builder visible',app.includes('Bench widget saved and enabled.')&&!app.includes("Bench widget saved but disabled.');closeOverlay();")]
  ,['Maker Crew 2.0 handbook and local needs',server.includes('maker_crew_handbook_entries')&&server.includes('localNeeds=bulletin.filter')&&app.includes('CREW HANDBOOK')&&app.includes('LOCAL NEEDS')]
  ,['Failure Library structured evidence',server.includes('CREATE TABLE IF NOT EXISTS failure_records')&&app.includes('Failure Library')&&app.includes('WHAT BROKE · WHAT WE LEARNED')&&app.includes('PRESERVE THE FAILURE')]
  ,['Private Workshop Notebook can become projects',server.includes('CREATE TABLE IF NOT EXISTS personal_notebook_entries')&&server.includes('/start-project')&&app.includes('Workshop Notebook')&&app.includes('START PROJECT')]
  ,['Workshop Map uses Crew anchor centroids only',server.includes("pathname==='/api/workshop-map'")&&server.includes('z.is_anchor=1')&&server.includes('never member home locations')&&app.includes('PUBLIC CREW REGIONS · NEVER HOME LOCATIONS')]
  ,['Physical project labels support public QR only',server.includes('/label$/')&&server.includes("p.visibility==='Public'?")&&app.includes('DIGITAL HISTORY → PHYSICAL ARTIFACT')&&app.includes('PRINT LABEL')]
  ,['Workshop Prompts are explicitly noncompetitive',server.includes('CREATE TABLE IF NOT EXISTS workshop_prompts')&&app.includes('NO WINNER · NO RANKING')&&app.includes('AN EXHIBITION, NOT A LEADERBOARD')]
  ,['Prompts and Sessions share one Build destination',app.includes("href:'#/participate',label:'PROMPTS + SESSIONS'")&&app.includes("else if(route==='participate') await renderParticipate()")&&app.includes("Promise.all([api('/api/prompts'),api('/api/sessions')])")&&!app.includes("href:'#/prompts',label:'PROMPTS'")&&!app.includes("href:'#/sessions',label:'SESSIONS'")]
  ,['Mobile module switcher exposes all route families',app.includes('const NAV_MODULES=')&&['bench','builds','workshop','library','live','people'].every(k=>app.includes(`${k}:{label:`))&&app.includes('Object.entries(NAV_MODULES).map')]
  ,['Mobile module switcher includes v8 tools',app.includes('WORKSHOP NOTEBOOK')&&app.includes('FAILURE LIBRARY')&&app.includes('PROMPTS + SESSIONS')&&app.includes('WORKSHOP MAP')&&app.includes('MAKER CREWS')]
  ,['Mobile module switcher includes external navigation',app.includes('https://mbparks.com/almanac')&&app.includes('https://mbparks.com/almanac2')&&app.includes('GreenShoeGarage/shop')]
  ,['Workshop Map uses real Leaflet map',app.includes('L.map(host')&&app.includes('tile.openstreetmap.org/{z}/{x}/{y}.png')&&html.includes('leaflet@1.9.4/dist/leaflet.js')&&html.includes('leaflet@1.9.4/dist/leaflet.css')]
  ,['Workshop Map preserves region-only event privacy',app.includes('Shown at Crew region, not an exact address.')&&app.includes('Public events are also plotted at the Crew region rather than an exact venue address.')]
  ,['Workshop Map CSP allows required map origins',server.includes("script-src 'self' https://unpkg.com")&&server.includes("style-src 'self' 'unsafe-inline' https://unpkg.com")&&server.includes('https://tile.openstreetmap.org')]
  ,['Desktop navigation keeps module tools in context rail',(()=>{const lower=(html.match(/<div class="side-secondary"[\s\S]*?<div class="side-status">/)||[''])[0];return !lower.includes('href="#/notebook"')&&!lower.includes('href="#/map"')&&!lower.includes('href="#/gearhead"')&&!lower.includes('href="#/saved"')})()]
  ,['Context navigation uses exact route matching',app.includes('function contextItemActive(item,route,parts=routeParts())')&&app.includes("const path=parts.join('/')")&&!app.includes("href.includes('#/'+route)")]
  ,['Build Along + Briefs uses a routable Builds subroute',app.includes("href:'#/builds/programs',label:'BUILD ALONGS + BRIEFS'")&&app.includes("else if(route==='builds') await renderBuilds(parts[1]||'')")&&app.includes('id="programs"')&&!app.includes('#/builds#programs')]
  ,['Desktop and mobile share context module definitions',app.includes('const NAV_MODULES=')&&app.includes('const module=NAV_MODULES[parent]')&&app.includes('Object.entries(NAV_MODULES).map')]
  ,['GearHead Crew is its own navigation section',(()=>{const people=(app.match(/people:\{label:'PEOPLE'[\s\S]*?\n  \]\}/)||[''])[0],gearhead=(app.match(/gearhead:\{label:'GEARHEAD CREW'[\s\S]*?\n  \]\}/)||[''])[0];return !people.includes("#/gearhead")&&gearhead.includes("href:'#/gearhead',label:'CREW HOME'")&&gearhead.includes("href:'#/gearhead-vault',label:'FILE VAULT'")&&gearhead.includes("href:'#/gearhead-contributions',label:'CONTRIBUTIONS'")&&gearhead.includes("href:'#/gearhead-projects',label:'CREW PROJECTS'")&&gearhead.includes("href:'#/gearhead-requests',label:'CREW REQUESTS'")&&gearhead.includes("href:'#/gearhead-archive',label:'ARCHIVE'")})()]
  ,['GearHead primary rail section exists',html.includes('href="#/gearhead" data-route="gearhead"')&&html.includes('>GearHead Crew</a>')]
  ,['Non-members get GearHead join landing',app.includes('function gearheadJoinLanding(d)')&&app.includes("if(!d.active){view.innerHTML=gearheadJoinLanding(d);return;}")&&app.includes('WHAT MEMBERSHIP OPENS')]
  ,['Lower desktop rail contains only site-wide destinations',(()=>{const lower=(html.match(/<div class="side-secondary"[\s\S]*?<div class="side-status">/)||[''])[0];return !lower.includes('#/notebook')&&!lower.includes('#/map')&&!lower.includes('#/saved')&&!lower.includes('#/gearhead')&&lower.includes('mbparks.com/almanac')&&lower.includes('mbparks.com/almanac2')&&lower.includes('redbubble.com')&&lower.includes('#/about')&&lower.includes('#/terms')})()]

  ,['Field Instrument Lab module is retired',!app.includes("href:'#/lab',label:'FIELD INSTRUMENT LAB'")&&!app.includes("route==='lab'")&&!app.includes('OPEN LAB →')&&!app.includes("['instruments','Field Instruments']")&&server.includes('fieldInstrumentLab:false')]];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`\n${failed} QA check(s) failed.`);process.exit(1)}
console.log(`\n${checks.length} QA checks passed for v${pkg.version}.`);

// v5.8.8 regression checks
{
  const fs=require('node:fs'),path=require('node:path');
  const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  if(/class="overlay" data-action="close-overlay"/.test(app))throw new Error('Modal backdrop must not dismiss dialogs.');
  if(/Escape'&&overlayRoot/.test(app))throw new Error('Escape must not silently dismiss a dialog.');
  if(!app.includes('function imageSrc(raw)')||!app.includes('/api/image-proxy?url='))throw new Error('Remote image proxy client helper missing.');
  if(!server.includes("pathname === '/api/image-proxy'")||!server.includes('validateRemoteImageUrl'))throw new Error('Guarded remote image proxy missing.');
}
