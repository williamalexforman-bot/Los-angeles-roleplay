import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { isDatabaseAvailable } from '../database/connection';
import { ActivityCheck as ActivityCheckModel } from '../database/models';

const ACTIVITY_CHECK_ROLE_ID = '1521593407791825036';

interface ActivityVote {
    userId: string;
    username: string;
    votedAt: Date;
}

interface InMemoryActivityCheck {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string;
    startedById: string;
    startedAt: Date;
    endsAt?: Date;
    active: boolean;
    voters: ActivityVote[];
}

const inMemoryChecks: Map<string, InMemoryActivityCheck> = new Map();
const inMemoryActiveByGuild: Map<string, string> = new Map();

function activityCheckId(checkId: string): string {
    return `memory:${checkId}`;
}

export async function handleActivityCheckButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('activitycheck:vote:')) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const checkId = interaction.customId.split(':')[2];

        // In-memory fallback when MongoDB is unavailable
        if (!isDatabaseAvailable()) {
            const inMemoryId = activityCheckId(checkId);
            const check = inMemoryChecks.get(inMemoryId);
            if (!check) {
                await interaction.editReply('This activity check is no longer active or was not found.');
                return true;
            }

            if (!check.active) {
                await interaction.editReply('This activity check has already ended.');
                return true;
            }

            if (check.voters.some(v => v.userId === interaction.user.id)) {
                await interaction.editReply('You have already marked yourself as active for this check.');
                return true;
            }

            check.voters.push({
                userId: interaction.user.id,
                username: interaction.user.username,
                votedAt: new Date(),
            });

            await interaction.editReply('✅ You have been logged as active. Thank you!');
            return true;
        }

        const check = await ActivityCheckModel.findById(checkId).exec();
        if (!check) {
            await interaction.editReply('This activity check is no longer active or was not found.');
            return true;
        }

        if (!check.active) {
            await interaction.editReply('This activity check has already ended.');
            return true;
        }

        // Check if already voted
        if (check.voters.some(v => v.userId === interaction.user.id)) {
            await interaction.editReply('You have already marked yourself as active for this check.');
            return true;
        }

        check.voters.push({
            userId: interaction.user.id,
            username: interaction.user.username,
            votedAt: new Date(),
        });
        await check.save();

        await interaction.editReply('✅ You have been logged as active. Thank you!');
        return true;
    } catch (error) {
        console.error('[ActivityCheck] Button error.', error);
        await interaction.editReply('Unable to process your response right now. Please try again later.');
        return true;
    }
}

export const activityCheckCommand = {
    data: new SlashCommandBuilder()
        .setName('activitycheck')
        .setDescription('Manage staff activity checks')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a new staff activity check')
                .addStringOption(option =>
                    option
                        .setName('ends-at')
                        .setDescription('When does the activity check end? (e.g., "in 24 hours" or "December 31")')
                        .setRequired(false)
                        .setMaxLength(200),
                ),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the most recent activity check results'),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('end')
                .setDescription('End the current active activity check'),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'start') {
                if (!interaction.guild) {
                    await interaction.editReply('This command can only be used in a server.');
                    return;
                }

                // Check if there's already an active check
                if (isDatabaseAvailable()) {
                    const existing = await ActivityCheckModel.findOne({ guildId: interaction.guildId, active: true }).exec();
                    if (existing) {
                        await interaction.editReply('There is already an active activity check. Use `/activitycheck end` to end it first.');
                        return;
                    }
                }

                const endsAt = interaction.options.getString('ends-at') || 'Not specified';
                const embed = new EmbedBuilder()
                    .setColor(BRAND.color)
                    .setTitle('📋 Staff Activity Check')
                    .setThumbnail(BRAND.logoUrl)
                    .setDescription(
                        'Hello LARP staff team, we want to do an activity check to make sure you\'re active.\n\n' +
                        'Please click the **I\'m Active** button below to confirm your activity.\n\n' +
                        `**Ends:** ${endsAt}`,
                    )
                    .addFields(
                        { name: 'Started By', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Ends At', value: endsAt, inline: true },
                        { name: 'Status', value: '🟢 Active', inline: true },
                    )
                    .setFooter({ text: BRAND.footer })
                    .setTimestamp();

                const channel = interaction.channel;
                if (!channel?.isSendable()) {
                    await interaction.editReply('This channel cannot receive the activity check.');
                    return;
                }

                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId('activitycheck:vote:placeholder')
                        .setLabel('I\'m Active')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success),
                );

                const message = await channel.send({
                    content: `<@&${ACTIVITY_CHECK_ROLE_ID}>`,
                    embeds: [embed],
                    components: [row],
                    files: [createLogoAttachment()],
                    allowedMentions: { roles: [ACTIVITY_CHECK_ROLE_ID], parse: [] },
                });

                // Save to database if available
                if (isDatabaseAvailable()) {
                    const endsAtDate = endsAt !== 'Not specified' ? new Date(endsAt) : undefined;
                    const check = new ActivityCheckModel({
                        guildId: interaction.guildId,
                        channelId: interaction.channelId,
                        messageId: message.id,
                        startedById: interaction.user.id,
                        startedAt: new Date(),
                        endsAt: endsAtDate && !isNaN(endsAtDate.getTime()) ? endsAtDate : undefined,
                        active: true,
                        voters: [],
                    });
                    await check.save();

                    // Update the button custom ID with the MongoDB ID
                    const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`activitycheck:vote:${check._id}`)
                            .setLabel('I\'m Active')
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success),
                    );
                    await message.edit({ components: [updatedRow] });
                } else {
                    // In-memory fallback — track the check so the button keeps working without MongoDB
                    const endsAtDate = endsAt !== 'Not specified' ? new Date(endsAt) : undefined;
                    const memoryCheck: InMemoryActivityCheck = {
                        id: `activity-${Date.now()}`,
                        guildId: interaction.guild.id,
                        channelId: interaction.channelId,
                        messageId: message.id,
                        startedById: interaction.user.id,
                        startedAt: new Date(),
                        endsAt: endsAtDate && !isNaN(endsAtDate.getTime()) ? endsAtDate : undefined,
                        active: true,
                        voters: [],
                    };
                    inMemoryChecks.set(activityCheckId(memoryCheck.id), memoryCheck);
                    inMemoryActiveByGuild.set(interaction.guild.id, memoryCheck.id);

                    // Update the button custom ID with the in-memory ID
                    const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`activitycheck:vote:${memoryCheck.id}`)
                            .setLabel('I\'m Active')
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success),
                    );
                    await message.edit({ components: [updatedRow] });
                }

                await interaction.editReply('✅ Activity check has been started!');
                return;
            }

            if (subcommand === 'view') {
                if (!interaction.guildId) {
                    await interaction.editReply('This command can only be used in a server.');
                    return;
                }

                // In-memory fallback when MongoDB is unavailable
                if (!isDatabaseAvailable()) {
                    const activeId = inMemoryActiveByGuild.get(interaction.guildId);
                    if (!activeId) {
                        await interaction.editReply('No activity checks have been recorded yet.');
                        return;
                    }

                    const latest = inMemoryChecks.get(activityCheckId(activeId));
                    if (!latest) {
                        await interaction.editReply('No activity checks have been recorded yet.');
                        return;
                    }

                    const votersList = latest.voters.length > 0
                        ? latest.voters.map(v => `<@${v.userId}> — <t:${Math.floor(new Date(v.votedAt).getTime() / 1000)}:f>`).join('\n')
                        : 'No responses yet.';

                    const embed = new EmbedBuilder()
                        .setColor(BRAND.color)
                        .setTitle('📋 Activity Check Results')
                        .setThumbnail(BRAND.logoUrl)
                        .addFields(
                            { name: 'Status', value: latest.active ? '🟢 Active' : '🔴 Ended', inline: true },
                            { name: 'Started By', value: `<@${latest.startedById}>`, inline: true },
                            { name: 'Started At', value: `<t:${Math.floor(new Date(latest.startedAt).getTime() / 1000)}:F>`, inline: false },
                            { name: 'Total Votes', value: `${latest.voters.length}`, inline: true },
                            { name: 'Voters', value: votersList.slice(0, 1024) || 'No responses yet.', inline: false },
                        )
                        .setFooter({ text: BRAND.footer })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
                    return;
                }

                const checks = await ActivityCheckModel.find({ guildId: interaction.guildId })
                    .sort({ startedAt: -1 })
                    .limit(5)
                    .lean()
                    .exec();

                if (checks.length === 0) {
                    await interaction.editReply('No activity checks have been recorded yet.');
                    return;
                }

                const latest = checks[0];
                const votersList = latest.voters.length > 0
                    ? latest.voters.map(v => `<@${v.userId}> — <t:${Math.floor(new Date(v.votedAt).getTime() / 1000)}:f>`).join('\n')
                    : 'No responses yet.';

                const embed = new EmbedBuilder()
                    .setColor(BRAND.color)
                    .setTitle('📋 Activity Check Results')
                    .setThumbnail(BRAND.logoUrl)
                    .addFields(
                        { name: 'Status', value: latest.active ? '🟢 Active' : '🔴 Ended', inline: true },
                        { name: 'Started By', value: `<@${latest.startedById}>`, inline: true },
                        { name: 'Started At', value: `<t:${Math.floor(new Date(latest.startedAt).getTime() / 1000)}:F>`, inline: false },
                        { name: 'Total Votes', value: `${latest.voters.length}`, inline: true },
                        { name: 'Voters', value: votersList.slice(0, 1024) || 'No responses yet.', inline: false },
                    )
                    .setFooter({ text: BRAND.footer })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
                return;
            }

            if (subcommand === 'end') {
                if (!interaction.guildId) {
                    await interaction.editReply('This command can only be used in a server.');
                    return;
                }

                // In-memory fallback when MongoDB is unavailable
                if (!isDatabaseAvailable()) {
                    const activeId = inMemoryActiveByGuild.get(interaction.guildId);
                    if (!activeId) {
                        await interaction.editReply('There is no active activity check to end.');
                        return;
                    }

                    const activeCheck = inMemoryChecks.get(activityCheckId(activeId));
                    if (!activeCheck) {
                        await interaction.editReply('There is no active activity check to end.');
                        return;
                    }

                    activeCheck.active = false;
                    inMemoryActiveByGuild.delete(interaction.guildId);

                    // Update the message to disable the button
                    const channel = await interaction.client.channels.fetch(activeCheck.channelId).catch(() => null);
                    if (channel?.isSendable()) {
                        const message = await channel.messages.fetch(activeCheck.messageId).catch(() => null);
                        if (message) {
                            const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`activitycheck:vote:${activeCheck.id}`)
                                    .setLabel('I\'m Active')
                                    .setEmoji('✅')
                                    .setStyle(ButtonStyle.Success)
                                    .setDisabled(true),
                            );

                            const updatedEmbed = EmbedBuilder.from(message.embeds[0] || new EmbedBuilder())
                                .spliceFields(2, 1, { name: 'Status', value: '🔴 Ended', inline: true });

                            await message.edit({
                                embeds: [updatedEmbed],
                                components: [disabledRow],
                            });
                        }
                    }

                    await interaction.editReply(`✅ Activity check ended. **${activeCheck.voters.length}** staff member(s) responded.`);
                    return;
                }

                const activeCheck = await ActivityCheckModel.findOne({
                    guildId: interaction.guildId,
                    active: true,
                }).exec();

                if (!activeCheck) {
                    await interaction.editReply('There is no active activity check to end.');
                    return;
                }

                activeCheck.active = false;
                await activeCheck.save();

                // Update the message to disable the button
                const channel = await interaction.client.channels.fetch(activeCheck.channelId).catch(() => null);
                if (channel?.isSendable()) {
                    const message = await channel.messages.fetch(activeCheck.messageId).catch(() => null);
                    if (message) {
                        const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`activitycheck:vote:${activeCheck._id}`)
                                .setLabel('I\'m Active')
                                .setEmoji('✅')
                                .setStyle(ButtonStyle.Success)
                                .setDisabled(true),
                        );

                        const updatedEmbed = EmbedBuilder.from(message.embeds[0] || new EmbedBuilder())
                            .spliceFields(2, 1, { name: 'Status', value: '🔴 Ended', inline: true });

                        await message.edit({
                            embeds: [updatedEmbed],
                            components: [disabledRow],
                        });
                    }
                }

                await interaction.editReply(`✅ Activity check ended. **${activeCheck.voters.length}** staff member(s) responded.`);
                return;
            }
        } catch (error) {
            console.error('[ActivityCheck] Command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to process the activity check command. Please try again later.');
        }
    },
};

