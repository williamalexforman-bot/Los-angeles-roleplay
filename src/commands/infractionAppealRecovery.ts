import {
    ActionRowBuilder,
    ButtonInteraction,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import {
    getAllInfractions,
    getInfractionByThreadIdPublic,
    recoverInfractionByThreadId,
    recoverInfractionsFromParentChannel,
    type InfractionRecord,
} from './staffManagement';
import { logger } from '../utils/logger';

const INFRACTION_PARENT_CHANNEL_ID = '1526044664975851642';

type InfractionAppealModule = {
    handleInfractionAppealButton(interaction: ButtonInteraction): Promise<boolean>;
};

function appealFormModal(stableThreadId: string): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`infraction-appeal:form:${stableThreadId}`)
        .setTitle('Infraction Appeal Form')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('discord-username')
                    .setLabel('1. Discord Username')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('roblox-username')
                    .setLabel('2. Roblox Username')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('appeal-reason')
                    .setLabel('3. Appeal reason (2+ sentences)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1024),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('will-repeat')
                    .setLabel('4. Will you do this again? (YES or NO)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(10),
            ),
        );
}

async function resolveAppealRecord(
    interaction: ButtonInteraction,
    key: string,
): Promise<InfractionRecord | null> {
    // Fast path: current-process cache or durable infraction adapter.
    let record = await getInfractionByThreadIdPublic(key).catch(() => null);
    if (record) return record;

    // If the button already contains a Discord thread ID, rebuild the case
    // directly from that thread's Components V2 starter message.
    if (/^\d{17,20}$/u.test(key)) {
        record = await recoverInfractionByThreadId(
            interaction.client,
            key,
            interaction.guildId || undefined,
        ).catch(() => null);
        if (record) return record;
    }

    // Older/current case panels may contain INF-#### rather than the thread ID.
    // Rehydrate cases from Discord itself so an appeal still works after a bot
    // restart or during a temporary MongoDB outage.
    const parent = await interaction.client.channels.fetch(INFRACTION_PARENT_CHANNEL_ID).catch(() => null);
    const guildId = interaction.guildId
        || (parent && 'guildId' in parent && typeof parent.guildId === 'string' ? parent.guildId : undefined);

    if (guildId) {
        await recoverInfractionsFromParentChannel(
            interaction.client,
            INFRACTION_PARENT_CHANNEL_ID,
            guildId,
        ).catch(error => {
            logger.warn(`[InfractionAppeal] Discord recovery scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });

        record = getAllInfractions().find(candidate =>
            candidate.caseNumber.toUpperCase() === key.toUpperCase()
            || candidate.threadId === key
            || candidate.detailMessageId === key,
        ) || null;
    }

    return record;
}

/**
 * Installs a compatibility wrapper before the main interaction router imports
 * the appeal module. Only the appeal-start button is intercepted. Once the
 * original case is recovered, the modal is rewritten to use the stable Discord
 * thread ID; all normal form submission/review logic remains in infractionAppeal.ts.
 */
export function installInfractionAppealRecovery(appealModule: InfractionAppealModule): void {
    const original = appealModule.handleInfractionAppealButton.bind(appealModule);

    appealModule.handleInfractionAppealButton = async (interaction: ButtonInteraction): Promise<boolean> => {
        const match = interaction.customId.match(/^infraction-appeal:start:(.+)$/u);
        if (!match) return original(interaction);

        const key = match[1];
        const record = await resolveAppealRecord(interaction, key);
        if (!record) return original(interaction);

        if (!record.appealable) {
            await interaction.reply({
                content: 'This infraction is not marked as appealable. Only appealable infractions can be appealed.',
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }

        if (record.memberId && record.memberId !== interaction.user.id) {
            await interaction.reply({
                content: 'Only the member who received this infraction can appeal it.',
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }

        const stableKey = /^\d{17,20}$/u.test(record.threadId) ? record.threadId : key;
        await interaction.showModal(appealFormModal(stableKey));
        return true;
    };

    logger.info('[InfractionAppeal] Restart-safe Discord recovery layer installed.');
}
