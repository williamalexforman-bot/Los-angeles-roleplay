import { resolve } from 'path';
import {
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    GuildMember,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { PROMOTION_AUTHORIZED_ROLE_ID } from '../config/constants';
import { logger } from '../utils/logger';

const PROMOTIONS_CHANNEL_ID = '1526044978109743255';
const PROMOTION_BANNER_NAME = 'promotion-banner.png';
const PROMOTION_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', PROMOTION_BANNER_NAME);
const UNDERBANNER_NAME = 'underbanner.png';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const PANEL_COLOR = 0x247bf1;

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(PROMOTION_BANNER_PATH, { name: PROMOTION_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

async function canIssue(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

    const allowed = [
        PROMOTION_AUTHORIZED_ROLE_ID,
        process.env.BOT_PERMISSIONS_ROLE_ID,
        process.env.ADMIN_ROLE_ID,
    ].filter((value): value is string => Boolean(value));

    const member = interaction.member;
    if (member instanceof GuildMember && allowed.some(roleId => member.roles.cache.has(roleId))) return true;
    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched && allowed.some(roleId => fetched.roles.cache.has(roleId)));
}

function panel(input: {
    memberId: string;
    oldRankId: string;
    newRoleId: string;
    newRoleName: string;
    reason: string;
    approvedById: string;
    effectiveDate: string;
    issuedById: string;
    postUrl?: string;
}): ContainerBuilder {
    const text = [
        '## 🎖️ Staff Promotion',
        '> The High Ranking Team at Los Angeles Roleplay has issued a staff promotion.',
        '',
        `> **Member:** <@${input.memberId}>`,
        `> **Old Rank:** <@&${input.oldRankId}>`,
        `> **New Role:** <@&${input.newRoleId}>`,
        `> **Reason:** ${input.reason.slice(0, 900)}`,
        `> **Approved By:** <@${input.approvedById}>`,
        `> **Effective Date:** \`${input.effectiveDate.slice(0, 100)}\``,
        `> **Issued By:** <@${input.issuedById}>`,
        `> **Submitted:** <t:${Math.floor(Date.now() / 1000)}:F>`,
    ].join('\n');

    const badge = new ButtonBuilder()
        .setCustomId(`promotion:v2:${input.memberId}`)
        .setLabel(`Promoted to ${input.newRoleName}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true);

    const container = new ContainerBuilder()
        .setAccentColor(PANEL_COLOR)
        .addMediaGalleryComponents(media(PROMOTION_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
                .setButtonAccessory(badge),
        );

    if (input.postUrl) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`[View Promotion Post](${input.postUrl})`),
        );
    }

    return container
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export async function handlePromotionV2Repair(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.commandName !== 'promotion') return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await canIssue(interaction))) {
        await interaction.editReply(`You need <@&${PROMOTION_AUTHORIZED_ROLE_ID}> or an authorized bot-management role to issue promotions.`);
        return true;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand !== 'issue') {
        await interaction.editReply('That promotion action is not available.');
        return true;
    }

    const member = interaction.options.getUser('member', true);
    const oldRank = interaction.options.getRole('old-rank', true);
    const newRole = interaction.options.getRole('new-role', true);
    const reason = interaction.options.getString('reason', true);
    const approvedBy = interaction.options.getUser('approved-by', true);
    const effectiveDate = interaction.options.getString('effective-date', true);

    const channel = await interaction.client.channels.fetch(PROMOTIONS_CHANNEL_ID).catch(() => null);
    if (!channel?.isSendable()) {
        await interaction.editReply(`The promotions channel <#${PROMOTIONS_CHANNEL_ID}> is unavailable.`);
        return true;
    }

    const details = {
        memberId: member.id,
        oldRankId: oldRank.id,
        newRoleId: newRole.id,
        newRoleName: newRole.name,
        reason,
        approvedById: approvedBy.id,
        effectiveDate,
        issuedById: interaction.user.id,
    };

    try {
        const message = await channel.send({
            components: [panel(details)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [member.id] },
        });

        let dmOk = true;
        await member.send({
            components: [panel({ ...details, postUrl: message.url })],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(() => { dmOk = false; });

        await interaction.editReply(
            `✅ Components V2 promotion posted: ${message.url}${dmOk ? '\nThe member was also notified by DM.' : '\nThe member DM could not be delivered.'}`,
        );
        logger.info(`[PromotionV2Repair] Promotion posted for ${member.id} by ${interaction.user.id}.`);
    } catch (error) {
        const reasonText = error instanceof Error ? error.message : String(error);
        logger.error(`[PromotionV2Repair] Failed: ${reasonText}`);
        await interaction.editReply(`I could not post the V2 promotion emblem. Discord returned: ${reasonText.slice(0, 1200)}`);
    }

    return true;
}

export const promotionV2Command = {
    data: new SlashCommandBuilder()
        .setName('promotion')
        .setDescription('Manage staff promotions')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('issue')
                .setDescription('Issue and publish a Components V2 staff promotion')
                .addUserOption(option => option.setName('member').setDescription('The member being promoted').setRequired(true))
                .addRoleOption(option => option.setName('old-rank').setDescription("The member's current rank").setRequired(true))
                .addRoleOption(option => option.setName('new-role').setDescription('The new server role for this promotion').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('The reason for the promotion').setRequired(true).setMaxLength(1024))
                .addUserOption(option => option.setName('approved-by').setDescription('The person who approved the promotion').setRequired(true))
                .addStringOption(option => option.setName('effective-date').setDescription('The date the promotion takes effect').setRequired(true).setMaxLength(100)),
        ),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await handlePromotionV2Repair(interaction);
    },
};
