# THE WORKSHOP v10.2.0 — Commons

v10.2 adds a practical exchange layer for materials, needs, teaching, and bounded help while keeping the Project and Maker Crew as the durable context.

## Commons posts

Members can publish four bounded kinds of exchange:

- **I Have** — a material, tool, skill, or useful spare part.
- **I Need** — a specific thing that would unblock the next step.
- **I Can Teach** — a process, repair, or practice they can show.
- **I Can Help** — a bounded offer to look, test, diagnose, or work through something.

Each post has a title, useful detail, category, exchange terms, scope, visibility, optional expiry, and optional Project/Crew context. Local exchanges accept an approximate city or region only; exact addresses are not part of the Commons record.

## Private response loop

Responses are private between the post owner and the responder. The owner can accept, decline, fulfill, or close the exchange, and both sides receive restrained notifications for meaningful changes. Public surfaces expose no response totals, rankings, follower counts, or popularity signals.

## Existing Workshop surfaces

Commons is available in the Workshop contextual navigation and is surfaced inside:

- Make Together;
- Project pages;
- Maker Crew pages;
- Search and Saved;
- the existing Start Something intent flow.

There is no detached generic social feed and no new primary navigation rail.

## Persistence and access

Commons entries and responses are additive SQLite tables. Visibility, Project access, Crew membership, draft access, expiry, response ownership, export, and account deletion are enforced server-side. Existing URLs remain unchanged.

## Versioning

The application, manifest, service worker, shell asset query strings, and package metadata are aligned to `10.2.0`.
