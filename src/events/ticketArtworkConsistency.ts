import {
    ButtonStyle,
    ChannelType,
    Events,
    MessageFlags,
    type Client,
    type GuildMember,
    type Message,
    type TextChannel,
} from 'discord.js';
import { logger } from '../utils/logger';

const TICKET_TOPIC_PREFIX = 'larp-ticket:';
const registeredClients = new WeakSet<Client>();
const formattedMessages = new Set<string>();

const SUPPORT_ROLE_ID = '1523122697746382868';
const INTERNAL_ROLE_ID = '1521593407816990811';
const MANAGEMENT_ROLE_ID = '1521593407741362259';
const HIGH_RANK_ROLE_ID = '1521593407804280970';

type TicketType = 'general' | 'internal' | 'management' | 'highrank';
type TicketMetadata = {
    ownerId: string;
    type: TicketType;
    createdAt: string;
    claimedBy?: string;
    panelMessageId?: string;
};

type RawComponent = {
    type?: number;
    content?: unknown;
    custom_id?: unknown;
    label?: unknown;
    style?: unknown;
    disabled?: unknown;
    components?: RawComponent[];
};

function decodeMetadata(topic?: string | null): TicketMetadata | null {
    if (!topic?.startsWith(TICKET_TOPIC_PREFIX)) return null;
    try {
        const parsed = JSON.parse(
            Buffer.from(topic.slice(TICKET_TOPIC_PREFIX.length), 'base64url').toString('utf8'),
        ) as TicketMetadata;
        if (!parsed?.ownerId || !['general', 'internal', 'management', 'highrank'].includes(parsed.type)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function category(type: TicketType): { label: string; emoji: string; roleId: string } {
    if (type === 'internal') return { label: 'Internal Affairs Support', emoji: '📋', roleId: INTERNAL_ROLE_ID };
    if (type === 'management') return { label: 'Management Support', emoji: '🏛️', roleId: MANAGEMENT_ROLE_ID };
    if (type === 'highrank') return { label: 'Directorship / Ownership', emoji: '⭐', roleId: HIGH_RANK_ROLE_ID };
    return { label: 'General Support', emoji: '🎫', roleId: SUPPORT_ROLE_ID };
}

function isTicketPanel(message: Message): boolean {
    const visit = (node: RawComponent): boolean => {
        if (node.custom_id === 'ticket:claim') return true;
        return Boolean(node.components?.some(visit));
    };
    return message.components.some(component => visit(component.toJSON() as unknown as RawComponent));
}

function allText(message: Message): string {
    const chunks: string[] = [];
    const visit = (node: RawComponent): void => {
        if (typeof node.content === 'string') chunks.push(node.content);
        node.components?.forEach(visit);
    };
    message.components.forEach(component => visit(component.toJSON() as unknown as RawComponent));
    return chunks.join('\n');
}

function compact(value: string, max = 900): string {
    const clean = value.replace(/```/gu, "'''").trim() || 'Not provided.';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function inquiryFrom(text: string): string {
    const match = text.match(/\*\*Inquiry:\*\*\s*\n([\s\S]*?)(?=\n\*\*[^\n*]+:\*\*|$)/iu);
    if (match?.[1]?.trim()) return compact(match[1], 1_000);

    const reason = text.match(/###\s+(?:Reason for Opening|Reason for Opening Ticket|Reason for Report)\s*\n(?:>\s*)?([\s\S]*?)(?=\n###|$)/iu);
    return compact(reason?.[1]?.replace(/^>\s?/gmu, '') || 'Not provided.', 1_000);
}

function extraAnswers(text: string): Array<{ label: string; value: string }> {
    const reserved = new Set([
        'Ticket ID',
        'Date Opened',
        'Opened',
        'Member',
        'Claimed By',
        'Joined Server',
        'Inquiry',
        'Roblox Id',
        'Roblox Name',
    ]);
    const answers: Array<{ label: string; value: string }> = [];
    const pattern = /\*\*([^\n*]+):\*\*\s*([^\n]+)/gu;
    for (const match of text.matchAll(pattern)) {
        const label = match[1]?.trim();
        const value = match[2]?.trim();
        if (!label || !value || reserved.has(label)) continue;
        answers.push({ label, value: compact(value, 700) });
    }
    return answers;
}

function legacyText(metadata: TicketMetadata, member: GuildMember | null, sourceText: string): string {
    const info = category(metadata.type);
    const reasonLabel = metadata.type === 'internal' ? 'Reason for Report' : 'Reason for Opening Ticket';
    const answers = [
        { label: reasonLabel, value: inquiryFrom(sourceText) },
        ...extraAnswers(sourceText),
    ];
    const accountCreated = member?.user.createdTimestamp
        ? `<t:${Math.floor(member.user.createdTimestamp / 1_000)}:F>`
        : 'Unavailable';
    const joined = member?.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1_000)}:F>`
        : 'Unavailable';
    const username = member?.user.username || 'Unavailable';

    return [
        `<@&${info.roleId}> • <@${metadata.ownerId}>`,
        `## ${info.emoji} ${info.label} Ticket`,
        ...answers.flatMap(answer => [
            `### ${answer.label}`,
            '```',
            compact(answer.value),
            '```',
        ]),
        '### 💬 Discord Account Information',
        `> **Username:** \`${compact(username, 80)}\``,
        `> **User ID:** \`${metadata.ownerId}\``,
        `> **Account Created:** ${accountCreated}`,
        `> **Joined Server:** ${joined}`,
    ].join('\n').slice(0, 4_000);
}

function legacyComponents(message: Message, text: string): RawComponent[] | null {
    const components = message.components.map(component => component.toJSON()) as unknown as RawComponent[];
    let replacedText = false;
    let foundTicketButtons = false;

    const visit = (node: RawComponent): void => {
        if (!replacedText && typeof node.content === 'string' && node.content.includes('Assistance')) {
            node.content = text;
            replacedText = true;
        }

        if (Array.isArray(node.components)) {
            const ticketButtons = node.components.filter(child =>
                child.custom_id === 'ticket:claim'
                || child.custom_id === 'ticket:close'
                || child.custom_id === 'ticket:escalate',
            );
            if (ticketButtons.length) {
                const byId = new Map(ticketButtons.map(button => [String(button.custom_id), button]));
                const escalate = byId.get('ticket:escalate');
                const claim = byId.get('ticket:claim');
                const close = byId.get('ticket:close');
                if (escalate) {
                    escalate.label = 'Escalate';
                    escalate.style = ButtonStyle.Secondary;
                }
                if (claim) {
                    claim.label = metadataClaimLabel(claim.label);
                    claim.style = ButtonStyle.Success;
                }
                if (close) {
                    close.label = 'Close';
                    close.style = ButtonStyle.Danger;
                }
                node.components = [escalate, claim, close].filter((button): button is RawComponent => Boolean(button));
                foundTicketButtons = true;
            } else {
                node.components.forEach(visit);
            }
        }
    };

    components.forEach(visit);
    return replacedText && foundTicketButtons ? components : null;
}

function metadataClaimLabel(label: unknown): string {
    if (typeof label === 'string' && label.toLowerCase().startsWith('claimed by')) return label.slice(0, 80);
    return 'Claim';
}

async function restoreLegacyOpening(message: Message, channel: TextChannel): Promise<void> {
    if (formattedMessages.has(message.id)) return;
    const metadata = decodeMetadata(channel.topic);
    if (!metadata) return;

    const member = await channel.guild.members.fetch(metadata.ownerId).catch(() => null);
    const text = legacyText(metadata, member, allText(message));
    const components = legacyComponents(message, text);
    if (!components) return;

    try {
        await message.edit({
            components: components as never,
            flags: MessageFlags.IsComponentsV2,
        });
        formattedMessages.add(message.id);
        logger.info(`[TicketPresentation] Restored legacy opening layout in ${channel.id}.`);
    } catch (error) {
        logger.warn(`[TicketPresentation] Could not restore legacy opening layout in ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function findAndRestore(channel: TextChannel): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
        const panel = recent?.find(message => message.author.id === channel.client.user.id && isTicketPanel(message));
        if (panel) {
            await restoreLegacyOpening(panel, channel);
            return;
        }
        if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 150));
    }
}

export function registerTicketArtworkConsistency(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);

    client.on(Events.MessageCreate, message => {
        if (message.author.id !== client.user?.id || message.channel.type !== ChannelType.GuildText) return;
        if (!isTicketPanel(message)) return;
        void restoreLegacyOpening(message, message.channel);
    });

    client.on(Events.ChannelCreate, channel => {
        if (channel.type !== ChannelType.GuildText) return;
        void findAndRestore(channel);
    });

    client.on(Events.ChannelDelete, channel => {
        if (channel.type !== ChannelType.GuildText) return;
        for (const messageId of formattedMessages) {
            if (messageId.startsWith(channel.id)) formattedMessages.delete(messageId);
        }
    });

    logger.info('[TicketPresentation] Legacy ticket opening layout enabled with Escalate / Claim / Close only.');
}
