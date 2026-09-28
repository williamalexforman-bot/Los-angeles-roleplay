import { GuildMember, PermissionsString, PermissionFlagsBits } from 'discord.js';
import config from '../config/env';

const permissionHierarchy: { [key: string]: number } = {
    'Founder': 10,
    'Directive': 9,
    'High Rank': 8,
    'General Support': 8,
    'Lead Management': 8,
    'Head Management': 7,
    'Senior Management': 6,
    'Junior Management': 5,
    'Trial Management': 4,
    'Head Internal Affairs': 8,
    'Lead Internal Affairs': 7,
    'Senior Internal Affairs': 6,
    'Junior Internal Affairs': 5,
    'Trial Internal Affairs': 4,
    'Head Administrator': 8,
    'Lead Administrator': 7,
    'Senior Administrator': 6,
    'Junior Administrator': 5,
    'Trial Administrator': 4,
    'Head Moderator': 8,
    'Lead Moderator': 7,
    'Senior Moderator': 6,
    'Junior Moderator': 5,
    'Trial Moderator': 4,
};

const configuredRoleIds: { [key: string]: string | undefined } = {
    'High Rank': config.HIGH_RANK_ROLE_ID,
    'General Support': config.GENERAL_SUPPORT_ROLE_ID,
    'Management': config.MANAGEMENT_ROLE_ID,
    'Internal Affairs': config.INTERNAL_AFFAIRS_ROLE_ID,
    'Support': config.SUPPORT_ROLE_ID,
    'Admin': config.ADMIN_ROLE_ID,
};

export function hasPermission(member: GuildMember, requiredRole: string): boolean {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const configuredRoleId = configuredRoleIds[requiredRole];
    if (configuredRoleId && member.roles.cache.some(role => role.id === configuredRoleId)) {
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
