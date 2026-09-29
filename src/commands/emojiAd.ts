import fs from 'node:fs';
import path from 'node:path';
import {
    ContainerBuilder,
    Message,
    MessageFlags,
    PermissionFlagsBits,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { getGuildBotConfig, getPanelConfig, parseEmojiMap, savePanelConfig, type ConfigurablePanel } from '../services/panelConfig';
import { postAllPanels } from './panels';

const slots = [
    'assistance', 'ticket', 'claim', 'close', 'escalate', 'general', 'management', 'highrank',
    'dashboard', 'rules', 'discord', 'game', 'application', 'apply', 'session', 'staff', 'players',
    'queue', 'online', 'offline', 'vote', 'boost', 'welcome', 'infraction', 'promotion',
] as const;
type Slot = typeof slots[number];
type EmojiAssignments = Partial<Record<Slot, Array<[ConfigurablePanel, string[]]>>>;

const targets: EmojiAssignments = {
    assistance: [['ticket_panel', ['title']]], ticket: [['ticket', ['title']]],
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

async function assignEmoji(guild: NonNullable<Message['guild']>, slot: Slot, emojiText: string): Promise<void> {
    for (const [panel, keys] of targets[slot] || []) {
        const config = await getPanelConfig(guild, panel);
        const emojis = parseEmojiMap(config.emojiText);
        for (const key of keys) emojis[key] = emojiText;
        config.emojiText = Object.entries(emojis).map(([key, value]) => `${key}=${value}`).join('\n');
        await savePanelConfig(guild, panel, config);
    }
}

function panel(installed: string[], failed: string[], panelStatus: string) {
    const body = [
        `# California State Roleplay Emoji Pack`,
        `Installed or reused **${installed.length} of ${slots.length}** custom emojis. Available icons have been connected to their panel settings.`,
        installed.length ? `\n${installed.join(' ')}` : '',
        failed.length ? `\n**Not added:** ${failed.map(name => `\`${name}\``).join(', ')}\nCheck the server’s emoji capacity and my **Manage Expressions** permission, then run \`-emojiad\` again.` : '',
        `\n${panelStatus}`,
    ].filter(Boolean).join('\n');
    return new ContainerBuilder().setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

/** Installs/reuses the bundled transparent CSRP emoji pack and maps it to panel settings. */
export async function handleEmojiAd(message: Message): Promise<void> {
    if (!message.guild || !message.member || !message.channel.isSendable()) return;
    const guild = message.guild;
    const config = await getGuildBotConfig(guild);
    const botPermRole = config.roles.bot_permissions || process.env.BOT_PERMISSIONS_ROLE_ID;
    const authorized = guild.ownerId === message.author.id
        || message.member.permissions.has(PermissionFlagsBits.Administrator)
        || message.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)
        || Boolean(botPermRole && message.member.roles.cache.has(botPermRole));
    if (!authorized) {
        await message.reply('You need the configured bot-management role or Manage Expressions permission to install the server emoji pack.');
        return;
    }

    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
        await message.reply('I need the **Manage Expressions** permission before I can add server emojis.');
        return;
    }

    const status = await message.channel.send('Installing the California State Roleplay emoji pack…');
    const installed: string[] = [];
    const failed: string[] = [];
    const existingEmojis = await guild.emojis.fetch().catch(() => guild.emojis.cache);

    for (const slot of slots) {
        const name = `csrp_${slot}`;
        try {
            const assetPath = path.resolve(process.cwd(), 'assets', 'emojis', `${slot}.png`);
            if (!fs.existsSync(assetPath)) throw new Error('emoji artwork is missing from the deployment');
            const image = fs.readFileSync(assetPath);
            const oldEmoji = existingEmojis.find(candidate => candidate.name === name);
            // Discord does not allow changing an emoji's image in place. Replace only our
            // reserved csrp_* pack entries so rerunning this command applies artwork updates.
            if (oldEmoji) await oldEmoji.delete(`Replace with the current CSRP artwork, requested by ${message.author.tag}`);
            const emoji = await guild.emojis.create({
                attachment: image,
                name,
                reason: `California State Roleplay emoji pack installed by ${message.author.tag}`,
            });
            await assignEmoji(guild, slot, emoji.toString());
            installed.push(emoji.toString());
        } catch (error) {
            failed.push(name);
            console.warn(`[Emoji Pack] Could not install ${name}:`, error instanceof Error ? error.message : 'Unknown error');
        }
    }

    let panelStatus = 'No panel messages were refreshed.';
    if (installed.length) {
        try {
            const refreshed = await postAllPanels(guild);
            const summary = [
                refreshed.updated.length ? `updated ${refreshed.updated.join(', ')}` : '',
                refreshed.posted.length ? `posted ${refreshed.posted.join(', ')}` : '',
                refreshed.unavailable.length ? `set a destination for ${refreshed.unavailable.join(', ')} in /config` : '',
            ].filter(Boolean).join('; ');
            panelStatus = summary ? `Panels: ${summary}.` : 'The configured panels are up to date.';
        } catch (error) {
            console.warn('[Emoji Pack] Could not refresh panels:', error instanceof Error ? error.message : 'Unknown error');
            panelStatus = 'Emoji artwork is installed. Open **/config** and choose **Post All Panels** to refresh the panels.';
        }
    }

    await status.edit({
        content: '',
        components: [panel(installed, failed, panelStatus)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}
