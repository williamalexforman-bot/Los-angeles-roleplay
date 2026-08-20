import { resolve } from 'path';
import mongoose from 'mongoose';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextChannel,
    TextDisplayBuilder,
    type Client,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const UNDERBANNER_NAME = 'underbanner.webp';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const REFRESH_INTERVAL_MS = 30_000;

type ActivityCheckRecord = {
    checkId: string;
    guildId: string;
    channelId: string;
    messageId: string;
    roleId: string;
    createdById: string;
    requiredMemberIds: string[];
    activeMemberIds: string[];
    startedAt: Date | string;
    endsAt?: Date | string;
    status: 'active' | 'ended' | 'voided';
};

type ActivityModule = {
    handleActivityCheckButton?: unknown;
};

let installed = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshClient: Client | null = null;
let combinedInfractionMentionGuardInstalled = false;

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function artwork(): AttachmentBuilder[] {
    return [new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME })];
}

function unix(value: Date | string): number {
    return Math.floor(new Date(value).getTime() / 1_000);
}

function livePanel(check: ActivityCheckRecord): ContainerBuilder {
    const required = check.requiredMemberIds?.length || 0;
    const responded = check.activeMemberIds?.length || 0;
    const pending = Math.max(0, required - responded);

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `<@&${check.roleId}>`,
            '## 📋 Staff Activity Check',
            `> **Staff Role:** <@&${check.roleId}>`,
            `> **Started By:** <@${check.createdById}>`,
            `> **Started:** <t:${unix(check.startedAt)}:F>`,
            `> **Scheduled End:** ${check.endsAt ? `<t:${unix(check.endsAt)}:F>` : 'Manual end only'}`,
            '',
            '### 📊 Live Response Count',
            `> **Required Staff:** **${required}**`,
            `> **Responded:** **${responded}**`,
            `> **Pending:** **${pending}**`,
            '',
            '### ⚠️ Required Action',
            'Press **I’m Active** before this check ends. Missing staff are grouped into one Activity Check infraction case; exempt staff are filtered before that case is created.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`activity-check:active:${check.checkId}`)
                .setLabel(`I'm Active • ${responded}/${required}`.slice(0, 80))
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
        ))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

async function refreshCheckMessage(client: Client, check: ActivityCheckRecord): Promise<boolean> {
    if (check.status !== 'active' || !check.channelId || !check.messageId) return false;
    const channel = await client.channels.fetch(check.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    const message = await channel.messages.fetch(check.messageId).catch(() => null);
    if (!message) return false;

    try {
        await message.edit({
            components: [livePanel(check)],
            attachments: [],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        return true;
    } catch (error) {
        logger.warn(`[ActivityCheckLive] Could not refresh ${check.checkId}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function refreshAllActive(client: Client): Promise<void> {
    if (mongoose.connection.readyState !== 1) return;
    const records = await mongoose.connection.collection('activity_checks')
        .find({ status: 'active' })
        .toArray()
        .catch(() => []);

    for (const raw of records) {
        const check = raw as unknown as ActivityCheckRecord;
        await refreshCheckMessage(client, check);
    }
}

function ensureRefreshLoop(client: Client): void {
    refreshClient = client;
    if (refreshTimer) return;

    void refreshAllActive(client).catch(() => undefined);
    refreshTimer = setInterval(() => {
        if (!refreshClient) return;
        void refreshAllActive(refreshClient).catch(() => undefined);
    }, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();

    logger.info('[ActivityCheckLive] Recovery refresh enabled every 30 seconds; no duplicate button observer is installed.');
}

function installCombinedInfractionMentionGuard(): void {
    if (combinedInfractionMentionGuardInstalled) return;
    combinedInfractionMentionGuardInstalled = true;

    const prototype = TextChannel.prototype as unknown as {
        send: (options: unknown) => Promise<unknown>;
    };
    const originalSend = prototype.send;

    prototype.send = async function guardedActivityInfractionSend(this: TextChannel, options: unknown): Promise<unknown> {
        const payload = options as {
            components?: unknown[];
            allowedMentions?: unknown;
        };

        try {
            const serialized = JSON.stringify(payload?.components || []);
            const isCombinedActivityInfraction = serialized.includes('Staff Strike • Failed Activity Check')
                && serialized.includes('one combined Activity Check infraction case');

            if (isCombinedActivityInfraction) {
                const issuedById = serialized.match(/\*\*Issued By:\*\*\s*<@(\d{17,20})>/u)?.[1];
                const mentionedUsers = Array.from(serialized.matchAll(/<@(\d{17,20})>/gu), match => match[1]);
                const affectedUsers = Array.from(new Set(
                    mentionedUsers.filter(userId => userId !== issuedById),
                ));

                payload.allowedMentions = {
                    parse: [],
                    users: affectedUsers,
                    roles: [],
                    repliedUser: false,
                };

                logger.info(
                    `[ActivityCheck] Combined infraction mention guard: pinging ${affectedUsers.length} affected user(s) only; Staff Team and issuer pings blocked.`,
                );
            }
        } catch (error) {
            logger.warn(`[ActivityCheck] Combined infraction mention guard inspection failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        return originalSend.call(this, payload);
    };

    logger.info('[ActivityCheck] Combined infraction mention guard active: affected users only, no Staff Team role ping.');
}

export function installActivityCheckLiveRepair(_activityModule: ActivityModule, client: Client): void {
    if (installed) return;
    installed = true;

    installCombinedInfractionMentionGuard();
    ensureRefreshLoop(client);

    // The main Activity Check button handler already saves the response and
    // edits the panel immediately. Do not attach a second InteractionCreate
    // observer; competing edits caused the button/panel glitch.
    logger.info('[ActivityCheckLive] Primary Activity Check button handler only; duplicate observer removed.');
}
