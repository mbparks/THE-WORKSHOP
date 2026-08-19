# THE WORKSHOP v9.3.0 — Callsigns & Crew Handles

THE WORKSHOP now has one global @address namespace shared by people and Maker Crews.

## Identity model

- People use **callsigns** such as `@mbparks`.
- Maker Crews use **handles** such as `@mc21502`.
- Every @address resolves to exactly one entity.
- Immutable internal IDs remain the true database identity.
- Display names, callsigns/handles, and internal IDs stay separate.

## Address rules

- 3–24 characters
- lowercase canonical form
- ASCII letters, numbers, hyphens, and underscores
- must begin with a letter or number
- case-insensitive uniqueness
- reserved Workshop/system names are blocked

## Rename + reuse

Changing a callsign or Crew handle places the retired address into a **30-day cooldown**. During cooldown it cannot be claimed. After the cooldown expires, the address returns to the global pool and may be claimed by a different person or Crew.

## Existing accounts and Crews

- Existing members are invited to claim a callsign from My Bench; no callsign is silently published for them.
- New accounts choose a callsign during registration with live availability checking.
- Existing Maker Crews receive deterministic fallback handles based on their Crew code, such as `@mc21502`.
- Crew organizers can change handles in Crew Studio.

## Future-ready addressing

Workshop discussion mentions now resolve through the identity registry rather than guessing from display names. The same registry is ready for future collaboration lookup, Crew invitations, notifications, and other @address interactions.
