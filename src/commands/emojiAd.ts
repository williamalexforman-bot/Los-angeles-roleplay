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

async function assignEmojis(guild: NonNullable<Message['guild']>, installed: Array<{ slot: Slot; emojiText: string }>): Promise<string[]> {
    const changes = new Map<ConfigurablePanel, Record<string, string>>();
    for (const { slot, emojiText } of installed) {
        for (const [panelName, keys] of targets[slot] || []) {
            const panelChanges = changes.get(panelName) || {};
            for (const key of keys) panelChanges[key] = emojiText;
            changes.set(panelName, panelChanges);
        }
    }

    const failed: string[] = [];
    for (const [panelName, panelChanges] of changes) {
        try {
            const config = await getPanelConfig(guild, panelName);
            const emojis = parseEmojiMap(config.emojiText);
            Object.assign(emojis, panelChanges);
            config.emojiText = Object.entries(emojis).map(([key, value]) => `${key}=${value}`).join('\n');
            await savePanelConfig(guild, panelName, config);
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error';
            failed.push(`${panelName}: ${reason.slice(0, 100)}`);
        }
    }
    return failed;
}

function panel(installed: string[], failed: string[], mappingFailures: string[], panelStatus: string) {
    const body = [
        `# California State Roleplay Emoji Pack`,
        `Installed **${installed.length} of ${slots.length}** custom emojis.`,
        installed.length ? `\n${installed.join(' ')}` : '',
        failed.length ? `\n**Could not add:** ${failed.join('\n')}` : '',
        mappingFailures.length ? `\n**Panel settings not saved:** ${mappingFailures.join(', ')}` : '',
        `\n${panelStatus}`,
    ].filter(Boolean).join('\n');
    return new ContainerBuilder().setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export function emojiPackProgressPanel(content: string) {
    return new ContainerBuilder().setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# California State Roleplay Emoji Pack\n${content}`));
}

/** Install the bundled transparent CSRP emoji pack, replacing old artwork and updating panels. */
export async function installEmojiPack(
    guild: NonNullable<Message['guild']>,
    actorTag: string,
    onProgress: (content: string) => Promise<void>,
): Promise<ContainerBuilder> {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
        return panel([], ['The bot needs **Manage Expressions** permission.'], [], 'No emojis were changed.');
    }

    await onProgress('Installing the emoji artwork…');
    const installed: Array<{ slot: Slot; emojiText: string }> = [];
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
            if (oldEmoji) await oldEmoji.delete(`Replace with the current CSRP artwork, requested by ${actorTag}`);
            const emoji = await guild.emojis.create({
                attachment: image,
                name,
                reason: `California State Roleplay emoji pack installed by ${actorTag}`,
            });
            installed.push({ slot, emojiText: emoji.toString() });
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'Unknown error';
            failed.push(`\`${name}\`: ${reason.slice(0, 120)}`);
            console.warn(`[Emoji Pack] Could not install ${name}:`, reason);
        }
        if ((slots.indexOf(slot) + 1) % 5 === 0) {
            await onProgress(`Installing emojis… ${slots.indexOf(slot) + 1}/${slots.length}`);
        }
    }

    const mappingFailures = await assignEmojis(guild, installed);

    let panelStatus = 'No panel messages were refreshed.';
    if (installed.length && mappingFailures.length === 0) {
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

    return panel(installed.map(item => item.emojiText), failed, mappingFailures, panelStatus);
}

/** Prefix flow; the same installer is also available from the /config button. */
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

    const status = await message.channel.send({ components: [emojiPackProgressPanel('Starting installation…')], flags: MessageFlags.IsComponentsV2 });
    const result = await installEmojiPack(guild, message.author.tag, async content => {
        await status.edit({ components: [emojiPackProgressPanel(content)] });
    });
    await status.edit({ components: [result], allowedMentions: { parse: [] } });
}
