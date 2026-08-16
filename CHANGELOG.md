# Changelog

## v3.5.0 — Railway-ready production deployment

- Added Railway config-as-code and Docker deployment files.
- Added persistent-volume auto-detection via `RAILWAY_VOLUME_MOUNT_PATH`.
- Added safe production defaults: development auth and demo seeding default off.
- Added first-run Owner bootstrap environment variables.
- Added dedicated Railway deployment guide.
- Added Docker ignore rules and Railway health/restart configuration.

THE WORKSHOP uses visible semantic-style version numbers so the deployed UI can be matched to the source release.

## v3.5.0 — Lightsail + repository readiness

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
