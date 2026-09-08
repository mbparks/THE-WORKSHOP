# THE WORKSHOP v9.9.0 — QA Report

## Result

**436 / 436 checks passed**

- **272 / 272 static release checks**
- **89 / 89 live Node + SQLite integration checks**
- **75 / 75 Chromium interaction checks**

## Bench Handshake coverage

The release verifies that:

- Handshakes use an additive SQLite table and remain attached to the Project;
- only signed-in non-owners can extend an offer against a currently active, bounded Open Bench signal;
- duplicate active offers for the same maker, Project, and signal are rejected;
- Project owners can acknowledge, complete, or decline an offer with a closing note;
- the maker who offered can withdraw an active Handshake but cannot mark it complete;
- public Handshakes are returned only with a Project the viewer may access;
- the Project page renders status, offer context, owner notes, and role-appropriate controls;
- notifications are limited to new offers and owner status changes;
- the interaction adds no response totals, likes, streaks, telemetry, ranking, or new feed.
