# Changelog

## v4.0.0 — Experience Redesign + Performance

- Completed the v4 visual and interaction redesign across Home, Projects, Maker Notebook, Start Something, Bench, People, The Wall, and Mobile Workshop.
- Added modal focus trapping, focus restoration, labelled dialogs, route focus management, loading skeletons, retryable errors, reduced motion, higher-contrast support, and improved live-region semantics.
- Added Brotli/Gzip compression for JSON and static responses.
- Added in-memory static asset caching with ETags and conditional `304 Not Modified` responses.
- Added streamed project-file delivery with HTTP byte-range support for large media/CAD artifacts instead of buffering whole uploads in memory.
- Switched repeat PWA shell loads to cache-first/stale-refresh behavior while explicitly excluding `/uploads/` from service-worker storage.
- Added asynchronous image decoding and lazy loading across non-critical imagery while prioritizing the featured image.
- Expanded `npm run qa` to cover performance and private-upload cache safeguards.
- Kept the release schema-neutral for safe Railway deployment over the existing `/data` volume.

## 4.0.0 — Project experience + Maker Notebook (Batches 36–37)

- Rebuilt Project pages around an image-led hero, stage journey, concise overview, and clear section navigation.
- Moved operational metadata, files, team, tasks, GitHub, critique, and Clinic tooling into Deep-mode sections.
- Redesigned Build Logs as a maker notebook with distinct visual language for ideas, tests, failures, decisions, revisions, and results.
- Structured measurements, observations, test results, problems, decisions, and next questions into readable evidence blocks.
- Improved notebook composition with entry-specific prompts while preserving autosave and existing APIs.
- Added responsive project/notebook layouts without database schema changes.

## 3.9.0 — Experience foundation (Batches 33–35)

- Introduced a unified visual system for typography, surfaces, spacing, controls, cards, project states, focus behavior, and light/dark themes.
- Reduced primary navigation to Home, Bench, Builds, Workshop, Library, Live, and People; added contextual section navigation and a purpose-built mobile nav.
- Rebuilt Home as an editorial workshop entrance centered on “WHAT ARE YOU MAKING?”, with workshop pulse, featured bench work, community projects, useful questions, Shop Notes, prompts, The Wall, Live, Field Instruments, and Shop Manual content.
- Project cards now support real cover imagery, stronger stage/maker hierarchy, and technical notebook metadata.
- Added reduced-motion handling and responsive editorial layouts.

## 3.5.6 — Owner recovery hardening

- Added an explicit one-time Owner credential recovery path for production deployments.
- `WORKSHOP_OWNER_RECOVERY=1` now allows the configured bootstrap Owner email to have its password deliberately replaced, account reactivated, and role restored to Owner.
- Recovery requires a unique `WORKSHOP_OWNER_RECOVERY_ID`; each ID is accepted only once and is recorded in the database.
- Recovery invalidates existing sessions and password-reset/verification tokens for the recovered account.
- Recovery actions are written to the audit log without recording the password or recovery secret.
- Updated CLI backup manifests to report v3.5.6.

## v3.5.6 — Railway persistence diagnostics

- `/api/health` now reports the resolved data directory and SQLite path.
- Health output reports whether Railway supplied `RAILWAY_VOLUME_MOUNT_PATH`.
- Health output reports the count of active Owner accounts without exposing credentials.
- Intended to diagnose persistent-volume configuration safely in production.


## 3.5.4 — 2026-08-16

### Changed

- Updated THE WORKSHOP branding to **Green Shoe Garage** throughout the application, seeded content, metadata, manifests, service descriptions, and documentation.
- Updated the example production custom domain to `workshop.greenshoegarage.com`.

## 3.5.3 — 2026-08-16

- Change Password now requires the new password to be entered twice and validates the match in both the browser and API.
- Logging out now always returns the user to the Home screen.
- Preserves the v3.5.2 modal event-routing fixes.


## 3.5.2 — 2026-08-16

### Fixed

- Fixed a regression where clicking or focusing ordinary controls inside a modal could be misidentified as a click on the modal backdrop.
- Login/register fields now remain open and interactive while typing.
- Preserved the v3.5.1 delegated modal-action fix for account controls such as Change Password.


## 3.5.1 — 2026-08-16

### Fixed

- Fixed modal action buttons not firing because modal click propagation bypassed the global `data-action` dispatcher.
- Restored Change Password, Export Data, Supporter Membership, account deletion, and other delegated actions launched from modal surfaces.

## v3.5.1 — Railway-ready production deployment

- Added Railway config-as-code and Docker deployment files.
- Added persistent-volume auto-detection via `RAILWAY_VOLUME_MOUNT_PATH`.
- Added safe production defaults: development auth and demo seeding default off.
- Added first-run Owner bootstrap environment variables.
- Added dedicated Railway deployment guide.
- Added Docker ignore rules and Railway health/restart configuration.

THE WORKSHOP uses visible semantic-style version numbers so the deployed UI can be matched to the source release.

## v3.5.1 — Lightsail + repository readiness

- Added `DEPLOYMENT_LIGHTSAIL.md` with a complete Lightsail/Ubuntu/Nginx/systemd/Certbot deployment procedure.
- Added `WORKSHOP_DATA_DIR` so mutable SQLite/uploads can live outside the Git checkout.
- Made server-side backups honor `WORKSHOP_BACKUP_DIR`.
- Corrected the CLI backup manifest version.
- Added production systemd units for the application and daily backups.
- Added an Nginx reverse-proxy example.
- Expanded `.gitignore` and added `.gitattributes` / `.env.example`.
- Added GitHub Actions smoke CI.
- Added GitHub issue forms and pull-request template.
- Added `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md`.
- Corrected the stale version string in `start.sh`.

## v3.3.0 — Offline PWA + supporter membership

- Cached application shell and successful read requests for offline fallback.
- Added safe offline JSON mutation queue/replay and visible sync state.
- Added provider-neutral supporter entitlements and redeemable supporter codes.

## v3.1.0 — File releases + GitHub integration

- Added SHA-256 file provenance, revision histories, named project releases, and immutable release manifests.
- Added optional server-side GitHub repository metadata, README, release, and issue context.

## v2.9.0 — Teardown Club + Scrap Bin

- Added collaborative structured teardown records.
- Added non-marketplace reuse listings with private inquiries.

## v2.7.0 — Question of the Week + What Is This?

- Added lightweight weekly community prompts.
- Added structured mystery-object identification and explicit resolution.

## v2.5.0 — Field Instrument Lab + The Wall

- Added Field Instrument catalog/testing/feedback.
- Added curated project exhibitions.

## v2.3.0 — Tool Cabinet + collaborative projects

- Added privacy-aware Tool Cabinets.
- Added collaborator invitations, roles, shared project work, and lightweight tasks.

## v2.1.0 — Project Clinic + Skill Exchange

- Added project-problem clinic workflow.
- Added privacy-aware skill matching and contact requests.

## v1.9.0 — Design Critique + Live

- Added structured project critique.
- Added scheduled/live/archived events and discussions.

## v1.7.0 — Moderation + production hardening

- Added Operations Console, account restrictions, audit trail, security headers, origin validation, rate limiting, health checks, and backup tooling.

## v1.5.0 — Native files + accounts

- Added local binary file storage/revisions.
- Added credential-backed accounts, sessions, verification/recovery tokens, password changes, and deletion.

## v1.3.0 — Saved collections + restrained notifications

- Added multi-type saved shelf and private collections.
- Added granular action-worthy notifications.

## v1.1.0 — Library + unified search

- Added curated Shop Manual resources and whole-Workshop discovery.

## v0.9.0 — Build Alongs + Open Briefs

- Added linked community versions and exhibition-style brief responses.

## v0.7.0 — Ask the Workshop + Shop Notes

- Added structured troubleshooting and publisher-owned Shop Notes.

## v0.5.0 — Bench + Workshop discussions

- Added maker-centric Bench profiles and structured DESIGN/MAKE/FIX/THINK/ODDITIES discussions.

## v0.3.0 — Projects + build-log workbench

- Deepened project metadata and editable structured build notebooks.

## v0.1.0 — Initial functioning MVP

- Established the Project-centered Workshop foundation, real Node/SQLite persistence, and no-compile frontend.