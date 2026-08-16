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
  ['lazy images decode asynchronously',app.includes('decoding=\"async\"')]
];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`\n${failed} QA check(s) failed.`);process.exit(1)}
console.log(`\n${checks.length} QA checks passed for v${pkg.version}.`);
