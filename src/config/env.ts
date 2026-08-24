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

function hasValue(name: string): boolean {
    return Boolean(process.env[name]?.trim());
}

export interface RuntimeEnvironmentAudit {
    healthy: boolean;
    required: Record<string, boolean>;
    recommended: Record<string, boolean>;
    optional: Record<string, boolean>;
    notes: string[];
}

/**
 * Returns presence/health information only. It never returns tokens, passwords,
 * API keys, connection strings, or any other secret value.
 */
export function auditRuntimeEnvironment(): RuntimeEnvironmentAudit {
    const splitMongo = {
        username: hasValue('MONGODB_USERNAME'),
        password: hasValue('MONGODB_PASSWORD'),
        host: hasValue('MONGODB_HOST'),
    };
    const splitMongoCount = Object.values(splitMongo).filter(Boolean).length;
    const mongoSplitComplete = splitMongoCount === 3;
    const mongoUriPresent = hasValue('MONGODB_URI');
    const mongoConfigured = mongoSplitComplete || mongoUriPresent;
    const renderUrlPresent = hasValue('RENDER_EXTERNAL_URL') || hasValue('RENDER_EXTERNAL_HOSTNAME');

    const required = {
        BOT_TOKEN: Boolean(getDiscordBotToken()),
        MONGODB: mongoConfigured,
    };

    const recommended = {
        GUILD_ID: hasValue('GUILD_ID'),
        ENABLE_PRIVILEGED_INTENTS: String(process.env.ENABLE_PRIVILEGED_INTENTS || '').toLowerCase() === 'true',
        RENDER_EXTERNAL_URL: process.env.RENDER === 'true' ? renderUrlPresent : true,
    };

    const optional = {
        OPENAI_API_KEY: Boolean(getOpenAiApiKey()),
        ERLC_SERVER_KEY: hasValue('ERLC_SERVER_KEY'),
        DOCK_API_KEY: hasValue('DOCK_API_KEY'),
        BLOXLINK_API_KEY: Boolean(getBloxlinkApiKey()),
        MELONY_API_KEY: Boolean(getMelonyApiKey()),
        MELONY_API_URL: Boolean(getMelonyApiUrl()),
        INGAME_API_URL: Boolean(getInGameApiUrl()),
    };

    const notes: string[] = [];
    if (splitMongoCount > 0 && !mongoSplitComplete) {
        notes.push('MongoDB split credentials are only partially configured; all of MONGODB_USERNAME, MONGODB_PASSWORD, and MONGODB_HOST are required together.');
    }
    if (!hasValue('GUILD_ID')) {
        notes.push('GUILD_ID is not set; the bot can use its connected guild/fallback ID, but explicit configuration is safer.');
    }
    if (process.env.RENDER === 'true' && !renderUrlPresent) {
        notes.push('Render did not expose RENDER_EXTERNAL_URL/RENDER_EXTERNAL_HOSTNAME, so the internal keepalive cannot self-ping.');
    }
    if (hasValue('BOT_TOKEN') && hasValue('TOKEN')) {
        notes.push('Both BOT_TOKEN and legacy TOKEN are set; BOT_TOKEN wins. Removing legacy TOKEN reduces configuration ambiguity.');
    }

    const healthy = Object.values(required).every(Boolean) && Object.values(recommended).every(Boolean);
    return { healthy, required, recommended, optional, notes };
}

/** Print a secrets-safe startup report for Render logs. */
export function logRuntimeEnvironmentAudit(log: (message: string) => void = console.log): RuntimeEnvironmentAudit {
    const audit = auditRuntimeEnvironment();
    const status = (value: boolean) => value ? 'PRESENT' : 'MISSING';
    log(`[EnvAudit] overall=${audit.healthy ? 'HEALTHY' : 'CHECK_REQUIRED'}`);
    log(`[EnvAudit] required BOT_TOKEN=${status(audit.required.BOT_TOKEN)} MONGODB=${status(audit.required.MONGODB)}`);
    log(`[EnvAudit] recommended GUILD_ID=${status(audit.recommended.GUILD_ID)} PRIVILEGED_INTENTS=${status(audit.recommended.ENABLE_PRIVILEGED_INTENTS)} RENDER_URL=${status(audit.recommended.RENDER_EXTERNAL_URL)}`);
    log(`[EnvAudit] optional OPENAI=${status(audit.optional.OPENAI_API_KEY)} ERLC=${status(audit.optional.ERLC_SERVER_KEY)} DOCK=${status(audit.optional.DOCK_API_KEY)} BLOXLINK=${status(audit.optional.BLOXLINK_API_KEY)} MELONY_KEY=${status(audit.optional.MELONY_API_KEY)} MELONY_URL=${status(audit.optional.MELONY_API_URL)} INGAME_URL=${status(audit.optional.INGAME_API_URL)}`);
    for (const note of audit.notes) log(`[EnvAudit] NOTE: ${note}`);
    return audit;
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

if (process.env.NODE_ENV === 'production' && process.env.LARP_ENV_AUDIT_LOGGED !== 'true') {
    process.env.LARP_ENV_AUDIT_LOGGED = 'true';
    logRuntimeEnvironmentAudit();
}

export default config;
