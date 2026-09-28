import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from 'discord.js';
import { logAction } from '../utils/logger';
import { checkPermissions } from '../utils/permissions';

export const adminCommands = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Administrative commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-add')
                .setDescription('Add a role to a user')
                .addUserOption(option => option.setName('user').setDescription('The user to add a role to').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('The role to add').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('role-remove')
                .setDescription('Remove a role from a user')
                .addUserOption(option => option.setName('user').setDescription('The user to remove a role from').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('The role to remove').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('staff-list')
                .setDescription('Displays a list of all staff members')),

    async execute(interaction: ChatInputCommandInteraction) {
        const member = interaction.member as GuildMember;

        if (!checkPermissions(member, ['Administrator'])) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'role-add': {
                const user = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');

                if (user && role) {
                    const memberToUpdate = await interaction.guild?.members.fetch(user.id);
                    if (memberToUpdate) {
                        await memberToUpdate.roles.add(role.id);
                        logAction('role-add', member, user, role.id);
                        return interaction.reply({ content: `Role ${'name' in role ? role.name : 'role'} has been added to ${user.username}.` });
                    }
                }
                return interaction.reply({ content: 'Failed to add role.', ephemeral: true });
            }
            case 'role-remove': {
                const user = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');

                if (user && role) {
                    const memberToUpdate = await interaction.guild?.members.fetch(user.id);
                    if (memberToUpdate) {
                        await memberToUpdate.roles.remove(role.id);
                        logAction('role-remove', member, user, role.id);
                        return interaction.reply({ content: `Role ${'name' in role ? role.name : 'role'} has been removed from ${user.username}.` });
                    }
                }
                return interaction.reply({ content: 'Failed to remove role.', ephemeral: true });
            }
            case 'staff-list': {
                const staffMembers = interaction.guild?.roles.cache
                    .filter(role => role.name.includes('Staff'))
                    .map(role => role.members.map(member => member.user.username))
                    .flat() ?? [];

                return interaction.reply({ content: `Staff Members: ${staffMembers.join(', ') || 'None found'}` });
            }
            default:
                return interaction.reply({ content: 'Invalid subcommand.', ephemeral: true });
        }
    },
};
