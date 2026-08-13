import {
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    GuildMember,
    PermissionFlagsBits,
    SlashCommandBuilder,
    MessageFlags,
} from 'discord.js';
import { BRAND, WARNING_ROLE_IDS, STRIKE_ROLE_IDS } from '../config/constants';
import { Infraction } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { createLogoAttachment } from '../utils/embeds';
import { infractionAppealButton } from './infractionAppeal';

const BRAND_FOOTER = BRAND.footer;
const LOGO_URL = BRAND.logoUrl;

let cachedClient: Client | null = null;

export function setDiscordClientForDm(client: Client): void {
    cachedClient = client;
}

function brandedEmbed(title: string, color: number = BRAND.color): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(LOGO_URL)
        .setFooter({ text: BRAND_FOOTER })
        .setTimestamp();
}

async function sendDm(userId: string, embed: EmbedBuilder): Promise<boolean> {
    try {
        const client = cachedClient;
        if (!client) return false;
        const user = await client.users.fetch(userId);
        if (!user) return false;
        await user.send({ embeds: [embed], files: [createLogoAttachment()] });
        return true;
    } catch {
        return false;
    }
}

function generateCaseNumber(): string {
    return `PUN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function getInfractionsForUser(guildId: string, userId: string) {
    if (!isDatabaseAvailable()) return [];
    return Infraction.find({ guildId, memberId: userId })
        .sort({ createdAt: -1 })
        .lean()
        .exec() as unknown as Array<{
            caseNumber: string;
            action: string;
            reason: string;
            status: string;
            createdAt: Date;
            issuedById: string;
        }>;
}

async function getInfractionByCaseNumber(guildId: string, caseNumber: string) {
    if (!isDatabaseAvailable()) return null;
    return Infraction.findOne({ guildId, caseNumber }).lean().exec() as unknown as {
        _id: unknown;
        caseNumber: string;
        guildId: string;
        memberId: string;
        memberUsername: string;
        issuedById: string;
        action: string;
        reason: string;
        status: string;
        threadId: string;
        parentChannelId: string;
        headerMessageId: string;
        detailMessageId: string;
        createdAt: Date;
        updatedAt: Date;
    } | null;
}

async function saveInfractionToDb(record: {
    caseNumber: string;
    guildId: string;
    memberId: string;
    memberUsername: string;
    issuedById: string;
    action: string;
    reason: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}): Promise<boolean> {
    if (!isDatabaseAvailable()) return false;
    try {
        await Infraction.create({
            ...record,
            number: Number(record.caseNumber.replace(/\D/g, '')) || 0,
            threadId: `punishment-${record.caseNumber}`,
            parentChannelId: '',
            headerMessageId: '',
            detailMessageId: '',
            ruleBroken: record.reason,
            evidence: 'No evidence supplied.',
            internalNotes: 'No internal notes supplied.',
            notifyMember: true,
            expiration: 'No expiration set.',
            history: [],
        });
        return true;
    } catch {
        return false;
    }
}

export const punishmentCommands = [
    // ──────────────────────────────────────────────
    //  /punish
    // ──────────────────────────────────────────────
    {
        data: new SlashCommandBuilder()
            .setName('punish')
            .setDescription('Punish a user (warn/kick/ban)')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to punish')
                    .setRequired(true),
            )
            .addStringOption(option =>
                option
                    .setName('action')
                    .setDescription('The punishment action')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Warn', value: 'warn' },
                        { name: 'Kick', value: 'kick' },
                        { name: 'Ban', value: 'ban' },
                    ),
            )
            .addStringOption(option =>
                option
                    .setName('level')
                    .setDescription('Warning or Strike level (required for Warn action)')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Warning 1', value: 'Warning 1' },
                        { name: 'Warning 2', value: 'Warning 2' },
                        { name: 'Warning 3', value: 'Warning 3' },
                        { name: 'Strike 1', value: 'Strike 1' },
                        { name: 'Strike 2', value: 'Strike 2' },
                        { name: 'Strike 3', value: 'Strike 3' },
                    ),
            )
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for the punishment')
                    .setRequired(true)
                    .setMaxLength(1024),
            ),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const targetUser = interaction.options.getUser('user', true);
                const action = interaction.options.getString('action', true) as 'warn' | 'kick' | 'ban';
                const level = interaction.options.getString('level');
                const reason = interaction.options.getString('reason', true);

                // Validate level is required for warn action
                if (action === 'warn' && !level) {
                    await interaction.editReply('You must select a **Warning or Strike level** (e.g. Warning 1, Warning 2, Warning 3, Strike 1, etc.).');
                    return;
                }
                if (level && action !== 'warn') {
                    await interaction.editReply('The level option can only be used with the **Warn** action.');
                    return;
                }

                // Determine the final action label (e.g. "Warning 2", "Strike 1")
                const finalAction = level || (action === 'warn' ? 'Warning' : action.charAt(0).toUpperCase() + action.slice(1));

                // Determine the role to auto-assign
                const roleToAssign = level
                    ? (level.startsWith('Warning') ? WARNING_ROLE_IDS[level] : STRIKE_ROLE_IDS[level])
                    : undefined;

                if (!interaction.guildId || !interaction.guild) {
                    await interaction.editReply('This command can only be used in a server.');
                    return;
                }

                const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                if (!member) {
                    await interaction.editReply('That user is not in this server.');
                    return;
                }

                // Permission check — staff can't punish themselves or higher roles
                if (targetUser.id === interaction.user.id) {
                    await interaction.editReply('You cannot punish yourself.');
                    return;
                }
                const botMember = await interaction.guild.members.fetchMe();
                if (!botMember) {
                    await interaction.editReply('Unable to verify bot permissions.');
                    return;
                }

                const caseNumber = generateCaseNumber();

                // Build the DM embed first
                const dmEmbed = brandedEmbed(`Punishment Notice | ${caseNumber}`)
                    .setDescription('You have received a punishment from the Los Angeles Roleplay staff team.')
                    .addFields(
                        { name: 'Action', value: finalAction, inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Case Number', value: caseNumber, inline: true },
                    );

                // Send DM (best-effort) with appeal button for warn actions
                let dmSent = false;
                if (action === 'warn') {
                    try {
                        const client = cachedClient;
                        if (client) {
                            const user = await client.users.fetch(targetUser.id);
                            if (user) {
                                await user.send({
                                    embeds: [dmEmbed],
                                    components: [infractionAppealButton(`punishment-${caseNumber}`)],
                                    files: [createLogoAttachment()],
                                });
                                dmSent = true;
                            }
                        }
                    } catch {
                        dmSent = false;
                    }
                } else {
                    dmSent = await sendDm(targetUser.id, dmEmbed);
                }

                // Execute the punishment action
                let actionResult = '';
                switch (action) {
                    case 'warn': {
                        // Auto-assign the warning/strike role to the member
                        let roleAssigned = false;
                        if (roleToAssign) {
                            try {
                                await member.roles.add(roleToAssign, `${finalAction} issued by ${interaction.user.id}`);
                                roleAssigned = true;
                            } catch (error) {
                                console.error(`[Punishment] Could not assign role ${roleToAssign}:`, error);
                            }
                        }

                        // Save to MongoDB for history
                        const saved = await saveInfractionToDb({
                            caseNumber,
                            guildId: interaction.guildId,
                            memberId: targetUser.id,
                            memberUsername: targetUser.username,
                            issuedById: interaction.user.id,
                            action: finalAction,
                            reason,
                            status: 'Active',
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        });
                        actionResult = saved
                            ? `has been warned (${finalAction}) (Case: ${caseNumber})${roleAssigned ? ' — role assigned' : roleToAssign ? ' — ⚠️ role could NOT be assigned' : ''}`
                            : `has been warned (${finalAction}) but the warning could not be saved to the database (Case: ${caseNumber})${roleAssigned ? ' — role assigned' : roleToAssign ? ' — ⚠️ role could NOT be assigned' : ''}`;
                        break;
                    }
                    case 'kick': {
                        if (!member.kickable) {
                            await interaction.editReply('I cannot kick that user. They may have higher permissions than me.');
                            return;
                        }
                        await member.kick(reason);
                        actionResult = `has been kicked (Case: ${caseNumber})`;
                        break;
                    }
                    case 'ban': {
                        if (!member.bannable) {
                            await interaction.editReply('I cannot ban that user. They may have higher permissions than me.');
                            return;
                        }
                        await member.ban({ reason });
                        actionResult = `has been banned (Case: ${caseNumber})`;
                        break;
                    }
                }

                const confirmEmbed = brandedEmbed('Punishment Issued')
                    .setDescription(`${targetUser} ${actionResult}.`)
                    .addFields(
                        { name: 'Action', value: finalAction, inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Case Number', value: caseNumber, inline: true },
                        { name: 'DM Sent', value: dmSent ? '✅ Yes' : '❌ No (DMs may be closed)', inline: true },
                        ...(roleToAssign ? [{ name: 'Role', value: `<@&${roleToAssign}>`, inline: true }] : []),
                    );

                await interaction.editReply({ embeds: [confirmEmbed], files: [createLogoAttachment()] });
            } catch (error) {
                console.error('[Punishment] Command failed.', error);
                markSlashCommandFailed(interaction, error);
                await interaction.editReply('Unable to complete the punishment. Please check bot permissions and try again.');
            }
        },
    },

    // ──────────────────────────────────────────────
    //  /punishment view
    // ──────────────────────────────────────────────
    {
        data: new SlashCommandBuilder()
            .setName('punishment')
            .setDescription('View or manage punishment records')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('view')
                    .setDescription('View punishment history for a user')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to look up')
                            .setRequired(true),
                    ),
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('Remove/void a punishment by case number')
                    .addStringOption(option =>
                        option.setName('case')
                            .setDescription('The case number to remove (e.g. PUN-XXXX)')
                            .setRequired(true),
                    ),
            ),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === 'view') {
                    const targetUser = interaction.options.getUser('user', true);
                    if (!interaction.guildId) {
                        await interaction.editReply('This command can only be used in a server.');
                        return;
                    }

                    const records = await getInfractionsForUser(interaction.guildId, targetUser.id);

                    if (records.length === 0) {
                        const embed = brandedEmbed('Punishment History')
                            .setDescription(`${targetUser} has no punishment history.`);
                        await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
                        return;
                    }

                    const historyText = records
                        .slice(0, 20)
                        .map(r => {
                            const date = new Date(r.createdAt);
                            const timestamp = Math.floor(date.getTime() / 1000);
                            return `• **${r.caseNumber}** — ${r.action} — ${r.status}\n  Reason: ${r.reason}\n  <t:${timestamp}:f>`;
                        })
                        .join('\n\n');

                    const embed = brandedEmbed(`Punishment History — ${targetUser.username}`)
                        .setDescription(`${targetUser} has ${records.length} record(s):\n\n${historyText}`)
                        .setThumbnail(targetUser.displayAvatarURL());

                    await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
                    return;
                }

                if (subcommand === 'remove') {
                    const caseNumber = interaction.options.getString('case', true).trim().toUpperCase();
                    if (!interaction.guildId) {
                        await interaction.editReply('This command can only be used in a server.');
                        return;
                    }

                    if (!isDatabaseAvailable()) {
                        await interaction.editReply('The database is currently unavailable. Cannot remove punishment.');
                        return;
                    }

                    const record = await getInfractionByCaseNumber(interaction.guildId, caseNumber);
                    if (!record) {
                        await interaction.editReply(`No punishment found with case number **${caseNumber}**.`);
                        return;
                    }

                    await Infraction.updateOne(
                        { guildId: interaction.guildId, caseNumber },
                        { $set: { status: 'Voided', updatedAt: new Date() } },
                    ).exec();

                    const embed = brandedEmbed('Punishment Removed')
                        .setDescription(`Case **${caseNumber}** has been voided.`)
                        .addFields(
                            { name: 'User', value: `<@${record.memberId}>`, inline: true },
                            { name: 'Original Action', value: record.action, inline: true },
                            { name: 'Original Reason', value: record.reason },
                        );

                    await interaction.editReply({ embeds: [embed], files: [createLogoAttachment()] });
                    return;
                }
            } catch (error) {
                console.error('[Punishment] Subcommand failed.', error);
                markSlashCommandFailed(interaction, error);
                await interaction.editReply('Unable to complete that action. Please try again later.');
            }
        },
    },
];

