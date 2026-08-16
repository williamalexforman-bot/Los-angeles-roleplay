import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    ContainerBuilder,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { fetchErlcServer, type ErlcCommandLog, type ErlcJoinLog } from '../services/erlcService';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';
import { logger } from '../utils/logger';

const ERLC_COMMAND_ENDPOINT = 'https://api.erlc.gg/v1/server/command';
const PANEL_COLOR = 0x247bf1;
const COMMAND_TIMEOUT_MS = 6_000;

function underbanner(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(BOTTOM_UNDERBANNER),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small);
}

function panel(title: string, blocks: readonly string[], color = PANEL_COLOR): ContainerBuilder {
    const container = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}`),
        )
        .addSeparatorComponents(separator());

    for (const block of blocks.filter(Boolean)) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(block.slice(0, 4_000)),
        );
    }

    return container
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(underbanner());
}

function panelAttachment(): AttachmentBuilder {
    return new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: 'underbanner.webp' });
}

async function editV2(
    interaction: ChatInputCommandInteraction,
    container: ContainerBuilder,
): Promise<void> {
    await interaction.editReply({
        components: [container],
        files: [panelAttachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

function interactionRoleIds(interaction: ChatInputCommandInteraction): string[] {
    const member = interaction.member;
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    if (Array.isArray(member.roles)) return member.roles;
    return [];
}

async function canManageErlc(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const configured = [process.env.BOT_PERMISSIONS_ROLE_ID, process.env.ADMIN_ROLE_ID]
        .map(value => value?.trim())
        .filter((value): value is string => Boolean(value));
    if (!configured.length) return false;

    const current = new Set(interactionRoleIds(interaction));
    if (configured.some(roleId => current.has(roleId))) return true;

    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched && configured.some(roleId => fetched.roles.cache.has(roleId)));
}

function commandLogLine(log: ErlcCommandLog): string {
    const timestamp = log.timestamp > 0 ? `<t:${Math.floor(log.timestamp)}:R>` : 'Unknown time';
    const safeCommand = log.command.replace(/`/g, 'ˋ').slice(0, 180);
    return `🎮 **${log.player.name}** — \`${safeCommand}\` • ${timestamp}`;
}

function joinLogLine(log: ErlcJoinLog): string {
    const timestamp = log.timestamp > 0 ? `<t:${Math.floor(log.timestamp)}:R>` : 'Unknown time';
    return `${log.joined ? '🟢' : '🔴'} **${log.player.name}** ${log.joined ? 'joined' : 'left'} • ${timestamp}`;
}

const recentInGameLogsCommand = {
    data: new SlashCommandBuilder()
        .setName('recent-in-game-logs')
        .setDescription('View the most recent ER:LC command and join/leave logs')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!await canManageErlc(interaction)) {
            await editV2(interaction, panel('🔒 Access Denied', [
                'You need Administrator permission or the configured bot-permissions role to view recent in-game logs.',
            ], 0xef4444));
            return;
        }

        const result = await fetchErlcServer({ timeoutMs: 8_000 });
        if (!result.ok) {
            await editV2(interaction, panel('⚠️ In-Game Logs Unavailable', [
                'I could not load the ER:LC logs right now. Please try again shortly.',
            ], 0xf59e0b));
            return;
        }

        const entries = [
            ...result.data.commandLogs.map(log => ({ timestamp: log.timestamp, line: commandLogLine(log) })),
            ...result.data.joinLogs.map(log => ({ timestamp: log.timestamp, line: joinLogLine(log) })),
        ]
            .sort((left, right) => right.timestamp - left.timestamp)
            .slice(0, 15);

        await editV2(interaction, panel('📋 Recent In-Game Logs', [
            `**Server:** ${result.data.name}\n**Showing:** ${entries.length} most recent log${entries.length === 1 ? '' : 's'}`,
            entries.length ? entries.map(entry => entry.line).join('\n') : 'No recent in-game logs were returned by ER:LC.',
        ]));
    },
};

const inGameInfoCommand = {
    data: new SlashCommandBuilder()
        .setName('in-game-info')
        .setDescription('View who is currently in the ER:LC server')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await fetchErlcServer({ timeoutMs: 8_000 });
        if (!result.ok) {
            await editV2(interaction, panel('⚠️ In-Game Info Unavailable', [
                'I could not load the live ER:LC server information right now. Please try again shortly.',
            ], 0xf59e0b));
            return;
        }

        const players = [...result.data.players]
            .sort((left, right) => left.player.name.localeCompare(right.player.name));
        const playerLines = players.map((player, index) => {
            const extras = [
                player.team,
                player.permission && player.permission !== 'Normal' ? player.permission : null,
                player.callsign ? `Callsign ${player.callsign}` : null,
            ].filter(Boolean).join(' • ');
            return `**${index + 1}.** ${player.player.name}${extras ? ` — ${extras}` : ''}`;
        });

        const blocks: string[] = [
            `**Server:** ${result.data.name}\n**Players Online:** ${result.data.currentPlayers}/${result.data.maxPlayers}`,
        ];
        if (!playerLines.length) {
            blocks.push('No players are currently in-game.');
        } else {
            for (let index = 0; index < playerLines.length; index += 18) {
                blocks.push(playerLines.slice(index, index + 18).join('\n'));
            }
        }

        await editV2(interaction, panel('👥 In-Game Information', blocks));
    },
};

const erlcCommandCommand = {
    data: new SlashCommandBuilder()
        .setName('erlc-command')
        .setDescription('Run an ER:LC private-server command from Discord')
        .setDMPermission(false)
        .addStringOption(option => option
            .setName('command')
            .setDescription('Command to run, for example :weather 12')
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(200)),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!await canManageErlc(interaction)) {
            await editV2(interaction, panel('🔒 ER:LC Command Denied', [
                'You need Administrator permission or the configured bot-permissions role to run ER:LC commands.',
            ], 0xef4444));
            return;
        }

        const serverKey = (process.env.ERLC_SERVER_KEY || '').trim();
        if (!serverKey) {
            await editV2(interaction, panel('⚠️ ER:LC Command Unavailable', [
                'The ER:LC server key is not configured on this bot.',
            ], 0xf59e0b));
            return;
        }

        const entered = interaction.options.getString('command', true).trim();
        const command = entered.startsWith(':') ? entered : `:${entered}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

        try {
            const response = await fetch(ERLC_COMMAND_ENDPOINT, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'server-key': serverKey,
                },
                body: JSON.stringify({ command }),
                signal: controller.signal,
            });

            if (!response.ok) {
                logger.warn(`[ERLC Command] HTTP ${response.status} for Discord user ${interaction.user.id}.`);
                await editV2(interaction, panel('❌ ER:LC Command Failed', [
                    `The command \`${command.replace(/`/g, 'ˋ')}\` could not be executed.`,
                    `**API Status:** ${response.status}`,
                ], 0xef4444));
                return;
            }

            logger.info(`[ERLC Command] ${interaction.user.id} executed ${command.split(/\s+/, 1)[0]}.`);
            await editV2(interaction, panel('✅ ER:LC Command Executed', [
                `**Command:** \`${command.replace(/`/g, 'ˋ')}\``,
                `**Executed By:** <@${interaction.user.id}>`,
                'The command was sent to the live ER:LC server successfully.',
            ], 0x22c55e));
        } catch {
            await editV2(interaction, panel('❌ ER:LC Command Failed', [
                'The ER:LC command endpoint could not be reached. Please try again.',
            ], 0xef4444));
        } finally {
            clearTimeout(timer);
        }
    },
};

export const erlcUtilityCommands = [
    recentInGameLogsCommand,
    inGameInfoCommand,
    erlcCommandCommand,
];
