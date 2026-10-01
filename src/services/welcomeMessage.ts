import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    Guild,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
    User,
    type SendableChannels,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { applyTemplate, configuredChannelId, getPanelBannerUrl, getPanelConfig, parseEmojiMap } from './panelConfig';

export async function sendConfiguredWelcome(
    guild: Guild,
    user: User,
    destination: SendableChannels,
): Promise<void> {
    const config = await getPanelConfig(guild, 'welcome');
    const emojis = parseEmojiMap(config.emojiText);
    const values = {
        member: `<@${user.id}>`,
        server: guild.name,
        member_count: guild.memberCount.toLocaleString(),
    };
    const [dashboardChannelId, regulationsChannelId, assistanceChannelId] = await Promise.all([
        configuredChannelId(guild, 'dashboard'),
        configuredChannelId(guild, 'regulations'),
        configuredChannelId(guild, 'ticket_panel'),
    ]);
    const container = new ContainerBuilder().setAccentColor(BRAND.color);
    const customBannerUrl = await getPanelBannerUrl(guild, config);
    if (customBannerUrl) {
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(customBannerUrl),
        ));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `# ${emojis.title || '👋'} ${applyTemplate(config.title, values)}`,
        applyTemplate(config.description, values),
    ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## Start Here',
            '• Read the community and in-game regulations.',
            '• Check the dashboard for important server resources.',
            '• Open an Assistance ticket if you need help from staff.',
        ].join('\n')));
    const countButton = new ButtonBuilder()
        .setCustomId('welcome:member-count')
        .setLabel(values.member_count)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
    try { countButton.setEmoji(emojis.member || '👤'); } catch { /* invalid configured emoji */ }
    const buttons: ButtonBuilder[] = [countButton];
    if (dashboardChannelId) buttons.push(new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${dashboardChannelId}`));
    if (regulationsChannelId) buttons.push(new ButtonBuilder().setLabel('Regulations').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${regulationsChannelId}`));
    if (assistanceChannelId) buttons.push(new ButtonBuilder().setLabel('Assistance').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${assistanceChannelId}`));
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# California State Roleplay • Welcome Center • Realism at its Finest'));
    await destination.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id], parse: [] },
    });
}
