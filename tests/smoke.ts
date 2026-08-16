import assert from 'node:assert/strict';
import { ChannelType, Collection, PermissionFlagsBits, TextChannel } from 'discord.js';
import { commandDefinitions } from '../src/commands/registry';
import { staffCommands } from '../src/commands/staff';
import { detectProhibitedWords, detectRaidThreat, handleMessageModeration } from '../src/events/messageModeration';
import {
    configureInfractionPersistence,
    handleStaffManagementButton,
    hasRequiredRole,
    issueAutomaticInfraction,
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
import { handleTicketButton, handleTicketModal, handleTicketSelect } from '../src/commands/tickets';
import {
    APPLICATION_APPROVAL_ROLE_IDS,
    analyzeApplicationAi,
    clearApplicationSessionCache,
    configureApplicationSessionPersistence,
    handleApplicationButton,
    handleApplicationDmMessage,
    handleApplicationModal,
    handleApplicationSelect,
    type ApplicationSession,
} from '../src/commands/applications';
import { handleLoaButton } from '../src/commands/loa';
import { interactionCreate } from '../src/handlers/interactionCreate';
import {
    ACTIVE_SHIFT_ROLE_ID,
    clearShiftMemory,
    isShiftInfractionExempt,
    SHIFT_BREAK_ROLE_ID,
    SHIFT_INFRACTION_EXEMPT_ROLE_IDS,
    SHIFT_QUOTA_BY_ROLE_ID,
    runDueShiftQuotaEvaluation,
    shiftQuotaBoundary,
    shiftQuotaSecondsForRoleIds,
    shiftQuotaWeekKey,
} from '../src/commands/shift';
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
    assert.deepEqual(
        staffCommands.map(command => command.data.name),
        ['application', 'training'],
        'legacy staff commands must not expose old embed-based infraction or promotion paths',
    );
    assert.equal(hasRequiredRole({ roles: { cache: new Map([['1523121675007426692', { id: '1523121675007426692' }]]) } } as any, '1523121675007426692'), true, 'the infraction role should grant infraction access');
    assert.equal(hasRequiredRole({ roles: { cache: new Map([['other-role', { id: 'other-role' }]]) } } as any, '1523121675007426692'), false, 'other roles should not grant infraction access');

    const names = commandDefinitions.map(command => command.data.name);
    assert.equal(new Set(names).size, names.length, 'slash command names must be unique');
for (const required of [
        'movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint', 'training-results',
        'promotion', 'infraction', 'view-infractions', 'session-start', 'session-vote', 'session-end',
        'session-boost', 'session-full', 'prohibited-word', 'say', 'loa', 'activitycheck',
        'request-training', 'roleplay-log', 'rename', 'ticket', 'ticket-panel', 'ticketpanel', 'close', 'closerequest',
        'applications-panel', 'unclaim', 'role', 'shift',
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

    const roleSchema = commandNamed('role').data.toJSON() as {
        options: Array<{ name: string; options?: Array<{ name: string }> }>;
        default_member_permissions?: string;
    };
    assert.deepEqual(roleSchema.options.map(option => option.name), ['add', 'all']);
    assert.deepEqual(roleSchema.options.find(option => option.name === 'add')?.options?.map(option => option.name), ['member', 'role']);
    assert.deepEqual(roleSchema.options.find(option => option.name === 'all')?.options?.map(option => option.name), ['role']);
    assert(BigInt(roleSchema.default_member_permissions || '0') & PermissionFlagsBits.ManageRoles,
        '/role must require Manage Roles');

    const assignableRole = { id: 'assignable-role', name: 'Community Member', managed: false, editable: true };
    const individualRoleAdds: string[] = [];
    let individualRoleReply: any = null;
    await commandNamed('role').execute({
        guildId: 'role-guild',
        guild: {
            ownerId: 'server-owner',
            roles: { fetch: async () => assignableRole },
            members: {
                fetch: async () => ({
                    id: 'role-target',
                    roles: {
                        cache: new Map(),
                        add: async (role: { id: string }) => { individualRoleAdds.push(role.id); },
                    },
                }),
            },
        },
        user: { id: 'role-admin' },
        memberPermissions: { has: (permission: bigint) => permission === PermissionFlagsBits.Administrator },
        options: {
            getSubcommand: () => 'add',
            getRole: () => assignableRole,
            getUser: () => ({ id: 'role-target', username: 'RoleTarget' }),
        },
        deferReply: async () => undefined,
        editReply: async (payload: any) => { individualRoleReply = payload; },
    } as never);
    assert.deepEqual(individualRoleAdds, ['assignable-role']);
    assert(String(individualRoleReply?.content || individualRoleReply).includes('Added'));

    const massRoleAdds: string[] = [];
    let massRoleReply: any = null;
    const massMembers = new Collection<string, any>([
        ['human-needs-role', {
            id: 'human-needs-role',
            user: { bot: false },
            roles: { cache: new Map(), add: async () => { massRoleAdds.push('human-needs-role'); } },
        }],
        ['human-has-role', {
            id: 'human-has-role',
            user: { bot: false },
            roles: { cache: new Map([['assignable-role', assignableRole]]), add: async () => undefined },
        }],
        ['bot-member', {
            id: 'bot-member',
            user: { bot: true },
            roles: { cache: new Map(), add: async () => { throw new Error('bots must be skipped'); } },
        }],
    ]);
    await interactionCreate({
        commandName: 'role',
        guildId: 'role-guild',
        guild: {
            ownerId: 'server-owner',
            roles: { fetch: async () => assignableRole },
            members: { fetch: async () => massMembers },
        },
        user: { id: 'role-admin' },
        memberPermissions: { has: () => true },
        options: { getSubcommand: () => 'all', getRole: () => assignableRole },
        isButton: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => true,
        isRepliable: () => true,
        deferReply: async () => undefined,
        editReply: async (payload: any) => { massRoleReply = payload; },
        reply: async (payload: any) => { massRoleReply = payload; },
    } as never);
    assert.deepEqual(massRoleAdds, ['human-needs-role']);
    const massRoleText = String(massRoleReply?.content || massRoleReply);
    assert(massRoleText.includes('Assigned:** 1'));
    assert(massRoleText.includes('Already had role:** 1'));
    assert(massRoleText.includes('Bots skipped:** 1'));
    assert(!massRoleText.includes('not currently available'), '/role all must route to its handler');

    const shiftSchema = commandNamed('shift').data.toJSON() as {
        options: Array<{ name: string; options?: Array<{ name: string }> }>;
    };
    assert.deepEqual(shiftSchema.options.map(option => option.name), ['start', 'break', 'leaderboard', 'manage', 'end']);
    assert.deepEqual(
        shiftSchema.options.find(option => option.name === 'manage')?.options?.map(option => option.name),
        ['action', 'member', 'reason', 'minutes'],
    );
    assert.equal(SHIFT_QUOTA_BY_ROLE_ID['1521593407795888336'], 7_200);
    assert.equal(SHIFT_QUOTA_BY_ROLE_ID['1521593407816990819'], 5_400);
    assert.equal(SHIFT_QUOTA_BY_ROLE_ID['1521593407833640981'], 4_500);
    assert.equal(SHIFT_QUOTA_BY_ROLE_ID['1523111129696702584'], 3_600);
    assert.equal(SHIFT_QUOTA_BY_ROLE_ID['1521593407833640986'], 2_700);
    assert.equal(SHIFT_QUOTA_BY_ROLE_ID['1521598108226818288'], 1_800);
    assert.deepEqual(
        SHIFT_INFRACTION_EXEMPT_ROLE_IDS,
        ['1521593407850680401', '1521593407795888329'],
    );
    assert(isShiftInfractionExempt(['1521593407850680401']));
    assert(isShiftInfractionExempt(['1521593407795888329']));
    assert(!isShiftInfractionExempt(['1521593407795888336']));
    assert.equal(
        shiftQuotaSecondsForRoleIds(['1523111129696702584', '1521593407795888336']),
        7_200,
        'members with multiple quota roles must receive the highest requirement',
    );
    assert.equal(shiftQuotaBoundary(new Date('2026-01-09T15:00:00.000Z')).toISOString(), '2026-01-09T15:00:00.000Z');
    assert.equal(shiftQuotaBoundary(new Date('2026-08-14T14:00:00.000Z')).toISOString(), '2026-08-14T14:00:00.000Z');
    assert.equal(shiftQuotaWeekKey(new Date('2026-08-14T13:59:59.000Z')), '2026-08-07');

    clearShiftMemory();
    const shiftMemberRole = { id: '1521593407795888336' };
    const shiftTargetDms: any[] = [];
    const shiftTarget = {
        id: 'shift-target',
        username: 'ShiftTarget',
        send: async (payload: any) => { shiftTargetDms.push(payload); },
    };
    const shiftRoleEvents: string[] = [];
    const shiftRoleCache = new Map([[shiftMemberRole.id, shiftMemberRole]]);
    const shiftGuildMember = {
        id: shiftTarget.id,
        user: shiftTarget,
        roles: {
            cache: shiftRoleCache,
            add: async (roleId: string) => {
                shiftRoleEvents.push(`add:${roleId}`);
                shiftRoleCache.set(roleId, { id: roleId });
            },
            remove: async (roleId: string) => {
                shiftRoleEvents.push(`remove:${roleId}`);
                shiftRoleCache.delete(roleId);
            },
        },
        displayName: 'ShiftTarget',
    };
    const shiftMemberCollection = new Collection<string, any>([[shiftTarget.id, shiftGuildMember]]);
    const shiftGuild = {
        ownerId: 'shift-manager',
        members: {
            cache: shiftMemberCollection,
            fetch: async (memberId?: string) => memberId ? shiftGuildMember : shiftMemberCollection,
        },
    };
    const shiftStartReplies: string[] = [];
    await interactionCreate({
        commandName: 'shift',
        guildId: 'shift-guild',
        guild: shiftGuild,
        member: shiftGuildMember,
        user: shiftTarget,
        options: { getSubcommand: () => 'start' },
        isButton: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => true,
        isRepliable: () => true,
        deferReply: async () => undefined,
        editReply: async (payload: string) => { shiftStartReplies.push(payload); },
        reply: async (payload: string) => { shiftStartReplies.push(payload); },
    } as never);
    assert(shiftStartReplies.some(reply => reply.includes('weekly quota is **2h**')));
    assert(shiftRoleCache.has(ACTIVE_SHIFT_ROLE_ID), '/shift start must add the active-shift role');
    assert(!shiftRoleCache.has(SHIFT_BREAK_ROLE_ID));

    const shiftBreakReplies: string[] = [];
    await commandNamed('shift').execute({
        guildId: 'shift-guild',
        guild: shiftGuild,
        member: shiftGuildMember,
        user: shiftTarget,
        options: { getSubcommand: () => 'break' },
        deferReply: async () => undefined,
        editReply: async (payload: string) => { shiftBreakReplies.push(payload); },
    } as never);
    assert(shiftBreakReplies.some(reply => reply.includes('shift is paused')));
    assert(!shiftRoleCache.has(ACTIVE_SHIFT_ROLE_ID), 'starting a break must remove the active-shift role');
    assert(shiftRoleCache.has(SHIFT_BREAK_ROLE_ID), 'starting a break must add the shift-break role');

    await commandNamed('shift').execute({
        guildId: 'shift-guild',
        guild: shiftGuild,
        member: shiftGuildMember,
        user: shiftTarget,
        options: { getSubcommand: () => 'break' },
        deferReply: async () => undefined,
        editReply: async (payload: string) => { shiftBreakReplies.push(payload); },
    } as never);
    assert(shiftBreakReplies.some(reply => reply.includes('shift resumed')));
    assert(shiftRoleCache.has(ACTIVE_SHIFT_ROLE_ID), 'resuming must restore the active-shift role');
    assert(!shiftRoleCache.has(SHIFT_BREAK_ROLE_ID), 'resuming must remove the shift-break role');

    const shiftManageReplies: string[] = [];
    await commandNamed('shift').execute({
        guildId: 'shift-guild',
        guild: shiftGuild,
        member: { roles: { cache: new Map() } },
        memberPermissions: { has: () => true },
        user: { id: 'shift-manager', username: 'ShiftManager' },
        options: {
            getSubcommand: () => 'manage',
            getString: (name: string) => name === 'action' ? 'add-time' : 'Quota test adjustment',
            getUser: () => shiftTarget,
            getInteger: () => 120,
        },
        deferReply: async () => undefined,
        editReply: async (payload: string) => { shiftManageReplies.push(payload); },
    } as never);
    assert(shiftManageReplies.some(reply => reply.includes('Weekly total:** 2h / 2h')));
    assert.equal(shiftTargetDms.length, 1, 'completing quota through shift management must send the member a DM');
    assert.equal(shiftTargetDms[0].flags, 32_768, 'the shift quota completion DM must use Components V2');

    let shiftLeaderboardPayload: any = null;
    await commandNamed('shift').execute({
        guildId: 'shift-guild',
        guild: shiftGuild,
        user: shiftTarget,
        options: { getSubcommand: () => 'leaderboard' },
        deferReply: async () => undefined,
        editReply: async (payload: any) => { shiftLeaderboardPayload = payload; },
    } as never);
    const shiftLeaderboardEmbed = shiftLeaderboardPayload.embeds[0].toJSON();
    assert.equal(shiftLeaderboardEmbed.title, '⏱️ Weekly Shift Leaderboard');
    assert(shiftLeaderboardEmbed.description.includes(`<@${shiftTarget.id}>`));
    assert(shiftLeaderboardEmbed.description.includes('**2h** / 2h'));

    const shiftEndReplies: string[] = [];
    await commandNamed('shift').execute({
        guildId: 'shift-guild',
        guild: shiftGuild,
        member: shiftGuildMember,
        user: shiftTarget,
        options: { getSubcommand: () => 'end' },
        deferReply: async () => undefined,
        editReply: async (payload: string) => { shiftEndReplies.push(payload); },
    } as never);
    assert(shiftEndReplies.some(reply => reply.includes('Your shift ended')));
    assert(shiftEndReplies.some(reply => reply.includes('Quota status:** ✅ Completed')));
    assert.equal(shiftTargetDms.length, 1, 'ending later must not duplicate an already delivered quota-completion DM');
    assert(!shiftRoleCache.has(ACTIVE_SHIFT_ROLE_ID), '/shift end must remove the active-shift role');
    assert(!shiftRoleCache.has(SHIFT_BREAK_ROLE_ID), '/shift end must remove the break role');
    assert(shiftRoleEvents.includes(`add:${ACTIVE_SHIFT_ROLE_ID}`));
    assert(shiftRoleEvents.includes(`add:${SHIFT_BREAK_ROLE_ID}`));

    clearShiftMemory();
    const originalGuildId = process.env.GUILD_ID;
    process.env.GUILD_ID = 'quota-scheduler-guild';
    let quotaMemberFetches = 0;
    let exemptInfractionChannelFetches = 0;
    const exemptQuotaMember = {
        id: 'quota-exempt-member',
        user: {
            id: 'quota-exempt-member',
            username: 'QuotaExempt',
            bot: false,
            send: async () => undefined,
        },
        roles: {
            cache: new Map([
                ['1521593407795888336', { id: '1521593407795888336' }],
                ['1521593407850680401', { id: '1521593407850680401' }],
            ]),
        },
    };
    const quotaMembers = new Collection<string, any>([[exemptQuotaMember.id, exemptQuotaMember]]);
    const quotaSchedulerClient = {
        user: { id: 'quota-bot' },
        channels: {
            fetch: async () => {
                exemptInfractionChannelFetches += 1;
                throw new Error('an exempt member must never reach automatic infraction creation');
            },
        },
        guilds: {
            cache: new Map([['quota-scheduler-guild', {
                members: { fetch: async () => { quotaMemberFetches += 1; return quotaMembers; } },
            }]]),
        },
    } as never;
    await runDueShiftQuotaEvaluation(quotaSchedulerClient, new Date('2026-08-17T16:00:00.000Z'));
    await runDueShiftQuotaEvaluation(quotaSchedulerClient, new Date('2026-08-21T14:00:01.000Z'));
    await runDueShiftQuotaEvaluation(quotaSchedulerClient, new Date('2026-08-21T14:01:00.000Z'));
    assert.equal(quotaMemberFetches, 1, 'the same Friday quota window must never be evaluated twice');
    assert.equal(exemptInfractionChannelFetches, 0, 'quota-exempt roles must never reach automatic infraction creation');
    if (originalGuildId === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = originalGuildId;

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

    let partnershipLauncher: any = null;
    await commandNamed('partnership').execute({
        channel: {
            isSendable: () => true,
            send: async (payload: any) => { partnershipLauncher = payload; },
        },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    assert.equal(partnershipLauncher?.flags, 32_768, 'the partnership launcher must use Components V2');
    assert.equal(partnershipLauncher?.embeds, undefined, 'the partnership launcher must not use a legacy embed');
    const partnershipLauncherPanel = partnershipLauncher.components[0].toJSON();
    const partnershipLauncherMedia = partnershipLauncherPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(partnershipLauncherMedia.length, 1, 'the partnership launcher must not have a top banner');
    assert.equal(partnershipLauncherMedia[0]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');

    let partnershipModal: any = null;
    const partnershipButtonHandled = await handleCommunityButton({
        customId: 'partnership:open',
        showModal: async (modal: any) => { partnershipModal = modal; },
    } as never);
    assert(partnershipButtonHandled);
    assert.equal(partnershipModal?.toJSON().custom_id, 'partnership:request-modal');

    let partnershipSubmission: any = null;
    const partnershipReplies: string[] = [];
    const fullPartnershipAd = [
        'A professional ER:LC community for creative designers.',
        '',
        '**What we offer**',
        '- Detailed roleplay scenes',
        '- Community events',
        '- A welcoming creative team',
        '',
        'This final line must remain present when the partnership is approved.',
    ].join('\n').padEnd(4_000, '•');
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
                server_ad: fullPartnershipAd,
            } as Record<string, string>)[name],
        },
        user: { id: 'partnership-user', tag: 'Representative#1234' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { partnershipReplies.push(content); },
    } as never);
    assert(partnershipModalHandled);
    assert.equal(partnershipSubmission?.flags, 32_768, 'partnership review requests must use Components V2');
    assert.equal(partnershipSubmission?.embeds, undefined, 'partnership review requests must not use legacy embeds');
    const partnershipRequestPanel = partnershipSubmission.components[0].toJSON();
    const partnershipRequestMedia = partnershipRequestPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(partnershipRequestMedia.length, 1, 'partnership review requests must not have a top banner');
    assert.equal(partnershipRequestMedia[0]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    assert(partnershipRequestPanel.components.some((component: { content?: string }) => component.content === fullPartnershipAd),
        'the full submitted advertisement must be retained in its own V2 text component');
    assert(partnershipReplies.some(reply => reply.includes('submitted for review')));

    let reviewedPartnership: any = null;
    let approvedPartnership: any = null;
    const assignedPartnershipRoles: string[] = [];
    const partnershipApprovalReplies: string[] = [];
    const partnershipSourceMessage = {
        components: partnershipSubmission.components,
        embeds: [],
        attachments: new Collection([['partnership-underbanner', { id: 'partnership-underbanner', name: 'underbanner.webp' }]]),
        edit: async (payload: any) => { reviewedPartnership = payload; },
    };
    assert(await handleCommunityButton({
        customId: 'partnership:approve:partnership-user',
        guildId: 'partnership-guild',
        memberPermissions: { has: () => true },
        member: { roles: [] },
        user: { id: 'partnership-reviewer', tag: 'Reviewer#1234' },
        guild: {
            members: {
                fetch: async () => ({ roles: { add: async (role: { id: string }) => { assignedPartnershipRoles.push(role.id); } } }),
            },
            roles: { fetch: async (roleId: string) => ({ id: roleId }) },
        },
        message: partnershipSourceMessage,
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { approvedPartnership = payload; },
                }),
            },
        },
        deferReply: async () => undefined,
        editReply: async (content: string) => { partnershipApprovalReplies.push(content); },
    } as never));
    assert.equal(reviewedPartnership?.flags, 32_768, 'reviewing a partnership must preserve its V2 emblem');
    const reviewedPartnershipPanel = reviewedPartnership.components[0];
    const reviewedPartnershipText = reviewedPartnershipPanel.components
        .filter((component: { type: number }) => component.type === 10)
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(reviewedPartnershipText.includes('`Approved`'));
    assert(reviewedPartnershipText.includes(fullPartnershipAd), 'approving must not remove any of the submitted advertisement');
    assert.equal(approvedPartnership?.flags, 32_768, 'approved partnerships must be published as Components V2');
    assert.equal(approvedPartnership?.embeds, undefined, 'approved partnerships must not fall back to a legacy embed');
    const approvedPartnershipPanel = approvedPartnership.components[0].toJSON();
    assert(approvedPartnershipPanel.components.some((component: { content?: string }) => component.content === fullPartnershipAd),
        'the approval channel must receive the complete advertisement verbatim');
    const approvedPartnershipMedia = approvedPartnershipPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(approvedPartnershipMedia.length, 1, 'approved partnership emblems must not have a top banner');
    assert.equal(approvedPartnershipMedia[0]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    assert.equal(assignedPartnershipRoles.length, 1, 'approval must assign the configured partnership role');
    assert(partnershipApprovalReplies.some(reply => reply.includes('approved')));

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
    const promotionReplies: string[] = [];
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
        editReply: async (payload: string) => { promotionReplies.push(payload); },
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
    assert.equal(promotionReplies.length, 2, 'promotion must acknowledge immediately and then report final DM status');
    assert(promotionReplies.every(reply => reply.includes('Components V2 promotion')));
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
    assert(attachedThreadOptions, 'the infraction should receive an evidence thread attached to its case message');
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
    const appealButton = infractionPanel?.components
        ?.find((component: { type: number; components?: Array<{ custom_id?: string }> }) => component.type === 1
            && component.components?.[0]?.custom_id?.startsWith('infraction-appeal:start:'))
        ?.components?.[0];
    assert.equal(
        infractionPanel.components.filter((component: { type: number }) => component.type === 1).length,
        1,
        'the infraction panel must expose only the appeal control row',
    );
    assert.equal(
        infractionPanel.components.some((component: { type: number }) => component.type === 9),
        false,
        'the old punishment-button menu must not be included',
    );
    assert.equal(appealButton?.custom_id, 'infraction-appeal:start:INF-0001');
    assert.notEqual(appealButton?.disabled, true, 'appealable cases must expose a working appeal button');
    assert.equal(infractionDms.length, 1, 'the infracted member must receive a DM by default');
    assert.equal(infractionDms[0].flags, 32_768, 'the infraction DM must use the same V2 emblem');
    const infractionDmPanel = infractionDms[0].components[0].toJSON();
    const infractionDmRows = infractionDmPanel.components.filter((component: { type: number }) => component.type === 1);
    assert.equal(infractionDmRows.length, 1, 'the DM emblem must contain only one action row');
    assert.equal(infractionDmRows[0]?.components?.[0]?.custom_id, 'infraction-appeal:start:INF-0001');
    const infractionDmBanners = infractionDmPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(infractionDmBanners[0]?.items?.[0]?.media?.url, 'attachment://infraction-banner.png');
    assert.equal(infractionDmBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    assert.equal(infractionReplies.length, 2, 'infraction must acknowledge immediately and then report final case status');
    assert(String(infractionReplies[0]).includes('Finishing the member notification and case save'));
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
        send: {
            value: async (payload: any) => {
                fallbackPanelPayload = payload;
                return {
                    id: '1526044664975851888',
                    url: 'https://discord.com/channels/guild/1526044664975851642/1526044664975851888',
                    startThread: async () => { throw new Error('Missing Create Public Threads'); },
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

    let automaticInfraction: InfractionRecord | null = null;
    configureInfractionPersistence({
        nextCaseNumber: async () => 3,
        saveInfraction: async record => { automaticInfraction = record; },
        getInfractionByThreadId: async () => automaticInfraction,
    });
    const automaticPanels: any[] = [];
    const automaticDms: any[] = [];
    const automaticThread = {
        id: 'automatic-infraction-thread',
        url: 'https://discord.com/channels/guild/automatic-infraction-thread',
        send: async () => undefined,
    };
    const automaticParent = {
        id: '1526044664975851642',
        type: ChannelType.GuildText,
        isSendable: () => true,
        send: async (payload: any) => {
            automaticPanels.push(payload);
            return {
                id: 'automatic-infraction-message',
                url: 'https://discord.com/channels/guild/automatic-infraction-message',
                startThread: async () => automaticThread,
            };
        },
    };
    const automaticResult = await issueAutomaticInfraction({
        user: { id: 'shift-quota-bot' },
        channels: { fetch: async () => automaticParent },
    } as never, '789699000047370261', {
        id: 'automatic-member',
        username: 'AutomaticMember',
        send: async (payload: any) => { automaticDms.push(payload); },
    } as never, {
        reason: 'Weekly shift quota was not completed.',
        ruleBroken: 'Weekly Shift Quota',
    });
    assert.equal(automaticResult.caseNumber, 'INF-0003');
    assert.equal(automaticPanels[0].flags, 32_768, 'automatic quota infractions must use the same V2 case emblem');
    assert.equal(automaticDms[0].flags, 32_768, 'automatic quota infractions must DM the member with the V2 emblem');
    assert.equal((automaticInfraction as InfractionRecord | null)?.action, 'Warning');
    assert.equal((automaticInfraction as InfractionRecord | null)?.threadId, automaticThread.id);

    let viewInfractionsPayload: any = null;
    let viewInfractionsDeferred = false;
    await commandNamed('view-infractions').execute({
        guildId: '789699000047370261',
        user: infractionTarget,
        options: { getUser: () => infractionTarget },
        deferred: false,
        replied: false,
        deferReply: async () => { viewInfractionsDeferred = true; },
        editReply: async (payload: any) => { viewInfractionsPayload = payload; },
        reply: async () => { throw new Error('server views must defer before querying'); },
        followUp: async () => { throw new Error('successful view must not use a follow-up'); },
    } as never);
    assert(viewInfractionsDeferred, '/view-infractions must acknowledge before querying storage');
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
    assert(viewInfractionText.includes('Open Infraction'));
    assert(viewInfractionText.includes('**Total:** `1`'), 'the panel must show the exact unique infraction count');

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
                id: 'old-session-message',
                author: { id: 'session-bot' },
                components: [],
                embeds: [{ title: 'SESSION START' }],
                attachments: new Collection(),
                delete: async () => { deletedSessionMessages += 1; },
            });
            priorMessages.set('old-session-vote', {
                id: 'old-session-vote',
                author: { id: 'session-bot' },
                components: [{ data: { customId: 'session:vote:cast:5' } }],
                embeds: [],
                attachments: new Collection(),
                delete: async () => { deletedSessionMessages += 1; },
            });
            priorMessages.set('unrelated-bot-message', {
                id: 'unrelated-bot-message',
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
        assert.deepEqual(sessionPayload.allowedMentions.roles, ['1521593407749754990']);
        const sessionText = sessionPanel.components
            .flatMap((component: { components?: Array<{ content?: string }> }) => component.components || [])
            .map((component: { content?: string }) => component.content || '')
            .join('\n');
        assert(sessionText.includes('<@&1521593407749754990>'), `/${commandName} must mention the session role inside its V2 emblem`);
        if (commandName === 'session-vote') sessionVotePayload = sessionPayload;
    }
    assert.equal(deletedSessionMessages, 2, '/session-end must delete every prior bot session announcement only');

    let sessionVoteEdit: any = null;
    const sessionVoteReplies: string[] = [];
    let sessionVoteDeferred = false;
    const liveSessionVotePanel = JSON.parse(JSON.stringify(sessionVotePayload.components[0].toJSON()));
    const replaceVoteMediaUrls = (node: any): void => {
        if (node.media?.url === 'attachment://session-vote-banner.png') {
            node.media.url = 'https://cdn.discordapp.com/attachments/channel/session-vote-banner.png';
        } else if (node.media?.url === 'attachment://underbanner.webp') {
            node.media.url = 'https://cdn.discordapp.com/attachments/channel/underbanner.webp';
        }
        for (const item of node.items || []) replaceVoteMediaUrls(item);
        for (const component of node.components || []) replaceVoteMediaUrls(component);
    };
    replaceVoteMediaUrls(liveSessionVotePanel);
    await handleSessionButton({
        customId: 'session:vote:cast:5',
        guildId: '789699000047370261',
        channelId: 'session-channel',
        user: { id: 'session-voter' },
        message: {
            id: 'session-vote-message',
            attachments: new Map(),
            components: [{ toJSON: () => liveSessionVotePanel }],
        },
        deferUpdate: async () => { sessionVoteDeferred = true; },
        editReply: async (payload: any) => { sessionVoteEdit = payload; },
        followUp: async (payload: any) => { sessionVoteReplies.push(payload.content); },
    } as never);
    assert(sessionVoteDeferred, 'vote buttons must acknowledge by deferring an update to the original message');
    assert.equal(sessionVoteEdit?.flags, 32_768, 'vote updates must preserve the Components V2 message flag');
    assert.equal(sessionVoteEdit?.attachments, undefined, 'vote updates must not re-upload or clear the original media');
    const editedVotePanel = sessionVoteEdit.components[0];
    assert.equal(
        editedVotePanel.components[0]?.items?.[0]?.media?.url,
        'https://cdn.discordapp.com/attachments/channel/session-vote-banner.png',
        'vote updates must preserve the live Discord CDN banner URL',
    );
    assert.equal(
        editedVotePanel.components.at(-1)?.items?.[0]?.media?.url,
        'https://cdn.discordapp.com/attachments/channel/underbanner.webp',
        'vote updates must preserve the live Discord CDN underbanner URL',
    );
    assert(sessionVoteReplies.some(reply => reply.includes('1/5')));

    let ticketPanelPayload: any = null;
    let fetchedTicketPanelChannelId = '';
    const ticketPanelConfirmations: string[] = [];
    const ticketPanelDestination = {
        isSendable: () => true,
        send: async (payload: any) => { ticketPanelPayload = payload; },
    };
    await commandNamed('ticket-panel').execute({
        client: {
            channels: {
                fetch: async (channelId: string) => {
                    fetchedTicketPanelChannelId = channelId;
                    return ticketPanelDestination;
                },
            },
        },
        deferReply: async () => undefined,
        editReply: async (content: string) => { ticketPanelConfirmations.push(content); },
    } as never);
    assert.equal(fetchedTicketPanelChannelId, '1526034504953892925');
    assert.equal(ticketPanelPayload?.flags, 32_768, '/ticket-panel must post a Components V2 emblem');
    const ticketLauncher = ticketPanelPayload.components[0].toJSON();
    const ticketLauncherBanners = ticketLauncher.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(ticketLauncherBanners[0]?.items?.[0]?.media?.url, 'attachment://assistance-banner.png');
    assert.equal(ticketLauncherBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    const ticketLauncherSelect = ticketLauncher.components
        .find((component: { type: number; components?: Array<{ custom_id?: string }> }) => component.type === 1
            && component.components?.[0]?.custom_id === 'ticket:create-select')
        ?.components?.[0];
    assert.deepEqual(
        ticketLauncherSelect?.options?.map((option: { value: string }) => option.value),
        ['general', 'internal', 'management', 'highrank'],
    );
    assert(ticketPanelConfirmations.some(content => content.includes('1526034504953892925')));

    const ticketCommandSchema = commandNamed('ticket').data.toJSON() as { options?: Array<{ name: string; type: number }> };
    assert.equal(ticketCommandSchema.options?.[0]?.name, 'panel');
    ticketPanelPayload = null;
    await commandNamed('ticket').execute({
        client: { channels: { fetch: async () => ticketPanelDestination } },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    assert.equal(ticketPanelPayload?.flags, 32_768, '/ticket panel must resolve to the working V2 panel handler');
    ticketPanelPayload = null;
    await commandNamed('ticketpanel').execute({
        client: { channels: { fetch: async () => ticketPanelDestination } },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    assert.equal(ticketPanelPayload?.flags, 32_768, '/ticketpanel must resolve to the working V2 panel handler');

    const routedTicketPanelNames: string[] = [];
    const routedTicketPanelReplies: any[] = [];
    for (const commandName of ['ticket', 'ticket-panel', 'ticketpanel']) {
        await interactionCreate({
            commandName,
            client: {
                channels: {
                    fetch: async (channelId: string) => {
                        assert.equal(channelId, '1526034504953892925');
                        return {
                            isSendable: () => true,
                            send: async (payload: any) => {
                                assert.equal(payload.flags, 32_768);
                                routedTicketPanelNames.push(commandName);
                            },
                        };
                    },
                },
            },
            deferReply: async () => undefined,
            editReply: async (payload: any) => { routedTicketPanelReplies.push(payload); },
            reply: async (payload: any) => { routedTicketPanelReplies.push(payload); },
            isButton: () => false,
            isModalSubmit: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isRepliable: () => true,
        } as never);
    }
    assert.deepEqual(routedTicketPanelNames, ['ticket', 'ticket-panel', 'ticketpanel']);
    assert(!routedTicketPanelReplies.some(reply => String(reply?.content || reply).includes('not currently available')),
        'every ticket panel command spelling must bypass the unavailable-command fallback');

    let generalTicketModal: any = null;
    assert(await handleTicketSelect({
        customId: 'ticket:create-select',
        values: ['general'],
        showModal: async (modal: any) => { generalTicketModal = modal; },
    } as never));
    assert.equal(generalTicketModal?.toJSON().custom_id, 'ticket:create-modal:general');
    assert.equal(generalTicketModal?.toJSON().components[0]?.components?.[0]?.custom_id, 'reason');

    let ticketCreateOptions: any = null;
    let openTicketPayload: any = null;
    let createdTicketTopic = '';
    let openTicketMessage: any = null;
    let restoredTicketPanel: any = null;
    const createdTicketChannel: any = {
        id: 'ticket-channel-1',
        type: ChannelType.GuildText,
        topic: '',
        client: { user: { id: 'ticket-bot' } },
        messages: {
            fetch: async (messageId: string | { limit: number }) => {
                if (typeof messageId === 'string') return messageId === openTicketMessage?.id ? openTicketMessage : null;
                return new Collection(openTicketMessage ? [[openTicketMessage.id, openTicketMessage]] : []);
            },
        },
        setTopic: async (topic: string) => {
            createdTicketTopic = topic;
            createdTicketChannel.topic = topic;
        },
        send: async (payload: any) => {
            openTicketPayload = payload;
            openTicketMessage = {
                id: 'ticket-panel-message-1',
                author: { id: 'ticket-bot' },
                components: payload.components,
                attachments: new Collection([
                    ['assistance', { id: 'assistance', name: 'assistance-banner.png' }],
                    ['underbanner', { id: 'underbanner', name: 'underbanner.webp' }],
                ]),
                edit: async (editPayload: any) => {
                    restoredTicketPanel = editPayload;
                    openTicketMessage.components = editPayload.components.map((component: any) => ({ toJSON: () => component }));
                },
            };
            return openTicketMessage;
        },
        delete: async () => undefined,
    };
    const ticketGuild = {
        channels: {
            cache: new Collection<string, any>(),
            create: async (options: any) => {
                ticketCreateOptions = options;
                createdTicketTopic = options.topic;
                createdTicketChannel.topic = options.topic;
                return createdTicketChannel;
            },
        },
        roles: { everyone: { id: 'everyone-role' } },
        members: { fetch: async () => ({ joinedTimestamp: 1_700_000_000_000 }) },
        emojis: { fetch: async () => new Collection<string, any>() },
    };
    const ticketCreationReplies: string[] = [];
    assert(await handleTicketModal({
        customId: 'ticket:create-modal:general',
        guild: ticketGuild,
        client: { user: { id: 'ticket-bot' } },
        user: {
            id: '1489388257925005511',
            username: 'TicketUser',
            tag: 'TicketUser#0001',
            createdTimestamp: 1_600_000_000_000,
        },
        fields: { getTextInputValue: () => 'I need help with the server.' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { ticketCreationReplies.push(content); },
    } as never));
    assert.equal(ticketCreateOptions.parent, '1526254341646712883');
    assert.equal(openTicketPayload.flags, 32_768, 'new tickets must open with a V2 Assistance emblem');
    const openTicketPanel = openTicketPayload.components[0].toJSON();
    const openTicketBanners = openTicketPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(openTicketBanners[0]?.items?.[0]?.media?.url, 'attachment://assistance-banner.png');
    assert.equal(openTicketBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    const openTicketButtons = openTicketPanel.components
        .filter((component: { type: number }) => component.type === 1)
        .flatMap((component: { components?: Array<{ custom_id?: string }> }) => component.components || [])
        .map((button: { custom_id?: string }) => button.custom_id);
    assert.deepEqual(openTicketButtons, ['ticket:claim', 'ticket:close', 'ticket:close-request']);
    assert(ticketCreationReplies.some(reply => reply.includes('ticket-channel-1')));

    let claimedTicketComponents: any[] = [];
    assert(await handleTicketButton({
        customId: 'ticket:claim',
        channel: createdTicketChannel,
        user: { id: 'ticket-agent', username: 'TicketAgent' },
        member: { roles: { cache: new Map([['1523122697746382868', { id: '1523122697746382868' }]]) } },
        memberPermissions: { has: () => false },
        message: openTicketMessage,
        update: async (payload: any) => {
            claimedTicketComponents = payload.components;
            openTicketMessage.components = payload.components.map((component: any) => ({ toJSON: () => component }));
        },
        followUp: async () => undefined,
    } as never));
    assert(claimedTicketComponents.length > 0, 'ticket claim must update the panel controls');
    const unclaimReplies: string[] = [];
    await commandNamed('unclaim').execute({
        channel: createdTicketChannel,
        user: { id: 'ticket-agent' },
        member: { roles: { cache: new Map([['1523122697746382868', { id: '1523122697746382868' }]]) } },
        memberPermissions: { has: () => false },
        deferReply: async () => undefined,
        editReply: async (content: string) => { unclaimReplies.push(content); },
    } as never);
    assert(restoredTicketPanel, '/unclaim must edit the ticket panel');
    const restoredClaimButton = restoredTicketPanel.components
        .flatMap((component: { components?: Array<{ components?: Array<{ custom_id?: string; label?: string; disabled?: boolean }> }> }) =>
            component.components || [])
        .flatMap((component: { components?: Array<{ custom_id?: string; label?: string; disabled?: boolean }> }) => component.components || [])
        .find((component: { custom_id?: string }) => component.custom_id === 'ticket:claim');
    assert.equal(restoredClaimButton?.label, 'Claim Ticket');
    assert.equal(restoredClaimButton?.disabled, false);
    assert(unclaimReplies.some(reply => reply.includes('Ticket unclaimed')));
    assert(createdTicketTopic, '/unclaim must persist the cleared claim in the ticket channel topic');

    let applicationsPanelPayload: any = null;
    await commandNamed('applications-panel').execute({
        guild: null,
        channel: {
            isSendable: () => true,
            send: async (payload: any) => { applicationsPanelPayload = payload; },
        },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    assert.equal(applicationsPanelPayload?.flags, 32_768, '/applications-panel must use Components V2');
    const applicationsPanel = applicationsPanelPayload.components[0].toJSON();
    const applicationsBanners = applicationsPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(applicationsBanners[0]?.items?.[0]?.media?.url, 'attachment://applications-banner.png');
    assert.equal(applicationsBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    assert.deepEqual(APPLICATION_APPROVAL_ROLE_IDS.ingame, ['1524013351850737835']);
    assert.deepEqual(APPLICATION_APPROVAL_ROLE_IDS.discord, [
        '1530363357423468706',
        '1530363248728084620',
        '1521593407791825036',
    ]);
    assert.deepEqual(APPLICATION_APPROVAL_ROLE_IDS.media, ['1521593407770722497']);

    let guidelinesPayload: any = null;
    assert(await handleApplicationButton({
        customId: 'applications:guidelines',
        reply: async (payload: any) => { guidelinesPayload = payload; },
    } as never));
    assert.equal(guidelinesPayload.flags, 32_768 | 64, 'application guidelines must be private and V2');
    const guidelinesPanel = guidelinesPayload.components[0].toJSON();
    const guidelinesBanners = guidelinesPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(guidelinesBanners[0]?.items?.[0]?.media?.url, 'attachment://applications-banner.png');
    assert.equal(guidelinesBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');

    const applicantDms: string[] = [];
    const applicationReviewSends: any[] = [];
    let applicationReviewChannelId = '';
    const applicant = {
        id: '1489388257925005777',
        bot: false,
        send: async (content: string) => { applicantDms.push(content); },
    };
    const applicationStartReplies: string[] = [];
    assert(await handleApplicationSelect({
        customId: 'applications:type',
        values: ['discord'],
        guildId: '789699000047370261',
        user: applicant,
        deferReply: async () => undefined,
        editReply: async (content: string) => { applicationStartReplies.push(content); },
    } as never));
    assert(applicantDms[0]?.includes('Question 1 of 8'));
    assert(applicationStartReplies.some(reply => reply.includes('Check your DMs')));
    for (let index = 0; index < 8; index += 1) {
        assert(await handleApplicationDmMessage({
            author: applicant,
            guildId: null,
            content: `Application answer ${index + 1}`,
            attachments: new Collection<string, any>(),
            client: {
                channels: {
                    fetch: async (channelId: string) => {
                        applicationReviewChannelId = channelId;
                        return ({
                        isSendable: () => true,
                        send: async (payload: any) => { applicationReviewSends.push(payload); },
                        });
                    },
                },
            },
        } as never));
    }
    assert.equal(applicationReviewChannelId, '1538352573248176229', 'all applications must go to the configured review channel');
    assert.equal(applicationReviewSends.length, 1, 'the completed DM application must be submitted once');
    assert.equal(applicationReviewSends[0].flags, 32_768);
    const applicationReviewPanel = applicationReviewSends[0].components[0].toJSON();
    const reviewBanners = applicationReviewPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(reviewBanners[0]?.items?.[0]?.media?.url, 'attachment://applications-banner.png');
    assert.equal(reviewBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.webp');
    const applicationReviewText = applicationReviewPanel.components
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(applicationReviewText.includes('AI Check'));
    assert(applicationReviewText.includes('No strong AI-writing indicators'));
    const flaggedAiAssessment = analyzeApplicationAi([
        'As an AI language model, it is important to note that I would take the following steps.',
        'Furthermore, I would ensure a safe and respectful environment.',
        'Moreover, first and foremost, I would remain professional. In conclusion, these are my steps.',
    ]);
    assert(flaggedAiAssessment.flagged, 'obvious AI-writing signals must flag the application for manual review');
    const applicationReviewButtons = applicationReviewPanel.components
        .find((component: { type: number; components?: Array<{ custom_id?: string }> }) => component.type === 1
            && component.components?.some(button => button.custom_id?.startsWith('applications:review:')))
        ?.components || [];
    assert.equal(applicationReviewButtons[0]?.custom_id, 'applications:review:approve:1489388257925005777:discord');
    assert.equal(applicationReviewButtons[1]?.custom_id, 'applications:review:deny:1489388257925005777:discord');
    assert(applicantDms.at(-1)?.includes('DO NOT ASK'));

    const completeApplication = async (type: 'media' | 'ban_appeal', questionCount: number, userId: string) => {
        const dms: string[] = [];
        const user = {
            id: userId,
            bot: false,
            send: async (content: string) => { dms.push(content); },
        };
        await handleApplicationSelect({
            customId: 'applications:type',
            values: [type],
            guildId: '789699000047370261',
            user,
            deferReply: async () => undefined,
            editReply: async () => undefined,
        } as never);
        assert(dms[0]?.includes(`Question 1 of ${questionCount}`));
        for (let index = 0; index < questionCount; index += 1) {
            await handleApplicationDmMessage({
                author: user,
                guildId: null,
                content: type === 'media' && index === 0
                    ? 'As an AI language model, furthermore, it is important to note that I would take the following steps.'
                    : `${type} answer ${index + 1}`,
                attachments: new Collection<string, any>(),
                client: {
                    channels: {
                        fetch: async (channelId: string) => {
                            applicationReviewChannelId = channelId;
                            return {
                                isSendable: () => true,
                                send: async (payload: any) => { applicationReviewSends.push(payload); },
                            };
                        },
                    },
                },
            } as never);
        }
        return dms;
    };
    const mediaApplicationDms = await completeApplication('media', 7, '1489388257925005888');
    const banAppealDms = await completeApplication('ban_appeal', 3, '1489388257925005999');
    assert(mediaApplicationDms.at(-1)?.includes('Media Team Application'));
    assert(banAppealDms.at(-1)?.includes('In-Game Ban Appeal'));
    assert.equal(applicationReviewSends.length, 3, 'Discord, Media, and Ban Appeal submissions must all reach review');
    assert.equal(applicationReviewSends[1].flags, 32_768);
    assert.equal(applicationReviewSends[2].flags, 32_768);
    const flaggedMediaReviewText = applicationReviewSends[1].components[0].toJSON().components
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(flaggedMediaReviewText.includes('Potential AI Use — Manual Review Required'));

    const persistedApplicationSessions = new Map<string, ApplicationSession>();
    configureApplicationSessionPersistence({
        loadApplicationSession: async userId => {
            const session = persistedApplicationSessions.get(userId);
            return session ? JSON.parse(JSON.stringify(session)) as ApplicationSession : null;
        },
        saveApplicationSession: async (userId, session) => {
            persistedApplicationSessions.set(userId, JSON.parse(JSON.stringify(session)) as ApplicationSession);
        },
        deleteApplicationSession: async userId => { persistedApplicationSessions.delete(userId); },
    });
    const longApplicationDms: string[] = [];
    const longApplicationUser = {
        id: '1489388257925006111',
        bot: false,
        send: async (content: string) => { longApplicationDms.push(content); },
    };
    await handleApplicationSelect({
        customId: 'applications:type',
        values: ['ingame'],
        guildId: '789699000047370261',
        user: longApplicationUser,
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    const longApplicationMessage = (answer: string) => ({
        author: longApplicationUser,
        guildId: null,
        content: answer,
        attachments: new Collection<string, any>(),
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { applicationReviewSends.push(payload); },
                }),
            },
        },
    });
    for (let index = 0; index < 9; index += 1) {
        assert(await handleApplicationDmMessage(longApplicationMessage(`In-game answer ${index + 1}`) as never));
    }
    assert(longApplicationDms.at(-1)?.includes('Question 10 of 11'));
    const persistedAtQuestion10 = persistedApplicationSessions.get(longApplicationUser.id);
    assert(persistedAtQuestion10, 'Question 10 progress must be durably saved');
    persistedAtQuestion10.startedAt = Date.now() - 48 * 60 * 60 * 1_000;
    persistedAtQuestion10.lastActivityAt = Date.now();
    clearApplicationSessionCache();
    assert(await handleApplicationDmMessage(longApplicationMessage('In-game answer 10') as never));
    assert(longApplicationDms.at(-1)?.includes('Question 11 of 11'),
        'an active long application must continue past Question 10 after a process restart');
    clearApplicationSessionCache();
    assert(await handleApplicationDmMessage(longApplicationMessage('In-game answer 11') as never));
    assert(longApplicationDms.at(-1)?.includes('DO NOT ASK'));
    assert.equal(persistedApplicationSessions.has(longApplicationUser.id), false,
        'the durable application session must be removed only after successful review submission');

    let failQuestionTwoOnce = true;
    const interruptedApplicationDms: string[] = [];
    const interruptedApplicationUser = {
        id: '1489388257925006166',
        bot: false,
        send: async (content: string) => {
            if (content.includes('Question 2 of 7') && failQuestionTwoOnce) {
                failQuestionTwoOnce = false;
                throw new Error('Temporary Discord DM delivery failure');
            }
            interruptedApplicationDms.push(content);
        },
    };
    await handleApplicationSelect({
        customId: 'applications:type',
        values: ['media'],
        guildId: '789699000047370261',
        user: interruptedApplicationUser,
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    const interruptedMessage = (content: string) => ({
        author: interruptedApplicationUser,
        guildId: null,
        content,
        attachments: new Collection<string, any>(),
        client: { channels: { fetch: async () => null } },
    });
    assert(await handleApplicationDmMessage(interruptedMessage('Media answer 1') as never));
    assert.equal(persistedApplicationSessions.get(interruptedApplicationUser.id)?.promptPending, true,
        'a failed next-question DM must be persisted as pending');
    assert(await handleApplicationDmMessage(interruptedMessage('Please continue my application') as never));
    assert(interruptedApplicationDms.at(-1)?.includes('Question 2 of 7'),
        'the next applicant DM must resend a question whose original delivery failed');
    assert.equal(persistedApplicationSessions.get(interruptedApplicationUser.id)?.answers.length, 1,
        'a recovery request must not be consumed as an answer to an unseen question');
    persistedApplicationSessions.delete(interruptedApplicationUser.id);
    clearApplicationSessionCache();

    // Recover users who were already mid-application before durable session
    // storage was deployed by reconstructing the bot/user question history.
    clearApplicationSessionCache();
    persistedApplicationSessions.clear();
    const legacyRecoveryDms: string[] = [];
    const legacyRecoveryUser = {
        id: '1489388257925006222',
        bot: false,
        send: async (content: string) => { legacyRecoveryDms.push(content); },
    };
    const legacyHistory = new Collection<string, any>();
    const historyBase = Date.now() - 20 * 60_000;
    for (let question = 1; question <= 10; question += 1) {
        legacyHistory.set(`legacy-prompt-${question}`, {
            id: `legacy-prompt-${question}`,
            author: { id: 'application-bot', bot: true },
            content: `**Question ${question} of 11**\nPrompt ${question}`,
            attachments: new Collection<string, any>(),
            createdTimestamp: historyBase + question * 2_000,
        });
        if (question < 10) {
            legacyHistory.set(`legacy-answer-${question}`, {
                id: `legacy-answer-${question}`,
                author: legacyRecoveryUser,
                content: `Recovered answer ${question}`,
                attachments: new Collection<string, any>(),
                createdTimestamp: historyBase + question * 2_000 + 1_000,
            });
        }
    }
    assert(await handleApplicationDmMessage({
        id: 'legacy-current-answer-10',
        author: legacyRecoveryUser,
        guildId: null,
        content: 'Recovered answer 10',
        attachments: new Collection<string, any>(),
        channel: { messages: { fetch: async () => legacyHistory } },
        client: {
            user: { id: 'application-bot' },
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { applicationReviewSends.push(payload); },
                }),
            },
        },
    } as never));
    assert(legacyRecoveryDms.at(-1)?.includes('Question 11 of 11'),
        'a pre-deployment application must recover from DM history at Question 10');
    configureApplicationSessionPersistence(null);
    clearApplicationSessionCache();

    const unauthorizedApplicationReplies: any[] = [];
    assert(await handleApplicationButton({
        customId: 'applications:review:approve:1489388257925005777:discord',
        user: { id: 'unauthorized-reviewer' },
        member: { roles: [] },
        guild: { members: { fetch: async () => ({ roles: { cache: new Map() } }) } },
        reply: async (payload: any) => { unauthorizedApplicationReplies.push(payload); },
    } as never));
    assert(unauthorizedApplicationReplies[0]?.content.includes('1538351617840254998'));

    let updatedApplicationReview: any = null;
    const applicationReviewResults: string[] = [];
    const applicationResultDms: any[] = [];
    let applicationDecisionModal: any = null;
    const grantedApplicationRoles: string[] = [];
    const approvedApplicantMember = {
        roles: {
            cache: new Map<string, unknown>(),
            add: async (roleId: string) => { grantedApplicationRoles.push(roleId); },
        },
    };
    assert(await handleApplicationButton({
        customId: 'applications:review:approve:1489388257925005777:discord',
        user: { id: 'authorized-reviewer' },
        member: { roles: ['1538351617840254998'] },
        channelId: '1538352573248176229',
        message: {
            id: '1538352573248176999',
            components: applicationReviewSends[0].components,
            edit: async (payload: any) => { updatedApplicationReview = payload; },
        },
        showModal: async (modal: any) => { applicationDecisionModal = modal; },
    } as never));
    assert.equal(
        applicationDecisionModal?.toJSON().custom_id,
        'applications:decision:approve:1489388257925005777:discord:1538352573248176229:1538352573248176999',
    );
    assert.equal(applicationDecisionModal?.toJSON().components[0]?.components?.[0]?.custom_id, 'decision_reason');

    let denialDecisionModal: any = null;
    assert(await handleApplicationButton({
        customId: 'applications:review:deny:1489388257925005888:media',
        user: { id: 'authorized-reviewer' },
        member: { roles: ['1538351617840254998'] },
        channelId: '1538352573248176229',
        message: { id: '1538352573248177000' },
        showModal: async (modal: any) => { denialDecisionModal = modal; },
    } as never));
    assert.equal(denialDecisionModal?.toJSON().title, 'Deny Application');
    assert.equal(denialDecisionModal?.toJSON().components[0]?.components?.[0]?.custom_id, 'decision_reason');

    const reviewMessageForDecision = {
        id: '1538352573248176999',
        components: applicationReviewSends[0].components,
        edit: async (payload: any) => { updatedApplicationReview = payload; },
    };
    assert(await handleApplicationModal({
        customId: applicationDecisionModal.toJSON().custom_id,
        user: { id: 'authorized-reviewer' },
        member: { roles: ['1538351617840254998'] },
        guild: { members: { fetch: async () => approvedApplicantMember } },
        fields: { getTextInputValue: () => 'Strong answers and prior moderation experience.' },
        client: {
            channels: {
                fetch: async () => ({ messages: { fetch: async () => reviewMessageForDecision } }),
            },
            users: {
                fetch: async () => ({ send: async (payload: any) => { applicationResultDms.push(payload); } }),
            },
        },
        deferReply: async () => undefined,
        editReply: async (content: string) => { applicationReviewResults.push(content); },
    } as never));
    const updatedApplicationContainer = updatedApplicationReview.components[0];
    const updatedApplicationText = updatedApplicationContainer.components
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(updatedApplicationText.includes('`Approved`'));
    assert(updatedApplicationText.includes('Strong answers and prior moderation experience.'));
    const updatedApplicationButtons = updatedApplicationContainer.components
        .find((component: { type?: number; components?: Array<{ custom_id?: string; disabled?: boolean }> }) =>
            component.type === 1 && component.components?.some(button => button.custom_id?.startsWith('applications:review:')),
        )?.components || [];
    assert.equal(updatedApplicationButtons.length, 2);
    assert(updatedApplicationButtons.every((button: { disabled?: boolean }) => button.disabled));
    assert.equal(applicationResultDms[0]?.flags, 32_768, 'application results must be sent as V2 emblems');
    const applicationResultText = applicationResultDms[0].components[0].toJSON().components
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(applicationResultText.includes('Strong answers and prior moderation experience.'));
    assert(applicationReviewResults.some(result => result.includes('approved')));
    assert.deepEqual(grantedApplicationRoles, [
        '1530363357423468706',
        '1530363248728084620',
        '1521593407791825036',
    ], 'approving a Discord application must grant all three configured roles');

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
