# Shifts and weekly quota

- `/shift start`, `/shift end`, `/shift status`, `/shift view member:`. Prefix equivalents: `-shift start`, `-shift end`, `-shift status`, `-shift view @member`.
- Optional launcher: `/config panel panel:shift`. No log or active-shift channels are required.
- Only role `1540774157397000202` has the two-hour quota. Other members can track time without quota warnings.
- Deadline: Saturday at 09:00 America/New_York (daylight saving aware). The first period starts when this version first runs. Active sessions count; sessions crossing a deadline are split between weeks. End shifts when duty ends.
- Every missed quota produces a normal, appealable Warning, with the existing warning/strike escalation. A weekly summary goes to the configured infractions channel. Role hierarchy and Manage Roles still apply.
- MongoDB stores sessions, deadline cursors, report snapshots and stable case IDs. Late processing catches up when the bot returns. Eligibility uses server membership and quota-role membership at processing time, rechecked before issuing. Users who leave or lose the quota role before issue are skipped.
- `/quota disable` and `/quota enable` require management/admin access. Enabling starts a fresh period. Disabling stops new quota work, not recovery of cases already saved. `/quota status` shows progress.
- `/infraction edit` and `/infraction revoke` accept the full `INF-quota-...` ID on an automatic Warning.

# White emojis

Run `-add emojis` then `-continue emojis` for successive batches of five. The 38-icon panel catalog uses transparent white icons, including OPR and shift/quota icons. All 200 source icons are white. Panels prefer the new `usms_white_` icons and use actual configured disciplinary role names as fallback emoji aliases. Existing bot-owned USMS icons are replaced; unrelated server emojis are preserved. A pending upload still obeys Discord rate limits. `-force stop emojis` cancels further work.

# Runtime

`BOT_TOKEN` is the primary token variable. MongoDB uses the existing connection variables. Commands retry registration after transient failures. Database readiness is checked every 30 seconds using the existing connection pool. `/readyz` returns 503 when Discord or MongoDB is unavailable; `/` remains the process health endpoint. Discord reconnects and the existing watchdog requests a host restart after 120 seconds offline. Lifecycle logs distinguish host SIGTERM, fatal errors and watchdog restarts. Render Free suspension cannot be prevented by these credentials or bot code; scheduled work runs when the process is running.

`-say text` and `/say message:` require configured say/management access or administrator permissions. Successful prefix invocations are deleted when the bot has Manage Messages.
