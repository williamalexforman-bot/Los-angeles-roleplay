const logger = {
    info: (message: string) => console.log(`[INFO] ${message}`),
    error: (message: string) => console.error(`[ERROR] ${message}`),
    warn: (message: string) => console.warn(`[WARN] ${message}`),
    debug: (message: string) => console.debug(`[DEBUG] ${message}`),
};

export { logger };

export const logInfo = (message: string) => {
    logger.info(message);
};

export const logError = (message: string) => {
    logger.error(message);
};

export const logWarning = (message: string) => {
    logger.warn(message);
};

export const logDebug = (message: string) => {
    logger.debug(message);
};

export const logAction = (...args: unknown[]) => {
    logger.info(args.map(arg => String(arg)).join(' '));
};
