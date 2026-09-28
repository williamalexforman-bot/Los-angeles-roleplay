import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    EmbedBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { bannerAttachment, bannerFiles, bannerUrl, underbannerEmbed } from '../utils/bannerAssets';
import { fetchErlcServer } from '../services/erlcService';
import { applyTemplate, getPanelBannerUrl, getPanelConfig, parseSessionEmojis, type PanelConfig } from '../services/panelConfig';

const QUICK_JOIN_URL = 'https://www.roblox.com/games/start?launchData=%7B%22psCode%22%3A%22califorp%22%7D&placeId=2534724415';
const REGULATIONS_MENU_ID = 'regulations:menu';

const DISCORD_RULES = `# Discord Rules

1. Swearing is permitted, but you may not direct it at another person. Keep swearing to a minimum, and **no slurs are allowed**.

2) Treat all staff members and community members with respect. We strive to maintain a welcoming and respectful community.

3. Self-promotion, advertising, and spam are not permitted and will result in punishment.

4) Use the appropriate channels for their intended purpose (e.g. use the **#commands** channel for bot commands).

5. Follow Discord's Terms of Service at all times. Failure to do so will result in severe punishment.

6) Staff reserve the right to enforce unlisted rules if they believe it is in the best interest of the server. If you disagree with a staff member's decision, you may report it through the appropriate channels.`;

const GAME_RULES = `# In-Game Rules

1. If you vote in favor of a session, you are expected to join. Failure to do so may result in severe punishment.

2) Violating roleplay rules such as **RDM, VDM, NLR**, or similar offenses will result in punishment. If you are unsure what these terms mean, please open a support ticket.

3. Disrespecting staff while they are on duty is not permitted and may result in punishment.

4) Proper roleplay is expected at all times. Do your best to create an enjoyable and realistic experience for everyone.

5. Follow Roblox's Terms of Service at all times. Failure to do so will result in severe punishment.

6) Staff may punish unlisted rule violations if they are deemed severe enough. If you disagree with a staff member's decision, you may report it through the appropriate channels.`;

function gallery(url: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(url),
    );
}

function loadingSessionPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# 🌐 Session Information\n> Loading the latest session information…'),
        );
}

function sessionPanel(
    status: { online: boolean; staff: number; players: number; maximum: number; queue: number; updatedAt: number },
    configured: PanelConfig,
    customBannerUrl?: string | null,
): ContainerBuilder {
    const emojis = parseSessionEmojis(configured.emojiText);
    const values = {
        updated: `<t:${Math.floor(status.updatedAt / 1_000)}:R>`,
        staff: String(status.staff),
        players: String(status.players),
        maximum: String(status.maximum),
        queue: String(status.queue),
        status: status.online ? 'Online' : 'Offline',
    };
    const information = new TextDisplayBuilder().setContent([
        `# ${emojis.title} ${applyTemplate(configured.title, values)}`,
        applyTemplate(configured.description, values),
    ].join('\n'));

    const setEmoji = (button: ButtonBuilder, emoji: string): ButtonBuilder => {
        try { return button.setEmoji(emoji); } catch { return button; }
    };

    const counters = new ActionRowBuilder<ButtonBuilder>().addComponents(
        setEmoji(new ButtonBuilder()
            .setCustomId('session:staff-count')
            .setLabel(`Staff Online: ${status.staff}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.staff),
        setEmoji(new ButtonBuilder()
            .setCustomId('session:player-count')
            .setLabel(`Players In-Game: ${status.players}/${status.maximum}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.players),
        setEmoji(new ButtonBuilder()
            .setCustomId('session:queue-count')
            .setLabel(`In Queue: ${status.queue}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), emojis.queue),
    );

    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        setEmoji(new ButtonBuilder()
            .setCustomId('session:status')
            .setLabel(status.online ? 'Session Online' : 'Session Offline')
            .setStyle(status.online ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(true), status.online ? emojis.online : emojis.offline),
        setEmoji(new ButtonBuilder()
            .setLabel('Quick Join')
            .setStyle(ButtonStyle.Link)
            .setURL(QUICK_JOIN_URL), emojis.join),
    );

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(customBannerUrl || bannerUrl('dashboard')))
        .addTextDisplayComponents(information)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(counters, controls)
        .addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
}

function regulationsPanel(): ContainerBuilder {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(REGULATIONS_MENU_ID)
        .setPlaceholder('Select a regulation category')
        .addOptions(
            {
                label: 'Discord Regulations',
                description: 'View the community and Discord rules',
                value: 'discord',
                emoji: '💬',
            },
            {
                label: 'Game Regulations',
                description: 'View the in-game and roleplay rules',
                value: 'game',
                emoji: '🎮',
            },
        );

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(gallery(bannerUrl('regulations')))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
                '# 📜 Community Regulations',
                '> Select a category below to review the rules. Your selected rules will be shown privately so only you can see them.',
            ].join('\n')),
        )
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))
        .addMediaGalleryComponents(gallery(bannerUrl('underbanner')));
}

function privateRulesPanel(content: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function linkButton(label: string, guildId: string, channelId: string): ButtonBuilder | null {
    if (!channelId) return null;
    return new ButtonBuilder()
        .setLabel(label)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${channelId}`);
}

const dashboardCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Post the LARP server dashboard'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
            return;
        }
        const guild = interaction.guild;
        const embed = new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle('California State Roleplay Dashboard')
            .setDescription('Use this dashboard to quickly access important community resources and support.')
            .setImage(bannerUrl('dashboard'))
            .addFields(
                { name: 'Members', value: guild.memberCount.toLocaleString(), inline: true },
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
            )
            .setFooter({ text: BRAND.footer })
            .setTimestamp();
        const buttons = [
            linkButton('Regulations', guild.id, CHANNEL_IDS.rules),
            linkButton('Support', guild.id, CHANNEL_IDS.ticketPanel),
        ].filter((button): button is ButtonBuilder => Boolean(button));
        await interaction.reply({
            embeds: [embed, underbannerEmbed()],
            components: buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [],
            files: bannerFiles('dashboard'),
            allowedMentions: { parse: [] },
        });
    },
};

const regulationsCommand = {
    data: new SlashCommandBuilder()
        .setName('regulations')
        .setDescription('Post the community regulations'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.reply({
            components: [regulationsPanel()],
            files: [bannerAttachment('regulations'), bannerAttachment('underbanner')],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    },
};

const sessionPanelCommand = {
    data: new SlashCommandBuilder()
        .setName('session-panel')
        .setDescription('Post the live roleplay session panel'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.reply({
            components: [loadingSessionPanel()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });

        const snapshot = await fetchErlcServer({ timeoutMs: 10_000 });
        const configured = await getPanelConfig(interaction.guild, 'session');
        const customBannerUrl = await getPanelBannerUrl(interaction.guild, configured);
        const session = snapshot.ok
            ? {
                online: true,
                staff: snapshot.data.players.filter(player => player.permission.toLowerCase() !== 'normal').length,
                players: snapshot.data.currentPlayers,
                maximum: snapshot.data.maxPlayers,
                queue: Math.max(0, snapshot.data.currentPlayers - snapshot.data.maxPlayers),
                updatedAt: snapshot.data.fetchedAt,
            }
            : {
                online: false,
                staff: 0,
                players: 0,
                maximum: 40,
                queue: 0,
                updatedAt: Date.now(),
            };

        await interaction.editReply({
            components: [sessionPanel(session, configured, customBannerUrl)],
            files: [bannerAttachment('dashboard'), bannerAttachment('underbanner')],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    },
};

export async function handlePanelSelectMenu(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== REGULATIONS_MENU_ID) return false;
    const content = interaction.values[0] === 'game' ? GAME_RULES : DISCORD_RULES;
    await interaction.reply({
        components: [privateRulesPanel(content)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });
    return true;
}

export const panelCommands = [dashboardCommand, regulationsCommand, sessionPanelCommand];
