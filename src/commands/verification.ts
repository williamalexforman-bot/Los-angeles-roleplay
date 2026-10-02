import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SectionBuilder,
    SeparatorBuilder,
    SlashCommandBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { bannerAttachment, bannerUrl } from '../utils/bannerAssets';
import { configuredChannelId, getGuildBotConfig } from '../services/panelConfig';
import { logger } from '../utils/logger';

const START_ID = 'verification:start';
const CONTINUE_ID = 'verification:continue';
const PROFILE_ID_PREFIX = 'https://www.roblox.com/users/';
const DOCKSYS_ACCOUNT_URL = 'https://docksys.xyz/account';

interface RobloxAccount {
    robloxId: string;
    username: string;
}

export const data = new SlashCommandBuilder()
    .setName('verify-message')
    .setDescription('Post the CSRP Roblox verification panel in this channel');

function profileUrl(account: RobloxAccount): string {
    return `${PROFILE_ID_PREFIX}${encodeURIComponent(account.robloxId)}/profile`;
}

function verificationPanel(): ContainerBuilder {
    const startButton = new ButtonBuilder()
        .setCustomId(START_ID)
        .setLabel('Begin Verification')
        .setStyle(ButtonStyle.Primary);

    return new ContainerBuilder()
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(bannerUrl('verification')),
        ))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '# California State Roleplay Verification',
            'Link your Roblox account through DockSys, then use the button below to verify and receive server access.',
        ].join('\n\n')))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('Use the button here to check your linked Roblox account.'))
            .setButtonAccessory(startButton))
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(bannerUrl('underbanner')),
        ));
}

function privatePanel(title: string, body: string, buttons?: ButtonBuilder[]): ContainerBuilder {
    const panel = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${body}`));
    if (buttons?.length) {
        panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        panel.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));
    }
    return panel;
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Verification service returned HTTP ${response.status}`);
    return response.json();
}

async function getLinkedRobloxAccount(interaction: ButtonInteraction): Promise<RobloxAccount> {
    const apiKey = process.env.DOCK_API?.trim();
    if (!apiKey) throw new Error('DockSys verification is not configured.');
    if (!interaction.guildId) throw new Error('Verification can only be completed in the server.');

    const query = new URLSearchParams({ discordId: interaction.user.id, guildId: interaction.guildId });
    const linkResponse = await requestJson(`https://api.docksys.xyz/api/v1/public/discord-to-roblox?${query}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    }) as { data?: { robloxId?: string | number } };
    const robloxId = String(linkResponse.data?.robloxId || '');
    if (!/^\d{1,20}$/.test(robloxId)) throw new Error('No linked Roblox account was found.');

    const userResponse = await requestJson(`https://users.roblox.com/v1/users/${encodeURIComponent(robloxId)}`) as { name?: string };
    if (!userResponse.name || userResponse.name.length > 50) throw new Error('Roblox did not return a valid account name.');
    return { robloxId, username: userResponse.name };
}

function safeFailureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message === 'DockSys verification is not configured.') {
        return 'Verification is not configured yet. Ask a server administrator to add the DockSys API key to the bot environment.';
    }
    if (message === 'No linked Roblox account was found.') {
        return 'No Roblox account is linked to your Discord account. Link the correct account at DockSys, then try again.';
    }
    if (message === 'Verification can only be completed in the server.') return message;
    return 'I could not check your Roblox link right now. Please try again in a moment.';
}

function accountButtons(account: RobloxAccount): ButtonBuilder[] {
    return [
        new ButtonBuilder()
            .setLabel('Change Account')
            .setStyle(ButtonStyle.Link)
            .setURL(DOCKSYS_ACCOUNT_URL),
        new ButtonBuilder()
            .setCustomId(CONTINUE_ID)
            .setLabel('Continue')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setLabel('View Roblox Profile')
            .setStyle(ButtonStyle.Link)
            .setURL(profileUrl(account)),
    ];
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
        await interaction.editReply('This channel cannot receive the verification panel.');
        return;
    }

    await channel.send({
        components: [verificationPanel()],
        files: [bannerAttachment('verification'), bannerAttachment('underbanner')],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    await interaction.editReply('The verification panel is posted in this channel.');
}

export async function handleVerificationButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId !== START_ID && interaction.customId !== CONTINUE_ID) return false;

    if (interaction.customId === START_ID) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const account = await getLinkedRobloxAccount(interaction);
            await interaction.editReply({
                components: [privatePanel(
                    'Roblox Account Found',
                    `Your Discord account is linked to **[${account.username}](${profileUrl(account)})**. Continue to verify this account, or change the linked account first.`,
                    accountButtons(account),
                )],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            await interaction.editReply({
                components: [privatePanel('Verification Could Not Start', safeFailureMessage(error), [
                    new ButtonBuilder().setLabel('Open DockSys').setStyle(ButtonStyle.Link).setURL(DOCKSYS_ACCOUNT_URL),
                ])],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
            if (error instanceof Error && !['DockSys verification is not configured.', 'No linked Roblox account was found.'].includes(error.message)) {
                logger.warn(`DockSys account lookup failed: ${error.name}`);
            }
        }
        return true;
    }

    await interaction.deferUpdate();
    if (!interaction.guild) {
        await interaction.followUp({ content: 'Verification must be completed in the server.', flags: MessageFlags.Ephemeral });
        return true;
    }

    let account: RobloxAccount;
    try {
        account = await getLinkedRobloxAccount(interaction);
    } catch (error) {
        await interaction.editReply({
            components: [privatePanel('Verification Failed', safeFailureMessage(error))],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        if (error instanceof Error && !['DockSys verification is not configured.', 'No linked Roblox account was found.'].includes(error.message)) {
            logger.warn(`DockSys account lookup failed: ${error.name}`);
        }
        return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        await interaction.editReply({
            components: [privatePanel('Verification Failed', 'I could not find your server membership. Please try again from the server.')],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    }

    const roles = (await getGuildBotConfig(interaction.guild)).roles;
    const verifiedRoleId = roles.verification_verified;
    if (!verifiedRoleId) {
        await interaction.editReply({
            components: [privatePanel('Verification Setup Needed', 'Your Roblox account is linked, but the server has not configured its Verified role. Ask an administrator to set **Verified Role** in `/config` and then try again.')],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
        return true;
    }

    const verifiedRole = await interaction.guild.roles.fetch(verifiedRoleId).catch(() => null);
    if (!verifiedRole) {
        await interaction.editReply({
            components: [privatePanel('Verification Setup Needed', 'The configured Verified role no longer exists. Ask an administrator to select the current role in `/config`.')],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    }
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) || verifiedRole.position >= botMember.roles.highest.position) {
        await interaction.editReply({
            components: [privatePanel('Verification Setup Needed', 'The bot needs **Manage Roles**, and its highest role must be above the configured Verified role. Ask an administrator to fix the role order, then try again.')],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    }

    try {
        if (!member.roles.cache.has(verifiedRole.id)) await member.roles.add(verifiedRole, 'CSRP Roblox account verified');
        const unverifiedRoleId = roles.verification_unverified;
        if (unverifiedRoleId && unverifiedRoleId !== verifiedRole.id && member.roles.cache.has(unverifiedRoleId)) {
            const unverifiedRole = await interaction.guild.roles.fetch(unverifiedRoleId).catch(() => null);
            if (unverifiedRole && unverifiedRole.position < botMember.roles.highest.position) {
                await member.roles.remove(unverifiedRole, 'Member completed CSRP verification');
            }
        }
    } catch (error) {
        await interaction.editReply({
            components: [privatePanel('Verification Could Not Finish', 'Your Roblox account was found, but Discord did not allow the role update. Ask an administrator to check the bot’s **Manage Roles** permission and role order.')],
            flags: MessageFlags.IsComponentsV2,
        });
        logger.warn(`CSRP verification role update failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
        return true;
    }

    await interaction.editReply({
        components: [privatePanel(
            'Verification Complete',
            `You are verified as **[${account.username}](${profileUrl(account)})** and have received <@&${verifiedRole.id}>. Welcome to California State Roleplay!`,
        )],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], roles: [] },
    });

    const logChannelId = await configuredChannelId(interaction.guild, 'verification_logs');
    const logChannel = logChannelId ? await interaction.client.channels.fetch(logChannelId).catch(() => null) : null;
    if (logChannel?.isSendable()) {
        const logPanel = new ContainerBuilder()
            .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(bannerUrl('verification')),
            ))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                '# Roblox Verification Completed',
                `**Discord member:** <@${member.id}> (${member.user.tag})`,
                `**Roblox account:** [${account.username}](${profileUrl(account)})`,
                `**Roblox user ID:** \`${account.robloxId}\``,
                `**Verified:** <t:${Math.floor(Date.now() / 1_000)}:F>`,
            ].join('\n')))
            .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(bannerUrl('underbanner')),
            ));
        await logChannel.send({
            components: [logPanel],
            files: [bannerAttachment('verification'), bannerAttachment('underbanner')],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [member.id] },
        }).catch(error => logger.warn(`CSRP verification log could not be sent: ${error instanceof Error ? error.name : 'UnknownError'}`));
    }
    return true;
}
