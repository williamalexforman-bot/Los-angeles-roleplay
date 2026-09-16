const { performance } = require('node:perf_hooks');

function botToken(env = process.env) {
  return env.BOT_TOKEN?.trim() || env.bot_token?.trim() || '';
}

// Allow Discord.js time to resume a session before asking the host to restart.
function connectionHealth({ isReady, restart, now = () => performance.now(), timeoutMs = 120000 }) {
  let offlineSince = now(), restarting = false;
  function check() {
    const ready = isReady();
    if (ready) offlineSince = null;
    else if (offlineSince === null) offlineSince = now();
    if (!ready && !restarting && now() - offlineSince >= timeoutMs) {
      restarting = true;
      restart();
    }
    return ready;
  }
  return { check };
}

module.exports = { botToken, connectionHealth };
