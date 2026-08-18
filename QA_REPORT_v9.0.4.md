# THE WORKSHOP v9.0.4 — QA Report

## Result

**297 / 297 checks passed**

- **217 / 217 static release checks**
- **34 / 34 live Node + SQLite integration checks**
- **46 / 46 Chromium interaction checks**

## Crew Studio coverage

The release verifies that:

- Crew Studio uses the redesigned operations workspace;
- Crew member role changes refresh the still-open Studio immediately;
- one-click Workshop Map publishing remains functional;
- the starred ZIP remains the canonical regional map default;
- latitude and longitude remain editable at full precision;
- manually saved coordinates immediately update the public marker;
- the marker can be reset to the starred ZIP centroid;
- no uncaught browser exceptions occur during Crew Studio interactions.

Coordinate display format:

`39.68050852174287, -78.76667986159089`
