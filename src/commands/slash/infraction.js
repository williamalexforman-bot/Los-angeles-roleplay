const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { v2Reply, v2Msg, env, tpl, logo, banner } = require('../../utils/v2');
const { Infraction, getNextId } = require('../../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('infraction')
        .setDescription('Manage infractions')
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Add an infraction')
            .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
            .addStringOption(opt => opt.setName('type').setDescription('Infraction type').setRequired(true).addChoices(
                { name: 'Warning', value: 'Warning' },
                { name: 'Strike', value: 'Strike' },
                { name: 'Termination', value: 'Termination' },
                { name: 'Ban', value: 'Ban' }
            ))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for infraction').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove an infraction')
            .addStringOption(opt => opt.setName('id').setDescription('Infraction ID').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List infractions for a user')
            .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
        ),

    async execute(interaction) {
        const managementRole = process.env.MANAGEMENT_ROLE_ID;
        if (managementRole && !interaction.member.roles.cache.has(managementRole)) {
            return interaction.reply({ content: env('NO_PERMISSION_MSG', 'You do not have permission to use this command.'), flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const user = interaction.options.getUser('user');
            const type = interaction.options.getString('type');
            const reason = interaction.options.getString('reason');

            const nextId = await getNextId('infraction');
            const result = await Infraction.create({
                id: nextId, guild_id: interaction.guild.id, user_id: user.id, moderator_id: interaction.user.id, type, reason, timestamp: Date.now()
            });

            const infractionPayload = {
                title: env('INFRACTION_ADDED_TITLE', 'Infraction Added'),
                fields: [
                    { name: 'ID', value: `#${result.id}` },
                    { name: 'User', value: `${user}` },
                    { name: 'Moderator', value: `${interaction.user}` },
                    { name: 'Type', value: type },
                    { name: 'Reason', value: reason }
                ],
                thumbnail: logo(),
                banner: banner('INFRACTION_BANNER')
            };

            const infractionChannel = interaction.guild.channels.cache.get(process.env.INFRACTION_CHANNEL_ID);
            if (infractionChannel) await infractionChannel.send(v2Msg(infractionPayload));
            return interaction.reply({ content: `Infraction added for ${user} (${type}).`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'remove') {
            const id = parseInt(interaction.options.getString('id'));
            const infraction = await Infraction.findOneAndDelete({ id, guild_id: interaction.guild.id });
            if (!infraction) return interaction.reply({ content: 'Infraction not found.', flags: MessageFlags.Ephemeral });

            return interaction.reply({ content: tpl(env('INFRACTION_REMOVED_MSG', 'The Infraction has been removed.'), { id: `${id}` }) });
        }

        if (sub === 'list') {
            const user = interaction.options.getUser('user');
            const infractions = await Infraction.find({ guild_id: interaction.guild.id, user_id: user.id }).sort({ timestamp: -1 });

            if (infractions.length === 0) return interaction.reply({ content: 'No infractions found for this user.', flags: MessageFlags.Ephemeral });

            return interaction.reply(v2Reply({
                title: tpl(env('INFRACTION_LIST_TITLE', 'Infractions for {user}'), { user: user.tag }),
                description: infractions.map(i => `**#${i.id}** | ${i.type} | ${i.reason} | <t:${Math.floor(i.timestamp / 1000)}:R>`).join('\n'),
                thumbnail: logo(),
                banner: banner('INFRACTION_BANNER')
            }));
        }
    }
};
