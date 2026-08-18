# Contributing to THE WORKSHOP

THE WORKSHOP is built around useful making rather than engagement metrics. Every contribution should pass the product test:

> Does this help someone make, understand, repair, design, discover, teach, or collaborate?

## Development setup

Requirements:

- Node.js 22.5+
- a modern browser
- Chromium or Chrome for browser QA

There are no npm runtime dependencies and no frontend build step.

```bash
npm start
```

Open `http://127.0.0.1:8787/#/home`.

For watch mode:

```bash
npm run dev
```

A non-production local launch enables development sign-in and demo data by default. Never enable those conveniences on a public production service.

## Before opening a pull request

Run the complete release suite:

```bash
npm run qa
```

This includes static, temporary-database integration, and Chromium route/interaction tests. When Chromium is not discoverable automatically:

```bash
CHROMIUM_PATH=/path/to/chromium npm run qa:browser
```

Also confirm:

- the relevant visibility levels were tested with anonymous, Member, GearHead, collaborator, owner, and editorial roles as applicable;
- desktop context navigation and mobile MODULES navigation both reach the changed workflow;
- route transitions do not break Workshop Atmosphere or active navigation state;
- no secrets, databases, uploads, backups, browser profiles, or generated runtime data are included;
- visible client, server, package, service-worker, and asset versions were updated together;
- schema changes are additive or have an explicit, tested migration plan.

## Product and interface constraints

- Keep Projects—not posts—as the primary content object.
- A content type does not automatically deserve a top-level module.
- Prefer intent-based entry points and local object navigation over global-navigation growth.
- Do not add follower counts, leaderboards, public like totals, streaks, engagement ranking, addictive infinite scroll, or algorithmic popularity feeds.
- Keep **Focused** display density approachable and reserve **Detailed** for more evidence and context—not authorization.
- Administrative capability must not disappear merely because a user selects Focused density.
- Preserve keyboard accessibility, semantic HTML, strong contrast, reduced-motion behavior, and high-contrast suppression of decoration.
- Visible controls must work or be explicitly unavailable; do not ship decorative mock controls.
- Preserve user data, privacy boundaries, and additive migration behavior.
- Enforce access on the server. Client-side hiding is not authorization.
- Reuse shared media, visibility, navigation, and editor components rather than creating parallel variants.

## Code organization

Keep responsibilities clear:

- `server.js` owns authorization, persistence, APIs, migrations, and static delivery.
- `public/app.js` owns client routing, rendering, editors, and offline UX.
- `public/styles.css` owns themes, responsive behavior, and component presentation.
- `scripts/qa.js` protects release invariants.
- `scripts/integration-qa.js` verifies server behavior with a temporary database.
- `scripts/browser-qa.js` verifies real client routes and interactions in Chromium.

Avoid re-declaring an existing renderer or form function. Replace or refactor the existing implementation instead of appending another generation whose last declaration silently wins.

## Data and secrets

Do not commit:

- `.env` files;
- SQLite databases or WAL/SHM files;
- user uploads;
- backups;
- provider tokens;
- Stripe or email secrets;
- test browser profiles;
- production logs containing personal data.

## Security

Do not publish suspected vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md).
