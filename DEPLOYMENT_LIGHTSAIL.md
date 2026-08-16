# Install THE WORKSHOP on Amazon Lightsail

This guide deploys **THE WORKSHOP v4.0.1** on a single Amazon Lightsail Ubuntu instance using:

- Ubuntu LTS;
- Node.js 22;
- the built-in SQLite database;
- local project-file storage;
- `systemd` for process supervision;
- Nginx as the public reverse proxy;
- Let's Encrypt / Certbot for HTTPS;
- a Lightsail Static IP;
- application-level daily backups plus optional Lightsail snapshots.

This is an appropriate architecture for a small, carefully operated Workshop community. A later multi-instance deployment should move relational data to PostgreSQL and uploads to S3-compatible object storage.

## 1. Create the Lightsail instance

In the AWS Lightsail console:

1. Choose **Create instance**.
2. Choose a Region near the majority of your users.
3. Choose **Linux/Unix**.
4. Choose **OS Only** and the current Ubuntu LTS image. This guide assumes Ubuntu 24.04 LTS; the commands are also appropriate for recent Ubuntu LTS releases.
5. Choose an instance plan. A small instance is sufficient for initial testing; watch memory, disk, and CPU as real community use grows.
6. Name it something recognizable, such as `gears-workshop`.
7. Create the instance.

AWS Lightsail supports browser-based SSH, so you can complete the installation without configuring a local SSH client first.

AWS reference: https://docs.aws.amazon.com/lightsail/latest/userguide/getting-started-with-amazon-lightsail.html

## 2. Attach a Static IP

Do this before configuring DNS.

In Lightsail:

1. Open **Networking**.
2. Choose **Create static IP**.
3. Select the same Region as the instance.
4. Attach it to `gears-workshop`.

A normal Lightsail public IPv4 address can change after a stop/start. The Static IP prevents your DNS record from having to change with it.

AWS reference: https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html

Record the Static IP. The rest of this guide calls it:

```text
YOUR_STATIC_IP
```

## 3. Configure the Lightsail firewall

On the instance **Networking** tab, allow:

| Protocol | Port | Source |
|---|---:|---|
| TCP | 22 | Prefer your own public IP/range when practical |
| TCP | 80 | Anywhere |
| TCP | 443 | Anywhere |

Do **not** expose port `8787` publicly. Nginx will listen on 80/443 and proxy internally to `127.0.0.1:8787`.

Lightsail maintains independent IPv4 and IPv6 firewalls. If you enable IPv6, review both sets of rules rather than assuming the IPv4 rules automatically apply to IPv6.

AWS reference: https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html

## 4. Connect over SSH

From the Lightsail instance page choose **Connect using SSH**.

You should land at a shell as the normal Ubuntu instance user.

## 5. Update Ubuntu and install base packages

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl nginx snapd
```

Check Nginx:

```bash
sudo systemctl status nginx --no-pager
```

## 6. Install Node.js 22

THE WORKSHOP uses native `node:sqlite`, so it requires **Node.js 22.5 or newer**.

One straightforward Ubuntu installation method is the NodeSource Node.js 22 repository:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node --version
npm --version
```

`node --version` must report at least `v22.5.0`.

NodeSource reference: https://github.com/nodesource/distributions

## 7. Create a dedicated service account and data directories

Do not run the public application as `root`.

```bash
sudo useradd --system \
  --create-home \
  --home-dir /opt/the-workshop \
  --shell /usr/sbin/nologin \
  workshop

sudo mkdir -p /var/lib/the-workshop
sudo mkdir -p /var/backups/the-workshop
sudo mkdir -p /etc/the-workshop

sudo chown -R workshop:workshop /opt/the-workshop
sudo chown -R workshop:workshop /var/lib/the-workshop
sudo chown -R workshop:workshop /var/backups/the-workshop
```

If the `workshop` user already exists, skip the `useradd` command.

## 8. Clone the GitHub repository

For a public repository:

```bash
sudo -u workshop git clone https://github.com/YOUR_GITHUB_ACCOUNT/THE-WORKSHOP.git /opt/the-workshop
```

Then:

```bash
cd /opt/the-workshop
node --check server.js
node --check public/app.js
```

For a private repository, use a read-only GitHub deploy key or another repository credential intended for server deployment. Do not place a personal access token in the repository URL or commit it into the project.

## 9. Create the production environment file

THE WORKSHOP intentionally does **not** auto-load `.env` files. The systemd service reads a root-managed environment file instead.

```bash
sudo nano /etc/the-workshop/workshop.env
```

Use:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
WORKSHOP_DEV_AUTH=0
WORKSHOP_PUBLIC_URL=https://workshop.example.com
WORKSHOP_DATA_DIR=/var/lib/the-workshop
WORKSHOP_DB=/var/lib/the-workshop/workshop.db
WORKSHOP_BACKUP_DIR=/var/backups/the-workshop
```

Replace `https://workshop.example.com` with the real final HTTPS origin, with **no trailing slash**.

If you want the optional GitHub repository integration to use authenticated API access, add:

```ini
GITHUB_TOKEN=YOUR_SERVER_SIDE_GITHUB_TOKEN
```

Keep that token server-side. It must never be copied into `public/`, committed to Git, or exposed to browser JavaScript.

Protect the environment file:

```bash
sudo chown root:workshop /etc/the-workshop/workshop.env
sudo chmod 640 /etc/the-workshop/workshop.env
```

## 10. Install the systemd service

The repository includes a production unit file.

```bash
sudo cp /opt/the-workshop/deploy/lightsail/workshop.service \
  /etc/systemd/system/the-workshop.service

sudo systemctl daemon-reload
sudo systemctl enable --now the-workshop
```

Check it:

```bash
sudo systemctl status the-workshop --no-pager
```

Follow logs with:

```bash
sudo journalctl -u the-workshop -f
```

Test the application directly from the server:

```bash
curl --fail http://127.0.0.1:8787/api/health
```

You should receive JSON reporting a healthy application and version `4.0.1`.

If this fails, fix the application before moving on to Nginx or TLS.

## 11. Configure Nginx

Copy the supplied example:

```bash
sudo cp /opt/the-workshop/deploy/lightsail/nginx.conf.example \
  /etc/nginx/sites-available/the-workshop
```

Replace the example host name:

```bash
sudo sed -i 's/workshop.example.com/YOUR_REAL_DOMAIN/g' \
  /etc/nginx/sites-available/the-workshop
```

Enable the site and remove Ubuntu's default site:

```bash
sudo ln -s /etc/nginx/sites-available/the-workshop \
  /etc/nginx/sites-enabled/the-workshop

sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

The supplied configuration allows request bodies up to 32 MB, which is slightly above THE WORKSHOP's current 30 MB application upload limit.

At this point Nginx should proxy HTTP requests to the local Node process.

## 12. Point DNS at Lightsail

At your DNS provider create:

```text
A    workshop.example.com    YOUR_STATIC_IP
```

If you enabled IPv6 on the instance and intend to serve over it, also create the appropriate `AAAA` record for the Lightsail IPv6 address and confirm the IPv6 firewall permits 80/443.

Wait until:

```bash
dig +short workshop.example.com
```

returns the Lightsail Static IP.

Lightsail can host the DNS zone itself, but the domain does not need to use Lightsail DNS.

## 13. Verify plain HTTP before requesting a certificate

Open:

```text
http://workshop.example.com
```

or test from a terminal:

```bash
curl -I http://workshop.example.com
```

Resolve DNS/firewall/Nginx problems before moving on.

## 14. Enable HTTPS with Certbot

Certbot's current recommended Ubuntu installation path uses its snap package.

```bash
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot
```

Request the certificate and let Certbot update Nginx:

```bash
sudo certbot --nginx -d workshop.example.com
```

Choose the HTTPS redirect when offered.

Test renewal:

```bash
sudo certbot renew --dry-run
```

Certbot reference: https://certbot.eff.org/instructions?ws=nginx

AWS also documents using Let's Encrypt with Nginx on Lightsail:
https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-using-lets-encrypt-certificates-with-nginx.html

## 15. Final production checks

Confirm HTTPS:

```bash
curl -I https://workshop.example.com
```

Confirm the application health endpoint through Nginx:

```bash
curl --fail https://workshop.example.com/api/health
```

Confirm the dev-login endpoint is disabled by opening the Account screen and checking that development identity controls are not available.

Also check:

```bash
sudo systemctl is-enabled the-workshop
sudo systemctl is-active the-workshop
sudo nginx -t
```

## 16. Install automatic application backups

The repository includes a systemd backup service and timer.

```bash
sudo cp /opt/the-workshop/deploy/lightsail/workshop-backup.service \
  /etc/systemd/system/workshop-backup.service

sudo cp /opt/the-workshop/deploy/lightsail/workshop-backup.timer \
  /etc/systemd/system/workshop-backup.timer

sudo systemctl daemon-reload
sudo systemctl enable --now workshop-backup.timer
```

Check the schedule:

```bash
systemctl list-timers workshop-backup.timer
```

Run one backup immediately:

```bash
sudo systemctl start workshop-backup.service
```

Inspect:

```bash
sudo ls -lah /var/backups/the-workshop
```

Each backup contains a consistent SQLite snapshot, the upload tree, and a manifest.

These backups are still on the same virtual server. For disaster recovery, copy important backups off-instance and/or use Lightsail snapshots as an additional layer. AWS explicitly supports instance snapshots for backup/recovery.

AWS reference: https://docs.aws.amazon.com/lightsail/latest/userguide/getting-started-with-amazon-lightsail.html

## 17. Updating THE WORKSHOP from GitHub

Before a significant update, create a backup:

```bash
sudo systemctl start workshop-backup.service
```

Then update the checkout:

```bash
sudo -u workshop git -C /opt/the-workshop fetch --tags
sudo -u workshop git -C /opt/the-workshop pull --ff-only
```

Run syntax checks:

```bash
cd /opt/the-workshop
node --check server.js
node --check public/app.js
```

Restart:

```bash
sudo systemctl restart the-workshop
sudo systemctl status the-workshop --no-pager
curl --fail https://workshop.example.com/api/health
```

Because runtime state lives under `/var/lib/the-workshop`, a normal Git update does not overwrite the database or project uploads.

## 18. Rolling back code

If a code release fails:

1. Stop the service if necessary.
2. Check out the previous known-good Git tag/commit.
3. Restart the service.
4. Verify `/api/health`.

Example:

```bash
sudo systemctl stop the-workshop
sudo -u workshop git -C /opt/the-workshop checkout v4.0.1
sudo systemctl start the-workshop
```

Database migrations are additive, so a database backup before upgrades is still strongly recommended.

## 19. Restoring application data

Do not restore into a running process.

High-level recovery procedure:

```bash
sudo systemctl stop the-workshop
```

Then preserve the damaged/current data, restore the selected `workshop.sqlite` as:

```text
/var/lib/the-workshop/workshop.db
```

and restore that backup's `uploads/` directory into:

```text
/var/lib/the-workshop/uploads/
```

Fix ownership:

```bash
sudo chown -R workshop:workshop /var/lib/the-workshop
```

Restart and verify:

```bash
sudo systemctl start the-workshop
curl --fail https://workshop.example.com/api/health
```

Rehearse the restoration procedure before you need it.

## 20. Recommended Lightsail operations

For a public community instance:

- keep Ubuntu security updates current;
- keep port `8787` private;
- restrict SSH source addresses when practical;
- use HTTPS only for normal users;
- monitor disk usage because project uploads are stored locally;
- periodically test application backups;
- maintain off-instance backups or Lightsail snapshots;
- monitor memory/CPU and resize the Lightsail plan when sustained usage justifies it;
- do not put secrets in the Git repository;
- keep `WORKSHOP_DEV_AUTH=0` in production.

Useful commands:

```bash
# Application status
sudo systemctl status the-workshop --no-pager

# Application logs
sudo journalctl -u the-workshop --since today

# Nginx errors
sudo journalctl -u nginx --since today

# Disk space
df -h

# Runtime data size
sudo du -sh /var/lib/the-workshop

# Backup space
sudo du -sh /var/backups/the-workshop

# Health
curl --fail https://workshop.example.com/api/health
```

## Architecture on Lightsail

```text
Internet
   │
   ├── :80 ──┐
   └── :443 ─┤
             ▼
          Nginx
             │
             │ 127.0.0.1:8787
             ▼
      THE WORKSHOP / Node.js
             │
       ┌─────┴──────┐
       ▼            ▼
    SQLite       uploads/
       │            │
       └──────┬─────┘
              ▼
       /var/lib/the-workshop

Git checkout: /opt/the-workshop
Secrets:      /etc/the-workshop/workshop.env
Backups:      /var/backups/the-workshop
```

This arrangement is intentionally simple enough to operate on one Lightsail VPS while keeping code, secrets, runtime state, and backups separated.
