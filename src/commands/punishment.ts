import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { Infraction } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import { markSlashCommandFailed } from '../utils/commandAudit';
import { legacyEmbedToV2Message } from '../utils/embeds';

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
    appealable: boolean;
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
    {
        data: new SlashCommandBuilder()
            .setName('punish')
            .setDescription('Warn a user and create a punishment record')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to warn')
                    .setRequired(true),
            )
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for the warning')
                    .setRequired(true)
                    .setMaxLength(1024),
            ),

        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const targetUser = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason', true);

                if (!interaction.guildId || !interaction.guild) {
                    await interaction.editReply('This command can only be used in a server.');
                    return;
                }

                const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                if (!member) {
                    await interaction.editReply('That user is not in this server.');
                    return;
                }

                if (targetUser.id === interaction.user.id) {
                    await interaction.editReply('You cannot punish yourself.');
                    return;
                }

                const caseNumber = generateCaseNumber();
                const finalAction = 'Warning';

                const dmEmbed = brandedEmbed(`Punishment Notice | ${caseNumber}`)
                    .setDescription('You have received a warning from the Los Angeles Roleplay staff team.')
                    .addFields(
                        { name: 'Action', value: finalAction, inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Case Number', value: caseNumber, inline: true },
                    );

                let dmSent = false;
                try {
                    const client = cachedClient;
                    if (client) {
                        const user = await client.users.fetch(targetUser.id);
                        if (user) {
                            await user.send(legacyEmbedToV2Message(dmEmbed, {
                                actionRows: [
                                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                                        new ButtonBuilder()
                                            .setCustomId(`infraction-appeal:start:punishment-${caseNumber}`)
                                            .setLabel('Appeal Infraction')
                                            .setStyle(ButtonStyle.Primary)
                                            .setEmoji('⚖️'),
                                    ),
                                ],
                            }));
                            dmSent = true;
                        }
                    }
                } catch {
                    dmSent = false;
                }

                const saved = await saveInfractionToDb({
                    caseNumber,
                    guildId: interaction.guildId,
                    memberId: targetUser.id,
                    memberUsername: targetUser.username,
                    issuedById: interaction.user.id,
                    action: finalAction,
                    reason,
                    status: 'Active',
                    appealable: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                const confirmEmbed = brandedEmbed('Warning Issued')
                    .setDescription(`${targetUser} has been warned (Case: ${caseNumber}).`)
                    .addFields(
                        { name: 'Action', value: finalAction, inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Case Number', value: caseNumber, inline: true },
                        { name: 'Saved', value: saved ? '✅ Yes' : '❌ No', inline: true },
                        { name: 'DM Sent', value: dmSent ? '✅ Yes' : '❌ No (DMs may be closed)', inline: true },
                    );

                await interaction.editReply(legacyEmbedToV2Message(confirmEmbed));
            } catch (error) {
                console.error('[Punishment] Command failed.', error);
                markSlashCommandFailed(interaction, error);
                await interaction.editReply('Unable to complete the warning. Please try again.');
            }
        },
    },
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
                        await interaction.editReply(legacyEmbedToV2Message(embed));
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

                    await interaction.editReply(legacyEmbedToV2Message(embed));
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

                    await interaction.editReply(legacyEmbedToV2Message(embed));
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
