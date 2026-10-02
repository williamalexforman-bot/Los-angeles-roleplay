import {
    ActionRowBuilder, Attachment, ButtonBuilder, ButtonInteraction, ButtonStyle,
    ChannelSelectMenuBuilder, ChannelSelectMenuInteraction, ChatInputCommandInteraction, ContainerBuilder, GuildMember, MediaGalleryBuilder,
    MediaGalleryItemBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction,
    PermissionFlagsBits, RoleSelectMenuBuilder, RoleSelectMenuInteraction, SeparatorBuilder, SlashCommandBuilder, StringSelectMenuBuilder,
    StringSelectMenuInteraction, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { BRAND } from '../config/constants';
import {
    CONFIG_CHANNEL_KEYS, CONFIG_ROLE_KEYS, DEFAULT_PANEL_CONFIGS, applyTemplate, getGuildBotConfig,
    getPanelBannerUrl, getPanelConfig, parseEmojiMap, parseSessionEmojis, saveGuildBotConfig,
    savePanelConfig, type ConfigChannelKey, type ConfigRoleKey, type ConfigurablePanel, type PanelConfig,
} from '../services/panelConfig';
import { postAllPanels } from './panels';
import { emojiPackProgressPanel, installEmojiPack } from './emojiAd';

const panels: ConfigurablePanel[] = ['ticket_panel', 'ticket', 'dashboard', 'regulations', 'application', 'infraction', 'promotion', 'session', 'welcome', 'staff_guide'];
const drafts = new Map<string, { panel: ConfigurablePanel; config: PanelConfig }>();

function draftKey(guildId: string, userId: string): string { return `${guildId}:${userId}`; }
function isPanel(value: string): value is ConfigurablePanel { return panels.includes(value as ConfigurablePanel); }

async function authorized(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const roleId = (await getGuildBotConfig(interaction.guild)).roles.bot_permissions || process.env.BOT_PERMISSIONS_ROLE_ID;
    return Boolean(roleId && interaction.member instanceof GuildMember && interaction.member.roles.cache.has(roleId));
}

function panelName(panel: ConfigurablePanel): string {
    if (panel === 'ticket') return 'Ticket Opening';
    if (panel === 'ticket_panel') return 'Ticket Panel';
    if (panel === 'dashboard') return 'Dashboard Panel';
    if (panel === 'regulations') return 'Regulations Panel';
    if (panel === 'application') return 'Application Panel';
    if (panel === 'infraction') return 'Staff Infraction';
    if (panel === 'promotion') return 'Staff Promotion';
    if (panel === 'welcome') return 'Welcome Message';
    if (panel === 'staff_guide') return 'Staff Guide';
    return 'Session Panel';
}

function placeholders(panel: ConfigurablePanel): string {
    if (panel === 'ticket') return '`{opener}` `{staff}` `{ticket_id}` `{inquiry}` `{category}`';
    if (panel === 'infraction') return '`{member}` `{action}` `{reason}` `{issuer}` `{appeal_status}` `{case_id}` `{notes}`';
    if (panel === 'promotion') return '`{promoter}` `{member}` `{old_role}` `{new_role}` `{notes}` `{effective_date}` `{issuer}`';
    if (panel === 'dashboard') return '`{members}` `{owner}` `{created}`';
    if (panel === 'application') return '`{applicant}` `{submitted}`';
    if (panel === 'welcome') return '`{member}` `{server}` `{member_count}`';
    if (panel === 'staff_guide') return 'No placeholders required';
    return '`{updated}` `{staff}` `{players}` `{maximum}` `{queue}` `{status}`';
}

function homeView() {
    const select = new StringSelectMenuBuilder().setCustomId('config:section')
        .setPlaceholder('Choose a configuration section')
        .addOptions(
            { label: 'Embeds & Panels', value: 'embeds', description: 'Edit V2 panels, banners, emojis, and questions', emoji: '📝' },
            { label: 'Channels', value: 'channels', description: 'Choose where panels, logs, and results are sent', emoji: '📁' },
            { label: 'Roles & Permissions', value: 'roles', description: 'Assign staff, support, and command roles', emoji: '🛡️' },
            { label: 'Create Managed Role', value: 'managed_role', description: 'Create a role with a purpose and permissions', emoji: '➕' },
        );
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '# Bot Configuration',
            'Configure California State Roleplay’s panels, channels, staff roles, questions, banners, and server emojis. **Post All Panels** updates each panel and fills any gaps.',
            '', '-# Only you can see this configuration menu.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('config:post-all').setLabel('Post All Panels').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('config:install-emojis').setLabel('Install Emoji Pack').setStyle(ButtonStyle.Secondary),
        ));
    return { components: [container] };
}

const channelLabels: Record<ConfigChannelKey, string> = {
    ticket_panel: 'Ticket Panel', ticket_transcripts: 'Ticket Transcripts', regulations: 'Regulations', dashboard: 'Dashboard',
    sessions: 'Sessions', application_panel: 'Application Panel', application_reviews: 'Application Reviews', staff_guide: 'Staff Guide', verification_logs: 'Verification Logs', infractions: 'Infractions', promotions: 'Promotions', command_logs: 'Command Logs',
    welcome: 'Welcome Messages',
    general_ticket_category: 'General Ticket Category', internal_ticket_category: 'Internal Affairs Category',
    management_ticket_category: 'Management Ticket Category', highrank_ticket_category: 'High-Rank Ticket Category',
};

const roleLabels: Record<ConfigRoleKey, string> = {
    bot_permissions: 'Bot Permissions', staff: 'Staff Team', general_support: 'General Support', internal_affairs: 'Internal Affairs',
    management: 'Management', high_rank: 'High Rank', application_reviewer: 'Application Reviewer', session_host: 'Session Host',
    on_duty: 'On Duty', on_break: 'On Break',
    infraction_warning: 'Infraction: Warning (legacy)', infraction_warning_1: 'Infraction: Warning 1', infraction_warning_2: 'Infraction: Warning 2',
    infraction_strike: 'Infraction: Strike (legacy)', infraction_strike_1: 'Infraction: Strike 1', infraction_strike_2: 'Infraction: Strike 2',
    infraction_suspension: 'Infraction: Suspension', infraction_demotion: 'Infraction: Demotion',
    infraction_termination: 'Infraction: Termination (legacy)', infraction_terminated: 'Infraction: Terminated',
    infraction_blacklist: 'Infraction: Blacklist (legacy)', infraction_blacklisted: 'Infraction: Blacklisted',
    verification_verified: 'Verification: Verified Role', verification_unverified: 'Verification: Unverified Role',
};

function channelConfigView() {
    const select = new StringSelectMenuBuilder().setCustomId('config:channel-purpose').setPlaceholder('Choose what channel to configure')
        .addOptions(CONFIG_CHANNEL_KEYS.map(value => ({ label: channelLabels[value], value })));
    return { components: [new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('# Channel Configuration\nChoose a destination or ticket category, then select it on the next page.'))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))] };
}

function roleConfigView() {
    const select = new StringSelectMenuBuilder().setCustomId('config:role-purpose').setPlaceholder('Choose what role to configure')
        .addOptions(CONFIG_ROLE_KEYS.map(value => ({ label: roleLabels[value], value })));
    return { components: [new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('# Role & Permission Configuration\nChoose a role purpose, then select the Discord role on the next page.'))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))] };
}

function channelPickerView(key: ConfigChannelKey) {
    const select = new ChannelSelectMenuBuilder().setCustomId(`config:channel:${key}`).setPlaceholder(`Select ${channelLabels[key]}`).setMinValues(1).setMaxValues(1);
    return { components: [new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${channelLabels[key]}\nSelect the channel or category the bot should use.`))
        .addActionRowComponents(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select))] };
}

function rolePickerView(key: ConfigRoleKey) {
    const select = new RoleSelectMenuBuilder().setCustomId(`config:role:${key}`).setPlaceholder(`Select ${roleLabels[key]}`).setMinValues(1).setMaxValues(1);
    return { components: [new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${roleLabels[key]} Role\nSelect the role the bot should use for this purpose.`))
        .addActionRowComponents(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select))] };
}

function managedRoleModal(): ModalBuilder {
    return new ModalBuilder().setCustomId('config:managed-role').setTitle('Create Managed Role').addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Role name').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('purpose').setLabel('What is this role meant for?').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('permissions').setLabel('Permissions (comma separated)').setPlaceholder('ManageMessages, ModerateMembers, ViewAuditLog').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Hex color (optional)').setPlaceholder('#3B82F6').setStyle(TextInputStyle.Short).setMaxLength(7).setRequired(false)),
    );
}

function embedLibraryView() {
    const select = new StringSelectMenuBuilder().setCustomId('config:panel')
        .setPlaceholder('Choose a V2 message to preview')
        .addOptions(panels.map(value => ({ label: panelName(value), value })));
    const container = new ContainerBuilder()
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
    if (panel === 'dashboard') return { members: '1,250', owner: `<@${userId}>`, created: '<t:1700000000:D>' };
    if (panel === 'application') return { applicant: `<@${userId}>`, submitted: '<t:1770000000:R>' };
    if (panel === 'welcome') return { member: `<@${userId}>`, server: 'California State Roleplay', member_count: '1,250' };
    if (panel === 'session') return { updated: '<t:1770000000:R>', staff: '4', players: '28', maximum: '40', queue: '0', status: 'Online' };
    return {};
}

function editorView(panel: ConfigurablePanel, config: PanelConfig, userId: string, customBannerUrl?: string | null, notice?: string) {
    const values = previewValues(panel, userId);
    const emojis = parseSessionEmojis(config.emojiText);
    const emojiMap = parseEmojiMap(config.emojiText);
    const instructions = [
        `# Bot Configuration • ${panelName(panel)}`,
        notice ? `**${notice}**` : '',
        `**Custom banner:** ${config.bannerMessageId ? 'Configured' : 'Using the included default banner'}`,
        `**Available placeholders:** ${placeholders(panel)}`,
        `**Editable emojis:** ${Object.keys(emojiMap).join(', ') || 'title'}`,
        panel === 'application' ? `**Application questions:** ${(config.questions || '').split(/\r?\n/).filter(Boolean).length}` : '',
        panel === 'regulations' ? '**Rule text:** Editable for both Discord and in-game rules' : '',
        '', 'Press **Edit**, change the fields, then press **Save Changes**. To replace the banner, run `/config` with this panel selected and attach the image.',
    ].filter(Boolean).join('\n');
    const previewLines = [
        `# ${panel === 'session' ? `${emojis.title} ` : `${emojiMap.title || ''} `}${applyTemplate(config.title, values)}`,
        applyTemplate(config.description, values),
        panel === 'session' ? `\n${emojis.staff} **Staff Online:** ${values.staff}  •  ${emojis.players} **Players:** ${values.players}/${values.maximum}  •  ${emojis.queue} **Queue:** ${values.queue}\n${emojis.online} **Online**  •  ${emojis.offline} **Offline**  •  ${emojis.join} **Quick Join**` : '',
        '', `-# ${panelName(panel)} • Private V2 Preview`,
    ].filter(Boolean).join('\n');
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(instructions));
    if (customBannerUrl) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(customBannerUrl)));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(previewLines))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`config:edit:${panel}`).setLabel('Edit Text & Emojis').setStyle(ButtonStyle.Primary),
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
        if (!interaction.guild || !await authorized(interaction)) {
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
    if (!['config:section', 'config:panel', 'config:channel-purpose', 'config:role-purpose'].includes(interaction.customId)) return false;
    if (!interaction.guild || !await authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral }); return true; }
    if (interaction.customId === 'config:section') {
        const section = interaction.values[0];
        if (section === 'channels') { await interaction.update(channelConfigView()); return true; }
        if (section === 'roles') { await interaction.update(roleConfigView()); return true; }
        if (section === 'managed_role') { await interaction.showModal(managedRoleModal()); return true; }
        await interaction.update(embedLibraryView()); return true;
    }
    if (interaction.customId === 'config:channel-purpose') {
        const key = interaction.values[0] as ConfigChannelKey;
        if (!CONFIG_CHANNEL_KEYS.includes(key)) return false;
        await interaction.update(channelPickerView(key)); return true;
    }
    if (interaction.customId === 'config:role-purpose') {
        const key = interaction.values[0] as ConfigRoleKey;
        if (!CONFIG_ROLE_KEYS.includes(key)) return false;
        await interaction.update(rolePickerView(key)); return true;
    }
    const panel = isPanel(interaction.values[0]) ? interaction.values[0] : 'ticket';
    const config = await getPanelConfig(interaction.guild, panel);
    drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config: { ...config } });
    await interaction.update(await privateEditorView(interaction.guild, panel, config, interaction.user.id));
    return true;
}

export async function handleConfigButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:')) return false;
    if (!interaction.guild || !await authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral }); return true; }
    if (interaction.customId === 'config:install-emojis') {
        await interaction.reply({
            components: [emojiPackProgressPanel('Starting installation…')],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const result = await installEmojiPack(interaction.guild, interaction.user.tag, async content => {
            await interaction.editReply({ components: [emojiPackProgressPanel(content)] });
        });
        await interaction.editReply({ components: [result], allowedMentions: { parse: [] } });
        return true;
    }
    if (interaction.customId === 'config:post-all') {
        await interaction.deferUpdate();
        try {
            const result = await postAllPanels(interaction.guild);
            const lines = [
                result.updated.length ? `**Updated:** ${result.updated.join(', ')}` : '',
                result.posted.length ? `**Posted because missing:** ${result.posted.join(', ')}` : '',
                result.unavailable.length ? `**Skipped—configure a destination in Channels:** ${result.unavailable.join(', ')}` : '',
            ].filter(Boolean);
            await interaction.followUp({ content: lines.join('\n') || 'All configured panels are up to date.', flags: MessageFlags.Ephemeral });
        } catch (error) {
            await interaction.followUp({ content: `Panel update stopped: ${error instanceof Error ? error.message : 'Discord returned an error.'}`, flags: MessageFlags.Ephemeral });
        }
        return true;
    }
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
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
            .setCustomId('emojis').setLabel('Emojis (one key=value per line)').setStyle(TextInputStyle.Paragraph).setMaxLength(500)
            .setValue(current.emojiText || DEFAULT_PANEL_CONFIGS[panel].emojiText || 'title=✨').setRequired(true)));
        if (panel === 'application' || panel === 'regulations') modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
            .setCustomId('questions').setLabel(panel === 'application' ? 'Questions (one per line, maximum 5)' : 'Discord rules, then ---GAME---, then game rules')
            .setStyle(TextInputStyle.Paragraph).setMaxLength(3000)
            .setValue(current.questions || DEFAULT_PANEL_CONFIGS[panel].questions || '').setRequired(true)));
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
    if (interaction.customId === 'config:managed-role') {
        if (!interaction.guild || !await authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to create managed roles.', flags: MessageFlags.Ephemeral }); return true; }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const name = interaction.fields.getTextInputValue('name').trim();
        const purpose = interaction.fields.getTextInputValue('purpose').trim();
        const requested = interaction.fields.getTextInputValue('permissions').split(',').map(value => value.trim()).filter(Boolean);
        const permissionLookup = PermissionFlagsBits as unknown as Record<string, bigint>;
        const permissionNames = requested.filter(value => typeof permissionLookup[value] === 'bigint');
        const colorText = interaction.fields.getTextInputValue('color').trim().replace(/^#/, '');
        const color = /^[0-9a-f]{6}$/i.test(colorText) ? Number.parseInt(colorText, 16) : BRAND.color;
        const role = await interaction.guild.roles.create({
            name, color, permissions: permissionNames.map(value => permissionLookup[value]),
            reason: `Managed role created by ${interaction.user.tag}: ${purpose}`,
        });
        const guildConfig = await getGuildBotConfig(interaction.guild);
        guildConfig.managedRoles.push({ roleId: role.id, name: role.name, purpose, permissions: permissionNames });
        await saveGuildBotConfig(interaction.guild, guildConfig);
        await interaction.editReply(`Created ${role} for **${purpose}** with permissions: ${permissionNames.join(', ') || 'none'}.`);
        return true;
    }
    if (!interaction.customId.startsWith('config:modal:')) return false;
    if (!interaction.guild || !await authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to use this configuration editor.', flags: MessageFlags.Ephemeral }); return true; }
    const rawPanel = interaction.customId.split(':')[2];
    const panel = isPanel(rawPanel) ? rawPanel : 'ticket';
    const old = await getPanelConfig(interaction.guild, panel);
    const config: PanelConfig = {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        bannerMessageId: drafts.get(draftKey(interaction.guild.id, interaction.user.id))?.config.bannerMessageId || old.bannerMessageId,
        emojiText: interaction.fields.getTextInputValue('emojis'),
        questions: panel === 'application' || panel === 'regulations' ? interaction.fields.getTextInputValue('questions') : old.questions,
    };
    drafts.set(draftKey(interaction.guild.id, interaction.user.id), { panel, config });
    const view = await privateEditorView(interaction.guild, panel, config, interaction.user.id, 'Draft updated. Press Save Changes to make it permanent.');
    if (interaction.isFromMessage()) await interaction.update(view);
    else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    return true;
}

export async function handleConfigChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:channel:')) return false;
    if (!interaction.guild || !await authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to configure channels.', flags: MessageFlags.Ephemeral }); return true; }
    const key = interaction.customId.split(':')[2] as ConfigChannelKey;
    if (!CONFIG_CHANNEL_KEYS.includes(key)) return false;
    const config = await getGuildBotConfig(interaction.guild);
    config.channels[key] = interaction.values[0];
    await saveGuildBotConfig(interaction.guild, config);
    await interaction.update({ components: [new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Channel Saved\n**${channelLabels[key]}** will now use <#${interaction.values[0]}>.`))] });
    return true;
}

export async function handleConfigRoleSelect(interaction: RoleSelectMenuInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('config:role:')) return false;
    if (!interaction.guild || !await authorized(interaction)) { await interaction.reply({ content: 'You are not authorized to configure roles.', flags: MessageFlags.Ephemeral }); return true; }
    const key = interaction.customId.split(':')[2] as ConfigRoleKey;
    if (!CONFIG_ROLE_KEYS.includes(key)) return false;
    const config = await getGuildBotConfig(interaction.guild);
    config.roles[key] = interaction.values[0];
    await saveGuildBotConfig(interaction.guild, config);
    await interaction.update({ components: [new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Role Saved\n**${roleLabels[key]}** will now use <@&${interaction.values[0]}>.`))] });
    return true;
}
