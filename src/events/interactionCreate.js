const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, ThumbnailBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { tickets, giveaways, getNextId, getSetting } = require('../utils/database');
const { createTranscript } = require('../utils/transcript');
const { buildContainer, v2Msg, env, tpl, color, logo, banner } = require('../utils/v2');
const { getServerInfo, getPlayers } = require('../utils/erlcApi');
const { checkRateLimit, hasPermission, OWNER_ID } = require('../utils/security');
const logger = require('../utils/logger');

module.exports = {
    name: 'interactionCreate',
    once: false,
    async execute(interaction, client) {
        // Global Rate Limit (3s default)
        const rateLimit = checkRateLimit(interaction.user.id, interaction.isCommand() ? interaction.commandName : interaction.customId);
        if (rateLimit.limited) {
            return interaction.reply({ content: `Slow down! You can use this again in **${rateLimit.remaining}s**.`, flags: MessageFlags.Ephemeral });
        }

        if (interaction.isChatInputCommand()) {
            const command = client.slashCommands.get(interaction.commandName);
            if (!command) return;

            // Security check for /config and other restricted commands
            const publicOwnerId = getSetting('SERVER_OWNER_ID', process.env.OWNER_ID);
            if (interaction.commandName === 'config' && interaction.user.id !== OWNER_ID && interaction.user.id !== publicOwnerId) {
                return interaction.reply({ content: 'Only the locked developer or server owner can use this command.', flags: MessageFlags.Ephemeral });
            }

            try {
                await command.execute(interaction, client);
            } catch (error) {
                logger.error(`Error executing slash command ${interaction.commandName}:`, error);
                try {
                    const content = env('ERROR_MSG', 'An error occurred while executing that command.');
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
                    }
                } catch (_) {}
            }
            return;
        }

        if (interaction.isButton()) {
            // Ticket Creation
            if (interaction.customId.startsWith('create_ticket_')) {
                const ticketType = interaction.customId.replace('create_ticket_', '');
                
                // Check if user already has a ticket (SQLite approach)
                // Note: Simplified for this implementation
                
                const typeRoleMap = {
                    general: getSetting('TICKET_ROLE_GENERAL'),
                    management: getSetting('TICKET_ROLE_MANAGEMENT'),
                    ownership: getSetting('TICKET_ROLE_OWNERSHIP')
                };
                
                const accessRoleIds = (typeRoleMap[ticketType] || getSetting('TICKET_SUPPORT_ROLE_ID', '')).split(',').map(s => s.trim()).filter(s => s);

                const categoryId = getSetting('TICKET_CATEGORY_ID');
                const category = interaction.guild.channels.cache.get(categoryId);
                
                const overwrites = [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ];

                // Properly add multiple staff roles
                accessRoleIds.forEach(roleId => {
                    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
                });

                const channel = await interaction.guild.channels.create({
                    name: `${ticketType}-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: category ? category.id : null,
                    permissionOverwrites: overwrites
                });

                const ticketId = getNextId('tickets');
                tickets.create({
                    guild_id: interaction.guild.id,
                    channel_id: channel.id,
                    user_id: interaction.user.id,
                    ticket_type: ticketType,
                    created_at: Date.now()
                });

                const typeLabel = ticketType.charAt(0).toUpperCase() + ticketType.slice(1);
                const container = buildContainer({
                    title: env('TICKET_OPENED_TITLE', 'Support Ticket'),
                    description: tpl(env('TICKET_OPENED_DESCRIPTION', 'Welcome {user}! A staff member will be with you shortly.\nClick the button below to close this ticket.'), { user: `${interaction.user}` }),
                    fields: [{ name: 'Type', value: typeLabel }],
                    thumbnail: logo(),
                    banner: banner('TICKET_BANNER')
                });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim Ticket').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
                );

                await channel.send({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
                await interaction.reply({ content: `Ticket created: ${channel}`, flags: MessageFlags.Ephemeral });
                return;
            }

            // Ticket Claim
            if (interaction.customId === 'claim_ticket') {
                const ticket = tickets.get(interaction.channel.id);
                if (!ticket) return interaction.reply({ content: 'Invalid ticket.', flags: MessageFlags.Ephemeral });
                if (ticket.claimed_by) return interaction.reply({ content: `Already claimed by <@${ticket.claimed_by}>`, flags: MessageFlags.Ephemeral });

                // Update is simplified in dbHelpers
                // ... (Update logic)

                await interaction.reply({ content: `Ticket claimed by ${interaction.user}` });
                return;
            }

            // Ticket Close
            if (interaction.customId === 'close_ticket') {
                if (!hasPermission(interaction.member, 'MANAGEMENT_ROLE_ID')) {
                    return interaction.reply({ content: 'Only staff can close tickets.', flags: MessageFlags.Ephemeral });
                }

                const modal = new ModalBuilder().setCustomId('close_ticket_modal').setTitle('Close Ticket');
                const reasonInput = new TextInputBuilder().setCustomId('close_reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(false);
                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
                return;
            }

            // Giveaway Entry
            if (interaction.customId.startsWith('giveaway_')) {
                const messageId = interaction.customId.split('_')[1];
                const gData = client.giveaways.get(messageId);
                if (!gData) return interaction.reply({ content: 'Giveaway ended.', flags: MessageFlags.Ephemeral });

                if (gData.entries.has(interaction.user.id)) {
                    gData.entries.delete(interaction.user.id);
                    await interaction.reply({ content: 'Left giveaway.', flags: MessageFlags.Ephemeral });
                } else {
                    gData.entries.add(interaction.user.id);
                    await interaction.reply({ content: 'Entered giveaway!', flags: MessageFlags.Ephemeral });
                }

                // Update embed with new count
                // ... (Similiar to old logic but using dynamic stats)
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'close_ticket_modal') {
                const reason = interaction.fields.getTextInputValue('close_reason') || 'No reason provided';
                const ticket = tickets.get(interaction.channel.id);
                if (!ticket) return interaction.reply({ content: 'Not a ticket.', flags: MessageFlags.Ephemeral });

                await interaction.reply({ content: 'Closing...' });
                const transcript = await createTranscript(interaction.channel);
                const logChannelId = getSetting('TICKET_LOG_CHANNEL_ID');
                const logChannel = interaction.guild.channels.cache.get(logChannelId);

                if (logChannel) {
                    await logChannel.send({ content: `Ticket closed by ${interaction.user}\nReason: ${reason}`, files: [transcript] });
                }

                tickets.close(interaction.channel.id, reason);
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            }
        }
    }
};
