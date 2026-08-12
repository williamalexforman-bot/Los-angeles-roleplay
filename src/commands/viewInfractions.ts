import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { isDatabaseAvailable } from '../database/connection';
import { Infraction } from '../database/models';

interface ViewInfractionRecord {
    caseNumber: string;
    action: string;
    reason: string;
    status: string;
    createdAt: Date;
    issuedById: string;
    threadId: string;
}

export const viewInfractionsCommand = {
    data: new SlashCommandBuilder()
        .setName('view-infractions')
        .setDescription('View any member\'s infraction history')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The member whose infraction record you want to view')
                .setRequired(false),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        // NOT ephemeral — everyone can see the result.
        await interaction.deferReply();

        try {
            if (!interaction.guildId) {
                await interaction.editReply('This command can only be used in a server.');
                return;
            }

            const requestedUser = interaction.options.getUser('user') ?? interaction.user;

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
                .exec() as unknown as ViewInfractionRecord[];

            const activeCount = records.filter(r => r.status === 'Active').length;
            const totalCount = records.length;

            const embed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle(`📋 Infraction Record — ${requestedUser.username}`)
                .setDescription(`Infraction history for **${requestedUser.username}** in **Los Angeles Roleplay**.`)
                .addFields(
                    { name: 'Member', value: `<@${requestedUser.id}>`, inline: true },
                    { name: 'Total', value: `${totalCount}`, inline: true },
                    { name: 'Active', value: `${activeCount}`, inline: true },
                    { name: 'Resolved', value: `${totalCount - activeCount}`, inline: true },
                )
                .setFooter({ text: BRAND.footer })
                .setTimestamp();

            if (records.length === 0) {
                embed.setDescription(`${requestedUser.username} has no infractions on their record. Keep up the great work! 🎉`);
            } else {
                // Compact list — limit to 8 most recent so it stays short.
                const recent = records.slice(0, 8);
                const lines = recent.map(r => {
                    const date = Math.floor(new Date(r.createdAt).getTime() / 1000);
                    const statusEmoji = r.status === 'Active' ? '🟡' : '✅';
                    const link = r.threadId
                        ? `[Open Thread](https://discord.com/channels/${interaction.guildId}/${r.threadId})`
                        : 'No link';
                    return `${statusEmoji} **${r.caseNumber}** — ${r.action} — ${r.status}\n${link} • <t:${date}:d>`;
                }).join('\n');

                embed.addFields({
                    name: records.length > 8
                        ? `Recent (${Math.min(records.length, 8)} of ${totalCount})`
                        : 'Infractions',
                    value: lines.slice(0, 1024),
                    inline: false,
                });
            }

            await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
        } catch (error) {
            console.error('[ViewInfractions] Command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to retrieve that infraction record right now. Please try again later.');
        }
    },
};