import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const PARTNERSHIP_BANNER_NAME = 'partnership-banner.webp';
const PARTNERSHIP_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', PARTNERSHIP_BANNER_NAME);
const UNDERBANNER_NAME = 'underbanner.webp';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(PARTNERSHIP_BANNER_PATH, { name: PARTNERSHIP_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function launcherPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(PARTNERSHIP_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🤝 Partnership Program',
            '**Welcome to the Los Angeles Roleplay Partnership Program.**',
            '',
            '### 📋 Partnership Rules',
            '• You must remain in the server for the duration of the partnership.',
            '• Our partnership advertisement must remain posted in your server.',
            '• Removing the advertisement or leaving the server may result in immediate partnership removal.',
            '',
            '### 🎁 Partnership Benefits',
            '• Receive the official partnership role.',
            '• Have your community represented as an approved LARP partner.',
            '• Build a long-term connection between both communities.',
            '',
            '**Press the button below to submit your partnership request for staff review.**',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('partnership:open')
                .setLabel('Submit Partnership Request')
                .setEmoji('🤝')
                .setStyle(ButtonStyle.Primary),
        ))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export const partnershipV2Command = {
    data: new SlashCommandBuilder()
        .setName('partnership')
        .setDescription('Post the Los Angeles Roleplay partnership panel')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('request')
                .setDescription('Post the Components V2 partnership request panel in this channel'),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        interaction.options.getSubcommand(true);

        const destination = interaction.channel;
        if (!destination?.isSendable()) {
            await interaction.editReply('This channel cannot receive the partnership panel.');
            return;
        }

        try {
            const message = await destination.send({
                components: [launcherPanel()],
                files: artwork(),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
            await interaction.editReply(`✅ Components V2 partnership emblem posted: ${message.url}`);
            logger.info(`[PartnershipV2] Partnership launcher posted by ${interaction.user.id} in ${interaction.channelId}.`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.error(`[PartnershipV2] Launcher post failed: ${reason}`);
            await interaction.editReply(`I could not post the V2 partnership emblem. Discord returned: ${reason.slice(0, 1200)}`);
        }
    },
};
