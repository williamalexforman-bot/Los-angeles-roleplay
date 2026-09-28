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

function configView(panel: ConfigurablePanel, config: PanelConfig, notice?: string) {
    const embed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(`Bot Configuration • ${panelName(panel)}`)
        .setDescription([
            notice ? `**${notice}**\n` : '',
            '**Current title**',
            config.title,
            '',
            '**Current message template**',
            config.description,
            '',
            `**Custom banner:** ${config.bannerMessageId ? 'Configured' : 'Using the included default banner'}`,
            `**Available placeholders:** ${placeholders(panel)}`,
            '',
            'Use **Edit Wording** to change the title or message, then press **Save Changes**. To replace a banner, run `/config panel:<panel> banner:<image>` and attach the image.',
        ].join('\n'))
        .setFooter({ text: 'Changes are stored privately in #bot-config.' });
    const select = new StringSelectMenuBuilder()
        .setCustomId('config:select')
        .setPlaceholder('Choose an embed to configure')
        .addOptions(panels.map(value => ({ label: panelName(value), value, default: value === panel })));
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`config:edit:${panel}`).setLabel('Edit Wording').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`config:save:${panel}`).setLabel('Save Changes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`config:reset:${panel}`).setLabel('Reset Draft').setStyle(ButtonStyle.Secondary),
    );
    return {
        embeds: [embed],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), buttons],
    };
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
        const selected = interaction.options.getString('panel') || 'ticket';
        const panel = isPanel(selected) ? selected : 'ticket';
        const banner = interaction.options.getAttachment('banner');
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
        await interaction.reply({ ...configView(panel, config, notice), flags: MessageFlags.Ephemeral });
    },
};

export async function handleConfigSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'config:select') return false;
    if (!interaction.guild || !authorized(interaction)) {
        await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const panel = isPanel(interaction.values[0]) ? interaction.values[0] : 'ticket';
    const config = await getPanelConfig(interaction.guild, panel);
    drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config: { ...config } });
    await interaction.update(configView(panel, config));
    return true;
}

export async function handleConfigButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:')) return false;
    if (!interaction.guild || !authorized(interaction)) {
        await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const [, action, rawPanel] = interaction.customId.split(':');
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
        await interaction.update(configView(panel, saved.config, saved.persistent ? 'Changes saved successfully.' : 'Saved for this runtime only. Give the bot Manage Channels for permanent storage.'));
        return true;
    }
    if (action === 'reset') {
        const config = await getPanelConfig(interaction.guild, panel);
        drafts.set(key, { panel, config: { ...config } });
        await interaction.update(configView(panel, config, 'Unsaved changes were discarded.'));
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
    await interaction.reply({
        ...configView(panel, config, 'Draft updated. Press Save Changes to make it permanent.'),
        flags: MessageFlags.Ephemeral,
    });
    return true;
}
