# THE WORKSHOP v9.4.0 — QA Report

## Result

**357 / 357 checks passed**

- **244 / 244 static release checks**
- **57 / 57 live Node + SQLite integration checks**
- **56 / 56 Chromium interaction checks**

## Phase 1 interaction coverage

The release verifies that:

- Project Talk supports root comments and one-level replies;
- members can edit and remove their own Project comments;
- other members can report Project comments;
- comment authors show their callsign when available;
- Project following can be toggled in place;
- followers receive restrained notifications for meaningful Notebook updates;
- `@callsign` mentions resolve through the global identity registry;
- mentions generate notifications from Project Talk, Notebook entries, Help + Critique, Live discussion, weekly prompts, critiques, and Crew bulletin posts;
- Ask This Maker uses the existing Help + Critique question flow rather than creating private messaging;
- the existing privacy, Crew Studio, GearHead, Build Fit, media, offline, navigation, and Workshop Atmosphere systems remain intact.
