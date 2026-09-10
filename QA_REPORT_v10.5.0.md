# THE WORKSHOP v10.5.0 QA Report

## Scope

Local Quests: small, place-aware prompts with optional Project / Maker Crew context, private-by-default member attempts, and voluntary completed field notes.

## Coverage

- Static syntax, version, route, privacy, PWA, release, and Local Quest checks.
- Temporary-database integration checks for anonymous discovery, search, Home / Make Together / Project / Crew integration, attachment authorization, visibility bounds, private attempts, completed field notes, saves, export, and deletion.
- Chromium route and interaction checks for the Local Quest hub, editor, attempt form, field-note publication, existing Workshop surfaces, and Start Something flow. The local scratch runtime does not include a Chromium executable; the suite remains configured for the CI browser image.

## Guardrails verified

- No new generic social feed, completion scoreboard, ranking, follower count, rating, streak, or popularity mechanic.
- Approximate place hints only; no address, coordinate, or private connection fields are exposed.
- Project, Maker Crew, member, draft, attempt, completed-note, save, export, reset, and account access remain server-enforced.
- In-progress and abandoned attempts stay private. Public or member field notes require intentional completion and sharing.

## Results

- Static QA: **331/331 passed**.
- Integration QA: **240/240 passed**.
- Browser QA: blocked in the local scratch runtime because Chromium is not installed; no browser result is claimed here.
- `git diff --check`: passed.
