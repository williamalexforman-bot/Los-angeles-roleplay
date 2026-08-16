import {
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type GuildMember,
    type Role,
} from 'discord.js';
import { logger } from '../utils/logger';

const MASS_ROLE_CONCURRENCY = 5;

function canRunRoleCommand(interaction: ChatInputCommandInteraction): boolean {
    return interaction.guild?.ownerId === interaction.user.id
        || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
        || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles));
}

async function selectedEditableRole(interaction: ChatInputCommandInteraction): Promise<Role | null> {
    const selected = interaction.options.getRole('role', true);
    const role = await interaction.guild?.roles.fetch(selected.id).catch(() => null);
    if (!role || role.id === interaction.guildId || role.managed || !role.editable) return null;
    return role;
}

async function addRoleToMember(member: GuildMember, role: Role, actorId: string): Promise<boolean> {
    try {
        await member.roles.add(role, `Role assigned with /role by ${actorId}`);
        return true;
    } catch (error) {
        logger.warn(`[Role] Could not assign ${role.id} to ${member.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
    }
}

export const roleCommand = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Add a role to one member or every server member')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand => subcommand
            .setName('add')
            .setDescription('Add a role to one member')
            .addUserOption(option => option
                .setName('member')
                .setDescription('Member who should receive the role')
                .setRequired(true))
            .addRoleOption(option => option
                .setName('role')
                .setDescription('Role to add')
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('all')
            .setDescription('Add a role to every non-bot member')
            .addRoleOption(option => option
                .setName('role')
                .setDescription('Role to add to every member')
                .setRequired(true))),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild || !interaction.guildId) {
            await interaction.reply({ content: 'This command can only be used inside a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!canRunRoleCommand(interaction)) {
            await interaction.reply({ content: 'You need the Manage Roles permission to use this command.', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const role = await selectedEditableRole(interaction);
        if (!role) {
            await interaction.editReply('I cannot assign that role. Select a non-managed role below my highest role.');
            return;
        }

        const subcommand = interaction.options.getSubcommand(true);
        if (subcommand === 'add') {
            const user = interaction.options.getUser('member', true);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                await interaction.editReply('That member could not be found in this server.');
                return;
            }
            if (member.roles.cache.has(role.id)) {
                await interaction.editReply({ content: `${user.username} already has **${role.name}**.`, allowedMentions: { parse: [] } });
                return;
            }
            const assigned = await addRoleToMember(member, role, interaction.user.id);
            await interaction.editReply({
                content: assigned
                    ? `✅ Added **${role.name}** to ${user.username}.`
                    : `I could not add **${role.name}** to ${user.username}. Check my role position and Manage Roles permission.`,
                allowedMentions: { parse: [] },
            });
            return;
        }

        if (subcommand !== 'all') {
            await interaction.editReply('That role action is unavailable.');
            return;
        }

        const members = await interaction.guild.members.fetch().catch(() => null);
        if (!members) {
            await interaction.editReply('I could not load the server member list. Make sure the Server Members intent is enabled.');
            return;
        }

        const humanMembers = [...members.values()].filter(member => !member.user.bot);
        const targets = humanMembers.filter(member => !member.roles.cache.has(role.id));
        const alreadyHad = humanMembers.length - targets.length;
        let assigned = 0;
        let failed = 0;
        for (let index = 0; index < targets.length; index += MASS_ROLE_CONCURRENCY) {
            const results = await Promise.all(
                targets.slice(index, index + MASS_ROLE_CONCURRENCY)
                    .map(member => addRoleToMember(member, role, interaction.user.id)),
            );
            assigned += results.filter(Boolean).length;
            failed += results.filter(result => !result).length;
        }

        await interaction.editReply({
            content: [
                `✅ Finished adding **${role.name}** to server members.`,
                `**Assigned:** ${assigned}`,
                `**Already had role:** ${alreadyHad}`,
                `**Failed:** ${failed}`,
                `**Bots skipped:** ${members.size - humanMembers.length}`,
            ].join('\n'),
            allowedMentions: { parse: [] },
        });
    },
};
