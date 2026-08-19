import path from 'path';

export const BRAND = {
    name: 'Los Angeles Roleplay',
    color: 0x247BF1 as number,
    footer: 'Los Angeles Roleplay | Realism at its Finest',
    panelFooter: 'Realism at its Finest',
    logoName: 'larp-logo.png',
    logoPath: path.resolve(process.cwd(), 'assets', 'larp-logo.png'),
    logoUrl: 'attachment://larp-logo.png',
} as const;

export const CHANNEL_IDS = {
    rules: process.env.CSRP_RULES_CHANNEL_ID || '1526046592187105421',
    paidPartner: process.env.PAID_PARTNER_CHANNEL_ID || '1526035127606706196',
    profanityLog: process.env.PROFANITY_LOG_CHANNEL_ID || '1529289318152274000',
    erlcCommandLog: process.env.ERLC_COMMAND_LOG_CHANNEL_ID || '1528907187081183252',
    raidThreatLog: process.env.RAID_THREAT_LOG_CHANNEL_ID || '1529287167203872838',
    discordCommandLog: process.env.DISCORD_COMMAND_LOG_CHANNEL_ID || '1528917592604020917',
    erlcTeamChangeLog: process.env.ERLC_TEAM_CHANGE_LOG_CHANNEL_ID || '1528917232153923635',
    erlcPunishmentLog: process.env.ERLC_PUNISHMENT_LOG_CHANNEL_ID || '1528917189699043439',
    sessionAnnouncements: process.env.SESSION_ANNOUNCEMENT_CHANNEL_ID || '1526036392147423404',
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
export const SESSION_START_AUTHORIZED_ROLE_ID = '1521593407804280963';
export const INFRACTION_AUTHORIZED_ROLE_ID = '1523121675007426692';
export const PROMOTION_AUTHORIZED_ROLE_ID = '1523121617079767151';
export const TRAINING_RESULTS_AUTHORIZED_ROLE_ID = '1521593407795888330';

const CSRP_GUILD_ID = process.env.GUILD_ID || '1521593407741362257';

export const SUPPORT_LINKS = {
    rules: `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.rules}`,
    paidPartner: `https://discord.com/channels/${CSRP_GUILD_ID}/${CHANNEL_IDS.paidPartner}`,
    officialErlcCommunityGuidelines: 'https://support.policeroleplay.community/hc/en-us/articles/33683178225300-PRC-Community-Guidelines',
} as const;
