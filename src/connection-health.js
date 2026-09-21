const { performance } = require('node:perf_hooks');

function botToken(env = process.env) {
  const raw=env.BOT_TOKEN?.trim() || env.bot_token?.trim() || '';
  const unquoted=/^(["']).*\1$/.test(raw)?raw.slice(1,-1).trim():raw;
  return unquoted.replace(/^Bot\s+/i,'').trim();
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
