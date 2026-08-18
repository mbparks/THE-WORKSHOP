# THE WORKSHOP v9.0.0 — QA Report

Release snapshot verified: **2026-08-18**

## Result

```text
Static QA       209 / 209 passed
Integration QA   26 / 26 passed
Chromium QA      40 / 40 passed
--------------------------------
Total           275 / 275 passed
```

## Static QA

Static QA validates JavaScript syntax, aligned v9.0.0 versions, accessibility hooks, security/privacy gates, consolidated routes, PWA/service-worker behavior, optimized assets, documentation state, and package hygiene.

## Integration QA

Integration QA starts a temporary real Node/SQLite instance and verifies:

- anonymous, member, owner, and cross-member Project visibility;
- Home, search, direct-route, and Bench privacy filtering;
- Community Builds, Help + Critique, and Calendar aggregates;
- ICS export;
- Version Diagnostics;
- retired Field Instrument Lab API behavior;
- Mute and Block lifecycle;
- account-scoped idempotent replay without duplicate writes;
- scoped Scrap Exchange creation and filtering.

The temporary database is removed after the run.

## Chromium QA

Chromium QA starts a temporary server and browser profile and verifies:

- v9 shell and Home rendering;
- visible, persistent, recomposed, and animated Workshop Atmosphere;
- GearHead non-member join experience;
- independent monthly and annual plan controls with matching outlines;
- absence of the redundant generic join button;
- development sign-in;
- Home, Bench, Builds, Workshop, Library, Live, People, and GearHead routes;
- combined Appearance controls and Quiet atmosphere mode;
- intent-based Start Something and publisher controls that remain available in Focused density;
- one canonical Project visibility control;
- shared Project media picker;
- Project and Maker Crew local navigation;
- sharing action, ICS export, consolidated search, mobile Modules, and Offline Work controls;
- absence of uncaught browser exceptions during the tested flows.

## Command

```bash
npm run qa
```

Chrome/Chromium may be specified explicitly with `CHROMIUM_PATH`.

## Package boundary

The release archive excludes databases, uploads, protected content, backups, secrets, browser profiles, development dedupe snapshots, and superseded full-size Craft Path PNGs.
