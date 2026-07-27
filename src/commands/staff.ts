import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { logAction } from '../utils/logger';
import { sendToChannel } from '../utils/notify';
import env from '../config/env';
import { BRAND } from '../config/constants';

const LOGO = BRAND.logoUrl;

export const staffCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('infraction')
            .setDescription('Manage infractions for a user')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Log an infraction for a user')
                    .addUserOption(option => option.setName('user').setDescription('The user to log an infraction for').setRequired(true))
                    .addStringOption(option => option.setName('reason').setDescription('Reason for the infraction').setRequired(true))
                    .addStringOption(option => option.setName('punishment').setDescription('Punishment type').setRequired(true).addChoices(
                        { name: 'Warning', value: 'warning' },
                        { name: 'Notice', value: 'notice' },
                        { name: 'Strike', value: 'strike' },
                        { name: 'Retirement', value: 'retirement' },
                        { name: 'Termination', value: 'termination' },
                        { name: 'Staff Blacklist', value: 'staff_blacklist' },
                        { name: 'Suspended', value: 'suspended' }
                    ))
                    .addStringOption(option => option.setName('notes').setDescription('Optional notes for the infraction'))
                    .addBooleanOption(option => option.setName('appealable').setDescription('Is this infraction appealable?')))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('Show recent infractions for a user')
                    .addUserOption(option => option.setName('user').setDescription('The user to check').setRequired(true))),
        async execute(interaction: ChatInputCommandInteraction) {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'add') {
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason') || 'No reason provided';
                const punishment = interaction.options.getString('punishment') || 'warning';
                const notes = interaction.options.getString('notes') || 'No additional notes';
                const appealable = interaction.options.getBoolean('appealable') ?? false;

                logAction('infraction-add', interaction.user.id, user?.id, reason, punishment, appealable);

                const embed = new EmbedBuilder()
                    .setTitle('Staff Infraction')
                    .setDescription('The High Ranking Team at Los Angeles Roleplay has noticed that you\'ve violated our policies. We will be taking actions upon your account. Arguing about your recent infraction will result in another strike.')
                    .setColor(BRAND.color)
                    .setThumbnail(LOGO)
                    .addFields(
                        { name: 'User', value: `<@${user?.id}>`, inline: true },
                        { name: 'Punishment', value: punishment, inline: true },
                        { name: 'Appealable', value: appealable ? 'Yes' : 'No', inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Note(s)', value: notes }
                    )
                    .setFooter({ text: BRAND.footer })
                    .setTimestamp();

                const infractionChannel = await interaction.client.channels.fetch(env.INFRACTION_CHANNEL_ID || '1526044664975851642');
                if (!infractionChannel?.isSendable()) {
                    await interaction.reply({ content: 'Unable to post infraction: target channel not found.', ephemeral: true });
                    return;
                }

                const initialMessage = await infractionChannel.send({ content: `<@${user?.id}> A new infraction has been recorded.` });
                const thread = await initialMessage.startThread({ name: `Infraction - ${user?.username ?? user?.id ?? 'Member'}`, autoArchiveDuration: 1440, reason: 'Infraction thread' });
                await thread.send({ embeds: [embed] });

                await interaction.reply({ content: `Infraction recorded for ${user?.username}. Thread created: ${thread.url}`, ephemeral: true });
                return;
            }

            const user = interaction.options.getUser('user');
            logAction('infraction-list', interaction.user.id, user?.id);
            await interaction.reply({ content: `No infraction history is currently available for ${user?.username ?? 'that user'}.`, ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('promotion')
            .setDescription('Handle a promotion request')
            .addUserOption(option => option.setName('user').setDescription('The user being promoted').setRequired(true))
            .addStringOption(option => option.setName('rank').setDescription('The rank or title being assigned').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('Why this promotion is being requested'))
            .addStringOption(option => option.setName('notes').setDescription('Optional notes for the promotion')),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const rank = interaction.options.getString('rank') || 'new rank';
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const notes = interaction.options.getString('notes') || 'No additional notes';
            logAction('promotion-request', interaction.user.id, user?.id, rank, reason);

            const embed = new EmbedBuilder()
                .setTitle('Promotion Request')
                .setDescription('A promotion request has been submitted for review.')
                .setColor(BRAND.color)
                .setThumbnail(LOGO)
                .addFields(
                    { name: 'User', value: `<@${user?.id}>`, inline: true },
                    { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Rank', value: rank, inline: true },
                    { name: 'Reason', value: reason },
                    { name: 'Note(s)', value: notes }
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();

            const promotionChannel = await interaction.client.channels.fetch(env.PROMOTION_CHANNEL_ID || '1526044978109743255');
            if (!promotionChannel?.isSendable()) {
                await interaction.reply({ content: 'Unable to post promotion request: target channel not found.', ephemeral: true });
                return;
            }

            const initialMessage = await promotionChannel.send({ content: `<@${user?.id}> A promotion request has been created.` });
            const thread = await initialMessage.startThread({ name: `Promotion - ${user?.username ?? user?.id ?? 'Member'}`, autoArchiveDuration: 1440, reason: 'Promotion thread' });
            await thread.send({ embeds: [embed] });

            await interaction.reply({ content: `Promotion request created for ${user?.username}. Thread created: ${thread.url}`, ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('application')
            .setDescription('Start or review a staff application')
            .addUserOption(option => option.setName('user').setDescription('The user applying').setRequired(true))
            .addStringOption(option => option.setName('type').setDescription('Type of application').setRequired(true))
            .addStringOption(option => option.setName('notes').setDescription('Any notes for the application')),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const type = interaction.options.getString('type') || 'staff';
            const notes = interaction.options.getString('notes') || 'No notes';
            logAction('application-request', interaction.user.id, user?.id, type, notes);
            await interaction.reply({ content: `Application request received for ${user?.username ?? 'the user'} (${type}).`, ephemeral: true });
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('training')
            .setDescription('Manage a training request')
            .addUserOption(option => option.setName('user').setDescription('The user requesting training').setRequired(true))
            .addStringOption(option => option.setName('topic').setDescription('Training topic').setRequired(true))
            .addStringOption(option => option.setName('notes').setDescription('Any notes for the training')),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const topic = interaction.options.getString('topic') || 'general';
            const notes = interaction.options.getString('notes') || 'No notes';
            logAction('training-request', interaction.user.id, user?.id, topic, notes);
            await interaction.reply({ content: `Training request received for ${user?.username ?? 'the user'} on ${topic}.`, ephemeral: true });
        },
    },
];
