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
- `/partnership request` — posts the branded partnership rules panel; the button opens a server-name, representative, invite-link, and server-ad modal. Completed requests go to the configured partnership review channel with staff-only Approve/Deny controls.
- `/staff-complaint` — submits a structured 1–5 star complaint about a staff member to the configured private complaint channel.
- `/training-results` — publishes scored Pass/Fail training results.
- `/promotion issue` — uses a Discord server-role selector, publishes a professional promotion notice, and pings the promoted member without pinging the selected role.
- `/infraction issue` — pings the infracted member, posts the complete case embed and controls in the infraction channel, and attaches a public evidence thread directly beneath that message without automatically adding the command user.
- `/prohibited-word add|remove|list` — administrator management of the whole-word filter.

## Optional integrations

- **Partnership role:** set `PARTNERSHIP_ROLE_ID` so approving a partnership automatically assigns the role. The request and complaint destinations default to `1527122924975165530` and `1527139806797369504` and can be overridden with `PARTNERSHIP_REQUEST_CHANNEL_ID` and `STAFF_COMPLAINT_CHANNEL_ID`.
- **ER:LC:** set `ERLC_SERVER_KEY`. The monitor uses `GET https://api.erlc.gg/v2/server` with Players, CommandLogs, and JoinLogs enabled, honors rate-limit reset/retry data, and persists processed state in MongoDB.
- **Official ER:LC webhooks:** point the configured event webhook to the public HTTPS route `/erlc-event`. Signed Ed25519 payloads are verified before processing.

## Validation

- `npm run build` — strict TypeScript check.
- `npm test` — offline integration coverage for staff tools, moderation, profanity/raid payloads and dedupe, slash-command auditing/redaction, movie feedback, Pass/Fail training output, public infraction evidence threads/controls, and ER:LC command/team/punishment comparisons.
- `npm run check` — runs both.

Live Discord channel/thread creation and external API calls should be exercised in the configured test guild before production rollout.
