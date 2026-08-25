import { resolve } from 'node:path';
import {
    AttachmentBuilder,
    Client,
    ContainerBuilder,
    Events,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    type GuildMember,
} from 'discord.js';
import { BRAND, CHANNEL_IDS } from '../config/constants';
import { logger } from '../utils/logger';

const TOP_BANNER_NAME = 'los-angeles-banner.png';
const TOP_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', TOP_BANNER_NAME);
const UNDERBANNER_NAME = 'underbanner.png';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const registeredClients = new WeakSet<Client>();

export interface MemberJoinDetails {
    userId: string;
    username: string;
    accountCreatedTimestamp: number;
    joinedTimestamp: number;
    memberCount: number;
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function timestamp(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Unavailable';
    const unix = Math.floor(milliseconds / 1_000);
    return `<t:${unix}:F> • <t:${unix}:R>`;
}

export function buildMemberJoinPanel(details: MemberJoinDetails): ContainerBuilder {
    const content = [
        '## 👋 Member Joined',
        `> **Member:** <@${details.userId}>`,
        `> **Username:** \`${details.username.replace(/`/gu, 'ˋ').slice(0, 100)}\``,
        `> **User ID:** \`${details.userId}\``,
        `> **Discord Account Created:** ${timestamp(details.accountCreatedTimestamp)}`,
        `> **Joined This Server:** ${timestamp(details.joinedTimestamp)}`,
        `> **Server Member Count:** \`${details.memberCount.toLocaleString()}\``,
    ].join('\n');

    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(TOP_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

export function buildMemberJoinPayload(details: MemberJoinDetails) {
    return {
        components: [buildMemberJoinPanel(details)],
        files: [
            new AttachmentBuilder(TOP_BANNER_PATH, { name: TOP_BANNER_NAME }),
            new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
        ],
        flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] as [] },
    };
}

export async function sendMemberJoinLog(member: GuildMember): Promise<boolean> {
    const channel = await member.client.channels.fetch(CHANNEL_IDS.memberJoinLog).catch(() => null);
    if (!channel?.isSendable()) {
        logger.warn(`[Member Join] Log channel ${CHANNEL_IDS.memberJoinLog} is unavailable.`);
        return false;
    }

    const accountCreatedTimestamp = member.user.createdTimestamp;
    if (!Number.isFinite(accountCreatedTimestamp) || accountCreatedTimestamp <= 0) {
        logger.warn(`[Member Join] Discord did not provide a valid account creation timestamp for ${member.id}.`);
    }

    await channel.send(buildMemberJoinPayload({
        userId: member.id,
        username: member.user.tag || member.user.username,
        accountCreatedTimestamp,
        // Never invent a date. If Discord omits joinedTimestamp, the panel
        // explicitly displays "Unavailable" instead of estimating it.
        joinedTimestamp: member.joinedTimestamp || 0,
        memberCount: member.guild.memberCount,
    }));
    return true;
}

export function registerMemberLifecycleLogs(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);
    client.on(Events.GuildMemberAdd, member => {
        void sendMemberJoinLog(member).catch(error => {
            logger.warn(`[Member Join] V2 log failed for ${member.id}: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
    logger.info(`[Member Join] Native Components V2 logs enabled for channel ${CHANNEL_IDS.memberJoinLog}.`);
}
