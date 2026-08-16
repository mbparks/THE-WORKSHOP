# Contributing to THE WORKSHOP

THE WORKSHOP is built around useful making rather than engagement metrics. Contributions should support the product test:

> Does this help someone make, understand, repair, design, discover, teach, or collaborate?

## Development setup

Requirements: Node.js 22.5+ and a modern browser. There are currently no npm runtime dependencies and no frontend compile step.

```bash
cp .env.example .env.local  # optional reference only; the app does not auto-load .env files
npm start
```

Open `http://127.0.0.1:8787`.

For watch mode:

```bash
npm run dev
```

## Before opening a pull request

```bash
node --check server.js
node --check public/app.js
node --check scripts/backup.js
```

Start the server and verify `GET /api/health` returns successfully.

Do not commit runtime data, user uploads, database files, backups, access tokens, or `.env` files.

## Style and product constraints

- Keep Projects—not posts—as the primary content object.
- Do not add follower counts, leaderboards, public like totals, streaks, engagement ranking, or addictive infinite-scroll mechanics.
- Keep Simple mode approachable and put specialist detail in Deep mode where practical.
- Preserve keyboard accessibility, strong contrast, semantic HTML, and reduced-motion behavior.
- Visible controls must work or be clearly marked as not yet implemented.
- Preserve user data and additive database migration behavior.

## Security

Please do not publish suspected vulnerabilities in a public issue. See `SECURITY.md`.
