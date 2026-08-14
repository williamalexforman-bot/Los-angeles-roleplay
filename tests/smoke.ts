import assert from 'node:assert/strict';
import { ChannelType, Collection, PermissionFlagsBits, TextChannel } from 'discord.js';
import { commandDefinitions } from '../src/commands/registry';
import { detectProhibitedWords, detectRaidThreat, handleMessageModeration } from '../src/events/messageModeration';
import {
    configureInfractionPersistence,
    handleStaffManagementButton,
    hasRequiredRole,
    type InfractionRecord,
} from '../src/commands/staffManagement';
import { INFRACTION_AUTHORIZED_ROLE_ID, PROMOTION_AUTHORIZED_ROLE_ID } from '../src/config/constants';
import { handleCommunityButton, handleCommunityModal } from '../src/commands/community';
import {
    handleInfractionAppealButton,
    handleInfractionAppealModal,
    setInfractionAppealClient,
} from '../src/commands/infractionAppeal';
import { handleSessionButton } from '../src/commands/session';
import { handleLoaButton } from '../src/commands/loa';
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
    assert.equal(hasRequiredRole({ roles: { cache: new Map([['1523121675007426692', { id: '1523121675007426692' }]]) } } as any, '1523121675007426692'), true, 'the infraction role should grant infraction access');
    assert.equal(hasRequiredRole({ roles: { cache: new Map([['other-role', { id: 'other-role' }]]) } } as any, '1523121675007426692'), false, 'other roles should not grant infraction access');

    const names = commandDefinitions.map(command => command.data.name);
    assert.equal(new Set(names).size, names.length, 'slash command names must be unique');
for (const required of [
        'movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint', 'training-results',
        'promotion', 'infraction', 'view-infractions', 'session-start', 'session-vote', 'session-end',
        'session-boost', 'session-full', 'prohibited-word', 'say', 'loa', 'activitycheck',
        'request-training', 'roleplay-log', 'rename',
    ]) {
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
        dm_permission?: boolean;
    };
    assert.equal(promotionSchema.dm_permission, false, '/promotion must be server-only');
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
    const promotionDms: any[] = [];
    let promotionDestinationId = '';
    const promotedMember = {
        id: '1489388257925005508',
        username: 'PromotedUser',
        tag: 'PromotedUser#0001',
        send: async (payload: any) => { promotionDms.push(payload); },
    };
    const approvedBy = { id: '1523122912201277590', username: 'Approver' };
    const oldRankRole = { id: '1523122834161926000', name: 'Staff', toString: () => '<@&1523122834161926000>' };
    const selectedRole = { id: '1523122834161926238', name: 'Senior Staff', toString: () => '<@&1523122834161926238>' };
    const promotionInteraction = {
        deferReply: async () => undefined,
        editReply: async () => undefined,
        user: { id: '1523122912201277590' },
        channelId: 'outside-promotions-channel',
        channel: {
            send: async () => { throw new Error('promotion used the invocation channel'); },
        },
        member: {
            roles: { cache: new Map([[PROMOTION_AUTHORIZED_ROLE_ID, { id: PROMOTION_AUTHORIZED_ROLE_ID }]]) },
        },
        options: {
            getSubcommand: () => 'issue',
            getUser: (name: string) => name === 'member' ? promotedMember : approvedBy,
            getRole: (name: string) => name === 'old-rank' ? oldRankRole : selectedRole,
            getString: (name: string) => ({
                'old-rank': 'Staff Member',
                reason: 'Consistent professionalism and leadership.',
                'effective-date': 'Immediately',
            } as Record<string, string>)[name] ?? null,
        },
        client: {
            channels: {
                fetch: async (channelId: string) => {
                    promotionDestinationId = channelId;
                    return {
                    isSendable: () => true,
                    send: async (payload: any) => {
                        promotionSends.push(payload);
                        return { url: 'https://discord.com/channels/guild/promotions/promotion-message' };
                    },
                    };
                },
            },
        },
    } as never;
    await commandNamed('promotion').execute(promotionInteraction);
    assert.equal(promotionDestinationId, '1526044978109743255', 'promotions must always use the canonical promotion channel');
    assert.equal(promotionSends.length, 1);
    assert.equal(promotionSends[0].flags, 32_768, 'promotions must use Components V2');
    const promotionPanel = promotionSends[0].components[0].toJSON();
    const promotionBanners = promotionPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(promotionBanners[0]?.items?.[0]?.media?.url, 'attachment://promotion-banner.png');
    assert.equal(promotionBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    assert.deepEqual(
        promotionSends[0].files.map((file: { name: string }) => file.name),
        ['promotion-banner.png', 'underbanner.webp'],
    );
    const promotionText = promotionPanel.components
        .flatMap((component: { components?: Array<{ content?: string }> }) => component.components || [])
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(promotionText.includes(`<@${promotedMember.id}>`), 'promotion post must mention the promoted member');
    assert(promotionText.includes(`<@&${selectedRole.id}>`), 'promotion post must display the selected new role');
    assert.equal(promotionDms.length, 1, 'the promoted member must receive a DM');
    assert.equal(promotionDms[0].flags, 32_768, 'the promotion DM must retain the V2 artwork panel');
    const promotionDmPanel = promotionDms[0].components[0].toJSON();
    const viewPromotionButton = promotionDmPanel.components
        .find((component: { type: number }) => component.type === 1)?.components?.[0];
    assert.equal(viewPromotionButton?.label, 'View Promotion');
    assert.equal(viewPromotionButton?.url, 'https://discord.com/channels/guild/promotions/promotion-message');

    // A pending LOA message can outlive the bot process. Approval must recover
    // its data from the still-visible Discord embed rather than claiming that
    // the untouched request was already processed after a restart.
    const loaUserId = '1489388257925005508';
    const loaPendingId = `${loaUserId}-${Date.now()}`;
    const loaStart = Math.floor((Date.now() + 60_000) / 1_000);
    const loaEnd = Math.floor((Date.now() + 86_400_000) / 1_000);
    let loaRoleAssigned = '';
    let loaRequestDeleted = false;
    const loaResultSends: any[] = [];
    const loaReviewReplies: string[] = [];
    const loaEarlyReplies: any[] = [];
    const loaMember = {
        id: loaUserId,
        user: { tag: 'LoaUser#0001', username: 'LoaUser' },
        roles: {
            add: async (roleId: string) => { loaRoleAssigned = roleId; },
            remove: async () => undefined,
        },
        send: async () => undefined,
    };
    const loaChannel = {
        isTextBased: () => true,
        isSendable: () => true,
        messages: {
            fetch: async () => ({ delete: async () => { loaRequestDeleted = true; } }),
        },
        send: async (payload: any) => { loaResultSends.push(payload); return {}; },
    };
    const recoveredLoaHandled = await handleLoaButton({
        customId: `loa:review:approve:${loaPendingId}`,
        guildId: '789699000047370261',
        user: { id: '1523122912201277590' },
        memberPermissions: { has: () => true },
        member: { roles: [] },
        message: {
            id: 'loa-request-message',
            channelId: '1528206019237515344',
            createdAt: new Date(),
            embeds: [{
                title: '📝 LOA Request Submitted',
                fields: [
                    { name: 'Requested By', value: `<@${loaUserId}>` },
                    { name: 'Name', value: 'Loa User' },
                    { name: 'Start Date', value: `<t:${loaStart}:F>` },
                    { name: 'End Date', value: `<t:${loaEnd}:F>` },
                    { name: 'Reason', value: 'Temporary leave request.' },
                    { name: 'Submitted At', value: `<t:${Math.floor(Date.now() / 1_000)}:F>` },
                ],
            }],
        },
        client: {
            guilds: {
                fetch: async () => ({ members: { fetch: async () => loaMember } }),
            },
            channels: { fetch: async () => loaChannel },
        },
        reply: async (payload: any) => { loaEarlyReplies.push(payload); },
        deferReply: async () => undefined,
        editReply: async (content: string) => { loaReviewReplies.push(content); },
    } as never);
    assert(recoveredLoaHandled);
    assert.equal(loaEarlyReplies.length, 0, 'a recoverable pending LOA must not be reported as already processed');
    assert.equal(loaRoleAssigned, '1521593407795888329', 'approving a recovered LOA must assign the LOA role');
    assert(loaRequestDeleted, 'the original request should be deleted only after approval completes');
    assert.equal(loaResultSends.length, 1, 'the approved LOA result must be posted once');
    assert(loaReviewReplies.some(reply => reply.includes('approved')));

    let savedInfraction: InfractionRecord | null = null;
    configureInfractionPersistence({
        nextCaseNumber: async () => 1,
        saveInfraction: async record => { savedInfraction = record; },
        getInfractionByThreadId: async () => savedInfraction,
    });
    const infractionParentSends: any[] = [];
    const infractionDms: any[] = [];
    const infractionTarget = {
        id: '1489388257925005508',
        username: 'ExampleUser',
        send: async (payload: any) => { infractionDms.push(payload); },
    };
    let attachedThreadOptions: any = null;
    let infractionDetailEdit: any = null;
    const infractionThread = {
        id: '1526044664975851999',
        url: 'https://discord.com/channels/guild/1526044664975851999',
        guild: {
            members: { fetch: async () => new Map() },
            roles: { fetch: async () => null },
        },
        send: async () => ({ id: '1526044664975852000' }),
        delete: async () => undefined,
    };
    const infractionParent = Object.create(TextChannel.prototype) as any;
    Object.defineProperties(infractionParent, {
        id: { value: '1526044664975851642' },
        type: { value: ChannelType.GuildText },
        threads: {
            value: {
                create: async (options: any) => {
                    attachedThreadOptions = options;
                    return infractionThread;
                },
            },
        },
        send: {
            value: async (payload: any) => {
                infractionParentSends.push(payload);
                return {
                    id: '1526044664975851777',
                    url: 'https://discord.com/channels/guild/1526044664975851642/1526044664975851777',
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
        member: {
            roles: { cache: new Map([[INFRACTION_AUTHORIZED_ROLE_ID, { id: INFRACTION_AUTHORIZED_ROLE_ID }]]) },
        },
        options: {
            getSubcommand: () => 'issue',
            getUser: () => infractionTarget,
            getString: (name: string) => ({
                action: 'Warning',
                reason: 'Repeated policy violation.',
                notes: 'Staff Conduct 2.1',
                evidence: 'https://evidence.example/case',
                'internal-notes': 'Management review complete.',
                expiration: '30 days',
                appealable: 'true',
            } as Record<string, string>)[name] ?? null,
            getBoolean: () => null,
        },
        client: { channels: { fetch: async () => infractionParent } },
    } as never;
    await commandNamed('infraction').execute(infractionInteraction);
    assert(attachedThreadOptions, 'the infraction should receive a standalone evidence thread');
    assert.equal(attachedThreadOptions.name, 'INF-0001 | ExampleUser | Warning');
    assert.equal(infractionParentSends.length, 1, 'the complete infraction embed should be sent to the parent channel');
    assert((savedInfraction as InfractionRecord | null)?.threadId === infractionThread.id);
    assert.equal(infractionParentSends[0].flags, 32_768, 'an infraction must use the Components V2 panel layout');
    const initialInfractionPanel = infractionParentSends[0].components[0].toJSON();
    assert.equal(initialInfractionPanel.type, 17, 'the infraction must be inside one blue-accented container');
    assert.equal(initialInfractionPanel.accent_color, 0x3b82f6, 'the infraction panel must use a blue side rail');
    const initialBanners = initialInfractionPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(initialBanners[0]?.items?.[0]?.media?.url, 'attachment://infraction-banner.png');
    assert.equal(initialBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    assert.deepEqual(
        infractionParentSends[0].files.map((file: { name: string }) => file.name),
        ['infraction-banner.png', 'underbanner.webp'],
        'the case message must attach both infraction artwork files',
    );
    const initialAppealButton = initialInfractionPanel.components
        .find((component: { type: number; components?: Array<{ custom_id?: string }> }) => component.type === 1
            && component.components?.[0]?.custom_id?.startsWith('infraction-appeal:start:'))
        ?.components?.[0];
    assert.equal(initialAppealButton?.custom_id, 'infraction-appeal:start:INF-0001', 'the first case message must already contain its Appeal button');
    assert.equal(infractionDetailEdit, null, 'the V2 case message must not be edited after its first send');
    const infractionPanel = initialInfractionPanel;
    const punishmentBadge = infractionPanel?.components?.find((component: { type: number }) => component.type === 9)?.accessory;
    const appealButton = infractionPanel?.components
        ?.find((component: { type: number; components?: Array<{ custom_id?: string }> }) => component.type === 1
            && component.components?.[0]?.custom_id?.startsWith('infraction-appeal:start:'))
        ?.components?.[0];
    assert.equal(punishmentBadge?.label, 'Staff Warning #1');
    assert.equal(punishmentBadge?.disabled, true, 'the punishment badge is visual-only');
    assert.equal(appealButton?.custom_id, 'infraction-appeal:start:INF-0001');
    assert.notEqual(appealButton?.disabled, true, 'appealable cases must expose a working appeal button');
    assert.equal(infractionDms.length, 1, 'the infracted member must receive a DM by default');
    const infractionDmButtons = infractionDms[0].components[0].toJSON().components;
    assert.equal(infractionDmButtons[0]?.label, 'Open Infraction Channel');
    assert.equal(infractionDmButtons[0]?.url, infractionThread.url);
    assert.equal(infractionDmButtons[1]?.custom_id, 'infraction-appeal:start:INF-0001');
    assert(infractionReplies.some(reply => String(reply).includes('INF-0001 has been issued successfully')));

    let fallbackInfraction: InfractionRecord | null = null;
    configureInfractionPersistence({
        nextCaseNumber: async () => 2,
        saveInfraction: async record => { fallbackInfraction = record; },
        getInfractionByThreadId: async key => key === 'INF-0002' ? fallbackInfraction : null,
    });
    let fallbackPanelPayload: any = null;
    let fallbackMessageDeleted = false;
    const fallbackParent = Object.create(TextChannel.prototype) as any;
    Object.defineProperties(fallbackParent, {
        id: { value: '1526044664975851642' },
        type: { value: ChannelType.GuildText },
        isSendable: { value: () => true },
        threads: {
            value: {
                create: async () => { throw new Error('Missing Create Public Threads'); },
            },
        },
        send: {
            value: async (payload: any) => {
                fallbackPanelPayload = payload;
                return {
                    id: '1526044664975851888',
                    url: 'https://discord.com/channels/guild/1526044664975851642/1526044664975851888',
                    delete: async () => { fallbackMessageDeleted = true; },
                };
            },
        },
    });
    const fallbackReplies: string[] = [];
    await commandNamed('infraction').execute({
        guildId: '789699000047370261',
        guild: { ownerId: 'fallback-issuer' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { fallbackReplies.push(content); },
        user: { id: 'fallback-issuer' },
        memberPermissions: { has: () => true },
        options: {
            getSubcommand: () => 'issue',
            getUser: () => ({ id: 'fallback-member', username: 'FallbackMember' }),
            getString: (name: string) => ({
                action: 'Warning',
                reason: 'Fallback test.',
                notes: 'Staff Conduct 2.1',
                appealable: 'true',
            } as Record<string, string>)[name] ?? null,
            getBoolean: () => false,
        },
        client: { channels: { fetch: async () => fallbackParent } },
    } as never);
    assert(!fallbackMessageDeleted, 'a missing thread permission must not delete the issued infraction');
    assert.equal((fallbackInfraction as InfractionRecord | null)?.threadId, '1526044664975851888');
    const fallbackPanel = fallbackPanelPayload.components[0].toJSON();
    const fallbackAppealButton = fallbackPanel.components
        .find((component: { type: number; components?: Array<{ custom_id?: string }> }) => component.type === 1
            && component.components?.[0]?.custom_id?.startsWith('infraction-appeal:start:'))
        ?.components?.[0];
    assert.equal(fallbackAppealButton?.custom_id, 'infraction-appeal:start:INF-0002');
    assert(fallbackReplies.some(reply => reply.includes('INF-0002 has been issued successfully')));
    assert(!fallbackReplies.some(reply => reply.includes('Unable to create')));

    let viewInfractionsPayload: any = null;
    let viewInfractionsLoadingDeleted = false;
    await commandNamed('view-infractions').execute({
        guildId: '789699000047370261',
        user: infractionTarget,
        options: { getUser: () => infractionTarget },
        deferred: false,
        replied: false,
        reply: async (payload: any) => { viewInfractionsPayload = payload; },
        followUp: async () => { throw new Error('successful view must not use a follow-up'); },
        deleteReply: async () => { viewInfractionsLoadingDeleted = true; },
    } as never);
    assert.equal(viewInfractionsPayload?.flags, 32_768, '/view-infractions must use Components V2');
    const viewInfractionsPanel = viewInfractionsPayload.components[0].toJSON();
    const viewInfractionBanners = viewInfractionsPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(viewInfractionBanners[0]?.items?.[0]?.media?.url, 'attachment://infraction-banner.png');
    assert.equal(viewInfractionBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    const viewInfractionText = viewInfractionsPanel.components
        .flatMap((component: { components?: Array<{ content?: string }> }) => component.components || [])
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(viewInfractionText.includes('INF-0001'));
    assert(viewInfractionText.includes('Open Infraction Channel'));
    assert(!viewInfractionsLoadingDeleted, 'the public V2 panel must never be deleted as loading-response cleanup');

    const sessionBannerNames = new Map([
        ['session-start', 'session-start-banner.png'],
        ['session-vote', 'session-vote-banner.png'],
        ['session-end', 'session-end-banner.png'],
        ['session-boost', 'session-boost-banner.png'],
        ['session-full', 'session-full-banner.png'],
    ]);
    let deletedSessionMessages = 0;
    let sessionVotePayload: any = null;
    for (const [commandName, bannerName] of sessionBannerNames) {
        const sessionSchema = commandNamed(commandName).data.toJSON() as {
            default_member_permissions?: string | null;
            dm_permission?: boolean;
        };
        assert.equal(sessionSchema.default_member_permissions, null, `/${commandName} must be enabled for server members`);
        assert.equal(sessionSchema.dm_permission, false, `/${commandName} must be server-only`);
        let sessionPayload: any = null;
        let fetchedSessionChannelId = '';
        const priorMessages = new Collection<string, any>();
        if (commandName === 'session-end') {
            priorMessages.set('old-session-message', {
                author: { id: 'session-bot' },
                components: [],
                embeds: [{ title: 'SESSION START' }],
                attachments: new Collection(),
                delete: async () => { deletedSessionMessages += 1; },
            });
            priorMessages.set('unrelated-bot-message', {
                author: { id: 'session-bot' },
                components: [],
                embeds: [{ title: 'Rules' }],
                attachments: new Collection(),
                delete: async () => { throw new Error('unrelated message must not be deleted'); },
            });
        }
        const sessionDestination = {
            id: '1526036392147423404',
            isSendable: () => true,
            messages: { fetch: async () => priorMessages },
            send: async (payload: any) => {
                sessionPayload = payload;
                return { id: `${commandName}-message` };
            },
        };
        await commandNamed(commandName).execute({
            guildId: '789699000047370261',
            channelId: 'wrong-command-channel',
            user: { id: 'session-host' },
            options: { getInteger: () => 5 },
            channel: {
                isSendable: () => true,
                send: async () => { throw new Error('session command used the invocation channel'); },
            },
            client: {
                user: { id: 'session-bot' },
                channels: {
                    fetch: async (channelId: string) => {
                        fetchedSessionChannelId = channelId;
                        return sessionDestination;
                    },
                },
            },
            deferReply: async () => undefined,
            editReply: async () => undefined,
        } as never);
        assert.equal(fetchedSessionChannelId, '1526036392147423404');
        assert.equal(sessionPayload?.flags, 32_768, `/${commandName} must use Components V2`);
        const sessionPanel = sessionPayload.components[0].toJSON();
        assert.equal(sessionPanel.type, 17, `/${commandName} must serialize as a V2 container`);
        assert.equal(sessionPanel.accent_color, 0x3b82f6);
        const expectedComponentOrder = commandName === 'session-full'
            ? [12, 14, 9, 14, 12]
            : [12, 14, 9, 1, 14, 12];
        assert.deepEqual(
            sessionPanel.components.map((component: { type: number }) => component.type),
            expectedComponentOrder,
            `/${commandName} must render top banner, details/buttons, then underbanner`,
        );
        assert.equal(sessionPanel.components[0]?.items?.[0]?.media?.url, `attachment://${bannerName}`);
        assert.equal(sessionPanel.components.at(-1)?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
        assert.deepEqual(
            sessionPayload.files.map((file: { name: string }) => file.name),
            [bannerName, 'underbanner.webp'],
        );
        if (commandName === 'session-vote') sessionVotePayload = sessionPayload;
    }
    assert.equal(deletedSessionMessages, 1, '/session-end must delete prior bot session announcements only');

    let sessionVoteEdit: any = null;
    const sessionVoteReplies: string[] = [];
    await handleSessionButton({
        customId: 'session:vote:cast:5',
        guildId: '789699000047370261',
        channelId: 'session-channel',
        user: { id: 'session-voter' },
        message: {
            id: 'session-vote-message',
            editable: true,
            attachments: new Map([
                ['session-vote-banner', { id: 'session-vote-banner' }],
                ['underbanner', { id: 'underbanner' }],
            ]),
            components: sessionVotePayload.components,
            edit: async (payload: any) => { sessionVoteEdit = payload; },
        },
        deferReply: async () => undefined,
        editReply: async (content: string) => { sessionVoteReplies.push(content); },
    } as never);
    assert.equal(sessionVoteEdit?.attachments?.length, 2, 'vote updates must retain both V2 banner attachments');
    assert(sessionVoteReplies.some(reply => reply.includes('1/5')));

    let appealModal: any = null;
    const appealStartHandled = await handleInfractionAppealButton({
        customId: 'infraction-appeal:start:INF-0001',
        client: { channels: { fetch: async () => null } },
        guildId: '789699000047370261',
        user: infractionTarget,
        showModal: async (modal: any) => { appealModal = modal; },
    } as never);
    assert(appealStartHandled);
    assert.equal(appealModal?.toJSON().custom_id, 'infraction-appeal:form:INF-0001');

    const unauthorizedAppealReplies: any[] = [];
    await handleInfractionAppealButton({
        customId: 'infraction-appeal:start:INF-0001',
        client: { channels: { fetch: async () => null } },
        guildId: '789699000047370261',
        user: { id: 'different-member' },
        reply: async (payload: any) => { unauthorizedAppealReplies.push(payload); },
    } as never);
    assert(unauthorizedAppealReplies.some(reply => reply.content.includes('Only the member')));

    let appealReviewPayload: any = null;
    let appealReviewEdit: any = null;
    const approvedAppealDms: any[] = [];
    const sourceAppealNotices: any[] = [];
    const appealSourceThread = {
        id: infractionThread.id,
        url: infractionThread.url,
        archived: false,
        locked: false,
        parent: null,
        parentId: '1526044664975851642',
        isThread: () => true,
        isSendable: () => true,
        send: async (payload: any) => { sourceAppealNotices.push(payload); return {}; },
        setArchived: async () => undefined,
    };
    const appealReviewChannel = {
        isThread: () => false,
        isSendable: () => true,
        send: async (payload: any) => {
            appealReviewPayload = payload;
            return { id: 'appeal-review-message' };
        },
        messages: {
            fetch: async () => ({ edit: async (payload: any) => { appealReviewEdit = payload; } }),
        },
    };
    const appealClient = {
        channels: {
            fetch: async (channelId: string) => channelId === infractionThread.id
                ? appealSourceThread
                : appealReviewChannel,
        },
        users: {
            fetch: async () => ({ send: async (payload: any) => { approvedAppealDms.push(payload); } }),
        },
    };
    setInfractionAppealClient(appealClient as never);

    const appealSubmissionReplies: string[] = [];
    await handleInfractionAppealModal({
        customId: 'infraction-appeal:form:INF-0001',
        client: appealClient,
        guildId: '789699000047370261',
        user: infractionTarget,
        fields: {
            getTextInputValue: (name: string) => ({
                'discord-username': 'ExampleUser',
                'roblox-username': 'ExampleRoblox',
                'appeal-reason': 'I understand why the warning was issued. I will follow the rules going forward.',
                'will-repeat': 'NO',
            } as Record<string, string>)[name],
        },
        deferReply: async () => undefined,
        editReply: async (content: string) => { appealSubmissionReplies.push(content); },
    } as never);
    const approveButtonId = appealReviewPayload.components[0].toJSON().components[0].custom_id as string;
    const appealId = approveButtonId.split(':')[2];
    assert(appealSubmissionReplies.some(reply => reply.includes(appealId)));

    const appealReviewReplies: string[] = [];
    await handleInfractionAppealModal({
        customId: `infraction-appeal:approve-modal:${appealId}`,
        client: appealClient,
        guildId: '789699000047370261',
        guild: { ownerId: 'appeal-reviewer' },
        user: { id: 'appeal-reviewer' },
        fields: { getTextInputValue: () => 'The member demonstrated accountability.' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { appealReviewReplies.push(content); },
    } as never);
    assert.equal(approvedAppealDms.length, 1, 'approved appeals must DM the affected member');
    assert.equal(sourceAppealNotices.length, 1, 'approved appeals must update the source infraction channel');
    assert.equal(sourceAppealNotices[0].embeds[0].toJSON().title, '✅ Infraction Appealed');
    assert(appealReviewEdit, 'the staff review message must be updated after a decision');
    assert(appealReviewReplies.some(reply => reply.includes('infraction channel was updated')));
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
