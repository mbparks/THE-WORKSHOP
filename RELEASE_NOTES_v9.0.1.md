# THE WORKSHOP v9.0.2 — Maker Crew Studio Hotfix

## One-click Workshop Map publishing

Crew organizers no longer need to manually manage status, visibility, latitude, or longitude to make a Maker Crew appear on the Workshop Map.

Crew Studio now shows a **WORKSHOP MAP** status card. When a Crew is not map-ready, one action is available:

**MAKE VISIBLE ON MAP**

That single action:

1. uses the Crew's anchor postal code,
2. reuses a known Workshop postal centroid when one is already available,
3. otherwise resolves an approximate postal centroid automatically,
4. sets the Crew status to **Active**,
5. sets Crew visibility to **Public**,
6. saves the centroid to the anchor postal record, and
7. immediately refreshes Crew Studio to **VISIBLE ON MAP** with an **OPEN MAP** action.

Only the Crew-region postal centroid is mapped. Member locations and private meetup addresses are not used.

## Live Crew role changes

Changing a Crew member between **Member** and **Moderator** now refreshes the currently open Crew Studio immediately. The organizer no longer needs to close Crew Studio and reopen it to see the updated role.

The role API also returns the updated member record, and the Crew detail view refreshes behind the Studio so it is current when the dialog closes.

## Verification

- 212/212 static release checks passed.
- 31/31 live Node/SQLite integration checks passed.
- 43/43 Chromium route and interaction checks passed.
- Total: 286/286 checks passed.
