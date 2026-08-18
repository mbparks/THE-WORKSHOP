# THE WORKSHOP v9.0.2 — QA Report

## Result

**293 / 293 checks passed**

- **213 / 213 static release checks**
- **34 / 34 live Node + SQLite integration checks**
- **46 / 46 Chromium interaction checks**

## Maker Crew map coverage added in v9.0.2

The release specifically verifies that:

- one-click map publishing succeeds;
- the default map point is resolved from the **starred / anchor ZIP**;
- a Crew becomes Active + Public when published to the Workshop Map;
- editable latitude and longitude are exposed in Crew Studio;
- manually saved coordinates immediately drive the public map marker;
- Crew Studio refreshes in place after coordinate edits;
- **RESET TO ★ ZIP CENTROID** restores the regional default;
- Member ↔ Moderator changes continue to refresh Crew Studio immediately;
- exact member locations and private event addresses are not used for Crew map pins.

## Release hygiene

The packaged source does not contain:

- production databases;
- uploaded member files;
- `.env` secrets;
- runtime data directories;
- browser profiles;
- `node_modules`;
- production backups.
