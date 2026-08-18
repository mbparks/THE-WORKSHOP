# THE WORKSHOP v9.0.0 — Release Notes

## Reliability, Privacy, and UX Consolidation

v9.0.0 is a hardening and consolidation release. It does not add another large module. Instead, it makes the existing Workshop safer, more coherent, easier to operate, and easier to change.

## Release priorities

1. Enforce privacy on the server rather than relying on hidden UI.
2. Make consolidated modules real in the API, not only in presentation.
3. Replace source-presence QA with real integration and browser behavior tests.
4. Reduce duplicated client code and retired implementation paths.
5. Improve day-to-day continuation, media, search, calendar, offline work, and update behavior.

## Major changes

### Canonical project visibility

One `canViewProject()` policy now protects the major project surfaces, including direct project reads, listings, Home, Bench, search, and related views. The supported access levels are Public, Members, GearHead, and Private, with Inherit reserved for appropriate child records.

### Safe offline replay

Queued JSON mutations carry an `X-Idempotency-Key`. The server scopes stored results to the signed-in account and replays the original result instead of creating a duplicate object. Old idempotency records are cleaned up automatically.

### Real aggregate surfaces

- `/api/community-builds` normalizes Prompts, Sessions, Build Alongs, Open Briefs, Weekly Prompts, and Teardowns.
- `/api/help` normalizes questions, troubleshooting, critique, and identification requests.
- `/api/calendar` and `/api/calendar.ics` provide one scheduled-activity surface.

### Personal Home continuation

Home now resumes the signed-in member's own active project or continuation point instead of treating a general community project as “Resume Project.”

### Shared media workflow

A common media asset library and picker now supports reusable uploaded media. The Project editor uses the shared picker for its cover instead of requiring only an external URL.

### Navigation and local hierarchy

The global information architecture remains intentionally restrained. Projects and Maker Crews use local subnavigation for deeper object-specific tasks. Skill Exchange behavior is incorporated into People discovery. Scrap is one scoped Scrap Exchange.

### Appearance and atmosphere

Theme, density, and atmosphere live in one Appearance experience. Focused/Detailed density changes presentation without hiding authorized publishing or management capability. The active Workshop Atmosphere persists across route changes, recomposes by module, uses shorter visible motion cycles, and remains disabled for High Contrast or Reduced Motion where appropriate.

### Update and diagnostics behavior

A waiting service worker announces a new build and reloads only when selected. Version Diagnostics exposes mismatches instead of making cache problems invisible.

### Safety and moderation

Members have personal Mute and Block controls in addition to the existing reporting, moderation, account-status, and audit systems.

### Payload and code cleanup

- Craft Path badge artwork uses optimized WebP assets.
- Leaflet loads only when the Maker Crew map is requested.
- Superseded duplicate renderers/forms and development dedupe snapshots were removed.
- Obsolete Field Instrument Lab client and standalone API implementation were removed; historical tables remain only for additive data safety and legacy relationships.
- Full-size superseded Craft Path PNGs were removed from the release package.

## QA gate

The verified release snapshot passes **275 checks**: 209 static, 26 integration, and 40 Chromium behavior checks.

The release has three independent test layers:

- static syntax and release assertions;
- HTTP/API integration tests against a temporary SQLite database;
- Chromium route and interaction tests against a temporary server and browser profile.

The browser suite covers the application shell, route transitions, atmosphere persistence and motion, GearHead join options, account login, primary modules, Appearance, Start Something and Focused-density publisher access, Project editor visibility/media, Project and Crew local navigation, calendar export, search, mobile modules, Offline Work controls, and uncaught browser errors.

## Data safety

The release archive contains source and static assets only. It must not contain a production database, uploads, protected GearHead content, backups, secrets, or browser profiles.

Startup migrations are additive. Make and test a current backup before updating a production instance.

## Compatibility

Legacy detail routes remain supported where they map to the consolidated Community Builds, Help + Critique, Live, GearHead, and Maker Crew experiences. The service-worker cache name changes to `workshop-v9.0.0`, causing older static caches to be retired on activation.
