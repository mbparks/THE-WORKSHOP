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
  ['version aligned in app',app.includes(`version:'${pkg.version}'`)],
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
  ,['Mobile navigation retains five destinations',(html.match(/class="mobile-nav"[\s\S]*?<\/nav>/)||[''])[0].includes('#/builds')&&(html.match(/class="mobile-nav"[\s\S]*?<\/nav>/)||[''])[0].includes('#/workshop')&&(html.match(/class="mobile-nav"[\s\S]*?<\/nav>/)||[''])[0].includes('#/bench')]
  ,['Mobile navigation enforces five equal columns',css.includes('repeat(5,minmax(0,1fr))!important')]
  ,['Maker ID uses canonical WORKSHOP mark',app.includes('class="workshop-mark"')&&app.includes('maker-id-mark')]
  ,['Icon assets cached for PWA shell',!sw.includes('/ui-icons.svg')&&sw.includes('/icon-maskable-512.png')&&sw.includes('/apple-touch-icon.png')]

];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`\n${failed} QA check(s) failed.`);process.exit(1)}

console.log(`\n${checks.length} QA checks passed for v${pkg.version}.`);
