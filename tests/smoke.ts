import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AuditLogEvent, ChannelType, Collection, MessageFlags, PermissionFlagsBits, TextChannel } from 'discord.js';
import { commandDefinitions } from '../src/commands/registry';
import { staffCommands } from '../src/commands/staff';
import { detectBullying, detectProhibitedWords, detectRaidThreat, handleMessageModeration } from '../src/events/messageModeration';
import {
    configureInfractionPersistence,
    handleStaffManagementButton,
    hasRequiredRole,
    type InfractionRecord,
} from '../src/commands/staffManagement';
import {
    INFRACTION_AUTHORIZED_ROLE_ID,
    PROMOTION_AUTHORIZED_ROLE_ID,
    SESSION_START_AUTHORIZED_ROLE_ID,
    TRAINING_RESULTS_AUTHORIZED_ROLE_ID,
} from '../src/config/constants';
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
import { handleLoaButton, handleLoaModal } from '../src/commands/loa';
import { handleTrainingModal } from '../src/commands/requestTraining';
import { handleSuggestionButton } from '../src/commands/suggestions';
import { buildDashboardRefreshPayload, handleDashboardSelect } from '../src/commands/dashboard';
import { buildRulesPanelRefreshPayload, handleRulesSelect } from '../src/commands/rules';
import {
    handleSecurityAuditEntry,
    resetServerSecurityStateForTests,
    type ServerSecurityPolicy,
} from '../src/events/serverSecurity';
import { interactionCreate } from '../src/handlers/interactionCreate';
import { handleTicketClaimRepair } from '../src/handlers/ticketClaimRepair';
import {
    closeTicketWithLifecycle,
    handleTicketFeedbackButton,
    handleTicketFeedbackModal,
} from '../src/commands/ticketLifecycleEnhancements';
import { refreshPersistentPanels } from '../src/events/persistentPanelRefresh';
import { synchronizeSlashCommands } from '../src/events/ready';
import { sanitizedCommandOptions } from '../src/utils/commandAudit';
import { fetchErlcServer, type ErlcServerSnapshot } from '../src/services/erlcService';
import { ERLC_COMMAND_ENDPOINT } from '../src/services/erlcCommandService';
import { ERLC_SSD_COMMAND } from '../src/services/erlcSessionShutdown';
import {
    ErlcMonitor,
    MemoryErlcMonitorStateStore,
    type ErlcCommandDetectedEvent,
    type ErlcPunishmentCommandEvent,
    type ErlcTeamChangedEvent,
} from '../src/monitors/erlcMonitor';

async function run(): Promise<void> {
    const deploymentFiles = ['Procfile', 'railway.json', 'render.yaml', 'ecosystem.config.js'];
    for (const deploymentFile of deploymentFiles) {
        const deploymentConfig = readFileSync(deploymentFile, 'utf8');
        assert(!deploymentConfig.includes('dist/index.js'),
            `${deploymentFile} must not launch the stale dist runtime`);
        assert(deploymentConfig.includes('index.js'),
            `${deploymentFile} must launch the canonical root index.js runtime`);
    }

    assert.deepEqual(
        staffCommands.map(command => command.data.name),
        ['application', 'training'],
        'legacy staff commands must not expose old embed-based infraction or promotion paths',
    );
    assert.equal(hasRequiredRole({ roles: { cache: new Map([['1523121675007426692', { id: '1523121675007426692' }]]) } } as any, '1523121675007426692'), true, 'the infraction role should grant infraction access');
    assert.equal(hasRequiredRole({ roles: { cache: new Map([['other-role', { id: 'other-role' }]]) } } as any, '1523121675007426692'), false, 'other roles should not grant infraction access');
    assert.equal(SESSION_START_AUTHORIZED_ROLE_ID, '1521593407804280963');
    assert.equal(INFRACTION_AUTHORIZED_ROLE_ID, '1523121675007426692');
    assert.equal(PROMOTION_AUTHORIZED_ROLE_ID, '1523121617079767151');
    assert.equal(TRAINING_RESULTS_AUTHORIZED_ROLE_ID, '1521593407795888330');

    const originalGuildId = process.env.GUILD_ID;
    const synchronizedGuildPayloads: any[][] = [];
    const synchronizedGlobalPayloads: any[][] = [];
    process.env.GUILD_ID = 'slash-sync-guild';
    try {
        const synchronizedCount = await synchronizeSlashCommands({
            guilds: {
                cache: new Collection([['slash-sync-guild', {
                    id: 'slash-sync-guild',
                    commands: { set: async (payload: any[]) => { synchronizedGuildPayloads.push(payload); } },
                }]]),
                fetch: async () => { throw new Error('the configured cached guild should be used'); },
            },
            application: {
                commands: { set: async (payload: any[]) => { synchronizedGlobalPayloads.push(payload); } },
            },
        } as never);
        assert.equal(synchronizedCount, commandDefinitions.length);
    } finally {
        if (originalGuildId === undefined) delete process.env.GUILD_ID;
        else process.env.GUILD_ID = originalGuildId;
    }
    assert.deepEqual(
        synchronizedGuildPayloads[0].map(schema => schema.name),
        commandDefinitions.map(command => command.data.name),
        'startup synchronization must publish every runtime command handler to Discord',
    );
    assert.deepEqual(
        synchronizedGlobalPayloads,
        [[]],
        'startup synchronization must clear stale global commands that cause unavailable-command duplicates',
    );

    const securityPolicy = (): ServerSecurityPolicy => ({
        enabled: true,
        trustedUserIds: new Set(),
        trustedRoleIds: new Set(),
        allowedBotIds: new Set(),
        allowedWebhookIds: new Set(),
        allowedIntegrationIds: new Set(),
        botAction: 'ban',
        logChannelId: 'security-log',
        alertRoleId: 'security-alert-role',
    });
    const securityClient = {
        user: { id: 'security-guardian' },
        channels: { fetch: async () => null },
    };
    const untrustedExecutor = {
        id: 'untrusted-executor',
        roles: { cache: new Collection<string, any>() },
    };

    resetServerSecurityStateForTests();
    let unauthorizedBotBans = 0;
    const unauthorizedBot: any = {
        id: 'unauthorized-bot',
        client: securityClient,
        user: { id: 'unauthorized-bot', bot: true, tag: 'UnauthorizedBot#0001' },
        ban: async () => { unauthorizedBotBans += 1; },
        kick: async () => { throw new Error('the default security policy should ban'); },
    };
    const botSecurityGuild: any = {
        id: 'bot-security-guild',
        name: 'Bot Security Guild',
        ownerId: 'guild-owner',
        client: securityClient,
        members: {
            fetch: async (id: string) => id === unauthorizedBot.id ? unauthorizedBot : untrustedExecutor,
        },
        fetchWebhooks: async () => new Collection(),
        fetchIntegrations: async () => new Collection(),
    };
    unauthorizedBot.guild = botSecurityGuild;
    await handleSecurityAuditEntry({
        id: 'bot-add-audit',
        action: AuditLogEvent.BotAdd,
        targetId: unauthorizedBot.id,
        executorId: untrustedExecutor.id,
        createdTimestamp: Date.now(),
    } as never, botSecurityGuild, securityPolicy());
    assert.equal(unauthorizedBotBans, 1, 'an unauthorized bot addition must be removed immediately');
    await handleSecurityAuditEntry({
        id: 'bot-add-audit',
        action: AuditLogEvent.BotAdd,
        targetId: unauthorizedBot.id,
        executorId: untrustedExecutor.id,
        createdTimestamp: Date.now(),
    } as never, botSecurityGuild, securityPolicy());
    assert.equal(unauthorizedBotBans, 1, 'duplicate gateway delivery must not repeat a security action');

    resetServerSecurityStateForTests();
    let ownerAddedBotBans = 0;
    const ownerAddedBot: any = {
        id: 'owner-added-bot',
        client: securityClient,
        user: { id: 'owner-added-bot', bot: true, tag: 'OwnerAddedBot#0001' },
        guild: botSecurityGuild,
        ban: async () => { ownerAddedBotBans += 1; },
    };
    botSecurityGuild.members.fetch = async (id: string) => id === ownerAddedBot.id ? ownerAddedBot : untrustedExecutor;
    await handleSecurityAuditEntry({
        id: 'owner-bot-add-audit',
        action: AuditLogEvent.BotAdd,
        targetId: ownerAddedBot.id,
        executorId: botSecurityGuild.ownerId,
        createdTimestamp: Date.now(),
    } as never, botSecurityGuild, securityPolicy());
    assert.equal(ownerAddedBotBans, 0, 'the server owner must remain able to authorize a bot');

    resetServerSecurityStateForTests();
    let webhookDeletes = 0;
    const unauthorizedWebhook = {
        id: 'unauthorized-webhook',
        name: 'Unauthorized Webhook',
        delete: async () => { webhookDeletes += 1; },
    };
    const webhookSecurityGuild: any = {
        id: 'webhook-security-guild',
        name: 'Webhook Security Guild',
        ownerId: 'guild-owner',
        client: securityClient,
        members: { fetch: async () => untrustedExecutor },
        fetchWebhooks: async () => new Collection([[unauthorizedWebhook.id, unauthorizedWebhook]]),
        fetchIntegrations: async () => new Collection(),
    };
    await handleSecurityAuditEntry({
        id: 'webhook-create-audit',
        action: AuditLogEvent.WebhookCreate,
        targetId: unauthorizedWebhook.id,
        executorId: untrustedExecutor.id,
        createdTimestamp: Date.now(),
    } as never, webhookSecurityGuild, securityPolicy());
    assert.equal(webhookDeletes, 1, 'an unauthorized webhook must be deleted immediately');

    resetServerSecurityStateForTests();
    let integrationDeletes = 0;
    const unauthorizedIntegration = {
        id: 'unauthorized-integration',
        name: 'Unauthorized Integration',
        delete: async () => { integrationDeletes += 1; },
    };
    const integrationSecurityGuild: any = {
        id: 'integration-security-guild',
        name: 'Integration Security Guild',
        ownerId: 'guild-owner',
        client: securityClient,
        members: { fetch: async () => untrustedExecutor },
        fetchWebhooks: async () => new Collection(),
        fetchIntegrations: async () => new Collection([[unauthorizedIntegration.id, unauthorizedIntegration]]),
    };
    await handleSecurityAuditEntry({
        id: 'integration-create-audit',
        action: AuditLogEvent.IntegrationCreate,
        targetId: unauthorizedIntegration.id,
        executorId: untrustedExecutor.id,
        createdTimestamp: Date.now(),
    } as never, integrationSecurityGuild, securityPolicy());
    assert.equal(integrationDeletes, 1, 'an unauthorized server integration must be deleted immediately');

    const names = commandDefinitions.map(command => command.data.name);
    assert.equal(new Set(names).size, names.length, 'slash command names must be unique');
for (const required of [
        'movie-feedback', 'staff-feedback', 'partnership', 'staff-complaint', 'training-results',
        'promotion', 'infraction', 'view-infractions', 'session-start', 'session-vote', 'session-end',
        'session-boost', 'session-full', 'prohibited-word', 'say', 'loa', 'view', 'rules',
        'request-training', 'roleplay-log', 'rename', 'ticket', 'ticket-panel', 'ticketpanel', 'close', 'closerequest',
        'applications-panel', 'unclaim', 'add-member', 'remove-member', 'role', 'suggestions',
        'suggestion-approved', 'suggestion-denied', 'suggestion-maybe',
    ]) {
        assert(names.includes(required), `missing /${required}`);
    }
    for (const command of commandDefinitions) assert.doesNotThrow(() => command.data.toJSON());

    const commandNamed = (name: string) => {
        const command = commandDefinitions.find(candidate => candidate.data.name === name);
        assert(command, `missing command implementation for /${name}`);
        return command;
    };

    const viewSchema = commandNamed('view').data.toJSON() as any;
    assert(viewSchema.options.some((option: any) => option.name === 'loa' && option.type === 1),
        '/view loa must be registered as a direct subcommand');
    const sessionViewGroup = viewSchema.options.find((option: any) => option.name === 'session' && option.type === 2);
    assert(sessionViewGroup?.options.some((option: any) => option.name === 'vote' && option.type === 1),
        '/view session vote must be registered as a grouped subcommand');

    let commandListPayload: any = null;
    await commandNamed('cmds').execute({
        deferReply: async () => undefined,
        editReply: async (payload: any) => { commandListPayload = payload; },
    } as never);
    const commandListText = JSON.stringify(
        commandListPayload.components.map((component: { toJSON(): unknown }) => component.toJSON()),
    );
    for (const command of commandDefinitions) {
        assert(commandListText.includes(`/${command.data.name}`), `/cmds must list the active /${command.data.name} handler`);
    }
    assert.deepEqual(
        commandListPayload.files.map((file: { name: string }) => file.name),
        ['los-angeles-banner.png', 'underbanner.png'],
        '/cmds must attach the current generic banner and underbanner',
    );

    for (const [commandName, roleId] of [
        ['session-start', SESSION_START_AUTHORIZED_ROLE_ID],
        ['session-end', SESSION_START_AUTHORIZED_ROLE_ID],
        ['infraction', INFRACTION_AUTHORIZED_ROLE_ID],
        ['promotion', PROMOTION_AUTHORIZED_ROLE_ID],
        ['training-results', TRAINING_RESULTS_AUTHORIZED_ROLE_ID],
    ] as const) {
        const deniedReplies: any[] = [];
        await interactionCreate({
            commandName,
            guildId: 'role-gate-guild',
            guild: {
                ownerId: 'different-owner',
                members: { fetch: async () => ({ roles: { cache: new Map() } }) },
            },
            member: { roles: [] },
            memberPermissions: { has: () => true },
            user: { id: 'administrator-without-required-role' },
            isButton: () => false,
            isModalSubmit: () => false,
            isUserSelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isRepliable: () => true,
            reply: async (payload: any) => { deniedReplies.push(payload); },
        } as never);
        assert(
            deniedReplies.some(reply => String(reply.content).includes(`<@&${roleId}>`)),
            `/${commandName} must require its exact configured role even from a Discord administrator`,
        );
    }

    let suggestionPost: any = null;
    let suggestionEdit: any = null;
    const suggestionReceipts: string[] = [];
    const suggestionFollowUps: any[] = [];
    const suggestionDms: any[] = [];
    const suggestionMessage = {
        id: 'suggestion-message',
        edit: async (payload: any) => { suggestionEdit = payload; },
    };
    const suggestionChannel = {
        isSendable: () => true,
        isTextBased: () => true,
        send: async (payload: any) => {
            suggestionPost = payload;
            return suggestionMessage;
        },
        messages: { fetch: async () => suggestionMessage },
    };
    const suggestionClient = {
        channels: { fetch: async () => suggestionChannel },
        users: { fetch: async () => ({ send: async (payload: any) => { suggestionDms.push(payload); } }) },
    };
    await commandNamed('suggestions').execute({
        guildId: 'suggestion-guild',
        user: { id: 'suggestion-author', username: 'SuggestionAuthor' },
        options: { getString: () => 'Please add more community events.' },
        client: suggestionClient,
        deferReply: async () => undefined,
        editReply: async (content: string) => { suggestionReceipts.push(content); },
    } as never);
    assert.equal(suggestionPost?.flags, MessageFlags.IsComponentsV2, 'suggestions must post even when MongoDB is offline');
    const suggestionComponents = suggestionPost.components[0].toJSON().components;
    const suggestionMedia = suggestionComponents.filter((component: { type: number }) => component.type === 12);
    assert.equal(suggestionMedia[0]?.items?.[0]?.media?.url, 'attachment://suggestion-banner.png');
    assert.equal(suggestionMedia[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    assert.deepEqual(suggestionPost.files.map((file: { name: string }) => file.name), [
        'suggestion-banner.png',
        'underbanner.png',
    ]);
    const suggestionVoteRow = suggestionComponents.find((component: { type: number }) => component.type === 1);
    const suggestionVoteId = suggestionVoteRow.components[0].custom_id as string;
    const suggestionId = suggestionVoteId.split(':').at(-1)!;
    assert(suggestionReceipts.some(receipt => receipt.includes(suggestionId)));

    await handleSuggestionButton({
        customId: suggestionVoteId,
        guildId: 'suggestion-guild',
        user: { id: 'suggestion-voter', username: 'SuggestionVoter' },
        message: suggestionMessage,
        deferUpdate: async () => undefined,
        followUp: async (payload: any) => { suggestionFollowUps.push(payload); },
    } as never);
    assert.equal(suggestionEdit?.flags, MessageFlags.IsComponentsV2);
    assert(suggestionFollowUps.some(reply => String(reply.content).includes('upvote was recorded')));

    const suggestionDecisionReplies: string[] = [];
    await commandNamed('suggestion-approved').execute({
        guildId: 'suggestion-guild',
        guild: { ownerId: 'suggestion-owner' },
        user: { id: 'suggestion-owner' },
        options: { getString: () => suggestionId },
        client: suggestionClient,
        deferReply: async () => undefined,
        editReply: async (content: string) => { suggestionDecisionReplies.push(content); },
    } as never);
    assert(suggestionDecisionReplies.some(reply => reply.includes('Approved')));
    assert(suggestionDms.length === 1, 'an in-memory suggestion decision must still notify its author');
    assert(JSON.stringify(suggestionEdit).includes('Approved'));

    const restartSuggestionId = '87654321';
    const restartPanelJson = JSON.parse(
        JSON.stringify(suggestionPost.components[0].toJSON())
            .replaceAll(suggestionId, restartSuggestionId)
            .replaceAll('suggestion-author', '1489388257925005333'),
    );
    let recoveredSuggestionEdit: any = null;
    const restartSuggestionMessage = {
        id: 'restart-suggestion-message',
        channelId: '1538693259621044264',
        createdTimestamp: Date.now(),
        components: [{ toJSON: () => restartPanelJson }],
        attachments: new Collection<string, any>(),
        edit: async (payload: any) => { recoveredSuggestionEdit = payload; },
    };
    const recoveredSuggestionReplies: any[] = [];
    assert(await handleSuggestionButton({
        customId: `suggestion:vote:up:${restartSuggestionId}`,
        guildId: 'suggestion-guild',
        user: { id: 'restart-voter' },
        message: restartSuggestionMessage,
        deferUpdate: async () => undefined,
        followUp: async (payload: any) => { recoveredSuggestionReplies.push(payload); },
    } as never));
    assert.equal(recoveredSuggestionEdit?.flags, MessageFlags.IsComponentsV2,
        'suggestion voting must recover from the live V2 message after a process restart');
    assert(recoveredSuggestionReplies.some(reply => String(reply.content).includes('upvote was recorded')));

    const channelRecoveryId = '87654322';
    const channelRecoveryPanel = JSON.parse(
        JSON.stringify(suggestionPost.components[0].toJSON())
            .replaceAll(suggestionId, channelRecoveryId)
            .replaceAll('suggestion-author', '1489388257925005333'),
    );
    let channelRecoveryEdit: any = null;
    const channelRecoveryMessage: any = {
        id: 'channel-recovery-message',
        channelId: '1538693259621044264',
        createdTimestamp: Date.now(),
        components: [{ toJSON: () => channelRecoveryPanel }],
        attachments: new Collection<string, any>(),
        edit: async (payload: any) => { channelRecoveryEdit = payload; },
    };
    const channelRecoveryMessages = new Collection([[channelRecoveryMessage.id, channelRecoveryMessage]]);
    const channelRecoveryReplies: string[] = [];
    await commandNamed('suggestion-maybe').execute({
        guildId: 'suggestion-guild',
        guild: { ownerId: 'different-owner' },
        memberPermissions: { has: (permission: bigint) => permission === PermissionFlagsBits.ManageGuild },
        user: { id: 'suggestion-manager' },
        options: { getString: () => channelRecoveryId },
        client: {
            channels: {
                fetch: async () => ({
                    isTextBased: () => true,
                    messages: {
                        fetch: async (query: string | { limit: number }) => typeof query === 'string'
                            ? channelRecoveryMessage
                            : channelRecoveryMessages,
                    },
                }),
            },
            users: { fetch: async () => ({ send: async () => undefined }) },
        },
        deferReply: async () => undefined,
        editReply: async (content: string) => { channelRecoveryReplies.push(content); },
    } as never);
    assert(channelRecoveryReplies.some(reply => reply.includes('Maybe')),
        'suggestion decisions must recover a posted suggestion after memory/database state is lost');
    assert(JSON.stringify(channelRecoveryEdit).includes('Maybe'));

    const dashboardPayload = buildDashboardRefreshPayload();
    const dashboardPanel = dashboardPayload.components[0].toJSON();
    const dashboardMedia = dashboardPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(dashboardMedia[0]?.items?.[0]?.media?.url, 'attachment://dashboard-banner.png');
    assert.equal(dashboardMedia[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    assert.deepEqual(dashboardPayload.files.map(file => file.name), ['dashboard-banner.png', 'underbanner.png']);

    let regulationsPayload: any = null;
    assert(await handleDashboardSelect({
        customId: 'dashboard:menu',
        values: ['regulations'],
        deferred: false,
        replied: false,
        reply: async (payload: any) => { regulationsPayload = payload; },
    } as never));
    const regulationsPanel = regulationsPayload.components[0].toJSON();
    const regulationsMedia = regulationsPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(regulationsMedia[0]?.items?.[0]?.media?.url, 'attachment://rules-banner.png');
    assert.equal(regulationsMedia[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    assert.deepEqual(regulationsPayload.files.map((file: { name: string }) => file.name), [
        'rules-banner.png',
        'underbanner.png',
    ]);

    const rulesRefreshPayload = buildRulesPanelRefreshPayload();
    const rulesRefreshPanel = rulesRefreshPayload.components[0].toJSON();
    const rulesRefreshMedia = rulesRefreshPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(rulesRefreshMedia[0]?.items?.[0]?.media?.url, 'attachment://rules-banner.png');
    assert.equal(rulesRefreshMedia[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    const rulesMenu = rulesRefreshPanel.components
        .find((component: { type: number; components?: Array<{ custom_id?: string }> }) => component.type === 1
            && component.components?.[0]?.custom_id === 'rules:menu')
        ?.components?.[0];
    assert.deepEqual(
        rulesMenu?.options?.map((option: { value: string }) => option.value),
        ['discord', 'game', 'ticket-tos'],
        'the rules V2 menu must expose Discord Rules, Game Rules, and Ticket TOS',
    );

    let privateTicketTosPayload: any = null;
    assert(await handleRulesSelect({
        customId: 'rules:menu',
        values: ['ticket-tos'],
        reply: async (payload: any) => { privateTicketTosPayload = payload; },
    } as never));
    assert.equal(privateTicketTosPayload.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    const privateTicketTosText = JSON.stringify(privateTicketTosPayload.components[0].toJSON());
    assert(privateTicketTosText.includes('Ticket Terms of Service'));
    assert(privateTicketTosText.includes('right to close a ticket for **ANY** reason'));

    let rulesCommandChannelId = '';
    let rulesCommandPayload: any = null;
    await commandNamed('rules').execute({
        client: {
            user: { id: 'rules-bot' },
            channels: {
                fetch: async (channelId: string) => {
                    rulesCommandChannelId = channelId;
                    return {
                        isTextBased: () => true,
                        isSendable: () => true,
                        messages: { fetch: async () => null },
                        send: async (payload: any) => { rulesCommandPayload = payload; },
                    };
                },
            },
        },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    assert.equal(rulesCommandChannelId, '1526046592187105421');
    assert.equal(rulesCommandPayload.flags, MessageFlags.IsComponentsV2);

    let marketplacePayload: any = null;
    await commandNamed('marketplace-panel').execute({
        guild: {
            members: {
                fetch: async () => ({
                    permissions: { has: () => true },
                    roles: { cache: new Map() },
                }),
            },
        },
        user: { id: 'marketplace-admin' },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { marketplacePayload = payload; },
                }),
            },
        },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    const marketplacePanel = marketplacePayload.components[0].toJSON();
    const marketplaceMedia = marketplacePanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(marketplaceMedia[0]?.items?.[0]?.media?.url, 'attachment://paid-ad-banner.png');
    assert.equal(marketplaceMedia[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    assert.deepEqual(marketplacePayload.files.map((file: { name: string }) => file.name), [
        'paid-ad-banner.png',
        'underbanner.png',
    ]);
    const marketplaceItems = marketplacePanel.components
        .filter((component: { type: number }) => component.type === 9)
        .map((component: {
            components?: Array<{ content?: string }>;
            accessory?: { custom_id?: string; label?: string };
        }) => ({
            title: component.components?.[0]?.content?.split('\n')[0],
            id: component.accessory?.custom_id,
            price: component.accessory?.label,
        }));
    assert.deepEqual(marketplaceItems, [
        { title: '**Paid Ad — @everyone**', id: 'marketplace:price:paid-ad-everyone', price: '800' },
        { title: '**Paid Ad — @here**', id: 'marketplace:price:paid-ad-here', price: '450' },
        { title: '**Sponsored — @everyone**', id: 'marketplace:price:sponsored-everyone', price: '650' },
        { title: '**Sponsored — @here**', id: 'marketplace:price:sponsored-here', price: '350' },
        { title: '**Instant Post**', id: 'marketplace:price:instant-post', price: '1500' },
        { title: '**Priority**', id: 'marketplace:price:priority', price: '1000' },
    ]);
    assert(!JSON.stringify(marketplacePanel).includes('marketplace:price:plus'),
        'the removed Plus package must not appear in the marketplace');

    const persistentSpecs = [
        ['1526049604712529971', 'dashboard:menu', 'dashboard-banner.png'],
        ['1526034504953892925', 'ticket:create-select', 'assistance-banner.png'],
        ['1526046592187105421', 'rules:menu', 'rules-banner.png'],
        ['1526035041593856182', 'applications:type', 'applications-banner.png'],
        ['1526035127606706196', 'marketplace:claim', 'paid-ad-banner.png'],
    ] as const;
    const persistentPanelEdits = new Map<string, any>();
    const persistentChannels = new Map(persistentSpecs.map(([channelId, marker]) => [
        channelId,
        {
            isTextBased: () => true,
            guild: null,
            messages: {
                fetch: async () => new Collection([[
                    `old-panel-${channelId}`,
                    {
                        author: { id: 'persistent-banner-bot' },
                        components: [{ toJSON: () => ({ type: 17, components: [{ custom_id: marker }] }) }],
                        edit: async (payload: any) => { persistentPanelEdits.set(channelId, payload); },
                    },
                ]]),
            },
        },
    ]));
    await refreshPersistentPanels({
        user: { id: 'persistent-banner-bot' },
        channels: { fetch: async (channelId: string) => persistentChannels.get(channelId) || null },
    } as never);
    assert.equal(persistentPanelEdits.size, 5, 'startup must rebuild every persistent branded panel');
    for (const [channelId, , bannerName] of persistentSpecs) {
        const refreshed = persistentPanelEdits.get(channelId);
        assert.deepEqual(refreshed.attachments, [], `${bannerName} refresh must clear old Discord attachments`);
        assert.deepEqual(refreshed.files.map((file: { name: string }) => file.name), [bannerName, 'underbanner.png']);
        const panel = refreshed.components[0].toJSON();
        const media = panel.components.filter((component: { type: number }) => component.type === 12);
        assert.equal(media[0]?.items?.[0]?.media?.url, `attachment://${bannerName}`);
        assert.equal(media.at(-1)?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    }

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
        isUserSelectMenu: () => false,
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

    let directPartnershipModal: any = null;
    await commandNamed('partnership').execute({
        channelId: 'partnership-command-channel',
        user: { id: 'partnership-command-user' },
        options: { getSubcommand: () => 'request' },
        showModal: async (modal: any) => { directPartnershipModal = modal; },
    } as never);
    assert.equal(directPartnershipModal?.toJSON().custom_id, 'partnership:request-modal');

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
    assert.equal(partnershipRequestMedia.length, 2, 'partnership review requests must include the named top banner and underbanner');
    assert.equal(partnershipRequestMedia[0]?.items?.[0]?.media?.url, 'attachment://partnership-banner.png');
    assert.equal(partnershipRequestMedia[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    assert(partnershipRequestPanel.components.some((component: { content?: string }) => component.content === fullPartnershipAd),
        'the full submitted advertisement must be retained in its own V2 text component');
    assert(partnershipReplies.some(reply => reply.includes('submitted for staff review')));

    let reviewedPartnership: any = null;
    let approvedPartnership: any = null;
    const assignedPartnershipRoles: string[] = [];
    const partnershipApprovalReplies: string[] = [];
    const partnershipSourceMessage = {
        components: partnershipSubmission.components,
        embeds: [],
        attachments: new Collection([
            ['partnership-banner', { id: 'partnership-banner', name: 'partnership-banner.png' }],
            ['partnership-underbanner', { id: 'partnership-underbanner', name: 'underbanner.png' }],
        ]),
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
    assert.equal(approvedPartnershipMedia.length, 2, 'approved partnership emblems must include the named top banner and underbanner');
    assert.equal(approvedPartnershipMedia[0]?.items?.[0]?.media?.url, 'attachment://partnership-banner.png');
    assert.equal(approvedPartnershipMedia[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
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
    assert.equal(complaintSubmission?.flags, MessageFlags.IsComponentsV2);
    assert.equal(complaintSubmission?.embeds, undefined);
    assert(JSON.stringify(complaintSubmission).includes('📋 Staff Complaint Received'));
    assert(JSON.stringify(complaintSubmission).includes('attachment://los-angeles-banner.png'));
    assert(JSON.stringify(complaintSubmission).includes('attachment://underbanner.png'));
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
    const moviePublic = JSON.stringify(movieSends[0].payload);
    const movieAudit = JSON.stringify(movieSends[1].payload);
    assert.equal(movieSends[0].payload.flags, MessageFlags.IsComponentsV2);
    assert.equal(movieSends[0].payload.embeds, undefined);
    assert(moviePublic.includes('🎬 Movie Feedback'));
    assert(moviePublic.includes(`${'⭐'.repeat(8)}\\n**8/10**`));
    assert(moviePublic.includes('Submitted by therealstickyz_35430'));
    assert(moviePublic.includes('attachment://los-angeles-banner.png'));
    assert(moviePublic.includes('attachment://underbanner.png'));
    assert(movieAudit.includes('Discord ID') && movieAudit.includes('1489388257925005508'));

    const staffFeedbackSends: any[] = [];
    await commandNamed('staff-feedback').execute({
        deferReply: async () => undefined,
        editReply: async () => undefined,
        options: {
            getUser: () => ({ id: 'feedback-staff' }),
            getInteger: () => 9,
            getString: (name: string) => name === 'feedback' ? 'Helpful and professional.' : 'No evidence needed.',
            getBoolean: () => false,
        },
        user: { id: 'feedback-author', username: 'FeedbackAuthor' },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { staffFeedbackSends.push(payload); return {}; },
                }),
            },
        },
    } as never);
    assert.equal(staffFeedbackSends.length, 2, 'staff feedback must publish publicly and write its private audit');
    assert(staffFeedbackSends.every(payload => payload.flags === MessageFlags.IsComponentsV2));
    assert(staffFeedbackSends.every(payload => payload.embeds === undefined));
    assert(JSON.stringify(staffFeedbackSends[0]).includes('💬 Staff Feedback'));
    assert(JSON.stringify(staffFeedbackSends[0]).includes('attachment://staff-feedback-banner.png'));
    assert(JSON.stringify(staffFeedbackSends[0]).includes('attachment://underbanner.png'));

    let trainingRequestPost: any = null;
    await handleTrainingModal({
        customId: 'training:request-modal',
        user: { id: 'training-requester' },
        fields: {
            getTextInputValue: (name: string) => name === 'timezone' ? 'EST' : 'Saturday at 5 PM',
        },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { trainingRequestPost = payload; return {}; },
                }),
            },
        },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    assert.equal(trainingRequestPost?.flags, MessageFlags.IsComponentsV2);
    assert.equal(trainingRequestPost?.embeds, undefined);
    assert(JSON.stringify(trainingRequestPost).includes('🎓 Training Request'));
    assert(JSON.stringify(trainingRequestPost).includes('attachment://training-request-banner.png'));
    assert(JSON.stringify(trainingRequestPost).includes('attachment://underbanner.png'));

    const trainingSends: any[] = [];
    const trainingUsers = {
        trainee: { id: '1489388257925005508' },
        trainer: { id: '1523122912201277590' },
    };
    const trainingInteraction = {
        deferReply: async () => undefined,
        editReply: async () => undefined,
        member: {
            roles: { cache: new Map([[TRAINING_RESULTS_AUTHORIZED_ROLE_ID, { id: TRAINING_RESULTS_AUTHORIZED_ROLE_ID }]]) },
        },
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
    const trainingPanel = trainingSends[0].components[0].toJSON();
    assert.equal(trainingSends[0].flags, MessageFlags.IsComponentsV2);
    assert.equal(trainingSends[0].embeds, undefined);
    assert.equal(trainingPanel.accent_color, 0x22c55e, 'Pass training results must be green');
    assert(JSON.stringify(trainingPanel).includes('Average') && JSON.stringify(trainingPanel).includes('9.2/10'));
    assert(JSON.stringify(trainingPanel).includes('attachment://training-results-banner.png'));
    assert(JSON.stringify(trainingPanel).includes('attachment://underbanner.png'));

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
    const communityMemberRole = {
        id: '1521593407762464946',
        name: 'Community Member',
        managed: true,
        position: 1_000,
        toString: () => '<@&1521593407762464946>',
    };
    const selectedRole = {
        id: '1523122834161926238',
        name: 'Senior Staff',
        managed: false,
        position: 10,
        toString: () => '<@&1523122834161926238>',
    };
    const promotedRoleCache = new Collection<string, any>([[communityMemberRole.id, communityMemberRole]]);
    const removedPromotionRoles: string[] = [];
    const targetPromotionMember = {
        roles: {
            cache: promotedRoleCache,
            add: async (roleId: string) => { promotedRoleCache.set(roleId, selectedRole); },
            remove: async (roleId: string) => {
                removedPromotionRoles.push(roleId);
                promotedRoleCache.delete(roleId);
            },
        },
    };
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
        guild: {
            members: {
                me: { roles: { highest: { position: 100 } } },
                fetch: async (memberId: string) => {
                    assert.equal(memberId, promotedMember.id);
                    return targetPromotionMember;
                },
            },
        },
        options: {
            getSubcommand: () => 'issue',
            getUser: (name: string) => name === 'member' ? promotedMember : approvedBy,
            getRole: (name: string) => name === 'old-rank' ? communityMemberRole : selectedRole,
            getString: (name: string) => ({
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
    assert.equal(promotionBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    assert.deepEqual(
        promotionSends[0].files.map((file: { name: string }) => file.name),
        ['promotion-banner.png', 'underbanner.png'],
    );
    const promotionText = promotionPanel.components
        .flatMap((component: { components?: Array<{ content?: string }> }) => component.components || [])
        .map((component: { content?: string }) => component.content || '')
        .join('\n');
    assert(promotionText.includes(`<@${promotedMember.id}>`), 'promotion post must mention the promoted member');
    assert(promotionText.includes(`<@&${selectedRole.id}>`), 'promotion post must display the selected new role');
    assert(promotionText.includes('Old Rank Retained'), 'Community Member must be identified as retained');
    assert(promotedRoleCache.has(communityMemberRole.id), 'promotion must preserve the locked Community Member role');
    assert(promotedRoleCache.has(selectedRole.id), 'promotion must add the selected new role');
    assert.deepEqual(removedPromotionRoles, [], 'promotion must not attempt to remove Community Member');
    assert.equal(promotionDms.length, 1, 'the promoted member must receive a DM');
    assert.equal(promotionDms[0].flags, 32_768, 'the promotion DM must retain the V2 artwork panel');
    assert.equal(promotionReplies.length, 1, 'promotion must report the completed role update once');
    assert(promotionReplies[0].includes('kept') && promotionReplies[0].includes('added'));
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

    // A freshly submitted request must approve exactly once. A duplicate
    // click while role assignment is still running may report "in progress"
    // but must not release the first reviewer's lock or claim it was processed.
    const freshLoaUserId = '1489388257925006999';
    let freshLoaRequestPayload: any = null;
    let freshLoaRequestDeleted = false;
    let freshLoaRoleAdds = 0;
    const freshLoaResults: any[] = [];
    const freshLoaMember = {
        id: freshLoaUserId,
        user: { tag: 'FreshLoa#0001', username: 'FreshLoa' },
        roles: {
            add: async () => undefined,
            remove: async () => undefined,
        },
        send: async () => undefined,
    };
    let releaseFreshRoleAdd = (): void => undefined;
    let signalFreshRoleAdd = (): void => undefined;
    const freshRoleAddStarted = new Promise<void>(resolve => { signalFreshRoleAdd = resolve; });
    const freshRoleAddGate = new Promise<void>(resolve => { releaseFreshRoleAdd = resolve; });
    freshLoaMember.roles.add = async () => {
        freshLoaRoleAdds += 1;
        signalFreshRoleAdd();
        await freshRoleAddGate;
    };
    const freshLoaChannel = {
        id: '1528206019237515344',
        isSendable: () => true,
        isTextBased: () => true,
        send: async (payload: any) => {
            const serialized = JSON.stringify(payload);
            if (serialized.includes('Request Submitted')) freshLoaRequestPayload = payload;
            else freshLoaResults.push(payload);
            return { id: 'fresh-loa-request-message' };
        },
        messages: {
            fetch: async () => ({ delete: async () => { freshLoaRequestDeleted = true; } }),
        },
    };
    const freshLoaClient = {
        channels: { fetch: async () => freshLoaChannel },
        guilds: {
            fetch: async () => ({ members: { fetch: async () => freshLoaMember } }),
        },
    };
    const freshLoaSubmitReplies: string[] = [];
    await handleLoaModal({
        customId: 'loa:request:modal',
        guildId: 'fresh-loa-guild',
        guild: {},
        user: { id: freshLoaUserId, username: 'FreshLoa' },
        fields: {
            getTextInputValue: (name: string) => ({
                name: 'Fresh LOA Member',
                start_date: 'August 16, 2026',
                end_date: 'August 20, 2026',
                reason: 'Family travel.',
            } as Record<string, string>)[name],
        },
        client: freshLoaClient,
        deferReply: async () => undefined,
        editReply: async (reply: string) => { freshLoaSubmitReplies.push(reply); },
    } as never);
    assert(freshLoaRequestPayload, 'a fresh LOA submission must create its review message');
    assert(freshLoaSubmitReplies.some(reply => reply.includes('submitted for review')));
    const freshLoaPanelComponents = freshLoaRequestPayload.components[0].toJSON().components;
    const freshLoaReviewRow = freshLoaPanelComponents.find((component: { type: number }) => component.type === 1);
    const freshLoaCustomId = freshLoaReviewRow.components[0].custom_id;
    const freshFirstReplies: string[] = [];
    const freshSecondReplies: string[] = [];
    const freshMessage = {
        id: 'fresh-loa-request-message',
        channelId: freshLoaChannel.id,
        embeds: [],
        components: freshLoaRequestPayload.components,
        createdAt: new Date(),
    };
    const firstFreshApproval = handleLoaButton({
        customId: freshLoaCustomId,
        guildId: 'fresh-loa-guild',
        user: { id: 'fresh-loa-reviewer-one' },
        memberPermissions: { has: () => true },
        member: { roles: { cache: new Map() } },
        message: freshMessage,
        client: freshLoaClient,
        deferReply: async () => undefined,
        editReply: async (reply: string) => { freshFirstReplies.push(reply); },
    } as never);
    await freshRoleAddStarted;
    const secondFreshHandled = await handleLoaButton({
        customId: freshLoaCustomId,
        guildId: 'fresh-loa-guild',
        user: { id: 'fresh-loa-reviewer-two' },
        memberPermissions: { has: () => true },
        member: { roles: { cache: new Map() } },
        message: freshMessage,
        client: freshLoaClient,
        deferReply: async () => undefined,
        editReply: async (reply: string) => { freshSecondReplies.push(reply); },
    } as never);
    assert(secondFreshHandled);
    assert(freshSecondReplies.some(reply => reply.includes('already in progress')));
    assert(!freshSecondReplies.some(reply => reply.includes('already been processed')));
    releaseFreshRoleAdd();
    assert(await firstFreshApproval);
    assert.equal(freshLoaRoleAdds, 1, 'duplicate LOA approval clicks must never assign the role twice');
    assert(freshFirstReplies.some(reply => reply.includes('approved')));
    assert.equal(freshLoaResults.length, 1, 'fresh LOA approval must publish one result');
    assert(freshLoaRequestDeleted, 'fresh LOA approval must delete the completed review request');

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
    assert.equal(initialBanners[0]?.items?.[0]?.media?.url, 'attachment://los-angeles-banner.png');
    assert.equal(initialBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    assert.deepEqual(
        infractionParentSends[0].files.map((file: { name: string }) => file.name),
        ['los-angeles-banner.png', 'underbanner.png'],
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
    assert.equal(infractionDmBanners[0]?.items?.[0]?.media?.url, 'attachment://los-angeles-banner.png');
    assert.equal(infractionDmBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
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
        member: {
            roles: { cache: new Map([[INFRACTION_AUTHORIZED_ROLE_ID, { id: INFRACTION_AUTHORIZED_ROLE_ID }]]) },
        },
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
    assert.equal(viewInfractionBanners[0]?.items?.[0]?.media?.url, 'attachment://los-angeles-banner.png');
    assert.equal(viewInfractionBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
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
        ['session-full', 'los-angeles-banner.png'],
    ]);
    const erlcSsdRequests: Array<{ url: string; command: string; serverKey: string | null }> = [];
    const originalErlcServerKey = process.env.ERLC_SERVER_KEY;
    const originalFetch = globalThis.fetch;
    process.env.ERLC_SERVER_KEY = 'ssd-test-server-key';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body || '{}')) as { command?: string };
        erlcSsdRequests.push({
            url: String(input),
            command: body.command || '',
            serverKey: headers.get('server-key'),
        });
        return new Response(JSON.stringify({ message: 'Success' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;
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
            member: {
                roles: { cache: new Map([[SESSION_START_AUTHORIZED_ROLE_ID, { id: SESSION_START_AUTHORIZED_ROLE_ID }]]) },
            },
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
        assert.equal(sessionPanel.components.at(-1)?.items?.[0]?.media?.url, 'attachment://underbanner.png');
        assert.deepEqual(
            sessionPayload.files.map((file: { name: string }) => file.name),
            [bannerName, 'underbanner.png'],
        );
        const sessionText = sessionPanel.components
            .flatMap((component: { components?: Array<{ content?: string }> }) => component.components || [])
            .map((component: { content?: string }) => component.content || '')
            .join('\n');
        if (commandName === 'session-end') {
            assert.equal(sessionPayload.allowedMentions.roles, undefined, '/session-end must not ping the session role');
            assert(!sessionText.includes('<@&1521593407749754990>'), '/session-end must not mention the session role');
        } else {
            assert.deepEqual(sessionPayload.allowedMentions.roles, ['1521593407749754990']);
            assert(sessionText.includes('<@&1521593407749754990>'), `/${commandName} must mention the session role inside its V2 emblem`);
        }
        if (commandName === 'session-vote') sessionVotePayload = sessionPayload;
    }
    assert.equal(deletedSessionMessages, 2, '/session-end must delete every prior bot session announcement only');

    let enhancedSessionEndReply = '';
    let enhancedSessionEndPayload: any = null;
    const enhancedSessionChannel = {
        id: '1526036392147423404',
        isTextBased: () => true,
        isSendable: () => true,
        messages: { fetch: async () => new Collection<string, any>() },
        send: async (payload: any) => {
            enhancedSessionEndPayload = payload;
            return { id: 'enhanced-session-end-message' };
        },
    };
    await interactionCreate({
        commandName: 'session-end',
        guildId: 'session-end-guild',
        guild: { ownerId: 'different-owner', members: { fetch: async () => null } },
        member: { roles: [SESSION_START_AUTHORIZED_ROLE_ID] },
        memberPermissions: { has: () => false },
        user: { id: 'authorized-session-host' },
        client: {
            user: { id: 'session-bot' },
            channels: { fetch: async () => enhancedSessionChannel },
        },
        isButton: () => false,
        isModalSubmit: () => false,
        isUserSelectMenu: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => true,
        isRepliable: () => true,
        deferReply: async () => undefined,
        editReply: async (payload: any) => { enhancedSessionEndReply = String(payload); },
        reply: async () => { throw new Error('an authorized SSD must use the enhanced session handler'); },
    } as never);
    assert(enhancedSessionEndPayload, 'the live /session-end route must post its Session End panel');
    assert(enhancedSessionEndReply.includes('every current player was kicked'), 'the live /session-end route must confirm the ER:LC kick-all action');

    let unavailableSessionChannelReply = '';
    await interactionCreate({
        commandName: 'session-end',
        guildId: 'session-end-guild',
        guild: { ownerId: 'different-owner', members: { fetch: async () => null } },
        member: { roles: [SESSION_START_AUTHORIZED_ROLE_ID] },
        memberPermissions: { has: () => false },
        user: { id: 'authorized-session-host' },
        client: {
            user: { id: 'session-bot' },
            channels: { fetch: async () => null },
        },
        isButton: () => false,
        isModalSubmit: () => false,
        isUserSelectMenu: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => true,
        isRepliable: () => true,
        deferReply: async () => undefined,
        editReply: async (payload: any) => { unavailableSessionChannelReply = String(payload); },
        reply: async () => { throw new Error('an authorized SSD must use the enhanced session handler'); },
    } as never);
    assert(unavailableSessionChannelReply.includes('unavailable'));
    assert(unavailableSessionChannelReply.includes('every current player was kicked'),
        'SSD must still kick all ER:LC players when the Discord announcement channel is unavailable');

    assert.equal(erlcSsdRequests.length, 3, 'each session-end execution must run exactly one ER:LC SSD command');
    for (const request of erlcSsdRequests) {
        assert.equal(request.url, ERLC_COMMAND_ENDPOINT, 'SSD must use the current ER:LC v2 command endpoint');
        assert.equal(request.command, ERLC_SSD_COMMAND, 'SSD must kick every player with :kick all');
        assert.equal(request.serverKey, 'ssd-test-server-key');
    }
    globalThis.fetch = originalFetch;
    if (originalErlcServerKey === undefined) delete process.env.ERLC_SERVER_KEY;
    else process.env.ERLC_SERVER_KEY = originalErlcServerKey;

    let sessionVoteEdit: any = null;
    const sessionVoteReplies: string[] = [];
    let sessionVoteDeferred = false;
    const liveSessionVotePanel = JSON.parse(JSON.stringify(sessionVotePayload.components[0].toJSON()));
    const replaceVoteMediaUrls = (node: any): void => {
        if (node.media?.url === 'attachment://session-vote-banner.png') {
            node.media.url = 'https://cdn.discordapp.com/attachments/channel/session-vote-banner.png';
        } else if (node.media?.url === 'attachment://underbanner.png') {
            node.media.url = 'https://cdn.discordapp.com/attachments/channel/underbanner.png';
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
            edit: async (payload: any) => { sessionVoteEdit = payload; },
        },
        deferUpdate: async () => { sessionVoteDeferred = true; },
        followUp: async (payload: any) => { sessionVoteReplies.push(payload.content); },
    } as never);
    assert(sessionVoteDeferred, 'vote buttons must acknowledge by deferring an update to the original message');
    assert.equal(sessionVoteEdit?.flags, undefined,
        'vote updates must retain the existing immutable Components V2 flag instead of trying to rewrite it');
    assert.equal(sessionVoteEdit?.attachments, undefined, 'vote updates must retain the original media without re-uploading it');
    const editedVotePanel = sessionVoteEdit.components[0];
    assert.equal(
        editedVotePanel.components[0]?.items?.[0]?.media?.url,
        'https://cdn.discordapp.com/attachments/channel/session-vote-banner.png',
        'vote updates must preserve the live Discord CDN banner URL',
    );
    assert.equal(
        editedVotePanel.components.at(-1)?.items?.[0]?.media?.url,
        'https://cdn.discordapp.com/attachments/channel/underbanner.png',
        'vote updates must preserve the live Discord CDN underbanner URL',
    );
    assert(sessionVoteReplies.some(reply => reply.includes('1/5')));

    const persistentVoterId = '1489388257925005777';
    let persistentVotePayload: any = null;
    let voterPingStartPayload: any = null;
    const persistentSessionChannel = {
        id: '1526036392147423404',
        isTextBased: () => true,
        isSendable: () => true,
        messages: { fetch: async () => new Collection<string, any>() },
        send: async (payload: any) => {
            const serialized = JSON.stringify(payload.components?.map((component: any) => component.toJSON?.() || component));
            if (serialized.includes('SESSION VOTE')) {
                persistentVotePayload = payload;
                return { id: 'persistent-session-vote-message' };
            }
            voterPingStartPayload = payload;
            return { id: 'voter-ping-session-start-message' };
        },
    };
    await commandNamed('session-vote').execute({
        commandName: 'session-vote',
        guildId: 'persistent-session-guild',
        user: { id: '1489388257925005666', username: 'SessionHost' },
        options: { getInteger: () => 3 },
        client: { channels: { fetch: async () => persistentSessionChannel } },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    assert(persistentVotePayload, 'the live session vote handler must post a durable vote panel');
    const persistentVotePanel = JSON.parse(JSON.stringify(persistentVotePayload.components[0].toJSON()));
    replaceVoteMediaUrls(persistentVotePanel);
    let persistentVoteUpdate: any = null;
    await interactionCreate({
        customId: 'session:vote:cast:3',
        guildId: 'persistent-session-guild',
        user: { id: persistentVoterId, username: 'PersistentVoter' },
        message: {
            id: 'persistent-session-vote-message',
            components: [{ toJSON: () => persistentVotePanel }],
        },
        isButton: () => true,
        isModalSubmit: () => false,
        isUserSelectMenu: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => false,
        isRepliable: () => true,
        deferUpdate: async () => undefined,
        editReply: async (payload: any) => { persistentVoteUpdate = payload; },
        followUp: async () => undefined,
    } as never);
    assert(persistentVoteUpdate, 'the durable voter handler must update the V2 vote panel');
    assert.equal(persistentVoteUpdate.flags, undefined,
        'durable vote updates must preserve the existing immutable Components V2 flag');

    await commandNamed('session-start').execute({
        commandName: 'session-start',
        guildId: 'persistent-session-guild',
        guild: { members: { fetch: async () => null } },
        member: { roles: { cache: new Map([[SESSION_START_AUTHORIZED_ROLE_ID, {}]]) } },
        user: { id: '1489388257925005666', username: 'SessionHost' },
        client: { channels: { fetch: async () => persistentSessionChannel } },
        deferReply: async () => undefined,
        editReply: async () => undefined,
    } as never);
    const voterPingStartText = JSON.stringify(voterPingStartPayload.components[0].toJSON());
    assert(voterPingStartText.includes(`<@${persistentVoterId}>`),
        'session-start must include every latest SSU voter in its V2 panel');
    assert(voterPingStartPayload.allowedMentions.users.includes(persistentVoterId),
        'session-start must allow Discord to actually notify every latest SSU voter');

    let sessionVoteViewDeferred: any = null;
    let sessionVoteViewPayload: any = null;
    await commandNamed('view').execute({
        guildId: 'persistent-session-guild',
        options: {
            getSubcommandGroup: () => 'session',
            getSubcommand: () => 'vote',
        },
        deferReply: async (payload: any) => { sessionVoteViewDeferred = payload; },
        editReply: async (payload: any) => { sessionVoteViewPayload = payload; },
    } as never);
    assert.equal(sessionVoteViewDeferred.flags, MessageFlags.Ephemeral,
        '/view session vote must be private to the command user');
    assert.equal(sessionVoteViewPayload.flags, MessageFlags.IsComponentsV2,
        '/view session vote must use a Components V2 panel');
    assert(JSON.stringify(sessionVoteViewPayload.components[0].toJSON()).includes(`<@${persistentVoterId}>`),
        '/view session vote must list the recorded SSU voters');

    const activeLoaUserId = '1489388257925005888';
    const activeLoaStart = Math.floor((Date.now() - 60_000) / 1_000);
    const activeLoaEnd = Math.floor((Date.now() + 86_400_000) / 1_000);
    const activeLoaMessage = {
        components: [{
            toJSON: () => ({
                type: 17,
                components: [
                    { type: 10, content: `**Member**\n<@${activeLoaUserId}>` },
                    { type: 10, content: '**Name**\nActive LOA Member' },
                    { type: 10, content: `**Start Date**\n<t:${activeLoaStart}:F>` },
                    { type: 10, content: `**End Date**\n<t:${activeLoaEnd}:F>` },
                    { type: 1, components: [{ custom_id: `loa:active:end-early:${activeLoaUserId}-test` }] },
                ],
            }),
        }],
    };
    let loaViewDeferred = false;
    let loaViewPayload: any = null;
    await commandNamed('view').execute({
        guildId: 'persistent-session-guild',
        options: {
            getSubcommandGroup: () => null,
            getSubcommand: () => 'loa',
        },
        client: {
            channels: {
                fetch: async (channelId: string) => {
                    assert.equal(channelId, '1541223750832357456');
                    return { messages: { fetch: async () => new Collection([['active-loa-message', activeLoaMessage]]) } };
                },
            },
        },
        deferReply: async () => { loaViewDeferred = true; },
        editReply: async (payload: any) => { loaViewPayload = payload; },
    } as never);
    assert(loaViewDeferred, '/view loa must acknowledge before loading active records');
    assert.equal(loaViewPayload.flags, MessageFlags.IsComponentsV2, '/view loa must post a Components V2 emblem');
    const loaViewText = JSON.stringify(loaViewPayload.components[0].toJSON());
    assert(loaViewText.includes('Active Leaves of Absence'));
    assert(loaViewText.includes(`<@${activeLoaUserId}>`), '/view loa must list active LOA members');
    assert.deepEqual(loaViewPayload.allowedMentions, { parse: [] }, '/view loa must not ping every listed member');

    let ticketPanelPayload: any = null;
    let fetchedTicketPanelChannelId = '';
    const ticketPanelConfirmations: string[] = [];
    const ticketPanelDestination = {
        isTextBased: () => true,
        isSendable: () => true,
        messages: { fetch: async () => null },
        send: async (payload: any) => { ticketPanelPayload = payload; },
    };
    await commandNamed('ticket-panel').execute({
        client: {
            user: { id: 'ticket-bot' },
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
    assert.equal(ticketLauncherBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
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
                            isTextBased: () => true,
                            isSendable: () => true,
                            messages: { fetch: async () => null },
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

    const ticketGateUser = {
        id: '1489388257925005511',
        username: 'TicketUser',
        tag: 'TicketUser#0001',
        createdTimestamp: 1_600_000_000_000,
    };
    const realDateNow = Date.now;
    const realSetTimeout = global.setTimeout;
    Date.now = () => realDateNow() - 11_000;
    (global as any).setTimeout = (callback: () => void) => {
        callback();
        return { unref: () => undefined };
    };
    let ticketGatePayload: any = null;
    let ticketGateReadingPayload: any = null;
    let ticketGateUnlockedPayload: any = null;
    let earlyGateRejection = '';
    let generalTicketModal: any = null;
    try {
        assert(await handleTicketSelect({
            customId: 'ticket:create-select',
            values: ['general'],
            guildId: 'ticket-guild',
            user: ticketGateUser,
            reply: async (payload: any) => { ticketGatePayload = payload; },
        } as never));
        assert.equal(ticketGatePayload.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            'selecting a category must open a private V2 reading gate instead of the ticket modal');
        const gatePanel = ticketGatePayload.components[0].toJSON();
        const gateButtons = gatePanel.components
            .filter((component: { type: number }) => component.type === 1)
            .flatMap((component: { components?: Array<{ custom_id?: string }> }) => component.components || []);
        const faqButtonId = gateButtons.find((button: { custom_id?: string }) => button.custom_id?.startsWith('ticket:gate:faq:'))?.custom_id;
        const tosButtonId = gateButtons.find((button: { custom_id?: string }) => button.custom_id?.startsWith('ticket:gate:tos:'))?.custom_id;
        assert(faqButtonId && tosButtonId, 'the reading gate must offer FAQ and Ticket TOS buttons');
        const gateToken = faqButtonId.split(':')[3];

        assert(await handleTicketButton({
            customId: faqButtonId,
            guildId: 'ticket-guild',
            user: ticketGateUser,
            reply: async (payload: any) => { ticketGateReadingPayload = payload; },
            editReply: async (payload: any) => { ticketGateUnlockedPayload = payload; },
        } as never));
        assert.equal(ticketGateReadingPayload.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
        assert(JSON.stringify(ticketGateReadingPayload.components[0].toJSON()).includes('Frequently Asked Questions'));
        assert(!JSON.stringify(ticketGateReadingPayload.components[0].toJSON()).includes('ticket:gate:continue:'),
            'the red continuation button must remain hidden during the reading delay');
        const unlockedGateJson = JSON.stringify(ticketGateUnlockedPayload.components[0].toJSON());
        assert(unlockedGateJson.includes('ticket:gate:continue:'),
            'the reading timer must add Still Need Assistance to the same private V2 message');
        assert(unlockedGateJson.includes('"style":4'), 'Still Need Assistance must be a red Danger button');

        assert(await handleTicketButton({
            customId: `ticket:gate:continue:${gateToken}`,
            guildId: 'ticket-guild',
            user: ticketGateUser,
            reply: async (payload: any) => { earlyGateRejection = payload.content; },
            showModal: async (modal: any) => { generalTicketModal = modal; },
        } as never));
        assert(earlyGateRejection.includes('at least 10 seconds'));
        assert.equal(generalTicketModal, null, 'the ticket form must stay locked during the 10-second delay');
    } finally {
        Date.now = realDateNow;
        global.setTimeout = realSetTimeout;
    }

    const gateToken = ticketGatePayload.components[0].toJSON().components
        .filter((component: { type: number }) => component.type === 1)
        .flatMap((component: { components?: Array<{ custom_id?: string }> }) => component.components || [])
        .find((button: { custom_id?: string }) => button.custom_id?.startsWith('ticket:gate:faq:'))
        .custom_id.split(':')[3];
    assert(await handleTicketButton({
        customId: `ticket:gate:continue:${gateToken}`,
        guildId: 'ticket-guild',
        user: ticketGateUser,
        reply: async () => undefined,
        showModal: async (modal: any) => { generalTicketModal = modal; },
    } as never));
    assert.equal(generalTicketModal?.toJSON().custom_id, `ticket:create-modal:general:${gateToken}`);
    assert.equal(generalTicketModal?.toJSON().components[0]?.components?.[0]?.custom_id, 'reason');

    let directModalRejection = '';
    assert(await handleTicketModal({
        customId: 'ticket:create-modal:general',
        guildId: 'ticket-guild',
        user: ticketGateUser,
        reply: async (payload: any) => { directModalRejection = payload.content; },
    } as never));
    assert(directModalRejection.includes('review the FAQ or Ticket TOS'),
        'a direct or stale modal must not bypass the reading gate');

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
                    ['underbanner', { id: 'underbanner', name: 'underbanner.png' }],
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
        customId: generalTicketModal.toJSON().custom_id,
        guildId: 'ticket-guild',
        guild: ticketGuild,
        client: { user: { id: 'ticket-bot' } },
        user: ticketGateUser,
        fields: { getTextInputValue: () => 'I need help with the server.' },
        deferReply: async () => undefined,
        editReply: async (content: string) => { ticketCreationReplies.push(content); },
    } as never));
    assert.equal(ticketCreateOptions.parent, '1526254341646712883');
    assert.match(ticketCreateOptions.name, /^gen-i-need-help-with-the-ser-5511$/,
        'ticket names must be short and use the actual opening reason instead of a timestamp');
    assert.equal(openTicketPayload.flags, 32_768, 'new tickets must open with a V2 Assistance emblem');
    const openTicketPanel = openTicketPayload.components[0].toJSON();
    const openTicketBanners = openTicketPanel.components.filter((component: { type: number }) => component.type === 12);
    assert.equal(openTicketBanners[0]?.items?.[0]?.media?.url, 'attachment://assistance-banner.png');
    assert.equal(openTicketBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
    const openTicketButtons = openTicketPanel.components
        .filter((component: { type: number }) => component.type === 1)
        .flatMap((component: { components?: Array<{ custom_id?: string }> }) => component.components || [])
        .map((button: { custom_id?: string }) => button.custom_id);
    assert.deepEqual(openTicketButtons, ['ticket:claim', 'ticket:close', 'ticket:close-request']);
    assert(ticketCreationReplies.some(reply => reply.includes('ticket-channel-1')));

    const ticketMemberOverwrites: Array<{ memberId: string; permissions: Record<string, boolean> }> = [];
    const ticketMemberChannel = {
        id: 'ticket-member-channel',
        type: ChannelType.GuildText,
        topic: createdTicketChannel.topic,
        permissionOverwrites: {
            edit: async (memberId: string, permissions: Record<string, boolean>) => {
                ticketMemberOverwrites.push({ memberId, permissions });
            },
        },
    };
    const ticketMemberCommand = async (commandName: 'add-member' | 'remove-member') => {
        const replies: string[] = [];
        await commandNamed(commandName).execute({
            channel: ticketMemberChannel,
            client: { user: { id: 'ticket-bot' } },
            user: { id: 'ticket-agent', tag: 'TicketAgent#0001' },
            member: { roles: ['1523122697746382868'] },
            memberPermissions: { has: () => false },
            options: { getUser: () => ({ id: 'support-member', username: 'SupportMember' }) },
            deferReply: async () => undefined,
            editReply: async (content: string) => { replies.push(content); },
        } as never);
        return replies;
    };
    assert((await ticketMemberCommand('add-member')).some(reply => reply.includes('Added')));
    assert.equal(ticketMemberOverwrites[0].permissions.ViewChannel, true);
    assert((await ticketMemberCommand('remove-member')).some(reply => reply.includes('Removed')));
    assert.equal(ticketMemberOverwrites[1].permissions.ViewChannel, false,
        '/remove-member must create a member-specific deny that overrides the support-role allow');
    assert.equal(ticketMemberOverwrites[1].permissions.SendMessages, false);

    const quickClaimOrder: string[] = [];
    let quickClaimTopic = createdTicketChannel.topic;
    let quickClaimComponents: any[] = [];
    const quickClaimChannel: any = {
        id: 'quick-ticket-channel',
        type: ChannelType.GuildText,
        get topic() { return quickClaimTopic; },
        fetch: async () => { quickClaimOrder.push('fetch-channel'); return quickClaimChannel; },
        setTopic: async (topic: string) => { quickClaimOrder.push('set-topic'); quickClaimTopic = topic; },
    };
    const quickClaimResult = handleTicketClaimRepair({
        customId: 'ticket:claim',
        channel: quickClaimChannel,
        guild: {
            ownerId: 'someone-else',
            members: { fetch: async () => { throw new Error('support role in the interaction should avoid a member fetch'); } },
        },
        user: { id: 'quick-ticket-agent', username: 'QuickAgent', tag: 'QuickAgent#0001' },
        member: { roles: ['1523122697746382868'] },
        memberPermissions: { has: () => false },
        message: openTicketMessage,
        client: {
            users: {
                fetch: async () => ({ send: async () => new Promise<void>(() => undefined) }),
            },
        },
        deferUpdate: async () => { quickClaimOrder.push('defer-update'); },
        editReply: async (payload: any) => { quickClaimOrder.push('edit-panel'); quickClaimComponents = payload.components; },
        followUp: async () => { quickClaimOrder.push('success-follow-up'); },
    } as never);
    const quickClaimCompleted = await Promise.race([
        quickClaimResult.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 250)),
    ]);
    assert(quickClaimCompleted, 'ticket claim must not wait for a slow ticket-owner DM');
    assert.equal(quickClaimOrder[0], 'defer-update', 'ticket claim must acknowledge the button before making REST requests');
    assert.deepEqual(
        quickClaimOrder.slice(0, 5),
        ['defer-update', 'fetch-channel', 'set-topic', 'edit-panel', 'success-follow-up'],
        'ticket claim must use one state refresh and finish the panel update before optional notifications',
    );
    assert(quickClaimComponents.length > 0, 'the fast claim path must update the ticket panel controls');

    let claimedTicketDm: any = null;
    let dmClaimTopic = ticketCreateOptions.topic;
    const dmClaimChannel: any = {
        id: 'ticket-claim-dm-channel',
        guildId: 'ticket-guild',
        name: 'gen-server-help-5511',
        type: ChannelType.GuildText,
        get topic() { return dmClaimTopic; },
        fetch: async () => dmClaimChannel,
        setTopic: async (topic: string) => { dmClaimTopic = topic; },
    };
    assert(await handleTicketClaimRepair({
        customId: 'ticket:claim',
        channel: dmClaimChannel,
        guild: {
            ownerId: 'someone-else',
            members: { fetch: async () => ({ displayName: 'Ticket User' }) },
        },
        user: { id: 'ticket-agent', username: 'TicketAgent', tag: 'TicketAgent#0001' },
        member: { roles: ['1523122697746382868'] },
        memberPermissions: { has: () => false },
        message: openTicketMessage,
        client: {
            users: {
                fetch: async () => ({
                    username: 'TicketUser',
                    send: async (payload: any) => { claimedTicketDm = payload; },
                }),
            },
        },
        deferUpdate: async () => undefined,
        editReply: async () => undefined,
        followUp: async () => undefined,
    } as never));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(claimedTicketDm?.flags, MessageFlags.IsComponentsV2,
        'claiming a ticket must send the opener a V2 Assistance DM');
    assert.deepEqual(claimedTicketDm.files.map((file: { name: string }) => file.name), [
        'assistance-banner.png',
        'underbanner.png',
    ]);

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

    let closedTicketDm: any = null;
    let closedTicketDeleted = false;
    const closeConversation = new Collection<string, any>([[
        'ticket-human-message',
        {
            id: 'ticket-human-message',
            author: { id: '1489388257925005511', tag: 'TicketUser#0001', username: 'TicketUser', bot: false },
            cleanContent: 'I need help with the server and support resolved it.',
            components: [],
            attachments: new Collection<string, any>(),
            createdTimestamp: Date.now(),
            createdAt: new Date(),
        },
    ]]);
    const closeTicketChannel: any = {
        id: 'ticket-close-channel',
        guildId: 'ticket-guild',
        name: 'gen-server-help-5511',
        type: ChannelType.GuildText,
        topic: createdTicketTopic,
        messages: { fetch: async () => closeConversation },
        delete: async () => { closedTicketDeleted = true; },
    };
    const closeReplies: string[] = [];
    const originalTicketRecapApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await closeTicketWithLifecycle({
        channel: closeTicketChannel,
        guild: { members: { fetch: async () => ({ displayName: 'Ticket User' }) } },
        user: { id: 'ticket-agent', tag: 'TicketAgent#0001' },
        member: { roles: ['1523122697746382868'] },
        memberPermissions: { has: () => false },
        client: {
            channels: { fetch: async () => null },
            users: { fetch: async () => ({ username: 'TicketUser', send: async (payload: any) => { closedTicketDm = payload; } }) },
        },
        editReply: async (content: string) => { closeReplies.push(content); },
    } as never, 'Resolved by support.');
    if (originalTicketRecapApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalTicketRecapApiKey;
    assert(closedTicketDeleted, 'closing a ticket must delete it after logs and notifications are prepared');
    assert.equal(closedTicketDm?.flags, MessageFlags.IsComponentsV2,
        'ticket close DMs must use a Components V2 emblem');
    assert.deepEqual(closedTicketDm.files.map((file: { name: string }) => file.name), [
        'assistance-banner.png',
        'underbanner.png',
        'gen-server-help-5511-transcript.txt',
    ]);
    const closedTicketJson = JSON.stringify(closedTicketDm.components[0].toJSON());
    assert(closedTicketJson.includes('attachment://assistance-banner.png'));
    assert(closedTicketJson.includes('attachment://underbanner.png'));
    const feedbackStartId = closedTicketJson.match(/ticket-feedback:start:[A-Za-z0-9_-]+/)?.[0];
    assert(feedbackStartId, 'the close DM must include a working ticket feedback button');
    assert(closeReplies.some(reply => reply.includes('was sent')));

    let ticketFeedbackModal: any = null;
    assert(await handleTicketFeedbackButton({
        customId: feedbackStartId,
        user: { id: '1489388257925005511' },
        showModal: async (modal: any) => { ticketFeedbackModal = modal; },
    } as never));
    const ticketFeedbackModalId = ticketFeedbackModal.toJSON().custom_id as string;
    let ticketFeedbackPost: any = null;
    const ticketFeedbackReplies: string[] = [];
    assert(await handleTicketFeedbackModal({
        customId: ticketFeedbackModalId,
        user: { id: '1489388257925005511' },
        fields: { getTextInputValue: (name: string) => name === 'rating' ? '10' : 'Fast and helpful support.' },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { ticketFeedbackPost = payload; },
                }),
            },
        },
        deferReply: async () => undefined,
        editReply: async (content: string) => { ticketFeedbackReplies.push(content); },
    } as never));
    assert.equal(ticketFeedbackPost.flags, MessageFlags.IsComponentsV2,
        'ticket feedback must post as a Components V2 emblem');
    assert.deepEqual(ticketFeedbackPost.files.map((file: { name: string }) => file.name), [
        'staff-feedback-banner.png',
        'underbanner.png',
    ]);
    const ticketFeedbackJson = JSON.stringify(ticketFeedbackPost.components[0].toJSON());
    assert(ticketFeedbackJson.includes('attachment://staff-feedback-banner.png'));
    assert(ticketFeedbackJson.includes('attachment://underbanner.png'));
    assert(ticketFeedbackReplies.some(reply => reply.includes('10/10')));

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
    assert.equal(applicationsBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
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
    assert.equal(guidelinesBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');

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
    assert(applicantDms[0]?.includes('Question 1 of 9'));
    assert(applicationStartReplies.some(reply => reply.includes('Check your DMs')));
    for (let index = 0; index < 9; index += 1) {
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
    assert.equal(reviewBanners[1]?.items?.[0]?.media?.url, 'attachment://underbanner.png');
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
    const mediaApplicationDms = await completeApplication('media', 8, '1489388257925005888');
    const banAppealDms = await completeApplication('ban_appeal', 4, '1489388257925005999');
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
    assert(longApplicationDms.at(-1)?.includes('Question 10 of 12'));
    const persistedAtQuestion10 = persistedApplicationSessions.get(longApplicationUser.id);
    assert(persistedAtQuestion10, 'Question 10 progress must be durably saved');
    persistedAtQuestion10.startedAt = Date.now() - 48 * 60 * 60 * 1_000;
    persistedAtQuestion10.lastActivityAt = Date.now();
    clearApplicationSessionCache();
    assert(await handleApplicationDmMessage(longApplicationMessage('In-game answer 10') as never));
    assert(longApplicationDms.at(-1)?.includes('Question 11 of 12'),
        'an active long application must continue past Question 10 after a process restart');
    clearApplicationSessionCache();
    assert(await handleApplicationDmMessage(longApplicationMessage('In-game answer 11') as never));
    assert(longApplicationDms.at(-1)?.includes('Question 12 of 12'));
    clearApplicationSessionCache();
    assert(await handleApplicationDmMessage(longApplicationMessage('In-game answer 12') as never));
    assert(longApplicationDms.at(-1)?.includes('DO NOT ASK'));
    assert.equal(persistedApplicationSessions.has(longApplicationUser.id), false,
        'the durable application session must be removed only after successful review submission');

    let failQuestionTwoOnce = true;
    const interruptedApplicationDms: string[] = [];
    const interruptedApplicationUser = {
        id: '1489388257925006166',
        bot: false,
        send: async (content: string) => {
            if (content.includes('Question 2 of 8') && failQuestionTwoOnce) {
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
    assert(interruptedApplicationDms.at(-1)?.includes('Question 2 of 8'),
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
    for (let question = 1; question <= 11; question += 1) {
        legacyHistory.set(`legacy-prompt-${question}`, {
            id: `legacy-prompt-${question}`,
            author: { id: 'application-bot', bot: true },
            content: `**Question ${question} of 12**\nPrompt ${question}`,
            attachments: new Collection<string, any>(),
            createdTimestamp: historyBase + question * 2_000,
        });
        if (question < 11) {
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
        id: 'legacy-current-answer-11',
        author: legacyRecoveryUser,
        guildId: null,
        content: 'Recovered answer 11',
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
    assert(legacyRecoveryDms.at(-1)?.includes('Question 12 of 12'),
        'a pre-deployment application must recover from DM history at Question 11');
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
        isTextBased: () => true,
        isSendable: () => true,
        send: async (payload: any) => {
            appealReviewPayload = payload;
            return { id: 'appeal-review-message' };
        },
        messages: {
            fetch: async (query?: unknown) => typeof query === 'object'
                ? new Collection<string, any>()
                : ({ edit: async (payload: any) => { appealReviewEdit = payload; } }),
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
    const appealReviewComponents = appealReviewPayload.components[0].toJSON().components;
    const appealReviewRow = appealReviewComponents.find((component: { type: number }) => component.type === 1);
    const approveButtonId = appealReviewRow.components[0].custom_id as string;
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
    assert.equal(sourceAppealNotices[0].flags, MessageFlags.IsComponentsV2);
    assert(JSON.stringify(sourceAppealNotices[0]).includes('✅ Infraction Appeal Approved'));
    assert(appealReviewEdit, 'the staff review message must be updated after a decision');
    assert(appealReviewReplies.some(reply => reply.includes('infraction channel was updated')));
    configureInfractionPersistence(null);

    assert(detectBullying('You are a worthless loser.'), 'direct targeted abuse must be detected');
    assert(detectBullying('You suck.'), 'direct harassment must be detected');
    assert(detectBullying('Fuck you.'), 'direct targeted profanity must be detected');
    assert(detectBullying('Pathetic loser.', true), 'an insult in a reply or explicit mention must be detected');
    assert.equal(detectBullying('That game was stupid.', true), null, 'criticism of a thing must not be treated as bullying');
    assert.equal(detectBullying('They said you are stupid.'), null, 'reporting someone else\'s abuse must not punish the reporter');

    const originalBullyingTimeout = process.env.BULLYING_TIMEOUT_MINUTES;
    process.env.BULLYING_TIMEOUT_MINUTES = '10';
    let bullyingTimeoutMs = 0;
    let bullyingDeletes = 0;
    const bullyingLogs: any[] = [];
    const bullyingMessage = {
        guild: { members: { fetch: async () => null } },
        guildId: 'bullying-guild',
        channelId: 'bullying-channel',
        id: 'bullying-message',
        url: 'https://discord.com/channels/bullying-guild/bullying-channel/bullying-message',
        content: 'You are a worthless loser.',
        webhookId: null,
        createdTimestamp: Date.now(),
        createdAt: new Date(),
        author: {
            id: 'bullying-author',
            bot: false,
            displayAvatarURL: () => 'https://cdn.example/bullying-author.png',
        },
        member: {
            moderatable: true,
            timeout: async (duration: number) => { bullyingTimeoutMs = duration; },
        },
        mentions: {
            users: new Collection<string, any>(),
            repliedUser: { id: 'bullying-target' },
        },
        delete: async () => { bullyingDeletes += 1; },
        client: {
            channels: {
                fetch: async () => ({
                    isSendable: () => true,
                    send: async (payload: any) => { bullyingLogs.push(payload); },
                }),
            },
        },
    } as never;
    await handleMessageModeration(bullyingMessage);
    await handleMessageModeration(bullyingMessage);
    assert.equal(bullyingTimeoutMs, 10 * 60 * 1000, 'detected bullying must apply the configured timeout');
    assert.equal(bullyingDeletes, 1, 'detected bullying must delete the source message exactly once');
    assert.equal(bullyingLogs.length, 1, 'detected bullying must produce one deduplicated moderation log');
    assert.equal(bullyingLogs[0].flags, MessageFlags.IsComponentsV2);
    assert(JSON.stringify(bullyingLogs[0]).includes('Targeted Bullying Automatically Actioned'));
    if (originalBullyingTimeout === undefined) delete process.env.BULLYING_TIMEOUT_MINUTES;
    else process.env.BULLYING_TIMEOUT_MINUTES = originalBullyingTimeout;

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
    const highThreatPayload = moderationSends.find(entry =>
        entry.payload.allowedMentions?.roles?.includes('1523122912201277590'),
    )?.payload;
    assert.equal(highThreatPayload?.flags, MessageFlags.IsComponentsV2);
    assert(JSON.stringify(highThreatPayload).includes('<@&1523122912201277590>'), 'only the High-confidence alert should ping emergency staff');
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
