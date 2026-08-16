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
import { resolveDockRobloxProfile } from '../services/dockService';
import { BOTTOM_UNDERBANNER, SESSION_UNDERBANNER_PATH } from '../utils/embeds';

const ACCOUNT_INFO_ROLE_ID = '1521593407850680401';
const PANEL_COLOR = 0x247bf1;

function divider(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function underbanner(): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(BOTTOM_UNDERBANNER));
}

function attachment(): AttachmentBuilder {
    return new AttachmentBuilder(SESSION_UNDERBANNER_PATH, { name: 'underbanner.webp' });
}

function panel(title: string, blocks: readonly string[], color = PANEL_COLOR): ContainerBuilder {
    const container = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(divider());
    for (const block of blocks.filter(Boolean)) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.slice(0, 4_000)));
    }
    return container.addSeparatorComponents(divider()).addMediaGalleryComponents(underbanner());
}

async function replyPanel(interaction: ChatInputCommandInteraction, content: ContainerBuilder): Promise<void> {
    await interaction.editReply({
        components: [content],
        files: [attachment()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

async function canViewAccountInfo(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const member = interaction.member;
    const configured = [
        ACCOUNT_INFO_ROLE_ID,
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
    ].filter((value): value is string => Boolean(value));

    if (member instanceof GuildMember && configured.some(roleId => member.roles.cache.has(roleId))) return true;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched && configured.some(roleId => fetched.roles.cache.has(roleId)));
}

function unixFromDate(date: Date | null | undefined): number | null {
    return date ? Math.floor(date.getTime() / 1_000) : null;
}

function isoUnix(value: string | null): number | null {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : null;
}

function compact(value: string | null | undefined, max = 700): string {
    const clean = value?.replace(/```/g, "'''").trim();
    if (!clean) return 'None';
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export const viewDiscordInfoCommand = {
    data: new SlashCommandBuilder()
        .setName('view-discord-info')
        .setDescription('View Discord account information for a server member')
        .setDMPermission(false)
        .addUserOption(option => option
            .setName('user')
            .setDescription('Discord user to inspect')
            .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!await canViewAccountInfo(interaction)) {
            await replyPanel(interaction, panel('🔒 Access Denied', [
                `You need <@&${ACCOUNT_INFO_ROLE_ID}>, an authorized bot-management role, or Administrator permission.`,
            ], 0xef4444));
            return;
        }
        if (!interaction.guild) return;

        const user = interaction.options.getUser('user', true);
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        const created = Math.floor(user.createdTimestamp / 1_000);
        const joined = unixFromDate(member?.joinedAt);
        const roles = member
            ? [...member.roles.cache.values()]
                .filter(role => role.id !== interaction.guild!.id)
                .sort((left, right) => right.position - left.position)
            : [];
        const visibleRoles = roles.slice(0, 15).map(role => `<@&${role.id}>`);
        const roleText = visibleRoles.length
            ? `${visibleRoles.join(' • ')}${roles.length > visibleRoles.length ? `\n+${roles.length - visibleRoles.length} more role(s)` : ''}`
            : 'None';

        await replyPanel(interaction, panel('👤 Discord Account Information', [
            [
                `**User:** <@${user.id}>`,
                `**Username:** \`${user.username}\``,
                `**Display Name:** ${user.globalName ? `\`${user.globalName}\`` : 'None'}`,
                `**User ID:** \`${user.id}\``,
                `**Bot Account:** ${user.bot ? 'Yes' : 'No'}`,
            ].join('\n'),
            [
                `**Account Created:** <t:${created}:F> • <t:${created}:R>`,
                `**Joined Server:** ${joined ? `<t:${joined}:F> • <t:${joined}:R>` : 'Not currently in the server / unavailable'}`,
                `**Highest Role:** ${member?.roles.highest && member.roles.highest.id !== interaction.guild.id ? `<@&${member.roles.highest.id}>` : 'None'}`,
                `**Roles (${roles.length}):** ${roleText}`,
            ].join('\n'),
        ]));
    },
};

export const viewRobloxInfoCommand = {
    data: new SlashCommandBuilder()
        .setName('view-roblox-info')
        .setDescription('View the Dock-verified Roblox account for a Discord member')
        .setDMPermission(false)
        .addUserOption(option => option
            .setName('user')
            .setDescription('Discord user whose verified Roblox account you want to inspect')
            .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!await canViewAccountInfo(interaction)) {
            await replyPanel(interaction, panel('🔒 Access Denied', [
                `You need <@&${ACCOUNT_INFO_ROLE_ID}>, an authorized bot-management role, or Administrator permission.`,
            ], 0xef4444));
            return;
        }
        if (!interaction.guildId) return;

        const user = interaction.options.getUser('user', true);
        const lookup = await resolveDockRobloxProfile(interaction.guildId, user.id, { timeoutMs: 5_000 });
        if (!lookup.ok) {
            await replyPanel(interaction, panel('🎮 Roblox Account Information', [
                `**Discord User:** <@${user.id}>`,
                `**Dock Verification:** ⚠️ ${lookup.message}`,
            ], 0xf59e0b));
            return;
        }

        const profile = lookup.profile;
        const created = isoUnix(profile.createdAt);
        await replyPanel(interaction, panel('🎮 Roblox Account Information', [
            [
                `**Discord User:** <@${user.id}>`,
                `**Dock Verification:** ✅ Verified`,
                `**Roblox Username:** ${profile.username ? `\`${profile.username}\`` : 'Unavailable'}`,
                `**Display Name:** ${profile.displayName ? `\`${profile.displayName}\`` : 'Unavailable'}`,
                `**Roblox User ID:** \`${profile.robloxId}\``,
                `**Account Created:** ${created ? `<t:${created}:F> • <t:${created}:R>` : 'Unavailable'}`,
                `**Verified Badge:** ${profile.hasVerifiedBadge === null ? 'Unavailable' : profile.hasVerifiedBadge ? 'Yes' : 'No'}`,
                `**Banned:** ${profile.isBanned === null ? 'Unavailable' : profile.isBanned ? 'Yes' : 'No'}`,
                `**Profile:** https://www.roblox.com/users/${profile.robloxId}/profile`,
            ].join('\n'),
            `**Description**\n\`\`\`\n${compact(profile.description)}\n\`\`\``,
        ]));
    },
};

export const accountInfoCommands = [viewDiscordInfoCommand, viewRobloxInfoCommand];
