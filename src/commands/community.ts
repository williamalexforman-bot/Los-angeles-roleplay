import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    ColorResolvable,
    ContainerBuilder,
    EmbedBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    type Message,
    type SendableChannels,
} from 'discord.js';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { BRAND, CHANNEL_IDS, PARTNERSHIP_ROLE_ID } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';

const BRAND_COLOR = BRAND.color;
const BRAND_FOOTER = BRAND.footer;
const LOGO_NAME = BRAND.logoName;

const MOVIE_FEEDBACK_CHANNEL_ID = process.env.MOVIE_FEEDBACK_CHANNEL_ID || '1528933044310904884';
const STAFF_FEEDBACK_CHANNEL_ID = process.env.STAFF_FEEDBACK_CHANNEL_ID || '1526041844515868745';
const PRIVATE_AUDIT_CHANNEL_ID =
    process.env.PRIVATE_AUDIT_LOG_CHANNEL_ID ||
    process.env.AUDIT_LOG_CHANNEL_ID ||
    process.env.DISCORD_COMMAND_LOG_CHANNEL_ID ||
    '1528917592604020917';
const PARTNERSHIP_APPROVAL_CHANNEL_ID = process.env.PARTNERSHIP_APPROVAL_CHANNEL_ID || '1526042350802043022';
const PARTNERSHIP_UNDERBANNER_NAME = 'underbanner.webp';
const PARTNERSHIP_UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', PARTNERSHIP_UNDERBANNER_NAME);

function brandedEmbed(title?: string, description?: string, color: ColorResolvable = BRAND_COLOR, includeLogo = true): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setFooter({ text: BRAND_FOOTER })
        .setTimestamp();
    if (includeLogo) embed.setThumbnail(`attachment://${LOGO_NAME}`);
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    return embed;
}

function logoAttachment() {
    return createLogoAttachment();
}

async function getSendableChannel(
    interaction: { client: Client },
    channelId: string,
): Promise<SendableChannels | null> {
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    return channel?.isSendable() ? channel : null;
}

async function sendPrivateAudit(
    interaction: ChatInputCommandInteraction,
    submissionType: string,
    destinationChannelId: string,
    anonymous: boolean,
    submissionFields: Array<{ name: string; value: string; inline?: boolean }>,
): Promise<boolean> {
    const channel = await getSendableChannel(interaction, PRIVATE_AUDIT_CHANNEL_ID);
    if (!channel) return false;

    const auditEmbed = brandedEmbed(`Private Audit | ${submissionType}`).addFields(
        { name: 'Submitted By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Discord ID', value: interaction.user.id, inline: true },
        { name: 'Anonymous Publicly', value: anonymous ? 'Yes' : 'No', inline: true },
        { name: 'Public Destination', value: `<#${destinationChannelId}>`, inline: true },
        ...submissionFields,
    );

    try {
        await channel.send({ embeds: [auditEmbed], allowedMentions: { parse: [] } });
        return true;
    } catch (error) {
        console.error('[Community] Unable to write the private submission audit.', error);
        return false;
    }
}

const movieFeedbackCommand = {
    data: new SlashCommandBuilder()
        .setName('movie-feedback')
        .setDescription('Submit feedback about a movie')
        .addStringOption(option =>
            option
                .setName('movie')
                .setDescription('The movie you are reviewing')
                .setRequired(true)
                .setMaxLength(256),
        )
        .addStringOption(option =>
            option
                .setName('when')
                .setDescription('When the movie is being shown')
                .setRequired(true)
                .setMaxLength(100),
        )
        .addStringOption(option =>
            option
                .setName('where')
                .setDescription('Where the movie is being shown')
                .setRequired(true)
                .setMaxLength(256),
        )
        .addIntegerOption(option =>
            option
                .setName('rating')
                .setDescription('Your rating from 1 to 10')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(10),
        )
        .addBooleanOption(option =>
            option
                .setName('anonymous')
                .setDescription('Hide your identity from the public feedback embed'),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const movie = interaction.options.getString('movie', true);
            const when = interaction.options.getString('when', true);
            const where = interaction.options.getString('where', true);
            const rating = interaction.options.getInteger('rating', true);
            const anonymous = interaction.options.getBoolean('anonymous') ?? false;
            const destination = await getSendableChannel(interaction, MOVIE_FEEDBACK_CHANNEL_ID);

            if (!destination) {
                await interaction.editReply('The movie feedback channel is unavailable. Please contact an administrator.');
                return;
            }

            const submitter = anonymous ? 'Anonymous' : interaction.user.username;
            const publicEmbed = brandedEmbed('🎬 Movie Feedback')
                .setFooter({ text: `Submitted by ${submitter} • ${BRAND_FOOTER}` })
                .addFields(
                    { name: '🎥 Movie', value: movie, inline: true },
                    { name: '📅 When', value: when, inline: true },
                    { name: '📍 Where', value: where, inline: true },
                    { name: '⭐ Rating', value: `${'⭐'.repeat(rating)}\n**${rating}/10**` },
                );

            await destination.send({
                embeds: [publicEmbed],
                files: [logoAttachment()],
                allowedMentions: { parse: [] },
            });

            await sendPrivateAudit(
                interaction,
                'Movie Feedback',
                MOVIE_FEEDBACK_CHANNEL_ID,
                anonymous,
                [
                    { name: 'Movie', value: movie },
                    { name: 'When', value: when, inline: true },
                    { name: 'Where', value: where, inline: true },
                    { name: 'Rating', value: `${rating}/10`, inline: true },
                ],
            ).catch(() => undefined);

            await interaction.editReply('Your movie feedback has been submitted successfully.');
        } catch (error) {
            console.error('[Community] Movie feedback submission failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to submit your movie feedback right now. Please try again later.');
        }
    },
};

const staffFeedbackCommand = {
    data: new SlashCommandBuilder()
        .setName('staff-feedback')
        .setDescription('Submit feedback about a staff member')
        .addUserOption(option =>
            option
                .setName('staff-member')
                .setDescription('The staff member receiving feedback')
                .setRequired(true),
        )
        .addIntegerOption(option =>
            option
                .setName('rating')
                .setDescription('Your rating from 1 to 10')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(10),
        )
        .addStringOption(option =>
            option
                .setName('feedback')
                .setDescription('Your feedback for the staff member')
                .setRequired(true)
                .setMaxLength(1024),
        )
        .addBooleanOption(option =>
            option
                .setName('anonymous')
                .setDescription('Hide your identity from the public feedback embed'),
        )
        .addStringOption(option =>
            option
                .setName('evidence')
                .setDescription('Optional evidence link or supporting information')
                .setMaxLength(1024),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const staffMember = interaction.options.getUser('staff-member', true);
            const rating = interaction.options.getInteger('rating', true);
            const feedback = interaction.options.getString('feedback', true);
            const evidence = interaction.options.getString('evidence') || 'No evidence supplied.';
            const anonymous = interaction.options.getBoolean('anonymous') ?? false;
            const destination = await getSendableChannel(interaction, STAFF_FEEDBACK_CHANNEL_ID);

            if (!destination) {
                await interaction.editReply('The staff feedback channel is unavailable. Please contact an administrator.');
                return;
            }

            const submittedAt = Math.floor(Date.now() / 1000);
            const publicEmbed = brandedEmbed('💬 Staff Feedback').addFields(
                { name: 'Staff Member', value: `<@${staffMember.id}>`, inline: true },
                { name: 'Rating', value: `${rating}/10`, inline: true },
                { name: 'Submitted By', value: anonymous ? 'Anonymous' : `<@${interaction.user.id}>`, inline: true },
                { name: 'Feedback', value: feedback },
                { name: 'Evidence', value: evidence },
                { name: 'Submitted', value: `<t:${submittedAt}:F>` },
            );

            await destination.send({
                content: `📬 Staff Feedback for <@${staffMember.id}>`,
                embeds: [publicEmbed],
                files: [logoAttachment()],
                allowedMentions: { users: [staffMember.id], parse: [] },
            });

            const auditWritten = await sendPrivateAudit(
                interaction,
                'Staff Feedback',
                STAFF_FEEDBACK_CHANNEL_ID,
                anonymous,
                [
                    { name: 'Staff Member', value: `<@${staffMember.id}>`, inline: true },
                    { name: 'Rating', value: `${rating}/10`, inline: true },
                    { name: 'Feedback', value: feedback },
                    { name: 'Evidence', value: evidence },
                ],
            );

            await interaction.editReply(
                auditWritten
                    ? 'Your staff feedback has been submitted successfully.'
                    : 'Your staff feedback was posted, but the private audit log is currently unavailable.',
            );
        } catch (error) {
            console.error('[Community] Staff feedback submission failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to submit your staff feedback right now. Please try again later.');
        }
    },
};

const PARTNERSHIP_PANEL_TEXT = [
    'Thank you for choosing to partner with LARP!',
    '',
    'We have a few rules about partnering with us:',
    '- You must stay in the server the whole time; leaving will delete your partnership.',
    '- You must post our partnership in your server; deleting it from your server will result in an **INSTANT deletion**.',
    '',
    'Perks of partnering with us:',
    '- Gain the partnership role.',
    '- Show everyone that you are a proud partner of LARP!',
    '',
    'Please wait as we review your request.',
].join('\n');

function partnershipSeparator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function partnershipUnderbanner(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${PARTNERSHIP_UNDERBANNER_NAME}`),
    );
}

function partnershipUnderbannerAttachment(): AttachmentBuilder {
    return new AttachmentBuilder(PARTNERSHIP_UNDERBANNER_PATH, { name: PARTNERSHIP_UNDERBANNER_NAME });
}

function buildPartnershipLauncherPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0x3b82f6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## 🤝 Partnership Request\n${PARTNERSHIP_PANEL_TEXT}`),
        )
        .addActionRowComponents(...partnershipPanelComponents())
        .addSeparatorComponents(partnershipSeparator())
        .addMediaGalleryComponents(partnershipUnderbanner());
}

function partnershipPanelComponents(disabled = false): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('partnership:open')
                .setLabel('Submit Partnership Request')
                .setEmoji('🤝')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),
        ),
    ];
}

function partnershipRequestModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId('partnership:request-modal')
        .setTitle('Partnership Request')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('server_name')
                .setLabel('Server name')
                .setPlaceholder('Los Angeles Roleplay')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(100)
                .setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('representative')
                .setLabel('Server representative')
                .setPlaceholder('Your Discord username')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(100)
                .setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('invite_link')
                .setLabel('Permanent invite link')
                .setPlaceholder('https://discord.gg/example')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(500)
                .setRequired(true)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
                .setCustomId('server_ad')
                .setLabel('Server advertisement')
                .setPlaceholder('Tell us about your server and community.')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(4000)
                .setRequired(true)),
        );
}

function partnershipReviewComponents(submitterId: string, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`partnership:approve:${submitterId}`)
                .setLabel('Approve')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`partnership:deny:${submitterId}`)
                .setLabel('Deny')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled),
        ),
    ];
}

interface PartnershipRequestData {
    serverName: string;
    representative: string;
    inviteLink: string;
    serverAd: string;
    submitterId: string;
    submitterTag?: string;
}

function partnershipDetails(
    data: PartnershipRequestData,
    status: 'Pending Review' | 'Approved' | 'Denied',
    reviewerId?: string,
): string {
    return [
        `## ${status === 'Approved' ? '✅ Partnership Approved' : status === 'Denied' ? '❌ Partnership Denied' : '🤝 Partnership Request'}`,
        `> **Server Name:** ${data.serverName}`,
        `> **Representative:** ${data.representative}`,
        `> **Invite Link:** [Join Server](${data.inviteLink})`,
        `> **Submitted By:** <@${data.submitterId}>${data.submitterTag ? ` • ${data.submitterTag}` : ''}`,
        `> **Status:** \`${status}\`${reviewerId ? ` • Reviewed by <@${reviewerId}>` : ''}`,
    ].join('\n');
}

function buildPartnershipRequestPanel(data: PartnershipRequestData): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0x3b82f6)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(partnershipDetails(data, 'Pending Review')))
        .addSeparatorComponents(partnershipSeparator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📢 Full Advertisement'))
        // The advertisement has its own component so all 4,000 modal
        // characters are retained instead of being shortened for metadata.
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(data.serverAd))
        .addActionRowComponents(...partnershipReviewComponents(data.submitterId))
        .addSeparatorComponents(partnershipSeparator())
        .addMediaGalleryComponents(partnershipUnderbanner());
}

function buildApprovedPartnershipPanel(data: PartnershipRequestData, reviewerId: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0x22c55e)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(partnershipDetails(data, 'Approved', reviewerId)))
        .addSeparatorComponents(partnershipSeparator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📢 Full Advertisement'))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(data.serverAd))
        .addSeparatorComponents(partnershipSeparator())
        .addMediaGalleryComponents(partnershipUnderbanner());
}

type PartnershipComponentNode = {
    components?: PartnershipComponentNode[];
    content?: string;
    custom_id?: string;
    disabled?: boolean;
    style?: number;
};

function partnershipComponentText(message: Message): string[] {
    const text: string[] = [];
    const visit = (node: PartnershipComponentNode): void => {
        if (typeof node.content === 'string') text.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components) visit(component.toJSON() as PartnershipComponentNode);
    return text;
}

function detailValue(details: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return details.match(new RegExp(`^> \\*\\*${escaped}:\\*\\* (.+)$`, 'm'))?.[1]?.trim() || '';
}

function partnershipDataFromMessage(message: Message, submitterId: string): PartnershipRequestData | null {
    const text = partnershipComponentText(message);
    const details = text.find(content => content.includes('**Server Name:**'));
    const adHeading = text.findIndex(content => content === '## 📢 Full Advertisement');
    if (details && adHeading >= 0 && text[adHeading + 1]) {
        const inviteValue = detailValue(details, 'Invite Link');
        const inviteLink = inviteValue.match(/\((https:\/\/[^)]+)\)/)?.[1] || inviteValue;
        const data = {
            serverName: detailValue(details, 'Server Name'),
            representative: detailValue(details, 'Representative'),
            inviteLink,
            serverAd: text[adHeading + 1],
            submitterId,
        };
        if (data.serverName && data.representative && partnershipInviteIsValid(data.inviteLink)) return data;
    }

    // Requests submitted before the V2 rollout remain reviewable. Their ad
    // may already have been shortened by the legacy embed and cannot be
    // reconstructed beyond what Discord stored.
    const legacy = message.embeds[0];
    if (!legacy) return null;
    const field = (name: string) => legacy.fields.find(candidate => candidate.name === name)?.value || '';
    const inviteValue = field('Invite Link');
    const inviteLink = inviteValue.match(/\((https:\/\/[^)]+)\)/)?.[1] || inviteValue;
    const serverAd = (legacy.description || '').replace(/^📢 \*\*Advertisement\*\*\n\n/, '');
    return {
        serverName: field('Server Name') || 'Unknown',
        representative: field('Representative') || 'Unknown',
        inviteLink,
        serverAd: serverAd || 'Advertisement unavailable for this legacy request.',
        submitterId,
    };
}

function reviewedPartnershipComponents(message: Message, approved: boolean, reviewerId: string): unknown[] {
    const components = message.components.map(component => component.toJSON()) as PartnershipComponentNode[];
    const status = approved ? 'Approved' : 'Denied';
    const visit = (node: PartnershipComponentNode): void => {
        if (typeof node.content === 'string' && node.content.includes('> **Status:**')) {
            node.content = node.content.replace(
                /> \*\*Status:\*\*[^\n]*/,
                `> **Status:** \`${status}\` • Reviewed by <@${reviewerId}>`,
            );
            if (node.content.startsWith('## ')) {
                node.content = node.content.replace(/^## .+/, `## ${approved ? '✅ Partnership Approved' : '❌ Partnership Denied'}`);
            }
        }
        if (node.custom_id?.startsWith('partnership:approve:') || node.custom_id?.startsWith('partnership:deny:')) {
            const selected = node.custom_id.startsWith(approved ? 'partnership:approve:' : 'partnership:deny:');
            node.disabled = true;
            node.style = selected ? (approved ? ButtonStyle.Success : ButtonStyle.Danger) : ButtonStyle.Secondary;
        }
        for (const child of node.components || []) visit(child);
    };
    components.forEach(visit);
    return components;
}

function isPartnershipStaff(interaction: ButtonInteraction): boolean {
    if (!interaction.guildId) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    const member = interaction.member;
    const roleIds = member && 'roles' in member
        ? (Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()])
        : [];
    const configuredRoleIds = [
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
        process.env.GENERAL_SUPPORT_ROLE_ID,
    ].filter((roleId): roleId is string => Boolean(roleId));
    return configuredRoleIds.some(roleId => roleIds.includes(roleId));
}

function partnershipInviteIsValid(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && (url.hostname === 'discord.gg' || url.hostname === 'discord.com')
            && (url.hostname === 'discord.gg' || url.pathname.startsWith('/invite/'));
    } catch {
        return false;
    }
}

const partnershipCommand = {
    data: new SlashCommandBuilder()
        .setName('partnership')
        .setDescription('Post or submit a LARP partnership request')
        .addSubcommand(subcommand => subcommand
            .setName('request')
            .setDescription('Post the professional partnership request panel in this channel')),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const destination = interaction.channel;
        if (!destination?.isSendable()) {
            await interaction.editReply('This channel cannot receive the partnership panel.');
            return;
        }
        await destination.send({
            components: [buildPartnershipLauncherPanel()],
            files: [partnershipUnderbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        await interaction.editReply('The partnership request panel has been posted in this channel.');
    },
};

const staffComplaintCommand = {
    data: new SlashCommandBuilder()
        .setName('staff-complaint')
        .setDescription('Submit a private complaint about a staff member')
        .addUserOption(option => option
            .setName('member')
            .setDescription('The staff member you are reporting')
            .setRequired(true))
        .addIntegerOption(option => option
            .setName('rating')
            .setDescription('Your rating from 1 to 5')
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(true))
        .addStringOption(option => option
            .setName('what')
            .setDescription('What did the staff member do?')
            .setMaxLength(4000)
            .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const staffMember = interaction.options.getUser('member', true);
            const rating = interaction.options.getInteger('rating', true);
            const whatTheyDid = interaction.options.getString('what', true);
            const destination = await getSendableChannel(interaction, CHANNEL_IDS.staffComplaints);
            if (!destination) {
                await interaction.editReply('The staff complaint channel is unavailable. Please contact an administrator.');
                return;
            }

            const stars = `${'⭐'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)`;
            const complaintEmbed = brandedEmbed('📋 Staff Complaint Received', undefined, 0xef4444)
                .addFields(
                    { name: '👤 Reported Staff Member', value: `<@${staffMember.id}>`, inline: false },
                    { name: '⭐ Rating', value: stars, inline: false },
                    { name: '📝 What They Did', value: whatTheyDid, inline: false },
                    { name: 'Submitted By', value: `<@${interaction.user.id}>`, inline: false },
                );

            await destination.send({
                embeds: [complaintEmbed],
                allowedMentions: { parse: [] },
            });
            await interaction.editReply('Your staff complaint has been submitted securely to the review team.');
        } catch (error) {
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to submit your staff complaint right now. Please try again later.');
        }
    },
};

export async function handleCommunityButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId === 'partnership:open') {
        await interaction.showModal(partnershipRequestModal());
        return true;
    }
    if (!interaction.customId.startsWith('partnership:approve:') && !interaction.customId.startsWith('partnership:deny:')) return false;
    if (!isPartnershipStaff(interaction)) {
        await interaction.reply({ content: 'Only authorized staff may review partnership requests.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const [action, submitterId] = interaction.customId.split(':').slice(1);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sourceMessage = interaction.message;
    const requestData = partnershipDataFromMessage(sourceMessage, submitterId);
    if (!requestData) {
        await interaction.editReply('I could not read the full partnership request. Please ask the member to submit it again.');
        return true;
    }
    const isV2Request = sourceMessage.components.some(component => component.toJSON().type === 17);
    if (action === 'approve') {
        const approvalChannel = await getSendableChannel(interaction, PARTNERSHIP_APPROVAL_CHANNEL_ID);
        if (!approvalChannel) {
            await interaction.editReply('The approved-partnership channel is unavailable, so this request was not approved. Please check the channel configuration and try again.');
            return true;
        }
        try {
            await approvalChannel.send({
                components: [buildApprovedPartnershipPanel(requestData, interaction.user.id)],
                files: [partnershipUnderbannerAttachment()],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], users: [submitterId, interaction.user.id] },
            });
        } catch {
            await interaction.editReply('I could not publish the complete advertisement, so this request was not approved. Check my permissions in the approved-partnership channel and try again.');
            return true;
        }

        let roleMessage = 'The partnership was approved.';
        if (PARTNERSHIP_ROLE_ID && interaction.guild) {
            const member = await interaction.guild.members.fetch(submitterId).catch(() => null);
            const role = await interaction.guild.roles.fetch(PARTNERSHIP_ROLE_ID).catch(() => null);
            if (member && role) {
                const assigned = await member.roles.add(role, `Partnership approved by ${interaction.user.tag}`)
                    .then(() => true)
                    .catch(() => false);
                if (!assigned) roleMessage = 'The partnership was approved and published, but the configured partnership role could not be assigned.';
            } else roleMessage = 'The partnership was approved and published, but the configured partnership role could not be assigned.';
        } else if (!PARTNERSHIP_ROLE_ID) {
            roleMessage = 'The partnership was approved and published, but PARTNERSHIP_ROLE_ID is not configured yet.';
        }
        if (isV2Request) {
            await sourceMessage.edit({
                components: reviewedPartnershipComponents(sourceMessage, true, interaction.user.id) as never,
                flags: MessageFlags.IsComponentsV2,
                attachments: Array.from(sourceMessage.attachments.values()),
            });
        } else {
            const currentEmbed = EmbedBuilder.from(sourceMessage.embeds[0]);
            currentEmbed.setColor(0x22c55e).setFooter({ text: `✅ Approved by ${interaction.user.tag} • ${BRAND_FOOTER}` });
            await sourceMessage.edit({ embeds: [currentEmbed], components: partnershipReviewComponents(submitterId, true) });
        }

        await interaction.editReply(roleMessage);
        return true;
    }

    if (isV2Request) {
        await sourceMessage.edit({
            components: reviewedPartnershipComponents(sourceMessage, false, interaction.user.id) as never,
            flags: MessageFlags.IsComponentsV2,
            attachments: Array.from(sourceMessage.attachments.values()),
        });
    } else {
        const currentEmbed = EmbedBuilder.from(sourceMessage.embeds[0]);
        currentEmbed.setColor(0xef4444).setFooter({ text: `❌ Denied by ${interaction.user.tag} • ${BRAND_FOOTER}` });
        await sourceMessage.edit({ embeds: [currentEmbed], components: partnershipReviewComponents(submitterId, true) });
    }
    await interaction.editReply('The partnership request was denied.');
    return true;
}

export async function handleCommunityModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.customId !== 'partnership:request-modal') return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const serverName = interaction.fields.getTextInputValue('server_name').trim();
        const representative = interaction.fields.getTextInputValue('representative').trim();
        const inviteLink = interaction.fields.getTextInputValue('invite_link').trim();
        const serverAd = interaction.fields.getTextInputValue('server_ad').trim();
        if (!partnershipInviteIsValid(inviteLink)) {
            await interaction.editReply('Please provide a valid HTTPS Discord invite link (discord.gg or discord.com/invite).');
            return true;
        }
        const destination = await getSendableChannel(interaction, CHANNEL_IDS.partnershipRequests);
        if (!destination) {
            await interaction.editReply('The partnership review channel is unavailable. Please contact an administrator.');
            return true;
        }

        const requestData: PartnershipRequestData = {
            serverName,
            representative,
            inviteLink,
            serverAd,
            submitterId: interaction.user.id,
            submitterTag: interaction.user.tag,
        };
        await destination.send({
            components: [buildPartnershipRequestPanel(requestData)],
            files: [partnershipUnderbannerAttachment()],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        await interaction.editReply('Your partnership request was submitted for review.');
        return true;
    } catch (error) {
        console.error('[Community] Partnership request submission failed.', error);
        await interaction.editReply('Unable to submit your partnership request right now. Please try again later.');
        return true;
    }
}

export const communityCommands = [movieFeedbackCommand, staffFeedbackCommand, partnershipCommand, staffComplaintCommand];
