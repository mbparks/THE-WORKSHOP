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
const browserQa=read('scripts/browser-qa.js');
const integrationQa=read('scripts/integration-qa.js');
const ci=read('.github/workflows/ci.yml');
const checks=[
  ['version aligned in app',html.includes(`THE WORKSHOP v${pkg.version}`)&&app.includes(`state.meta.version||'${pkg.version}'`)],
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
  ['People and Crews share global search family',server.includes("want('people')")&&server.includes('crews')&&app.includes("['people','People + Crews']")],
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
  ,['Public Privacy route explains cookie and local storage',app.includes("route==='privacy'")&&app.includes('Cookies &amp; Local Storage')&&app.includes('workshop_session')&&app.includes('Local browser storage')&&fs.existsSync(path.join(root,'PRIVACY.md'))]
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
  ,['Discord community link exists site-wide',html.includes('https://discord.gg/J3uaN8ugs')&&app.includes('https://discord.gg/J3uaN8ugs')&&app.includes('OPEN DISCORD ↗')]
  ,['Green Shoe Garage GitHub link exists site-wide',html.includes('https://github.com/greenshoegarage')&&app.includes('https://github.com/greenshoegarage')&&app.includes('OPEN GITHUB ↗')]
  ,['GearHead home has consolidated crew workspace',app.includes('CONTINUE WHERE YOU LEFT OFF')&&app.includes('CREW WORK →')&&app.includes('VAULT →')&&app.includes('renderGearheadWork')&&app.includes('renderGearheadVaultHub')]
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
  ,['Home community entryways are at bottom',app.indexOf('community-entryways')>app.indexOf('NEW IN THE SHOP MANUAL')]
  ,['Craft Path persistence schema',server.includes('CREATE TABLE IF NOT EXISTS craft_progress')&&server.includes('/api/craft-progress')]
  ,['Craft Path documents all three levels',server.includes("label:'Apprentice'")&&server.includes("label:'Journeyman'")&&server.includes("label:'Master'")]
  ,['Craft Path is self tracked without XP',app.includes('SELF-TRACKED PRACTICE · NO POINTS OR LEADERBOARD')&&!server.includes('craft_xp')]
  ,['Craft rank uses optimized bronze silver gold assets',app.includes('/craft-apprentice.webp')&&app.includes('/craft-journeyman.webp')&&app.includes('/craft-master.webp')]
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
  ,['Community participation shares one Build destination',app.includes("href:'#/community-builds',label:'COMMUNITY BUILDS'")&&app.includes("else if(route==='community-builds') await renderCommunityBuilds")&&app.includes("api('/api/community-builds')")&&server.includes("pathname==='/api/community-builds'")]
  ,['Mobile module switcher exposes all route families',app.includes('const NAV_MODULES=')&&['bench','builds','workshop','library','live','people'].every(k=>app.includes(`${k}:{label:`))&&app.includes('Object.entries(NAV_MODULES).map')]
  ,['Mobile module switcher includes consolidated tools',app.includes("label:'NOTEBOOK'")&&app.includes("label:'MAKER ID'")&&app.includes("label:'COMMUNITY BUILDS'")&&app.includes("label:'HELP + CRITIQUE'")&&app.includes("label:'MAKER CREWS'")&&app.includes("label:'CREW WORK'")]
  ,['Mobile module switcher includes external navigation',app.includes('https://mbparks.com/almanac')&&app.includes('https://mbparks.com/almanac2')&&app.includes('GreenShoeGarage/shop')&&app.includes('discord.gg/J3uaN8ugs')&&app.includes('github.com/greenshoegarage')]
  ,['Workshop Map lazy-loads real Leaflet map',app.includes('function loadLeaflet()')&&app.includes('L.map(host')&&app.includes('tile.openstreetmap.org/{z}/{x}/{y}.png')&&!html.includes('leaflet@1.9.4/dist/leaflet.js')&&!html.includes('leaflet@1.9.4/dist/leaflet.css')]
  ,['Workshop Map preserves region-only event privacy',app.includes('Shown at Crew region, not an exact address.')&&app.includes('Public events are also plotted at the Crew region rather than an exact venue address.')]
  ,['Workshop Map CSP allows required map origins',server.includes("script-src 'self' https://unpkg.com")&&server.includes("style-src 'self' 'unsafe-inline' https://unpkg.com")&&server.includes('https://tile.openstreetmap.org')]
  ,['Desktop navigation keeps module tools in context rail',(()=>{const lower=(html.match(/<div class="side-secondary"[\s\S]*?<div class="side-status">/)||[''])[0];return !lower.includes('href="#/notebook"')&&!lower.includes('href="#/map"')&&!lower.includes('href="#/gearhead"')&&!lower.includes('href="#/saved"')})()]
  ,['Context navigation uses exact route matching',app.includes('function contextItemActive(item,route,parts=routeParts())')&&app.includes("const path=parts.join('/')")&&!app.includes("href.includes('#/'+route)")]
  ,['Legacy Builds programs route resolves to Community Builds',app.includes("['community','programs'].includes(parts[1]||'')")&&app.includes('await renderCommunityBuilds()')&&!app.includes('#/builds#programs')]
  ,['Desktop and mobile share context module definitions',app.includes('const NAV_MODULES=')&&app.includes('const module=NAV_MODULES[parent]')&&app.includes('Object.entries(NAV_MODULES).map')]
  ,['GearHead Crew is its own consolidated navigation section',(()=>{const people=(app.match(/people:\{label:'PEOPLE'[\s\S]*?\n  \]\}/)||[''])[0],gearhead=(app.match(/gearhead:\{label:'GEARHEAD CREW'[\s\S]*?\n  \]\}/)||[''])[0];return !people.includes("#/gearhead")&&gearhead.includes("href:'#/gearhead',label:'CREW HOME'")&&gearhead.includes("href:'#/gearhead-work',label:'CREW WORK'")&&gearhead.includes("href:'#/gearhead-vault',label:'VAULT'")})()]
  ,['GearHead primary rail section exists',html.includes('href="#/gearhead" data-route="gearhead"')&&html.includes('>GearHead Crew</a>')]
  ,['Non-members get GearHead join landing',app.includes('function gearheadJoinLanding(d)')&&app.includes("if(!d.active){view.innerHTML=gearheadJoinLanding(d);return;}")&&app.includes('WHAT MEMBERSHIP OPENS')]
  ,['Lower desktop rail contains only site-wide destinations',(()=>{const lower=(html.match(/<div class="side-secondary"[\s\S]*?<div class="side-status">/)||[''])[0];return !lower.includes('#/notebook')&&!lower.includes('#/map')&&!lower.includes('#/saved')&&!lower.includes('#/gearhead')&&lower.includes('mbparks.com/almanac')&&lower.includes('mbparks.com/almanac2')&&lower.includes('redbubble.com')&&lower.includes('#/about')&&lower.includes('#/terms')})()]

  ,['Field Instrument Lab module is retired',!app.includes("href:'#/lab',label:'FIELD INSTRUMENT LAB'")&&!app.includes("route==='lab'")&&!app.includes('OPEN LAB →')&&!app.includes("['instruments','Field Instruments']")&&server.includes('fieldInstrumentLab:false')]
  ,['Build navigation consolidates community participation',app.includes("label:'COMMUNITY BUILDS'")&&app.includes('async function renderCommunityBuilds')]
  ,['Workshop navigation consolidates help flows',app.includes("label:'HELP + CRITIQUE'")&&app.includes('async function renderHelpCritique')]
  ,['Maker ID lives under My Bench',(()=>{const bench=(app.match(/bench:\{label:'MY BENCH'[\s\S]*?\n  \]\}/)||[''])[0],people=(app.match(/people:\{label:'PEOPLE'[\s\S]*?\n  \]\}/)||[''])[0];return bench.includes("label:'MAKER ID'")&&!people.includes("label:'MAKER ID'")})()]
  ,['Maker Crew list and map are one destination',app.includes("href:'#/crews',label:'MAKER CREWS'")&&app.includes("#/crews/map")&&app.includes('renderMakerCrewsHub')]
  ,['Live exposes one calendar surface',app.includes("label:'LIVE + CALENDAR'")&&app.includes('Community Build Sessions')]
  ,['Failure records surface as Lessons Learned',app.includes('PROJECT NOTEBOOKS → DURABLE KNOWLEDGE')&&app.includes('Record it once; learn from it everywhere.')]
  ,['GearHead work is consolidated',app.includes("label:'CREW WORK'")&&app.includes('renderGearheadWork')]
  ,['GearHead vault includes archive',app.includes("label:'VAULT'")&&app.includes('renderGearheadVaultHub')&&app.includes('ARCHIVE')]
  ,['Start Something is intent based',app.includes('START WITH THE INTENT, NOT THE CONTENT TYPE')&&app.includes('MAKE SOMETHING')&&app.includes('DOCUMENT SOMETHING')&&app.includes('ASK FOR HELP')&&app.includes('JOIN SOMETHING')]
  ,['Home uses consolidated editorial sections',app.includes('YOUR WORKSHOP')&&app.includes('JOIN IN')&&app.includes('SHOP TALK')&&app.includes('NEW FROM THE SHOP')]
  ,['GearHead join monthly plan is actionable',app.includes('data-action="stripe-checkout" data-plan="monthly"')]
  ,['GearHead monthly and annual cards share accent outline',css.includes('.gearhead-plan-card{appearance:none;display:grid;gap:10px;text-align:left;padding:18px;border:2px solid var(--accent)')]
  ,['GearHead join page suppresses redundant join button when plan cards exist',app.includes("${planCards}${!planCards?(p.joinUrl?")]
  ,['GearHead join annual plan is actionable',app.includes('data-action="stripe-checkout" data-plan="annual"')]
  ,['GearHead checkout uses explicit plan helper',app.includes("function startStripeCheckout(plan,button=null)")&&app.includes("body:JSON.stringify({plan:normalized})")]

  ,['Workshop Atmosphere persistent shell exists',html.includes('id="workshop-atmosphere"')&&html.indexOf('id="workshop-atmosphere"')<html.indexOf('id="app-shell"')]
  ,['Workshop Atmosphere has theme-aware motif families',html.includes('data-atmo-motif="circuit"')&&html.includes('data-atmo-motif="gear"')&&html.includes('data-atmo-motif="plane"')&&html.includes('data-atmo-motif="brace"')&&css.includes('--atmo-primary')]

  ,['Workshop Atmosphere avoids hash-fragment SVG references',!html.includes('<use href="#atmo-')&&html.includes('data-atmo-motif="gear"')]
  ,['Workshop Atmosphere resyncs after async route render',app.includes('updateAtmosphereModule(NAV_PARENT[route]||route)')]
  ,['Workshop Atmosphere follows section navigation',app.includes('updateAtmosphereModule(parent)')&&['bench','builds','workshop','library','live','people','gearhead'].every(k=>html.includes(`atmo-${k}`))]
  ,['Workshop Atmosphere supports quiet workshop off modes',app.includes("const ATMOSPHERE_MODES=['quiet','workshop','off']")&&app.includes("localStorage.setItem('workshop-atmosphere'")&&css.includes('[data-mode="quiet"]')&&css.includes('[data-mode="off"]')]
  ,['Workshop Atmosphere has user settings control',html.includes('id="atmosphere-toggle"')&&app.includes('function showAtmosphereSettings()')&&app.includes("action==='atmosphere-mode'")]
  ,['Workshop Atmosphere respects reduced motion',css.includes('@media(prefers-reduced-motion:reduce)')&&css.includes('animation:none!important')]
  ,['High contrast suppresses decorative atmosphere',css.includes('html[data-theme="contrast"] .workshop-atmosphere{display:none!important}')]
  ,['Workshop Atmosphere is visibly exposed through content field',css.includes('main{position:relative;background:color-mix(in srgb,var(--paper) 58%,transparent)}')&&css.includes('.atmo-primary{color:var(--atmo-primary);opacity:.17}')]
  ,['Workshop Atmosphere active foreground exists',html.includes('id="atmo-foreground"')&&css.includes('.atmo-foreground{position:fixed')]
  ,['Workshop Atmosphere recomposes per route',app.includes('renderActiveAtmosphere(key)')&&app.includes('ATMO_COMPOSITIONS')]
  ,['Workshop Atmosphere has active motion',css.includes('atmo-active-plane')&&css.includes('atmo-active-spin')&&css.includes('atmo-active-code')]
  ,['Workshop Atmosphere supports subtle parallax',app.includes('function setupAtmosphereParallax()')&&css.includes('--atmo-shift-x')]

  ,['Project privacy uses one canonical server gate',server.includes('function canViewProject')&&server.includes('function filterVisibleProjects')&&server.includes('canViewProject(')]
  ,['Canonical access vocabulary normalized',server.includes('function normalizedAccess')&&server.includes("GearHead Crew Only")&&server.includes("Supporter")]
  ,['Community Builds aggregate API exists',server.includes("pathname==='/api/community-builds'")&&app.includes("api('/api/community-builds')")]
  ,['Help aggregate API exists',server.includes("pathname==='/api/help'")&&app.includes("api('/api/help')")]
  ,['Live calendar aggregate and ICS exist',server.includes("pathname==='/api/calendar'")&&server.includes("pathname==='/api/calendar.ics'")&&app.includes('/api/calendar.ics')]
  ,['Shared media library exists',server.includes('CREATE TABLE IF NOT EXISTS media_assets')&&app.includes('mediaPickerField')&&app.includes('openMediaPicker')]
  ,['Member mute and block controls exist',server.includes('CREATE TABLE IF NOT EXISTS user_blocks')&&app.includes('MUTE')&&app.includes('BLOCK')]
  ,['Offline work is reviewable',app.includes('showOfflineWork')&&app.includes('offline-retry')&&app.includes('offline-discard')&&app.includes('X-Idempotency-Key')]
  ,['Service-worker update prompt exists',app.includes('NEW WORKSHOP BUILD READY')&&app.includes('controllerchange')&&sw.includes('SKIP_WAITING')]
  ,['Appearance unifies theme density atmosphere',app.includes('DISPLAY DENSITY')&&app.includes('WORKSHOP ATMOSPHERE')&&app.includes('theme-mode')&&app.includes('density-mode')]
  ,['Display density does not hide publisher capability',!app.includes('start-intent-group deep-only')&&!app.includes('button-secondary deep-only" data-action="edit-build-along')&&!app.includes('button-secondary deep-only" data-action="edit-open-brief')&&!app.includes('button deep-only" data-action="new-weekly-question')&&!app.includes('button deep-only" data-action="new-teardown-club')]
  ,['Complex objects use local navigation',app.includes('object-local-nav')&&app.includes('crew-local-nav')]
  ,['Skill Exchange folded into People',app.includes("renderPeople('help')")&&!app.includes("href:'#/skill-exchange',label:'SKILL EXCHANGE'")]
  ,['Scrap Exchange has scopes',app.includes('WORKSHOP-WIDE')&&app.includes('MY CREW')&&app.includes('LOCAL PICKUP')&&app.includes('WILL SHIP')]
  ,['Optimized Craft badge assets cached',sw.includes('/craft-apprentice.webp')&&sw.includes('/craft-master.webp')&&!sw.includes('/craft-apprentice.png')]
  ,['Version diagnostics endpoint and UI exist',server.includes("pathname==='/api/version-diagnostics'")&&app.includes('showVersionDiagnostics')]
  ,['Retired Field Instrument Lab implementation is not routable',!app.includes('function renderInstrumentLab')&&!app.includes('function instrumentForm')&&!server.includes("pathname==='/api/instruments'")]
  ,['Full QA command runs static integration and browser layers',pkg.scripts.qa.includes('qa:static')&&pkg.scripts.qa.includes('qa:integration')&&pkg.scripts.qa.includes('qa:browser')]
  ,['CI runs the complete QA gate',ci.includes('npm run qa')&&ci.includes('Chromium route QA')]
  ,['Browser QA exercises route persistence and real editors',browserQa.includes('Atmosphere recomposes between major modules')&&browserQa.includes('Shared media picker is available in the project editor')]
  ,['Integration QA verifies account-scoped idempotency',integrationQa.includes('Idempotency keys are scoped per account')&&integrationQa.includes('x-idempotent-replay')]
  ,['Crew Studio has one-click Workshop Map enable',app.includes('crew-map-enable')&&app.includes('MAKE VISIBLE ON MAP')&&server.includes('/map-enable')&&server.includes('resolveCrewAnchorCentroid')]
  ,['Crew map defaults to starred ZIP and permits full-precision coordinate editing',app.includes('crew-map-location-form')&&app.includes('RESET TO ★ ZIP CENTROID')&&app.includes('name=\"latitude\"')&&app.includes('name=\"longitude\"')&&app.includes('COORDINATE_DECIMALS=14')&&app.includes('39.68050852174287')&&app.includes('-78.76667986159089')&&app.includes('step=\"any\"')&&server.includes('/map-location')&&server.includes('body.resetToAnchor')]
  ,['Crew role changes refresh Crew Studio in place',app.includes('await refreshCrewStudio(crewId)')&&app.includes('Crew member is now')&&server.includes('return sendJson(res,200,{ok:true,member})')]
  ,['Crew map automation uses only the Crew anchor postal centroid',server.includes('crew.map.enable')&&server.includes('resolveCrewAnchorCentroid(c,anchor)')&&server.includes("UPDATE maker_crews SET status='Active',visibility='Public'")]
  ,['Project editor uses the shared media picker',app.includes("mediaPickerField({name:'coverUrl',label:'Project cover'")]
  ,['Scrap Exchange naming reflects the unified destination',app.includes("label:'SCRAP EXCHANGE'")&&!app.includes("label:'SCRAP BIN',routes:['scrap']")]
  ,['v9 navigation document replaces the obsolete route map',fs.existsSync(path.join(root,'NAVIGATION.md'))&&!fs.existsSync(path.join(root,'NAVIGATION_v8.0.5.md'))&&!fs.existsSync(path.join(root,'NAVIGATION_v9.0.4.md'))]
  ,['Release omits development dedupe snapshots',!fs.existsSync(path.join(root,'public/app.pre-dedupe.js'))&&!fs.existsSync(path.join(root,'public/app.pre-dedupe2.js'))]
  ,['Release omits superseded full-size Craft badge PNGs',['craft-apprentice.png','craft-default-wood.png','craft-journeyman.png','craft-master.png'].every(name=>!fs.existsSync(path.join(root,'public',name)))]
  ,['Release documentation is current',read('README.md').includes(`Current release: **v${pkg.version}**`)&&!read('README.md').includes('Current version: **v5.8.3**')&&read('CHANGELOG.md').startsWith(`# THE WORKSHOP v${pkg.version}`)]
  ,['Local bind address is aligned',server.includes("'127.0.0.1'")&&read('.env.example').includes('HOST=127.0.0.1')&&read('start.sh').includes('127.0.0.1:8787')&&!read('README.md').includes('127.0.2.1')]
  ,['Zero-dependency CI does not require an npm cache lockfile',!ci.includes('cache: npm')]

  ,['Crew Studio uses redesigned workspace shell',app.includes('crew-studio-shell')&&app.includes('crew-studio-overview')&&app.includes('crew-studio-content-grid')]
  ,['Crew Studio exposes full precision coordinate pair',app.includes('39.68050852174287')&&app.includes('-78.76667986159089')&&app.includes('PUBLIC MARKER · LAT / LON')]
  ,['Crew Studio member controls are compact cards',app.includes('crew-member-card')&&app.includes('crew-role-button')&&app.includes('crew-role-pill')]
  ,['Crew Studio avoids duplicate announcement control',((app.match(/data-action=\"crew-announcement\"/g)||[]).length>=1)]

  ,['Build Fit uses existing Bench tools skills and learning goals',server.includes('function workFit')&&server.includes('want_learn')&&app.includes('Recommended for My Bench')&&app.includes('build-fit-pill')]
  ,['Make It Yours clones a project without creating a new module',server.includes('/clone')&&server.includes('parent_type')&&app.includes('MAKE IT YOURS')&&app.includes('makeItYours')]
  ,['Guided Build lives inside project workflow',app.includes('Guided Build')&&app.includes('project-guided-build')&&app.includes('guided-toggle')&&app.includes('OPTIONAL WORKING AID · NOT A SCORE')]
  ,['Contextual Help can carry project evidence',app.includes('PROJECT CONTEXT INCLUDED')&&app.includes('project-help')&&app.includes('Latest Notebook entry')]
  ,['Shop Manual exposes provenance and build context',server.includes('tested_by')&&server.includes('source_project_ids')&&app.includes('Build Context + Provenance')&&app.includes('BUILT / TESTED BY')]
  ,['Saved surfaces practical readiness',app.includes('saved-readiness')&&app.includes('MATERIALS TO CHECK')&&app.includes('fit:x.fit')]
  ,['Community Build derivatives are framed as maker variations',app.includes('Maker Variations')&&server.includes("CASE WHEN p.status='Complete' THEN 0 ELSE 1 END")]
  ,['Finished derivative projects can return their result to the Workshop',app.includes('SHOW WHAT YOU BUILT')&&app.includes('showWhatBuilt')&&app.includes("type:'Result'")]

];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`\n${failed} static QA check(s) failed.`);process.exit(1)}else console.log(`\n${checks.length}/${checks.length} static QA checks passed.`);
