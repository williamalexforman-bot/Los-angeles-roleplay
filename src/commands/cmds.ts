import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BRAND } from '../config/constants';
import { legacyEmbedToV2Message, legacyEmbedToV2Panel } from '../utils/embeds';

interface CommandEntry {
    name: string;
    description: string;
    category: string;
}

const CATEGORY_NAMES: Readonly<Record<string, readonly string[]>> = {
    Moderation: ['warn', 'kick', 'ban', 'timeout', 'purge', 'lock', 'unlock', 'slowmode', 'punish', 'punishment', 'prohibited-word'],
    Admin: ['admin', 'role', 'say', 'dock-config', 'rename', 'rules'],
    'Staff Management': ['application', 'training', 'training-results', 'infraction', 'promotion', 'request-training', 'view-infractions', 'loa'],
    Community: ['movie-feedback', 'staff-feedback', 'staff-complaint', 'partnership', 'suggest', 'suggestions', 'suggestion-approved', 'suggestion-denied', 'suggestion-maybe'],
    Sessions: ['session-start', 'session-vote', 'session-end', 'session-boost', 'session-full'],
    Tickets: ['ticket', 'ticket-panel', 'ticketpanel', 'close', 'closerequest', 'unclaim', 'add-member', 'remove-member', 'applications-panel', 'marketplace-panel', 'dashboard'],
    Game: ['teamswitch', 'recent-in-game-logs', 'in-game-info', 'erlc-command'],
};

function commandCategory(name: string): string {
    for (const [category, names] of Object.entries(CATEGORY_NAMES)) {
        if (names.includes(name)) return category;
    }
    return 'Utility';
}

function currentCommands(): CommandEntry[] {
    // Loaded at execution time to avoid a registry -> /cmds -> registry cycle.
    const registry = require('./registry.ts') as {
        commandDefinitions?: Array<{ data?: { name?: string; toJSON?: () => unknown } }>;
    };
    const definitions = Array.isArray(registry.commandDefinitions) ? registry.commandDefinitions : [];
    return definitions.map(definition => {
        const schema = definition.data?.toJSON?.() as { name?: string; description?: string } | undefined;
        const name = schema?.name || definition.data?.name || 'unknown';
        return {
            name: `/${name}`,
            description: schema?.description || 'No description provided.',
            category: commandCategory(name),
        };
    }).sort((left, right) => left.name.localeCompare(right.name));
}

const CATEGORY_ORDER = ['Moderation', 'Admin', 'Staff Management', 'Community', 'Sessions', 'Tickets', 'Game', 'Utility'];
const CATEGORY_EMOJIS: Record<string, string> = {
    Moderation: '🛡️',
    Admin: '⚙️',
    'Staff Management': '📋',
    Community: '💬',
    Sessions: '🚨',
    Tickets: '🎫',
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
        for (const cmd of currentCommands()) {
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

        const artwork = legacyEmbedToV2Message(embeds[0]);

        await interaction.editReply({
            ...artwork,
            components: embeds.map(embed => legacyEmbedToV2Panel(embed)),
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (error) {
        console.error('[Cmds] Failed to generate command list.', error);
        await interaction.editReply({ content: 'Unable to generate the command list right now. Please try again later.' });
    }
}
