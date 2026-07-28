import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    ColorResolvable,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
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

function partnershipEmbed(title?: string, description?: string, color: ColorResolvable = BRAND_COLOR): EmbedBuilder {
    return brandedEmbed(title, description, color, false);
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
                embeds: [publicEmbed],
                files: [logoAttachment()],
                allowedMentions: { parse: [] },
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

function partnershipPanelEmbed(): EmbedBuilder {
    return partnershipEmbed('🤝 Partnership Request', PARTNERSHIP_PANEL_TEXT, 0x3b82f6);
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
            embeds: [partnershipPanelEmbed()],
            components: partnershipPanelComponents(),
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
    const currentEmbed = sourceMessage.embeds[0] ? EmbedBuilder.from(sourceMessage.embeds[0]) : brandedEmbed('🤝 Partnership Request');
    if (action === 'approve') {
        let roleMessage = 'The partnership was approved.';
        if (PARTNERSHIP_ROLE_ID && interaction.guild) {
            const member = await interaction.guild.members.fetch(submitterId).catch(() => null);
            const role = await interaction.guild.roles.fetch(PARTNERSHIP_ROLE_ID).catch(() => null);
            if (member && role) await member.roles.add(role, `Partnership approved by ${interaction.user.tag}`);
            else roleMessage = 'The partnership was approved, but the configured partnership role could not be assigned.';
        } else if (!PARTNERSHIP_ROLE_ID) {
            roleMessage = 'The partnership was approved, but PARTNERSHIP_ROLE_ID is not configured yet.';
        }
        currentEmbed.setColor(0x22c55e).setFooter({ text: `✅ Approved by ${interaction.user.tag} • ${BRAND_FOOTER}` });
        await sourceMessage.edit({ embeds: [currentEmbed], components: partnershipReviewComponents(submitterId, true) });

        const approvalChannel = await getSendableChannel(interaction, PARTNERSHIP_APPROVAL_CHANNEL_ID);
        if (approvalChannel) {
            // Send the full partnership embed to the approval channel
            const approvalEmbed = partnershipEmbed('✅ Partnership Approved')
                .addFields(
                    { name: 'Server Name', value: currentEmbed.data.fields?.find(f => f.name === 'Server Name')?.value || 'Unknown', inline: true },
                    { name: 'Representative', value: currentEmbed.data.fields?.find(f => f.name === 'Representative')?.value || 'Unknown', inline: true },
                    { name: 'Invite Link', value: currentEmbed.data.fields?.find(f => f.name === 'Invite Link')?.value || 'Unknown', inline: true },
                    { name: 'Approved By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Submitted By', value: `<@${submitterId}>`, inline: true },
                )
                .setColor(0x22c55e);
            await approvalChannel.send({
                embeds: [approvalEmbed],
                allowedMentions: { parse: ['users'] },
            });
        }

        await interaction.editReply(roleMessage);
        return true;
    }

    currentEmbed.setColor(0xef4444).setFooter({ text: `❌ Denied by ${interaction.user.tag} • ${BRAND_FOOTER}` });
    await sourceMessage.edit({ embeds: [currentEmbed], components: partnershipReviewComponents(submitterId, true) });
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

        // Include the full ad inside the embed description (Discord supports up to 4096 chars)
        const adTruncated = serverAd.length > 4000 ? serverAd.slice(0, 3997) + '...' : serverAd;
        const requestEmbed = partnershipEmbed('🤝 Partnership Request', `📢 **Advertisement**\n\n${adTruncated}`, 0x3b82f6)
            .addFields(
                { name: 'Server Name', value: serverName, inline: true },
                { name: 'Representative', value: representative, inline: true },
                { name: 'Invite Link', value: `[Join Server](${inviteLink})`, inline: true },
                { name: 'Submitted By', value: `<@${interaction.user.id}> • ${interaction.user.tag}`, inline: false },
            );
        await destination.send({
            embeds: [requestEmbed],
            components: partnershipReviewComponents(interaction.user.id),
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
