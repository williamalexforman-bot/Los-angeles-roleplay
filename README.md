# California State Roleplay Management Bot

A Discord.js v14 management bot for California State Roleplay, with professional ticketing, staff workflows, message safety alerts, command auditing, Bloxlink verification, ER:LC v2 monitoring, and optional automated ticket assistance.

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

- `/ticket-panel` — posts or refreshes the four-category Help & Support dropdown.
- `/ticket refresh-user` — refreshes Bloxlink and Roblox data in a ticket.
- `/movie-feedback` — publishes the branded Movie / When / Where layout with a 1–10 star display, submitter footer, timestamp, and CSRP logo.
- `/say` — lets a server administrator or the configured bot-permissions role send an exact plain-text message as the bot in the current or selected text channel; mentions are displayed without notifying users or roles.
- Ticket channels place persistent controls first, then the creator/support-team welcome message. Close-with-reason notices ping the ticket creator, show the full reason, and archive a transcript before locking the ticket.
- `/staff-feedback` — structured public staff feedback with private identity auditing for anonymous submissions.
- `/partnership request` — posts the branded partnership rules panel; the button opens a server-name, representative, invite-link, and server-ad modal. Completed requests go to the configured partnership review channel with staff-only Approve/Deny controls.
- `/staff-complaint` — submits a structured 1–5 star complaint about a staff member to the configured private complaint channel.
- `/training-results` — publishes scored Pass/Fail training results.
- `/promotion issue` — uses a Discord server-role selector, publishes a professional promotion notice, and pings the promoted member without pinging the selected role.
- `/infraction issue` — pings the infracted member, posts the complete case embed and controls in the infraction channel, and attaches a public evidence thread directly beneath that message without automatically adding the command user.
- `/prohibited-word add|remove|list` — administrator management of the whole-word filter.

Legacy ticket commands remain registered as compatibility aliases. Existing application, training-request, moderation, admin, partnership, complaint, and game commands are retained.

## Optional integrations

- **Bloxlink:** set `BLOXLINK_API_KEY`. A missing or unverified account never blocks ticket creation.
- **OpenAI:** set `OPENAI_API_KEY`; `OPENAI_MODEL` defaults to `gpt-5.6-sol`. The assistant uses the Responses API with `store: false`, strict non-staff guardrails, and official-domain web search for ER:LC questions. Paid-partner and rules-channel routing remains available without an OpenAI key.
- **Partnership role:** set `PARTNERSHIP_ROLE_ID` so approving a partnership automatically assigns the role. The request and complaint destinations default to `1527122924975165530` and `1527139806797369504` and can be overridden with `PARTNERSHIP_REQUEST_CHANNEL_ID` and `STAFF_COMPLAINT_CHANNEL_ID`.
- **ER:LC:** set `ERLC_SERVER_KEY`. The monitor uses `GET https://api.erlc.gg/v2/server` with Players, CommandLogs, and JoinLogs enabled, honors rate-limit reset/retry data, and persists processed state in MongoDB.
- **Official ER:LC webhooks:** point the configured event webhook to the public HTTPS route `/erlc-event`. Signed Ed25519 payloads are verified before processing. `/roblox-event` remains available only when `WEBHOOK_SECRET` is configured for backward compatibility.
- **Ticket recovery:** abandoned pending reservations are cleaned after 15 minutes by default; override this with `TICKET_PENDING_TTL_MS`.

## Validation

- `npm run build` — strict TypeScript check.
- `npm test` — offline integration coverage for the panel, all four ticket channel/permission workflows, controls-first ordering, close-notice/transcript archival, complete modal answers, duplicate and stale-reservation handling, atomic claim/AI state, profanity/raid payloads and dedupe, slash-command auditing/redaction, movie feedback, Pass/Fail training output, public infraction evidence threads/controls, Bloxlink fallback, deterministic support routing, OpenAI serialization, and ER:LC command/team/punishment comparisons.
- `npm run check` — runs both.

Live Discord channel/thread creation and external API calls should be exercised in the configured test guild before production rollout.
