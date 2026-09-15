# California State Roleplay

No-banner Discord Components V2 panels, tickets, promotions and disciplinary records.

## Deployment

Node 22.22.0; build `npm install`; start `node index.js`. Set BOT_TOKEN and either MONGODB_URI or the existing MONGODB_USERNAME, MONGODB_PASSWORD and MONGODB_HOST variables. MONGODB_DATABASE defaults to discordbot. New collections use the fresh_ prefix and do not modify old bot collections.

Enable **Message Content Intent** in the Discord Developer Portal for complete ticket transcripts. The bot needs Manage Roles, Manage Channels, View Channels, Send Messages, Read Message History and Attach Files. Place its role above all roles it must manage. Discord-managed roles and @everyone cannot be removed. Durable storage is required before tickets or disciplinary actions can run. If the database is unavailable at startup, fix the environment and restart. The HTTP endpoint reports database and Discord status separately from process health.

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

`/config view` shows saved destinations. `/config channel` changes one. `/config panel` posts an interactive panel. Infraction and promotion panels default to their configured channels; ticket panels default to the command channel (tickets themselves always use the configured category). `/config ticket-access` assigns a department support role for new tickets. Until configured, tickets are visible only to the requester, bot and server administrators.

## Actions

All configuration and disciplinary workflows require Administrator, enforced again on submission. Panel buttons let staff select a member and then a type or rank. `/infraction` and `/promotion` also open the forms directly. Promotions remove the selected previous rank and give the selected new rank after checking role hierarchy and existing membership.

Infraction options: Warning, Strike, Suspension, Demotion, Termination, Under Investigation, Blacklisted. Every action requires a reason. The last four options record the disciplinary status; no automatic role or ban behavior is guessed for them.

Warning 1: 1538589408016470077. Warning 2: 1538589426656219177. Warning 3 resets the warning cycle and adds one strike. Strike 1: 1538589320976535763. Strike 2: 1538589385413632031. Only the current warning and strike tier markers are applied, replacing the previous tier.

Strike 3 (including warning escalation) or a direct suspension requires a future end time in `YYYY-MM-DD HH:mm` UTC. Submission is rejected before any action if the date is missing. The form shows this requirement based on the stored count, and submission checks it again.

Suspensions save removable roles before changing them, retain/grant 1538401039684866143, and grant suspended role 1538589270795882516. Other removable roles are removed. At expiry, saved roles are restored and the suspended role removed; infraction counts and history remain. Only Discord-removable roles can be changed. Missing roles or hierarchy changes keep restoration pending for retry. The bot must be running to restore roles; after downtime it processes overdue suspensions at startup and then every 30 seconds. Staff cannot issue a new role-changing action during an active suspension. Uncompleted role operations are saved and retried; do not reissue a case after a retry notice.

Tickets require a reason before creation; Internal Affairs also requests the reported person and evidence. Closing requires confirmation and uploads all message text, embeds, V2 components and attachment URLs as text transcripts before deleting the channel. Files linked in transcripts are not separately archived. Transcript upload failure leaves the channel intact. One open ticket per requester is enforced with a database lock.

Saved original and utility bot backup branches are unchanged. Staff shift commands and panels are included.


## Staff shifts

`/shift start`, `/shift end`, and `/shift status` manage your own shift. An administrator configures eligible staff with `/config shift-role role:@Staff`. Administrators can also start shifts. Suspended members cannot start a new shift. Members can always end their own active shift even if their staff role was removed.

`/config panel panel:shift channel:#staff` posts the no-banner V2 controls. The active-shifts board is created automatically in 1538399713378832426 and refreshed after changes and every 30 seconds. Larger teams use multiple V2 messages. Start/end notices go to 1538399655438581810; failed deliveries retry from MongoDB. An interrupted delivery can occasionally produce a duplicate notice with the same shift ID.

One active shift per member is enforced. MongoDB retains start/end timestamps and completed durations across restarts. Time continues until the member ends the shift; restarting the bot does not reset or automatically end it. There are no automatic ER:LC permissions or game actions attached to shifts.
