# CSRP Clean Bot

This branch intentionally contains no commands, event responses, databases, or ER:LC integrations.

When deployed, the bot logs in, deletes previously registered global and server slash commands, and remains idle. A minimal HTTP health endpoint listens on Render's `PORT` so the service can deploy successfully.

## Run

1. Set `BOT_TOKEN` in the host environment.
2. Run `npm install`.
3. Run `npm start`.

Previous versions are preserved in dedicated backup branches in this repository.
