// Minimal production bootstrap.
// Keep startup deliberately small so Discord can connect and begin receiving
// interactions before any optional enhancement layer is loaded.
require('ts-node').register({
  transpileOnly: true,
  project: require('path').join(__dirname, 'tsconfig.json'),
});

// Emergency command-safe mode. Core slash commands, ticket interactions,
// applications, session controls, and appeals do not require privileged
// gateway intents. Quota/message monitoring can be enabled again separately
// after the Discord gateway is confirmed healthy.
process.env.ENABLE_PRIVILEGED_INTENTS = 'false';

require('./src/index.ts');
