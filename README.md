# Clearwater Fire Department Discord bot

This version targets server `1521385783477407847`. Infractions, promotions, tickets, welcomes, deployments, logs, HR role requests and emoji installation are active. Configuration and command help support those systems. Shifts, weekly quota, say and department information panels are also active. Arrest reports, applications, most-wanted, spam DMs, verification, purge and emoji deletion are not available.

## Hosting and preservation

Render: build `npm ci`, start `npm start`, Node 22.22.0. Set `BOT_TOKEN` and either `MONGODB_URI` or `MONGODB_HOST`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`. `MONGODB_DATABASE` is optional. The code explicitly targets the server in `src/settings.js`; set Render `GUILD_ID` to the same ID. Enable Server Members and Message Content intents in Discord.

This server uses separate `guild_1521385783477407847_` MongoDB collections, so old tickets, counts and role-change retries cannot run against the new server. MongoDB credentials stay in Render. Clearwater banners are in `assets/banners/cpfr`. Supported panels use their matching upper banner and the Clearwater footer. Welcome and closing messages remain plain text.

Connection recovery, heartbeat diagnostics and `/readyz` remain. No code can guarantee uninterrupted hosting on a suspended or stopped Render service.

## Destinations

| Use | Channel ID |
| --- | --- |
| Assistance ticket panel | 1545944377019596800 |
| General Support tickets | 1521385784622579726 |
| Internal Affairs tickets | 1521385784622579725 |
| Office of the Chief tickets | 1521588452041294066 |
| Infraction notices and shift logs | 1521385785020907600 |
| Promotion notices | 1521385785020907599 |
| Ticket transcripts | 1521385785532878911 |
| Bot logs | 1521385785532878913 |
| Welcome messages | 1521502153942892687 |
| Information | 1521385784622579729 |
| Employee info | 1546638883725385870 |
| Application panel/results | 1545944891316510740 / 1545945073882234900 |
| Verification | 1521568855791767768 |
| Cadet info | 1521385784878563424 |

The previous server’s roles and automatic information panels are disabled. Add this server’s new role IDs before using automated disciplinary roles or staff-role restrictions.

## Commands and permissions

- `/config view`, `/config channel`, `/config panel panel:ticket`, `/config staff-role`, `/config ticket-access`
- `/infraction issue`, `/infraction edit`, `/infraction revoke`, `/promotion issue`, `/suspension end`
- `/deployment`, `/close`, `/closerequest`, `/ticketpanel`, `/cmds`
- Prefix equivalents: `-deployment`, `-close`, `-closerequest reason`, `-ticketpanel`

Configuration requires Administrator. The owner and administrators have staff access. Configure `management`, `infraction`, and `promotion` roles with `/config staff-role`; no previous-server staff IDs are reused. The management role grants general staff-command access. Set `deployment_ping` to enable a deployment role ping.

Ticket staff access is set per department with `/config ticket-access`. Without a department role, new tickets use the management role; without either, the opener, bot and administrators retain access. Existing tickets retain their saved support role. Escalation grants access to the configured HR Support role and notifies it.

## Tickets

The three options create private channels in their configured destinations:

- General Support — General questions or server issues.
- Internal Affairs — report staff misconduct or an internal matter.
- Office of the Chief — administrative assistance and support. A reason is required before opening. Internal Affairs also collects the reported member and evidence. The V2 opening message includes Claim, Close and Escalate controls. Failed opening-panel delivery retries automatically.

If the destination is a text channel, private ticket channels are created in its parent category, or at the server root if it has no parent. Explicit overwrites deny public access. `/ticketpanel` and `-ticketpanel` use the configured launcher channel. `/config panel` allows an explicit override.

Closing saves all transcript parts to the ticket-log channel first, then sends a plain-text closing notice and waits 10 seconds before deletion. Open, claim and close events are logged. Appeals are limited to the recipient of an appealable case; submission opens or reuses a private Internal Affairs ticket and posts the appeal details and ticket link to the configured appeal-review channel.

## Discipline

Disciplinary marker roles are discovered by name in the current server: Warning 1/2, Strike 1/2, Suspended, Terminated, Blacklisted and Under Investigation. No old-server role IDs are assumed. A missing first-tier role does not promote the second-tier role into its place. A Suspended role is required before issuing a suspension or a third strike.

Warning 3 converts to a strike. Strike 3 suspends. Suspension saves/removes manageable roles and gives the suspension marker. Optional expiry or `/suspension end` restores saved roles; missing roles or hierarchy restrictions keep restoration pending. No retained role was supplied. Termination and Blacklisted apply their marker roles without kicking or banning. Under Investigation uses its matching role when present. Demotion is recorded; selected rank changes use `/promotion issue`.

Infraction and promotion notices remain Components V2 with the Clearwater banners. Matching existing server emojis are used with standard-symbol fallbacks. The bot fetches the target server's emoji cache on startup. Member-supplied reasons are escaped and not rewritten.

## Validation

Run `npm test`. Tests cover the active commands, new mappings, three ticket choices, private channel routing, permissions, disciplinary recovery, V2 rendering, logs and connection health. Real Discord permissions and Render deployment still require live verification.

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

`/requestrole trainee:@member role:@role` posts a V2 request to the configured `roleRequests` channel, with an HR-only ping and Approve/Deny buttons. Configure `/config channel destination:roleRequests channel:#hr` and `/config staff-role purpose:hr role:@HR` first; the configured HR ticket support role is the fallback. The new HR role ID was not supplied, so no role is guessed. Destination autocomplete makes every configuration key available, including all log channels.

Any server member can submit. Only current HR members or administrators may decide. Self-approval is blocked. The bot needs Manage Roles and a higher role than the requested one. Roles at/above a non-admin reviewer or carrying Administrator/Manage Roles require an administrator's approval. Pending requests and approvals survive restarts; duplicate clicks do not grant twice. Approvals pause while a trainee is suspended or a disciplinary role change is incomplete. The reviewer must still have approval permission when an interrupted assignment retries.

## Availability

Startup jobs now start independently so a slow ticket refresh cannot delay disciplinary or HR-request recovery. BOT_TOKEN authentication, Discord reconnects, the disconnected-session watchdog and heartbeat logs remain. None of these prevent Render Free idle sleep, host restarts, exhausted free hours or network outages. See https://render.com/docs/free. Use an always-on hosting instance to avoid free-tier sleep; this code does not change your hosting plan. The existing scheduled readiness workflow makes best-effort HTTP checks and is not an uptime guarantee.


## Render shutdown diagnosis and deployment

Service: `srv-d9khnt9t0dsc73e3ftug`, https://los-angeles-roleplay-gnm7.onrender.com.

On September 20, 2026, the live `/readyz` endpoint returned HTTP 200 with Discord and MongoDB connected and commit `ede4296`. Its process uptime was only 200 seconds. GitHub's ten-minute ping schedule actually ran at 07:06, 12:20 and 16:24 UTC, leaving multi-hour gaps. Render Free sleeps after 15 minutes without inbound traffic; a successful deployment does not mean an always-running bot. The exact cause of a particular restart still requires Render's event/runtime logs. GitHub scheduled jobs may be delayed or dropped: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule.

For continuous operation, change this service's instance type to an always-on paid instance in Render. No repository change can disable Free-plan sleep. Set the HTTP health check path to `/readyz`, build command to `npm ci`, and start command to `npm start`. Keep credentials in Render's environment settings.

`/` and `/readyz` return 503 until Discord, MongoDB and command registration are ready. `/livez` checks only the process and must not be used to assert that the bot is operational. JSON includes the deployed commit, uptime and each readiness component. A failed HTTP listener exits instead of leaving an unreachable process running. The Discord recovery loop allows two minutes for ordinary reconnects and rebuilds invalidated sessions after backoff. Cached messages expire to limit memory growth.

Look at the last logs before a restart: `host_sigterm` means the host requested shutdown (sleep, deployment or maintenance); `fatal_restart` identifies a process exception; `discord_recovery` identifies a gateway replacement without a process restart; `discord_login_failed` points to login/network configuration. A sudden stop with no exit event needs Render's event/metrics view to identify a forced termination or resource limit. Never paste bot tokens or MongoDB credentials into logs or issues.

GitHub's **Bot checks** workflow runs syntax validation and the complete test suite on Node 22 for pushes and pull requests. The separate readiness workflow remains a diagnostic check, not a replacement for always-on hosting.
