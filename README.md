# THE WORKSHOP

**THE WORKSHOP — The Green Shoe Garage Maker Community**

Current version: **v4.0.1**

THE WORKSHOP is a maker-community application built around one question:

> **WHAT ARE YOU MAKING?**

The fundamental object is the **Project**, not the post. Projects can remain incomplete, fail, fork into new approaches, collect evidence, ask for critique, recruit collaborators, publish revisions, and become part of the community's shared knowledge.

The product intentionally avoids follower counts, popularity ranking, engagement streaks, algorithmic feeds, public like totals, and other conventional social-media incentives.

## v4.0.1 experience pass

Run `npm run qa` before deployment to execute syntax and accessibility-regression checks.

This release completes the first interaction/accessibility polish pass: modal focus management, keyboard route focus, loading skeletons, retryable error states, restrained motion, reduced-motion/contrast support, and larger mobile touch targets. It is schema-neutral and can be deployed over the existing persistent Railway data volume.

## Quick start

Requirements:

- Node.js **22.5+**
- a modern browser

There are currently **no npm runtime dependencies** and **no frontend compile step**.

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8787
```

For development watch mode:

```bash
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:8787/api/health
```

## Recommended deployment: Railway

For the lowest-maintenance production deployment, use Railway with a persistent Volume mounted at `/data`. THE WORKSHOP automatically detects Railway's volume mount, binds to the Railway network interface, exposes `/api/health`, and disables development auth/demo seeding by default when `NODE_ENV=production`.

See **[DEPLOYMENT_RAILWAY.md](DEPLOYMENT_RAILWAY.md)** for the complete setup.

The repository includes `Dockerfile`, `.dockerignore`, and `railway.json`, so a GitHub-connected Railway service can deploy without Nginx, Certbot, systemd, or SSH-based application updates.

## Amazon Lightsail deployment

A complete production-style installation guide is included:

**[DEPLOYMENT_LIGHTSAIL.md](DEPLOYMENT_LIGHTSAIL.md)**

It covers:

- Lightsail instance creation
- Static IP and firewall configuration
- Ubuntu and Node.js 22
- separate runtime-data directories
- systemd supervision
- Nginx reverse proxy
- DNS
- Let's Encrypt / Certbot HTTPS
- daily application backups
- Lightsail snapshots
- Git-based updates and rollback
- recovery procedures

The supplied production layout keeps code, mutable community data, secrets, and backups separated:

```text
/opt/the-workshop                  Git checkout
/var/lib/the-workshop              SQLite + uploads
/etc/the-workshop/workshop.env     production configuration/secrets
/var/backups/the-workshop          application backups
```

## Core capabilities

### Making and projects

- Project-centered community model
- Idea / Design / Prototype / Test / Failure / Revision / Build / Result workflow
- experiments, repairs, teardowns, Show & Tell
- rich project metadata
- collaborative project roles
- lightweight To Do / Doing / Done project tasks
- build logs with structured Deep-mode notebook fields
- first-class **THIS DIDN'T WORK** entries
- project comments and discussion
- Design Critique
- Project Clinic

### Files and engineering evidence

- native binary project-file uploads
- project visibility enforcement on file access
- logical filename revision history
- SHA-256 provenance hashes
- named project releases
- exact revision pinning
- downloadable JSON release manifests
- immutable release references
- optional GitHub repository integration

### Community

- member Bench
- Skills / Tools / Can Help With / Want to Learn
- optional Tool Cabinet
- Skill Exchange
- WORKSHOP discussion areas: DESIGN / MAKE / FIX / THINK / ODDITIES
- structured Ask the Workshop troubleshooting
- Question of the Week
- What Is This? identification workflow
- Teardown Club
- Scrap Bin reuse board
- restrained notifications
- Saved shelf and Collections

### Green Shoe Garage publishing

- Shop Notes
- Build Alongs with **START MY VERSION**
- Open Briefs with equal-footing response exhibitions
- Live From the Garage
- Field Instrument Lab
- curated Library / Shop Manual
- curated project exhibitions through **The Wall**
- optional provider-neutral Supporter entitlements

### Operations

- real account registration/login
- `scrypt` password hashes
- HttpOnly sessions
- verification/recovery token flows
- role-based moderation and administration
- Operations Console
- account suspension/ban
- audit logs
- same-origin mutation validation
- rate limiting
- security headers
- `/api/health`
- SQLite-consistent backup tooling
- responsive PWA
- offline cached reading, draft recovery, and safe queued JSON mutations

## Architecture

```text
Browser / PWA
      │
      │ HTTP / JSON
      ▼
Node.js server
      │
      ├── SQLite
      ├── project uploads
      ├── backup snapshots
      └── optional GitHub REST API cache
```

### Frontend

- semantic HTML
- modern CSS
- vanilla JavaScript
- hash-based SPA navigation
- Service Worker
- Web App Manifest

### Backend

- Node.js 22+
- native `node:http`
- native `node:sqlite`
- cookie sessions
- local disk object/file storage

The deliberately simple single-instance architecture is suitable for local development and a carefully operated small community deployment. A larger multi-instance deployment should replace SQLite with PostgreSQL and local uploads with S3-compatible storage while preserving the API/product model.

## Environment variables

THE WORKSHOP reads environment variables from the process environment. It does **not** automatically load `.env` files.

See **`.env.example`** for a production template.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | unset | Set `production` for public deployment; enables Secure session cookies |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `8787` | HTTP port |
| `WORKSHOP_DEV_AUTH` | `1` | Set `0` in production to disable seeded development authentication |
| `WORKSHOP_PUBLIC_URL` | empty | Canonical public origin used for mutation-origin validation |
| `WORKSHOP_DATA_DIR` | `./data` | Mutable runtime root containing uploads and default database/backups |
| `WORKSHOP_DB` | `$WORKSHOP_DATA_DIR/workshop.db` | SQLite database path |
| `WORKSHOP_BACKUP_DIR` | `$WORKSHOP_DATA_DIR/backups` | Backup output directory |
| `WORKSHOP_RATE_LIMIT` | enabled | Set `0` only for controlled testing to disable the in-process limiter |
| `GITHUB_TOKEN` | unset | Optional server-side GitHub token; never expose to browser code |

Example production environment:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
WORKSHOP_DEV_AUTH=0
WORKSHOP_PUBLIC_URL=https://workshop.example.com
WORKSHOP_DATA_DIR=/var/lib/the-workshop
WORKSHOP_DB=/var/lib/the-workshop/workshop.db
WORKSHOP_BACKUP_DIR=/var/backups/the-workshop
```

## Runtime data

By default the application creates:

```text
data/workshop.db
data/uploads/
data/backups/
```

These are intentionally ignored by Git.

For production, use `WORKSHOP_DATA_DIR` to keep mutable state outside the repository checkout.

## Authentication notes

Production deployments should always set:

```text
NODE_ENV=production
WORKSHOP_DEV_AUTH=0
WORKSHOP_PUBLIC_URL=https://your-real-hostname.example
```

Verification and recovery token generation is implemented. A public service still needs a real outbound email transport wired to those token-delivery flows.

## GitHub integration

Individual Workshop projects may optionally link to GitHub using either:

```text
owner/repository
```

or:

```text
https://github.com/owner/repository
```

The server can surface repository metadata, README context, recent releases, and recent issues. Data is cached server-side and a GitHub outage does not make the Workshop project unavailable.

Public repository lookups can operate without a token subject to GitHub's limits. Set a server-side `GITHUB_TOKEN` for higher limits or private repositories the token is authorized to read.

## Backups

Create an application backup manually:

```bash
npm run backup
```

A backup contains:

- a consistent SQLite snapshot
- current upload payloads
- a JSON manifest

The Lightsail deployment package also includes:

```text
deploy/lightsail/workshop-backup.service
deploy/lightsail/workshop-backup.timer
```

for automatic daily backups.

Always keep important backups off the application server as well. A backup that lives only on the same VPS is not sufficient disaster recovery.

## Repository layout

```text
.
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md
│   └── workflows/ci.yml
├── data/                       runtime data (ignored except .gitkeep)
├── deploy/
│   └── lightsail/
│       ├── nginx.conf.example
│       ├── workshop.service
│       ├── workshop-backup.service
│       └── workshop-backup.timer
├── public/
│   ├── app.js
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── styles.css
│   └── sw.js
├── scripts/
│   └── backup.js
├── .env.example
├── .gitattributes
├── .gitignore
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── DEPLOYMENT_LIGHTSAIL.md
├── SECURITY.md
├── package.json
├── server.js
└── start.sh
```

## GitHub-ready workflow

This release includes:

- clean runtime-data ignores
- secret/environment ignores
- `.gitattributes`
- issue forms
- pull-request template
- GitHub Actions CI
- contribution guidelines
- security-reporting policy
- community code of conduct
- deployment assets
- changelog

The CI workflow checks JavaScript syntax, starts THE WORKSHOP under Node 22, and verifies `/api/health`.

### Suggested first repository setup

```bash
git init
git branch -M main
git add .
git commit -m "Initial THE WORKSHOP v4.0.1 release"
git remote add origin git@github.com:YOUR_ACCOUNT/THE-WORKSHOP.git
git push -u origin main
```

Then create/tag the release:

```bash
git tag -a v4.0.1 -m "THE WORKSHOP v4.0.1"
git push origin v4.0.1
```

Before accepting external contributions, also decide and publish the repository's software/content licensing policy. **No software license is assumed by this repository package.**

## Development checks

```bash
node --check server.js
node --check public/app.js
node --check scripts/backup.js
```

Run the server and verify:

```bash
curl --fail http://127.0.0.1:8787/api/health
```

## Updating versions

For a release change, keep these synchronized:

- `package.json`
- `APP_VERSION` in `server.js`
- frontend fallback version in `public/app.js`
- visible version in `public/index.html`
- service-worker cache name in `public/sw.js`
- `start.sh`
- backup manifest version
- README / CHANGELOG

## Security

See **[SECURITY.md](SECURITY.md)**.

Important operational rules:

- never commit `.env` files or credentials;
- never expose `GITHUB_TOKEN` to frontend code;
- do not expose the Node port directly on the public firewall;
- terminate public traffic through HTTPS;
- disable development authentication in production;
- back up both SQLite and uploaded files;
- test restoration, not just backup creation.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**.

The primary product test remains:

> **Does this help someone make, understand, repair, design, discover, teach, or collaborate?**

## License

A software license has not been selected in this package. Until the repository owner chooses and publishes one, do not assume permission to redistribute or modify the code beyond what copyright law otherwise permits.

## One-time Owner recovery

Production deployments can explicitly recover an existing Owner account with `WORKSHOP_OWNER_RECOVERY=1`, the bootstrap Owner email/password, and a unique `WORKSHOP_OWNER_RECOVERY_ID`. Each recovery ID executes once, invalidates prior sessions, and is audit logged. See `DEPLOYMENT_RAILWAY.md` for the exact procedure.
