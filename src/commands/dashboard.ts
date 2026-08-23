import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    ContainerBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const DASHBOARD_CHANNEL_ID = '1526049604712529971';

const ROLE_CONFIG = {
    event: { id: '1521593407749754989', label: 'Event Ping', emoji: '📆' },
    session: { id: '1521593407749754990', label: 'Session Ping', emoji: '🎮' },
    announcement: { id: '1521593407762464944', label: 'Announcement Ping', emoji: '📢' },
    giveaway: { id: '1528128142709887146', label: 'Giveaway Ping', emoji: '🎉' },
    content: { id: '1521593407741362265', label: 'Content Ping', emoji: '🖥️' },
} as const;

type RoleKey = keyof typeof ROLE_CONFIG;

const DASHBOARD_TEXT = [
    '# <:LARP:1535409995464835175>`Los Angeles Dashboard`',
    '**Los Angeles Roleplay** offers you a Realistic and Professional Roleplay experience within the game Emergency Response Liberty County. With bringing you all Realistic Liveries along with our experienced Staff Team, Los Angeles Roleplay tries to provide players with an unforgettable roleplay! We are a fast growing community, and excited to welcome everybody! Come take a look at what amazing things Los Angeles has to offer!',
    '',
    '# <:rule_book:1531484731068256366>Server Rules',
    '> **Los Angeles Roleplay** requires everyone to read their server rules to keep it keep the roleplay fun for everyone all the time! You can check out our server regulations in the <#1526046592187105421> channel. Please note that the rules may be updated, and it is your responsibility to go over them again.',
    '',
    '# <:paper:1531485345919664189>Applications',
    '> If you would like to keep **Los Angeles Roleplay** fun and unforgettable for everyone, then you can head over to <#1526035041593856182> and apply to be in game staff, discord staff, or even join the media team! Share your exiting moments with everyone. Make sure to see if you meet all the requirements before you apply.',
    '',
    '# <:briefcase:1531484900060954765>Departments',
    '> **Los Angeles Roleplay** offers you a professional and fun department experience! You can pick any department you like Fire Department, Police Department, Department of Transportation, Sheriff Department, or even Los Angeles Highway Patrol, remember it\'s your pick! You can chose any of those by heading over to the <#1526192979218530335> channel!',
    '',
    '# <:3lines:1531485214952652941>Reaction Roles',
    '> **Los Angeles Roleplay** offers you few reaction roles. If you would like to add or remove your reaction role, press on one of the buttons below. If you fo not have the role, press on the button and it will add it. If you already have a reaction role, press on the button and it will remove it.',
    '- 📢  `-` Announcement Ping',
    '- 🎮  `-` Session Ping',
    '- 📆  `-` Event Ping',
    '- 🖥  `-` Content Ping',
    '- 🎉  `-` Giveaway Ping',
    '',
    '# <:link:1531485100368334900>Important Channels',
    '> <#1526034504953892925>  `If you need any help`',
    '> <#1526035127606706196>  `Buy LA VIP and more`',
    '> <#1526035041593856182>  `Apply here`',
    '> <#1526046592187105421>  `Read server regulations`',
    '> <#1541110029048881313>  `Verify here`',
].join('\n');

function dashboardMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('dashboard:menu')
            .setPlaceholder('Select a dashboard section')
            .addOptions(
                { label: 'Server Rules', value: 'rules', emoji: '📖', description: 'View the server regulations channel' },
                { label: 'Applications', value: 'applications', emoji: '📝', description: 'Staff and media applications' },
                { label: 'Departments', value: 'departments', emoji: '💼', description: 'Choose a Los Angeles department' },
                { label: 'Reaction Roles', value: 'roles', emoji: '🔔', description: 'Manage your notification ping roles' },
                { label: 'Important Channels', value: 'channels', emoji: '🔗', description: 'Quick links to important server channels' },
            ),
    );
}

function roleButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('dashboard:role:announcement').setLabel('Announcement Ping').setEmoji('📢').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dashboard:role:session').setLabel('Session Ping').setEmoji('🎮').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dashboard:role:event').setLabel('Event Ping').setEmoji('📆').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dashboard:role:content').setLabel('Content Ping').setEmoji('🖥️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dashboard:role:giveaway').setLabel('Giveaway Ping').setEmoji('🎉').setStyle(ButtonStyle.Secondary),
    );
}

function dashboardPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(DASHBOARD_TEXT))
        .addActionRowComponents(dashboardMenu())
        .addActionRowComponents(roleButtons());
}

const SECTION_TEXT: Record<string, string> = {
    rules: '# <:rule_book:1531484731068256366> Server Rules\nRead the complete Los Angeles Roleplay server regulations in <#1526046592187105421>. Rules may be updated, so make sure you check them regularly.',
    applications: '# <:paper:1531485345919664189> Applications\nHead to <#1526035041593856182> to view available in-game staff, Discord staff, and media team applications.',
    departments: '# <:briefcase:1531484900060954765> Departments\nChoose from the available Los Angeles Roleplay departments in <#1526192979218530335>.',
    roles: '# <:3lines:1531485214952652941> Reaction Roles\nUse the five buttons directly underneath the dashboard to add or remove Announcement, Session, Event, Content, and Giveaway ping roles.',
    channels: '# <:link:1531485100368334900> Important Channels\n<#1526034504953892925> — Help\n<#1526035127606706196> — LA VIP and more\n<#1526035041593856182> — Applications\n<#1526046592187105421> — Server regulations\n<#1541110029048881313> — Verification',
};

export async function handleDashboardSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'dashboard:menu') return false;
    const value = interaction.values[0];
    const text = SECTION_TEXT[value] || 'That dashboard section is unavailable.';
    await interaction.reply({ content: text, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
}

export async function handleDashboardButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('dashboard:role:')) return false;
    if (!interaction.guild) {
        await interaction.reply({ content: 'This button can only be used inside the server.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const key = interaction.customId.split(':')[2] as RoleKey;
    const config = ROLE_CONFIG[key];
    if (!config) {
        await interaction.reply({ content: 'That ping role is not configured.', flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const role = interaction.guild.roles.cache.get(config.id)
        || await interaction.guild.roles.fetch(config.id).catch(() => null);

    if (!member || !role) {
        await interaction.editReply('I could not load your member account or that ping role.');
        return true;
    }

    try {
        if (member.roles.cache.has(config.id)) {
            await member.roles.remove(role, `Dashboard ping role removed by ${interaction.user.tag}`);
            await interaction.editReply(`${config.emoji} Removed **${config.label}** from you.`);
        } else {
            await member.roles.add(role, `Dashboard ping role added by ${interaction.user.tag}`);
            await interaction.editReply(`${config.emoji} Added **${config.label}** to you.`);
        }
    } catch (error) {
        logger.warn(`[Dashboard] Role toggle failed for ${interaction.user.id} / ${config.id}: ${error instanceof Error ? error.message : String(error)}`);
        await interaction.editReply('I could not change that role. Make sure my bot role is above the ping roles and has **Manage Roles** permission.');
    }
    return true;
}

export const dashboardCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Post the Los Angeles Roleplay dashboard panel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const channel = await interaction.client.channels.fetch(DASHBOARD_CHANNEL_ID).catch(() => null);
            if (!channel?.isSendable()) {
                await interaction.editReply(`The dashboard channel <#${DASHBOARD_CHANNEL_ID}> is unavailable or I cannot send there.`);
                return;
            }

            const message = await channel.send({
                components: [dashboardPanel()],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
            await interaction.editReply(`✅ Dashboard posted in <#${DASHBOARD_CHANNEL_ID}>: ${message.url}`);
            logger.info(`[Dashboard] Dashboard posted in ${DASHBOARD_CHANNEL_ID} by ${interaction.user.id}.`);
        } catch (error) {
            logger.error(`[Dashboard] Could not post dashboard: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await interaction.editReply('I could not post the dashboard. Check my permissions and try again.');
        }
    },
};
