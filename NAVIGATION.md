# THE WORKSHOP v9.0.0 — Navigation and Information Architecture

THE WORKSHOP exposes a small number of durable destinations. Specialized content types remain available inside those destinations rather than each becoming a global module.

## Primary sections

```text
HOME

MY BENCH
  Overview
  Notebook
  Maker ID

BUILDS
  Projects
  Community Builds
  The Wall

WORKSHOP
  Discussions
  Help + Critique
  Scrap Exchange

LIBRARY
  Shop Manual
  Saved

LIVE
  Live + Calendar
  Project Clinics

PEOPLE
  Directory
  Maker Crews
  Skill Exchange filters

GEARHEAD CREW
  Crew Home
  Crew Work
  Vault
```

Desktop contextual navigation and the mobile **MODULES** switcher share the same `NAV_MODULES` definition in `public/app.js`.

## Route families

### Home

- `#/home`

### My Bench

- `#/bench`
- `#/notebook`
- `#/maker-id`
- `#/bench/:userId`

### Builds

- `#/builds`
- `#/community-builds`
- `#/wall`
- `#/projects/:projectId`
- `#/prompt/:promptId`
- `#/build-along/:buildAlongId`
- `#/open-brief/:briefId`
- `#/session/:sessionId`
- `#/assignment/:assignmentId`
- `#/teardown/:teardownId`
- `#/weekly/:weeklyPromptId`

Project detail pages use local navigation for Overview, Notebook, Files, Collaboration, and Help rather than adding global routes.

### Workshop

- `#/workshop`
- `#/help`
- `#/scrap`
- detail routes for discussions, questions, critiques, and identification requests

### Library

- `#/library`
- `#/saved`
- detail routes for Shop Manual resources and Lessons Learned

### Live

- `#/live`
- `#/clinic`
- scheduled Community Build Sessions are represented in the same calendar surface

### People

- `#/people`
- `#/people/help`
- `#/people/learn`
- `#/crews`
- `#/crews/map`
- `#/crew/:crewId`

Maker Crew pages use local navigation for Overview, Meetups, Local Bench, Exchange, and Handbook.

### GearHead Crew

- `#/gearhead`
- `#/gearhead-work`
- `#/gearhead-vault`
- detail routes for protected entries, tutorials, contributions, requests, and Crew projects

Non-members opening the GearHead section receive the membership explanation and available monthly/annual join controls. Entitled members receive the Crew workspace.

## Consolidated concepts

### Community Builds

The following remain distinct content types but share one destination and aggregate API:

- Prompts
- Build Alongs
- Open Briefs
- Sessions
- Weekly Prompts
- Teardowns

### Help + Critique

The following share one destination and aggregate API:

- troubleshooting questions;
- project help;
- Design Critique;
- identification requests.

### Crew Work

GearHead contributions, Crew projects, and requests share one workspace with type filters.

### Vault

Current and archived GearHead resources share one destination.

## Compatibility routes

Earlier bookmarks remain routable where practical. Examples include:

- `#/prompts`, `#/sessions`, and `#/builds/programs` → Community Builds;
- standalone Critique and What Is This? entry points → Help + Critique;
- standalone Workshop Map → Maker Crews map view;
- former GearHead project/contribution/request routes → Crew Work;
- former GearHead file/archive routes → Vault.

Detail URLs continue to resolve directly so old project, prompt, session, critique, and Crew links remain useful.

## Navigation rules

1. A content type does not automatically deserve a module.
2. Global navigation reflects member intent, not database-table boundaries.
3. Rich objects use local navigation.
4. Desktop and mobile navigation use the same source of truth.
5. Detail routes highlight the correct parent destination.
6. Retired modules should redirect during migration and then have obsolete client code removed.
7. Protected destinations may be visible as invitations, but protected content remains server-authorized.
