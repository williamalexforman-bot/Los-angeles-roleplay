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
import { getAllInfractions } from './staffManagement';

export interface ViewInfractionRecord {
    caseNumber: string;
    action: string;
    reason: string;
    status: string;
    createdAt: Date;
    issuedById: string;
    threadId: string;
    appealable?: boolean;
    source: 'database' | 'memory';
}

function normalize(record: Record<string, unknown>, source: 'database' | 'memory'): ViewInfractionRecord {
    const rawCreatedAt = record.createdAt as unknown;
    const createdAt = rawCreatedAt instanceof Date
        ? rawCreatedAt
        : typeof rawCreatedAt === 'string' || typeof rawCreatedAt === 'number'
            ? new Date(rawCreatedAt)
            : new Date();
    return {
        caseNumber: String(record.caseNumber || 'UNKNOWN'),
        action: String(record.action || 'Infraction'),
        reason: String(record.reason || record.ruleBroken || 'No reason provided.'),
        status: String(record.status || 'Active'),
        createdAt,
        issuedById: String(record.issuedById || ''),
        threadId: String(record.threadId || ''),
        appealable: record.appealable === undefined ? true : Boolean(record.appealable),
        source,
    };
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
            const combined = new Map<string, ViewInfractionRecord>();

            // 1) Database records (if available)
            if (isDatabaseAvailable()) {
                try {
                    const dbRecords = await Infraction.find({
                        guildId: interaction.guildId,
                        memberId: requestedUser.id,
                    })
                        .sort({ createdAt: -1 })
                        .lean()
                        .exec() as unknown as Record<string, unknown>[];
                    for (const r of dbRecords) {
                        const n = normalize(r, 'database');
                        if (n.threadId) combined.set(n.threadId, n);
                        else if (n.caseNumber) combined.set(`db-${n.caseNumber}`, n);
                    }
                } catch {
                    // fall through to in-memory
                }
            }

            // 2) In-memory records (always work, including when DB is down or
            //    for records created before DB persistence existed)
            try {
                const memoryRecords = getAllInfractions().filter(r => r.memberId === requestedUser.id);
                for (const r of memoryRecords) {
                    const n = normalize(r as unknown as Record<string, unknown>, 'memory');
                    if (n.threadId) combined.set(n.threadId, n);
                    else if (n.caseNumber) combined.set(`mem-${n.caseNumber}`, n);
                }
            } catch {
                // ignore
            }

            const records = Array.from(combined.values()).sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );

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

            if (totalCount === 0) {
                embed.setDescription(`${requestedUser.username} has no infractions on their record. Keep up the great work! 🎉`);
            } else {
                // Compact list — show up to 10 most recent so it stays readable.
                const recent = records.slice(0, 10);
                const lines = recent.map(r => {
                    const date = Math.floor(r.createdAt.getTime() / 1000);
                    const statusEmoji = r.status === 'Active' ? '🟡' : '✅';
                    const appeal = r.appealable === false ? '❌ Not appealable' : '⚖️ Appealable';
                    const link = r.threadId && r.threadId.startsWith('punishment-')
                        ? 'No thread saved'
                        : r.threadId
                            ? `[Open Thread](https://discord.com/channels/${interaction.guildId}/${r.threadId})`
                            : 'No link';
                    return `${statusEmoji} **${r.caseNumber}** — ${r.action}\n${appeal} • ${link} • <t:${date}:d>`;
                }).join('\n');

                embed.addFields({
                    name: totalCount > 10
                        ? `Recent (${Math.min(totalCount, 10)} of ${totalCount})`
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