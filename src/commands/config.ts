import {
    ActionRowBuilder,
    Attachment,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { BRAND } from '../config/constants';
import {
    DEFAULT_PANEL_CONFIGS,
    applyTemplate,
    getPanelBannerUrl,
    getPanelConfig,
    savePanelConfig,
    type ConfigurablePanel,
    type PanelConfig,
} from '../services/panelConfig';

const panels: ConfigurablePanel[] = ['ticket', 'infraction', 'promotion'];
const drafts = new Map<string, { panel: ConfigurablePanel; config: PanelConfig }>();

function draftKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}

function isPanel(value: string): value is ConfigurablePanel {
    return panels.includes(value as ConfigurablePanel);
}

function authorized(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): boolean {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const roleId = process.env.BOT_PERMISSIONS_ROLE_ID;
    return Boolean(roleId && interaction.member instanceof GuildMember && interaction.member.roles.cache.has(roleId));
}

function panelName(panel: ConfigurablePanel): string {
    return panel === 'ticket' ? 'Ticket Opening' : panel === 'infraction' ? 'Staff Infraction' : 'Staff Promotion';
}

function placeholders(panel: ConfigurablePanel): string {
    if (panel === 'ticket') return '`{opener}` `{staff}` `{ticket_id}` `{inquiry}` `{category}`';
    if (panel === 'infraction') return '`{member}` `{action}` `{reason}` `{issuer}` `{appeal_status}` `{case_id}` `{notes}`';
    return '`{promoter}` `{member}` `{old_role}` `{new_role}` `{notes}` `{effective_date}` `{issuer}`';
}

function homeView() {
    const embed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle('Bot Configuration')
        .setDescription('Choose **Embeds** below to privately preview and edit the bot’s messages and banners.')
        .setFooter({ text: 'Only you can see this configuration menu.' });
    const select = new StringSelectMenuBuilder()
        .setCustomId('config:section')
        .setPlaceholder('Choose a configuration section')
        .addOptions({ label: 'Embeds', value: 'embeds', description: 'Preview and edit embed text and banners', emoji: '📝' });
    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}

function embedLibraryView() {
    const embed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle('Embed Configuration')
        .setDescription('Choose an embed below. The bot will show you a private preview with controls to edit and save its text.')
        .setFooter({ text: 'This menu and every preview are visible only to you.' });
    const select = new StringSelectMenuBuilder()
        .setCustomId('config:panel')
        .setPlaceholder('Choose an embed to preview')
        .addOptions(panels.map(value => ({ label: panelName(value), value })));
    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}

function previewValues(panel: ConfigurablePanel, userId: string): Record<string, string> {
    if (panel === 'ticket') return {
        opener: `<@${userId}>`, staff: '@Staff Team', ticket_id: 'TICKET-000570', inquiry: 'Example ticket inquiry', category: 'General Support',
    };
    if (panel === 'infraction') return {
        member: `<@${userId}>`, action: 'Warning II', reason: 'Example misconduct reason', issuer: `<@${userId}>`, appeal_status: 'Appealable', case_id: 'INF-0001', notes: 'Example notes',
    };
    return {
        promoter: `<@${userId}>`, member: `<@${userId}>`, old_role: 'None', new_role: '@Supervisor', notes: 'Example promotion notes', effective_date: 'Immediately', issuer: `<@${userId}>`,
    };
}

function editorView(panel: ConfigurablePanel, config: PanelConfig, userId: string, customBannerUrl?: string | null, notice?: string) {
    const controlsEmbed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(`Bot Configuration • ${panelName(panel)}`)
        .setDescription([
            notice ? `**${notice}**\n` : '',
            `**Custom banner:** ${config.bannerMessageId ? 'Configured' : 'Using the included default banner'}`,
            `**Available placeholders:** ${placeholders(panel)}`,
            '',
            'The embed below is your private preview. Press **Edit Text**, make your changes, then press **Save Changes**. To replace its banner, run `/config panel:<panel> banner:<image>` and attach the image.',
        ].join('\n'))
        .setFooter({ text: 'Changes are stored privately in #bot-config.' });
    const values = previewValues(panel, userId);
    const previewEmbed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(applyTemplate(config.title, values))
        .setDescription(applyTemplate(config.description, values))
        .setFooter({ text: `${panelName(panel)} • Private Preview` });
    if (customBannerUrl) previewEmbed.setImage(customBannerUrl);
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`config:edit:${panel}`).setLabel('Edit Text').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`config:save:${panel}`).setLabel('Save Changes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`config:reset:${panel}`).setLabel('Reset Draft').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('config:back:embeds').setLabel('Back').setStyle(ButtonStyle.Secondary),
    );
    return {
        embeds: [controlsEmbed, previewEmbed],
        components: [buttons],
    };
}

async function privateEditorView(guild: NonNullable<ChatInputCommandInteraction['guild']>, panel: ConfigurablePanel, config: PanelConfig, userId: string, notice?: string) {
    const customBannerUrl = await getPanelBannerUrl(guild, config);
    return editorView(panel, config, userId, customBannerUrl, notice);
}

export const configCommand = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Open the private bot configuration editor')
        .addStringOption(option => option
            .setName('panel')
            .setDescription('Panel whose banner you want to replace')
            .addChoices(
                { name: 'Ticket Opening', value: 'ticket' },
                { name: 'Staff Infraction', value: 'infraction' },
                { name: 'Staff Promotion', value: 'promotion' },
            ))
        .addAttachmentOption(option => option.setName('banner').setDescription('Drag and attach the new panel banner')),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild || !authorized(interaction)) {
            await interaction.reply({ content: 'Only the server owner, administrators, or the configured bot-management role can use `/config`.', flags: MessageFlags.Ephemeral });
            return;
        }
        const selectedOption = interaction.options.getString('panel');
        const selected = selectedOption || 'ticket';
        const panel = isPanel(selected) ? selected : 'ticket';
        const banner = interaction.options.getAttachment('banner');
        if (!selectedOption && !banner) {
            await interaction.reply({ ...homeView(), flags: MessageFlags.Ephemeral });
            return;
        }
        let config = await getPanelConfig(interaction.guild, panel);
        let notice: string | undefined;
        if (banner) {
            if (!banner.contentType?.startsWith('image/')) {
                await interaction.reply({ content: 'The banner attachment must be an image.', flags: MessageFlags.Ephemeral });
                return;
            }
            const saved = await savePanelConfig(interaction.guild, panel, config, banner as Attachment);
            config = saved.config;
            notice = saved.persistent ? 'Banner saved successfully.' : 'Banner saved for this runtime; give the bot Manage Channels for permanent storage.';
        }
        drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config: { ...config } });
        await interaction.reply({ ...await privateEditorView(interaction.guild, panel, config, interaction.user.id, notice), flags: MessageFlags.Ephemeral });
    },
};

export async function handleConfigSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'config:section' && interaction.customId !== 'config:panel') return false;
    if (!interaction.guild || !authorized(interaction)) {
        await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.customId === 'config:section') {
        await interaction.update(embedLibraryView());
        return true;
    }
    const panel = isPanel(interaction.values[0]) ? interaction.values[0] : 'ticket';
    const config = await getPanelConfig(interaction.guild, panel);
    drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config: { ...config } });
    await interaction.update(await privateEditorView(interaction.guild, panel, config, interaction.user.id));
    return true;
}

export async function handleConfigButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:')) return false;
    if (!interaction.guild || !authorized(interaction)) {
        await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const [, action, rawPanel] = interaction.customId.split(':');
    if (action === 'back' && rawPanel === 'embeds') {
        await interaction.update(embedLibraryView());
        return true;
    }
    const panel = isPanel(rawPanel) ? rawPanel : 'ticket';
    const key = draftKey(interaction.guild.id, interaction.user.id);
    const current = drafts.get(key)?.panel === panel ? drafts.get(key)!.config : await getPanelConfig(interaction.guild, panel);
    if (action === 'edit') {
        const modal = new ModalBuilder().setCustomId(`config:modal:${panel}`).setTitle(`Edit ${panelName(panel)}`).addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('title').setLabel('Embed title').setStyle(TextInputStyle.Short).setMaxLength(256).setValue(current.title).setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('description').setLabel('Message template').setStyle(TextInputStyle.Paragraph).setMaxLength(1400).setValue(current.description).setRequired(true)),
        );
        await interaction.showModal(modal);
        return true;
    }
    if (action === 'save') {
        const saved = await savePanelConfig(interaction.guild, panel, current);
        drafts.set(key, { panel, config: { ...saved.config } });
        await interaction.update(await privateEditorView(interaction.guild, panel, saved.config, interaction.user.id, saved.persistent ? 'Changes saved successfully.' : 'Saved for this runtime only. Give the bot Manage Channels for permanent storage.'));
        return true;
    }
    if (action === 'reset') {
        const config = await getPanelConfig(interaction.guild, panel);
        drafts.set(key, { panel, config: { ...config } });
        await interaction.update(await privateEditorView(interaction.guild, panel, config, interaction.user.id, 'Unsaved changes were discarded.'));
        return true;
    }
    return false;
}

export async function handleConfigModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:modal:')) return false;
    if (!interaction.guild || !authorized(interaction)) {
        await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const rawPanel = interaction.customId.split(':')[2];
    const panel = isPanel(rawPanel) ? rawPanel : 'ticket';
    const old = await getPanelConfig(interaction.guild, panel);
    const config: PanelConfig = {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        bannerMessageId: drafts.get(draftKey(interaction.guild.id, interaction.user.id))?.config.bannerMessageId || old.bannerMessageId,
    };
    drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config });
    const view = await privateEditorView(interaction.guild, panel, config, interaction.user.id, 'Draft updated. Press Save Changes to make it permanent.');
    if (interaction.isFromMessage()) await interaction.update(view);
    else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
    return true;
}
