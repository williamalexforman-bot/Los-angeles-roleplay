# California State Roleplay Management Bot

A Discord.js v14 management bot for California State Roleplay, with staff workflows, message safety alerts, command auditing, ER:LC v2 monitoring, and utility commands.

## Server security guard

The bot protects the server from unauthorized bot additions, webhook creation or edits, and integration creation or edits. It uses Discord audit-log events for attribution and gateway events plus startup snapshots as a fallback. Existing webhooks and integrations are preserved when the bot starts; newly detected resources fail closed when no trusted executor can be verified.

High-confidence targeted bullying is also removed automatically and the author is timed out for 10 minutes by default. Set `BULLYING_TIMEOUT_MINUTES` to change the duration. Detection requires direct second-person abuse or an abusive phrase aimed through a Discord mention/reply, reducing false actions on ordinary conversation. Automatic enforcement requires **Message Content Intent**, **Manage Messages**, and **Moderate Members**, with the bot role above the member being timed out.

Only the server owner, this bot, IDs in `SECURITY_TRUSTED_USER_IDS`, and members with a role in `SECURITY_TRUSTED_ROLE_IDS` may authorize new protected resources. Individual resources can also be allowlisted with `SECURITY_ALLOWED_BOT_IDS`, `SECURITY_ALLOWED_WEBHOOK_IDS`, and `SECURITY_ALLOWED_INTEGRATION_IDS`. All lists are comma-separated Discord IDs.

Allowlisting a bot permits that bot to remain in the server but does not automatically trust it to create webhooks or integrations. Add its user ID to `SECURITY_TRUSTED_USER_IDS` only if it genuinely requires those capabilities.

For full enforcement, grant the bot **View Audit Log**, **Ban Members** (or Kick Members when configured), **Manage Webhooks**, and **Manage Server**, and place its role above bots it may need to remove. Security alerts use `SECURITY_LOG_CHANNEL_ID` and optionally ping `SECURITY_ALERT_ROLE_ID`; both fall back to the existing raid-security settings when omitted.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`, set the current Discord token as `BOT_TOKEN`, and configure the remaining credentials. Never commit `.env`.
4. Keep the supplied logo at `assets/csrp-logo.png`.
5. Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal, then set `ENABLE_PRIVILEGED_INTENTS=true`.
6. Run `npm run check`, then `npm start`.

## 24/7 production hosting

To keep the bot online all day and night even when your laptop is closed, run it on a VPS or cloud server instead of your own computer.

### Option A: PM2 (recommended on Linux servers)

1. Install PM2: `npm install -g pm2`
2. Build the bot: `npm run build`
3. Start it: `pm2 start ecosystem.config.js`
4. Save the process list so it restarts after reboot: `pm2 save && pm2 startup`
5. Monitor it with `pm2 logs discord-management-bot`

### Option B: systemd service

1. Copy `deploy/discord-management-bot.service` to `/etc/systemd/system/discord-management-bot.service`.
2. Edit the file and replace the example working directory and user with your server details.
3. Reload systemd and start the service:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable discord-management-bot`
   - `sudo systemctl start discord-management-bot`
4. Check status with `sudo systemctl status discord-management-bot`.

Either option keeps the bot running continuously and automatically restarts it if it crashes.

The bot needs View Channels, Manage Channels, Manage Roles/Permissions where applicable, Send Messages, Embed Links, Attach Files, Read Message History, Create Public Threads, Send Messages in Threads, Manage Threads, and View Audit Log. Its role must sit high enough to create the requested permission overwrites.

## Main commands

- `/rename` — rename a channel (emoji allowed) with Manage Channels permission.
- `/movie-feedback` — publishes the branded Movie / When / Where layout with a 1–10 star display, submitter footer, timestamp, and CSRP logo.
- `/say` — lets a server administrator or the configured bot-permissions role send an exact plain-text message as the bot in the current or selected text channel; mentions are displayed without notifying users or roles.
- `/staff-feedback` — structured public staff feedback with private identity auditing for anonymous submissions.
- `/suggest` and `/suggestions` — publish a persistent V2 suggestion panel; votes and staff decisions recover from the Discord message after a restart.
- `/add-member` and `/remove-member` — grant or deny a member access to the current managed ticket. A member-specific removal also overrides the support-role channel access.
- `/partnership request` — posts the branded partnership rules panel; the button opens a server-name, representative, invite-link, and server-ad modal. Completed requests go to the configured partnership review channel with staff-only Approve/Deny controls.
- `/marketplace-panel` — posts the Marketplace V2 welcome panel with donation and paid-ad dropdowns. The claim button checks the buyer's Melonly-verified Roblox inventory, lets them select one of ten game passes, prevents duplicate claims, and opens a Management ticket.
- `/paid-ad create` — inside the buyer's marketplace ticket, opens the server-name, permanent-invite, and full-ad form and assigns the next durable publishing slot.
- `/paid-ad priority`, `/paid-ad instant`, and `/paid-ad queue` — consume the matching verified add-on, publish immediately, or show the ticket's waiting ads.
- `/staff-complaint` — submits a structured 1–5 star complaint about a staff member to the configured private complaint channel.
- `/training-results` — publishes scored Pass/Fail training results.
- `/promotion issue` — uses a Discord server-role selector, publishes a professional promotion notice, and pings the promoted member without pinging the selected role.
- `/infraction issue` — pings the infracted member, posts the complete case embed and controls in the infraction channel, and attaches a public evidence thread directly beneath that message without automatically adding the command user.
- `/prohibited-word add|remove|list` — administrator management of the whole-word filter.
- `/session-vote` and `/session-start` — record SSU voters and notify them when the session starts.
- `/view loa` — posts the current active LOAs in a Components V2 panel.
- `/view session vote` — privately shows who voted in the latest SSU.
- `/rules` — posts or refreshes the rules-channel Components V2 panel with private Discord Rules, Game Rules, and Ticket TOS views.
- Ticket categories now open a private FAQ/Ticket TOS gate; members must review one option for 10 seconds before the ticket form unlocks.

## Optional integrations

- **Partnership role:** set `PARTNERSHIP_ROLE_ID` so approving a partnership automatically assigns the role. The request and complaint destinations default to `1527122924975165530` and `1527139806797369504` and can be overridden with `PARTNERSHIP_REQUEST_CHANNEL_ID` and `STAFF_COMPLAINT_CHANNEL_ID`.
- **Marketplace verification:** store the Melonly server token in `MELONY_API_KEY` (the `MELONLY_API_TOKEN` and `MELONLY_API_KEY` aliases are also accepted). Do not commit it. The default API base is `https://api.melonly.xyz/api/v1`.
- **Paid-ad queue:** advertisements publish in channel `1538624666313170964` by default; override it with `PAID_AD_OUTPUT_CHANNEL_ID`. `MARKETPLACE_MANAGEMENT_CATEGORY_ID` controls where verified claim tickets open. Standard timing defaults to a one-hour initial delay and 24-hour spacing; override it with `PAID_AD_INITIAL_DELAY_MINUTES` and `PAID_AD_INTERVAL_MINUTES`. The bot needs **Mention @everyone, @here, and All Roles** in the output channel.
- **ER:LC:** set `ERLC_SERVER_KEY`. The monitor uses `GET https://api.erlc.gg/v2/server` with Players, CommandLogs, and JoinLogs enabled, honors rate-limit reset/retry data, and persists processed state in MongoDB. An authorized `/session-end` (SSD) also uses the v2 command endpoint to run `:kick all`; API failures are shown to the staff member so they can run the command manually.
- **Official ER:LC webhooks:** point the configured event webhook to the public HTTPS route `/erlc-event`. Signed Ed25519 payloads are verified before processing.

## Validation

- `npm run build` — strict TypeScript check.
- `npm test` — offline integration coverage for staff tools, moderation, marketplace/Melonly parsing, Roblox ownership checks, paid-ad layouts, profanity/raid payloads and dedupe, slash-command auditing/redaction, movie feedback, Pass/Fail training output, public infraction evidence threads/controls, and ER:LC command/team/punishment comparisons.
- `npm run check` — runs both.

Live Discord channel/thread creation and external API calls should be exercised in the configured test guild before production rollout.
