import {
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { isDatabaseAvailable } from '../database/connection';
import { Infraction } from '../database/models';
import {
    getAllInfractions,
    INFRACTION_BANNER_NAME,
    INFRACTION_UNDERBANNER_NAME,
    infractionArtworkAttachments,
} from './staffManagement';

const INFRACTION_PANEL_COLOR = 0x3b82f6;

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

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

function compact(value: string, maxLength = 180): string {
    const cleaned = value.replace(/[\r\n]+/g, ' ').replace(/`/g, 'ˋ').trim();
    if (!cleaned) return 'No reason provided.';
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function buildViewInfractionsPanel(
    username: string,
    userId: string,
    guildId: string,
    records: readonly ViewInfractionRecord[],
): ContainerBuilder {
    const activeCount = records.filter(record => record.status === 'Active').length;
    const safeUsername = username.replace(/[\r\n]/g, ' ').slice(0, 80);
    const summary = [
        `## 📋 Infraction Record — ${safeUsername}`,
        `> **Member:** <@${userId}>`,
        `> **Total:** \`${records.length}\` • **Active:** \`${activeCount}\` • **Resolved:** \`${records.length - activeCount}\``,
    ];

    if (records.length === 0) {
        summary.push('', '> No infractions are on this member\'s record. Keep up the great work! 🎉');
    } else {
        summary.push('', '### Recent Infractions');
        for (const record of records.slice(0, 10)) {
            const date = Math.floor(record.createdAt.getTime() / 1000);
            const statusEmoji = record.status === 'Active' ? '🟡' : '✅';
            const appeal = record.appealable === false ? '❌ Not appealable' : '⚖️ Appealable';
            const link = record.threadId && !record.threadId.startsWith('punishment-')
                ? `[🔗 Open Infraction Channel](https://discord.com/channels/${guildId}/${record.threadId})`
                : 'No channel saved';
            summary.push(
                `${statusEmoji} **${compact(record.caseNumber, 40)} — ${compact(record.action, 80)}**`,
                `> ${appeal} • ${link} • <t:${date}:d>`,
                `> **Reason:** \`${compact(record.reason)}\``,
            );
        }
        if (records.length > 10) summary.push(``, `> Showing the 10 most recent of ${records.length} infractions.`);
    }

    const badge = new ButtonBuilder()
        .setCustomId(`view-infractions:display:${userId}`)
        .setLabel(`${activeCount} Active • ${records.length} Total`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true);

    return new ContainerBuilder()
        .setAccentColor(INFRACTION_PANEL_COLOR)
        .addMediaGalleryComponents(media(INFRACTION_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(summary.join('\n').slice(0, 4_000)),
                )
                .setButtonAccessory(badge),
        )
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(INFRACTION_UNDERBANNER_NAME));
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
        try {
            if (!interaction.guildId) {
                await interaction.reply({
                    content: 'This command can only be used in a server.',
                    flags: MessageFlags.Ephemeral,
                });
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

            // Send the result as the original interaction response. A follow-up
            // sent after an ephemeral defer can be treated as that original
            // webhook response by Discord, so deleting the loading response can
            // also delete the visible V2 panel.
            await interaction.reply({
                components: [buildViewInfractionsPanel(
                    requestedUser.username,
                    requestedUser.id,
                    interaction.guildId,
                    records,
                )],
                files: infractionArtworkAttachments(),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            console.error('[ViewInfractions] Command failed.', error);
            markSlashCommandFailed(interaction, error);
            const content = 'Unable to retrieve that infraction record right now. Please try again later.';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            }
        }
    },
};
