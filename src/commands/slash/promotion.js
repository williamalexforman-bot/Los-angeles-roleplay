const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { v2Reply, v2Msg, env, tpl, logo, banner } = require('../../utils/v2');
const { Promotion, getNextId } = require('../../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('promotion')
        .setDescription('Manage promotions')
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Promote a user')
            .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
            .addStringOption(opt => opt.setName('old_rank').setDescription('Current rank').setRequired(true))
            .addStringOption(opt => opt.setName('new_rank').setDescription('New rank').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for promotion').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('history')
            .setDescription('View promotion history')
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
            const oldRank = interaction.options.getString('old_rank');
            const newRank = interaction.options.getString('new_rank');
            const reason = interaction.options.getString('reason');

            const nextId = await getNextId('promotion');
            await Promotion.create({
                id: nextId, guild_id: interaction.guild.id, user_id: user.id, promoted_by: interaction.user.id, old_rank: oldRank, new_rank: newRank, reason, timestamp: Date.now()
            });

            const promoPayload = {
                title: env('PROMOTION_TITLE', 'Promotion'),
                description: tpl(env('PROMOTION_DESCRIPTION', '{user} has been promoted!'), { user: `${user}` }),
                fields: [
                    { name: 'Promoted By', value: `${interaction.user}` },
                    { name: 'Old Rank', value: oldRank },
                    { name: 'New Rank', value: newRank },
                    { name: 'Reason', value: reason }
                ],
                thumbnail: logo(),
                banner: banner('PROMOTION_BANNER')
            };

            const promoChannel = interaction.guild.channels.cache.get(process.env.PROMOTION_CHANNEL_ID);
            if (promoChannel) await promoChannel.send(v2Msg(promoPayload));
            return interaction.reply({ content: `${user} has been promoted from ${oldRank} to ${newRank}.`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'history') {
            const user = interaction.options.getUser('user');
            const promotions = await Promotion.find({ guild_id: interaction.guild.id, user_id: user.id }).sort({ timestamp: -1 });

            if (promotions.length === 0) return interaction.reply({ content: 'No promotion history found.', flags: MessageFlags.Ephemeral });

            return interaction.reply(v2Reply({
                title: tpl(env('PROMOTION_HISTORY_TITLE', 'Promotion History for {user}'), { user: user.tag }),
                description: promotions.map(p => `**#${p.id}** | ${p.old_rank} -> ${p.new_rank} | By <@${p.promoted_by}> | <t:${Math.floor(p.timestamp / 1000)}:R>`).join('\n'),
                thumbnail: logo(),
                banner: banner('PROMOTION_BANNER')
            }));
        }
    }
};
