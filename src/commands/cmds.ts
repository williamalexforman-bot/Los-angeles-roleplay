import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { BRAND } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';

interface CommandEntry {
    name: string;
    description: string;
    category: string;
}

const COMMANDS: CommandEntry[] = [
    // ── Moderation ──
    { name: '/warn', description: 'Issue a warning to a user with a reason and optional proof', category: 'Moderation' },
    { name: '/kick', description: 'Kick a user from the server with a reason', category: 'Moderation' },
    { name: '/ban', description: 'Ban a user from the server with a reason', category: 'Moderation' },
    { name: '/timeout', description: 'Timeout a user for a specified duration (seconds)', category: 'Moderation' },
    { name: '/purge', description: 'Bulk delete a specified number of messages', category: 'Moderation' },
    { name: '/lock', description: 'Lock the current channel to prevent messages', category: 'Moderation' },
    { name: '/unlock', description: 'Unlock the current channel to allow messages', category: 'Moderation' },
    { name: '/slowmode', description: 'Set slowmode duration (seconds) for the current channel', category: 'Moderation' },
    { name: '/punish', description: 'Punish a user (warn/kick/ban) with a case number and DM notification', category: 'Moderation' },
    { name: '/punishment view', description: 'View punishment history for a user', category: 'Moderation' },
    { name: '/punishment remove', description: 'Remove/void a punishment by case number', category: 'Moderation' },

    // ── Admin ──
    { name: '/admin role-add', description: 'Add a role to a user', category: 'Admin' },
    { name: '/admin role-remove', description: 'Remove a role from a user', category: 'Admin' },
    { name: '/role add', description: 'Add a selected role to one member (Manage Roles required)', category: 'Admin' },
    { name: '/role all', description: 'Add a selected role to every non-bot member (Manage Roles required)', category: 'Admin' },
    { name: '/shift start', description: 'Start tracking your staff shift', category: 'Staff Management' },
    { name: '/shift break', description: 'Pause or resume your staff shift without counting break time', category: 'Staff Management' },
    { name: '/shift end', description: 'End your shift and update weekly quota time', category: 'Staff Management' },
    { name: '/shift leaderboard', description: 'View the current weekly shift leaderboard', category: 'Staff Management' },
    { name: '/shift manage', description: 'Adjust or force-end a staff member\'s shift', category: 'Staff Management' },
    { name: '/view quota', description: 'Privately view your weekly quota progress and shift status', category: 'Staff Management' },
    { name: '/admin staff-list', description: 'Display a list of all staff members', category: 'Admin' },
    { name: '/say', description: 'Make the bot say a message in a specified channel', category: 'Admin' },
    { name: '/prohibited-word', description: 'Manage prohibited words (add/remove/list) for auto-moderation', category: 'Admin' },

    // ── Staff Management ──
    { name: '/infraction issue', description: 'Issue a new staff infraction with evidence thread', category: 'Staff Management' },
    { name: '/promotion issue', description: 'Issue and publish a staff promotion', category: 'Staff Management' },
    { name: '/training-results', description: 'Publish a completed staff training result with scores', category: 'Staff Management' },
    { name: '/application', description: 'Start or review a staff application', category: 'Staff Management' },
    { name: '/applications-panel', description: 'Post the V2 application panel and DM questionnaires', category: 'Staff Management' },
    { name: '/training', description: 'Manage a training request for a user', category: 'Staff Management' },
    { name: '/training-result', description: 'Post an authorized legacy/manual training result', category: 'Staff Management' },

    // ── Community ──
    { name: '/movie-feedback', description: 'Submit feedback about a movie with rating (1-10)', category: 'Community' },
    { name: '/staff-feedback', description: 'Submit feedback about a staff member with rating', category: 'Community' },
    { name: '/partnership request', description: 'Post the professional partnership request panel', category: 'Community' },
    { name: '/staff-complaint', description: 'Submit a private complaint about a staff member', category: 'Community' },

    // ── Game ──
    { name: '/teamswitch', description: 'Submit an authorized manual ER:LC team-switch report', category: 'Game' },

    // ── Utility ──
    { name: '/cmds', description: 'Show this list of all available commands and their descriptions', category: 'Utility' },
    { name: '/roleplay-log', description: 'Log a roleplay session with details', category: 'Utility' },
    { name: '/activitycheck start', description: 'Start a staff activity check', category: 'Utility' },
    { name: '/activitycheck view', description: 'View activity check results', category: 'Utility' },
    { name: '/activitycheck end', description: 'End the current activity check', category: 'Utility' },
    { name: '/request-training', description: 'Request a training session (Training Dept only)', category: 'Utility' },
    { name: '/view-infractions', description: 'View your own infraction count and history', category: 'Utility' },
    { name: '/rename', description: 'Rename a channel (emoji allowed)', category: 'Utility' },
    { name: '/ticket panel', description: 'Post the V2 support-ticket panel in its configured channel', category: 'Utility' },
    { name: '/ticket-panel', description: 'Legacy alias for /ticket panel', category: 'Utility' },
    { name: '/ticketpanel', description: 'Compatibility alias for /ticket panel', category: 'Utility' },
    { name: '/close', description: 'Close the current support ticket and save its transcript', category: 'Utility' },
    { name: '/closerequest', description: 'Ask the ticket opener to approve closing a support ticket', category: 'Utility' },
    { name: '/unclaim', description: 'Unclaim the current support ticket and restore its claim button', category: 'Utility' },
];

const CATEGORY_ORDER = ['Moderation', 'Admin', 'Staff Management', 'Community', 'Game', 'Utility'];
const CATEGORY_EMOJIS: Record<string, string> = {
    'Moderation': '🛡️',
    'Admin': '⚙️',
    'Staff Management': '📋',
    'Community': '💬',
    'Game': '🎮',
    'Utility': '🔧',
};

export const data = new SlashCommandBuilder()
    .setName('cmds')
    .setDescription('Show a list of all available commands and their descriptions');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    try {
        const grouped = new Map<string, CommandEntry[]>();
        for (const cmd of COMMANDS) {
            const list = grouped.get(cmd.category) || [];
            list.push(cmd);
            grouped.set(cmd.category, list);
        }

        const embeds: EmbedBuilder[] = [];
        let currentEmbed = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle('📋 LARP Command List')
            .setDescription('All available commands for **Los Angeles Roleplay**. Use `/cmds` anytime to see this list.')
            .setThumbnail(BRAND.logoUrl)
            .setFooter({ text: BRAND.footer })
            .setTimestamp();

        let fieldCount = 0;

        for (const category of CATEGORY_ORDER) {
            const cmds = grouped.get(category);
            if (!cmds || cmds.length === 0) continue;

            const emoji = CATEGORY_EMOJIS[category] || '📌';
            const value = cmds.map(cmd => `**\`${cmd.name}\`** — ${cmd.description}`).join('\n');

            if (fieldCount >= 25) {
                embeds.push(currentEmbed);
                currentEmbed = new EmbedBuilder()
                    .setColor(BRAND.color)
                    .setTitle('📋 LARP Command List (continued)')
                    .setThumbnail(BRAND.logoUrl)
                    .setFooter({ text: BRAND.footer })
                    .setTimestamp();
                fieldCount = 0;
            }

            currentEmbed.addFields({ name: `${emoji} ${category}`, value, inline: false });
            fieldCount++;
        }

        embeds.push(currentEmbed);

        await interaction.editReply({ embeds, files: [createLogoAttachment()] });
    } catch (error) {
        console.error('[Cmds] Failed to generate command list.', error);
        await interaction.editReply({ content: 'Unable to generate the command list right now. Please try again later.' });
    }
}
