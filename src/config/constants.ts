import path from 'path';

export const BRAND = {
    name: 'Los Angeles Roleplay',
    color: 0x3b82f6,
    footer: 'Los Angeles Roleplay | Realism at its Finest',
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
    raidThreatLog: process.env.RAID_THREAT_LOG_CHANNEL_ID || '',
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
} as const;

export const PARTNERSHIP_ROLE_ID = process.env.PARTNERSHIP_ROLE_ID || '';

const CSRP_GUILD_ID = process.env.GUILD_ID || '';

export const SUPPORT_LINKS = {
    rules: `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.rules}`,
    paidPartner: `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.paidPartner}`,
    officialErlcCommunityGuidelines: 'https://support.policeroleplay.community/hc/en-us/articles/33683178225300-PRC-Community-Guidelines',
} as const;

export const TICKET_CATEGORY_IDS = {
    general: process.env.GENERAL_SUPPORT_CATEGORY_ID || '',
    internal: process.env.INTERNAL_AFFAIRS_CATEGORY_ID || '',
    management: process.env.MANAGEMENT_CATEGORY_ID || '',
    highrank: process.env.HIGH_RANK_CATEGORY_ID || '',
} as const;

export const SUPPORT_ROLE_IDS = {
    general: process.env.GENERAL_SUPPORT_ROLE_ID || '',
    internal: process.env.INTERNAL_AFFAIRS_ROLE_ID || '',
    management: process.env.MANAGEMENT_ROLE_ID || '',
    highrank: process.env.HIGH_RANK_ROLE_ID || '',
} as const;

export type TicketCategory = keyof typeof TICKET_CATEGORY_IDS;
