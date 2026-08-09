import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    type GuildBasedChannel,
} from 'discord.js';

export const renameCommand = {
    data: new SlashCommandBuilder()
        .setName('rename')
        .setDescription('Rename a channel (emoji allowed)')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('The new channel name (emoji allowed)')
                .setRequired(true)
                .setMaxLength(100),
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to rename (defaults to the current channel)')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        // Require Manage Channels (or Administrator) to rename.
        const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
            || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
            || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
        if (!canManage) {
            await interaction.reply({
                content: 'You need the **Manage Channels** or **Administrator** permission to rename channels.',
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const requestedChannel = interaction.options.getChannel('channel');
            const rawName = interaction.options.getString('name', true).trim();

            // Resolve target channel: provided option, or fall back to the current channel.
            const rawTarget = requestedChannel ?? interaction.channel;
            if (!rawTarget) {
                await interaction.editReply('Could not determine which channel to rename.');
                return;
            }

            // Narrow to a guild channel (DM channels cannot be renamed).
            if (!('name' in rawTarget) || !('guild' in rawTarget) || !rawTarget.guild || typeof (rawTarget as any).setName !== 'function') {
                await interaction.editReply('That is not a server channel that can be renamed.');
                return;
            }
            const target = rawTarget as GuildBasedChannel;

            if (!target.manageable) {
                await interaction.editReply(`I do not have permission to rename <#${target.id}>. Ensure the bot has **Manage Channels** and its role is above that channel.`);
                return;
            }

            // Discord allows emoji in channel names natively. We only strip
            // characters that Discord itself forbids (angle brackets, slashes,
            // pipes, etc.) and collapse whitespace — emoji are preserved.
            const sanitized = rawName
                .replace(/[<>:"/\\|?*]+/gu, '')
                .replace(/[-\s]{2,}/gu, '-')
                .replace(/^-|-$/gu, '')
                .trim()
                .slice(0, 100);

            if (!sanitized) {
                await interaction.editReply('That name is not valid. Please provide a name with visible characters (emoji count too).');
                return;
            }

            const previousName = target.name;
            await target.setName(sanitized, `Renamed by ${interaction.user.tag}`);

            const typeLabel: Record<number, string> = {
                [ChannelType.GuildText]: 'text',
                [ChannelType.GuildVoice]: 'voice',
                [ChannelType.GuildCategory]: 'category',
                [ChannelType.GuildForum]: 'forum',
                [ChannelType.GuildAnnouncement]: 'announcement',
                [ChannelType.GuildStageVoice]: 'stage',
                [ChannelType.GuildDirectory]: 'directory',
            };
            const kind = typeLabel[target.type] ?? 'channel';

            await interaction.editReply(
                `✅ Renamed ${kind} channel **${previousName}** → **${sanitized}** (<#${target.id}>).`,
            );
        } catch (error) {
            console.error('[Rename] Failed to rename channel.', error);
            await interaction.editReply('Unable to rename that channel. Please check the bot has **Manage Channels** permission and try again.');
        }
    },
};
