# United States Marshals Service Discord bot

This version targets server `1536150657440948324`. Only infractions, promotions, tickets, welcomes, deployments and logs remain active. Configuration and command help support those systems. Shifts, quota, arrest reports, applications, most-wanted, spam DMs, verification, say, purge and emoji installation/deletion are not available.

## Hosting and preservation

Render: build `npm install`, start `node index.js`, Node 22.22.0. Set `BOT_TOKEN` and either `MONGODB_URI` or `MONGODB_HOST`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`. `MONGODB_DATABASE` is optional. The code explicitly targets the server in `src/settings.js`; set Render `GUILD_ID` to the same ID. Enable Server Members and Message Content intents in Discord.

Restore point: `backup/before-server-change-2026-09-19`. Previous data remains untouched. This server uses separate `guild_1536150657440948324_` MongoDB collections, so old tickets, counts and role-change retries cannot run against the new server. MongoDB credentials stay in Render. USMS banners are in `assets/banners/usms`. Promotions, infractions, deployments, ticket launchers and opening panels use their matching upper banner; every V2 container has the USMS footer. Welcome and closing messages remain plain text.

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
- `/infraction issue`, `/promotion issue`, `/suspension end`
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
