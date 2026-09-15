const chalk = require('chalk');

const levels = {
    info: chalk.blue('INFO'),
    warn: chalk.yellow('WARN'),
    error: chalk.red('ERROR'),
    success: chalk.green('SUCCESS'),
    debug: chalk.magenta('DEBUG')
};

function log(level, message, ...args) {
    const timestamp = new Date().toLocaleString();
    const prefix = `[${timestamp}] [${levels[level] || level.toUpperCase()}]`;
    console.log(`${chalk.gray(prefix)} ${message}`, ...args);
}

const logger = {
    info: (msg, ...args) => log('info', msg, ...args),
    warn: (msg, ...args) => log('warn', msg, ...args),
    error: (msg, ...args) => log('error', msg, ...args),
    success: (msg, ...args) => log('success', msg, ...args),
    debug: (msg, ...args) => log('debug', msg, ...args)
};

module.exports = logger;
