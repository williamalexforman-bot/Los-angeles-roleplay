# Valenti Crime Family

No-banner Discord Components V2 panels, tickets, promotions and disciplinary records.

## Deployment

Node 22.22.0; build `npm install`; start `node index.js`. Set BOT_TOKEN (lowercase bot_token is also accepted; BOT_TOKEN takes priority) and either MONGODB_URI or the existing MONGODB_USERNAME, MONGODB_PASSWORD and MONGODB_HOST variables. MONGODB_DATABASE defaults to discordbot. New collections use the fresh_ prefix and do not modify old bot collections.

Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal for complete ticket transcripts. The bot needs Manage Roles, Manage Channels, View Channels, Send Messages, Read Message History and Attach Files. Place its role above all roles it must manage. Discord-managed roles and @everyone cannot be removed. Durable storage is required before tickets or disciplinary actions can run. If the database is unavailable at startup, fix the environment and restart. The HTTP endpoint reports database and Discord status separately from process health.

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

Role 1538395177448644709 can use `-say your message` or `/say message:your message` to post as the bot in the current channel. Message Content Intent must be enabled for prefix commands. Say messages do not ping mentions.

`-deployment` and `/deployment` post a bannerless V2 announcement in 1538399056986906715, pinging only role 1538395272986755173, with this exact message:

Hello Valenti, we have an active deployment going on so make sure to join game and start shift and get playing!

Make that role mentionable or grant the bot Mention Everyone in the deployment channel. These commands require the same management role as say.

Successful prefix commands delete the invoking message after posting. Give the bot Manage Messages in command channels. Failed commands retain the original message; deletion failures report separately without repeating the action.

Role 1538393098185613352 additionally grants infraction access. Ticket closing posts <:closing_ticket:1549440281638600854> Closing Ticket in a bannerless V2 container and waits 10 seconds after the transcript is saved. Background job errors are caught and scheduled jobs retry at their normal intervals.
