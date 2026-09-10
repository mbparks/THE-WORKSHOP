# THE WORKSHOP v10.6.0 — Quest Trails

Date: 2026-09-10
Status: ready for production publish

## What shipped

- Quest Trails curate an ordered sequence of two to twelve existing published Local Quests.
- Trails include step-to-step notes, an optional timebox, approximate place guidance, access notes, safety notes, tags, and optional Project or Maker Crew context.
- Members can follow a trail at their own pace; each member’s started/completed step progress stays private.
- Added create, edit, delete, save, search, export, account-cleanup, and demo-reset support, with seeded public examples.
- Added Home, Make Together, Project, Maker Crew, Saved, Search, Start Something, and Local Quest navigation integrations.

## Safety and privacy

- Trails accept only published Local Quests, allow two to twelve steps, and reject repeated steps.
- Visibility narrows to the most restrictive linked Project, Maker Crew, and quest-step visibility.
- Place hints are approximate only; Quest Trails have no address, coordinate, or precise-route fields.
- Per-member progress is private. The product exposes no public completion totals, rankings, popularity counts, or streaks.

## Operations

- `WORKSHOP_DATA_DIR` remains external to the checkout so deployments do not replace mutable production state.
- Back up production before significant updates.
- After publish, verify `/api/health` reports `10.6.0` and that the seeded Quest Trail lane is available.
