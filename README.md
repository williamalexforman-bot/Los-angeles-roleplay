# Valenti Crime Family

No-banner Discord Components V2 panels, tickets, promotions and disciplinary records.

## Deployment

The default Discord server ID is `1538371050759520306`. An explicit `GUILD_ID` environment value overrides it. If Render already has a different `GUILD_ID`, update it to `1538371050759520306`; the startup default only applies when that variable is missing or blank.

For Render, use build command `npm ci`, start command `npm start`, Node 22, and set the HTTP health check path to `/readyz` in the service settings. Keep the token in the secret environment variable `BOT_TOKEN` (no `Bot ` prefix). `/readyz` returns 503 until Discord is ready; `/` remains a process-status endpoint. A watchdog exits after two continuous minutes without Discord readiness so the host can restart a stuck connection, while ordinary brief disconnects are left to Discord.js to recover. Login retries continue every 30 seconds during that window. Logs identify rejected authentication (4004) and disabled privileged intents (4014). This cannot recover an invalid token or a suspended/sleeping Render instance: those require correcting the settings. Use an always-on Render instance for continuous operation. Changes to this checkout must be deployed before they affect Render.

Node 22.22.0; build `npm install`; start `node index.js`. Set BOT_TOKEN (lowercase bot_token is also accepted; BOT_TOKEN takes priority) and either MONGODB_URI or the existing MONGODB_USERNAME, MONGODB_PASSWORD and MONGODB_HOST variables. MONGODB_DATABASE defaults to discordbot. New collections use the fresh_ prefix and do not modify old bot collections.

Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal for complete ticket transcripts. The bot needs Manage Roles, Manage Channels, View Channels, Send Messages, Read Message History and Attach Files. Place its role above all roles it must manage. Discord-managed roles and @everyone cannot be removed. Durable storage is required before tickets or disciplinary actions can run. If the database is unavailable at startup, the bot retries connection every 30 seconds and starts background jobs when connected. The HTTP endpoint reports database and Discord status separately from process health.

## Destinations

| Purpose | ID |
| --- | --- |
| Open-ticket category | 1538594178467110942 |
| Infractions | 1538399223307829280 |
| Promotions | 1538399164780511332 |
| Deployment notices | 1538399056986906715 |
| Shift logs | 1538399655438581810 |
| Active shifts | 1538399713378832426 |
| Ticket transcripts | 1538594354137141260 |

`/config view` shows saved destinations. `/config channel` changes one. `/config panel` posts a Ticket or Shift launcher. Infractions and promotions have no launcher panels; `/infraction issue` and `/promotion issue` post their completed notices to the configured channels. `/config ticket-access` assigns a department support role for new tickets. Role 1538395250312093768 always has access to every ticket. The bot refreshes that access on recorded open tickets at startup and every five minutes. Department support roles add access rather than replacing the shared role.

## Actions

`/cmds` privately lists every slash command and subcommand, its arguments and description, plus all prefix commands. Any member can view it; each command retains its existing access restrictions.

Managers use `-verificationpanel` to post the **Roblox Verification** panel in `1538390763476357130`. Repeating the command reuses the existing panel or replaces it if deleted. The panel is not posted automatically on startup. Members press Verify, submit their Roblox username, and receive a private confirmation after their server nickname is set to the canonical Roblox username. The bot needs Manage Nicknames and a role above the member, plus View Channel, Read Message History, Send Messages and Embed Links in the panel channel. Discord prevents renaming the server owner. This checks account existence, not account ownership; it does not grant roles or change a member's global Discord username. Nicknames sync on submission, not continuously.

`/mostwanted roblox:Username reason:Reason` posts a Components V2 notice in channel `1549901960142913616`, including the resolved Roblox username, profile link, user ID and full-body avatar. Only the Roblox username and reason are required. The existing manager role is required. Mentions do not notify anyone. The bot needs View Channel, Send Messages and Embed Links in the destination. Roblox lookup failures are reported privately without posting an incomplete notice. No Roblox API key is required.

Configuration requires Administrator. Promotion requires role 1538395177448644709. Infractions and suspension ending require either 1538395250312093768 or 1538395177448644709. Role checks fetch fresh membership and are enforced again on submission. Slash-command visibility does not require Administrator for these actions. `/infraction issue` collects member, action, reason, notes, appealability, optional evidence, optional DM notification and optional suspension end. `/promotion issue` collects member, old rank, new role, reason, approved-by and effective-date. The effective date is a display field; roles change immediately. Promotions remove the selected previous rank and give the selected new rank after checking role hierarchy and existing membership.

Infraction options: Warning, Strike, Suspension, Demotion, Termination, Under Investigation, Blacklisted. Every action requires a reason. The last four options record the disciplinary status; no automatic role or ban behavior is guessed for them.

Warning 1: 1538589408016470077. Warning 2: 1538589426656219177. Warning 3 resets the warning cycle and adds one strike. Strike 1: 1538589320976535763. Strike 2: 1538589385413632031. Only the current warning and strike tier markers are applied, replacing the previous tier.

Strike 3 (including warning escalation) or a direct suspension accepts an optional future end time in `YYYY-MM-DD HH:mm` UTC. Omit it for an indefinite suspension; `/suspension end member:@Member` schedules restoration. Use the suspension-end option; submission validates it against the current saved count before changing roles.

Suspensions save removable roles before changing them, retain/grant 1538401039684866143, and grant suspended role 1538589270795882516. Other removable roles are removed. At expiry, saved roles are restored and the suspended role removed; infraction counts and history remain. Only Discord-removable roles can be changed. Missing roles or hierarchy changes keep restoration pending for retry. The bot must be running to restore roles; after downtime it processes overdue suspensions at startup and then every 30 seconds. Staff cannot issue a new role-changing action during an active suspension. Uncompleted role operations are saved and retried; do not reissue a case after a retry notice.

Tickets require a reason before creation; Internal Affairs also requests the reported person and evidence. Closing requires confirmation and uploads all message text, embeds, V2 components and attachment URLs as text transcripts before deleting the channel. Files linked in transcripts are not separately archived. Transcript upload failure leaves the channel intact. One open ticket per requester is enforced with a database lock.

Saved original and utility bot backup branches are unchanged. Staff shift commands and panels are included.


## Staff shifts

`/shift start`, `/shift end`, and `/shift status` manage your own shift. Every human member can start shifts for the server-wide quota; the legacy shift-role setting no longer restricts eligibility. Suspended members cannot start a new shift. Members can always end their own active shift even if their staff role was removed.

`/config panel panel:shift channel:#staff` posts the no-banner V2 controls. The active-shifts board is created automatically in 1538399713378832426 and refreshed after changes and every 30 seconds. Larger teams use multiple V2 messages. Start/end notices go to 1538399655438581810; failed deliveries retry from MongoDB. An interrupted delivery can occasionally produce a duplicate notice with the same shift ID.

One active shift per member is enforced. MongoDB retains start/end timestamps and completed durations across restarts. Time continues until the member ends the shift; restarting the bot does not reset or automatically end it. There are no automatic ER:LC permissions or game actions attached to shifts.


## Restored presentation

The original backup branch was inspected for its Staff Promotion, Staff Infraction and ticket presentation. These notices now use the same headings and field layout, adapted to Valenti Crime Family and excluding banners and underbanners. Infraction posts attempt to create a case thread and notify the member by DM; promotions also notify by DM. If thread permissions are unavailable the case remains posted in the configured channel. Give the bot Create Public Threads and Send Messages in Threads to enable threads.

Appeal buttons open an Internal Affairs request for staff review; they do not automatically reverse roles or counts. Claim and Escalate controls are available to ticket staff. Escalation marks the ticket High Rank and adds the configured High Rank support role, if one is set.

Owner/self targets are no longer rejected just for their identity. The configured action roles authorize callers regardless of their personal role position. The bot can only change roles below its own role. No Discord permission restrictions are bypassed.


## Weekly quota

Every human member must complete 30 minutes of ended shifts per quota period. Bots are excluded. Only saved shifts ended by the deadline count; open shifts must be ended first. Time is clipped to the current period so previous-week time is not counted twice. `/quota status` shows saved progress. Start/End buttons appear in the configured active-shifts channel.

Quota is enabled by default, starting at the first successful startup of this version. The first period may be a partial week. Reports are due Friday at 10 AM America/New_York (daylight-saving aware); `/quota timezone zone:...` changes the IANA timezone and starts a new period. `/quota disable` pauses reports while shift tracking continues; `/quota enable` begins a fresh period, with no catch-up for disabled weeks. These management actions require role 1538395177448644709.

At the deadline a V2 quota infraction list posts in the configured infractions channel, with the complete list as a text attachment and a preview in the message. It does not automatically issue punishments or change disciplinary counts. Reports and deadlines persist in MongoDB. Delivery retries after outages, with the saved list preserved. The scheduler checks every 30 seconds, so on-time delivery can be up to 30 seconds after 10 AM. A stopped or sleeping Render service cannot deliver on time; it catches up when running again. Current members who joined by the deadline are included, even if they never started a shift; departed members are not fetched in an overdue roster.


## Message commands

Role 1538395177448644709 can use `-say your message` or `/say message:your message` to post as the bot in the current channel. Message Content Intent must be enabled for prefix commands. Say messages allow user and role mentions; @everyone and @here remain suppressed.

`-deployment` and `/deployment` post a bannerless V2 announcement in 1538399056986906715, pinging only role 1538395272986755173, with this exact message:

Hello Valenti, we have an active deployment going on so make sure to join game and start shift and get playing!

Make that role mentionable or grant the bot Mention Everyone in the deployment channel. These commands require the same management role as say.

Successful prefix commands delete the invoking message after posting. Give the bot Manage Messages in command channels. Failed commands retain the original message; deletion failures report separately without repeating the action.

Role 1538393098185613352 additionally grants infraction access. Ticket closing posts <:closing_ticket:1549440281638600854> Closing Ticket as plain text and waits 10 seconds after the transcript is saved. Background job errors are caught and scheduled jobs retry at their normal intervals.

Welcome messages use custom emoji 1549441219774382080 and the exact Valenti greeting, with a mention of the joining member. They post in the system channel by default. Set `/config channel destination:welcome channel:#welcome` to override. Requires Server Members Intent, working MongoDB configuration lookup, and channel send permissions. Joins missed while the bot is offline are not replayed. Render Free may sleep or restart; code does not guarantee continuous hosting.

## Ticket and cleanup commands

`-close` / `/close` save the transcript, send a plain-text custom-emoji Closing Ticket notice, wait 10 seconds, then delete the ticket. Existing requester/support/admin ticket access applies. `-closerequest reason` / `/closerequest reason:...` ask the opener to accept or keep the ticket open. Only the opener can answer.

`-purge 10` / `/purge amount:10` remove 1–100 recent messages (excluding the prefix invocation), skipping those older than 14 days. `-ticketpanel` / `/ticketpanel` post the V2 ticket panel. Purge and ticketpanel require management role 1538395177448644709; purge additionally requires bot Manage Messages and Read Message History. Successful prefix invocations are removed. Infraction, promotion and deployment notices remain bannerless Components V2.

## Valenti applications

Use `/applicationpanel`, `-applicationpanel`, or `/config panel panel:application` to post the bannerless V2 panel. Direct posting requires management role 1538395177448644709; config posting requires Administrator. The dropdown starts a saved eight-question DM application. Text answers accept up to 500 characters; familiarity/activity require 1–10. Questions 7 and 8 use Yes/No menus. A final Submit Application button sends the completed application to staff. Applicants can type `cancel` or select the server panel again to resume; blocked DMs retain saved progress. DirectMessages intent and Channel partials are enabled in code.

Review notices post to 1538603960909168680 as V2 containers, split into pages only when necessary to fit Discord's text limit. Accept/Reject buttons on the final page require role 1538395177448644709. Accept grants 1538395272986755173 and 1539392349061255250. The bot must have Manage Roles and sit above both roles. The decision is saved before applying roles; failures retry automatically without changing the decision. Rejection does not grant roles. Applicants receive a decision DM when available. The acceptance message requires a ride along; this update does not implement a ride-along completion tracker.

AI suggestions require `OPENAI_API_KEY` and `APPLICATION_AI_MODEL` in Render. The selected model must support the OpenAI Responses API. Applicant answers 2–8 are sent for advisory review with `store:false`; Roblox username/ID from answer 1 and Discord identifiers are not sent. API usage may be billed by the provider. Without configuration, or if the AI service fails, the application still posts and explicitly says AI advice is unavailable. Staff always decide; the bot does not claim to detect AI writing or automatically blacklist applicants. Configure AI before submitting applications; already-posted unavailable suggestions are not regenerated automatically.

Application delivery, role retries, and result messages are processed on startup and every 30 seconds while the bot runs. Saved progress and review state survive restarts. A closed-DM delivery error is handled without stopping the bot.

Ticket Claim and Close buttons use the requested custom emoji IDs. Closing remains plain text with the animated `<a:closing_ticket:1549440281638600854>` format, or the actual emoji metadata if cached. The bot needs access to the emoji and Use External Emojis when it is from another server; formatting cannot grant access to an unavailable emoji.

Operation locks now wait briefly for contention and atomically reclaim expired entries, independent of MongoDB TTL deletion. Active locks are not forcibly removed. New leases renew while work runs and expire after two minutes without renewal; older deployment leases can retain their original expiry. Saved infraction/promotion notices from this bot are updated in place to bannerless V2 in batches of 50 on startup and every five minutes; this clears legacy embed fields without issuing new disciplinary actions or DMs. Deleted notices are not reposted by this migration.

Missing ticket opening panels now have a separate recovery job every 15 seconds, independent of category/support permission updates. Fresh channels send their opening panel immediately without first reading channel history. Temporary send failures retry with a stable nonce; rejected custom button emojis fall back to text buttons while preserving the V2 panel and controls. Persistent failures retain `panelPending` and a diagnostic error code for retry. Recovery still requires the bot to be online with channel access and a working database.

## Render environment names

Use `BOT_TOKEN` for the Discord token and `GUILD_ID` for the numeric Discord server ID. Commands register specifically in `GUILD_ID` when set; the bot must belong to that server. `MONGODB_HOST`, `MONGODB_USERNAME`, and `MONGODB_PASSWORD` build the MongoDB SRV connection automatically; no separate `MONGODB_URI` is required. `MONGODB_HOST` should be the cluster hostname only, without a URL scheme or credentials. Username and password are URL-encoded in code. An explicitly set `MONGODB_URI` remains an optional override; `MONGODB_DATABASE` defaults to `discordbot`. Never paste tokens or passwords into source files.

New infraction/promotion notices mention the affected member. New ticket opening panels mention the opener and the shared support role. Edits and automatic layout refreshes suppress mentions to avoid repeated notifications. Welcome messages, close requests and deployments retain their explicit member/role pings. Role pings remain subject to Discord permissions and role mentionability.

## Server logs

| Log | Destination |
| --- | --- |
| Messages | 1549588089096245258 |
| Infractions | 1549589454568558735 |
| Promotions | 1549589488928424076 |
| Ticket claims | 1549589552451031101 |
| Roles | 1549589572961173594 |
| Raid warnings | 1549589600102518864 |
| Bans/kicks | 1549589628758007868 |
| Joins/leaves | 1549589652879704105 |
| Applications | 1549590420244402206 |

Logs are bannerless V2 messages with mentions suppressed. Staff notices still post in their original channels; the log channels receive additional action records. Message logs cover human messages edited, deleted and bulk-deleted, with links/IDs and bounded content previews. New messages are not logged, and queued legacy Message Sent entries are suppressed. Bot/webhook messages, DMs, and the log channels themselves are excluded. Deleted or pre-edit text that was not cached is shown as unavailable; the logger cannot reconstruct unseen messages. Attached files are represented by links when available, not copied.

Role logs cover member-role additions/removals and role creation, deletion, permission and basic setting changes. Member departures are logged without guessing a kick/ban cause. Kick logs use actual Discord audit entries and require View Audit Log; ban/unban events use GuildModeration intent. Member and message events require Server Members and Message Content intents. The bot needs View Channel and Send Messages in every log channel. When GUILD_ID is set, gateway logs are limited to that server.

Raid warnings flag 10 distinct human joins in 60 seconds (five-minute alert cooldown), or basic raid-threat phrases in new/edited messages. These are staff-review alerts, not proof of a raid, and never issue automatic punishments. Join counters are in memory and reset on restart. Application logs cover started, submitted, accepted, rejected and cancelled events; complete answers remain in the designated application review channel.

Logs use the `fresh_event_logs` MongoDB outbox. Delivery runs every five seconds, retries failures with backoff, and uses stable IDs/nonces to reduce duplicates. Delivered outbox records expire after seven days; Discord log messages remain. A 500-event in-memory startup/outage buffer bridges short database outages but cannot survive process loss; events the bot never receives while offline cannot be recovered. Rare delivery duplicates remain possible if the process stops after a Discord send and before saving success.

Role 1538395272986755173 now authorizes both promotions and infractions. Authorized staff can issue an infraction against the server owner; Discord still controls whether the bot can change any target roles. `-spamcool message amount` is limited to accounts 1066264414359138304 and 1262469782897295461, sends only to those two accounts’ DMs, allows 1–50 messages at two-second intervals, has a ten-minute cooldown, and supports `-spamcool stop`. It is a DM test and does not keep a sleeping Render service awake.

Render diagnosis: the service reached `Your service is live`; the displayed failure is command registration because `GUILD_ID` is inaccessible, not a bot-token failure. Set `GUILD_ID` to the server ID where this bot is installed. The startup error now lists the IDs visible to the bot. Ticket and shift background sync skip other cached guilds when GUILD_ID is set, preventing stale `GuildChannelUnowned` noise. Promotion errors now log their full stack for diagnosis.

### Valenti banners and member count
The five supplied images are tracked in `assets/banners/`. V2 notices use the shared footer; infractions, promotions, support tickets and deployment messages also use their matching upper banner. The image URLs use this public GitHub repository, so keep it public for Discord to load them. Existing saved case notices migrate automatically; repost the ticket launcher with `/ticketpanel` to update that existing panel. Welcome and ticket-closing messages remain plain text.

The bot reads `BOT_TOKEN` first and displays `Watching over N server members` for `GUILD_ID`, updating on joins, leaves and reconnects. Initial login failures retry every 30 seconds. Discord.js handles normal gateway reconnects. The HTTP response includes the deployed commit, uptime, and connection readiness to help diagnose outages.

A Render Free web service can sleep after 15 minutes without inbound traffic and can restart at any time. An environment token does not prevent that. Use an always-on instance for continuous bot availability; these code changes cannot prevent host shutdowns. No self-ping or message-spam keepalive is used.

### Install server emojis
Administrators can use `/add-emojis`, `-addemojis`, `-add-emojis`, or `-add emojis` to install 80 original cream Valenti emojis with transparent backgrounds: infraction, promotion, ticket, support, deployment, shift, application, approved, denied, warning, strike, suspension, claim, close, logs and welcome. The bot needs Create Expressions. Existing names are skipped and nothing is deleted. Uploads run sequentially under Discord's rate limits; if slots run out or an upload fails, fix the reported issue and rerun to resume. Search `:valenti_` in the emoji picker afterward. This installs server emojis; existing panel emoji IDs are unchanged. The bundled PNG pack requires no downloads or extra runtime dependencies. `scripts/build-emojis.py` regenerates it with Pillow.

The expanded pack includes navigation arrows, locks, search, status icons, announcement/mail/calendar symbols, role badges, warning and strike tiers, appeals, evidence, transcripts, duty status, quota, LOA, events and meetings. The first 16 names stay unchanged. Run the installer again after deployment to add the other 64, subject to available server emoji slots.

Administrators can run `-delete emojis` (also `-deleteemojis` or `-delete-emojis`) to remove emojis with a known pack name and a creator matching this bot. Other, managed, renamed, or unverified emojis are kept. Requires the bot to have Create Expressions or Manage Expressions. Add and delete operations cannot overlap in a server. Rerun after a partial failure to continue.

The emoji pack now has no background tiles. To replace the previously installed set, run `-delete emojis` and wait for completion, then run `-add emojis`. Existing name matches are skipped by the installer, so adding alone does not replace old images.
