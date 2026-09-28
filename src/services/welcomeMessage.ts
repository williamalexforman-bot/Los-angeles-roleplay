import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    Guild,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    TextDisplayBuilder,
    User,
    type SendableChannels,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { applyTemplate, getPanelBannerUrl, getPanelConfig, parseEmojiMap } from './panelConfig';

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
    const dashboardUrl = process.env.DASHBOARD_URL?.trim()
        || `https://discord.com/channels/${guild.id}/${destination.id}`;
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
    ].join('\n')));
    const countButton = new ButtonBuilder()
        .setCustomId('welcome:member-count')
        .setLabel(values.member_count)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
    try { countButton.setEmoji(emojis.member || '👤'); } catch { /* invalid configured emoji */ }
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        countButton,
        new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(dashboardUrl),
    ));
    await destination.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id], parse: [] },
    });
}
