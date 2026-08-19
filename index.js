// Bootstrap: registers ts-node for runtime TypeScript transpilation,
// then loads the bot directly from source. This avoids running tsc
// during npm install (which causes OOM on memory-constrained hosts).
require('ts-node').register({ transpileOnly: true, project: require('path').join(__dirname, 'tsconfig.json') });

// The message-quota system requires GuildMembers, GuildMessages, and
// MessageContent. Request the privileged intent set by default so a manually
// configured Render service cannot silently disable quota just because the
// environment flag was never added. If Discord has not enabled the privileged
// intents for the application, src/index.ts still falls back safely.
process.env.ENABLE_PRIVILEGED_INTENTS = 'true';

// Install restart-safe recovery before the main interaction router imports the
// appeal module. This lets old INF-#### appeal buttons recover their original
// Discord case/thread even after a restart or temporary MongoDB outage.
const infractionAppealModule = require('./src/commands/infractionAppeal.ts');
const { installInfractionAppealRecovery } = require('./src/commands/infractionAppealRecovery.ts');
installInfractionAppealRecovery(infractionAppealModule);

// Upgrade the existing ticket module before the interaction router imports it.
// This preserves the current panel/create workflow while adding claimed DMs,
// closure recap/transcript DMs, restart-safe feedback, and feedback logging.
const ticketModule = require('./src/commands/tickets.ts');
const { installTicketLifecycleEnhancements } = require('./src/commands/ticketLifecycleEnhancements.ts');
installTicketLifecycleEnhancements(ticketModule);

require('./src/index.ts');