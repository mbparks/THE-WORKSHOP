# THE WORKSHOP v9.4.0 — Interaction Layer

This release is Phase 1 of THE WORKSHOP's community-interaction expansion. It deliberately keeps conversation centered on projects, questions, and making rather than introducing a generic social feed or private messaging system.

## Project Talk

Projects now support lightweight discussion with one level of replies. Callsigns are shown when available. Members can edit or remove their own comments, and other members can report comments through the existing moderation system.

## Project Following

Members can follow visible Projects without following people. Following is designed around meaningful project activity: new Notebook/build-log entries can generate a restrained notification for followers. There are no follower counts on member profiles and no popularity ranking.

## Callsign Mentions

The global `@callsign` namespace now powers mentions across the major interaction surfaces, including Project Talk, Project Notebook entries, Help + Critique questions and answers, Workshop discussions, Live comments, weekly prompts, critiques, and Maker Crew bulletin posts.

Mentions resolve to immutable internal user IDs, so callsign changes do not change the identity behind an interaction.

## Ask This Maker

Public Maker IDs and public Benches can expose **ASK @CALLSIGN**. This does not create direct messages. It opens the existing **Ask the Workshop / Help + Critique** workflow with the maker's callsign prefilled, keeping the conversation artifact-centered and visible under the user's existing access rules.

## Notifications

The existing restrained notification drawer now distinguishes `@callsign` mentions and activity on Projects a member owns or follows. No streaks, engagement reminders, follower alerts, or artificial urgency were added.
