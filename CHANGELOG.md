# v7.0.4 — Homepage Community Entryways

- Promote Maker Crew discovery and GearHead Crew membership to a dedicated, prominent homepage gateway visible to signed-in and signed-out visitors.
- Add ZIP/postal-code Maker Crew search directly on Home, plus quick access to an existing local Crew.
- Show GearHead Crew pricing ($5/month or $50/year) and direct join/manage actions on Home.
- Keep account requirements contextual: browsing and Crew search remain public; identity is requested only when joining or managing membership.
- Advance app, shell, backup, and service-worker version/cache markers to v7.0.4.

# v7.0.3 — Version & Cache Alignment Hotfix

- Align all executable/runtime version markers to v7.0.3.
- Fix stale v7.0.1 stamp in `start.sh` and backup manifests.
- Version-query-bust `styles.css` and `app.js` so Railway/PWA/browser deployments cannot retain the previous shell assets after release.
- Advance service-worker cache namespace to `workshop-v7.0.3`.

# v7.0.2 — Dual GearHead Stripe Plans

- Added separate monthly and annual GearHead Stripe Price IDs.
- Added $5/month and $50/year checkout choices with annual savings shown clearly.
- Checkout validates the requested plan server-side and never accepts a client-supplied Stripe Price ID.
- Stripe checkout/subscription metadata now records the selected WORKSHOP plan.
- Preserved `STRIPE_GEARHEAD_PRICE_ID` as a backward-compatible single-price fallback.

## v6.4.0 — GearHead Participatory Crew + Hardening

- Added GearHead Contributions for testing notes, corrections, tutorial reviews, BOM checks, alternate-process notes, documentation, and other useful supporter contributions.
- Added editorial contribution review states and member-facing review notes without votes, scores, or leaderboards.
- Added GearHead Crew Projects: editorial shared-build briefs that let a GearHead start a normal linked WORKSHOP Project on their own Bench.
- Added GearHead Crew Studio 2.0 with publishing/program/membership/health signals, pending contributions, Crew Projects, Early Access feedback/request counts, After Hours status, and provider failure visibility.
- Excluded protected GearHead files and media from the service-worker cache explicitly.
- Changed protected GearHead file/media responses to private no-store responses with Cookie variance and no-cache semantics.
- Added lightweight per-user/IP throttling for protected GearHead downloads while preserving byte-range streaming.
- Expanded QA to 102 checks and verified a v6.3.0 database migrates without losing users, projects, or existing GearHead content.

## v6.0.0 — The GearHead Crew

- Added The GearHead Crew supporter identity while retaining the existing Supporter role internally.
- Added server-enforced `GEARHEAD CREW ONLY` access controls.
- Added standalone GearHead entries for tutorials, shop films, bench cam, bench rolls, field notes, downloads, early access, Field Instrument previews, behind-the-scenes material, and Crew updates.
- Added structured tutorial steps, protected revisioned files, scheduled public-release dates, After Hours live events, project-level protected files, GearHead notifications, Studio, and operational analytics.
- Added a GearHead Crew destination to Library/secondary navigation.
- Added `GET SWAG` to the left navigation linking to the Green Shoe Garage Redbubble shop.
- The Workshop community remains open to everyone; GearHead access adds Green Shoe Garage material rather than restricting normal community participation.

# CHANGELOG

## v5.8.6 — Terms & Community Conduct

- Added a public `#/terms` Terms & Community Conduct page with the plain-language rule: “Don’t be an idiot.”
- Added concise rules covering 18+ eligibility, harassment/abuse, lawful and safe making, privacy, user-content rights, moderation, Maker Crew meetups/exchanges, account security, service availability, and reporting.
- New registrations must explicitly accept the current Terms version in addition to the existing 18+ confirmation.
- Added server-side Terms acceptance enforcement for signup so the checkbox cannot be bypassed by calling the API directly.
- Records the accepted Terms version and timestamp without collecting additional identity data.
- Existing accounts that predate the Terms receive a one-time, non-dismissible acceptance prompt on their next authenticated session, with a logout alternative.
- Added a permanent Terms link from About and the Account sheet.
- Added `TERMS.md` alongside the existing Code of Conduct for deployment/repository review.
- Added release QA checks for versioned Terms acceptance and the public Terms route.

## v5.8.5 — 18+ Signup Confirmation

- Added a required “I confirm that I am 18 years of age or older” checkbox to account creation.
- Enforced the confirmation on the registration API so it cannot be bypassed client-side.
- Records only the confirmation timestamp; no birth date is collected.
- Added a regression check for the signup age gate.

## v5.8.4 — Mobile Maker Crew Access

- Added a dedicated Maker Crew hub to the signed-in member’s mobile Bench / Me experience.
- Primary Crew members now get one-tap shortcuts to Crew Home, Meetups, Local Bench, Bulletin Board, and Crew discovery.
- Members without a Crew get a direct Find a Maker Crew call-to-action without requiring GPS or a home address.
- Added Crew access to the Account sheet for quicker mobile navigation.
- Replaced hash-conflicting Crew section anchors with router-safe Crew subroutes such as `#/crew/<id>/meetups`.
- Added smooth section targeting for Meetups, Local Bench, Skills, Tools, Scrap, Questions, Bulletin, and Sessions.
- Preserved the five-item mobile bottom navigation and dark-mode icon contrast fixes.

## v5.8.3 — Mobile Dark-Mode Icon Contrast

- Increased contrast of the mobile Theme and Notifications controls in dark mode.
- Gave both controls an explicit light foreground and SVG stroke rather than relying on inherited browser button color.
- Strengthened their dark-mode borders while preserving the existing panel treatment.
- Left the recovered five-column mobile navigation and inline SVG shell architecture unchanged.
- Added a QA regression check for explicit mobile dark-mode utility-icon contrast.

## v5.8.2 — Mobile Navigation + Inline Icon Recovery

- Reverted the v5.8.1 shell markup regression that collapsed mobile navigation on iOS/Brave.
- Replaced external SVG sprite references with inline SVG paths for reliable rendering across iOS browsers.
- Restored five equal mobile navigation targets: Home, Builds, Start, Workshop, and Me.
- Kept the canonical nested-diamond WORKSHOP brand assets introduced in v5.8.1.
- Added icon metadata cache-busting and bumped the service-worker cache to force fresh shell assets after deployment.
- Added release QA checks for inline icons and the five-column mobile navigation contract.

## v5.8.0 — Transactional Notifications

- Added provider-agnostic transactional email delivery with Resend and local log providers.
- Added Operations Console email configuration, test delivery, and recent delivery status/history.
- New Maker Crew requests now create in-app admin alerts and optional action email.
- New moderation reports now create in-app admin alerts and optional action email.
- Private Crew meetup attendance requests notify organizers; approval decisions notify attendees.
- Password recovery and administrator-generated reset links can now be delivered directly to the member.
- Admin email defaults to `WORKSHOP_ADMIN_EMAIL`, then falls back to the first active Owner email.
- Added user email preferences for account security, Crew attendance, and moderation/Crew decisions.
- Email failures never block the corresponding WORKSHOP action and are recorded for operator review.


## v5.7.1 — Mobile Connectivity Indicator Hotfix

- Prevented the floating connectivity indicator from covering mobile bottom-navigation controls.
- Collapsed the normal ONLINE state to a small status dot positioned above the navigation.
- Offline and queued-sync states still expand into readable pills, also above the navigation.
- Preserved the existing accessible live-region label and tap-to-flush behavior.

## v5.7.0 — Account Management

- Added a dedicated Account Management workbench inside Operations Console for Owner and Administrator roles.
- Added account search by member name, email, role, and account state.
- Added one-time 30-minute password reset-link generation with optional session invalidation.
- Added Force Password Reset on Next Login; forced-reset sessions cannot dismiss the change-password dialog until the password is replaced.
- Added explicit Sign Out All Sessions action.
- Added Disabled as an administrative account state alongside Active, Suspended, and Banned.
- Added permanent account anonymization/removal: credentials, email identity, profile data, memberships, sessions, recovery tokens, notifications, saves, and collections are removed while project/moderation history remains attributable to a non-identifying “Removed member” tombstone.
- Added required administrative reasons and audit entries for reset links, forced resets, session revocation, role/state changes, and anonymization.
- Added account-level audit history to the member-management dialog.
- Added browser-accessible `#/reset/<token>` recovery links for production administration.
- Expanded release QA from 38 to 44 checks.
- Migration remains additive and preserves existing users/projects.

## v5.7.0 — Maker Crews (Batches 52–60)

- Added Maker Crew identities such as `MC21502`, with anchor ZIP/postal code plus optional multi-ZIP coverage.
- Added explicit Crew membership, primary Crew, affiliation visibility, and local Member / Organizer / Moderator roles.
- Added ZIP/postal discovery with optional approximate centroid distance and no member GPS requirement.
- Added Crew pages centered on **WHAT’S HAPPENING NEARBY?** with local projects, questions, skills, tools, scrap, meetups, bulletin posts, announcements, and Crew Sessions.
- Added Tool Cabinet local-help availability without publishing tool storage locations.
- Added meetups with Public / Members visibility, protected exact addresses, RSVP states, optional organizer approval, and private attendance handling.
- Added Crew Projects and Crew Sessions by composing the existing Project and Session systems rather than creating parallel content silos.
- Added Crew request/approval workflow, coverage management, local member roles, Crew Studio, pause/archive support through Crew editing APIs, and global administrative review.
- Added Crew bulletin posts with optional expiry and types such as Looking For, Can Help, Going, Found, and Question.
- Added Home **Around Your Bench**, People → Maker Crews navigation, Crew project badges, Maker Crew global search, and personal export of Crew participation.
- Added responsive Crew layouts and privacy-oriented copy throughout.
- Expanded `npm run qa` from 25 to 37 release checks.
- Migration is additive: existing content is preserved and Crew tables/relationship columns are created automatically.

## v4.0.3 — Safari Route Focus Hotfix

- Removed programmatic DOM focus from route headings entirely, eliminating Safari's native blue focus highlight around large multiline headings such as **WHAT ARE YOU MAKING?**.
- Added a dedicated visually hidden `aria-live` route announcer so screen-reader users still receive route-change context without moving keyboard focus.
- Removed the now-unnecessary heading-focus CSS workaround.
- No database schema changes.

## v4.0.3 — Route Focus Hotfix

- Removed the oversized browser focus outline from programmatically focused route headings such as **WHAT ARE YOU MAKING?**.
- Preserved route-heading focus for screen readers and keyboard navigation while keeping visible focus rings on interactive controls.
- No database or API changes.

## v4.0.3 — Interaction Polish + Accessibility QA

- Added modal focus trapping, focus restoration, labelled dialogs, and safer Escape behavior.
- Added route loading skeletons, retryable error states, smoother route focus management, and reduced-motion fallbacks.
- Improved keyboard navigation with `aria-current`, route heading focus, stronger focus rings, and skip-link behavior.
- Improved live-region semantics for toasts/connectivity and added higher-contrast support.
- Added more deliberate hover/press/upload/loading feedback while keeping motion restrained.
- Improved touch target sizing and mobile modal controls.
- Kept this release schema-neutral for safe Railway deployment over the existing `/data` volume.


## 4.0.3 — Project experience + Maker Notebook (Batches 36–37)

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