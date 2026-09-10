# THE WORKSHOP v10.1.0 QA Report

## Scope

Unfinished in Public: project-linked snapshots for the current state, stuck point, next tiny step, and useful help request.

## Coverage

- Static JavaScript and application checks.
- API integration checks for public publication, draft exclusion, private visibility, project integration, Make Together integration, edit, and deletion.
- Existing Chromium browser gate remains part of CI.

## Guardrails verified

- No new primary navigation module.
- Chronological ordering; no popularity counts, ranking, points, or streaks.
- Project visibility and member-block rules remain in force.
- Private and draft snapshots do not enter public responses.
- Removing a snapshot does not remove its Project or Notebook entries.
