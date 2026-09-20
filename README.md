# United States Marshals Service Discord bot

This version targets server `1536150657440948324`. Infractions, promotions, tickets, welcomes, deployments, logs, HR role requests and emoji installation are active. Configuration and command help support those systems. Shifts, quota, arrest reports, applications, most-wanted, spam DMs, verification, say, purge and emoji deletion are not available.

## Hosting and preservation

Render: build `npm install`, start `node index.js`, Node 22.22.0. Set `BOT_TOKEN` and either `MONGODB_URI` or `MONGODB_HOST`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`. `MONGODB_DATABASE` is optional. The code explicitly targets the server in `src/settings.js`; set Render `GUILD_ID` to the same ID. Enable Server Members and Message Content intents in Discord.

This server uses separate `guild_1536150657440948324_` MongoDB collections, so old tickets, counts and role-change retries cannot run against the new server. MongoDB credentials stay in Render. USMS banners are in `assets/banners/usms`. Promotions, infractions, deployments, ticket launchers and opening panels use their matching upper banner; every V2 container has the USMS footer. Welcome and closing messages remain plain text.

Connection recovery, heartbeat diagnostics and `/readyz` remain. No code can guarantee uninterrupted hosting on a suspended or stopped Render service.

## Destinations

| Use | Channel/category ID |
| --- | --- |
| Ticket launcher | 1536201127950024714 |
| Opened tickets | 1548331533197115563 |
| Infraction notices | 1539959958903455815 |
| Promotion notices | 1539959822680592415 |
| Bot logs | 1548066902629294131 |
| Ticket logs and transcripts | 1536274703050612797 |
| Infraction logs | 1544603710192357387 |
| Infraction appeals | 1544620247527465040 |

Welcome and deployment channels were not supplied. Welcome uses the server system channel until `/config channel destination:welcome` is set; deployment requires `/config channel destination:deployment`. Other event logs default to the bot-log channel and remain individually configurable. Logs never trigger mention pings.

## Commands and permissions

- `/config view`, `/config channel`, `/config panel panel:ticket`, `/config staff-role`, `/config ticket-access`
- `/infraction issue`, `/infraction edit`, `/infraction revoke`, `/promotion issue`, `/suspension end`
- `/deployment`, `/close`, `/closerequest`, `/ticketpanel`, `/cmds`
- Prefix equivalents: `-deployment`, `-close`, `-closerequest reason`, `-ticketpanel`

Configuration requires Administrator. The owner and administrators have staff access. Configure `management`, `infraction`, and `promotion` roles with `/config staff-role`; no previous-server staff IDs are reused. The management role grants general staff-command access. Set `deployment_ping` to enable a deployment role ping.

Ticket staff access is set per department with `/config ticket-access`. Without a department role, new tickets use the management role; without either, the opener, bot and administrators retain access. Existing tickets retain their saved support role. Escalation grants access to the configured HR Support role and notifies it.

## Tickets

All five options create private channels in the configured opened-ticket destination:

- General Support — General questions or server issues.
- OPR Report — Office of Professional Responsibility reports.
- Divisional Inquiries — Questions relating to specific divisions.
- HR Support — Human Resources assistance.
- Recruitment Support — Assistance with applications and joining.

Recruitment Support is a support ticket, not an application workflow. A reason is required before opening. OPR also collects the reported member and evidence. The V2 opening message includes Claim, Close and Escalate controls. Failed opening-panel delivery retries automatically.

If the destination is a text channel, private ticket channels are created in its parent category, or at the server root if it has no parent. Explicit overwrites deny public access. `/ticketpanel` and `-ticketpanel` use the configured launcher channel. `/config panel` allows an explicit override.

Closing saves all transcript parts to the ticket-log channel first, then sends a plain-text closing notice and waits 10 seconds before deletion. Open, claim and close events are logged. Appeals are limited to the recipient of an appealable case; submission opens or reuses a private OPR ticket and posts the appeal details and ticket link to the configured appeal-review channel.

## Discipline

| Marker | Role ID |
| --- | --- |
| Warning 1 | 1550972697830367263 |
| Warning 2 | 1550972751496487102 |
| Strike 1 | 1550972916005478562 |
| Strike 2 | 1550972965363912754 |
| Suspended | 1550973028114890752 |
| Terminated | 1550973091000090655 |
| Blacklisted | 1550973143785410650 |

Warning 3 converts to a strike. Strike 3 suspends. Suspension saves/removes manageable roles and gives the suspension marker. Optional expiry or `/suspension end` restores saved roles; missing roles or hierarchy restrictions keep restoration pending. No retained role was supplied. Termination and Blacklisted apply their marker roles without kicking or banning. Under Investigation is recorded without a marker because no role was supplied. Demotion is recorded; selected rank changes use `/promotion issue`.

Infraction and promotion notices remain Components V2 with the supplied USMS banners. Matching existing server emojis are used with standard-symbol fallbacks. The bot fetches the target server's emoji cache on startup. Member-supplied reasons are escaped and not rewritten.

## Validation

Run `npm test`. Tests cover the active commands, new mappings, five ticket choices, private channel routing, permissions, disciplinary recovery, V2 rendering, logs and connection health. Real Discord permissions and Render deployment still require live verification.

Repost the ticket launcher with `/ticketpanel` after deployment. Saved case notices and existing open-ticket panels refresh automatically. The full-size `Infractions_Banner.png` is used; the additional `image(1).png` is a smaller copy of the same design.

## Edit and revoke infractions

Use the Case ID printed on a notice, optionally prefixed with `INF-`. `/infraction edit case-id:... change-reason:...` accepts optional replacement `reason`, `notes`, `evidence` and `appealable` values. At least one field is required. Recipient and action type are immutable: revoke and reissue to correct them. `/infraction revoke case-id:... reason:...` marks the case revoked without deleting history. Both use the existing infraction permissions and log the moderator and reason; full before/after changes persist in `case_changes`.

Revocation replays remaining active infractions to recalculate warnings, strikes and totals. It synchronizes warning/strike markers, removes a revoked status marker only if no remaining case requires it, and restores saved roles when removing the basis of a current suspension. It does not re-suspend a member for a suspension that already ended. Other rank roles are preserved. Revoked notices disable appeals; edited and revoked notices update in place without pings. Existing delivered DMs are historical copies and are not rewritten. Deleted public notices remain absent, while the audit log retains the change.

Changes are saved before Discord role operations. Interrupted operations retry every 30 seconds and block conflicting member changes until roles and counts finish. Discord hierarchy or missing roles can keep recovery pending. Once revoked, a case cannot be edited or revoked again.

## Ticket names and reasons

New ticket channel names use a cleaned, shortened version of the opening reason plus the last six digits of the opener ID. Empty/non-Latin-only slugs use `support` as a fallback. Existing custom channel names are not renamed. Opening panels display **Reason** followed by inline code; embedded backticks and line breaks are normalized so the format stays intact.

## Transparent emojis

`-add emojis` or `/add-emojis` installs five missing icons from the 33-icon transparent USMS pack. Use `-continue emojis` for the next batch. `-force stop emojis` stops current/queued work after the current request completes. Administrators only; the bot needs Create Expressions. Installation stops when the server is full or Discord rate-limits it. Existing same-name emojis are skipped. The existing server emoji lookup immediately uses new `usms_` icons in V2 headings and controls. All bundled icons used here have a transparent alpha channel. Installation requires invoking the command in Discord; it does not run automatically at startup.

## HR role requests

`/requestrole trainee:@member role:@role` posts a V2 request to `1550639906039136359`, with an HR-only ping and Approve/Deny buttons. Configure `/config staff-role purpose:hr role:@HR` first; the configured HR ticket support role is the fallback. The new HR role ID was not supplied, so no role is guessed. The destination can be changed with `/config channel destination:roleRequests`.

Any server member can submit. Only current HR members or administrators may decide. Self-approval is blocked. The bot needs Manage Roles and a higher role than the requested one. Roles at/above a non-admin reviewer or carrying Administrator/Manage Roles require an administrator's approval. Pending requests and approvals survive restarts; duplicate clicks do not grant twice. Approvals pause while a trainee is suspended or a disciplinary role change is incomplete. The reviewer must still have approval permission when an interrupted assignment retries.

## Availability

Startup jobs now start independently so a slow ticket refresh cannot delay disciplinary or HR-request recovery. BOT_TOKEN authentication, Discord reconnects, the disconnected-session watchdog and heartbeat logs remain. None of these prevent Render Free idle sleep, host restarts, exhausted free hours or network outages. See https://render.com/docs/free. Use an always-on hosting instance to avoid free-tier sleep; this code does not change your hosting plan or create synthetic keepalive traffic.
