import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';
import { DISCORD_GUIDELINES, GAME_GUIDELINES, TICKET_TERMS } from './supportContent';

const RULES_BANNER_NAME = 'rules-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const RULES_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', RULES_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const ASSISTANCE_CHANNEL_ID = '1526034504953892925';

const RULES_WELCOME = [
    '## Welcome to Los Angeles Roleplay',
    'Hello and welcome to **Los Angeles Roleplay**! We are an ER:LC roleplay server. Our goal is to make sure you have fun, that everyone follows our rules, and that all members are kind and respectful to one another.',
    '',
    `If you see anyone bullying you or breaking a rule, please open a ticket immediately in <#${ASSISTANCE_CHANNEL_ID}> so a staff member can handle it.`,
    '',
    'Below, you can find the rules for our server. Please follow them, as failure to do so may result in punishment.',
    '',
    '**Use the menu below to select and read a rule section.**',
].join('\n');

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(RULES_BANNER_PATH, { name: RULES_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function rulesMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('rules:menu')
            .setPlaceholder('Select a rules section')
            .addOptions(
                {
                    label: 'Discord Rules',
                    value: 'discord',
                    emoji: '💬',
                    description: 'Read the Discord server rules',
                },
                {
                    label: 'Game Rules',
                    value: 'game',
                    emoji: '🎮',
                    description: 'Read the in-game and roleplay voice rules',
                },
                {
                    label: 'Ticket TOS',
                    value: 'ticket-tos',
                    emoji: '🎫',
                    description: 'Read the terms for opening support tickets',
                },
            ),
    );
}

function rulesLauncher(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(RULES_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(RULES_WELCOME))
        .addSeparatorComponents(separator())
        .addActionRowComponents(rulesMenu())
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function rulesDetailPanel(content: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(RULES_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export function buildRulesPanelRefreshPayload() {
    return {
        components: [rulesLauncher()],
        files: artwork(),
        flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] as [] },
    };
}

export async function handleRulesSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'rules:menu') return false;

    const content = interaction.values[0] === 'discord'
        ? DISCORD_GUIDELINES
        : interaction.values[0] === 'game'
            ? GAME_GUIDELINES
            : interaction.values[0] === 'ticket-tos'
                ? TICKET_TERMS
                : null;
    if (!content) {
        await interaction.reply({
            content: 'That rules section is unavailable.',
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    await interaction.reply({
        components: [rulesDetailPanel(content)],
        files: artwork(),
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    return true;
}

async function postRulesPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await interaction.client.channels.fetch(CHANNEL_IDS.rules).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel) || !channel.isSendable()) {
        await interaction.editReply(`I could not access the rules channel <#${CHANNEL_IDS.rules}>.`);
        return;
    }

    try {
        const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existing = recent?.find(message => message.author.id === interaction.client.user?.id
            && JSON.stringify(message.components.map(component => component.toJSON())).includes('rules:menu'));
        const payload = buildRulesPanelRefreshPayload();
        if (existing) {
            await existing.edit({ ...payload, attachments: [] }).catch(async () => {
                await channel.send(payload);
            });
        } else {
            await channel.send(payload);
        }
        await interaction.editReply(`✅ The V2 rules panel was refreshed in <#${CHANNEL_IDS.rules}>.`);
    } catch (error) {
        logger.error(`[Rules] Could not refresh the rules panel: ${error instanceof Error ? error.message : String(error)}`);
        await interaction.editReply('I could not refresh the rules panel. Check my channel and attachment permissions.');
    }
}

export const rulesCommand = {
    data: new SlashCommandBuilder()
        .setName('rules')
        .setDescription('Post or refresh the Los Angeles Roleplay V2 rules panel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    execute: postRulesPanel,
};
