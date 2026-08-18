# THE WORKSHOP v9.0.1 — QA Report

## Result

**286 / 286 checks passed.**

### Static release QA

**212 / 212 passed.**

Includes syntax, version alignment, accessibility hooks, service-worker behavior, privacy gates, Maker Crew one-click map wiring, live Crew Studio refresh wiring, navigation, offline behavior, media, membership, and package-hygiene assertions.

### Integration QA

**31 / 31 passed.**

In addition to the v9 privacy and idempotency tests, v9.0.1 verifies that:

- a hidden Crew with no coordinates can be made map-ready with one API action;
- the action changes the Crew to Active + Public;
- an approximate centroid is stored;
- the Crew immediately appears in `/api/workshop-map`;
- changing a Crew member to Moderator returns the updated record;
- the next Crew payload immediately contains the new role.

### Chromium interaction QA

**43 / 43 passed.**

The real-browser suite verifies that:

- Crew Studio remains open while Member → Moderator changes;
- the row changes immediately to Moderator and exposes MAKE MEMBER;
- the reverse change also refreshes immediately;
- a non-map-ready Crew exposes MAKE VISIBLE ON MAP;
- one click changes that same open Studio to VISIBLE ON MAP;
- OPEN MAP appears without leaving/reopening Crew Studio;
- no uncaught browser exceptions occur during the interaction suite.
