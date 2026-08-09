import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits, TextChannel } from 'discord.js';
import { commandDefinitions } from '../src/commands/registry';
import { detectProhibitedWords, detectRaidThreat, handleMessageModeration } from '../src/events/messageModeration';
import {
    configureInfractionPersistence,
    handleStaffManagementButton,
    type InfractionRecord,
} from '../src/commands/staffManagement';
import { handleCommunityButton, handleCommunityModal } from '../src/commands/community';
import { interactionCreate } from '../src/handlers/interactionCreate';
import { sanitizedCommandOptions } from '../src/utils/commandAudit';
import { fetchErlcServer, type ErlcServerSnapshot } from '../src/services/erlcService';
import {
    ErlcMonitor,
    MemoryErlcMonitorStateStore,
    type ErlcCommandDetectedEvent,
    type ErlcPunishmentCommandEvent,
    type ErlcTeamChangedEvent,
} from '../src/monitors/erlcMonitor';

async function run(): Promise<void> {
    const names = commandDefinitions.map(command => command.data.name);
    assert.equal(new Set(names).size, names.length, 'slash command names must be unique');
for (const required of ['movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint', 'training-results', 'promotion', 'infraction', 'prohibited-word', 'say', 'loa', 'activitycheck', 'request-training', 'roleplay-log', 'rename']) {
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

    const renameSchema = commandNamed('rename').data.toJSON() as {
        name: string;
        options: Array<{ name: string; required?: boolean; max_length?: number }>;
        default_member_permissions?: string;
    };
    assert.deepEqual(renameSchema.options.map(option => option.name), ['name', 'channel']);
    assert(renameSchema.options.find(option => option.name === 'name')?.required, '/rename name must be required');
    assert(renameSchema.options.find(option => option.name === 'name')?.max_length === 100);
    assert(BigInt(renameSchema.default_member_permissions || '0') & PermissionFlagsBits.ManageChannels, '/rename must require Manage Channels');

    const partnershipSchema = commandNamed('partnership').data.toJSON() as {
        options: Array<{ name: string; options?: Array<{ name: string }> }>;
    };
    assert.deepEqual(partnershipSchema.options.map(option => option.name), ['request']);

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
            getString: () => 'The staff member acted unprofessionally.',
        },
        user: { id: 'complainant', tag: 'Complainant#0001' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { complaintReplies.push(content); },
    } as never);
    assert.equal(complaintSubmission?.embeds?.[0]?.data?.title, '📋 Staff Complaint Received');
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
    for (const optionName of ['member', 'action', 'reason', 'notes', 'evidence', 'internal-notes', 'notify-member', 'expiration']) {
        assert(issueOptions.some(option => option.name === optionName), `missing /infraction issue ${optionName}`);
    }

    const promotionSchema = commandNamed('promotion').data.toJSON() as {
        options: Array<{ name: string; options?: Array<{ name: string; type: number }> }>;
    };
    const promotionIssueOptions = promotionSchema.options.find(option => option.name === 'issue')?.options || [];
    const promotionRoleOption = promotionIssueOptions.find(option => option.name === 'new-role');
    assert.equal(promotionRoleOption?.type, 8, '/promotion issue new-role must use Discord\'s server-role selector');

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

    const originalBotPermissionsRole = process.env.BOT_PERMISSIONS_ROLE_ID;
    process.env.BOT_PERMISSIONS_ROLE_ID = 'say-authorized-role';
    const sayPayloads: any[] = [];
    const sayConfirmations: unknown[] = [];
    const exactSayMessage = '**CSRP Announcement**\n@everyone <@1489388257925005508> Please review the update.';
    const sayTarget = {
        id: 'say-target-channel',
        isTextBased: () => true,
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
        inGuild: () => false,
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
    assert(moviePublic.fields.some((field: any) => field.name === '⭐ Rating' && field.value === `${'⭐'.repeat(8)}\n**8/10**`));
    assert(moviePublic.footer.text.includes('Submitted by therealstickyz_35430'));
    assert(movieAudit.fields.some((field: any) => field.name === 'Discord ID' && field.value === '1489388257925005508'));

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

    const promotionSends: any[] = [];
    const promotedMember = { id: '1489388257925005508', username: 'PromotedUser', send: async () => undefined };
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
    const promotionFields = promotionSends[0].embeds[0].toJSON().fields;
    assert(promotionFields.some((field: any) => field.name === 'New Role' && field.value === `<@&${selectedRole.id}>`));

    let savedInfraction: InfractionRecord | null = null;
    configureInfractionPersistence({
        nextCaseNumber: async () => 1,
        saveInfraction: async record => { savedInfraction = record; },
        getInfractionByThreadId: async () => savedInfraction,
    });
    const infractionParentSends: any[] = [];
    let attachedThreadOptions: any = null;
    const infractionThread = {
        id: '1526044664975851999',
        url: 'https://discord.com/channels/guild/1526044664975851999',
        guild: {
            members: { fetch: async () => new Map() },
            roles: { fetch: async () => null },
        },
        send: async () => ({ id: '1526044664975852000' }),
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
                    edit: async () => ({}),
                    delete: async () => undefined,
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
                notes: 'Staff Conduct 2.1',
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
    assert.equal(infractionParentSends.length, 1, 'the complete infraction embed should be sent to the parent channel');
    assert((savedInfraction as InfractionRecord | null)?.threadId === infractionThread.id);
    assert(infractionReplies.some(reply => String(reply).includes('INF-0001 was created successfully')));
    configureInfractionPersistence(null);

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
        content: "We're going to raid this Discord server right now. This is ass.",
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
    if (originalEmergencyRole === undefined) delete process.env.EMERGENCY_STAFF_ROLE_ID;
    else process.env.EMERGENCY_STAFF_ROLE_ID = originalEmergencyRole;

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
    await monitor.pollNow({ force: true });
    assert.equal(commandEvents.length, 1);
    assert.equal(teamEvents.length, 1);
    assert.equal(punishmentEvents.length, 1);

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

    console.log(`Smoke tests passed: ${commandDefinitions.length} commands, staff tools, moderation, integrations, and durable ER:LC delivery.`);
}

void run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
