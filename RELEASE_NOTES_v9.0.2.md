# THE WORKSHOP v9.0.2 — Maker Crew Map Placement Controls

## Starred ZIP is now the map default

Each Maker Crew already has a **★ starred ZIP** that acts as its anchor region. In v9.0.2, that ZIP is also the canonical default for Workshop Map placement.

When an organizer presses **MAKE VISIBLE ON MAP**, THE WORKSHOP now resolves an approximate centroid for the starred ZIP, stores it on the anchor ZIP record, and publishes the Crew as Active + Public. This keeps initial marker placement tied to the Crew region rather than to a member location or a private meetup address.

## Editable latitude and longitude

Crew Studio now shows the current map coordinates directly:

- **Latitude**
- **Longitude**

Organizers can edit either value and press **SAVE MARKER**. The Crew Studio refreshes in place and the public Workshop Map immediately uses the new coordinates.

This is intended for fine-tuning a regional marker—for example, moving it to a more representative point within the starred ZIP—without requiring direct database access.

## Reset to the starred ZIP

The new **RESET TO ★ ZIP CENTROID** action resolves the starred ZIP again and restores the default regional marker. This gives organizers a safe escape hatch after manual edits.

## Privacy boundary

The map still exposes only the Crew anchor marker. THE WORKSHOP does not use member home coordinates or private event addresses for Crew map placement.

## Existing Crew Studio fixes retained

v9.0.1's live Member ↔ Moderator role refresh remains in place. Role changes continue to update the open Crew Studio immediately.
