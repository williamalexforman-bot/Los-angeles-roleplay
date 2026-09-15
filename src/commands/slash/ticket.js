const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildContainer, v2Msg, env, tpl, logo, banner } = require('../../utils/v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket system commands')
        .addSubcommand(sub => sub.setName('setup').setDescription('Setup the ticket panel in this channel'))
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close the current ticket')
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for closing the ticket').setRequired(false))
        ),

    async execute(interaction, client) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'setup') {
            const managementRole = process.env.MANAGEMENT_ROLE_ID;
            if (managementRole && !interaction.member.roles.cache.has(managementRole)) {
                return interaction.reply({ content: env('NO_PERMISSION_MSG', 'You do not have permission to use this command.'), flags: MessageFlags.Ephemeral });
            }

            const container = buildContainer({
                title: env('TICKET_PANEL_TITLE', 'Support Tickets'),
                description: env('TICKET_PANEL_DESCRIPTION', 'Select a ticket type below to create a ticket.\nOur staff team will assist you shortly.'),
                thumbnail: logo(),
                banner: banner('TICKET_BANNER')
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('create_ticket_general').setLabel(env('TICKET_BTN_GENERAL', 'General')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('create_ticket_management').setLabel(env('TICKET_BTN_MANAGEMENT', 'Management')).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('create_ticket_ownership').setLabel(env('TICKET_BTN_OWNERSHIP', 'Ownership')).setStyle(ButtonStyle.Danger)
            );

            const panelChannel = interaction.guild.channels.cache.get(process.env.TICKET_PANEL_CHANNEL_ID) || interaction.channel;
            await panelChannel.send({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
            return interaction.reply({ content: 'Ticket system has been set up!', flags: MessageFlags.Ephemeral });
        }

        if (sub === 'close') {
            const { Ticket } = require('../../utils/database');
            const { createTranscript } = require('../../utils/transcript');

            const ticket = await Ticket.findOne({ channel_id: interaction.channel.id, status: 'open' });
            if (!ticket) return interaction.reply({ content: 'This is not a valid ticket channel.', flags: MessageFlags.Ephemeral });

            const reason = interaction.options.getString('reason') || 'No reason provided';

            await interaction.reply({ content: 'Closing ticket and generating transcript...' });

            const transcript = await createTranscript(interaction.channel);
            const logChannel = interaction.guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID);

            if (logChannel) {
                const typeLabel = (ticket.ticket_type || 'general').charAt(0).toUpperCase() + (ticket.ticket_type || 'general').slice(1);
                const fields = [
                    { name: 'Opened By', value: `<@${ticket.user_id}>` },
                    { name: 'Closed By', value: `${interaction.user}` },
                    { name: 'Type', value: typeLabel },
                    { name: 'Reason', value: reason },
                    { name: 'Ticket', value: interaction.channel.name },
                    { name: 'Transcript', value: '📎 Attached below' }
                ];
                if (ticket.claimed_by) fields.splice(2, 0, { name: 'Claimed By', value: `<@${ticket.claimed_by}>` });
                await logChannel.send(v2Msg({
                    title: env('TICKET_CLOSED_TITLE', 'Ticket Closed'),
                    fields
                }));
                await logChannel.send({ files: [transcript] });
            }

            await Ticket.updateOne({ channel_id: interaction.channel.id }, { status: 'closed', close_reason: reason });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    }
};
