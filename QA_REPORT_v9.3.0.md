# THE WORKSHOP v9.3.0 — QA Report

## Result

**333 / 333 checks passed**

- **238 / 238 static release checks**
- **44 / 44 live Node + SQLite integration checks**
- **51 / 51 Chromium interaction checks**

## Identity coverage

The release verifies that:

- one database-enforced namespace is shared by callsigns and Crew handles;
- existing Maker Crews receive deterministic fallback handles;
- a Crew handle makes the same address unavailable to a person;
- members can claim and rename callsigns;
- Crew organizers can manage handles in Crew Studio;
- callsigns resolve through the identity registry;
- a Crew cannot claim an address already owned by a person;
- retired addresses enter a 30-day cooldown;
- live availability checks are present in registration, My Bench, and Crew Studio;
- mentions resolve through the registry;
- existing Crew Studio/map, privacy, project, and navigation behavior remains intact.
