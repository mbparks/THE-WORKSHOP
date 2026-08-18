# THE WORKSHOP v8.0.5 — Navigation Map Hardening

This release continues the left-hand navigation cleanup begun in v8.0.4.

## What changed

- Desktop contextual navigation and mobile MODULES now read from the same `NAV_MODULES` definition.
- The permanent desktop rail contains only top-level Workshop sections plus site-wide/external destinations.
- Contextual tools appear only under the active module family.
- Detail routes retain the correct contextual highlight, including project, prompt, session, discussion, question, failure, critique, mystery, Maker Crew, GearHead, and related child routes.
- The mobile MODULES switcher marks both the active family and active tool.
- Navigation hierarchy labels are clearer (`SECTIONS`, `BENCH TOOLS`, `BUILD TOOLS`, etc.).
- Service-worker cache version is now `workshop-v8.0.5` so deployed clients do not remain pinned to stale navigation assets.

## Validation

`npm run qa` passes 145/145 checks.

No production database, uploads, or backup data are included in this source package.
