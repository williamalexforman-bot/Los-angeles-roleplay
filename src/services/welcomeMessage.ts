import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Guild,
    User,
    type SendableChannels,
} from 'discord.js';

const WELCOME_EMOJI = '<:welcome:1525234122568765710>';

function ordinal(value: number): string {
    const absolute = Math.abs(value);
    const lastTwo = absolute % 100;
    const suffix = lastTwo >= 11 && lastTwo <= 13
        ? 'th'
        : absolute % 10 === 1 ? 'st'
            : absolute % 10 === 2 ? 'nd'
                : absolute % 10 === 3 ? 'rd' : 'th';
    return `${value.toLocaleString('en-US')}${suffix}`;
}

export async function sendConfiguredWelcome(
    guild: Guild,
    user: User,
    destination: SendableChannels,
): Promise<void> {
    const memberCount = guild.memberCount;
    const countButton = new ButtonBuilder()
        .setCustomId('welcome:member-count')
        .setLabel(memberCount.toLocaleString('en-US'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
    await destination.send({
        content: `${WELCOME_EMOJI} Welcome <@${user.id}> to **California State Roleplay**! You are our **${ordinal(memberCount)} member**.`,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(countButton)],
        allowedMentions: { users: [user.id], parse: [] },
    });
}
