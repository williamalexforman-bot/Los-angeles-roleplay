import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Interaction,
    MessageFlags,
} from 'discord.js';

const TICKET_BLACKLIST_ROLE_ID = '1541163450850484234';
const LEARN_MORE_CUSTOM_ID = 'ticket:blacklist:learn-more';

async function isBlacklisted(interaction: Interaction): Promise<boolean> {
    if (!interaction.guild || !interaction.member) return false;

    const cachedRoles = 'roles' in interaction.member
        ? interaction.member.roles
        : undefined;

    if (Array.isArray(cachedRoles) && cachedRoles.includes(TICKET_BLACKLIST_ROLE_ID)) return true;
    if (cachedRoles && !Array.isArray(cachedRoles) && 'cache' in cachedRoles
        && cachedRoles.cache.has(TICKET_BLACKLIST_ROLE_ID)) return true;

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member?.roles.cache.has(TICKET_BLACKLIST_ROLE_ID));
}

function learnMoreRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(LEARN_MORE_CUSTOM_ID)
            .setLabel('Learn More')
            .setEmoji('ℹ️')
            .setStyle(ButtonStyle.Secondary),
    );
}

async function sendBlacklistNotice(interaction: Interaction): Promise<void> {
    if (!interaction.isRepliable()) return;

    const payload = {
        content: '🚫 **You have been blacklisted from opening tickets.**\n\nIf you do not know why, press **Learn More** below.',
        components: [learnMoreRow()],
        flags: MessageFlags.Ephemeral,
    } as const;

    if (interaction.deferred) {
        await interaction.editReply({ content: payload.content, components: payload.components });
    } else if (interaction.replied) {
        await interaction.followUp(payload);
    } else {
        await interaction.reply(payload);
    }
}

async function sendLearnMore(interaction: Interaction): Promise<void> {
    if (!interaction.isRepliable()) return;

    const content = [
        '**Here are a few reasons someone can be blacklisted from opening tickets.**',
        '',
        '* User was opening more then 5 tickets in one hour.',
        '* User was opening tickets daily about stuff that they were told to not open a ticket about.',
        '* User opened a ticket and trolled.',
        '* User didn’t follow the ticket guidelines.',
    ].join('\n');

    if (interaction.deferred) await interaction.editReply({ content });
    else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export async function handleTicketBlacklist(interaction: Interaction): Promise<boolean> {
    if (interaction.isButton() && interaction.customId === LEARN_MORE_CUSTOM_ID) {
        await sendLearnMore(interaction);
        return true;
    }

    const isTicketOpenAttempt =
        (interaction.isStringSelectMenu() && interaction.customId === 'ticket:create-select')
        || (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:create-modal:'));

    if (!isTicketOpenAttempt) return false;
    if (!(await isBlacklisted(interaction))) return false;

    await sendBlacklistNotice(interaction);
    return true;
}
