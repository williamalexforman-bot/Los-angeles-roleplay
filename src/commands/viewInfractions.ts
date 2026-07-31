import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder,
    MessageFlags,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { createLogoAttachment } from '../utils/embeds';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { isDatabaseAvailable } from '../database/connection';
import { Infraction } from '../database/models';

export const viewInfractionsCommand = {
    data: new SlashCommandBuilder()
        .setName('view-infractions')
        .setDescription('View how many infractions you have on your record'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (!interaction.guildId) {
                await interaction.editReply('This command can only be used in a server.');
                return;
            }

            if (!isDatabaseAvailable()) {
                await interaction.editReply('The database is currently unavailable. Please try again later.');
                return;
            }

            const records = await Infraction.find({
                guildId: interaction.guildId,
                memberId: interaction.user.id,
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
                }>;

            const activeRecords = records.filter(r => r.status === 'Active');
            const totalCount = records.length;
            const activeCount = activeRecords.length;

            const embed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle('📋 Your Infraction Record')
                .setThumbnail(BRAND.logoUrl)
                .setDescription(`Here is your infraction history for **Los Angeles Roleplay**.`)
                .addFields(
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
                    return `${statusEmoji} **${r.caseNumber}** — ${r.action} — ${r.status}\n  <t:${date}:f> — ${r.reason.slice(0, 80)}`;
                }).join('\n\n');

                embed.addFields({
                    name: `Recent Records (${Math.min(records.length, 10)} of ${totalCount})`,
                    value: recentList.slice(0, 1024),
                    inline: false,
                });
            } else {
                embed.setDescription('You have no infractions on your record. Keep up the great work! 🎉');
            }

            await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
        } catch (error) {
            console.error('[ViewInfractions] Command failed.', error);
            markSlashCommandFailed(interaction, error);
            await interaction.editReply('Unable to retrieve your infraction record right now. Please try again later.');
        }
    },
};

