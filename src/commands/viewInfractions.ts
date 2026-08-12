import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder,
    MessageFlags,
} from 'discord.js';
import { BRAND, INFRACTION_AUTHORIZED_ROLE_ID } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { isDatabaseAvailable } from '../database/connection';
import { Infraction } from '../database/models';
import { hasRequiredRole } from './staffManagement';

export const viewInfractionsCommand = {
    data: new SlashCommandBuilder()
        .setName('view-infractions')
        .setDescription('View your own or another member\'s infraction history')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Optional member whose infraction record you want to view')
                .setRequired(false),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (!interaction.guildId) {
                await interaction.editReply('This command can only be used in a server.');
                return;
            }

            const requestedUser = interaction.options.getUser('user') ?? interaction.user;
            const canViewOthers = requestedUser.id !== interaction.user.id
                && hasRequiredRole(interaction.member as { roles?: { cache?: Map<string, unknown> } } | null | undefined, INFRACTION_AUTHORIZED_ROLE_ID);
            if (requestedUser.id !== interaction.user.id && !canViewOthers) {
                await interaction.editReply('You do not have permission to view another member\'s infractions.');
                return;
            }

            if (!isDatabaseAvailable()) {
                await interaction.editReply('The database is currently unavailable. Please try again later.');
                return;
            }

            const records = await Infraction.find({
                guildId: interaction.guildId,
                memberId: requestedUser.id,
            })
                .sort({ createdAt: -1 })
                .lean()
                .exec() as unknown as Array<{
                    caseNumber: string;
                    action: string;
                    reason: string;
                    status: string;
                    createdAt: Date;
                    issuedById: string;
                    threadId: string;
                    memberUsername: string;
                }>;

            const activeRecords = records.filter(r => r.status === 'Active');
            const totalCount = records.length;
            const activeCount = activeRecords.length;

            const embed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle(requestedUser.id === interaction.user.id ? '📋 Your Infraction Record' : `📋 ${requestedUser.username}'s Infraction Record`)
                .setThumbnail(BRAND.logoUrl)
                .setDescription(`Infraction history for **${requestedUser.username}** in **Los Angeles Roleplay**.`)
                .addFields(
                    { name: 'Member', value: `<@${requestedUser.id}>`, inline: true },
                    { name: 'Total Infractions', value: `${totalCount}`, inline: true },
                    { name: 'Active Infractions', value: `${activeCount}`, inline: true },
                    { name: 'Closed/Voided', value: `${totalCount - activeCount}`, inline: true },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();

            if (records.length > 0) {
                const recentList = records.slice(0, 10).map(r => {
                    const date = Math.floor(new Date(r.createdAt).getTime() / 1000);
                    const statusEmoji = r.status === 'Active' ? '🟡' : '✅';
                    const threadLink = r.threadId ? `\n  Thread: https://discord.com/channels/${interaction.guildId}/${r.threadId}` : '';
                    return `${statusEmoji} **${r.caseNumber}** — ${r.action} — ${r.status}\n  Punishment: ${r.action}\n  Reason: ${r.reason.slice(0, 120)}\n  Issued by <@${r.issuedById}>\n  <t:${date}:f>${threadLink}`;
                }).join('\n\n');

                embed.addFields({
                    name: `Recent Records (${Math.min(records.length, 10)} of ${totalCount})`,
                    value: recentList.slice(0, 1024),
                    inline: false,
                });
            } else {
                embed.setDescription(`${requestedUser.username} has no infractions on their record. Keep up the great work! 🎉`);
            }

            await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
        } catch (error) {
            console.error('[ViewInfractions] Command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to retrieve your infraction record right now. Please try again later.');
        }
    },
};

