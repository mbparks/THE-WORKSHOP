# THE WORKSHOP v9.1.0 — QA Report

## Result

**312 / 312 checks passed**

- **225 / 225 static release checks**
- **37 / 37 live Node + SQLite integration checks**
- **50 / 50 Chromium interaction checks**

## v9.1.0 coverage

The release specifically verifies:

- Bench-aware Build Fit exists without adding ranking or gamification;
- visible projects return Build Fit for signed-in members;
- Make It Yours creates a linked personal project variation;
- personalized projects preserve source lineage and a starter Notebook entry;
- Guided Build remains inside the Project workflow;
- project-aware Help + Critique can carry editable project context;
- Shop Manual provenance fields and project references are supported;
- Saved surfaces practical readiness context;
- Community Build derivatives are framed as Maker Variations;
- finished derivative projects can return a Result to the Workshop;
- all primary routes render without uncaught browser errors;
- existing Crew Studio, map, privacy, offline, membership, and atmosphere behavior remains intact.

## Release hygiene

The packaged source excludes production databases, uploads, runtime data directories, `.env` secrets, browser profiles, `node_modules`, and backups.
