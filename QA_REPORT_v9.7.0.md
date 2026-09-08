# THE WORKSHOP v9.7.0 — QA Report

## Result

**338 / 338 available checks passed**

- **263 / 263 static release checks**
- **75 / 75 live Node + SQLite integration checks**
- Chromium interaction QA is defined but could not run in this environment because no Chromium binary is installed or configured.

## First Visit coverage

The release verifies that:

- logged-out Home exposes four public entryways and keeps Take the Tour prominent;
- Find Your First Thing renders three public projects, one Community Build, and one maker or Maker Crew;
- interest selection is keyboard-accessible, reflected with `aria-pressed`, and stored only in local browser storage;
- public project pages expose Start Here guidance;
- the public tour hands off to account-free discovery;
- app, server, service worker, documentation, and visible shell versions remain aligned.
