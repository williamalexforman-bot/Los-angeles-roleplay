import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BRAND } from '../config/constants';
import { createUnderbannerAttachment, legacyEmbedToV2Panel } from '../utils/embeds';

interface CommandEntry {
    name: string;
    description: string;
    category: string;
}

const COMMANDS: CommandEntry[] = [
    { name: '/warn', description: 'Issue a warning to a user with a reason and optional proof', category: 'Moderation' },
    { name: '/kick', description: 'Kick a user from the server with a reason', category: 'Moderation' },
    { name: '/ban', description: 'Ban a user from the server with a reason', category: 'Moderation' },
    { name: '/timeout', description: 'Timeout a user for a specified duration', category: 'Moderation' },
    { name: '/purge', description: 'Bulk delete messages', category: 'Moderation' },
    { name: '/lock', description: 'Lock the current channel', category: 'Moderation' },
    { name: '/unlock', description: 'Unlock the current channel', category: 'Moderation' },
    { name: '/slowmode', description: 'Set channel slowmode', category: 'Moderation' },
    { name: '/punish', description: 'Issue a staff punishment with case tracking', category: 'Moderation' },
    { name: '/punishment', description: 'View or remove punishment records', category: 'Moderation' },

    { name: '/admin', description: 'Administrative role and staff utilities', category: 'Admin' },
    { name: '/role', description: 'Add roles to members when authorized', category: 'Admin' },
    { name: '/say', description: 'Make the bot send a message', category: 'Admin' },
    { name: '/prohibited-word', description: 'Manage prohibited-word moderation entries', category: 'Admin' },

    { name: '/infraction', description: 'Manage staff infractions', category: 'Staff Management' },
    { name: '/promotion', description: 'Manage staff promotions', category: 'Staff Management' },
    { name: '/training-results', description: 'Publish completed staff training results', category: 'Staff Management' },
    { name: '/application', description: 'Manage a staff application', category: 'Staff Management' },
    { name: '/applications-panel', description: 'Post the applications panel', category: 'Staff Management' },
    { name: '/training', description: 'Manage a training request', category: 'Staff Management' },
    { name: '/view-user-quota', description: 'Inspect another user’s quota when authorized', category: 'Staff Management' },
    { name: '/end-weekly-quota-early', description: 'Finalize the current quota week early', category: 'Staff Management' },
    { name: '/extend-weeks-quota', description: 'Extend the current quota week', category: 'Staff Management' },

    { name: '/partnership', description: 'Manage partnership requests', category: 'Community' },
    { name: '/suggestion', description: 'Submit or manage suggestions', category: 'Community' },
    { name: '/marketplace-panel', description: 'Post the marketplace panel', category: 'Community' },

    { name: '/teamswitch', description: 'Submit an authorized manual ER:LC team-switch report', category: 'Game' },

    { name: '/cmds', description: 'Show this command list', category: 'Utility' },
    { name: '/roleplay-log', description: 'Log a roleplay session', category: 'Utility' },
    { name: '/request-training', description: 'Request a training session', category: 'Utility' },
    { name: '/view-infractions', description: 'View your own infraction history', category: 'Utility' },
    { name: '/loa', description: 'Manage leave-of-absence requests', category: 'Utility' },
    { name: '/rename', description: 'Rename a channel when authorized', category: 'Utility' },
    { name: '/ticket', description: 'Manage support tickets', category: 'Utility' },
    { name: '/ticket-panel', description: 'Post the ticket panel', category: 'Utility' },
    { name: '/ticketpanel', description: 'Compatibility alias for the ticket panel', category: 'Utility' },
    { name: '/close', description: 'Close the current support ticket', category: 'Utility' },
    { name: '/closerequest', description: 'Request permission to close a support ticket', category: 'Utility' },
    { name: '/unclaim', description: 'Unclaim the current support ticket', category: 'Utility' },
];

const CATEGORY_ORDER = ['Moderation', 'Admin', 'Staff Management', 'Community', 'Game', 'Utility'];
const CATEGORY_EMOJIS: Record<string, string> = {
    Moderation: '🛡️',
    Admin: '⚙️',
    'Staff Management': '📋',
    Community: '💬',
    Game: '🎮',
    Utility: '🔧',
};

export const data = new SlashCommandBuilder()
    .setName('cmds')
    .setDescription('Show a list of available commands and their descriptions');

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
            .setDescription('Available commands for **Los Angeles Roleplay**.')
            .setThumbnail(BRAND.logoUrl)
            .setFooter({ text: BRAND.footer })
            .setTimestamp();

        let fieldCount = 0;
        for (const category of CATEGORY_ORDER) {
            const cmds = grouped.get(category);
            if (!cmds?.length) continue;
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

        await interaction.editReply({
            components: embeds.map(embed => legacyEmbedToV2Panel(embed)),
            files: [createUnderbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (error) {
        console.error('[Cmds] Failed to generate command list.', error);
        await interaction.editReply({ content: 'Unable to generate the command list right now. Please try again later.' });
    }
}
