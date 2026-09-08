# THE WORKSHOP v9.12.0 — QA Report

## Result

**504 / 504 checks passed**

- **289 / 289 static release checks**
- **125 / 125 live Node + SQLite integration checks**
- **90 / 90 Chromium interaction checks**

## Open Bench Hours coverage

The release verifies that:

- only the owner of an active Open Bench Project can schedule a Bench Hour;
- scheduling is bounded to valid future windows between 15 minutes and 8 hours;
- upcoming hours remain attached to their source Projects and appear soonest first on Home;
- Project visibility gates every Project, discovery, request, and calendar response;
- private Project hours never leak through public discovery;
- place requests and their notes remain private to the host and requesting maker;
- connection details remain hidden from visitors and pending requests;
- accepted makers receive the private connection details;
- capacity prevents overbooking without publishing capacity, attendance, or demand counts;
- hosts can accept, decline, and cancel while requesting makers can withdraw;
- request, decision, and cancellation notifications remain restrained and action-oriented;
- hosted and accepted hours reuse Live + Calendar and its ICS export;
- ended windows close automatically;
- the browser can schedule, request, accept, reveal details, discover on Home, and see the hour in Calendar without uncaught runtime errors;
- no leaderboard, popularity score, streak, public attendance total, opaque feed, or new top-level module was added.
