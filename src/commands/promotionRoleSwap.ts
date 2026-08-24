import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
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
import { PROMOTION_AUTHORIZED_ROLE_ID } from '../config/constants';
import { memberHasRole } from './staffManagement';
import { logger } from '../utils/logger';

const BRAND_COLOR = 0x3b82f6;
const PROMOTIONS_CHANNEL_ID = '1526044978109743255';
const PROTECTED_ROLE_ID = '1521593407762464946';
const COMMUNITY_MEMBER_ROLE_NAME = 'community member';
const PROMOTION_BANNER_NAME = 'promotion-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const PROMOTION_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', PROMOTION_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
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

function compact(value: string, max = 700): string {
    const clean = value.replace(/[\r\n]+/g, ' ').replace(/`/g, 'ˋ').trim() || 'Not provided.';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function timestamp(): string {
    return `<t:${Math.floor(Date.now() / 1000)}:F>`;
}

export function promotionKeepsOldRank(role: { id: string; name?: string }): boolean {
    return role.id === PROTECTED_ROLE_ID
        || role.name?.trim().toLowerCase() === COMMUNITY_MEMBER_ROLE_NAME;
}

function promotionPanel(input: {
    memberId: string;
    oldRankId: string;
    newRoleId: string;
    newRoleName: string;
    reason: string;
    approvedById: string;
    effectiveDate: string;
    issuedById: string;
    oldRankRetained: boolean;
    promotionUrl?: string;
}): ContainerBuilder {
    const badge = new ButtonBuilder()
        .setCustomId(`promotion:display:${input.memberId}`)
        .setLabel(`Promoted to ${input.newRoleName}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true);

    const text = [
        '## 🎖️ Staff Promotion',
        '> The high ranking team at Los Angeles Roleplay has issued a promotion.',
        '',
        `> **Member:** <@${input.memberId}>`,
        `> **Old Rank ${input.oldRankRetained ? 'Retained' : 'Removed'}:** <@&${input.oldRankId}>`,
        `> **New Rank Added:** <@&${input.newRoleId}>`,
        `> **Reason:** ${compact(input.reason)}`,
        `> **Approved By:** <@${input.approvedById}>`,
        `> **Effective Date:** \`${compact(input.effectiveDate, 100)}\``,
        `> **Issued By:** <@${input.issuedById}>`,
        `> **Submitted:** ${timestamp()}`,
    ].join('\n');

    const panel = new ContainerBuilder()
        .setAccentColor(BRAND_COLOR)
        .addMediaGalleryComponents(media(PROMOTION_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
                .setButtonAccessory(badge),
        );

    if (input.promotionUrl) {
        panel.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setLabel('View Promotion').setStyle(ButtonStyle.Link).setURL(input.promotionUrl),
            ),
        );
    }

    return panel.addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export const promotionRoleSwapCommand = {
    data: new SlashCommandBuilder()
        .setName('promotion')
        .setDescription('Manage staff promotions')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('issue')
                .setDescription('Issue a promotion and update the member rank')
                .addUserOption(option => option.setName('member').setDescription('The member being promoted').setRequired(true))
                .addRoleOption(option => option.setName('old-rank').setDescription('The rank that should be removed').setRequired(true))
                .addRoleOption(option => option.setName('new-role').setDescription('The new rank that should be added').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('The reason for the promotion').setRequired(true).setMaxLength(1024))
                .addUserOption(option => option.setName('approved-by').setDescription('The person who approved the promotion').setRequired(true))
                .addStringOption(option => option.setName('effective-date').setDescription('The date the promotion takes effect').setRequired(true).setMaxLength(100)),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            interaction.options.getSubcommand(true);
            if (!interaction.guild) {
                await interaction.editReply('This command can only be used in a server.');
                return;
            }
            if (!(await memberHasRole(interaction, PROMOTION_AUTHORIZED_ROLE_ID))) {
                await interaction.editReply(`You need <@&${PROMOTION_AUTHORIZED_ROLE_ID}> to issue promotions.`);
                return;
            }

            const user = interaction.options.getUser('member', true);
            const oldRank = interaction.options.getRole('old-rank', true);
            const newRank = interaction.options.getRole('new-role', true);
            const reason = interaction.options.getString('reason', true);
            const approvedBy = interaction.options.getUser('approved-by', true);
            const effectiveDate = interaction.options.getString('effective-date', true);

            if (oldRank.id === newRank.id) {
                await interaction.editReply('The old rank and new rank cannot be the same role.');
                return;
            }
            const keepOldRank = promotionKeepsOldRank(oldRank);

            const target = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!target) {
                await interaction.editReply('I could not load that server member.');
                return;
            }
            if (!target.roles.cache.has(oldRank.id)) {
                await interaction.editReply(`That member does not currently have the selected old rank <@&${oldRank.id}>. No roles were changed.`);
                return;
            }

            const botMember = interaction.guild.members.me;
            if (!botMember) {
                await interaction.editReply('I could not verify my server role permissions. No roles were changed.');
                return;
            }
            const cannotManageNewRank = newRank.managed || newRank.position >= botMember.roles.highest.position;
            const cannotManageRemovableOldRank = !keepOldRank
                && (oldRank.managed || oldRank.position >= botMember.roles.highest.position);
            if (cannotManageNewRank || cannotManageRemovableOldRank) {
                await interaction.editReply(keepOldRank
                    ? 'I cannot add the selected new rank. Move my bot role above the new rank and make sure it is not integration-managed. Community Member will remain untouched.'
                    : 'I cannot manage the selected old or new rank. Move my bot role above both ranks and make sure neither is integration-managed.');
                return;
            }

            // Add the new rank first so the member is never left without a rank.
            const alreadyHadNewRank = target.roles.cache.has(newRank.id);
            const hadProtectedRole = target.roles.cache.has(PROTECTED_ROLE_ID);
            if (!alreadyHadNewRank) {
                await target.roles.add(newRank.id, `Promotion issued by ${interaction.user.id}`);
            }

            if (!keepOldRank) {
                try {
                    await target.roles.remove(oldRank.id, `Promoted to ${newRank.name} by ${interaction.user.id}`);
                } catch (removeError) {
                    // Roll back only the role this command added. Never disturb pre-existing roles.
                    if (!alreadyHadNewRank) {
                        await target.roles.remove(newRank.id, 'Promotion rollback after old-rank removal failed').catch(() => undefined);
                    }
                    throw removeError;
                }
            }

            // Defensive verification after Discord accepts the role edits.
            const refreshed = await interaction.guild.members.fetch(user.id);
            if (refreshed.roles.cache.has(PROTECTED_ROLE_ID) !== hadProtectedRole) {
                throw new Error('The protected Community Member role changed unexpectedly.');
            }
            if (!refreshed.roles.cache.has(newRank.id)
                || (keepOldRank && !refreshed.roles.cache.has(oldRank.id))
                || (!keepOldRank && refreshed.roles.cache.has(oldRank.id))) {
                throw new Error('Discord did not persist the requested promotion role update.');
            }

            const roleChangeSummary = keepOldRank
                ? `kept <@&${oldRank.id}> and added <@&${newRank.id}>`
                : `removed <@&${oldRank.id}> and added <@&${newRank.id}>`;

            const destination = await interaction.client.channels.fetch(PROMOTIONS_CHANNEL_ID).catch(() => null);
            if (!destination?.isSendable()) {
                // Roles already changed successfully, so report that clearly instead of pretending the promotion failed.
                await interaction.editReply(`✅ Roles updated: ${roleChangeSummary}. Warning: the promotions channel is unavailable, so I could not publish the announcement.`);
                return;
            }

            const details = {
                memberId: user.id,
                oldRankId: oldRank.id,
                newRoleId: newRank.id,
                newRoleName: newRank.name,
                reason,
                approvedById: approvedBy.id,
                effectiveDate,
                issuedById: interaction.user.id,
                oldRankRetained: keepOldRank,
            };
            const message = await destination.send({
                components: [promotionPanel(details)],
                files: artwork(),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], users: [user.id] },
            });

            let dmSent = true;
            await user.send({
                components: [promotionPanel({ ...details, promotionUrl: message.url })],
                files: artwork(),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            }).catch(() => { dmSent = false; });

            await interaction.editReply(
                `✅ Promotion completed for ${user.username}: ${roleChangeSummary}.\n${message.url}`
                + (dmSent ? '\nThey were also notified by DM.' : '\nWarning: their DM could not be delivered.'),
            );
        } catch (error) {
            logger.error(`[Promotion] Role swap failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await interaction.editReply('I could not complete the promotion role swap. No protected role was removed. Check my Manage Roles permission and role position, then try again.');
        }
    },
};
