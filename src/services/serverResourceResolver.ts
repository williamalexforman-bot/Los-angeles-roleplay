import type { Client, Guild, GuildBasedChannel, Role } from 'discord.js';

type ResourceKind = 'channel' | 'role';
type ResolveOptions = { required?: boolean; exact?: boolean };
type GuildCache = {
  channelsByName: Map<string, GuildBasedChannel[]>;
  rolesByName: Map<string, Role[]>;
  refreshedAt: number;
};

const caches = new Map<string, GuildCache>();
let registeredClient: Client | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

export const STAFF_ROLE_ALIASES = {
  staffTeam: ['Staff Team', 'CSRP | Staff Team', 'California State Roleplay | Staff Team'],
  moderator: ['Moderator', 'Mod', 'Moderation Team', 'CSRP | Moderator', 'CSRP | Moderation Team'],
  administrator: ['Administrator', 'Admin', 'Administration Team', 'CSRP | Administrator', 'CSRP | Administration Team'],
  internalAffairs: ['Internal Affairs', 'IA', 'Internal Affairs Team', 'CSRP | Internal Affairs'],
  management: ['Management', 'Management Team', 'MGMT', 'CSRP | Management'],
  highRank: ['High Rank', 'High Rank Team', 'HR', 'CSRP | High Rank', 'California State Roleplay | High Rank'],
  directive: ['Directive', 'Directive Team', 'CSRP | Directive'],
  foundership: ['Foundership', 'Founder', 'Founder Team', 'CSRP | Foundership', 'CSRP | Founder'],
} as const;

export const CHANNEL_ALIASES = {
  dashboard: ['dashboard', 'server-dashboard', 'staff-dashboard'],
  assistance: ['assistance', 'support', 'tickets', 'ticket-panel', 'support-panel'],
  ticketPanel: ['ticket-panel', 'tickets', 'support-panel', 'assistance'],
  generalSupportTickets: ['general-support', 'general-support-tickets', 'support-tickets'],
  highRankTickets: ['high-rank', 'high-rank-tickets', 'hr-tickets'],
  internalAffairsTickets: ['internal-affairs', 'internal-affairs-tickets', 'ia-tickets'],
  rules: ['rules', 'server-rules', 'information-rules'],
  applications: ['applications', 'application', 'application-panel'],
  marketplace: ['marketplace', 'market-place', 'shop'],
  paidPartner: ['paid-ad', 'paid-ads', 'paid-advertisement', 'advertisements'],
  paidAds: ['paid-ad', 'paid-ads', 'paid-advertisement', 'advertisements'],
  partnershipRequests: ['partnership', 'partnerships', 'partnership-requests'],
  sessionAnnouncements: ['session', 'sessions', 'session-announcements', 'session-information'],
  trainingResults: ['training-results', 'training-result', 'training-logs'],
  trainingRequests: ['training-request', 'training-requests', 'request-training'],
  infractionParent: ['infraction', 'infractions', 'infraction-logs', 'staff-infractions'],
  promotions: ['promotion', 'promotions', 'promotion-logs'],
  profanityLog: ['profanity-logs', 'profanity-log', 'message-moderation-logs', 'chat-logs'],
  erlcCommandLog: ['erlc-command-logs', 'erlc-commands', 'game-command-logs', 'in-game-command-logs'],
  raidThreatLog: ['raid-threat-logs', 'raid-logs', 'raid-alerts'],
  discordCommandLog: ['discord-command-logs', 'command-logs', 'bot-command-logs'],
  erlcTeamChangeLog: ['erlc-team-change-logs', 'team-change-logs', 'team-logs'],
  erlcPunishmentLog: ['erlc-punishment-logs', 'punishment-logs', 'moderation-logs'],
  staffFeedback: ['staff-feedback', 'feedback'],
  staffComplaints: ['staff-complaints', 'internal-affairs', 'ia-reports'],
  movieFeedback: ['movie-feedback'],
  suggestions: ['suggestions', 'server-suggestions'],
  giveaways: ['giveaways', 'giveaway'],
  memberJoinLog: ['member-join-logs', 'join-logs', 'member-logs'],
  privateAudit: ['private-audit', 'audit-logs', 'staff-audit-logs', 'discord-command-logs', 'command-logs'],
} as const;

type StaffRoleKey = keyof typeof STAFF_ROLE_ALIASES;
type ChannelKey = keyof typeof CHANNEL_ALIASES;

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[│┃｜|]/g, ' ').replace(/[・•·]/g, ' ').replace(/[_\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function describeMatches(kind: ResourceKind, name: string, ids: string[]): string {
  return `[AutoFinder] Duplicate ${kind} name "${name}" matched ${ids.length} items: ${ids.join(', ')}`;
}

function findUniqueByAliases<T>(map: Map<string, T[]>, aliases: readonly string[], kind: ResourceKind, label: string): T | null {
  const matches = new Map<string, T>();
  for (const alias of aliases) {
    const exactItems = map.get(normalizeName(alias)) ?? [];
    for (const item of exactItems) {
      const id = (item as any)?.id;
      if (id) matches.set(id, item);
    }
  }
  if (matches.size === 0) {
    for (const [name, items] of map.entries()) {
      const related = aliases.some(alias => {
        const a = normalizeName(alias);
        return name === a || name.includes(a) || a.includes(name);
      });
      if (!related) continue;
      for (const item of items) {
        const id = (item as any)?.id;
        if (id) matches.set(id, item);
      }
    }
  }
  if (matches.size > 1) {
    console.warn(describeMatches(kind, label, [...matches.keys()]));
    return null;
  }
  return matches.values().next().value ?? null;
}

async function buildGuildCache(guild: Guild): Promise<GuildCache> {
  await Promise.allSettled([guild.channels.fetch(), guild.roles.fetch()]);

  const channelsByName = new Map<string, GuildBasedChannel[]>();
  for (const channel of guild.channels.cache.values()) {
    const key = normalizeName(channel.name);
    const current = channelsByName.get(key) ?? [];
    current.push(channel);
    channelsByName.set(key, current);
  }

  const rolesByName = new Map<string, Role[]>();
  for (const role of guild.roles.cache.values()) {
    const key = normalizeName(role.name);
    const current = rolesByName.get(key) ?? [];
    current.push(role);
    rolesByName.set(key, current);
  }

  const result: GuildCache = { channelsByName, rolesByName, refreshedAt: Date.now() };
  caches.set(guild.id, result);

  const dynamicChannelIds: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(CHANNEL_ALIASES)) {
    const channel = findUniqueByAliases(channelsByName, aliases, 'channel', key) as GuildBasedChannel | null;
    if (channel) dynamicChannelIds[key] = channel.id;
  }

  const dynamicRoleIds: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(STAFF_ROLE_ALIASES)) {
    const role = findUniqueByAliases(rolesByName, aliases, 'role', key) as Role | null;
    if (role) dynamicRoleIds[key] = role.id;
  }

  const globalState = globalThis as any;
  globalState.__serverChannelIdsByKey ??= {};
  globalState.__serverRoleIdsByKey ??= {};
  globalState.__serverChannelIdsByKey[guild.id] = dynamicChannelIds;
  globalState.__serverRoleIdsByKey[guild.id] = dynamicRoleIds;
  globalState.__primaryGuildId ??= guild.id;
  globalState.__autoFinderReady = true;

  console.log(`[AutoFinder] Indexed ${guild.channels.cache.size} channels and ${guild.roles.cache.size} roles for ${guild.name} (${guild.id}).`);
  console.log(`[AutoFinder] Resolved ${Object.keys(dynamicChannelIds).length}/${Object.keys(CHANNEL_ALIASES).length} configured channel keys and ${Object.keys(dynamicRoleIds).length}/${Object.keys(STAFF_ROLE_ALIASES).length} staff-role keys.`);
  return result;
}

export async function refreshGuildResources(guild: Guild): Promise<void> {
  try { await buildGuildCache(guild); }
  catch (error: any) { console.error(`[AutoFinder] Failed to refresh resources for ${guild.name} (${guild.id}):`, error?.stack || error?.message || String(error)); }
}

async function getGuildCache(guild: Guild): Promise<GuildCache> {
  return caches.get(guild.id) ?? buildGuildCache(guild);
}

export async function findChannelByName(guild: Guild, name: string, options: ResolveOptions = {}): Promise<GuildBasedChannel | null> {
  const { required = false, exact = true } = options;
  const cache = await getGuildCache(guild);
  const wanted = normalizeName(name);
  let matches: GuildBasedChannel[] = [];
  if (exact) matches = cache.channelsByName.get(wanted) ?? [];
  else for (const [key, channels] of cache.channelsByName.entries()) if (key.includes(wanted)) matches.push(...channels);
  if (matches.length > 1) { console.warn(describeMatches('channel', name, matches.map(item => item.id))); return null; }
  if (matches.length === 0) {
    const message = `[AutoFinder] Channel not found: "${name}" in ${guild.name} (${guild.id}).`;
    if (required) throw new Error(message);
    console.warn(message);
    return null;
  }
  return matches[0];
}

export async function findRoleByName(guild: Guild, name: string, options: ResolveOptions = {}): Promise<Role | null> {
  const { required = false, exact = true } = options;
  const cache = await getGuildCache(guild);
  const wanted = normalizeName(name);
  let matches: Role[] = [];
  if (exact) matches = cache.rolesByName.get(wanted) ?? [];
  else for (const [key, roles] of cache.rolesByName.entries()) if (key.includes(wanted)) matches.push(...roles);
  if (matches.length > 1) { console.warn(describeMatches('role', name, matches.map(item => item.id))); return null; }
  if (matches.length === 0) {
    const message = `[AutoFinder] Role not found: "${name}" in ${guild.name} (${guild.id}).`;
    if (required) throw new Error(message);
    console.warn(message);
    return null;
  }
  return matches[0];
}

export async function findStaffRole(guild: Guild, key: StaffRoleKey): Promise<Role | null> {
  const cache = await getGuildCache(guild);
  return findUniqueByAliases(cache.rolesByName, STAFF_ROLE_ALIASES[key], 'role', key) as Role | null;
}

export async function findChannelByKey(guild: Guild, key: ChannelKey): Promise<GuildBasedChannel | null> {
  const cache = await getGuildCache(guild);
  return findUniqueByAliases(cache.channelsByName, CHANNEL_ALIASES[key], 'channel', key) as GuildBasedChannel | null;
}

export async function findChannelIdByName(guild: Guild, name: string, options: ResolveOptions = {}): Promise<string | null> {
  return (await findChannelByName(guild, name, options))?.id ?? null;
}

export async function findRoleIdByName(guild: Guild, name: string, options: ResolveOptions = {}): Promise<string | null> {
  return (await findRoleByName(guild, name, options))?.id ?? null;
}

export async function memberHasRoleByName(guild: Guild, memberRoleIds: Iterable<string>, roleName: string): Promise<boolean> {
  const role = await findRoleByName(guild, roleName);
  if (!role) return false;
  return new Set(memberRoleIds).has(role.id);
}

export function memberHasStaffRole(memberRoleIds: Iterable<string>, guildId: string, key: StaffRoleKey): boolean {
  const id = (globalThis as any).__serverRoleIdsByKey?.[guildId]?.[key];
  return Boolean(id && new Set(memberRoleIds).has(id));
}

function scheduleRefresh(guild: Guild, reason: string): void {
  const key = `__autofinder_${guild.id}`;
  const state = globalThis as any;
  if (state[key]) clearTimeout(state[key]);
  state[key] = setTimeout(() => {
    delete state[key];
    void refreshGuildResources(guild).then(() => console.log(`[AutoFinder] Refreshed ${guild.name} after ${reason}.`));
  }, 750);
  state[key].unref?.();
}

export async function registerServerResourceResolver(client: Client): Promise<void> {
  if (registeredClient === client) return;
  registeredClient = client;
  (client as any).serverResourceResolver = {
    refreshGuildResources, findChannelByName, findRoleByName, findChannelByKey, findStaffRole,
    findChannelIdByName, findRoleIdByName, memberHasRoleByName, memberHasStaffRole,
    STAFF_ROLE_ALIASES, CHANNEL_ALIASES,
  };
  for (const guild of client.guilds.cache.values()) await refreshGuildResources(guild);
  client.on('guildCreate', guild => void refreshGuildResources(guild));
  client.on('channelCreate', channel => { if (channel.guild) scheduleRefresh(channel.guild, 'channelCreate'); });
  client.on('channelUpdate', (_oldChannel, newChannel) => { if (newChannel.guild) scheduleRefresh(newChannel.guild, 'channelUpdate'); });
  client.on('channelDelete', channel => { if (channel.guild) scheduleRefresh(channel.guild, 'channelDelete'); });
  client.on('roleCreate', role => scheduleRefresh(role.guild, 'roleCreate'));
  client.on('roleUpdate', (_oldRole, newRole) => scheduleRefresh(newRole.guild, 'roleUpdate'));
  client.on('roleDelete', role => scheduleRefresh(role.guild, 'roleDelete'));
  refreshTimer = setInterval(() => {
    for (const guild of client.guilds.cache.values()) void refreshGuildResources(guild);
  }, 15 * 60 * 1000);
  refreshTimer.unref?.();
  console.log('[AutoFinder] Automatic channel and role discovery is active.');
}

export function stopServerResourceResolver(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  caches.clear();
  registeredClient = null;
}
