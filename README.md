# CSRP Clean Bot

This branch intentionally contains no commands, event responses, databases, or ER:LC integrations.

When `BOT_TOKEN` is configured, the bot logs in, deletes previously registered global and server slash commands, and remains idle. A minimal HTTP health endpoint listens on Render's `PORT` so the service can deploy successfully even when no Discord token is configured.

## Run

1. Set `BOT_TOKEN` in the host environment if the process should connect to Discord and remove old commands.
2. Run `npm install`.
3. Run `npm start`.

Previous versions are preserved in dedicated backup branches in this repository.
