# THE WORKSHOP v9.8.0 — QA Report

## Local result

**350 / 350 executable local checks passed**

- **268 / 268 static release checks**
- **82 / 82 live Node + SQLite integration checks**

The 73-check Chromium interaction suite has also been extended for v9.8.0, but this workspace does not include a Chromium executable. It remains part of the required CI release gate and must pass before production deployment.

## Open Bench coverage

The release verifies that:

- only a Project owner can open, change, or close its Bench invitation;
- unsupported signal values are discarded by the server’s bounded vocabulary;
- anonymous discovery exposes public Open Benches and never leaks private Projects;
- invitation detail persists through the additive SQLite migration;
- Home, Builds, Project cards, and Project pages expose Open Bench context;
- a response is stored in the existing Project discussion and returned with the Project;
- discovery uses recent Project updates instead of popularity ranking;
- the interaction adds no response totals, likes, streaks, telemetry, or new feed.
