import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction, GuildMember, TextChannel } from 'discord.js';
import { logAction } from '../utils/logger';
import { generateCaseNumber } from '../utils/utils';
import { sendEmbed } from '../utils/embeds';

export const moderationCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Warn a user')
            .addUserOption(option => option.setName('user').setDescription('The user to warn').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('Reason for the warning').setRequired(true))
            .addStringOption(option => option.setName('proof').setDescription('Optional proof of the infraction')),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const proof = interaction.options.getString('proof') || 'No proof provided';
            const caseNumber = generateCaseNumber();

            if (!user) {
                return await sendEmbed(interaction, 'Unable to resolve user.');
            }

            logAction('warn', interaction.user, user, reason, proof, caseNumber);
            await sendEmbed(interaction, `User ${user.username} has been warned for: ${reason}. Case Number: ${caseNumber}`);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('timeout')
            .setDescription('Timeout a user for a specified duration')
            .addUserOption(option => option.setName('user').setDescription('The user to timeout').setRequired(true))
            .addIntegerOption(option => option.setName('duration').setDescription('Duration in seconds').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('Reason for the timeout')),
        async execute(interaction: ChatInputCommandInteraction) {
            const user = interaction.options.getUser('user');
            const duration = interaction.options.getInteger('duration');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const caseNumber = generateCaseNumber();

            if (!user) {
                return await sendEmbed(interaction, 'Unable to resolve user.');
            }
            if (duration === null) {
                return await sendEmbed(interaction, 'Invalid duration provided.');
            }

            logAction('timeout', interaction.user, user, reason, null, caseNumber);

            const member = interaction.guild?.members.cache.get(user.id) as GuildMember | undefined;
            if (member) {
                await member.timeout(duration * 1000, reason);
                await sendEmbed(interaction, `User ${user.username} has been timed out for ${duration} seconds. Reason: ${reason}. Case Number: ${caseNumber}`);
            } else {
                await sendEmbed(interaction, `User ${user.username} is not a member of this server.`);
            }
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('purge')
            .setDescription('Purge messages from a channel')
            .addIntegerOption(option => option.setName('amount').setDescription('Number of messages to purge').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const amount = interaction.options.getInteger('amount');

            if (amount === null) {
                return await sendEmbed(interaction, 'Invalid purge amount provided.');
            }

            logAction('purge', interaction.user, null, `Purged ${amount} messages`, null, generateCaseNumber());

            if (interaction.channel && interaction.channel instanceof TextChannel) {
                await interaction.channel.bulkDelete(amount, true);
            }
            await sendEmbed(interaction, `Successfully purged ${amount} messages.`);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('lock')
            .setDescription('Lock a channel'),
        async execute(interaction: ChatInputCommandInteraction) {
            const channel = interaction.channel;

            if (!channel || !(channel instanceof TextChannel)) {
                return await sendEmbed(interaction, 'This command must be used in a text channel.');
            }

            logAction('lock', interaction.user, null, `Locked channel ${channel.name}`, null, generateCaseNumber());

            await channel.permissionOverwrites.edit(interaction.guild?.roles.everyone ?? '', { SendMessages: false });
            await sendEmbed(interaction, `Channel ${channel.name} has been locked.`);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('unlock')
            .setDescription('Unlock a channel'),
        async execute(interaction: ChatInputCommandInteraction) {
            const channel = interaction.channel;

            if (!channel || !(channel instanceof TextChannel)) {
                return await sendEmbed(interaction, 'This command must be used in a text channel.');
            }

            logAction('unlock', interaction.user, null, `Unlocked channel ${channel.name}`, null, generateCaseNumber());

            await channel.permissionOverwrites.edit(interaction.guild?.roles.everyone ?? '', { SendMessages: null });
            await sendEmbed(interaction, `Channel ${channel.name} has been unlocked.`);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('slowmode')
            .setDescription('Set slowmode for a channel')
            .addIntegerOption(option => option.setName('duration').setDescription('Duration in seconds').setRequired(true)),
        async execute(interaction: ChatInputCommandInteraction) {
            const duration = interaction.options.getInteger('duration');
            const channel = interaction.channel;

            if (duration === null) {
                return await sendEmbed(interaction, 'Invalid slowmode duration provided.');
            }
            if (!channel || !(channel instanceof TextChannel)) {
                return await sendEmbed(interaction, 'This command must be used in a text channel.');
            }

            logAction('slowmode', interaction.user, null, `Set slowmode to ${duration} seconds for channel ${channel.name}`, null, generateCaseNumber());

            await channel.setRateLimitPerUser(duration);
            await sendEmbed(interaction, `Slowmode has been set to ${duration} seconds for channel ${channel.name}.`);
        },
    },
];
