// Bootstrap: registers ts-node for runtime TypeScript transpilation,
// then loads the bot directly from source. This avoids running tsc
// during npm install (which causes OOM on memory-constrained hosts).
require('ts-node').register({ transpileOnly: true, project: require('path').join(__dirname, 'tsconfig.json') });

// Do NOT force privileged gateway intents from code. If Discord has not enabled
// Guild Members / Message Content for this application, forcing them makes the
// bot account stay offline even though Render's /health endpoint is healthy.
// Render may explicitly set ENABLE_PRIVILEGED_INTENTS=true after those intents
// are enabled in the Discord Developer Portal. Otherwise the bot starts safely
// with commands, tickets, applications, and session interactions available.
if (!process.env.ENABLE_PRIVILEGED_INTENTS) {
    process.env.ENABLE_PRIVILEGED_INTENTS = 'false';
}

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

// Route the high-use ticket/application/session components directly to their
// own handlers. This prevents unrelated feature handlers or slow services from
// consuming Discord's short interaction acknowledgement window.
const interactionRouterModule = require('./src/handlers/interactionCreate.ts');
const { installInteractionFastRouter } = require('./src/handlers/interactionFastRouter.ts');
installInteractionFastRouter(interactionRouterModule);

require('./src/index.ts');
