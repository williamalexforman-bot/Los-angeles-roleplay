import path from 'path';

export const BRAND = {
    name: 'California State Roleplay',
    color: 0xfacc15,
    footer: 'California State Roleplay | Realism at its Finest',
    panelFooter: 'Realism at its Finest',
    logoName: 'larp-logo.png',
    logoPath: path.resolve(process.cwd(), 'assets', 'larp-logo.png'),
    logoUrl: 'attachment://larp-logo.png',
} as const;

export const CHANNEL_IDS = {
    ticketPanel: process.env.TICKET_PANEL_CHANNEL_ID || '',
    ticketTranscript: process.env.TICKET_TRANSCRIPT_CHANNEL_ID || '',
    rules: process.env.CSRP_RULES_CHANNEL_ID || '',
    paidPartner: process.env.PAID_PARTNER_CHANNEL_ID || '',
    profanityLog: process.env.PROFANITY_LOG_CHANNEL_ID || '',
    erlcCommandLog: process.env.ERLC_COMMAND_LOG_CHANNEL_ID || '',
    discordCommandLog: process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || '',
    erlcTeamChangeLog: process.env.ERLC_TEAM_CHANGE_LOG_CHANNEL_ID || '',
    erlcPunishmentLog: process.env.ERLC_PUNISHMENT_LOG_CHANNEL_ID || '',
    trainingResults: process.env.TRAINING_RESULTS_CHANNEL_ID || '',
    infractionParent: process.env.INFRACTION_PARENT_CHANNEL_ID || '',
    staffFeedback: process.env.STAFF_FEEDBACK_CHANNEL_ID || '',
    partnershipRequests: process.env.PARTNERSHIP_REQUEST_CHANNEL_ID || '',
    staffComplaints: process.env.STAFF_COMPLAINT_CHANNEL_ID || '',
    promotions: process.env.PROMOTION_CHANNEL_ID || '',
    movieFeedback: process.env.MOVIE_FEEDBACK_CHANNEL_ID || '',
    privateAudit: process.env.PRIVATE_AUDIT_LOG_CHANNEL_ID || process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || '',
};

export let PARTNERSHIP_ROLE_ID = process.env.PARTNERSHIP_ROLE_ID || '';

const CSRP_GUILD_ID = process.env.GUILD_ID || '';

export const SUPPORT_LINKS = {
    get rules(): string {
        return `https://discord.com/channels/${process.env.GUILD_ID || CSRP_GUILD_ID}/${CHANNEL_IDS.rules}`;
    },
    get paidPartner(): string {
        return `https://discord.com/channels/${process.env.GUILD_ID || CSRP_GUILD_ID}/${CHANNEL_IDS.paidPartner}`;
    },
    officialErlcCommunityGuidelines: 'https://support.policeroleplay.community/hc/en-us/articles/33683178225300-PRC-Community-Guidelines',
};

export const TICKET_CATEGORY_IDS = {
    general: process.env.GENERAL_SUPPORT_CATEGORY_ID || '',
    internal: process.env.INTERNAL_AFFAIRS_CATEGORY_ID || '',
    management: process.env.MANAGEMENT_CATEGORY_ID || '',
    highrank: process.env.HIGH_RANK_CATEGORY_ID || '',
};

export const SUPPORT_ROLE_IDS = {
    general: process.env.GENERAL_SUPPORT_ROLE_ID || '',
    internal: process.env.INTERNAL_AFFAIRS_ROLE_ID || '',
    management: process.env.MANAGEMENT_ROLE_ID || '',
    highrank: process.env.HIGH_RANK_ROLE_ID || '',
};

/** Staff role with access to every ticket, regardless of ticket department. */
export const TICKET_STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID || '1546570940165656648';

/** Applies IDs discovered after Discord is ready to the live configuration objects. */
export function applyRuntimeConfiguration(): void {
    CHANNEL_IDS.ticketPanel = process.env.TICKET_PANEL_CHANNEL_ID || CHANNEL_IDS.ticketPanel;
    CHANNEL_IDS.ticketTranscript = process.env.TICKET_TRANSCRIPT_CHANNEL_ID || CHANNEL_IDS.ticketTranscript;
    CHANNEL_IDS.rules = process.env.CSRP_RULES_CHANNEL_ID || CHANNEL_IDS.rules;
    CHANNEL_IDS.paidPartner = process.env.PAID_PARTNER_CHANNEL_ID || CHANNEL_IDS.paidPartner;
    CHANNEL_IDS.profanityLog = process.env.PROFANITY_LOG_CHANNEL_ID || CHANNEL_IDS.profanityLog;
    CHANNEL_IDS.erlcCommandLog = process.env.ERLC_COMMAND_LOG_CHANNEL_ID || CHANNEL_IDS.erlcCommandLog;
    CHANNEL_IDS.discordCommandLog = process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || CHANNEL_IDS.discordCommandLog;
    CHANNEL_IDS.erlcTeamChangeLog = process.env.ERLC_TEAM_CHANGE_LOG_CHANNEL_ID || CHANNEL_IDS.erlcTeamChangeLog;
    CHANNEL_IDS.erlcPunishmentLog = process.env.ERLC_PUNISHMENT_LOG_CHANNEL_ID || CHANNEL_IDS.erlcPunishmentLog;
    CHANNEL_IDS.trainingResults = process.env.TRAINING_RESULTS_CHANNEL_ID || CHANNEL_IDS.trainingResults;
    CHANNEL_IDS.infractionParent = process.env.INFRACTION_PARENT_CHANNEL_ID || CHANNEL_IDS.infractionParent;
    CHANNEL_IDS.staffFeedback = process.env.STAFF_FEEDBACK_CHANNEL_ID || CHANNEL_IDS.staffFeedback;
    CHANNEL_IDS.partnershipRequests = process.env.PARTNERSHIP_REQUEST_CHANNEL_ID || CHANNEL_IDS.partnershipRequests;
    CHANNEL_IDS.staffComplaints = process.env.STAFF_COMPLAINT_CHANNEL_ID || CHANNEL_IDS.staffComplaints;
    CHANNEL_IDS.promotions = process.env.PROMOTION_CHANNEL_ID || process.env.PROMOTIONS_CHANNEL_ID || CHANNEL_IDS.promotions;
    CHANNEL_IDS.movieFeedback = process.env.MOVIE_FEEDBACK_CHANNEL_ID || CHANNEL_IDS.movieFeedback;
    CHANNEL_IDS.privateAudit = process.env.PRIVATE_AUDIT_LOG_CHANNEL_ID
        || process.env.AUDIT_LOG_CHANNEL_ID
        || CHANNEL_IDS.discordCommandLog
        || CHANNEL_IDS.privateAudit;

    TICKET_CATEGORY_IDS.general = process.env.GENERAL_SUPPORT_CATEGORY_ID || TICKET_CATEGORY_IDS.general;
    TICKET_CATEGORY_IDS.internal = process.env.INTERNAL_AFFAIRS_CATEGORY_ID || TICKET_CATEGORY_IDS.internal;
    TICKET_CATEGORY_IDS.management = process.env.MANAGEMENT_CATEGORY_ID || TICKET_CATEGORY_IDS.management;
    TICKET_CATEGORY_IDS.highrank = process.env.HIGH_RANK_CATEGORY_ID || TICKET_CATEGORY_IDS.highrank;

    SUPPORT_ROLE_IDS.general = process.env.GENERAL_SUPPORT_ROLE_ID || SUPPORT_ROLE_IDS.general;
    SUPPORT_ROLE_IDS.internal = process.env.INTERNAL_AFFAIRS_ROLE_ID || SUPPORT_ROLE_IDS.internal;
    SUPPORT_ROLE_IDS.management = process.env.MANAGEMENT_ROLE_ID || SUPPORT_ROLE_IDS.management;
    SUPPORT_ROLE_IDS.highrank = process.env.HIGH_RANK_ROLE_ID || SUPPORT_ROLE_IDS.highrank;
    PARTNERSHIP_ROLE_ID = process.env.PARTNERSHIP_ROLE_ID || PARTNERSHIP_ROLE_ID;
}

export type TicketCategory = keyof typeof TICKET_CATEGORY_IDS;
