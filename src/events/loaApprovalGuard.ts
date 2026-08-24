import {
    ButtonInteraction,
    MessageFlags,
    PermissionFlagsBits,
    TextChannel,
    type GuildMember,
    type Message,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { LoaRequest as LoaRequestModel } from '../database/models';
import { logger } from '../utils/logger';

const LOA_ACTIVE_CHANNEL_ID = '1541223750832357456';
const LOA_ROLE_ID = process.env.LOA_ROLE_ID || '1521593407795888329';
const LOA_MANAGEMENT_ROLE_IDS = Array.from(new Set([
    process.env.BOT_PERMISSIONS_ROLE_ID,
    process.env.ADMIN_ROLE_ID,
    process.env.INFRACTION_AUTHORIZED_ROLE_ID,
    ...(process.env.LOA_MANAGEMENT_ROLE_IDS || '').split(','),
].map(value => value?.trim()).filter((value): value is string => Boolean(value))));

type LoaModule = {
    handleLoaButton: (interaction: ButtonInteraction) => Promise<boolean>;
};

type ComponentNode = {
    custom_id?: string;
    components?: readonly ComponentNode[];
};

let installed = false;

function interactionHasRole(interaction: ButtonInteraction, roleId: string): boolean {
    const member = interaction.member;
    if (!member || !roleId) return false;
    const roles = (member as { roles?: { cache?: { has(id: string): boolean } } | string[] }).roles;
    if (!roles) return false;
    if (Array.isArray(roles)) return roles.includes(roleId);
    return roles.cache?.has(roleId) ?? false;
}

async function canApprove(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (LOA_MANAGEMENT_ROLE_IDS.some(roleId => interactionHasRole(interaction, roleId))) return true;
    try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        return LOA_MANAGEMENT_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
    } catch {
        return false;
    }
}

function messageHasPendingId(message: Message, pendingId: string): boolean {
    const ids: string[] = [];
    const visit = (node: ComponentNode): void => {
        if (typeof node.custom_id === 'string') ids.push(node.custom_id);
        for (const child of node.components || []) visit(child);
    };
    for (const component of message.components) {
        visit(component.toJSON() as unknown as ComponentNode);
    }
    return ids.includes(`loa:active:end-early:${pendingId}`);
}

async function deleteFalseActiveCard(interaction: ButtonInteraction, pendingId: string): Promise<void> {
    const channel = await interaction.client.channels.fetch(LOA_ACTIVE_CHANNEL_ID).catch(() => null);
    if (!(channel instanceof TextChannel)) return;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return;
    for (const message of messages.values()) {
        if (!messageHasPendingId(message, pendingId)) continue;
        await message.delete().catch(() => undefined);
    }
}

async function memberHasLoaRole(interaction: ButtonInteraction, pendingId: string): Promise<boolean> {
    const userId = pendingId.match(/^(\d{17,20})-/u)?.[1];
    if (!userId || !interaction.guild) return false;
    const member = await interaction.guild.members.fetch(userId).catch(() => null) as GuildMember | null;
    return Boolean(member?.roles.cache.has(LOA_ROLE_ID));
}

async function approvalWasSuccessful(interaction: ButtonInteraction, pendingId: string): Promise<boolean> {
    if (isDatabaseAvailable()) {
        const record = await LoaRequestModel.findOne({ pendingId })
            .select({ status: 1 })
            .lean()
            .exec()
            .catch(() => null);
        if (record) return record.status === 'Approved';
    }

    // Discord remains the source of truth if MongoDB is unavailable. A real
    // approval must have successfully assigned the configured LOA role.
    return memberHasLoaRole(interaction, pendingId);
}

export function registerLoaApprovalGuard(): void {
    if (installed) return;
    installed = true;

    const loaModule = require('../commands/loa.ts') as LoaModule;
    const previous = loaModule.handleLoaButton.bind(loaModule);

    loaModule.handleLoaButton = async (interaction: ButtonInteraction): Promise<boolean> => {
        const match = interaction.customId.match(/^loa:review:approve:(.+)$/u);
        if (!match) return previous(interaction);

        const pendingId = match[1];
        if (!(await canApprove(interaction))) {
            await interaction.reply({
                content: 'Only management may approve LOA requests.',
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }

        const handled = await previous(interaction);
        if (!handled) return false;

        // The lifecycle wrapper posts the active card before returning. Verify
        // the underlying approval actually finished and remove the card if a
        // role/database failure caused a partial approval.
        const successful = await approvalWasSuccessful(interaction, pendingId);
        if (!successful) {
            await deleteFalseActiveCard(interaction, pendingId);
            logger.warn(`[LOA] Removed false active card for ${pendingId} because approval did not finish successfully.`);
        }
        return true;
    };

    logger.info('[LOA] Approval safety guard installed.');
}
