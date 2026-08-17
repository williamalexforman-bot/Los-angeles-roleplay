import {
    ActionRowBuilder,
    ButtonInteraction,
    GuildMember,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    UserSelectMenuInteraction,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import {
    EmergencyDispatchCall,
    type EmergencyDispatchCallRecord,
} from '../database/emergencyDispatchCallModel';
import { logger } from '../utils/logger';

const DISPATCH_ROLE_ID = '1530984749232033963';

type DispatchInteraction = ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction;
type ComponentJson = Record<string, unknown>;

async function hasDispatchRole(interaction: DispatchInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;

    const member = interaction.member;
    if (member instanceof GuildMember && member.roles.cache.has(DISPATCH_ROLE_ID)) return true;
    if (member && Array.isArray(member.roles) && member.roles.includes(DISPATCH_ROLE_ID)) return true;

    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched?.roles.cache.has(DISPATCH_ROLE_ID));
}

async function loadRecord(dispatchId: string): Promise<EmergencyDispatchCallRecord | null> {
    if (!isDatabaseAvailable()) return null;
    const record = await EmergencyDispatchCall.findOne({ dispatchId }).lean().exec().catch(error => {
        logger.warn(`[911 Controls] Could not load ${dispatchId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    });
    return record ? record as unknown as EmergencyDispatchCallRecord : null;
}

function assignedText(record: EmergencyDispatchCallRecord): string {
    return record.assignedDiscordIds?.length
        ? record.assignedDiscordIds.map(id => `<@${id}>`).join(' • ')
        : '*No units assigned yet.*';
}

function notesText(record: EmergencyDispatchCallRecord): string {
    if (!record.notes?.length) return '*No dispatch notes added yet.*';
    return record.notes.slice(-6).map(note => {
        const createdAt = new Date(note.createdAt);
        const unix = Number.isFinite(createdAt.getTime())
            ? Math.floor(createdAt.getTime() / 1_000)
            : Math.floor(Date.now() / 1_000);
        return `• <@${note.authorId}> • <t:${unix}:R> — ${String(note.text).slice(0, 450)}`;
    }).join('\n');
}

function patchPanelComponents(
    components: readonly { toJSON(): unknown }[],
    record: EmergencyDispatchCallRecord,
): ComponentJson[] {
    const roots = components.map(component => component.toJSON()) as ComponentJson[];
    const ended = record.status === 'Ended';

    const visit = (node: ComponentJson): void => {
        if (typeof node.content === 'string') {
            let content = node.content;
            if (content.includes('### 👥 Assigned Units')) {
                content = content.replace(
                    /### 👥 Assigned Units\n[\s\S]*$/,
                    `### 👥 Assigned Units\n${assignedText(record)}`,
                );
            }
            if (content.includes('### 📝 Dispatch Notes')) {
                content = content.replace(
                    /### 📝 Dispatch Notes\n[\s\S]*$/,
                    `### 📝 Dispatch Notes\n${notesText(record)}`,
                );
            }
            if (content.includes('**Status:**')) {
                content = content.replace(
                    /\*\*Status:\*\*[^\n]*/,
                    `**Status:** ${ended ? '🔴 **Ended — responding units are 10-8**' : '🟢 **Active**'}`,
                );
            }
            node.content = content;
        }

        if (typeof node.custom_id === 'string'
            && (node.custom_id.startsWith('dispatch911:') || node.custom_id.startsWith('dispatchpro:'))
            && /:(?:attach|notes|end):/.test(node.custom_id)) {
            node.disabled = ended;
        }

        const children = node.components;
        if (Array.isArray(children)) {
            for (const child of children) {
                if (child && typeof child === 'object' && !Array.isArray(child)) {
                    visit(child as ComponentJson);
                }
            }
        }
    };

    for (const root of roots) visit(root);
    return roots;
}

async function refreshOriginalPanel(
    interaction: DispatchInteraction,
    record: EmergencyDispatchCallRecord,
): Promise<void> {
    if (!record.channelId || !record.messageId) return;
    const channel = await interaction.client.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(record.messageId).catch(() => null);
    if (!message) return;

    await message.edit({
        components: patchPanelComponents(message.components, record) as never,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

function notesModal(dispatchId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`dispatchstable:notes:${dispatchId}`)
        .setTitle('Add Dispatch Notes')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('notes')
                    .setLabel('Dispatch notes')
                    .setPlaceholder('Enter information responding units should know.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(2)
                    .setMaxLength(1_000),
            ),
        );
}

function dispatchButtonMatch(customId: string): RegExpMatchArray | null {
    return customId.match(/^(?:dispatch911|dispatchpro):(attach|notes|end):([a-f0-9]{16})$/);
}

export async function handleStableEmergencyDispatchButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = dispatchButtonMatch(interaction.customId);
    if (!match) return false;

    if (!await hasDispatchRole(interaction)) {
        await interaction.reply({
            content: `You need <@&${DISPATCH_ROLE_ID}> to manage 911 calls.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    if (!isDatabaseAvailable()) {
        // Let the in-memory legacy/integrated handler try if MongoDB is down.
        return false;
    }

    const record = await loadRecord(match[2]);
    if (!record) {
        await interaction.reply({
            content: 'I could not find the saved record for this 911 call. Make a new call after the latest restart and try again.',
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (record.status !== 'Active') {
        await interaction.reply({ content: 'That 911 call has already ended.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (match[1] === 'attach') {
        const selector = new UserSelectMenuBuilder()
            .setCustomId(`dispatchstable:attach:${record.dispatchId}`)
            .setPlaceholder('Select responding unit(s)')
            .setMinValues(1)
            .setMaxValues(10);
        await interaction.reply({
            content: `🚓 Select the Discord unit(s) responding to call #${record.callNumber}.`,
            components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(selector)],
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    if (match[1] === 'notes') {
        await interaction.showModal(notesModal(record.dispatchId));
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const endedAt = new Date();
    const updated = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: record.dispatchId, status: 'Active' },
        {
            $set: {
                status: 'Ended',
                endedAt,
                endedById: interaction.user.id,
                updatedAt: endedAt,
            },
        },
        { new: true },
    ).lean().exec().catch(() => null);

    if (!updated) {
        await interaction.editReply('That 911 call was already ended or could not be updated.');
        return true;
    }
    const finalRecord = updated as unknown as EmergencyDispatchCallRecord;
    await refreshOriginalPanel(interaction, finalRecord).catch(error => {
        logger.warn(`[911 Controls] Could not refresh ended call #${finalRecord.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    await interaction.editReply(`✅ Call #${finalRecord.callNumber} ended. Assigned units are now 10-8.`);
    return true;
}

export async function handleStableEmergencyDispatchUserSelect(
    interaction: UserSelectMenuInteraction,
): Promise<boolean> {
    const match = interaction.customId.match(/^dispatchstable:attach:([a-f0-9]{16})$/);
    if (!match) return false;

    if (!await hasDispatchRole(interaction)) {
        await interaction.update({
            content: `You need <@&${DISPATCH_ROLE_ID}> to attach units.`,
            components: [],
        });
        return true;
    }

    if (!isDatabaseAvailable()) {
        await interaction.update({ content: 'The 911 database is temporarily unavailable. Try again shortly.', components: [] });
        return true;
    }

    const selectedIds = [...interaction.users.values()]
        .filter(user => !user.bot)
        .map(user => user.id);
    if (!selectedIds.length) {
        await interaction.update({ content: 'Select at least one non-bot unit.', components: [] });
        return true;
    }

    const updated = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: match[1], status: 'Active' },
        {
            $addToSet: { assignedDiscordIds: { $each: selectedIds } },
            $set: { updatedAt: new Date() },
        },
        { new: true },
    ).lean().exec().catch(error => {
        logger.warn(`[911 Controls] Could not attach units: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    });

    if (!updated) {
        await interaction.update({ content: 'That 911 call is no longer active or could not be updated.', components: [] });
        return true;
    }

    const record = updated as unknown as EmergencyDispatchCallRecord;
    await refreshOriginalPanel(interaction, record).catch(error => {
        logger.warn(`[911 Controls] Could not refresh call #${record.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    await interaction.update({
        content: `✅ ${selectedIds.length} unit${selectedIds.length === 1 ? '' : 's'} attached to call #${record.callNumber}.`,
        components: [],
    });
    return true;
}

export async function handleStableEmergencyDispatchModal(
    interaction: ModalSubmitInteraction,
): Promise<boolean> {
    const match = interaction.customId.match(/^dispatchstable:notes:([a-f0-9]{16})$/);
    if (!match) return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!await hasDispatchRole(interaction)) {
        await interaction.editReply(`You need <@&${DISPATCH_ROLE_ID}> to write dispatch notes.`);
        return true;
    }
    if (!isDatabaseAvailable()) {
        await interaction.editReply('The 911 database is temporarily unavailable. Try again shortly.');
        return true;
    }

    const note = {
        authorId: interaction.user.id,
        text: interaction.fields.getTextInputValue('notes').trim(),
        createdAt: new Date(),
    };
    const updated = await EmergencyDispatchCall.findOneAndUpdate(
        { dispatchId: match[1], status: 'Active' },
        {
            $push: { notes: note },
            $set: { updatedAt: new Date() },
        },
        { new: true },
    ).lean().exec().catch(error => {
        logger.warn(`[911 Controls] Could not add notes: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    });

    if (!updated) {
        await interaction.editReply('That 911 call is no longer active or could not be updated.');
        return true;
    }

    const record = updated as unknown as EmergencyDispatchCallRecord;
    await refreshOriginalPanel(interaction, record).catch(error => {
        logger.warn(`[911 Controls] Could not refresh call #${record.callNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    await interaction.editReply(`✅ Dispatch notes added to call #${record.callNumber}.`);
    return true;
}
