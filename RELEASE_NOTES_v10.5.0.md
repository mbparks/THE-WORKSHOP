# THE WORKSHOP v10.5.0 — Local Quests

v10.5 adds small, place-aware creative prompts while keeping the Project and Maker Crew as the durable Workshop context.

## Local Quests

Members can write or try six bounded kinds of quest:

- **Notice** — look closely at a surface, route, object, or intervention.
- **Meet** — ask a maker, neighbor, repairer, or friend about a practical decision.
- **Repair** — make one safe observation or bounded intervention on a useful object.
- **Make** — give a clean, understood material a small second use.
- **Explore** — trace a material, object, place, or process.
- **Document** — turn one tested piece of knowledge into a usable field note.

Each quest can carry a timebox, approximate place hint, materials, access notes, safety boundaries, evidence prompt, reflection prompt, tags, and optional Project or Maker Crew context. Exact addresses, coordinates, and private connection details are not part of a quest.

## Private attempt loop

Starting a quest creates a private member attempt. Notes, evidence, and reflection remain private while an attempt is in progress or abandoned. On completion, the maker may intentionally share the field note with Workshop members or publicly. Shared notes carry no ratings, completion totals, rankings, streaks, or popularity signals.

## Existing Workshop surfaces

Local Quests are available through the existing Builds context navigation and are surfaced inside:

- Home;
- Make Together;
- Project pages;
- Maker Crew pages;
- Saved and Search; and
- the existing Start Something intent flow.

There is no detached social feed and no new primary navigation rail.

## Persistence and access

Quests and attempts use additive SQLite tables. Quest visibility, Project and Crew attachment, draft access, completed-note visibility, saves, export, account deletion, and demo reset are enforced server-side. Existing URLs and modules remain intact.

## Versioning

The application, manifest, service worker, shell asset query strings, and package metadata are aligned to `10.5.0`.
