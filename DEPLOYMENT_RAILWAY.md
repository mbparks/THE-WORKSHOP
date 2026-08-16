# Deploy THE WORKSHOP on Railway

This is the recommended low-maintenance deployment path for **THE WORKSHOP v3.5.6**.

THE WORKSHOP runs as one Node.js service with a SQLite database and uploaded files. Railway supplies the application container, HTTPS/public networking, GitHub-triggered deployments, logs, and a persistent Volume.

## What Railway manages

- build and deployment from GitHub
- Node container lifecycle
- public HTTPS endpoint
- custom-domain TLS certificates
- deployment logs and health checks
- persistent Volume attachment

You do **not** need Nginx, Certbot, systemd, SSH deployment scripts, or a manually installed Node runtime.

## Repository support included

This repository contains:

- `Dockerfile`
- `railway.json`
- `.dockerignore`
- `/api/health` health endpoint
- automatic use of `RAILWAY_VOLUME_MOUNT_PATH`
- automatic Railway bind address (`0.0.0.0`)
- safe production defaults for development authentication and demo seeding
- first-run Owner bootstrap variables

---

## 1. Put the repository on GitHub

Create a repository and push the contents of this project to its default branch, normally `main`.

Do not commit `.env`, `data/`, databases, uploads, or backups. The supplied `.gitignore` already excludes them.

---

## 2. Create the Railway project

1. Sign in to Railway.
2. Choose **New Project**.
3. Choose **Deploy from GitHub repo**.
4. Select the THE WORKSHOP repository.
5. Allow the first deployment to be created.

Railway detects the root `Dockerfile`. `railway.json` configures the start command, health check, and restart policy.

---

## 3. Attach persistent storage — required

THE WORKSHOP must have persistent storage because SQLite and uploaded project files must survive redeployments.

1. Open the WORKSHOP service in Railway.
2. Add a **Volume**.
3. Mount it at:

```text
/data
```

Railway automatically exposes that mount path as `RAILWAY_VOLUME_MOUNT_PATH`. THE WORKSHOP v3.5.6 uses that value automatically, so you do not need to set `WORKSHOP_DATA_DIR` manually.

The resulting layout is:

```text
/data/
├── workshop.db
├── uploads/
└── backups/
```

Do not deploy without the Volume. A container filesystem outside a Railway Volume is ephemeral.

---

## 4. Add production variables

Open **Service → Variables** and add:

```text
NODE_ENV=production
WORKSHOP_DEV_AUTH=0
WORKSHOP_SEED_DEMO=0
WORKSHOP_BOOTSTRAP_OWNER_NAME=Mike
WORKSHOP_BOOTSTRAP_OWNER_EMAIL=YOUR_EMAIL
WORKSHOP_BOOTSTRAP_OWNER_PASSWORD=A_LONG_RANDOM_PASSWORD
```

Do not set `PORT`; Railway supplies it.

Do not set `HOST`; THE WORKSHOP automatically binds `0.0.0.0` when it detects Railway.

`WORKSHOP_DEV_AUTH=0` and `WORKSHOP_SEED_DEMO=0` are explicit here for clarity even though production mode now defaults both off.

### Optional GitHub integration

If projects inside THE WORKSHOP should be able to retrieve private GitHub repository data or use a larger API allowance, add:

```text
GITHUB_TOKEN=YOUR_SERVER_SIDE_TOKEN
```

Never expose this token in frontend code.

---

## 5. Deploy

Apply the staged Railway changes and redeploy.

Railway will check:

```text
/api/health
```

A healthy response includes:

```json
{
  "ok": true,
  "version": "3.5.6",
  "database": "ok"
}
```

---

## 6. Create a public Railway domain

In the service's **Networking** settings choose **Generate Domain**.

Open the generated `*.up.railway.app` address and sign in with the bootstrap Owner email/password.

### Important after first sign-in

After confirming that the Owner account works, remove these three variables from Railway:

```text
WORKSHOP_BOOTSTRAP_OWNER_NAME
WORKSHOP_BOOTSTRAP_OWNER_EMAIL
WORKSHOP_BOOTSTRAP_OWNER_PASSWORD
```

The account remains in SQLite. Removing the bootstrap secret prevents the initial password from remaining in hosting configuration indefinitely.

You can then change the password from THE WORKSHOP account settings.

---

## 7. Add your custom domain

A useful final address would be something like:

```text
workshop.greenshoegarage.com
```

In Railway:

1. Open the service's Networking settings.
2. Add the custom domain.
3. Railway will display the DNS record that must be added with your DNS provider.
4. Add that DNS record.
5. Wait for Railway to verify it and provision TLS.

Then set:

```text
WORKSHOP_PUBLIC_URL=https://workshop.greenshoegarage.com
```

and redeploy.

Railway handles the HTTPS certificate; Certbot is not needed.

---

## 8. GitHub deployment workflow

Once GitHub is connected to Railway, normal deployment becomes:

```text
edit code
   ↓
git commit
   ↓
git push origin main
   ↓
Railway builds
   ↓
/api/health passes
   ↓
new deployment becomes active
```

No SSH deployment is required.

---

## 9. Backups

The application can create its own snapshots:

```bash
npm run backup
```

On Railway they will land under the attached Volume by default:

```text
/data/backups/
```

A backup stored only on the same Volume is useful for operational recovery but is **not an off-site disaster backup**. Periodically copy backups outside Railway or use another storage target.

The backup contains the SQLite database, upload tree, and a manifest.

---

## 10. Updating THE WORKSHOP

For GitHub-connected deployment, push changes to the connected branch. Railway automatically creates a new deployment.

Schema migrations are additive and run when THE WORKSHOP starts.

Before a significant upgrade, create a backup.

---

## 11. Rollback

If a code deployment is bad, Railway can redeploy a previous deployment from its deployment history.

Database changes are persistent on the Volume. For a database-level rollback, restore a known-good Workshop backup rather than assuming a code rollback reverses SQLite schema/data changes.

---

## 12. Production checklist

Before inviting members:

- [ ] Railway Volume mounted at `/data`
- [ ] `NODE_ENV=production`
- [ ] development auth disabled
- [ ] demo seeding disabled
- [ ] real Owner account created
- [ ] bootstrap Owner secrets removed after first login
- [ ] generated Railway domain works
- [ ] custom domain works, if used
- [ ] `WORKSHOP_PUBLIC_URL` matches final custom domain
- [ ] `/api/health` reports healthy
- [ ] backup creation tested
- [ ] GitHub Actions smoke test passes
- [ ] optional `GITHUB_TOKEN` stored only as a Railway secret

---

## SQLite and scaling

The current Railway architecture intentionally runs **one application replica with one persistent Volume**. Do not horizontally scale this SQLite deployment across multiple service replicas.

If THE WORKSHOP eventually needs multi-region/multi-replica application servers, migrate the database to PostgreSQL and uploads to object storage first.

## Emergency Owner recovery

Use this only when the intended Owner account exists but its password is no longer known. Do **not** wipe the Railway volume.

Temporarily add these variables and redeploy once:

```env
WORKSHOP_BOOTSTRAP_OWNER_NAME=Mike
WORKSHOP_BOOTSTRAP_OWNER_EMAIL=YOUR_INTENDED_OWNER_EMAIL
WORKSHOP_BOOTSTRAP_OWNER_PASSWORD=A_NEW_LONG_RANDOM_PASSWORD
WORKSHOP_OWNER_RECOVERY=1
WORKSHOP_OWNER_RECOVERY_ID=PASTE_A_NEW_RANDOM_VALUE_AT_LEAST_12_CHARACTERS
```

On startup, WORKSHOP will reset that account's password, reactivate it, promote it to Owner, invalidate its old sessions/tokens, and write an audit event. The recovery ID is stored as a one-time fingerprint and will not execute twice.

After signing in successfully, remove `WORKSHOP_OWNER_RECOVERY`, `WORKSHOP_OWNER_RECOVERY_ID`, and the three `WORKSHOP_BOOTSTRAP_OWNER_*` values, then redeploy again.

