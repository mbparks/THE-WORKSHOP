# THE WORKSHOP

**The Green Shoe Garage Maker Community**  
Current release: **v9.2.6**

THE WORKSHOP is a project-centered maker community for design, experimentation, repair, craft, engineering, art, and collaborative learning.

The central object is the **Project**, not the post. A project can begin as an idea, collect notebook evidence, invite critique, recruit collaborators, participate in a Community Build, fail visibly, produce releases, and eventually become durable Workshop knowledge.

THE WORKSHOP intentionally avoids follower counts, popularity ranking, public like totals, engagement streaks, algorithmic feeds, and infinite-scroll mechanics.

> **Does this help someone make, understand, repair, design, discover, teach, or collaborate?**

That is the product test for every feature.

---

## What changed in v9.0.4

### Maker Crew map placement

- **MAKE VISIBLE ON MAP** now seeds the Crew marker from the centroid of the **★ starred/anchor ZIP**.
- Crew Studio exposes editable **Latitude** and **Longitude** fields for fine placement.
- **RESET TO ★ ZIP CENTROID** restores the default ZIP-based position at any time.
- Marker edits refresh Crew Studio immediately and drive the public Workshop Map without reopening the Studio.

v9 is a reliability, privacy, consolidation, and usability release. It completes the information-architecture work begun in v8 while preserving the existing content models and data.

### Reliability and privacy

- One canonical server-side project-visibility gate now protects project lists, Home, search, Bench pages, direct project routes, linked content, project files, releases, and GitHub metadata.
- The canonical access vocabulary is **Public · Members · GearHead · Private**, with **Inherit** only for child records that follow a parent.
- Private and restricted project metadata are filtered before they reach the client.
- Offline retries use account-scoped idempotency keys so replaying a queued write does not create duplicate records.
- Maker Crew organizer forms and duplicate visibility controls were corrected.
- Client/server/service-worker version diagnostics make stale deployments easier to identify.

### Streamlined application model

- **Community Builds** has a normalized aggregate API for Prompts, Build Alongs, Open Briefs, Sessions, Teardowns, and Weekly Prompts.
- **Help + Critique** has a normalized aggregate API for troubleshooting, critique, and identification requests.
- **Live + Calendar** aggregates scheduled Workshop activity and supports ICS export.
- Home now exposes a real **Resume My Project** continuation point for the signed-in member.
- Skill Exchange is integrated into People rather than presented as a disconnected module.
- Scrap Exchange uses Workshop-wide, Crew, local-pickup, and will-ship scopes.
- Project and Maker Crew pages use local object navigation rather than adding more global destinations.

### Member experience

- One shared media library and picker supports upload, preview, caption, alt text, reuse, and removal across supported editors.
- Appearance settings unify theme, display density, and Workshop Atmosphere controls.
- Members can review queued offline work, retry or discard individual changes, and sync all pending work.
- Members can mute or block another member.
- Public projects and maker artifacts have clearer sharing actions.
- GearHead Crew retains monthly and annual plan-specific checkout controls and a dedicated non-member join experience.

### Performance and maintainability

- Craft Path badge artwork uses optimized WebP assets.
- Leaflet is loaded only when the Maker Crew map is opened.
- Retired Field Instrument Lab client code and standalone API routes were removed while historical tables remain for additive data safety and legacy relationships.
- Duplicate generations of major client renderers and forms were removed.
- The browser client remains build-free and uses no npm runtime dependencies.

### Release verification

The release suite includes:

- static source and release checks;
- temporary-database API integration tests;
- real Chromium route, DOM, interaction, atmosphere, pricing, media, navigation, and offline-work tests.

Run the complete suite with:

```bash
npm run qa
```

---

## Primary navigation

```text
HOME

MY BENCH
  Overview
  Notebook
  Maker ID

BUILDS
  Projects
  Community Builds
  The Wall

WORKSHOP
  Discussions
  Help + Critique
  Scrap Exchange

LIBRARY
  Shop Manual
  Saved

LIVE
  Live + Calendar
  Project Clinics

PEOPLE
  Directory
  Maker Crews
  Skill Exchange filters

GEARHEAD CREW
  Crew Home
  Crew Work
  Vault
```

Legacy routes from earlier releases redirect into the appropriate consolidated destination where practical.

See [NAVIGATION.md](NAVIGATION.md) for the current route map.

---

## Core capabilities

### Projects and personal practice

- Project-centered maker profiles called **Benches**
- active, complete, paused, and abandoned project states
- project stages from idea through result
- collaborators and project roles
- lightweight To Do / Doing / Done tasks
- project comments and discussion
- structured Workshop Notebook entries
- experiments, failures, tests, revisions, discoveries, decisions, and results
- personal Notebook view across projects
- Craft Path self-tracking without points, public scores, or leaderboards
- embeddable Bench widgets
- Maker ID with Craft Path and Crew context

### Project evidence and files

- native binary uploads
- logical filename revision history
- SHA-256 provenance hashes
- file access inherited from or restricted beyond the project
- named project releases
- pinned file revisions and downloadable JSON manifests
- optional GitHub repository integration
- privacy enforcement across project metadata and binary files

### Community Builds

Community Builds are curated Workshop invitations rather than a general-purpose posting feed. Supported types include:

- Prompts
- Build Alongs
- Open Briefs
- Sessions and Assignments
- Weekly Prompts
- Teardowns

Owners, Administrators, and Editors can publish Community Builds. Members can participate, start linked projects, submit work, and document results.

### Workshop conversation and help

- structured Discussions in DESIGN / MAKE / FIX / THINK / ODDITIES
- troubleshooting questions with evidence fields
- Design Critique
- What Is This? identification requests
- project-linked help
- response marking such as Solved It, Helped, or Useful Direction
- reporting, moderation records, mute, and block controls

### People and Maker Crews

- maker Directory
- Skills, Tools, Can Help With, and Want to Learn
- Tool Cabinet with privacy controls
- skill-based discovery without expertise scoring
- Maker Crews with list and map views
- ZIP/postal-code discovery using approximate Crew regions rather than member GPS
- Crew membership, local roles, meetups, bulletin posts, Sessions, assignments, projects, and exchanges
- exact meetup-address protection and approval workflows

### Library, Live, and exhibitions

- curated Shop Manual resources
- Saved shelf and collections
- Lessons Learned surfaced from structured project failures
- Live From the Garage
- unified Live + Calendar view
- Project Clinics
- ICS calendar export
- The Wall exhibitions

### GearHead Crew

GearHead Crew is a paid or manually granted membership entitlement with its own section:

- Crew Home
- Crew Work: contributions, Crew projects, and requests
- Vault: current and archived protected material
- tutorials, early-access releases, After Hours, protected media, and downloads
- monthly and annual Stripe Checkout when configured
- provider-neutral manual, invite, external, or Stripe membership records
- server-enforced access and `no-store` delivery for protected files

The rest of THE WORKSHOP remains usable without GearHead membership.

### Local-first and PWA behavior

- installable web application shell
- service-worker shell caching
- private APIs and protected uploads excluded from public caching
- offline mutation queue
- review, retry, discard, and Sync All controls
- account-scoped idempotent replay
- update-ready notification with explicit reload
- theme-aware Workshop Atmosphere with Workshop / Quiet / Off modes
- reduced-motion and high-contrast safeguards

---

## Quick start

### Requirements

- Node.js **22.5 or newer**
- a modern browser
- Chromium or Chrome only when running the browser QA suite

There are no npm runtime dependencies and no frontend compilation step.

```bash
npm start
```

Open:

```text
http://127.0.0.1:8787/#/home
```

Development watch mode:

```bash
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:8787/api/health
```

By default, a non-production local launch enables development sign-in and demo data. Production mode disables both unless explicitly re-enabled.

---

## Configuration

THE WORKSHOP reads configuration from environment variables. It does not automatically parse `.env` files; use your process manager, hosting service, shell, or container environment.

Copy `.env.example` as an operator reference and keep real secrets outside the repository.

### Core variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Use `production` for a public deployment. |
| `HOST` | Bind address. Local/VPS default is `127.0.0.1`; Railway uses `0.0.0.0`. |
| `PORT` | HTTP port, default `8787`. |
| `WORKSHOP_PUBLIC_URL` | Canonical public origin used in links and email. |
| `WORKSHOP_DATA_DIR` | Persistent data directory. |
| `WORKSHOP_DB` | Optional explicit SQLite database path. |
| `WORKSHOP_BACKUP_DIR` | Backup destination. |
| `WORKSHOP_DEV_AUTH` | Development sign-in toggle. Keep `0` in production. |
| `WORKSHOP_SEED_DEMO` | Demo-data toggle. Keep `0` in production. |

### First production Owner

Use the bootstrap variables for initial setup only:

```text
WORKSHOP_BOOTSTRAP_OWNER_NAME=Mike
WORKSHOP_BOOTSTRAP_OWNER_EMAIL=you@example.com
WORKSHOP_BOOTSTRAP_OWNER_PASSWORD=replace-with-a-long-random-password
```

After the Owner signs in successfully, remove the bootstrap password variables from the hosting environment.

### Transactional email

Supported modes are `off`, `log`, and `resend`.

```text
WORKSHOP_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
WORKSHOP_FROM_EMAIL=THE WORKSHOP <workshop@example.com>
WORKSHOP_ADMIN_EMAIL=owner@example.com
```

Email is intentionally limited to action-oriented events such as recovery, Crew requests, protected-meetup approvals, moderation, and administrative account actions.

### GearHead membership and Stripe

```text
WORKSHOP_MEMBERSHIP_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_GEARHEAD_MONTHLY_PRICE_ID=price_...
STRIPE_GEARHEAD_ANNUAL_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Provider-neutral membership bridge variables are also available for external membership systems. See `.env.example` and the deployment guides.

---

## Persistent data

Default local paths:

```text
data/workshop.db
data/uploads/
data/backups/
```

Production deployments should put mutable data outside the Git checkout. A typical Lightsail layout is:

```text
/opt/the-workshop                  application code
/var/lib/the-workshop              SQLite database and uploads
/etc/the-workshop/workshop.env     secrets and configuration
/var/backups/the-workshop          application backups
```

Railway should use a persistent Volume. When attached, THE WORKSHOP automatically recognizes `RAILWAY_VOLUME_MOUNT_PATH`.

Never commit databases, uploads, backups, environment files, browser profiles, or access tokens.

---

## Backups

Create an application backup with:

```bash
npm run backup
```

The backup script uses SQLite's backup facility and includes uploaded files where configured. Backups should also be copied off the application host and periodically restored into a test environment.

A filesystem snapshot is useful, but it does not replace a tested application-level backup.

---

## Quality assurance

### Complete release suite

```bash
npm run qa
```

Release verification for this source snapshot: **208 static checks + 26 integration checks + 39 Chromium checks = 273 passing checks.**

This runs all three layers:

1. **Static QA** — syntax, version alignment, release invariants, accessibility hooks, privacy gates, route wiring, PWA behavior, and package hygiene.
2. **Integration QA** — starts a temporary real server and SQLite database, then tests authentication, project privacy, aggregates, calendar export, mute/block, idempotent replay, and scoped exchanges.
3. **Browser QA** — executes the production HTML, CSS, client JavaScript, router, DOM events, atmosphere, pricing controls, media picker, mobile module map, offline queue, and server APIs in Chromium.

Run layers separately:

```bash
npm run qa:static
npm run qa:integration
npm run qa:browser
```

When Chromium is not on the normal executable path:

```bash
CHROMIUM_PATH=/path/to/chromium npm run qa:browser
```

`npm test` and `npm run qa:full` are aliases for the complete suite.

---

## Deployment

### Railway

Railway is the lowest-maintenance supported deployment path. The repository includes:

- `Dockerfile`
- `railway.json`
- `/api/health`
- production-safe defaults
- persistent-volume detection

See [DEPLOYMENT_RAILWAY.md](DEPLOYMENT_RAILWAY.md).

### Amazon Lightsail

A single-instance deployment using Ubuntu, Node.js, systemd, Nginx, Certbot, and application backups is documented in [DEPLOYMENT_LIGHTSAIL.md](DEPLOYMENT_LIGHTSAIL.md).

Before either deployment:

```bash
npm run qa
```

Do not deploy a package containing `data/`, databases, uploads, backups, `.env` files, or test browser profiles.

---

## Security and privacy boundaries

- Project visibility is enforced on the server, not merely hidden in the interface.
- Protected uploads are never placed in the public service-worker cache.
- GearHead files are entitlement-checked and served with private no-store semantics.
- Passwords are stored as salted hashes.
- Sessions use HTTP-only cookies.
- State-changing requests are origin checked and rate limited.
- Administrative account actions are audited.
- Maker Crew map locations are approximate Crew anchors, not member GPS coordinates.
- Development authentication and demo seeding are disabled by default in production.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and operational expectations.

---

## Source layout

```text
server.js                  Node HTTP server, SQLite schema, API, authorization
public/index.html          persistent application shell
public/styles.css          themes, responsive UI, atmosphere, components
public/app.js              client state, router, views, editors, offline queue
public/sw.js               PWA cache and update lifecycle
scripts/qa.js              static release checks
scripts/integration-qa.js  temporary-server API checks
scripts/browser-qa.js      Chromium route and interaction checks
scripts/backup.js          application backup utility
```

The source is intentionally deployment-friendly: no bundler, transpiler, framework runtime, telemetry SDK, or third-party analytics service is required.

---

## Versioning

Update these together for every release:

- `package.json`
- `APP_VERSION` in `server.js`
- client fallback version in `public/app.js`
- visible shell version in `public/index.html`
- service-worker cache key in `public/sw.js`
- asset query strings in `public/index.html` and versioned badge references
- `CHANGELOG.md`

The application exposes `/api/meta` and `/api/version-diagnostics` to help identify client/server mismatch and stale service-worker deployments.

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Do not add a feature merely because it resembles a conventional social-network feature. Keep the Workshop centered on useful making, evidence, teaching, repair, and collaboration.

---

## License and community terms

Review [TERMS.md](TERMS.md) for THE WORKSHOP's community and account terms. Repository licensing should be declared separately before broad public distribution if it is not already governed by a private or organizational agreement.
