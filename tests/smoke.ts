import assert from 'node:assert/strict';
import { ChannelType, Collection, PermissionFlagsBits, TextChannel } from 'discord.js';
import { commandDefinitions } from '../src/commands/registry';
import {
    buildOpeningEmbeds,
    createTicketFromModal,
    handleTicketModal,
    isTicketAssistantActiveForAuthor,
    mergeRobloxRefreshResult,
    postTicketPanel,
    ticketOpeningModalForValue,
} from '../src/commands/tickets';
import { detectProhibitedWords, detectRaidThreat, handleMessageModeration } from '../src/events/messageModeration';
import {
    configureInfractionPersistence,
    handleStaffManagementButton,
    type InfractionRecord,
} from '../src/commands/staffManagement';
import { handleCommunityButton, handleCommunityModal } from '../src/commands/community';
import { interactionCreate } from '../src/handlers/interactionCreate';
import { logSlashCommand, sanitizedCommandOptions } from '../src/utils/commandAudit';
import { generateTicketAssistantReply, isTicketAssistantEligible } from '../src/services/aiService';
import { lookupBloxlinkUser } from '../src/services/bloxlinkService';
import { fetchErlcServer, type ErlcServerSnapshot } from '../src/services/erlcService';
import {
    ErlcMonitor,
    MemoryErlcMonitorStateStore,
    type ErlcCommandDetectedEvent,
    type ErlcPunishmentCommandEvent,
    type ErlcTeamChangedEvent,
} from '../src/monitors/erlcMonitor';
import {
    activateTicket,
    claimOpenTicket,
    cleanupStaleTicketReservations,
    getTicketByChannel,
    removeTicketRecord,
    reserveTicket,
} from '../src/services/ticketRepository';
import type { TicketRecord } from '../src/database/models';
import { CHANNEL_IDS, SUPPORT_LINKS, SUPPORT_ROLE_IDS, TICKET_CATEGORY_IDS, type TicketCategory } from '../src/config/constants';
import { DEFAULT_OPENAI_MODEL, getBloxlinkApiKey, getOpenAiApiKey } from '../src/config/env';

async function run(): Promise<void> {
    const names = commandDefinitions.map(command => command.data.name);
    assert.equal(new Set(names).size, names.length, 'slash command names must be unique');
    for (const required of ['ticket-panel', 'ticket', 'movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint', 'training-results', 'promotion', 'infraction', 'prohibited-word', 'say']) {
        assert(names.includes(required), `missing /${required}`);
    }
    for (const command of commandDefinitions) assert.doesNotThrow(() => command.data.toJSON());

    const commandNamed = (name: string) => {
        const command = commandDefinitions.find(candidate => candidate.data.name === name);
        assert(command, `missing command implementation for /${name}`);
        return command;
    };

    const movieSchema = commandNamed('movie-feedback').data.toJSON() as {
        options: Array<{ name: string; required?: boolean; min_value?: number; max_value?: number }>;
    };
    assert.deepEqual(movieSchema.options.map(option => option.name), ['movie', 'when', 'where', 'rating', 'anonymous']);
    const movieRating = movieSchema.options.find(option => option.name === 'rating');
    assert(movieRating?.required && movieRating.min_value === 1 && movieRating.max_value === 10);

    const saySchema = commandNamed('say').data.toJSON() as {
        options: Array<{ name: string; required?: boolean; max_length?: number; channel_types?: number[] }>;
    };
    assert.deepEqual(saySchema.options.map(option => option.name), ['message', 'channel']);
    const sayMessage = saySchema.options.find(option => option.name === 'message');
    assert(sayMessage?.required && sayMessage.max_length === 2_000);

    const partnershipSchema = commandNamed('partnership').data.toJSON() as {
        options: Array<{ name: string; options?: Array<{ name: string }> }>;
    };
    assert.deepEqual(partnershipSchema.options.map(option => option.name), ['request']);
    assert.deepEqual(partnershipSchema.options[0]?.options?.map(option => option.name), []);

    const complaintSchema = commandNamed('staff-complaint').data.toJSON() as {
        options: Array<{ name: string; required?: boolean; min_value?: number; max_value?: number }>;
    };
    assert.deepEqual(complaintSchema.options.map(option => option.name), ['member', 'rating', 'what']);
    const complaintRating = complaintSchema.options.find(option => option.name === 'rating');
    assert(complaintRating?.required && complaintRating.min_value === 1 && complaintRating.max_value === 5);

    let partnershipModal: any = null;
    const partnershipButtonHandled = await handleCommunityButton({
        customId: 'partnership:open',
        showModal: async (modal: any) => { partnershipModal = modal; },
    } as never);
    assert(partnershipButtonHandled);
    assert.equal(partnershipModal?.toJSON().custom_id, 'partnership:request-modal');
    assert.deepEqual(
        partnershipModal?.toJSON().components.map((row: any) => row.components[0].custom_id),
        ['server_name', 'representative', 'invite_link', 'server_ad'],
    );

    let partnershipSubmission: any = null;
    const partnershipReplies: string[] = [];
    const partnershipModalHandled = await handleCommunityModal({
        customId: 'partnership:request-modal',
        client: {
            channels: {
                fetch: async (channelId: string) => ({
                    id: channelId,
                    isSendable: () => true,
                    send: async (payload: any) => { partnershipSubmission = payload; return { id: 'partnership-request-1' }; },
                }),
            },
        },
        fields: {
            getTextInputValue: (name: string) => ({
                server_name: 'Pacific Design Group',
                representative: 'Representative#1234',
                invite_link: 'https://discord.gg/pacific-design',
                server_ad: 'A professional ER:LC community for creative designers.',
            } as Record<string, string>)[name],
        },
        user: { id: 'partnership-user', tag: 'Representative#1234' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { partnershipReplies.push(content); },
    } as never);
    assert(partnershipModalHandled);
    assert.equal(partnershipSubmission?.embeds?.[0]?.data?.title, '🤝 Partnership Request');
    assert.equal(partnershipSubmission?.components?.[0]?.components?.length, 2);
    assert(partnershipSubmission?.files?.length === 1);
    assert(partnershipReplies.some(reply => reply.includes('submitted for review')));

    let complaintSubmission: any = null;
    const complaintReplies: string[] = [];
    await commandNamed('staff-complaint').execute({
        client: {
            channels: {
                fetch: async (channelId: string) => ({
                    id: channelId,
                    isSendable: () => true,
                    send: async (payload: any) => { complaintSubmission = payload; return { id: 'staff-complaint-1' }; },
                }),
            },
        },
        options: {
            getUser: () => ({ id: 'reported-staff', tag: 'Reported#0001' }),
            getInteger: () => 1,
            getString: () => 'The staff member acted unprofessionally during a support interaction.',
        },
        user: { id: 'complainant', tag: 'Complainant#0001' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { complaintReplies.push(content); },
    } as never);
    assert.equal(complaintSubmission?.embeds?.[0]?.data?.title, '📋 Staff Complaint Received');
    const complaintFields = complaintSubmission?.embeds?.[0]?.data?.fields || [];
    assert(complaintFields.some((field: any) => field.name === '⭐ Rating' && field.value === '⭐☆☆☆☆ (1/5)'));
    assert(complaintReplies.some(reply => reply.includes('submitted securely')));

    const trainingSchema = commandNamed('training-results').data.toJSON() as {
        options: Array<{ name: string; min_value?: number; max_value?: number }>;
    };
    for (const scoreName of ['driving-score', 'spag-score', 'mod-calls-score', 'communication-score', 'professionalism-score']) {
        const score = trainingSchema.options.find(option => option.name === scoreName);
        assert(score && score.min_value === 1 && score.max_value === 10, `${scoreName} must be constrained to 1–10`);
    }

    const infractionSchema = commandNamed('infraction').data.toJSON() as {
        options: Array<{ name: string; options?: Array<{ name: string }> }>;
    };
    const issueOptions = infractionSchema.options.find(option => option.name === 'issue')?.options || [];
    for (const optionName of ['member', 'action', 'reason', 'rule-broken', 'evidence', 'internal-notes', 'notify-member', 'expiration']) {
        assert(issueOptions.some(option => option.name === optionName), `missing /infraction issue ${optionName}`);
    }

    const promotionSchema = commandNamed('promotion').data.toJSON() as {
        options: Array<{ name: string; options?: Array<{ name: string; type: number }> }>;
    };
    const promotionIssueOptions = promotionSchema.options.find(option => option.name === 'issue')?.options || [];
    const promotionRoleOption = promotionIssueOptions.find(option => option.name === 'new-role');
    assert.equal(promotionRoleOption?.type, 8, '/promotion issue new-role must use Discord\'s server-role selector');
    assert(!promotionIssueOptions.some(option => option.name === 'new-rank'), 'free-text new-rank should be replaced by the role selector');

    const commandOptionFixture = {
        options: {
            data: [{
                name: 'issue',
                options: [
                    { name: 'reason', value: 'Policy violation' },
                    { name: 'evidence', value: 'https://private.example/evidence' },
                    { name: 'internal-notes', value: 'private management note' },
                ],
            }],
        },
    } as never;
    const sanitized = sanitizedCommandOptions(commandOptionFixture);
    assert(sanitized.includes('Policy violation'));
    assert(!sanitized.includes('private.example') && !sanitized.includes('private management note'));
    assert.equal((sanitized.match(/\[REDACTED\]/g) || []).length, 2);

    const panelSends: any[] = [];
    const panelReplies: unknown[] = [];
    const panelInteraction = {
        inGuild: () => true,
        guild: {
            members: {
                fetch: async () => ({
                    permissions: { has: (permission: bigint) => permission === PermissionFlagsBits.Administrator },
                    roles: { cache: { has: () => false } },
                }),
            },
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { panelSends.push(payload); },
                }),
            },
        },
        user: { id: '1523122912201277590' },
        client: {
            user: { id: '1520000000000000000' },
            channels: { fetch: async () => null },
        },
        deferReply: async () => undefined,
        editReply: async (payload: unknown) => { panelReplies.push(payload); },
    } as never;
    await postTicketPanel(panelInteraction);
    assert.equal(panelSends.length, 1);
    const panelEmbed = panelSends[0].embeds[0].toJSON();
    assert.equal(panelEmbed.title, 'Help & Support');
    assert.equal(panelEmbed.footer.text, 'Realism at its Finest');
    assert(panelEmbed.description.includes('Welcome to California State Roleplay support system!'));
    const panelMenu = panelSends[0].components[0].toJSON().components[0];
    assert.equal(panelMenu.custom_id, 'ticket_select');
    assert.equal(panelMenu.placeholder, 'Select a support department');
    assert.deepEqual(
        panelMenu.options.map((option: any) => [option.label, option.value]),
        [
            ['General Support', 'general'],
            ['Internal Affairs', 'internal'],
            ['Management', 'management'],
            ['High-Rank', 'highrank'],
        ],
    );
    assert.equal(panelReplies.length, 1);

    let selectedTicketModal: any = null;
    await interactionCreate({
        customId: 'ticket_select',
        values: ['management'],
        isButton: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => true,
        isChatInputCommand: () => false,
        showModal: async (modal: any) => { selectedTicketModal = modal; },
    } as never);
    assert.equal(selectedTicketModal?.toJSON().title, 'Management Ticket', 'the assistance dropdown should open the selected ticket modal');

    const originalBotPermissionsRole = process.env.BOT_PERMISSIONS_ROLE_ID;
    process.env.BOT_PERMISSIONS_ROLE_ID = 'say-authorized-role';
    const sayPayloads: any[] = [];
    const sayConfirmations: unknown[] = [];
    const exactSayMessage = '**CSRP Announcement**\n@everyone <@1489388257925005508> Please review the update.';
    const sayTarget = {
        id: 'say-target-channel',
        isSendable: () => true,
        toString: () => '<#say-target-channel>',
        send: async (payload: any) => {
            sayPayloads.push(payload);
            return { id: 'say-message-1' };
        },
    };
    const authorizedSayInteraction: any = {
        commandName: 'say',
        guildId: 'say-guild',
        guild: { ownerId: 'different-owner' },
        channelId: sayTarget.id,
        channel: sayTarget,
        user: {
            id: 'say-user',
            tag: 'SayUser#0001',
            toString: () => '<@say-user>',
        },
        member: { roles: ['say-authorized-role'] },
        memberPermissions: { has: () => false },
        options: {
            data: [{ name: 'message', value: exactSayMessage }],
            getString: () => exactSayMessage,
            getChannel: () => null,
            getSubcommand: () => null,
        },
        client: { channels: { fetch: async () => null } },
        deferred: false,
        replied: false,
        deferReply: async () => { authorizedSayInteraction.deferred = true; },
        editReply: async (payload: unknown) => { sayConfirmations.push(payload); },
        reply: async () => undefined,
        isButton: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => true,
    };
    await interactionCreate(authorizedSayInteraction);
    assert.deepEqual(sayPayloads, [{ content: exactSayMessage, allowedMentions: { parse: [] } }]);
    assert(sayConfirmations.some(reply => String(reply).includes('Message sent successfully')));

    delete process.env.BOT_PERMISSIONS_ROLE_ID;
    const deniedSayReplies: any[] = [];
    await interactionCreate({
        ...authorizedSayInteraction,
        user: { id: 'unauthorized-user', tag: 'Unauthorized#0001', toString: () => '<@unauthorized-user>' },
        member: { roles: [] },
        deferred: false,
        options: {
            ...authorizedSayInteraction.options,
            data: [{ name: 'message', value: 'Denied message' }],
            getString: () => 'Denied message',
        },
        reply: async (payload: any) => { deniedSayReplies.push(payload); },
    } as never);
    assert.equal(sayPayloads.length, 1, 'unauthorized /say attempts must not send a bot message');
    assert(deniedSayReplies.some(reply => String(reply.content || '').includes('server administrator')));
    if (originalBotPermissionsRole === undefined) delete process.env.BOT_PERMISSIONS_ROLE_ID;
    else process.env.BOT_PERMISSIONS_ROLE_ID = originalBotPermissionsRole;

    const movieSends: Array<{ channelId: string; payload: any }> = [];
    const movieInteraction = {
        deferReply: async () => undefined,
        editReply: async () => undefined,
        options: {
            getString: (name: string) => ({
                movie: 'Shrek 2',
                when: 'Every day',
                where: 'Netflix',
            } as Record<string, string>)[name] ?? null,
            getInteger: (name: string) => name === 'rating' ? 8 : null,
            getBoolean: (name: string) => name === 'anonymous' ? false : null,
        },
        user: { id: '1489388257925005508', username: 'therealstickyz_35430' },
        client: {
            channels: {
                fetch: async (channelId: string) => ({
                    isSendable: () => true,
                    send: async (payload: any) => {
                        movieSends.push({ channelId, payload });
                        return {};
                    },
                }),
            },
        },
    } as never;
    await commandNamed('movie-feedback').execute(movieInteraction);
    assert.equal(movieSends.length, 2, 'movie feedback should publish once and write one private audit');
    const moviePublic = movieSends[0].payload.embeds[0].toJSON();
    const movieAudit = movieSends[1].payload.embeds[0].toJSON();
    assert.equal(moviePublic.title, '🎬 Movie Feedback');
    assert.deepEqual(moviePublic.fields.slice(0, 3).map((field: any) => [field.name, field.value, field.inline]), [
        ['🎥 Movie', 'Shrek 2', true],
        ['📅 When', 'Every day', true],
        ['📍 Where', 'Netflix', true],
    ]);
    assert(moviePublic.fields.some((field: any) => field.name === '⭐ Rating' && field.value === `${'⭐'.repeat(8)}\n**8/10**`));
    assert.equal(moviePublic.thumbnail.url, 'attachment://csrp-logo.png');
    assert(moviePublic.footer.text.includes('Submitted by therealstickyz_35430'));
    assert(moviePublic.footer.text.includes('California State Roleplay | Realism at its Finest'));
    assert(moviePublic.timestamp, 'movie feedback should include its submission timestamp');
    assert(movieSends[0].payload.files.some((file: any) => file.name === 'csrp-logo.png'));
    assert(movieAudit.fields.some((field: any) => field.name === 'Discord ID' && field.value === '1489388257925005508'));
    assert(movieAudit.fields.some((field: any) => field.name === 'When' && field.value === 'Every day'));
    assert(movieAudit.fields.some((field: any) => field.name === 'Where' && field.value === 'Netflix'));

    const trainingSends: any[] = [];
    const trainingUsers = {
        trainee: { id: '1489388257925005508' },
        trainer: { id: '1523122912201277590' },
    };
    const trainingInteraction = {
        deferReply: async () => undefined,
        editReply: async () => undefined,
        options: {
            getUser: (name: 'trainee' | 'trainer') => trainingUsers[name],
            getString: (name: string) => ({ department: 'California Highway Patrol', result: 'Pass', notes: 'Professional performance.' } as Record<string, string>)[name] ?? null,
            getInteger: (name: string) => ({
                'driving-score': 9,
                'spag-score': 8,
                'mod-calls-score': 9,
                'communication-score': 10,
                'professionalism-score': 10,
            } as Record<string, number>)[name] ?? null,
        },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => {
                        trainingSends.push(payload);
                        return {};
                    },
                }),
            },
        },
    } as never;
    await commandNamed('training-results').execute(trainingInteraction);
    assert.equal(trainingSends.length, 1);
    const trainingEmbed = trainingSends[0].embeds[0].toJSON();
    assert.equal(trainingEmbed.color, 0x22c55e, 'Pass training results must be green');
    assert(trainingEmbed.fields.some((field: any) => field.name === 'Average' && field.value === '9.2/10'));
    (trainingInteraction as any).options.getString = (name: string) => ({
        department: 'California Highway Patrol',
        result: 'Fail',
        notes: 'Additional coaching required.',
    } as Record<string, string>)[name] ?? null;
    await commandNamed('training-results').execute(trainingInteraction);
    assert.equal(trainingSends[1].embeds[0].toJSON().color, 0xef4444, 'Fail training results must be red');

    const promotionSends: any[] = [];
    const promotedMember = { id: '1489388257925005508', username: 'PromotedUser' };
    const approvedBy = { id: '1523122912201277590', username: 'Approver' };
    const selectedRole = { id: '1523122834161926238', name: 'Senior Staff', toString: () => '<@&1523122834161926238>' };
    const promotionInteraction = {
        deferReply: async () => undefined,
        editReply: async () => undefined,
        user: { id: '1523122912201277590' },
        options: {
            getSubcommand: () => 'issue',
            getUser: (name: string) => name === 'member' ? promotedMember : approvedBy,
            getRole: () => selectedRole,
            getString: (name: string) => ({
                'old-rank': 'Staff Member',
                reason: 'Consistent professionalism and leadership.',
                'effective-date': 'Immediately',
            } as Record<string, string>)[name] ?? null,
        },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => {
                        promotionSends.push(payload);
                        return {};
                    },
                }),
            },
        },
    } as never;
    await commandNamed('promotion').execute(promotionInteraction);
    assert.equal(promotionSends.length, 1);
    assert(promotionSends[0].content.includes(`<@${promotedMember.id}>`), 'promotion post must ping the promoted member');
    assert.deepEqual(promotionSends[0].allowedMentions, { parse: [], users: [promotedMember.id] });
    const promotionFields = promotionSends[0].embeds[0].toJSON().fields;
    assert(promotionFields.some((field: any) => field.name === 'New Role' && field.value === `<@&${selectedRole.id}>`));

    let savedInfraction: InfractionRecord | null = null;
    configureInfractionPersistence({
        nextCaseNumber: async () => 1,
        saveInfraction: async record => { savedInfraction = record; },
        getInfractionByThreadId: async () => savedInfraction,
    });
    const infractionThreadSends: any[] = [];
    const infractionParentSends: any[] = [];
    let attachedThreadOptions: any = null;
    const infractionDetailEdits: any[] = [];
    let infractionDetailDeleted = false;
    const infractionThread = {
        id: '1526044664975851999',
        url: 'https://discord.com/channels/guild/1526044664975851999',
        guild: {
            members: { fetch: async () => new Map() },
            roles: { fetch: async () => null },
        },
        send: async (payload: any) => {
            infractionThreadSends.push(payload);
            return { id: '1526044664975852000' };
        },
    };
    const infractionParent = Object.create(TextChannel.prototype) as any;
    Object.defineProperties(infractionParent, {
        id: { value: '1526044664975851642' },
        type: { value: ChannelType.GuildText },
        send: {
            value: async (payload: any) => {
                infractionParentSends.push(payload);
                return {
                    id: '1526044664975851777',
                    url: 'https://discord.com/channels/guild/1526044664975851642/1526044664975851777',
                    startThread: async (options: any) => {
                        attachedThreadOptions = options;
                        return infractionThread;
                    },
                    edit: async (payload: any) => {
                        infractionDetailEdits.push(payload);
                        return {};
                    },
                    delete: async () => { infractionDetailDeleted = true; },
                };
            },
        },
    });
    const infractionReplies: unknown[] = [];
    const infractionInteraction = {
        guildId: '789699000047370261',
        deferReply: async () => undefined,
        editReply: async (payload: unknown) => { infractionReplies.push(payload); },
        user: { id: '1523122912201277590' },
        options: {
            getSubcommand: () => 'issue',
            getUser: () => ({ id: '1489388257925005508', username: 'ExampleUser' }),
            getString: (name: string) => ({
                action: 'Warning',
                reason: 'Repeated policy violation.',
                'rule-broken': 'Staff Conduct 2.1',
                evidence: 'https://evidence.example/case',
                'internal-notes': 'Management review complete.',
                expiration: '30 days',
            } as Record<string, string>)[name] ?? null,
            getBoolean: () => false,
        },
        client: { channels: { fetch: async () => infractionParent } },
    } as never;
    await commandNamed('infraction').execute(infractionInteraction);
    assert(attachedThreadOptions, 'the infraction record message should receive an attached evidence thread');
    assert.equal(attachedThreadOptions.name, 'INF-0001 | ExampleUser | Warning');
    assert.equal(attachedThreadOptions.type, undefined, 'message threads are public and should not be created as a standalone channel thread');
    assert.equal(infractionDetailDeleted, false);
    assert.equal(infractionParentSends.length, 1, 'the complete infraction embed should be sent to the parent channel');
    const infractionDetail = infractionParentSends[0];
    assert.equal(infractionDetail.content, '<@1489388257925005508>, a staff infraction has been issued. Please review the record below.');
    assert.deepEqual(infractionDetail.allowedMentions, { parse: [], users: ['1489388257925005508'] });
    assert.equal(infractionDetailEdits.length, 1, 'the parent record should receive controls after its thread is attached');
    const updatedInfractionDetail = infractionDetailEdits[0];
    const openThreadButton = updatedInfractionDetail.components[1].toJSON().components[0];
    assert.equal(openThreadButton.label, 'Open Evidence Thread');
    assert.equal(openThreadButton.url, infractionThread.url);
    assert(savedInfraction && savedInfraction.threadId === infractionThread.id);
    assert.equal(savedInfraction.detailMessageId, '1526044664975851777');
    assert(infractionDetail.embeds[0].toJSON().description.includes('infraction channel'));
    const infractionFields = infractionDetail.embeds[0].toJSON().fields;
    assert(infractionFields.some((field: any) => field.name === 'Internal Notes' && field.value === 'Management review complete.'));
    const controlLabels = updatedInfractionDetail.components.flatMap((row: any) => row.toJSON().components.map((button: any) => button.label));
    assert.deepEqual(controlLabels, ['Edit', 'Add Evidence', 'Add Note', 'Void', 'View History', 'Open Evidence Thread', 'Close Thread']);
    assert(infractionThreadSends[0].content.includes('Evidence Workspace'), 'the thread should contain evidence-upload guidance only');
    assert.equal(infractionThreadSends[0].embeds, undefined, 'the full infraction embed must not be posted inside the thread');
    let evidenceModal: any = null;
    await handleStaffManagementButton({
        customId: `infraction:add-evidence:${infractionThread.id}`,
        channelId: infractionParent.id,
        showModal: async (modal: any) => { evidenceModal = modal; },
    } as never);
    assert.equal(
        evidenceModal?.toJSON().custom_id,
        `infraction:evidence-modal:${infractionThread.id}`,
        'parent-channel controls must target the linked evidence thread',
    );
    assert(infractionReplies.some(reply => String(reply).includes('INF-0001 was created successfully')));
    configureInfractionPersistence(null);

    const categoryFieldCounts: Record<TicketCategory, number> = { general: 2, internal: 4, management: 2, highrank: 2 };
    assert.equal(SUPPORT_ROLE_IDS.general, '1523122697746382868', 'the supplied General Support role must be used');
    for (const [category, count] of Object.entries(categoryFieldCounts)) {
        const modal = ticketOpeningModalForValue(category);
        assert(modal, `missing ${category} modal`);
        const json = modal.toJSON() as { components: Array<{ components: Array<{ max_length?: number }> }> };
        assert.equal(json.components.length, count, `${category} modal field count`);
        assert(json.components.every(row => row.components[0]?.max_length === 4000), `${category} answers should use Discord's full modal limit`);
    }

    const originalBloxlinkKey = process.env.BLOXLINK_API_KEY;
    delete process.env.BLOXLINK_API_KEY;
    const liveWorkflowGuildId = `ticket-workflow-${Date.now()}`;
    const workflowChannelIds: string[] = [];
    for (const category of Object.keys(categoryFieldCounts) as TicketCategory[]) {
        const answerValues: Record<string, string> = category === 'internal'
            ? {
                reported_person: 'ReportedUser',
                report_reason: 'Full internal report reason.',
                proof: 'https://evidence.example/internal-report',
                additional: 'Full internal additional information.',
            }
            : {
                reason: `Full ${category} ticket reason.`,
                additional: `Full ${category} additional information.`,
            };
        const sentPayloads: any[] = [];
        let createdOptions: any = null;
        const channelId = `workflow-channel-${category}-${Date.now()}`;
        const fakeChannel = {
            id: channelId,
            name: `ticket-${category}`,
            client: {
                channels: {
                    fetch: async () => ({ isSendable: () => true, send: async () => ({}) }),
                },
            },
            toString: () => `<#${channelId}>`,
            send: async (payload: any) => {
                sentPayloads.push(payload);
                return { id: `workflow-message-${category}-${sentPayloads.length}` };
            },
            delete: async () => undefined,
        };
        const fakeGuild = {
            id: liveWorkflowGuildId,
            roles: {
                everyone: { id: 'everyone-role' },
                fetch: async () => ({ id: SUPPORT_ROLE_IDS[category] }),
            },
            members: {
                me: { id: 'bot-member-id' },
                fetchMe: async () => ({ id: 'bot-member-id' }),
            },
            channels: {
                fetch: async () => ({ type: ChannelType.GuildCategory }),
                create: async (options: any) => {
                    createdOptions = options;
                    return fakeChannel;
                },
            },
        };
        const replies: string[] = [];
        const modalInteraction = {
            guild: fakeGuild,
            user: {
                id: '1489388257925005508',
                username: 'djdjfj0808',
                tag: 'djdjfj0808',
                createdAt: new Date('2026-04-02T00:00:00.000Z'),
                displayAvatarURL: () => 'https://cdn.example/discord-avatar.png',
            },
            fields: { getTextInputValue: (name: string) => answerValues[name] || '' },
            deferReply: async () => undefined,
            editReply: async (message: string) => { replies.push(message); },
        } as never;
        await createTicketFromModal(modalInteraction, category);
        workflowChannelIds.push(channelId);
        assert(createdOptions, `${category} should create a Discord channel`);
        assert.equal(createdOptions.parent, TICKET_CATEGORY_IDS[category]);
        assert.notEqual(SUPPORT_ROLE_IDS[category], TICKET_CATEGORY_IDS[category], `${category} role must not be a category ID`);
        const everyoneOverwrite = createdOptions.permissionOverwrites.find((overwrite: any) => overwrite.id === 'everyone-role');
        const creatorOverwrite = createdOptions.permissionOverwrites.find((overwrite: any) => overwrite.id === '1489388257925005508');
        const supportOverwrite = createdOptions.permissionOverwrites.find((overwrite: any) => overwrite.id === SUPPORT_ROLE_IDS[category]);
        const botOverwrite = createdOptions.permissionOverwrites.find((overwrite: any) => overwrite.id === 'bot-member-id');
        assert(everyoneOverwrite?.deny.includes(PermissionFlagsBits.ViewChannel));
        assert(creatorOverwrite?.allow.includes(PermissionFlagsBits.ViewChannel));
        assert(supportOverwrite?.allow.includes(PermissionFlagsBits.ViewChannel));
        assert(botOverwrite?.allow.includes(PermissionFlagsBits.ManageChannels));
        assert.equal(sentPayloads[0].content, '**Ticket Controls**', `${category} controls must be the first ticket message`);
        assert.equal(sentPayloads[1].content, `<@1489388257925005508> <@&${SUPPORT_ROLE_IDS[category]}>`);
        const workflowEmbeds = sentPayloads.filter(payload => payload.embeds).flatMap(payload => payload.embeds);
        const submittedText = workflowEmbeds
            .flatMap((embed: any) => embed.toJSON().fields || [])
            .map((field: any) => field.value)
            .join('\n');
        for (const answer of Object.values(answerValues)) {
            assert(submittedText.includes(answer), `${category} opening embeds must retain: ${answer}`);
        }
        assert(sentPayloads.some(payload => String(payload.content || '').includes('automated CSRP support assistant')));
        const controlPayload = sentPayloads.find(payload => payload.content === '**Ticket Controls**');
        assert(controlPayload && controlPayload.components.length >= 2, `${category} controls should be persistent`);
        const welcomeIndex = sentPayloads.findIndex(payload => payload.embeds?.length);
        const assistantIndex = sentPayloads.findIndex(payload => String(payload.content || '').includes('automated CSRP support assistant'));
        assert(welcomeIndex > 0 && assistantIndex > welcomeIndex, `${category} controls should appear above the welcome and assistant messages`);
        assert(replies.some(reply => reply.includes('ticket is ready')));
    }
    for (const channelId of workflowChannelIds) await removeTicketRecord(channelId);
    if (originalBloxlinkKey === undefined) delete process.env.BLOXLINK_API_KEY;
    else process.env.BLOXLINK_API_KEY = originalBloxlinkKey;

    const closureGuildId = `ticket-closure-${Date.now()}`;
    const closureChannelId = `ticket-closure-channel-${Date.now()}`;
    const closureCreatorId = 'ticket-closure-creator';
    const closureReservation = await reserveTicket({
        guildId: closureGuildId,
        creatorId: closureCreatorId,
        category: 'general',
        supportRoleId: SUPPORT_ROLE_IDS.general,
        answers: { reason: 'Original support request.' },
        discordInfo: {},
        robloxInfo: {},
    });
    assert(closureReservation.ticket, 'closure workflow reservation should be created');
    assert(await activateTicket(closureReservation.ticket.channelId, closureChannelId));

    const sourceMessages = new Collection<string, any>();
    sourceMessages.set('source-message-1', {
        id: 'source-message-1',
        createdAt: new Date('2026-07-26T12:00:00.000Z'),
        createdTimestamp: Date.parse('2026-07-26T12:00:00.000Z'),
        content: 'The issue is now resolved.',
        author: { id: closureCreatorId, tag: 'TicketCreator#0001' },
        attachments: new Collection(),
        embeds: [],
    });
    const closureChannelSends: any[] = [];
    const closureChannel = Object.create(TextChannel.prototype) as any;
    closureChannel.id = closureChannelId;
    closureChannel.name = 'ticket-99-ticketcreator';
    closureChannel.messages = { fetch: async () => sourceMessages };
    closureChannel.permissionOverwrites = { edit: async () => undefined };
    closureChannel.setName = async (name: string) => { closureChannel.name = name; };
    closureChannel.send = async (payload: any) => {
        closureChannelSends.push(payload);
        return { id: `closure-message-${closureChannelSends.length}` };
    };

    const archiveSends: any[] = [];
    const archiveChannel = {
        id: CHANNEL_IDS.ticketTranscript,
        guildId: closureGuildId,
        isSendable: () => true,
        send: async (payload: any) => {
            archiveSends.push(payload);
            return { id: 'archive-message-1' };
        },
    };
    const closureReplies: string[] = [];
    const closureInteraction: any = {
        customId: 'ticket:modal:close_reason',
        channelId: closureChannelId,
        channel: closureChannel,
        guild: { members: { fetch: async () => null } },
        user: {
            id: closureCreatorId,
            tag: 'TicketCreator#0001',
            toString: () => `<@${closureCreatorId}>`,
        },
        client: {
            channels: {
                fetch: async (channelId: string) => channelId === CHANNEL_IDS.ticketTranscript ? archiveChannel : null,
            },
        },
        fields: { getTextInputValue: () => 'The member confirmed their question was answered.' },
        deferred: false,
        replied: false,
        deferReply: async () => { closureInteraction.deferred = true; },
        editReply: async (content: string) => { closureReplies.push(content); },
    };
    assert(await handleTicketModal(closureInteraction), 'close-reason modal should be handled');
    assert.equal(closureChannelSends[0].content, `<@${closureCreatorId}>, this ticket is being closed for the reason shown below.`);
    assert.deepEqual(closureChannelSends[0].allowedMentions.users, [closureCreatorId]);
    const closureRequestFields = closureChannelSends[0].embeds[0].toJSON().fields;
    assert(closureRequestFields.some((field: any) => field.name === 'Reason' && field.value.includes('question was answered')));
    assert.equal(archiveSends.length, 1, 'close with reason must archive exactly one transcript');
    assert(archiveSends[0].files.some((file: any) => file.name?.endsWith('-transcript.txt')));
    const archivedTicket = await getTicketByChannel(closureChannelId);
    assert.equal(archivedTicket?.status, 'closed');
    assert.equal(archivedTicket?.closeReason, 'The member confirmed their question was answered.');
    assert(closureReplies.some(reply => reply.includes(`<#${CHANNEL_IDS.ticketTranscript}>`)));
    await removeTicketRecord(closureChannelId);

    const longReason = `${'A'.repeat(1000)} ${'B'.repeat(1000)}\n${'C'.repeat(1500)}`;
    const openingTicket: TicketRecord = {
        guildId: 'guild', number: 36, channelId: 'channel', creatorId: '1489388257925005508',
        category: 'highrank', supportRoleId: '1527845170748326021', status: 'open',
        claimedBy: null, aiEnabled: true, escalated: false, addedUserIds: [],
        answers: { reason: longReason, additional: 'All details retained.' },
        discordInfo: { username: 'djdjfj0808', createdAt: new Date('2026-04-02T00:00:00Z').toISOString() },
        robloxInfo: {
            status: 'not_verified', verified: false, robloxId: null, robloxUsername: null,
            robloxDisplayName: null, robloxAvatarUrl: null, robloxCreatedAt: null,
            profileUrl: null, verificationSource: 'Bloxlink', message: 'No verified Roblox account found',
        },
        createdAt: new Date(),
    };
    const openingEmbeds = buildOpeningEmbeds(openingTicket, 'https://cdn.example/avatar.png');
    const preservedReason = openingEmbeds.flatMap(embed => embed.toJSON().fields || [])
        .filter(field => field.name === 'Reason' || field.name.startsWith('Reason (continued'))
        .map(field => field.value).join('');
    assert.equal(preservedReason, longReason, 'long modal answers must not be discarded or shortened');
    assert(isTicketAssistantActiveForAuthor(openingTicket, openingTicket.creatorId));
    assert(!isTicketAssistantActiveForAuthor(
        { ...openingTicket, creatorId: 'transferred-owner' },
        openingTicket.creatorId,
    ), 'an in-flight AI response must be rejected after ownership transfer');

    const repositoryGuild = `smoke-${Date.now()}`;
    const activatedChannels: string[] = [];
    for (const category of Object.keys(categoryFieldCounts) as TicketCategory[]) {
        const reservation = await reserveTicket({
            guildId: repositoryGuild,
            creatorId: 'user-1',
            category,
            supportRoleId: `role-${category}`,
            answers: { reason: category },
            discordInfo: {},
            robloxInfo: {},
        });
        assert(reservation.ticket, `reservation failed for ${category}`);
        const channelId = `channel-${repositoryGuild}-${category}`;
        activatedChannels.push(channelId);
        assert(await activateTicket(reservation.ticket.channelId, channelId), `activation failed for ${category}`);
    }
    const duplicate = await reserveTicket({
        guildId: repositoryGuild,
        creatorId: 'user-1',
        category: 'general',
        supportRoleId: 'role-general',
        answers: {}, discordInfo: {}, robloxInfo: {},
    });
    assert(duplicate.duplicate, 'same-category duplicate should be rejected');
    const claimed = await claimOpenTicket(activatedChannels[0], 'staff-1');
    assert.equal(claimed?.claimedBy, 'staff-1');
    assert.equal(claimed?.aiEnabled, false, 'claiming should disable AI');
    assert.equal(await claimOpenTicket(activatedChannels[0], 'staff-2'), null, 'a competing claimant must lose atomically');

    const abandoned = await reserveTicket({
        guildId: repositoryGuild,
        creatorId: 'abandoned-user',
        category: 'general',
        supportRoleId: 'role-general',
        answers: {}, discordInfo: {}, robloxInfo: {},
    });
    assert(abandoned.ticket, 'stale-cleanup reservation should be created');
    const removedPending = await cleanupStaleTicketReservations({
        maxAgeMs: 60_000,
        now: abandoned.ticket.createdAt.getTime() + 60_001,
    });
    assert.equal(removedPending, 1, 'cleanup should remove only the abandoned pending reservation');
    assert.equal(await getTicketByChannel(abandoned.ticket.channelId), null, 'stale pending reservation should be gone');
    assert(await getTicketByChannel(activatedChannels[0]), 'cleanup must not remove an active ticket');
    for (const channelId of activatedChannels) await removeTicketRecord(channelId);

    assert.deepEqual(detectProhibitedWords('That class assignment is fine.', ['ass']), []);
    assert.deepEqual(detectProhibitedWords('This is shit.', ['shit']), ['shit']);
    assert.equal(detectRaidThreat('Let us raid the fridge for snacks.'), null);
    assert.equal(detectRaidThreat("We're going to raid this Discord server right now")?.confidence, 'High');

    const moderationSends: Array<{ channelId: string; payload: any }> = [];
    const originalEmergencyRole = process.env.EMERGENCY_STAFF_ROLE_ID;
    process.env.EMERGENCY_STAFF_ROLE_ID = '1523122912201277590';
    const moderationMessage = {
        guild: {},
        guildId: '789699000047370261',
        channelId: '1526034504953892925',
        id: '1529999999999999991',
        url: 'https://discord.com/channels/789699000047370261/1526034504953892925/1529999999999999991',
        content: "We're going to raid this Discord server right now. This is shit.",
        webhookId: null,
        createdTimestamp: Date.now(),
        createdAt: new Date(),
        author: {
            id: '1489388257925005508',
            bot: false,
            displayAvatarURL: () => 'https://cdn.example/avatar.png',
        },
        client: {
            channels: {
                fetch: async (channelId: string) => ({
                    isSendable: () => true,
                    send: async (payload: any) => { moderationSends.push({ channelId, payload }); },
                }),
            },
        },
    } as never;
    await handleMessageModeration(moderationMessage);
    await handleMessageModeration(moderationMessage);
    assert.equal(moderationSends.length, 2, 'one message should create one profanity log and one raid log without duplicates');
    const highThreatPayload = moderationSends.find(entry => entry.payload.content)?.payload;
    assert.equal(highThreatPayload?.content, '<@&1523122912201277590>', 'only the High-confidence alert should ping emergency staff');
    for (const entry of moderationSends) {
        const fields = entry.payload.embeds[0].toJSON().fields || [];
        const preserved = fields
            .filter((field: any) => field.name.startsWith('Full Original Message'))
            .map((field: any) => field.value)
            .join('');
        assert.equal(preserved, moderationMessage.content, 'moderation logs must preserve the full original message');
    }
    const mediumMessage = {
        ...moderationMessage,
        id: '1529999999999999992',
        content: 'They are planning a raid against this Discord server.',
    } as never;
    await handleMessageModeration(mediumMessage);
    assert.equal(moderationSends.length, 3);
    assert.equal(moderationSends[2].payload.content, undefined, 'non-High raid alerts must not ping emergency staff');
    if (originalEmergencyRole === undefined) delete process.env.EMERGENCY_STAFF_ROLE_ID;
    else process.env.EMERGENCY_STAFF_ROLE_ID = originalEmergencyRole;

    const auditSends: any[] = [];
    const auditInteraction = {
        commandName: 'infraction',
        guildId: '789699000047370261',
        channelId: '1526044664975851642',
        channel: { toString: () => '<#1526044664975851642>' },
        user: {
            id: '1523122912201277590',
            tag: 'Manager#0001',
            toString: () => '<@1523122912201277590>',
        },
        options: {
            data: (commandOptionFixture as any).options.data,
            getSubcommand: () => 'issue',
        },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { auditSends.push(payload); },
                }),
            },
        },
    } as never;
    await logSlashCommand(auditInteraction, Date.now() - 25, false, new Error('API key=super-secret-value failed'));
    assert.equal(auditSends.length, 1, 'slash command audit should be delivered');
    const auditFields = auditSends[0].embeds[0].toJSON().fields;
    assert(auditFields.some((field: any) => field.name === 'Result' && field.value === 'Failure'));
    const auditedOptions = auditFields.find((field: any) => field.name === 'Options (sanitized)')?.value || '';
    assert(!auditedOptions.includes('private.example') && !auditedOptions.includes('private management note'));
    const auditedFailure = auditFields.find((field: any) => field.name === 'Failure')?.value || '';
    assert(!auditedFailure.includes('super-secret-value'));

    assert(isTicketAssistantEligible({ isOpen: true, isTicketCreator: true, authorIsBot: false, isClaimed: false, aiEnabled: true, escalated: false }));
    assert(!isTicketAssistantEligible({ isOpen: true, isTicketCreator: true, authorIsBot: false, isClaimed: true, aiEnabled: true, escalated: false }));
    const originalOpenAiModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    let aiRequestUrl = '';
    let aiRequestInit: RequestInit | undefined;
    const aiResult = await generateTicketAssistantReply(
        { userMessage: 'I need help with my application.' },
        {
            apiKey: 'test-key',
            fetchImpl: async (input, init) => {
                aiRequestUrl = String(input);
                aiRequestInit = init;
                return new Response(JSON.stringify({ id: 'response-1', output_text: 'Please share the application type and submission time.' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            },
        },
    );
    if (originalOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalOpenAiModel;
    assert.equal(aiResult.status, 'ok');
    if (aiResult.status === 'ok') assert(aiResult.reply.includes('Automated CSRP Support Assistant'));
    assert.equal(aiRequestUrl, 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(aiRequestInit?.headers).get('authorization'), 'Bearer test-key');
    assert.equal(JSON.parse(String(aiRequestInit?.body || '{}')).model, DEFAULT_OPENAI_MODEL);

    const paidPartnerResult = await generateTicketAssistantReply({
        userMessage: 'How do I get a paid partner?',
    }, { apiKey: '' });
    assert.equal(paidPartnerResult.status, 'ok', 'paid-partner routing must work without an OpenAI key');
    if (paidPartnerResult.status === 'ok') {
        assert(paidPartnerResult.reply.includes(SUPPORT_LINKS.paidPartner));
        assert.equal(paidPartnerResult.model, 'csrp-deterministic-routing');
    }

    const rulesResult = await generateTicketAssistantReply({
        userMessage: 'Where can I read the ERLC rules?',
    }, { apiKey: '' });
    assert.equal(rulesResult.status, 'ok', 'ER:LC rules routing must work without an OpenAI key');
    if (rulesResult.status === 'ok') {
        assert(rulesResult.reply.includes(SUPPORT_LINKS.rules));
        assert(rulesResult.reply.includes('In Game Rules'));
    }

    let erlcRequestBody: any = null;
    const erlcAiResult = await generateTicketAssistantReply(
        { userMessage: 'What changed recently in ER:LC vehicle rules?' },
        {
            apiKey: 'test-key',
            fetchImpl: async (_input, init) => {
                erlcRequestBody = JSON.parse(String(init?.body || '{}'));
                return new Response(JSON.stringify({ id: 'response-erlc', output_text: 'Please review the current official guidance.' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            },
        },
    );
    assert.equal(erlcAiResult.status, 'ok');
    assert.equal(erlcRequestBody?.tools?.[0]?.type, 'web_search');
    const allowedDomains = erlcRequestBody?.tools?.[0]?.filters?.allowed_domains || [];
    assert(allowedDomains.includes('policeroleplay.community'));
    assert(allowedDomains.includes('roblox.com'));
    assert(String(erlcRequestBody?.instructions || '').includes(SUPPORT_LINKS.rules));

    let throttledCalls = 0;
    const throttledUser = `throttle-${Date.now()}`;
    const throttledOptions = {
        apiKey: 'test-key',
        enforceThrottle: true,
        minimumIntervalMs: 5,
        fetchImpl: async () => {
            throttledCalls += 1;
            return new Response(JSON.stringify({ id: `response-${throttledCalls}`, output_text: `Reply ${throttledCalls}` }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    };
    const throttledResults = await Promise.all([
        generateTicketAssistantReply({ userMessage: 'First message', endUserId: throttledUser }, throttledOptions),
        generateTicketAssistantReply({ userMessage: 'Second message', endUserId: throttledUser }, throttledOptions),
    ]);
    assert(throttledResults.every(result => result.status === 'ok'), 'burst messages should be serialized, not silently skipped');
    assert.equal(throttledCalls, 2, 'both serialized AI messages should reach the service');

    let bloxlinkRequestUrl = '';
    let bloxlinkRequestInit: RequestInit | undefined;
    const bloxlinkResult = await lookupBloxlinkUser('789699000047370261', '214858075650260992', {
        apiKey: 'test-key',
        fetchImpl: async (input, init) => {
            bloxlinkRequestUrl = String(input);
            bloxlinkRequestInit = init;
            return new Response('', { status: 404 });
        },
    });
    assert.equal(bloxlinkResult.status, 'not_verified');
    assert.equal(bloxlinkRequestUrl, 'https://api.blox.link/v4/public/guilds/789699000047370261/discord-to-roblox/214858075650260992');
    assert.equal(new Headers(bloxlinkRequestInit?.headers).get('authorization'), 'test-key');

    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalRuntimeBloxlinkKey = process.env.BLOXLINK_API_KEY;
    process.env.OPENAI_API_KEY = 'your_openai_api_key';
    process.env.BLOXLINK_API_KEY = 'your_bloxlink_api_key';
    assert.equal(getOpenAiApiKey(), undefined, 'OpenAI documentation placeholders must not count as configured');
    assert.equal(getBloxlinkApiKey(), undefined, 'Bloxlink documentation placeholders must not count as configured');
    const placeholderAiResult = await generateTicketAssistantReply({ userMessage: 'Can you help with my ticket?' });
    assert.equal(placeholderAiResult.status, 'unavailable');
    if (placeholderAiResult.status === 'unavailable') assert.equal(placeholderAiResult.reason, 'not_configured');
    const placeholderBloxlinkResult = await lookupBloxlinkUser('789699000047370261', '214858075650260992', {
        fetchImpl: async () => { throw new Error('A placeholder must never make an API request.'); },
    });
    assert.equal(placeholderBloxlinkResult.status, 'service_unavailable');
    if (placeholderBloxlinkResult.status === 'service_unavailable') assert.equal(placeholderBloxlinkResult.reason, 'not_configured');
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalRuntimeBloxlinkKey === undefined) delete process.env.BLOXLINK_API_KEY;
    else process.env.BLOXLINK_API_KEY = originalRuntimeBloxlinkKey;

    const mismatchedThumbnail = await lookupBloxlinkUser('789699000047370261', '214858075650260992', {
        apiKey: 'test-key',
        fetchImpl: async input => {
            const url = String(input);
            if (url.includes('api.blox.link')) {
                return new Response(JSON.stringify({ robloxID: '1113007547' }), { status: 200 });
            }
            if (url.includes('users.roblox.com')) {
                return new Response(JSON.stringify({
                    id: 1113007547,
                    name: 'VerifiedUser',
                    displayName: 'Verified User',
                    created: '2019-06-09T00:00:00.000Z',
                }), { status: 200 });
            }
            return new Response(JSON.stringify({
                data: [{ targetId: 999999, state: 'Completed', imageUrl: 'https://cdn.example/wrong-user.png' }],
            }), { status: 200 });
        },
    });
    assert.equal(mismatchedThumbnail.status, 'verified');
    assert.equal(mismatchedThumbnail.robloxAvatarUrl, null, 'a mismatched thumbnail must never be attributed to the verified user');

    const preservedRoblox = mergeRobloxRefreshResult(
        {
            status: 'verified', verified: true, robloxId: '1113007547', robloxUsername: 'VerifiedUser',
            robloxDisplayName: 'Verified User', robloxAvatarUrl: 'https://cdn.example/correct.png',
            robloxCreatedAt: '2019-06-09T00:00:00.000Z', profileUrl: 'https://www.roblox.com/users/1113007547/profile',
            verificationSource: 'Bloxlink', warnings: [],
        },
        {
            status: 'service_unavailable', verified: false, robloxId: null, robloxUsername: null,
            robloxDisplayName: null, robloxAvatarUrl: null, robloxCreatedAt: null, profileUrl: null,
            verificationSource: 'Bloxlink', reason: 'network_error', message: 'Temporarily unavailable',
        },
    );
    assert.equal(preservedRoblox.status, 'verified', 'transient refresh failures should preserve last-known verified data');
    assert.equal(preservedRoblox.robloxAvatarUrl, 'https://cdn.example/correct.png');

    const firstSnapshot: ErlcServerSnapshot = {
        name: 'CSRP', ownerId: '1', coOwnerIds: [], currentPlayers: 1, maxPlayers: 40,
        joinKey: 'CSRP', accountVerificationRequirement: null, teamBalance: true,
        players: [{ player: { raw: 'Example:123', name: 'Example', robloxId: '123' }, team: 'Civilian', permission: 'Normal', callsign: null, wantedStars: 0 }],
        commandLogs: [{ id: 'old', player: { raw: 'Staff:999', name: 'Staff', robloxId: '999' }, timestamp: 1700000000, command: ':h Welcome' }],
        joinLogs: [], fetchedAt: Date.now(),
    };
    const secondSnapshot: ErlcServerSnapshot = {
        ...firstSnapshot,
        players: [{ ...firstSnapshot.players[0], team: 'Police' }],
        commandLogs: [...firstSnapshot.commandLogs, { id: 'new', player: { raw: 'Staff:999', name: 'Staff', robloxId: '999' }, timestamp: 1700000010, command: ':ban Target' }],
    };
    const queue = [firstSnapshot, secondSnapshot];
    const commandEvents: ErlcCommandDetectedEvent[] = [];
    const teamEvents: ErlcTeamChangedEvent[] = [];
    const punishmentEvents: ErlcPunishmentCommandEvent[] = [];
    const monitor = new ErlcMonitor({
        stateStore: new MemoryErlcMonitorStateStore(),
        fetchSnapshot: async () => ({ ok: true, status: 'ok', data: queue.shift()!, rateLimit: { bucket: 'global', limit: 35, remaining: 34, resetAt: null, retryAfterMs: null }, nextRequestAt: Date.now() }),
        publisher: {
            commandDetected: async event => { commandEvents.push(event); },
            teamChanged: async event => { teamEvents.push(event); },
            punishmentDetected: async event => { punishmentEvents.push(event); },
        },
    });
    await monitor.pollNow({ force: true });
    assert.equal(commandEvents.length, 0, 'first ER:LC poll must establish baseline');
    assert.equal(teamEvents.length, 0, 'first ER:LC poll must not report team changes');
    await monitor.pollNow({ force: true });
    assert.equal(commandEvents.length, 1);
    assert.equal(teamEvents.length, 1);
    assert.equal(punishmentEvents.length, 1);

    const durableStateStore = new MemoryErlcMonitorStateStore();
    const failedDeliverySnapshots = [firstSnapshot, secondSnapshot];
    const unavailablePublisher = {
        commandDetected: async (): Promise<void> => { throw new Error('Discord unavailable'); },
        teamChanged: async (): Promise<void> => { throw new Error('Discord unavailable'); },
        punishmentDetected: async (): Promise<void> => { throw new Error('Discord unavailable'); },
    };
    const failingMonitor = new ErlcMonitor({
        stateStore: durableStateStore,
        fetchSnapshot: async () => ({
            ok: true,
            status: 'ok',
            data: failedDeliverySnapshots.shift()!,
            rateLimit: { bucket: 'global', limit: 35, remaining: 34, resetAt: null, retryAfterMs: null },
            nextRequestAt: Date.now(),
        }),
        publisher: unavailablePublisher,
    });
    await failingMonitor.pollNow({ force: true });
    await failingMonitor.pollNow({ force: true });
    assert.equal(
        failingMonitor.getState().outbox.length,
        3,
        'failed command, punishment, and team-change deliveries must remain in the durable outbox',
    );

    const recoveredDeliveries: string[] = [];
    const agedSnapshot: ErlcServerSnapshot = {
        ...secondSnapshot,
        currentPlayers: 0,
        players: [],
        commandLogs: [],
    };
    const recoveredMonitor = new ErlcMonitor({
        stateStore: durableStateStore,
        fetchSnapshot: async () => ({
            ok: true,
            status: 'ok',
            data: agedSnapshot,
            rateLimit: { bucket: 'global', limit: 35, remaining: 34, resetAt: null, retryAfterMs: null },
            nextRequestAt: Date.now(),
        }),
        publisher: {
            commandDetected: async () => { recoveredDeliveries.push('command'); },
            teamChanged: async () => { recoveredDeliveries.push('team'); },
            punishmentDetected: async () => { recoveredDeliveries.push('punishment'); },
        },
    });
    await recoveredMonitor.pollNow({ force: true });
    assert.deepEqual(
        [...recoveredDeliveries].sort(),
        ['command', 'punishment', 'team'],
        'a restarted monitor must deliver pending alerts after their source data has aged out',
    );
    assert.equal(recoveredMonitor.getState().outbox.length, 0, 'successful recovery must clear the durable outbox');

    const parsed = await fetchErlcServer({
        serverKey: 'server-key-for-test',
        fetchImpl: async () => new Response(JSON.stringify({
            Name: 'CSRP', OwnerId: 1, CoOwnerIds: [], CurrentPlayers: 1, MaxPlayers: 40,
            JoinKey: 'CSRP', TeamBalance: true,
            Players: [{ Player: 'Example:123', Team: 'Civilian', Permission: 'Normal' }],
            CommandLogs: [{ Player: 'Staff:999', Timestamp: 1700000000, Command: ':h Welcome' }],
            JoinLogs: [],
        }), { status: 200, headers: { 'x-ratelimit-limit': '35', 'x-ratelimit-remaining': '34' } }),
    });
    assert(parsed.ok && parsed.data.players[0]?.player.robloxId === '123');

    console.log(`Smoke tests passed: ${commandDefinitions.length} commands, ticket workflows, staff tools, moderation, integrations, and durable ER:LC delivery.`);
}

void run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
