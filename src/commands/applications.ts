import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    Message,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    type Guild,
    type GuildMember,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const APPLICATIONS_BANNER_NAME = 'applications-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const APPLICATIONS_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', APPLICATIONS_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const APPLICATION_REVIEW_CHANNEL_ID = '1538352573248176229';
const APPLICATION_REVIEWER_ROLE_ID = '1538351617840254998';
const APPLICATION_SESSION_INACTIVITY_TTL_MS = 24 * 60 * 60 * 1_000;

const APPLICATION_QUESTIONS = {
    media: {
        label: 'Media Team Application',
        questions: [
            'What are your Discord username and Roblox username?',
            'How old are you?',
            'What device do you play on?',
            'What interests you about joining our Media and Content Creation Team?',
            'How many photos or videos can you create each week?',
            'How many hours could you spend helping with content creation or scenes?',
            'Do you have any other media or content-creation experience?',
            [
                'What position are you interested in?',
                '• News Reporter — Turn people’s stories, tragic incidents, or major emergencies into a news report.',
                '• Editing Team — Edit raw footage sent by other media members (videos, pictures, or both).',
                '• Content Creation Actor — Act out scenes and appear in our videos.',
            ].join('\n'),
        ],
    },
    discord: {
        label: 'Discord Moderator Application',
        questions: [
            'What is your Discord username and user ID?',
            'How old are you?',
            'What is your Roblox username?',
            'Why do you want to be a part of the Los Angeles Roleplay Discord Moderation Team?',
            'Are you aware of and familiar with the Discord Terms of Service?',
            'What would you do if someone sent NSFW images?',
            'What would you do if someone advertised their server in our server?',
            'Someone is fighting in the general channel. You told them to calm down, but they continue yelling. What would you do?',
            'Do you understand that you will be placed on ZTP and can be removed for breaking rules, acting unprofessionally, or failing to use proper spelling, punctuation, and grammar?',
        ],
    },
    ingame: {
        label: 'In-Game Staff Application',
        questions: [
            'What is your Discord username and user ID?',
            'How old are you?',
            'What is your Roblox username and user ID?',
            'Please give an example of VDM.',
            'Please give an example of RDM.',
            'Please give an example of NLR.',
            'Please give an example of FRP.',
            'Bob calls for a moderator. You respond and he says Tim RDM’d him, but Bob has no proof. What do you do?',
            'Jake calls for a moderator. You respond to the call and he immediately kills you. What do you do?',
            'Multiple people from one scene call for a moderator. Eight people are dead, three cars are on fire, and two people are alive. The caller reports MRDM and has a clip. What will you do?',
            'Do you agree to always use proper spelling, punctuation, and grammar?',
            'Do you agree to always remain professional?',
        ],
    },
    ban_appeal: {
        label: 'In-Game Ban Appeal',
        questions: [
            'What are your Discord name and user ID?',
            'How old are you?',
            'What is your Roblox username?',
            'Why should we approve your ban appeal? You must also state why you were banned.',
        ],
    },
} as const;

export type ActiveApplicationType = keyof typeof APPLICATION_QUESTIONS;

export const APPLICATION_APPROVAL_ROLE_IDS: Readonly<Partial<Record<ActiveApplicationType, readonly string[]>>> = {
    ingame: ['1524013351850737835'],
    discord: ['1530363357423468706', '1530363248728084620', '1521593407791825036'],
    media: ['1521593407770722497'],
};

export interface ApplicationSession {
    type: ActiveApplicationType;
    guildId: string;
    answers: string[];
    nextQuestion: number;
    startedAt: number;
    lastActivityAt: number;
    promptPending: boolean;
}

export interface ApplicationSessionPersistenceAdapter {
    loadApplicationSession(userId: string): Promise<ApplicationSession | null>;
    saveApplicationSession(userId: string, session: ApplicationSession): Promise<void>;
    deleteApplicationSession(userId: string): Promise<void>;
}

const activeApplications = new Map<string, ApplicationSession>();
const applicationReviewLocks = new Set<string>();
const applicationConversationLocks = new Map<string, Promise<void>>();
let applicationSessionPersistence: ApplicationSessionPersistenceAdapter | null = null;

export function configureApplicationSessionPersistence(adapter: ApplicationSessionPersistenceAdapter | null): void {
    applicationSessionPersistence = adapter;
}

export function clearApplicationSessionCache(): void {
    activeApplications.clear();
}

function validApplicationSession(session: ApplicationSession | null): session is ApplicationSession {
    return Boolean(session
        && session.type in APPLICATION_QUESTIONS
        && Array.isArray(session.answers)
        && Number.isInteger(session.nextQuestion)
        && session.nextQuestion >= 0
        && Number.isFinite(session.startedAt)
        && Number.isFinite(session.lastActivityAt)
        && typeof session.promptPending === 'boolean');
}

function applicationExpired(session: ApplicationSession): boolean {
    return Date.now() - session.lastActivityAt >= APPLICATION_SESSION_INACTIVITY_TTL_MS;
}

async function loadApplicationSession(userId: string): Promise<ApplicationSession | null> {
    const cached = activeApplications.get(userId);
    if (cached) return cached;
    if (!applicationSessionPersistence) return null;
    try {
        const restored = await applicationSessionPersistence.loadApplicationSession(userId);
        if (!validApplicationSession(restored)) return null;
        activeApplications.set(userId, restored);
        return restored;
    } catch (error) {
        logger.warn(`[Applications] Could not restore the application session for ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
}

async function saveApplicationSession(userId: string, session: ApplicationSession): Promise<void> {
    activeApplications.set(userId, session);
    if (!applicationSessionPersistence) return;
    try {
        await applicationSessionPersistence.saveApplicationSession(userId, session);
    } catch (error) {
        logger.warn(`[Applications] Could not persist progress for ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function deleteApplicationSession(userId: string): Promise<void> {
    activeApplications.delete(userId);
    if (!applicationSessionPersistence) return;
    try {
        await applicationSessionPersistence.deleteApplicationSession(userId);
    } catch (error) {
        logger.warn(`[Applications] Could not remove the completed session for ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function withApplicationConversationLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = applicationConversationLocks.get(userId) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolveLock => { release = resolveLock; });
    const queued = previous.then(() => current);
    applicationConversationLocks.set(userId, queued);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (applicationConversationLocks.get(userId) === queued) applicationConversationLocks.delete(userId);
    }
}

function applicationResponse(message: Message): string {
    const attachmentUrls = Array.from(message.attachments.values()).map(attachment => attachment.url);
    return [message.content.trim(), ...attachmentUrls].filter(Boolean).join('\n');
}

function applicationPrompt(content: string): { type: ActiveApplicationType; questionIndex: number } | null {
    for (const [rawType, setup] of Object.entries(APPLICATION_QUESTIONS)) {
        for (let questionIndex = 0; questionIndex < setup.questions.length; questionIndex += 1) {
            if (content.includes(`Question ${questionIndex + 1} of ${setup.questions.length}`)) {
                return { type: rawType as ActiveApplicationType, questionIndex };
            }
        }
    }
    return null;
}

interface RecoveredApplicationSession {
    session: ApplicationSession;
    sendNextPromptBeforeAcceptingAnswer: boolean;
}

async function recoverApplicationSessionFromDm(message: Message): Promise<RecoveredApplicationSession | null> {
    const channel = message.channel;
    if (!channel || !('messages' in channel) || !message.id) return null;
    const history = await channel.messages.fetch({ limit: 100, before: message.id }).catch(() => null);
    if (!history?.size) return null;
    const ordered = [...history.values()].sort((left, right) => left.createdTimestamp - right.createdTimestamp);

    let recoveredType: ActiveApplicationType | null = null;
    let latestQuestionIndex = -1;
    let pendingQuestionIndex = -1;
    let latestPromptAnswered = false;
    let startedAt = Date.now();
    let lastActivityAt = Date.now();
    const answers: string[] = [];

    for (const prior of ordered) {
        if (prior.author.bot) {
            const prompt = applicationPrompt(prior.content);
            if (!prompt) continue;
            if (recoveredType && (recoveredType !== prompt.type || (prompt.questionIndex === 0 && latestQuestionIndex >= 0))) {
                answers.length = 0;
            }
            recoveredType = prompt.type;
            pendingQuestionIndex = prompt.questionIndex;
            latestQuestionIndex = prompt.questionIndex;
            latestPromptAnswered = false;
            if (prompt.questionIndex === 0) startedAt = prior.createdTimestamp || Date.now();
            continue;
        }
        if (prior.author.id !== message.author.id || !recoveredType || pendingQuestionIndex < 0) continue;
        const response = applicationResponse(prior);
        if (!response) continue;
        answers[pendingQuestionIndex] = response;
        lastActivityAt = prior.createdTimestamp || Date.now();
        if (pendingQuestionIndex === latestQuestionIndex) latestPromptAnswered = true;
        pendingQuestionIndex = -1;
    }

    if (!recoveredType || latestQuestionIndex < 0) return null;
    const nextQuestion = latestPromptAnswered ? latestQuestionIndex + 1 : latestQuestionIndex;
    return {
        session: {
            type: recoveredType,
            guildId: process.env.GUILD_ID || '',
            answers,
            nextQuestion,
            startedAt,
            lastActivityAt,
            promptPending: latestPromptAnswered
                && nextQuestion < APPLICATION_QUESTIONS[recoveredType].questions.length,
        },
        sendNextPromptBeforeAcceptingAnswer: latestPromptAnswered
            && nextQuestion < APPLICATION_QUESTIONS[recoveredType].questions.length,
    };
}

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(APPLICATIONS_BANNER_PATH, { name: APPLICATIONS_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function guildEmoji(guild: Guild | null, hints: string[], fallback: string): string {
    const lowered = hints.map(hint => hint.toLowerCase());
    const emoji = guild?.emojis.cache.find(candidate => {
        const name = candidate.name?.toLowerCase() || '';
        return lowered.some(hint => name === hint || name.includes(hint));
    });
    return emoji?.toString() || fallback;
}

function launcherCopy(guild: Guild | null): string {
    const paper = guildEmoji(guild, ['paper', 'application'], '📄');
    const larp = guildEmoji(guild, ['larp'], '🌴');
    const arrow = guildEmoji(guild, ['arrow'], '➜');
    return [
        `## ${paper} Applications`,
        `Welcome to ${larp} **Los Angeles Roleplay**. This is the official staff application system. Take your time and make sure you meet every requirement before applying. Honesty and proper grammar are required.`,
        '',
        'You are required to read all Application Guidelines before applying. Breaking a guideline can cause an instant denial and may result in a staff blacklist.',
        '',
        '### 📌 Fast Passes and Transfers',
        'We accept fast passes and transfers when every requirement below is met:',
        `${arrow} The server must have around the same number of members as LARP.`,
        `${arrow} You must have earned your rank and not have been free-ranked.`,
        `${arrow} The server must have a good reputation.`,
        `${arrow} You must provide proof of your rank.`,
        `${arrow} You must retire from that community and provide proof.`,
        '',
        'Read the guidelines, then choose the application you want to begin from the menu below.',
    ].join('\n');
}

function applicationSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('applications:type')
            .setPlaceholder('Choose an application')
            .addOptions(
                { label: 'Media Team Application', value: 'media', emoji: '📸' },
                { label: 'In-Game Staff Application', value: 'ingame', emoji: '🎮' },
                { label: 'Discord Moderator Application', value: 'discord', emoji: '🛡️' },
                { label: 'In-Game Ban Appeal', value: 'ban_appeal', emoji: '⚖️' },
            ),
    );
}

function buildApplicationsPanel(guild: Guild | null): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(APPLICATIONS_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(launcherCopy(guild)))
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('applications:guidelines')
                    .setLabel('Application Guidelines')
                    .setEmoji('📌')
                    .setStyle(ButtonStyle.Primary),
            ),
        )
        .addActionRowComponents(applicationSelect())
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

const GUIDELINES_COPY = [
    '## 📌 Application Guidelines',
    '**All guidelines must be read and followed.**',
    '',
    '### Main Application Regulations',
    '• Do not use any form of AI.',
    '• You must be 13 or older.',
    '• Obey all server regulations.',
    '• Be able to complete your quota.',
    '• Be honest when applying.',
    '• Use proper grammar when answering.',
    '',
    '### Extra In-Game Staff Information',
    '• You must have been in the server for two days.',
    '• You must be able to complete the two-hour quota.',
    '',
    '### Extra Discord Staff Information',
    '• You must have previous experience.',
    '• You must be active in Discord.',
    '• You must know how to use bot commands.',
    '',
    '### Extra Media Team Information',
    '• Complete the quota of one picture per week.',
    '• Know how to edit and have a laptop or PC.',
    '• Produce good-quality pictures.',
    '',
    '### Extra Designer Information',
    '• Have previous experience and be able to make quality liveries.',
    '',
    '### Extra Ban Appeal Information',
    '• Never repeat the actions that caused your ban.',
    '• Give a good reason to be unbanned. Not every ban can be appealed.',
    '',
    '### Information',
    'Do not ask when your application will be reviewed; doing so can cause an instant denial. Reviews may take 1–2 days. If accepted, you have seven days to complete training or you may be terminated and required to reapply.',
].join('\n');

function buildGuidelinesPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(APPLICATIONS_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(GUIDELINES_COPY))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function compact(value: string, max = 240): string {
    const clean = value.replace(/```/g, "'''").trim() || 'No response provided.';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export interface ApplicationAiAssessment {
    flagged: boolean;
    score: number;
    signals: string[];
}

export function analyzeApplicationAi(answers: readonly string[]): ApplicationAiAssessment {
    const text = answers.join('\n').toLowerCase();
    const signals: string[] = [];
    let score = 0;

    if (/\b(?:as an ai|as a language model|i am an ai)\b/i.test(text)) {
        score += 10;
        signals.push('The response directly references being an AI or language model.');
    }

    const formalMarkers = [
        'it is important to note',
        'in conclusion',
        'furthermore',
        'moreover',
        'to ensure a safe and respectful environment',
        'i would take the following steps',
        'first and foremost',
    ].filter(marker => text.includes(marker));
    if (formalMarkers.length >= 2) {
        score += Math.min(formalMarkers.length, 4);
        signals.push(`Several formulaic AI-style phrases were found (${formalMarkers.slice(0, 3).join(', ')}).`);
    }

    const longAnswers = answers.filter(answer => answer.trim().split(/\s+/).length >= 100).length;
    if (longAnswers >= 3) {
        score += 2;
        signals.push('Several answers are unusually long and consistently structured.');
    }

    const repeatedWould = answers.filter(answer => /^\s*i would\b/i.test(answer)).length;
    if (repeatedWould >= 4) {
        score += 2;
        signals.push('Many separate answers use the same “I would” response template.');
    }

    const transitionCount = (text.match(/\b(?:firstly|secondly|additionally|subsequently|finally)\b/g) || []).length;
    if (transitionCount >= 5) {
        score += 2;
        signals.push('The responses repeatedly use formal, sequential transition wording.');
    }

    return { flagged: score >= 4, score, signals };
}

function aiReviewLine(answers: readonly string[]): string {
    const assessment = analyzeApplicationAi(answers);
    if (!assessment.flagged) return '> **AI Check:** ✅ No strong AI-writing indicators detected.';
    return [
        '> **AI Check:** ⚠️ `Potential AI Use — Manual Review Required`',
        `> **Signals:** ${compact(assessment.signals.join(' '), 450)}`,
    ].join('\n');
}

function reviewCopy(userId: string, session: ApplicationSession): string {
    const setup = APPLICATION_QUESTIONS[session.type];
    return [
        `## 📄 ${setup.label}`,
        `> **Applicant:** <@${userId}> (\`${userId}\`)`,
        `> **Submitted:** <t:${Math.floor(Date.now() / 1_000)}:F>`,
        '> **Status:** `Pending Review`',
        aiReviewLine(session.answers),
        '',
        ...setup.questions.flatMap((question, index) => [
            `**${index + 1}. ${question}**`,
            `\`\`\`\n${compact(session.answers[index] || '')}\n\`\`\``,
        ]),
    ].join('\n').slice(0, 4_000);
}

function reviewButtons(userId: string, type: ActiveApplicationType): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`applications:review:approve:${userId}:${type}`)
            .setLabel('Approve Application')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`applications:review:deny:${userId}:${type}`)
            .setLabel('Deny Application')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger),
    );
}

function buildReviewPanel(userId: string, session: ApplicationSession): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(APPLICATIONS_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(reviewCopy(userId, session)))
        .addActionRowComponents(reviewButtons(userId, session.type))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

function buildApplicationResultPanel(
    userId: string,
    type: ActiveApplicationType,
    approved: boolean,
    reviewerId: string,
    reviewReason: string,
): ContainerBuilder {
    const status = approved ? 'approved' : 'denied';
    return new ContainerBuilder()
        .setAccentColor(approved ? 0x22c55e : 0xef4444)
        .addMediaGalleryComponents(media(APPLICATIONS_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## ${approved ? '✅' : '❌'} Application ${approved ? 'Approved' : 'Denied'}`,
            `<@${userId}>, your **${APPLICATION_QUESTIONS[type].label}** has been **${status}**.`,
            `> **Reviewed by:** <@${reviewerId}>`,
            `> **Reason:** ${compact(reviewReason, 800)}`,
            approved
                ? 'Staff will contact you with the next steps.'
                : 'Thank you for taking the time to apply. You may reapply when permitted by the application guidelines.',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addMediaGalleryComponents(media(UNDERBANNER_NAME));
}

type ApplicationReviewInteraction = ButtonInteraction | ModalSubmitInteraction;

function memberRoleIds(member: ApplicationReviewInteraction['member']): string[] {
    if (!member) return [];
    const roles = (member as GuildMember).roles;
    if (roles && 'cache' in roles) return Array.from(roles.cache.keys());
    return Array.isArray((member as { roles?: string[] }).roles)
        ? (member as { roles: string[] }).roles
        : [];
}

async function canReviewApplications(interaction: ApplicationReviewInteraction): Promise<boolean> {
    if (memberRoleIds(interaction.member).includes(APPLICATION_REVIEWER_ROLE_ID)) return true;
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member?.roles.cache.has(APPLICATION_REVIEWER_ROLE_ID));
}

async function assignApplicationRoles(
    interaction: ApplicationReviewInteraction,
    userId: string,
    type: ActiveApplicationType,
): Promise<{ assigned: string[]; failed: string[] }> {
    const roleIds = [...(APPLICATION_APPROVAL_ROLE_IDS[type] || [])];
    if (!roleIds.length) return { assigned: [], failed: [] };
    const member = await interaction.guild?.members.fetch(userId).catch(() => null);
    if (!member) return { assigned: [], failed: roleIds };

    const assigned: string[] = [];
    const failed: string[] = [];
    for (const roleId of roleIds) {
        if (member.roles.cache.has(roleId)) {
            assigned.push(roleId);
            continue;
        }
        try {
            await member.roles.add(roleId, `${APPLICATION_QUESTIONS[type].label} approved by ${interaction.user.id}`);
            assigned.push(roleId);
        } catch {
            failed.push(roleId);
        }
    }
    return { assigned, failed };
}

function updatedReviewComponents(
    message: Message,
    reviewerId: string,
    approved: boolean,
    reviewReason: string,
): { components: unknown[]; alreadyProcessed: boolean } {
    const components = message.components
        .map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>;
    let reviewButtonCount = 0;
    let disabledReviewButtonCount = 0;
    const status = approved ? 'Approved' : 'Denied';
    const visit = (node: Record<string, unknown>): void => {
        if (typeof node.content === 'string' && node.content.includes('> **Status:**')) {
            node.content = node.content.replace(
                /> \*\*Status:\*\*[^\n]*/,
                `> **Status:** \`${status}\` • Reviewed by <@${reviewerId}>\n> **Decision Reason:** ${compact(reviewReason, 700)}`,
            ).slice(0, 4_000);
        }
        if (typeof node.custom_id === 'string' && node.custom_id.startsWith('applications:review:')) {
            reviewButtonCount += 1;
            if (node.disabled === true) disabledReviewButtonCount += 1;
            const selected = node.custom_id.includes(approved ? ':approve:' : ':deny:');
            node.disabled = true;
            node.style = selected ? (approved ? ButtonStyle.Success : ButtonStyle.Danger) : ButtonStyle.Secondary;
        }
        for (const child of (node.components as Array<Record<string, unknown>> | undefined) || []) visit(child);
    };
    for (const component of components) visit(component);
    return {
        components,
        alreadyProcessed: reviewButtonCount > 0 && disabledReviewButtonCount === reviewButtonCount,
    };
}

function reviewDecisionModal(
    action: 'approve' | 'deny',
    userId: string,
    type: ActiveApplicationType,
    channelId: string,
    messageId: string,
): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`applications:decision:${action}:${userId}:${type}:${channelId}:${messageId}`)
        .setTitle(action === 'approve' ? 'Approve Application' : 'Deny Application')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('decision_reason')
                    .setLabel(action === 'approve' ? 'Reason for approval' : 'Reason for denial')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(3)
                    .setMaxLength(1_000),
            ),
        );
}

function fullTranscript(userId: string, session: ApplicationSession): Buffer {
    const setup = APPLICATION_QUESTIONS[session.type];
    const lines = [
        setup.label,
        `Applicant ID: ${userId}`,
        `Started: ${new Date(session.startedAt).toISOString()}`,
        `Submitted: ${new Date().toISOString()}`,
        '',
    ];
    setup.questions.forEach((question, index) => {
        lines.push(`${index + 1}. ${question}`, session.answers[index] || 'No response provided.', '');
    });
    return Buffer.from(lines.join('\n'), 'utf8');
}

async function submitApplication(message: Message, session: ApplicationSession): Promise<void> {
    const setup = APPLICATION_QUESTIONS[session.type];
    const reviewChannel = await message.client.channels.fetch(APPLICATION_REVIEW_CHANNEL_ID).catch(() => null);
    if (!reviewChannel?.isSendable()) {
        throw new Error(`Review channel ${APPLICATION_REVIEW_CHANNEL_ID} is unavailable.`);
    }
    const transcript = new AttachmentBuilder(fullTranscript(message.author.id, session), {
        name: `${session.type}-${message.author.id}-application.txt`,
    });
    await reviewChannel.send({
        components: [buildReviewPanel(message.author.id, session)],
        files: [...artwork(), transcript],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], users: [message.author.id] },
    });

    await message.author.send([
        `✅ You have finished the **${setup.label}**.`,
        'Your application will be reviewed shortly and the result will be sent to you by DM.',
        '**DO NOT ASK FOR YOUR APPLICATION TO BE READ.**',
    ].join('\n')).catch(error => {
        logger.warn(`[Applications] Submitted ${message.author.id}'s application, but could not send its confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
}

export async function handleApplicationButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId === 'applications:guidelines') {
        await interaction.reply({
            components: [buildGuidelinesPanel()],
            files: artwork(),
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        return true;
    }
    if (!interaction.customId.startsWith('applications:review:')) return false;

    const [, , action, userId, rawType] = interaction.customId.split(':');
    if ((action !== 'approve' && action !== 'deny') || !userId || !(rawType in APPLICATION_QUESTIONS)) {
        await interaction.reply({ content: 'This application review action is invalid.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!(await canReviewApplications(interaction))) {
        await interaction.reply({
            content: `You must have <@&${APPLICATION_REVIEWER_ROLE_ID}> to review applications.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    await interaction.showModal(reviewDecisionModal(
        action,
        userId,
        rawType as ActiveApplicationType,
        interaction.channelId,
        interaction.message.id,
    ));
    return true;
}

export async function handleApplicationModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('applications:decision:')) return false;
    const [, , action, userId, rawType, channelId, messageId] = interaction.customId.split(':');
    if ((action !== 'approve' && action !== 'deny')
        || !userId
        || !(rawType in APPLICATION_QUESTIONS)
        || !channelId
        || !messageId) {
        await interaction.reply({ content: 'This application decision is invalid.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (!(await canReviewApplications(interaction))) {
        await interaction.reply({
            content: `You must have <@&${APPLICATION_REVIEWER_ROLE_ID}> to review applications.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    const reviewKey = messageId;
    if (applicationReviewLocks.has(reviewKey)) {
        await interaction.reply({ content: 'This application is already being processed.', flags: MessageFlags.Ephemeral });
        return true;
    }
    applicationReviewLocks.add(reviewKey);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const approved = action === 'approve';
        const reviewReason = interaction.fields.getTextInputValue('decision_reason').trim();
        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel || !('messages' in channel)) {
            await interaction.editReply('The original application channel is unavailable.');
            return true;
        }
        const reviewMessage = await channel.messages.fetch(messageId).catch(() => null);
        if (!reviewMessage) {
            await interaction.editReply('The original application message could not be found.');
            return true;
        }

        const updated = updatedReviewComponents(reviewMessage, interaction.user.id, approved, reviewReason);
        if (updated.alreadyProcessed) {
            await interaction.editReply('This application has already been processed.');
            return true;
        }

        await reviewMessage.edit({ components: updated.components as never });
        const type = rawType as ActiveApplicationType;
        const roleResult = approved
            ? await assignApplicationRoles(interaction, userId, type)
            : { assigned: [], failed: [] };
        let notified = false;
        try {
            const applicant = await interaction.client.users.fetch(userId);
            await applicant.send({
                components: [buildApplicationResultPanel(userId, type, approved, interaction.user.id, reviewReason)],
                files: artwork(),
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
            notified = true;
        } catch {
            notified = false;
        }
        await interaction.editReply(
            `✅ Application ${approved ? 'approved' : 'denied'}.`
            + `${notified ? ' The applicant was notified by DM.' : ' The applicant could not be reached by DM.'}`
            + `${roleResult.assigned.length ? ` Assigned ${roleResult.assigned.map(roleId => `<@&${roleId}>`).join(', ')}.` : ''}`
            + `${roleResult.failed.length ? ` Warning: I could not assign ${roleResult.failed.map(roleId => `<@&${roleId}>`).join(', ')}; check my Manage Roles permission and role position.` : ''}`,
        );
        return true;
    } finally {
        applicationReviewLocks.delete(reviewKey);
    }
}

export async function handleApplicationSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'applications:type') return false;
    const selected = interaction.values[0];
    if (!(selected in APPLICATION_QUESTIONS)) {
        await interaction.reply({ content: 'That application is unavailable.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const type = selected as ActiveApplicationType;
    const existing = await loadApplicationSession(interaction.user.id);
    if (existing && !applicationExpired(existing)) {
        await interaction.reply({
            content: `You already have a **${APPLICATION_QUESTIONS[existing.type].label}** in progress. Answer the current question in your DMs.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (existing) await deleteApplicationSession(interaction.user.id);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        await interaction.user.send([
            `## ${APPLICATION_QUESTIONS[type].label}`,
            'Answer each question in this DM. I will send the next question only after you reply.',
            '',
            `**Question 1 of ${APPLICATION_QUESTIONS[type].questions.length}**`,
            APPLICATION_QUESTIONS[type].questions[0],
        ].join('\n'));
        const now = Date.now();
        await saveApplicationSession(interaction.user.id, {
            type,
            guildId: interaction.guildId || '',
            answers: [],
            nextQuestion: 0,
            startedAt: now,
            lastActivityAt: now,
            promptPending: false,
        });
        await interaction.editReply('✅ Your application has started. Check your DMs for Question 1.');
    } catch {
        await interaction.editReply('I could not DM you. Enable direct messages from server members, then select the application again.');
    }
    return true;
}

export async function handleApplicationDmMessage(message: Message): Promise<boolean> {
    if (message.author.bot || message.guildId) return false;
    return withApplicationConversationLock(message.author.id, async () => {
        let session = await loadApplicationSession(message.author.id);
        let recoveredNextPrompt = false;
        if (!session) {
            const recovered = await recoverApplicationSessionFromDm(message);
            if (!recovered) return false;
            session = recovered.session;
            recoveredNextPrompt = recovered.sendNextPromptBeforeAcceptingAnswer;
        }
        if (applicationExpired(session)) {
            await deleteApplicationSession(message.author.id);
            await message.author.send('Your application timed out after 24 hours without a response. Return to the application panel to start again.').catch(() => undefined);
            return true;
        }

        const setup = APPLICATION_QUESTIONS[session.type];
        if (recoveredNextPrompt || session.promptPending) {
            session.promptPending = true;
            session.lastActivityAt = Date.now();
            await saveApplicationSession(message.author.id, session);
            const delivered = await message.author.send([
                '✅ I recovered your application progress after an interruption.',
                '',
                `**Question ${session.nextQuestion + 1} of ${setup.questions.length}**`,
                setup.questions[session.nextQuestion],
            ].join('\n')).then(() => true).catch(() => false);
            if (delivered) {
                session.promptPending = false;
                await saveApplicationSession(message.author.id, session);
            }
            return true;
        }
        if (session.nextQuestion >= setup.questions.length) {
            try {
                await submitApplication(message, session);
                await deleteApplicationSession(message.author.id);
            } catch (error) {
                logger.error(`[Applications] Submission retry failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                await message.author.send('Your completed answers are saved, but the review channel is still unavailable. Please try again later or contact an administrator.').catch(() => undefined);
            }
            return true;
        }

        const response = applicationResponse(message);
        if (!response) {
            await message.author.send('Please send a written response or an attachment before continuing.');
            return true;
        }

        session.answers[session.nextQuestion] = response;
        session.nextQuestion += 1;
        session.lastActivityAt = Date.now();
        session.promptPending = session.nextQuestion < setup.questions.length;
        await saveApplicationSession(message.author.id, session);

        if (session.nextQuestion < setup.questions.length) {
            try {
                await message.author.send([
                    `**Question ${session.nextQuestion + 1} of ${setup.questions.length}**`,
                    setup.questions[session.nextQuestion],
                ].join('\n'));
                session.promptPending = false;
                await saveApplicationSession(message.author.id, session);
            } catch (error) {
                logger.warn(`[Applications] Could not send Question ${session.nextQuestion + 1} to ${message.author.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            return true;
        }

        try {
            await submitApplication(message, session);
            await deleteApplicationSession(message.author.id);
        } catch (error) {
            logger.error(`[Applications] Submission failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await message.author.send('Your answers are safely saved, but I could not submit them for review. Send another DM to retry or contact an administrator.').catch(() => undefined);
        }
        return true;
    });
}

export const applicationsPanelCommand = {
    data: new SlashCommandBuilder()
        .setName('applications-panel')
        .setDescription('Post the Los Angeles Roleplay application panel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!interaction.channel?.isSendable()) {
            await interaction.editReply('This channel cannot receive the application panel.');
            return;
        }
        await interaction.channel.send({
            components: [buildApplicationsPanel(interaction.guild)],
            files: artwork(),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        await interaction.editReply('✅ The V2 Applications panel has been posted.');
    },
};
