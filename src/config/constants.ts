import path from 'path';

export const BRAND = {
    name: 'California State Roleplay',
    color: 0x247BF1 as number,
    footer: 'California State Roleplay | Realism at its Finest',
    panelFooter: 'Realism at its Finest',
    logoName: 'larp-logo.png',
    logoPath: path.resolve(process.cwd(), 'assets', 'larp-logo.png'),
    logoUrl: 'attachment://larp-logo.png',
} as const;

const STATIC_CHANNEL_IDS = {
    rules: process.env.CSRP_RULES_CHANNEL_ID || '1546571348220837948',
    dashboard: process.env.DASHBOARD_CHANNEL_ID || '1546571345809121280',
    assistance: process.env.ASSISTANCE_CHANNEL_ID || '1546571353459794000',
    ticketPanel: process.env.TICKET_PANEL_CHANNEL_ID || '1546571353459794000',
    generalSupportTickets: process.env.GENERAL_SUPPORT_TICKET_CHANNEL_ID || '1547380073609298030',
    highRankTickets: process.env.HIGH_RANK_TICKET_CHANNEL_ID || '1547379897188618321',
    internalAffairsTickets: process.env.INTERNAL_AFFAIRS_TICKET_CHANNEL_ID || '1547379811553509487',
    applications: process.env.APPLICATIONS_CHANNEL_ID || '1546571350804660331',
    marketplace: process.env.MARKETPLACE_CHANNEL_ID || '1546571372786884779',
    paidPartner: process.env.PAID_PARTNER_CHANNEL_ID || '1546571378470424677',
    paidAds: process.env.PAID_AD_CHANNEL_ID || '1546571378470424677',
    partnershipRequests: process.env.PARTNERSHIP_REQUEST_CHANNEL_ID || '1546571375521693696',
    sessionAnnouncements: process.env.SESSION_ANNOUNCEMENT_CHANNEL_ID || '1546571384451366982',
    trainingResults: process.env.TRAINING_RESULTS_CHANNEL_ID || '1546571451669282979',
    trainingRequests: process.env.TRAINING_REQUEST_CHANNEL_ID || '1546571450255941802',
    promotions: process.env.PROMOTION_CHANNEL_ID || '1546571427170353262',
    infractionParent: process.env.INFRACTION_PARENT_CHANNEL_ID || '1546571428663664810',
    profanityLog: process.env.PROFANITY_LOG_CHANNEL_ID || '1529289318152274000',
    erlcCommandLog: process.env.ERLC_COMMAND_LOG_CHANNEL_ID || '1528907187081183252',
    raidThreatLog: process.env.RAID_THREAT_LOG_CHANNEL_ID || '1529287167203872838',
    discordCommandLog: process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || '1528917592604020917',
    erlcTeamChangeLog: process.env.ERLC_TEAM_CHANGE_LOG_CHANNEL_ID || '1528917232153923635',
    erlcPunishmentLog: process.env.ERLC_PUNISHMENT_LOG_CHANNEL_ID || '1528917189699043439',
    staffFeedback: process.env.STAFF_FEEDBACK_CHANNEL_ID || '1526041844515868745',
    staffComplaints: process.env.STAFF_COMPLAINT_CHANNEL_ID || '1527139806797369504',
    movieFeedback: process.env.MOVIE_FEEDBACK_CHANNEL_ID || '1528933044310904884',
    suggestions: process.env.SUGGESTION_CHANNEL_ID || '1538693259621044264',
    giveaways: process.env.GIVEAWAY_CHANNEL_ID || '1526036762848137318',
    memberJoinLog: process.env.JOIN_LOG_CHANNEL_ID || '1529283685168447698',
    privateAudit: process.env.PRIVATE_AUDIT_LOG_CHANNEL_ID || process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || '1528917592604020917',
} as const;

type ChannelKey = keyof typeof STATIC_CHANNEL_IDS;

function liveChannelId(key: ChannelKey): string | undefined {
    const state = globalThis as any;
    const guildId = state.__primaryGuildId || process.env.GUILD_ID;
    return guildId ? state.__serverChannelIdsByKey?.[guildId]?.[key] : undefined;
}

/**
 * Current CSRP IDs are authoritative. AutoFinder is only a fallback for keys
 * that do not have a configured/current ID.
 */
export const CHANNEL_IDS = new Proxy(STATIC_CHANNEL_IDS, {
    get(target, property: string | symbol) {
        if (typeof property !== 'string' || !(property in target)) {
            return Reflect.get(target, property);
        }
        const key = property as ChannelKey;
        return target[key] || liveChannelId(key);
    },
}) as typeof STATIC_CHANNEL_IDS;

export const PARTNERSHIP_ROLE_ID = process.env.PARTNERSHIP_ROLE_ID || '1521593407783440394';
export const SESSION_START_AUTHORIZED_ROLE_ID = process.env.SESSION_START_AUTHORIZED_ROLE_ID || '1546570940165656648';
export const INFRACTION_AUTHORIZED_ROLE_ID = process.env.INFRACTION_AUTHORIZED_ROLE_ID || '1546570940165656648';
export const PROMOTION_AUTHORIZED_ROLE_ID = process.env.PROMOTION_AUTHORIZED_ROLE_ID || '1546570940165656648';
export const TRAINING_RESULTS_AUTHORIZED_ROLE_ID = process.env.TRAINING_RESULTS_AUTHORIZED_ROLE_ID || '1521593407795888330';

const CSRP_GUILD_ID = process.env.GUILD_ID || '1521593407741362257';

export const SUPPORT_LINKS = {
    get rules() {
        return `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.rules}`;
    },
    get paidPartner() {
        return `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.paidPartner}`;
    },
    officialErlcCommunityGuidelines: 'https://support.policeroleplay.community/hc/en-us/articles/33683178225300-PRC-Community-Guidelines',
} as const;
