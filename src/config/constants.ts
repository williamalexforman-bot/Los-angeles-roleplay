import path from 'path';

export const BRAND = {
    name: 'Los Angeles Roleplay',
    color: 0x14b8a6,
    footer: 'Los Angeles Roleplay | Realism at its Finest',
    panelFooter: 'Realism at its Finest',
    logoName: 'csrp-logo.png',
    logoPath: path.resolve(process.cwd(), 'assets', 'csrp-logo.png'),
    logoUrl: 'attachment://csrp-logo.png',
} as const;

export const CHANNEL_IDS = {
    ticketPanel: process.env.TICKET_PANEL_CHANNEL_ID || '1526034504953892925',
    ticketTranscript: process.env.TICKET_TRANSCRIPT_CHANNEL_ID || '1526255184303493291',
    rules: process.env.CSRP_RULES_CHANNEL_ID || '1526046592187105421',
    paidPartner: process.env.PAID_PARTNER_CHANNEL_ID || '1526035127606706196',
    profanityLog: process.env.PROFANITY_LOG_CHANNEL_ID || '1529289318152274000',
    erlcCommandLog: process.env.ERLC_COMMAND_LOG_CHANNEL_ID || '1528907187081183252',
    raidThreatLog: process.env.RAID_THREAT_LOG_CHANNEL_ID || '1529287167203872838',
    discordCommandLog: process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || '1528917592604020917',
    erlcTeamChangeLog: process.env.ERLC_TEAM_CHANGE_LOG_CHANNEL_ID || '1528917232153923635',
    erlcPunishmentLog: process.env.ERLC_PUNISHMENT_LOG_CHANNEL_ID || '1528917189699043439',
    trainingResults: process.env.TRAINING_RESULTS_CHANNEL_ID || '1526490481398124614',
    infractionParent: process.env.INFRACTION_PARENT_CHANNEL_ID || '1526044664975851642',
    staffFeedback: process.env.STAFF_FEEDBACK_CHANNEL_ID || '1526041844515868745',
    partnershipRequests: process.env.PARTNERSHIP_REQUEST_CHANNEL_ID || '1527122924975165530',
    staffComplaints: process.env.STAFF_COMPLAINT_CHANNEL_ID || '1527139806797369504',
    promotions: process.env.PROMOTION_CHANNEL_ID || '1526044978109743255',
    movieFeedback: process.env.MOVIE_FEEDBACK_CHANNEL_ID || '1528933044310904884',
    privateAudit: process.env.PRIVATE_AUDIT_LOG_CHANNEL_ID || process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || '1528917592604020917',
} as const;

export const PARTNERSHIP_ROLE_ID = process.env.PARTNERSHIP_ROLE_ID || '1521593407783440394';

const CSRP_GUILD_ID = process.env.GUILD_ID || '1521593407741362257';

export const SUPPORT_LINKS = {
    rules: `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.rules}`,
    paidPartner: `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.paidPartner}`,
    officialErlcCommunityGuidelines: 'https://support.policeroleplay.community/hc/en-us/articles/33683178225300-PRC-Community-Guidelines',
} as const;

export const TICKET_CATEGORY_IDS = {
    general: process.env.GENERAL_SUPPORT_CATEGORY_ID || '1526254341646712883',
    internal: process.env.INTERNAL_AFFAIRS_CATEGORY_ID || '1526254402426503320',
    management: process.env.MANAGEMENT_CATEGORY_ID || '1526254462128099479',
    highrank: process.env.HIGH_RANK_CATEGORY_ID || '1526254518570844231',
} as const;

export const SUPPORT_ROLE_IDS = {
    general: process.env.GENERAL_SUPPORT_ROLE_ID || '1523122697746382868',
    internal: process.env.INTERNAL_AFFAIRS_ROLE_ID || '1523122834161926238',
    management: process.env.MANAGEMENT_ROLE_ID || '1523122912201277590',
    highrank: process.env.HIGH_RANK_ROLE_ID || '1527845170748326021',
} as const;

export type TicketCategory = keyof typeof TICKET_CATEGORY_IDS;
