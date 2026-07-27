// Bootstrap: registers ts-node for runtime TypeScript transpilation,
// then loads the bot directly from source. This avoids running tsc
// during npm install (which causes OOM on memory-constrained hosts).
require('ts-node').register({ transpileOnly: true, project: require('path').join(__dirname, 'tsconfig.json') });
require('./src/index.ts');
