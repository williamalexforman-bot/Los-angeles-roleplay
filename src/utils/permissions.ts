import { GuildMember, PermissionsString, PermissionFlagsBits } from 'discord.js';
import config from '../config/env';

const permissionHierarchy: { [key: string]: number } = {
    'Foundership': 10,
    'Founder': 10,
    'Directive': 9,
    'High Rank': 8,
    'General Support': 8,
    'Lead Management': 8,
    'Head Management': 7,
    'Senior Management': 6,
    'Junior Management': 5,
    'Trial Management': 4,
    'Management': 4,
    'Head Internal Affairs': 8,
    'Lead Internal Affairs': 7,
    'Senior Internal Affairs': 6,
    'Junior Internal Affairs': 5,
    'Trial Internal Affairs': 4,
    'Internal Affairs': 4,
    'IA': 4,
    'Head Administrator': 8,
    'Lead Administrator': 7,
    'Senior Administrator': 6,
    'Junior Administrator': 5,
    'Trial Administrator': 4,
    'Administrator': 4,
    'Admin': 4,
    'Head Moderator': 8,
    'Lead Moderator': 7,
    'Senior Moderator': 6,
    'Junior Moderator': 5,
    'Trial Moderator': 4,
    'Moderator': 4,
    'Mod': 4,
    'Moderation Team': 4,
    'Staff Team': 3,
    'CSRP | Staff Team': 3,
};

const configuredRoleIds: { [key: string]: string | undefined } = {
    'High Rank': config.HIGH_RANK_ROLE_ID,
    'General Support': config.GENERAL_SUPPORT_ROLE_ID,
    'Management': config.MANAGEMENT_ROLE_ID,
    'Internal Affairs': config.INTERNAL_AFFAIRS_ROLE_ID,
    'Support': config.SUPPORT_ROLE_ID,
    'Admin': config.ADMIN_ROLE_ID,
};

const requiredRoleAliases: Record<string, readonly string[]> = {
    'Staff Team': ['Staff Team', 'CSRP | Staff Team', 'California State Roleplay | Staff Team'],
    'Moderator': ['Moderator', 'Mod', 'Moderation Team', 'CSRP | Moderator', 'CSRP | Moderation Team'],
    'Mod': ['Moderator', 'Mod', 'Moderation Team', 'CSRP | Moderator', 'CSRP | Moderation Team'],
    'Admin': ['Administrator', 'Admin', 'Administration Team', 'CSRP | Administrator', 'CSRP | Administration Team'],
    'Administrator': ['Administrator', 'Admin', 'Administration Team', 'CSRP | Administrator', 'CSRP | Administration Team'],
    'Internal Affairs': ['Internal Affairs', 'IA', 'Internal Affairs Team', 'CSRP | Internal Affairs'],
    'IA': ['Internal Affairs', 'IA', 'Internal Affairs Team', 'CSRP | Internal Affairs'],
    'Management': ['Management', 'Management Team', 'MGMT', 'CSRP | Management'],
    'Directive': ['Directive', 'Directive Team', 'CSRP | Directive'],
    'Foundership': ['Foundership', 'Founder', 'Founder Team', 'CSRP | Foundership', 'CSRP | Founder'],
    'Founder': ['Foundership', 'Founder', 'Founder Team', 'CSRP | Foundership', 'CSRP | Founder'],
};

function normalizeRoleName(name: string): string {
    return name.trim().toLowerCase();
}

function hasNamedAlias(member: GuildMember, requiredRole: string): boolean {
    const aliases = requiredRoleAliases[requiredRole];
    if (!aliases) return false;

    const wanted = new Set(aliases.map(normalizeRoleName));
    return member.roles.cache.some(role => wanted.has(normalizeRoleName(role.name)));
}

function hasResolvedRoleId(member: GuildMember, requiredRole: string): boolean {
    const keyMap: Record<string, string> = {
        'Staff Team': 'staffTeam',
        'Moderator': 'moderator',
        'Mod': 'moderator',
        'Admin': 'administrator',
        'Administrator': 'administrator',
        'Internal Affairs': 'internalAffairs',
        'IA': 'internalAffairs',
        'Management': 'management',
        'Directive': 'directive',
        'Foundership': 'foundership',
        'Founder': 'foundership',
    };

    const roleKey = keyMap[requiredRole];
    if (!roleKey) return false;
    const resolvedRoleId = (globalThis as any).__serverRoleIdsByKey?.[member.guild.id]?.[roleKey];
    return Boolean(resolvedRoleId && member.roles.cache.has(resolvedRoleId));
}

export function hasPermission(member: GuildMember, requiredRole: string): boolean {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

    // First prefer AutoFinder's live role ID, then exact role-name aliases.
    if (hasResolvedRoleId(member, requiredRole) || hasNamedAlias(member, requiredRole)) {
        return true;
    }

    // Keep environment-configured IDs as a backwards-compatible fallback.
    const configuredRoleId = configuredRoleIds[requiredRole];
    if (configuredRoleId && member.roles.cache.has(configuredRoleId)) {
        return true;
    }

    const memberRoles = member.roles.cache.map(role => role.name);
    const memberHighestRole = memberRoles.reduce((highest, role) => {
        return (permissionHierarchy[role] ?? 0) > (permissionHierarchy[highest] ?? 0) ? role : highest;
    }, '');

    const requiredLevel = permissionHierarchy[requiredRole];
    return requiredLevel !== undefined && (permissionHierarchy[memberHighestRole] ?? 0) >= requiredLevel;
}

export function checkPermissions(member: GuildMember, requiredPermissions: PermissionsString[]): boolean {
    return requiredPermissions.every(permission => member.permissions.has(permission));
}
