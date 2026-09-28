import {
    ActionRowBuilder, Attachment, ButtonBuilder, ButtonInteraction, ButtonStyle,
    ChatInputCommandInteraction, ContainerBuilder, GuildMember, MediaGalleryBuilder,
    MediaGalleryItemBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction,
    PermissionFlagsBits, SeparatorBuilder, SlashCommandBuilder, StringSelectMenuBuilder,
    StringSelectMenuInteraction, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { BRAND } from '../config/constants';
import {
    DEFAULT_PANEL_CONFIGS, applyTemplate, getPanelBannerUrl, getPanelConfig,
    parseSessionEmojis, savePanelConfig, type ConfigurablePanel, type PanelConfig,
} from '../services/panelConfig';

const panels: ConfigurablePanel[] = ['ticket', 'infraction', 'promotion', 'session'];
const drafts = new Map<string, { panel: ConfigurablePanel; config: PanelConfig }>();

function draftKey(guildId: string, userId: string): string { return `${guildId}:${userId}`; }
function isPanel(value: string): value is ConfigurablePanel { return panels.includes(value as ConfigurablePanel); }

function authorized(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): boolean {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const roleId = process.env.BOT_PERMISSIONS_ROLE_ID;
    return Boolean(roleId && interaction.member instanceof GuildMember && interaction.member.roles.cache.has(roleId));
}

function panelName(panel: ConfigurablePanel): string {
    if (panel === 'ticket') return 'Ticket Opening';
    if (panel === 'infraction') return 'Staff Infraction';
    if (panel === 'promotion') return 'Staff Promotion';
    return 'Session Panel';
}

function placeholders(panel: ConfigurablePanel): string {
    if (panel === 'ticket') return '`{opener}` `{staff}` `{ticket_id}` `{inquiry}` `{category}`';
    if (panel === 'infraction') return '`{member}` `{action}` `{reason}` `{issuer}` `{appeal_status}` `{case_id}` `{notes}`';
    if (panel === 'promotion') return '`{promoter}` `{member}` `{old_role}` `{new_role}` `{notes}` `{effective_date}` `{issuer}`';
    return '`{updated}` `{staff}` `{players}` `{maximum}` `{queue}` `{status}`';
}

function homeView() {
    const select = new StringSelectMenuBuilder().setCustomId('config:section')
        .setPlaceholder('Choose a configuration section')
        .addOptions({ label: 'Embeds', value: 'embeds', description: 'Edit V2 panels, text, banners, and emojis', emoji: '📝' });
    const container = new ContainerBuilder().setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '# Bot Configuration',
            'Choose **Embeds** below to privately preview and edit the bot’s Components V2 messages, banners, and supported emojis.',
            '', '-# Only you can see this configuration menu.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    return { components: [container] };
}

function embedLibraryView() {
    const select = new StringSelectMenuBuilder().setCustomId('config:panel')
        .setPlaceholder('Choose a V2 message to preview')
        .addOptions(panels.map(value => ({ label: panelName(value), value })));
    const container = new ContainerBuilder().setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '# V2 Message Configuration',
            'Choose a message below. Its real Components V2 layout will appear privately with controls for editing and saving it.',
            '', '-# This menu and every preview are visible only to you.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    return { components: [container] };
}

function previewValues(panel: ConfigurablePanel, userId: string): Record<string, string> {
    if (panel === 'ticket') return { opener: `<@${userId}>`, staff: '@Staff Team', ticket_id: 'TICKET-000570', inquiry: 'Example ticket inquiry', category: 'General Support' };
    if (panel === 'infraction') return { member: `<@${userId}>`, action: 'Warning II', reason: 'Example misconduct reason', issuer: `<@${userId}>`, appeal_status: 'Appealable', case_id: 'INF-0001', notes: 'Example notes' };
    if (panel === 'promotion') return { promoter: `<@${userId}>`, member: `<@${userId}>`, old_role: 'None', new_role: '@Supervisor', notes: 'Example promotion notes', effective_date: 'Immediately', issuer: `<@${userId}>` };
    return { updated: '<t:1770000000:R>', staff: '4', players: '28', maximum: '40', queue: '0', status: 'Online' };
}

function editorView(panel: ConfigurablePanel, config: PanelConfig, userId: string, customBannerUrl?: string | null, notice?: string) {
    const values = previewValues(panel, userId);
    const emojis = parseSessionEmojis(config.emojiText);
    const instructions = [
        `# Bot Configuration • ${panelName(panel)}`,
        notice ? `**${notice}**` : '',
        `**Custom banner:** ${config.bannerMessageId ? 'Configured' : 'Using the included default banner'}`,
        `**Available placeholders:** ${placeholders(panel)}`,
        panel === 'session' ? '**Editable emojis:** title, staff, players, queue, online, offline, join' : '',
        '', 'Press **Edit**, change the fields, then press **Save Changes**. To replace the banner, run `/config` with this panel selected and attach the image.',
    ].filter(Boolean).join('\n');
    const previewLines = [
        `# ${panel === 'session' ? `${emojis.title} ` : ''}${applyTemplate(config.title, values)}`,
        applyTemplate(config.description, values),
        panel === 'session' ? `\n${emojis.staff} **Staff Online:** ${values.staff}  •  ${emojis.players} **Players:** ${values.players}/${values.maximum}  •  ${emojis.queue} **Queue:** ${values.queue}\n${emojis.online} **Online**  •  ${emojis.offline} **Offline**  •  ${emojis.join} **Quick Join**` : '',
        '', `-# ${panelName(panel)} • Private V2 Preview`,
    ].filter(Boolean).join('\n');
    const container = new ContainerBuilder().setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(instructions));
    if (customBannerUrl) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(customBannerUrl)));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(previewLines))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`config:edit:${panel}`).setLabel(panel === 'session' ? 'Edit Text & Emojis' : 'Edit Text').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`config:save:${panel}`).setLabel('Save Changes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`config:reset:${panel}`).setLabel('Reset Draft').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('config:back:embeds').setLabel('Back').setStyle(ButtonStyle.Secondary),
        ));
    return { components: [container] };
}

async function privateEditorView(guild: NonNullable<ChatInputCommandInteraction['guild']>, panel: ConfigurablePanel, config: PanelConfig, userId: string, notice?: string) {
    return editorView(panel, config, userId, await getPanelBannerUrl(guild, config), notice);
}

export const configCommand = {
    data: new SlashCommandBuilder().setName('config').setDescription('Open the private bot configuration editor')
        .addStringOption(option => option.setName('panel').setDescription('Panel whose banner you want to replace')
            .addChoices(...panels.map(value => ({ name: panelName(value), value }))))
        .addAttachmentOption(option => option.setName('banner').setDescription('Drag and attach the new panel banner')),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild || !authorized(interaction)) {
            await interaction.reply({ content: 'Only the server owner, administrators, or the configured bot-management role can use `/config`.', flags: MessageFlags.Ephemeral }); return;
        }
        const selectedOption = interaction.options.getString('panel');
        const panel = isPanel(selectedOption || '') ? selectedOption as ConfigurablePanel : 'ticket';
        const banner = interaction.options.getAttachment('banner');
        if (!selectedOption && !banner) {
            await interaction.reply({ ...homeView(), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }); return;
        }
        let config = await getPanelConfig(interaction.guild, panel);
        let notice: string | undefined;
        if (banner) {
            if (!banner.contentType?.startsWith('image/')) { await interaction.reply({ content: 'The banner attachment must be an image.', flags: MessageFlags.Ephemeral }); return; }
            const saved = await savePanelConfig(interaction.guild, panel, config, banner as Attachment);
            config = saved.config;
            notice = saved.persistent ? 'Banner saved successfully.' : 'Banner saved for this runtime; give the bot Manage Channels for permanent storage.';
        }
        drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config: { ...config } });
        await interaction.reply({ ...await privateEditorView(interaction.guild, panel, config, interaction.user.id, notice), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    },
};

export async function handleConfigSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'config:section' && interaction.customId !== 'config:panel') return false;
    if (!interaction.guild || !authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral }); return true; }
    if (interaction.customId === 'config:section') { await interaction.update(embedLibraryView()); return true; }
    const panel = isPanel(interaction.values[0]) ? interaction.values[0] : 'ticket';
    const config = await getPanelConfig(interaction.guild, panel);
    drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config: { ...config } });
    await interaction.update(await privateEditorView(interaction.guild, panel, config, interaction.user.id));
    return true;
}

export async function handleConfigButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:')) return false;
    if (!interaction.guild || !authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral }); return true; }
    const [, action, rawPanel] = interaction.customId.split(':');
    if (action === 'back' && rawPanel === 'embeds') { await interaction.update(embedLibraryView()); return true; }
    const panel = isPanel(rawPanel) ? rawPanel : 'ticket';
    const key = draftKey(interaction.guild.id, interaction.user.id);
    const current = drafts.get(key)?.panel === panel ? drafts.get(key)!.config : await getPanelConfig(interaction.guild, panel);
    if (action === 'edit') {
        const modal = new ModalBuilder().setCustomId(`config:modal:${panel}`).setTitle(`Edit ${panelName(panel)}`).addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('title').setLabel('V2 message title').setStyle(TextInputStyle.Short).setMaxLength(256).setValue(current.title).setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Message template').setStyle(TextInputStyle.Paragraph).setMaxLength(1400).setValue(current.description).setRequired(true)),
        );
        if (panel === 'session') modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
            .setCustomId('emojis').setLabel('Emojis (one key=value per line)').setStyle(TextInputStyle.Paragraph).setMaxLength(500)
            .setValue(current.emojiText || DEFAULT_PANEL_CONFIGS.session.emojiText || '').setRequired(true)));
        await interaction.showModal(modal); return true;
    }
    if (action === 'save') {
        const saved = await savePanelConfig(interaction.guild, panel, current);
        drafts.set(key, { panel, config: { ...saved.config } });
        await interaction.update(await privateEditorView(interaction.guild, panel, saved.config, interaction.user.id, saved.persistent ? 'Changes saved successfully.' : 'Saved for this runtime only. Give the bot Manage Channels for permanent storage.')); return true;
    }
    if (action === 'reset') {
        const config = await getPanelConfig(interaction.guild, panel);
        drafts.set(key, { panel, config: { ...config } });
        await interaction.update(await privateEditorView(interaction.guild, panel, config, interaction.user.id, 'Unsaved changes were discarded.')); return true;
    }
    return false;
}

export async function handleConfigModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:modal:')) return false;
    if (!interaction.guild || !authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral }); return true; }
    const rawPanel = interaction.customId.split(':')[2];
    const panel = isPanel(rawPanel) ? rawPanel : 'ticket';
    const old = await getPanelConfig(interaction.guild, panel);
    const config: PanelConfig = {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        bannerMessageId: drafts.get(draftKey(interaction.guild.id, interaction.user.id))?.config.bannerMessageId || old.bannerMessageId,
        emojiText: panel === 'session' ? interaction.fields.getTextInputValue('emojis') : old.emojiText,
    };
    drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config });
    const view = await privateEditorView(interaction.guild, panel, config, interaction.user.id, 'Draft updated. Press Save Changes to make it permanent.');
    if (interaction.isFromMessage()) await interaction.update(view);
    else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    return true;
}
