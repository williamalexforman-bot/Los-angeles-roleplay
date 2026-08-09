import dotenv from 'dotenv';

dotenv.config();

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';

const PLACEHOLDER_SECRET = /^(?:your(?:[_ -].*)?|replace(?:[_ -]?me)?|change(?:[_ -]?me)?|paste(?:[_ -].*)?|example(?:[_ -].*)?|<.*>)$/i;

/**
 * Reads a secret at call time so tests and long-running integrations agree on
 * whitespace and placeholder handling. Values such as `your_openai_api_key`
 * are documentation examples, not valid runtime configuration.
 */
export function getConfiguredSecret(name: 'OPENAI_API_KEY' | 'BLOXLINK_API_KEY' | 'MELONY_API_KEY'): string | undefined {
    const value = process.env[name]?.trim();
    if (!value || PLACEHOLDER_SECRET.test(value)) return undefined;
    return value;
}

export function getOpenAiApiKey(): string | undefined {
    return getConfiguredSecret('OPENAI_API_KEY');
}

export function getBloxlinkApiKey(): string | undefined {
    return getConfiguredSecret('BLOXLINK_API_KEY');
}

export function getMelonyApiKey(): string | undefined {
    return getConfiguredSecret('MELONY_API_KEY');
}

export function getMelonyApiUrl(): string | undefined {
    const value = process.env.MELONY_API_URL?.trim();
    if (!value) return undefined;
    return value;
}

export function getInGameApiUrl(): string | undefined {
    const value = process.env.INGAME_API_URL?.trim();
    if (!value) return undefined;
    return value;
}

export function getOpenAiModel(): string {
    return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

/**
 * BOT_TOKEN is the canonical setting. TOKEN remains a compatibility fallback for
 * older deployments, but can no longer shadow a freshly rotated BOT_TOKEN.
 */
export function getDiscordBotToken(): string | undefined {
    return process.env.BOT_TOKEN?.trim() || process.env.TOKEN?.trim() || undefined;
}

const config = {
    TOKEN: getDiscordBotToken(),
    MONGODB_URI: process.env.MONGODB_URI,
    PREFIX: process.env.PREFIX || '/',
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
    SUPPORT_ROLE_ID: process.env.SUPPORT_ROLE_ID,
    ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID,
    HIGH_RANK_ROLE_ID: process.env.HIGH_RANK_ROLE_ID,
    GENERAL_SUPPORT_ROLE_ID: process.env.GENERAL_SUPPORT_ROLE_ID,
    MANAGEMENT_ROLE_ID: process.env.MANAGEMENT_ROLE_ID,
    INTERNAL_AFFAIRS_ROLE_ID: process.env.INTERNAL_AFFAIRS_ROLE_ID,
    APPLICATION_CHANNEL_ID: process.env.APPLICATION_CHANNEL_ID,
    TRAINING_CHANNEL_ID: process.env.TRAINING_CHANNEL_ID,
    INFRACTION_CHANNEL_ID: process.env.INFRACTION_CHANNEL_ID,
    PROMOTION_CHANNEL_ID: process.env.PROMOTION_CHANNEL_ID,
    BOT_PERMISSIONS_ROLE_ID: process.env.BOT_PERMISSIONS_ROLE_ID,
    EMERGENCY_STAFF_ROLE_ID: process.env.EMERGENCY_STAFF_ROLE_ID,
    BLOXLINK_API_KEY: getBloxlinkApiKey(),
    MELONY_API_KEY: getMelonyApiKey(),
    MELONY_API_URL: getMelonyApiUrl(),
    ERLC_SERVER_KEY: process.env.ERLC_SERVER_KEY,
    OPENAI_API_KEY: getOpenAiApiKey(),
    OPENAI_MODEL: getOpenAiModel(),
};

export default config;
