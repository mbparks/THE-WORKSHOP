# Security Policy

THE WORKSHOP handles member accounts, Project visibility, uploaded files, private discussions, Maker Crew activity, GearHead content, moderation data, membership state, and other community records. Security reports should remain private until they can be reviewed and corrected.

## Reporting a vulnerability

Do **not** open a public GitHub issue containing exploit details, credentials, private user information, or a proof of concept that could put a running community at risk.

Repository maintainers should enable GitHub **Private vulnerability reporting** under Security → Advisories. Use that channel when available. Otherwise contact the repository owner through a private channel.

Include:

- affected THE WORKSHOP version;
- affected route, API, or feature;
- reproduction steps;
- account/access levels involved;
- realistic impact;
- suggested mitigation if known.

## High-priority report categories

Please report issues involving:

- bypass of Public / Members / GearHead / Private visibility;
- access to another member's Private Project or file;
- protected GearHead file/media access without entitlement;
- session, password-reset, verification, or recovery-token weakness;
- CSRF/origin-validation bypass;
- stored or reflected script injection;
- upload path traversal, unsafe content handling, or unauthorized revision access;
- privilege escalation between member, Crew-local, editorial, moderation, and administrative roles;
- Stripe membership/webhook forgery;
- idempotency replay across accounts;
- unintended exposure of exact meetup addresses or member location information.

## Supported version

Until a formal long-term-support policy exists, only the latest tagged release is supported.

## Operational responsibility

Operators must use HTTPS, disable development authentication and demo seeding, protect environment secrets, store mutable data outside the source checkout, monitor backups, and test restoration. A source release cannot compensate for an insecure deployment.
