import { Message, PermissionFlagsBits } from 'discord.js';
import { postPanelFromMessage, runSessionActionFromMessage } from './panels';
import type { SessionLifecycleStatus } from '../services/panelConfig';
import { postTicketPanelFromMessage } from './tickets';
import { configuredRoleId } from '../services/panelConfig';

async function canUsePrefix(message: Message): Promise<boolean> {
    if (!message.guild || !message.member) return false;
    if (message.guild.ownerId === message.author.id || message.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const roleId = await configuredRoleId(message.guild, 'bot_permissions', process.env.BOT_PERMISSIONS_ROLE_ID || '');
    return Boolean(roleId && message.member.roles.cache.has(roleId));
}

async function canUseSessionPrefix(message: Message): Promise<boolean> {
    if (!message.guild || !message.member) return false;
    if (message.guild.ownerId === message.author.id || message.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const allowedRoles = await Promise.all([
        configuredRoleId(message.guild, 'session_host'),
        configuredRoleId(message.guild, 'staff'),
        configuredRoleId(message.guild, 'bot_permissions', process.env.BOT_PERMISSIONS_ROLE_ID || ''),
    ]);
    return allowedRoles.some(roleId => roleId && message.member?.roles.cache.has(roleId));
}

export async function handlePrefixCommand(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot || !message.content.startsWith('-')) return false;
    if (!message.channel.isSendable()) return false;
    const [rawCommand, ...parts] = message.content.slice(1).trim().split(/\s+/);
    const command = rawCommand.toLowerCase();
    const panelCommands: Record<string, 'dashboard' | 'regulations' | 'session' | 'application'> = {
        dashboard: 'dashboard', dashboardpanel: 'dashboard',
        regulations: 'regulations', regulationspanel: 'regulations',
        sessionpanel: 'session', session: 'session',
        applicationpanel: 'application', applications: 'application',
    };
    const sessionCommands: Record<string, SessionLifecycleStatus> = {
        sessionstart: 'online', 'session-start': 'online',
        sessionend: 'offline', 'session-end': 'offline',
        sessionvote: 'voting', 'session-vote': 'voting',
        sessionboost: 'boosted', 'session-boost': 'boosted',
    };
    const recognized = command === 'say' || command === 'ticketpanel' || command === 'ticket-panel'
        || command in panelCommands || command in sessionCommands;
    if (!recognized) return false;
    const allowed = command in sessionCommands ? await canUseSessionPrefix(message) : await canUsePrefix(message);
    if (!allowed) {
        await message.reply(command in sessionCommands
            ? 'You need the configured Session Host, Staff, or bot-permissions role to use that session command.'
            : 'You need the configured bot-permissions role or Administrator permission to use that prefix command.');
        return true;
    }
    if (command === 'say') {
        const content = parts.join(' ').trim();
        if (!content) { await message.reply('Use `-say <message>`.'); return true; }
        await message.channel.send({ content, allowedMentions: { parse: [] } });
        await message.delete().catch(() => undefined);
        return true;
    }
    if (command in sessionCommands) await runSessionActionFromMessage(message, sessionCommands[command]);
    else if (command === 'ticketpanel' || command === 'ticket-panel') await postTicketPanelFromMessage(message);
    else await postPanelFromMessage(message, panelCommands[command]);
    await message.delete().catch(() => undefined);
    return true;
}
