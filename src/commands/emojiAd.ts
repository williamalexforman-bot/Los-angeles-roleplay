import {
    ContainerBuilder,
    Message,
    MessageFlags,
    PermissionFlagsBits,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { getGuildBotConfig, getPanelConfig, parseEmojiMap, savePanelConfig, type ConfigurablePanel } from '../services/panelConfig';

const slots = [
    ['assistance', 'Assistance panel title'], ['ticket', 'Ticket opening title'],
    ['claim', 'Ticket Claim button'], ['close', 'Ticket Close button'], ['escalate', 'Ticket Escalate button'],
    ['general', 'General support'], ['management', 'Management support'], ['highrank', 'High-rank support'],
    ['dashboard', 'Dashboard title'], ['rules', 'Regulations and dashboard rules'], ['discord', 'Discord rules menu option'],
    ['game', 'In-game rules menu option'], ['application', 'Application panel title'],
    ['apply', 'Application button'], ['session', 'Session panel title'], ['staff', 'Session staff count'],
    ['players', 'Session player count'], ['queue', 'Session queue'], ['online', 'Session online status'],
    ['offline', 'Session offline status'], ['vote', 'Session vote status'], ['boost', 'Session boost status'],
    ['welcome', 'Welcome message title'], ['infraction', 'Infraction title'], ['promotion', 'Promotion title'],
] as const;

type Slot = typeof slots[number][0];

const targets: Partial<Record<Slot, Array<[ConfigurablePanel, string[]]>>> = {
    assistance: [['ticket_panel', ['title']]], ticket: [['ticket', ['title', 'claim', 'close', 'escalate']]],
    claim: [['ticket', ['claim']]], close: [['ticket', ['close']]], escalate: [['ticket', ['escalate']]],
    general: [['ticket_panel', ['general']]], management: [['ticket_panel', ['management']]], highrank: [['ticket_panel', ['highrank']]],
    dashboard: [['dashboard', ['title']]], rules: [['regulations', ['title']], ['dashboard', ['rules']]],
    discord: [['regulations', ['discord']]], game: [['regulations', ['game']]],
    application: [['application', ['title']]], apply: [['application', ['apply']]],
    session: [['session', ['title']]], staff: [['session', ['staff']]], players: [['session', ['players']]],
    queue: [['session', ['queue']]], online: [['session', ['online']]], offline: [['session', ['offline']]],
    vote: [['session', ['vote']]], boost: [['session', ['boost']]], welcome: [['welcome', ['title']]],
    infraction: [['infraction', ['title']]], promotion: [['promotion', ['title']]],
};

function validSlot(value: string): value is Slot {
    return slots.some(([slot]) => slot === value);
}

function hasPngTransparency(bytes: Buffer): boolean {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false;
    let offset = 8;
    let alphaColorType = false;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        if (type === 'IHDR' && length >= 10) {
            const colorType = bytes[offset + 17];
            alphaColorType = colorType === 4 || colorType === 6;
        }
        if (type === 'tRNS') return true;
        if (type === 'IEND') break;
        offset += 12 + length;
    }
    return alphaColorType;
}

async function applyEmojiSlot(guild: NonNullable<Message['guild']>, slot: Slot, mention: string): Promise<void> {
    for (const [panel, keys] of targets[slot] || []) {
        const config = await getPanelConfig(guild, panel);
        const emojis = parseEmojiMap(config.emojiText);
        keys.forEach(key => { emojis[key] = mention; });
        config.emojiText = Object.entries(emojis).map(([key, value]) => `${key}=${value}`).join('\n');
        await savePanelConfig(guild, panel, config);
    }
}

/** Prefix flow: -emojiad <slot>, with a transparent PNG attached to the command message. */
export async function handleEmojiAd(message: Message, slotName: string | undefined): Promise<void> {
    if (!message.guild || !message.member) return;
    if (!validSlot(slotName || '')) {
        await message.reply(`Use \`-emojiad <slot>\` with a transparent PNG attached. Slots: ${slots.map(([slot]) => `\`${slot}\``).join(', ')}.`);
        return;
    }
    if (!message.channel.isSendable()) return;
    const slot = slotName as Slot;
    const config = await getGuildBotConfig(message.guild);
    const botPermRole = config.roles.bot_permissions || process.env.BOT_PERMISSIONS_ROLE_ID;
    const authorized = message.guild.ownerId === message.author.id
        || message.member.permissions.has(PermissionFlagsBits.Administrator)
        || message.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)
        || Boolean(botPermRole && message.member.roles.cache.has(botPermRole));
    if (!authorized) {
        await message.reply('You need the configured bot-management role or Manage Expressions permission to add server emojis.');
        return;
    }
    const botMember = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
        await message.reply('I need the **Manage Expressions** permission before I can add server emojis.');
        return;
    }
    const image = message.attachments.first();
    if (!image || image.contentType !== 'image/png' || image.size > 256 * 1024) {
        await message.reply('Attach a transparent PNG that is no larger than 256 KB, then run `-emojiad <slot>`.');
        return;
    }

    const name = `csrp_${slot}`;
    try {
        const existing = message.guild.emojis.cache.find(emoji => emoji.name === name);
        let emoji = existing;
        if (!emoji) {
            const response = await fetch(image.url);
            if (!response.ok) throw new Error('Could not download that image.');
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!hasPngTransparency(bytes)) {
                await message.reply('That PNG does not include transparency. Export it with a transparent background, then try again.');
                return;
            }
            emoji = await message.guild.emojis.create({ attachment: bytes, name, reason: `CSRP panel emoji added by ${message.author.tag}` });
        }
        await applyEmojiSlot(message.guild, slot, emoji.toString());
        const announcement = new ContainerBuilder().setAccentColor(BRAND.color)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `# ${emoji} New California State Roleplay Emoji`,
                `**${emoji.name}** is ready to use in the server.`,
                `It has been assigned to the **${slots.find(([candidate]) => candidate === slot)?.[1]}** slot.`,
            ].join('\n')));
        await message.channel.send({ components: [announcement], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        if (existing) await message.reply(`${emoji} already existed, so I reused it and connected it to that panel slot.`);
    } catch (error) {
        await message.reply(`I couldn't add that emoji. Check the PNG and my Manage Expressions permission${error instanceof Error ? ` (${error.message})` : ''}.`);
    }
}
