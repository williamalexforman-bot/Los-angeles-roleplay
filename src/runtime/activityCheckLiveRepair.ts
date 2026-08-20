import { resolve } from 'path';
import mongoose from 'mongoose';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    Events,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type Client,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const ACTIVITY_BANNER_NAME = 'activity-check-banner.jpg';
const UNDERBANNER_NAME = 'underbanner.webp';
const ACTIVITY_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ACTIVITY_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const REFRESH_INTERVAL_MS = 30_000;
const POST_BUTTON_REFRESH_DELAY_MS = 750;

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

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ACTIVITY_BANNER_PATH, { name: ACTIVITY_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
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
        .addMediaGalleryComponents(media(ACTIVITY_BANNER_NAME))
        .addSeparatorComponents(separator())
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

async function getCheck(checkId: string): Promise<ActivityCheckRecord | null> {
    if (mongoose.connection.readyState !== 1) return null;
    const raw = await mongoose.connection.collection('activity_checks').findOne({ checkId }).catch(() => null);
    if (!raw) return null;
    return raw as unknown as ActivityCheckRecord;
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
            // The role is displayed in the refreshed panel but never pinged again.
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

    logger.info('[ActivityCheckLive] Live counter recovery enabled; active check emblems refresh every 30 seconds without repeated role pings.');
}

function installPostButtonRefreshObserver(client: Client): void {
    client.on(Events.InteractionCreate, interaction => {
        if (!interaction.isButton()) return;
        const match = interaction.customId.match(/^activity-check:active:(AC-[A-Z0-9-]+)$/u);
        if (!match) return;

        const checkId = match[1];
        const timer = setTimeout(() => {
            void (async () => {
                const check = await getCheck(checkId);
                if (check?.status !== 'active') return;

                await refreshCheckMessage(client, check);
                const required = check.requiredMemberIds?.length || 0;
                const responded = check.activeMemberIds?.length || 0;
                logger.info(`[ActivityCheckLive] ${check.checkId} refreshed after response: ${responded}/${required} responded.`);
            })().catch(error => {
                logger.warn(`[ActivityCheckLive] Post-response refresh failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }, POST_BUTTON_REFRESH_DELAY_MS);
        timer.unref?.();
    });
}

export function installActivityCheckLiveRepair(_activityModule: ActivityModule, client: Client): void {
    ensureRefreshLoop(client);
    if (installed) return;
    installed = true;

    // Keep the activity-check module namespace untouched. The primary command
    // implementation now performs exemption filtering directly before creating
    // its single combined infraction case, so no broad TextChannel.send monkey-
    // patch is needed here.
    installPostButtonRefreshObserver(client);

    logger.info('[ActivityCheckLive] Activity-check post-response live refresh observer installed.');
}
