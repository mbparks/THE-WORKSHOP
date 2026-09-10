# THE WORKSHOP v10.2.0 QA Report

## Scope

Commons: chronological Have / Need / Teach / Help exchange posts with Project and Maker Crew context, private responses, and owner-managed resolution.

## Coverage

- Static syntax, version, route, privacy, PWA, and release checks.
- Temporary-database integration checks for public discovery, search, project integration, private response access, owner decisions, status changes, and visibility.
- Chromium browser checks for the Commons route, filters, post editor, Project/Crew/Make Together integrations, and response controls.

## Guardrails verified

- No new primary navigation module or generic social feed.
- Chronological ordering with no public response totals, ranking, points, streaks, or popularity signals.
- Project, Crew, member, draft, expiry, and account access remain server-enforced.
- Local exchange records contain approximate city/region only.
- Private responses are visible only to the post owner and responder.

## Results

- Static QA: **310/310 passed**.
- Integration QA: **156/156 passed**.
- Browser QA: **105/105 passed** in GitHub Actions run `34423186773`.
- The local scratch runner does not have Chromium installed, but the CI Chromium image completed the full route and interaction suite.
- `git diff --check`: passed.
