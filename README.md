# Graphic Design Discord Bot

A configurable Discord bot for design showcases, requests, portfolios, tickets, moderation, and server utilities. The project deliberately contains no banner system or banner assets.

## Requirements

- Node.js 22
- A Discord application and bot token
- A Discord server where you can invite the bot
- A persistent disk when deploying SQLite on Render

## Discord application setup

1. Open the Discord Developer Portal and create an application.
2. Open **Bot**, create the bot, and copy its token into `BOT_TOKEN` on your host.
3. Enable **Server Members Intent** and **Message Content Intent**.
4. Copy the Application ID into `CLIENT_ID`.
5. Enable Developer Mode in Discord and copy your server ID into `GUILD_ID` and your user ID into `BOT_OWNER_ID`.
6. In OAuth2 URL Generator, select `bot` and `applications.commands`.
7. Grant View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages, Manage Channels, Moderate Members, Kick Members, and Ban Members. The bot does not require Administrator.
8. Move the bot role above roles it needs to moderate or assign.

## Local setup

```bash
cp .env.example .env
npm install
npm test
npm start
```

Fill every required value in `.env`. SQLite creates its tables automatically at startup.

## Render deployment

1. Push this project to GitHub.
2. Create a Render Web Service from the repository or use `render.yaml`.
3. Add `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID`, and `BOT_OWNER_ID` as secret environment variables.
4. Attach a persistent disk at `/var/data` and set `SQLITE_PATH=/var/data/bot.sqlite`.
5. Use `npm ci` as the build command and `npm start` as the start command.
6. Set the health check to `/livez`. `/readyz` reports Discord and database readiness.

## First-time configuration

Run `/config`. The bot owner can configure channels, roles, approval behavior, feedback, and commission wording using the private paged dashboard. No source-code edits are needed.

Recommended order:

1. Configure the administrator, staff, designer, and ticket support roles.
2. Configure showcase, review, request, ticket panel, ticket category, transcript, and log channels.
3. Toggle showcase approval, feedback, and commission wording as needed.
4. Run `/ticket panel` to post the support panel.

## Commands

- `/config` — private owner/admin configuration dashboard.
- `/showcase submit|view|mine|feature|remove|restore` — submit and moderate designs.
- `/portfolio create|view|visibility` — create and display designer portfolios.
- `/request create|view|mine|claim|status|close|reopen` — design-request workflow.
- `/ticket panel|claim|unclaim|add|remove|rename|close|reopen|transcript|note` — ticket workflow.
- `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/slowmode` — moderation tools.
- `/history` and `/case view|edit|revoke` — moderation records.
- `/help`, `/serverinfo`, `/userinfo`, `/botinfo` — utilities.

Sensitive commands fetch current roles and perform runtime permission checks. Errors and private confirmations use ephemeral responses.

## Command registration

The bot hashes its command definitions. It skips registration when the hash has not changed. If Discord returns HTTP 429, the retry deadline is stored in SQLite and preserved across restarts. Existing interactions remain available while command registration is delayed.

## Database backup and restore

Stop the bot before copying the SQLite file. Back up `bot.sqlite` and, if present, its `-wal` and `-shm` files together. Restore them to the same configured `SQLITE_PATH` before restarting.

## Updating

1. Back up the database.
2. Pull the new code.
3. Run `npm ci`.
4. Run `npm test`.
5. Restart the service.

Command registration runs only when the serialized command hash changes.

## Testing checklist

- Run `npm test` and confirm all tests pass.
- Run `/help` and confirm the response is public.
- Run `/config` as owner and as an unauthorized member.
- Configure all required channels and roles.
- Submit and approve a showcase design.
- Create, claim, update, and close a design request.
- Create and view a portfolio.
- Open a ticket, add and remove a member, save its transcript, and close it.
- Test moderation commands on a safe test account below the bot role.
- Restart the bot and confirm settings and records remain.
- Check `/livez` and `/readyz`.

## Troubleshooting

### The application did not respond

Check that the bot is online, the interaction appears in the host logs, and the bot can send messages in the channel. Long operations defer replies. Errors include an interaction reference ID.

### Commands are missing

Check the command sync log. A Discord 429 includes a saved retry deadline. Do not repeatedly restart the bot because that does not remove Discord's cooldown.

### SQLite data disappears

Attach a persistent Render disk and use `/var/data/bot.sqlite`. The default local path is intended for local development.

### Missing permissions

Move the bot role above managed members and roles, then grant the specific permission named in the error response.
