'use strict';

// Loaded by Render before index.js. Optional Discord/database feature failures
// must never terminate the entire bot process and take tickets/commands offline.
process.on('unhandledRejection', reason => {
  const message = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  console.error('[Runtime] Unhandled promise rejection contained:', message);
});

process.on('uncaughtException', error => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error('[Runtime] Uncaught exception contained:', message);
});

process.on('warning', warning => {
  console.warn('[Runtime] Node warning:', warning?.stack || warning?.message || String(warning));
});

// index.js historically used a cached lazy router promise. If that promise
// rejects once, every later command can fail for the lifetime of the process.
// Replace only the InteractionCreate listener after index.js creates the client
// and install one direct stable-router bridge. This leaves all other listeners
// (ready, messages, shard events, etc.) untouched.
let directInteractionBridgeInstalled = false;
const bridgeInstaller = setInterval(() => {
  if (directInteractionBridgeInstalled) return;
  const client = globalThis.__discordClient;
  if (!client || typeof client.on !== 'function') return;

  // Give index.js enough time to attach its original interaction listener so
  // we can replace it once rather than racing with startup.
  directInteractionBridgeInstalled = true;
  clearInterval(bridgeInstaller);

  setTimeout(() => {
    try {
      const { Events, MessageFlags } = require('discord.js');
      const { interactionCreateStable } = require('./src/handlers/interactionCreateStable.ts');
      if (typeof interactionCreateStable !== 'function') {
        throw new Error('interactionCreateStable export is unavailable.');
      }

      client.removeAllListeners(Events.InteractionCreate);
      client.on(Events.InteractionCreate, async interaction => {
        const startedAt = Date.now();
        try {
          await interactionCreateStable(interaction);
          if (interaction.isChatInputCommand?.()) {
            console.log(`[InteractionBridge] /${interaction.commandName} handled in ${Date.now() - startedAt}ms.`);
          }
        } catch (error) {
          const message = error instanceof Error ? (error.stack || error.message) : String(error);
          console.error('[InteractionBridge] Stable router failed:', message);

          if (!interaction.isRepliable?.()) return;
          try {
            const content = 'The command system hit an internal error. Please try again.';
            if (interaction.deferred) await interaction.editReply({ content });
            else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
          } catch (replyError) {
            console.error('[InteractionBridge] Could not acknowledge failed interaction:', replyError instanceof Error ? replyError.message : String(replyError));
          }
        }
      });

      console.log('[InteractionBridge] Direct stable interaction bridge installed; cached lazy router bypassed.');
    } catch (error) {
      directInteractionBridgeInstalled = false;
      const message = error instanceof Error ? (error.stack || error.message) : String(error);
      console.error('[InteractionBridge] Direct bridge installation failed:', message);
    }
  }, 750).unref?.();
}, 100);
bridgeInstaller.unref?.();

// Render can report the web service as Live while the Discord gateway is no
// longer ready. Watch the globally exposed discord.js Client and force a clean
// reconnect when it remains disconnected for more than two minutes.
const DISCORD_WATCH_INTERVAL_MS = 30_000;
const DISCORD_NOT_READY_GRACE_MS = 2 * 60_000;
let discordNotReadySince = 0;
let discordReconnectInProgress = false;

setInterval(async () => {
  const client = globalThis.__discordClient;
  if (!client || typeof client.isReady !== 'function') return;

  if (client.isReady()) {
    discordNotReadySince = 0;
    return;
  }

  if (!discordNotReadySince) {
    discordNotReadySince = Date.now();
    return;
  }

  if (Date.now() - discordNotReadySince < DISCORD_NOT_READY_GRACE_MS) return;
  if (discordReconnectInProgress) return;

  const token = (process.env.BOT_TOKEN || process.env.TOKEN || '').trim();
  if (!token || typeof client.login !== 'function') {
    console.error('[DiscordWatchdog] Discord is not ready, but no usable bot token/client login method is available.');
    discordNotReadySince = Date.now();
    return;
  }

  discordReconnectInProgress = true;
  console.warn('[DiscordWatchdog] Discord has remained not-ready for over 2 minutes. Forcing a gateway reconnect.');

  try {
    if (typeof client.destroy === 'function') client.destroy();
    await client.login(token);
    discordNotReadySince = 0;
    console.log('[DiscordWatchdog] Discord reconnect completed successfully.');
  } catch (error) {
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    console.error('[DiscordWatchdog] Discord reconnect failed:', message);
    discordNotReadySince = Date.now();
  } finally {
    discordReconnectInProgress = false;
  }
}, DISCORD_WATCH_INTERVAL_MS).unref?.();

console.log('[Runtime] Emergency crash containment active.');
console.log('[DiscordWatchdog] Gateway readiness watchdog active.');
