'use strict';

require('./preload.js');
require('ts-node').register({
  transpileOnly: true,
  project: require('path').join(__dirname, 'tsconfig.json'),
});
require('dotenv').config();

const http = require('http');
const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} = require('discord.js');

const token = (process.env.BOT_TOKEN || process.env.TOKEN || '').trim();
if (!token) {
  console.error('[FATAL] BOT_TOKEN/TOKEN is missing.');
  process.exit(1);
}

const messageModerationEnabled = String(process.env.ENABLE_MESSAGE_MODERATION || 'true').toLowerCase() !== 'false';
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages,
];
if (messageModerationEnabled) {
  intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({
  intents,
  partials: [Partials.Channel],
});
globalThis.__discordClient = client;
globalThis.__indexOwnsStableInteractionBridge = true;

console.log(`[MessageModeration] Curse/raid message monitoring ${messageModerationEnabled ? 'ENABLED' : 'DISABLED'}.`);

function interactionRateLimited() {
  return Number(globalThis.__discordInteractionRateLimitedUntil || 0) > Date.now();
}

function interactionRateLimitSeconds() {
  return Math.max(0, Math.ceil((Number(globalThis.__discordInteractionRateLimitedUntil || 0) - Date.now()) / 1000));
}

const port = Number(process.env.PORT || process.env.WEBHOOK_PORT || 10000);
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    const body = JSON.stringify({
      ok: true,
      discordReady: client.isReady(),
      uptimeSeconds: Math.floor(process.uptime()),
      interactionListeners: client.listenerCount(Events.InteractionCreate),
      interactionRateLimitedSeconds: interactionRateLimitSeconds(),
      messageModerationEnabled,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});
server.listen(port, '0.0.0.0', () => {
  console.log(`[Health] Listening on 0.0.0.0:${port}`);
});

client.on('error', error => {
  console.error('[Discord] Client error:', error?.stack || error?.message || String(error));
});
client.on('shardError', error => {
  console.error('[Discord] Shard error:', error?.stack || error?.message || String(error));
});
client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[Discord] Shard ${shardId} disconnected code=${event?.code ?? 'unknown'}.`);
});
client.on('shardReady', shardId => {
  console.log(`[DiscordGateway] Shard ${shardId} READY.`);
});
client.on('shardResume', (shardId, replayed) => {
  console.log(`[DiscordGateway] Shard ${shardId} resumed replayed=${replayed}.`);
});
client.on('shardReconnecting', shardId => {
  console.warn(`[DiscordGateway] Shard ${shardId} reconnecting.`);
});

client.on('raw', packet => {
  if (packet?.t !== 'INTERACTION_CREATE') return;
  const name = packet?.d?.data?.name || 'component';
  const id = packet?.d?.id || 'unknown';
  console.log(`[RawInteraction] INTERACTION_CREATE name=${name} id=${id}.`);
});

if (messageModerationEnabled) {
  let handleMessageModeration = null;
  try {
    ({ handleMessageModeration } = require('./src/events/messageModeration.ts'));
    if (typeof handleMessageModeration !== 'function') throw new Error('handleMessageModeration export missing');
    console.log('[MessageModeration] Prohibited-word and raid-threat handler loaded.');
  } catch (error) {
    console.error('[MessageModeration] Handler failed to load:', error?.stack || error?.message || String(error));
  }

  client.on(Events.MessageCreate, async message => {
    if (typeof handleMessageModeration !== 'function') return;
    try {
      await handleMessageModeration(message);
    } catch (error) {
      console.error('[MessageModeration] Message handler failed:', error?.stack || error?.message || String(error));
    }
  });
}

let stableRouter = null;
try {
  ({ interactionCreateStable: stableRouter } = require('./src/handlers/interactionCreateStable.ts'));
  if (typeof stableRouter !== 'function') throw new Error('interactionCreateStable export missing');
  console.log('[InteractionBridge] Stable router loaded.');
} catch (error) {
  console.error('[InteractionBridge] Stable router failed to load:', error?.stack || error?.message || String(error));
}

function errorMeta(error) {
  return `status=${error?.status ?? error?.rawError?.status ?? 'unknown'} code=${error?.code ?? error?.rawError?.code ?? 'unknown'} message=${error?.message || String(error)}`;
}

async function directRecoveryReply(interaction) {
  const name = interaction.commandName;
  if (name !== 'cmds' && name !== 'help') return false;

  if (interactionRateLimited()) {
    console.warn(`[InteractionBridge] /${name} received while Discord interaction REST is rate-limited for ~${interactionRateLimitSeconds()}s; no duplicate callback sent.`);
    return true;
  }

  try {
    await interaction.reply({
      content:
        '✅ **Los Angeles Roleplay bot is receiving slash commands.**\n'
        + 'The command gateway and interaction reply path are working. `/cmds` is the current command-list command.',
      flags: MessageFlags.Ephemeral,
    });
    console.log(`[InteractionBridge] DIRECT RECOVERY REPLY succeeded for /${name}.`);
  } catch (error) {
    console.error(`[InteractionBridge] DIRECT RECOVERY REPLY FAILED /${name}: ${errorMeta(error)}`);
  }
  return true;
}

client.on(Events.InteractionCreate, async interaction => {
  const startedAt = Date.now();
  const isSlash = interaction.isChatInputCommand?.() === true;
  const name = isSlash ? interaction.commandName : interaction.customId || interaction.type;

  console.log(
    `[InteractionBridge] RECEIVED ${isSlash ? '/' : ''}${name}`
    + ` id=${interaction.id} guild=${interaction.guildId || 'DM'}`,
  );

  if (isSlash && await directRecoveryReply(interaction)) return;

  try {
    if (typeof stableRouter !== 'function') {
      throw new Error('Stable interaction router is unavailable');
    }

    await stableRouter(interaction);

    if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
      if (interactionRateLimited()) {
        console.warn(`[InteractionBridge] Fallback acknowledgement suppressed for ${name}; Discord interaction REST is rate-limited for ~${interactionRateLimitSeconds()}s.`);
      } else {
        try {
          await interaction.reply({
            content: 'That interaction did not produce a response. The command router is online, but that specific handler needs repair.',
            flags: MessageFlags.Ephemeral,
          });
          console.warn(`[InteractionBridge] Fallback reply used for ${name}.`);
        } catch (error) {
          console.error(`[InteractionBridge] FALLBACK ACK FAILED ${name}: ${errorMeta(error)}`);
        }
      }
    }

    console.log(
      `[InteractionBridge] HANDLED ${name} in ${Date.now() - startedAt}ms`
      + ` replied=${interaction.replied} deferred=${interaction.deferred}.`,
    );
  } catch (error) {
    console.error(`[InteractionBridge] ROUTER ERROR ${name}:`, error?.stack || error?.message || String(error));
    if (!interaction.isRepliable?.()) return;

    if (interactionRateLimited()) {
      console.warn(`[InteractionBridge] Error acknowledgement suppressed for ${name}; Discord interaction REST is rate-limited for ~${interactionRateLimitSeconds()}s.`);
      return;
    }

    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: 'The command handler failed, but the bot is online.' });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: 'The command handler failed, but the bot is online.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      console.error(`[InteractionBridge] ERROR REPLY FAILED ${name}: ${errorMeta(replyError)}`);
    }
  }
});

console.log(`[InteractionBridge] Command-first listener installed. listeners=${client.listenerCount(Events.InteractionCreate)}.`);

client.once(Events.ClientReady, async readyClient => {
  console.log(`[Discord] READY as ${readyClient.user.tag} (${readyClient.user.id})`);
  console.log(`[InteractionBridge] READY listener count=${readyClient.listenerCount(Events.InteractionCreate)}.`);

  try {
    const { onReady } = require('./src/events/ready.ts');
    void onReady(readyClient)
      .then(() => console.log('[Discord] Ready hooks completed.'))
      .catch(error => console.error('[Discord] Ready hooks failed:', error?.stack || error?.message || String(error)));
  } catch (error) {
    console.error('[Discord] Could not load ready hooks:', error?.stack || error?.message || String(error));
  }
});

console.log('[Discord] Attempting login...');
client.login(token).catch(error => {
  console.error('[FATAL] Discord login failed:', error?.stack || error?.message || String(error));
  process.exit(1);
});
