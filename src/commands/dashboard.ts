import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const DASHBOARD_CHANNEL_ID = '1526049604712529971';
const DASHBOARD_BANNER_B64_PATH = resolve(__dirname, '..', '..', 'assets', 'dashboard-banner.b64');
const DASHBOARD_BANNER_NAME = 'dashboard-banner.webp';
const DISCORD_EMOJI_ID = '1522529390687293460';
const ROBLOX_EMOJI_ID = '1020834558058442813';

function dashboardBanner(): Buffer {
    return Buffer.from(readFileSync(DASHBOARD_BANNER_B64_PATH, 'utf8').trim(), 'base64');
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function dashboardButton(customId: string, label: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary),
    );
}

function disabledButton(
    customId: string,
    label: string,
    emoji?: string | { id: string; name: string },
): ActionRowBuilder<ButtonBuilder> {
    const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
    if (emoji) button.setEmoji(emoji);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

function mainDashboard(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(DASHBOARD_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🛡️ Dashboard',
            'Welcome to the **Dashboard for Los Angeles Roleplay**. This channel serves as your primary directory for essential information, official resources, and helpful links to keep you connected with our community.',
            '',
            '**Los Angeles Roleplay** is a realistic roleplay community based in ER:LC, focused on immersive sessions, professional departments, community events, and a high-quality Los Angeles roleplay experience.',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            dashboardButton('dashboard:faq', 'Frequently Asked Questions'),
            dashboardButton('dashboard:bulletin', 'Discord Bulletin'),
            dashboardButton('dashboard:regulations', 'Regulations'),
        )
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('*Los Angeles Roleplay • Most immersive Los Angeles experience*'));
}

function faqPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Frequently Asked Questions'))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            disabledButton('dashboard:disabled:faq-appeal', 'How do I appeal a punishment?', '❔'),
            disabledButton('dashboard:disabled:faq-sessions', 'When are sessions hosted?', '❔'),
            disabledButton('dashboard:disabled:faq-partner', 'How do I partner with LARP?', '❔'),
            disabledButton('dashboard:disabled:faq-rules', 'Where is the Discord Rules & Game Rules?', '❔'),
            disabledButton('dashboard:disabled:faq-verify', 'How do I verify?', '❔'),
            disabledButton('dashboard:disabled:faq-whitelist', 'What teams are whitelisted?', '❔'),
            disabledButton('dashboard:disabled:faq-moderator', 'How do I become a Moderator?', '❔'),
            disabledButton('dashboard:disabled:faq-department', 'How do I join a department?', '❔'),
        );
}

function bulletinPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Discord Bulletin'))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            disabledButton('dashboard:disabled:quick-links', 'Quick Links', '👤'),
            disabledButton('dashboard:disabled:applications', 'Applications', '📝'),
        );
}

function regulationsPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Regulations'))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            disabledButton(
                'dashboard:disabled:discord-regulations',
                'Discord Regulations — Review our Discord regulations/rules.',
                { id: DISCORD_EMOJI_ID, name: 'Discord' },
            ),
            disabledButton(
                'dashboard:disabled:game-regulations',
                'Game Regulations — Review our game regulations/rules.',
                { id: ROBLOX_EMOJI_ID, name: 'ROBLOX' },
            ),
            disabledButton(
                'dashboard:disabled:vc-regulations',
                'VC Regulations — Review our VC regulations/rules.',
                { id: ROBLOX_EMOJI_ID, name: 'ROBLOX' },
            ),
        );
}

async function privatePanel(interaction: ButtonInteraction, panel: ContainerBuilder): Promise<void> {
    await interaction.reply({
        components: [panel],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

export async function handleDashboardButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('dashboard:')) return false;

    if (interaction.customId.startsWith('dashboard:disabled:')) {
        // These are intentionally disabled in the UI. This guard is only here
        // for stale/cached component interactions.
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: 'This dashboard option is coming soon.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }

    try {
        if (interaction.customId === 'dashboard:faq') {
            await privatePanel(interaction, faqPanel());
            return true;
        }
        if (interaction.customId === 'dashboard:bulletin') {
            await privatePanel(interaction, bulletinPanel());
            return true;
        }
        if (interaction.customId === 'dashboard:regulations') {
            await privatePanel(interaction, regulationsPanel());
            return true;
        }
    } catch (error) {
        logger.error(`[Dashboard] Button ${interaction.customId} failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: 'The dashboard could not open that section right now.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }

    return false;
}

export const dashboardCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Post the Los Angeles Roleplay V2 dashboard')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const channel = await interaction.client.channels.fetch(DASHBOARD_CHANNEL_ID).catch(() => null);
            if (!channel?.isSendable()) {
                await interaction.editReply(`The dashboard channel <#${DASHBOARD_CHANNEL_ID}> is unavailable or I cannot send there.`);
                return;
            }

            await channel.send({
                components: [mainDashboard()],
                files: [new AttachmentBuilder(dashboardBanner(), { name: DASHBOARD_BANNER_NAME })],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });

            await interaction.editReply(`✅ Dashboard posted in <#${DASHBOARD_CHANNEL_ID}>.`);
            logger.info(`[Dashboard] V2 dashboard posted in ${DASHBOARD_CHANNEL_ID} by ${interaction.user.id}.`);
        } catch (error) {
            logger.error(`[Dashboard] Could not post dashboard: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await interaction.editReply('I could not post the dashboard. Check my channel permissions and the dashboard banner asset.');
        }
    },
};
