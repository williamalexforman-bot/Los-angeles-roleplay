# Pierce County Sheriff Office bot

Discord Components V2 tickets, disciplinary notices, promotions, deployments, shifts and configurable event logs. Prefix: `-`. Target guild: `1521905971004444743`. Applications, most-wanted and spam-DM functionality are removed.

## Hosting and restore

Render build: `npm install`; start: `node index.js`; Node 22.22.0. Set `BOT_TOKEN` and either `MONGODB_URI` or `MONGODB_HOST`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`. `MONGODB_DATABASE` is optional. Never commit tokens. This deployment explicitly targets the PCSO guild from `src/settings.js`; update Render's `GUILD_ID` to the same ID for consistency.

Enable Server Members and Message Content intents. The bot must belong to PCSO and its role must be above roles it manages. Channel overwrites must allow the necessary sends, embeds, attachments and ticket management.

The previous code is saved in `backup/valenti-before-pcso-2026-09-18`. PCSO uses `pcso_` MongoDB collections; existing `fresh_` records remain untouched and are not replayed into the new server. This starts PCSO counts, shifts and settings separately. The database credentials stay in Render.

`/` reports process health; `/readyz` reports Discord readiness. Heartbeat, disconnect and host-shutdown logs remain enabled. Hosting suspension or restarts cannot be prevented by a bot token or service ID.

## Initial destinations

| Destination | ID |
| --- | --- |
| Welcome | 1521905971885248734 |
| Deployment | 1549277165617549382 |
| Infractions | 1521905972430241913 |
| Promotions | 1521905972128256240 |
| General Support tickets | 1521905971717210155 |
| OPS Reports tickets | 1521905971717210157 |
| Administrative tickets | 1521905971717210158 |

Use `/config view` and `/config channel` to adjust destinations. Ticket destinations accept a category or a text channel: for text channels, private ticket channels are created under their parent category (or at the server root if no parent exists), with explicit private overwrites. Report details are never posted into the destination text channel itself.

Configure `transcripts` before closing tickets. Configure `shiftLogs` and `activeShifts` before starting shifts. Scheduled quota reports wait until both shift channels are configured. Extra `log_*` destinations and verification are unset until configured, so no old server channels are used.

## Access and tickets

Administrators and the server owner can use staff commands. `/config staff-role` grants `management`, `infraction` or `promotion` access. Management grants access to staff commands; the other purposes grant only the named action. `deployment_ping` sets the role mentioned by deployments; without it deployments send without a role ping.

Set each department's staff role with `/config ticket-access`. New tickets grant the selected department role access, falling back to the configured management role. If neither exists, only the opener, bot and server administrators can view them. Existing tickets retain their saved support role. Administrative escalation requires its configured support role or management role and bot permission to edit channel overwrites.

Post `/ticketpanel` or `-ticketpanel`. Ticket opening requires a reason. Claim, Close and Escalate controls remain. Opening panels retry failed delivery. Closing saves the transcript before posting a plain-text closing notice and waiting 10 seconds to delete. `/close`, `/closerequest reason:...`, `/purge amount:...` also support their prefix versions. Successful prefix invocation messages are deleted when permissions allow.

## Disciplinary roles

| Marker | ID |
| --- | --- |
| Warning 1 | 1544509652891475998 |
| Warning 2 | 1544509655949246604 |
| Strike 1 | 1543551522716262450 |
| Strike 2 | 1543551599228751902 |
| Termination | 1544509652891475998 |
| Blacklisted | 1540811483955335358 |
| Suspended | 1544510578913968148 |
| Under Investigation | 1544815910802427944 |

Warning 1 and Termination deliberately use the same supplied ID; supply a distinct ID if those must be different roles. Warning 3 converts to a strike; strike 3 suspends. Suspension saves removable roles, removes them and adds the suspension marker. No retained role was supplied for PCSO. An optional expiry or `/suspension end` restores saved roles. Missing roles/hierarchy permissions leave recovery pending. Termination, Blacklisted and Under Investigation add their respective marker roles; they do not ban or kick members. Demotion is recorded; rank changes use the promotion command's selected old/new roles.

Reasons are slash-command options. Promotions apply immediately; the effective date is displayed only. Infraction and promotion notices are V2 with the supplied new upper banners and shared underbanner. Optional member DMs remain ordinary one-notice notifications.

## Branding and emojis

The three supplied images are in `assets/banners/pcso`: infraction, promotion and footer. Assistance and deployment upper banners are omitted until PCSO versions are supplied. All V2 containers retain the PCSO underbanner. Welcomes and closing notices remain normal text.

At startup the bot reads PCSO's emoji cache and matches semantic names such as `infraction`, `promotions`, `support`, `ops`, `administrative`, `wave`, `claim`, `close`, and their `pcso_` equivalents. Restricted/unavailable emojis fall back to standard symbols. Newly created/deleted emoji cache entries are used on subsequent messages. No live emoji names are hard-coded from another server.

The optional administrator emoji tools install up to five missing `pcso_` pack emojis per invocation. They stop at server capacity and respect Discord rate limits. `-continue emojis`, `-force stop emojis`, `-stop deleting`, `-delete emojis` and `-force delete` remain. Deletion is limited to matching pack emojis verified as created by this bot; existing server artwork is not deleted automatically.

## Validation

Run `npm test`. Tests exercise role permissions, private ticket creation and delivery recovery, V2 payloads, migration settings, emoji matching/cancellation, case role changes, logging, shifts, quota and connection recovery without using a real bot token. Real guild permissions and Render deployment require a live smoke test after deployment.
