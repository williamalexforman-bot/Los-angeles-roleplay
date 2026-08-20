import { resolve } from 'path';
import {
    AttachmentBuilder,
    ButtonInteraction,
    ButtonStyle,
    ContainerBuilder,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type APIInteractionGuildMember,
    type Message,
} from 'discord.js';
import { BRAND, PARTNERSHIP_ROLE_ID } from '../config/constants';
import { logger } from '../utils/logger';

const PARTNERSHIP_APPROVAL_CHANNEL_ID = process.env.PARTNERSHIP_APPROVAL_CHANNEL_ID || '1526042350802043022';
const PARTNERSHIP_SUPPORT_ROLE_ID = '1523122697746382868';
const PARTNERSHIP_BANNER_NAME = 'partnership-banner.webp';
const PARTNERSHIP_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', PARTNERSHIP_BANNER_NAME);
const UNDERBANNER_NAME = 'underbanner.webp';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

type RequestData = {
    serverName: string;
    representative: string;
    inviteLink: string;
    serverAd: string;
    submitterId: string;
};

type ComponentNode = {
    type?: number;
    content?: string;
    custom_id?: string;
    disabled?: boolean;
    style?: number;
    components?: ComponentNode[];
};

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(PARTNERSHIP_BANNER_PATH, { name: PARTNERSHIP_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function componentText(message: Message): string[] {
    const text: string[] = [];
    const visit = (node: ComponentNode): void => {
        if (typeof node.content === 'string') text.push(node.content);
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components) visit(component.toJSON() as ComponentNode);
    return text;
}

function detailValue(details: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return details.match(new RegExp(`^> \\*\\*${escaped}:\\*\\* (.+)$`, 'm'))?.[1]?.trim() || '';
}

function validInvite(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && (url.hostname === 'discord.gg' || url.hostname === 'discord.com')
            && (url.hostname === 'discord.gg' || url.pathname.startsWith('/invite/'));
    } catch {
        return false;
    }
}

function requestDataFromMessage(message: Message, submitterId: string): RequestData | null {
    const text = componentText(message);
    const details = text.find(content => content.includes('**Server Name:**'));
    const adHeading = text.findIndex(content => content === '## 📢 Full Advertisement');
    if (!details || adHeading < 0 || !text[adHeading + 1]) return null;

    const inviteValue = detailValue(details, 'Invite Link');
    const inviteLink = inviteValue.match(/\((https:\/\/[^)]+)\)/)?.[1] || inviteValue;
    const data: RequestData = {
        serverName: detailValue(details, 'Server Name'),
        representative: detailValue(details, 'Representative'),
        inviteLink,
        serverAd: text[adHeading + 1],
        submitterId,
    };
    return data.serverName && data.representative && validInvite(data.inviteLink) ? data : null;
}

function cachedRoleIds(interaction: ButtonInteraction): string[] {
    const member = interaction.member;
    if (!member) return [];
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    const apiMember = member as APIInteractionGuildMember;
    return Array.isArray(apiMember.roles) ? apiMember.roles : [];
}

async function canReview(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;

    const configured = [
        PARTNERSHIP_SUPPORT_ROLE_ID,
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
        process.env.HIGH_RANK_ROLE_ID,
        process.env.MANAGEMENT_ROLE_ID,
        process.env.GENERAL_SUPPORT_ROLE_ID,
    ].filter((value): value is string => Boolean(value));

    const cached = cachedRoleIds(interaction);
    if (configured.some(roleId => cached.includes(roleId))) return true;

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member && configured.some(roleId => member.roles.cache.has(roleId)));
}

function reviewedComponents(message: Message, approved: boolean, reviewerId: string): unknown[] {
    const components = message.components.map(component => component.toJSON()) as ComponentNode[];
    const status = approved ? 'Approved' : 'Denied';
    const visit = (node: ComponentNode): void => {
        if (typeof node.content === 'string' && node.content.includes('> **Status:**')) {
            node.content = node.content.replace(/> \*\*Status:\*\*[^\n]*/, `> **Status:** \`${status}\` • Reviewed by <@${reviewerId}>`);
            if (node.content.startsWith('## ')) {
                node.content = node.content.replace(/^## .+/, `## ${approved ? '✅ Partnership Approved' : '❌ Partnership Denied'}`);
            }
        }
        if (node.custom_id?.startsWith('partnership:approve:') || node.custom_id?.startsWith('partnership:deny:')) {
            const selected = node.custom_id.startsWith(approved ? 'partnership:approve:' : 'partnership:deny:');
            node.disabled = true;
            node.style = selected ? (approved ? ButtonStyle.Success : ButtonStyle.Danger) : ButtonStyle.Secondary;
        }
        for (const child of node.components || []) visit(child);
    };
    components.forEach(visit);
    return components;
}

function approvedPanel(data: RequestData, reviewerId: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(0x22c55e)
        .addMediaGalleryComponents(media(PARTNERSHIP_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## ✅ Partnership Approved',
            `> **Server Name:** ${data.serverName}`,
            `> **Representative:** ${data.representative}`,
            `> **Invite Link:** [Join Server](${data.inviteLink})`,
            `> **Submitted By:** <@${data.submitterId}>`,
            `> **Status:** \`Approved\` • Reviewed by <@${reviewerId}>`,
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📢 Partner Advertisement'))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(data.serverAd.slice(0, 4_000)))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export async function handlePartnershipReviewRepair(interaction: ButtonInteraction): Promise<boolean> {
    const approve = interaction.customId.startsWith('partnership:approve:');
    const deny = interaction.customId.startsWith('partnership:deny:');
    if (!approve && !deny) return false;

    if (!(await canReview(interaction))) {
        await interaction.reply({
            content: 'Only authorized support/management staff may review partnership requests.',
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const submitterId = interaction.customId.split(':')[2];
    const request = requestDataFromMessage(interaction.message, submitterId);
    if (!request) {
        await interaction.reply({
            content: 'I could not read this partnership request. Please have the member submit a new request.',
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (approve) {
        const channel = await interaction.client.channels.fetch(PARTNERSHIP_APPROVAL_CHANNEL_ID).catch(() => null);
        if (!channel?.isSendable()) {
            await interaction.editReply('The approved-partnership channel is unavailable. Nothing was changed.');
            return true;
        }

        try {
            await channel.send({
                components: [approvedPanel(request, interaction.user.id)],
                files: artwork(),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], users: [submitterId, interaction.user.id] },
            });
        } catch (error) {
            logger.error(`[PartnershipReviewRepair] Approval post failed: ${error instanceof Error ? error.message : String(error)}`);
            await interaction.editReply('I could not publish the approved partnership. Check my Send Messages/Attach Files permissions in the approved-partnership channel.');
            return true;
        }

        let roleResult = 'Partnership approved and published.';
        if (PARTNERSHIP_ROLE_ID && interaction.guild) {
            const member = await interaction.guild.members.fetch(submitterId).catch(() => null);
            const role = await interaction.guild.roles.fetch(PARTNERSHIP_ROLE_ID).catch(() => null);
            if (member && role) {
                const assigned = await member.roles.add(role, `Partnership approved by ${interaction.user.tag}`).then(() => true).catch(() => false);
                if (!assigned) roleResult = 'Partnership approved and published, but I could not assign the partnership role.';
            } else {
                roleResult = 'Partnership approved and published, but I could not load the member or partnership role.';
            }
        }

        await interaction.message.edit({
            components: reviewedComponents(interaction.message, true, interaction.user.id) as never,
            attachments: Array.from(interaction.message.attachments.values()),
        }).catch(error => logger.warn(`[PartnershipReviewRepair] Could not mark request approved: ${error instanceof Error ? error.message : String(error)}`));

        await interaction.editReply(roleResult);
        return true;
    }

    await interaction.message.edit({
        components: reviewedComponents(interaction.message, false, interaction.user.id) as never,
        attachments: Array.from(interaction.message.attachments.values()),
    }).catch(error => logger.warn(`[PartnershipReviewRepair] Could not mark request denied: ${error instanceof Error ? error.message : String(error)}`));
    await interaction.editReply('Partnership request denied.');
    return true;
}
