import type { Client, Guild, GuildBasedChannel, Role } from 'discord.js';

type ResourceKind = 'channel' | 'role';

type ResolveOptions = {
  required?: boolean;
  exact?: boolean;
};

type GuildCache = {
  channelsByName: Map<string, GuildBasedChannel[]>;
  rolesByName: Map<string, Role[]>;
  refreshedAt: number;
};

const caches = new Map<string, GuildCache>();
let registeredClient: Client | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function describeMatches(kind: ResourceKind, name: string, ids: string[]): string {
  return `[AutoFinder] Duplicate ${kind} name "${name}" matched ${ids.length} items: ${ids.join(', ')}`;
}

async function buildGuildCache(guild: Guild): Promise<GuildCache> {
  // Fetch from Discord instead of trusting only the local cache. This keeps the
  // resolver correct after restarts and after channels/roles are recreated.
  await Promise.allSettled([
    guild.channels.fetch(),
    guild.roles.fetch(),
  ]);

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

  const result: GuildCache = {
    channelsByName,
    rolesByName,
    refreshedAt: Date.now(),
  };
  caches.set(guild.id, result);

  console.log(
    `[AutoFinder] Indexed ${guild.channels.cache.size} channels and ${guild.roles.cache.size} roles for ${guild.name} (${guild.id}).`,
  );

  return result;
}

export async function refreshGuildResources(guild: Guild): Promise<void> {
  try {
    await buildGuildCache(guild);
  } catch (error: any) {
    console.error(
      `[AutoFinder] Failed to refresh resources for ${guild.name} (${guild.id}):`,
      error?.stack || error?.message || String(error),
    );
  }
}

async function getGuildCache(guild: Guild): Promise<GuildCache> {
  return caches.get(guild.id) ?? buildGuildCache(guild);
}

export async function findChannelByName(
  guild: Guild,
  name: string,
  options: ResolveOptions = {},
): Promise<GuildBasedChannel | null> {
  const { required = false, exact = true } = options;
  const cache = await getGuildCache(guild);
  const wanted = normalizeName(name);

  let matches: GuildBasedChannel[] = [];
  if (exact) {
    matches = cache.channelsByName.get(wanted) ?? [];
  } else {
    for (const [key, channels] of cache.channelsByName.entries()) {
      if (key.includes(wanted)) matches.push(...channels);
    }
  }

  if (matches.length > 1) {
    console.warn(describeMatches('channel', name, matches.map(item => item.id)));
    return null;
  }

  if (matches.length === 0) {
    const message = `[AutoFinder] Channel not found: "${name}" in ${guild.name} (${guild.id}).`;
    if (required) throw new Error(message);
    console.warn(message);
    return null;
  }

  return matches[0];
}

export async function findRoleByName(
  guild: Guild,
  name: string,
  options: ResolveOptions = {},
): Promise<Role | null> {
  const { required = false, exact = true } = options;
  const cache = await getGuildCache(guild);
  const wanted = normalizeName(name);

  let matches: Role[] = [];
  if (exact) {
    matches = cache.rolesByName.get(wanted) ?? [];
  } else {
    for (const [key, roles] of cache.rolesByName.entries()) {
      if (key.includes(wanted)) matches.push(...roles);
    }
  }

  if (matches.length > 1) {
    console.warn(describeMatches('role', name, matches.map(item => item.id)));
    return null;
  }

  if (matches.length === 0) {
    const message = `[AutoFinder] Role not found: "${name}" in ${guild.name} (${guild.id}).`;
    if (required) throw new Error(message);
    console.warn(message);
    return null;
  }

  return matches[0];
}

export async function findChannelIdByName(
  guild: Guild,
  name: string,
  options: ResolveOptions = {},
): Promise<string | null> {
  return (await findChannelByName(guild, name, options))?.id ?? null;
}

export async function findRoleIdByName(
  guild: Guild,
  name: string,
  options: ResolveOptions = {},
): Promise<string | null> {
  return (await findRoleByName(guild, name, options))?.id ?? null;
}

export async function memberHasRoleByName(
  guild: Guild,
  memberRoleIds: Iterable<string>,
  roleName: string,
): Promise<boolean> {
  const role = await findRoleByName(guild, roleName);
  if (!role) return false;
  return new Set(memberRoleIds).has(role.id);
}

function scheduleRefresh(guild: Guild, reason: string): void {
  // Discord can emit several events during channel/category or role changes.
  // Debouncing prevents unnecessary REST requests while still refreshing fast.
  const key = `__autofinder_${guild.id}`;
  const state = globalThis as any;
  if (state[key]) clearTimeout(state[key]);
  state[key] = setTimeout(() => {
    delete state[key];
    void refreshGuildResources(guild).then(() => {
      console.log(`[AutoFinder] Refreshed ${guild.name} after ${reason}.`);
    });
  }, 750);
  state[key].unref?.();
}

export async function registerServerResourceResolver(client: Client): Promise<void> {
  if (registeredClient === client) return;
  registeredClient = client;

  // Make the resolver accessible to legacy command files while they are migrated.
  (client as any).serverResourceResolver = {
    refreshGuildResources,
    findChannelByName,
    findRoleByName,
    findChannelIdByName,
    findRoleIdByName,
    memberHasRoleByName,
  };

  for (const guild of client.guilds.cache.values()) {
    await refreshGuildResources(guild);
  }

  client.on('guildCreate', guild => void refreshGuildResources(guild));
  client.on('channelCreate', channel => {
    if (channel.guild) scheduleRefresh(channel.guild, 'channelCreate');
  });
  client.on('channelUpdate', (_oldChannel, newChannel) => {
    if (newChannel.guild) scheduleRefresh(newChannel.guild, 'channelUpdate');
  });
  client.on('channelDelete', channel => {
    if (channel.guild) scheduleRefresh(channel.guild, 'channelDelete');
  });
  client.on('roleCreate', role => scheduleRefresh(role.guild, 'roleCreate'));
  client.on('roleUpdate', (_oldRole, newRole) => scheduleRefresh(newRole.guild, 'roleUpdate'));
  client.on('roleDelete', role => scheduleRefresh(role.guild, 'roleDelete'));

  // Periodic safety refresh catches changes missed during gateway reconnects.
  refreshTimer = setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      void refreshGuildResources(guild);
    }
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
