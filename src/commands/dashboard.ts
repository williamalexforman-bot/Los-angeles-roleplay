import { readFileSync } from 'fs';
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
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { logger } from '../utils/logger';

const DASHBOARD_CHANNEL_ID = '1526049604712529971';
const VERIFY_CHANNEL_ID = '1529897932659232970';
const DASHBOARD_BANNER_B64_PATH = resolve(__dirname, '..', '..', 'assets', 'dashboard-banner.b64');
const DASHBOARD_BANNER_NAME = 'dashboard-banner.webp';
const DISCORD_EMOJI_ID = '1522529390687293460';
const ROBLOX_EMOJI_ID = '1020834558058442813';

function dashboardBanner(): Buffer {
    return Buffer.from(readFileSync(DASHBOARD_BANNER_B64_PATH, 'utf8').trim(), 'base64');
}

function bannerAttachment(): AttachmentBuilder {
    return new AttachmentBuilder(dashboardBanner(), { name: DASHBOARD_BANNER_NAME });
}

function separator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function media(name: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
    );
}

function dashboardButton(
    customId: string,
    label: string,
    emoji?: string | { id: string; name: string },
    style: ButtonStyle = ButtonStyle.Secondary,
): ActionRowBuilder<ButtonBuilder> {
    const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style);
    if (emoji) button.setEmoji(emoji);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

function disabledButton(
    customId: string,
    label: string,
    emoji?: string | { id: string; name: string },
): ActionRowBuilder<ButtonBuilder> {
    const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
    if (emoji) button.setEmoji(emoji);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

function dashboardNavigation(): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('dashboard:menu')
            .setPlaceholder('Select a dashboard section')
            .addOptions(
                {
                    label: 'Frequently Asked Questions',
                    value: 'faq',
                    emoji: '❔',
                    description: 'Partnerships, verification, and moderator applications',
                },
                {
                    label: 'Discord Bulletin',
                    value: 'bulletin',
                    emoji: '📌',
                    description: 'Official Los Angeles Roleplay resources',
                },
                {
                    label: 'Regulations',
                    value: 'regulations',
                    emoji: '📖',
                    description: 'Discord and voice channel regulations',
                },
            ),
    );
}

function withDashboardBanner(content: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addMediaGalleryComponents(media(DASHBOARD_BANNER_NAME))
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function mainDashboard(): ContainerBuilder {
    return withDashboardBanner([
        '## 🛡️ Dashboard',
        'Welcome to the **Dashboard for Los Angeles Roleplay**. This channel serves as your primary directory for essential information, official resources, and helpful links to keep you connected with our community.',
        '',
        '**Los Angeles Roleplay** is a realistic roleplay community based in ER:LC, focused on immersive sessions, professional departments, community events, and a high-quality Los Angeles roleplay experience.',
    ].join('\n'))
        .addSeparatorComponents(separator())
        .addActionRowComponents(dashboardNavigation())
        .addSeparatorComponents(separator())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('*Los Angeles Roleplay • Most immersive Los Angeles experience*'));
}

function faqPanel(): ContainerBuilder {
    return withDashboardBanner('## Frequently Asked Questions')
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            dashboardButton('dashboard:faq:partner', 'How do I partner with LARP?', '❔'),
            dashboardButton('dashboard:faq:verify', 'How do I verify?', '❔'),
            dashboardButton('dashboard:faq:moderator', 'How do I become a Moderator?', '❔'),
        );
}

function partnershipPanel(): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(BRAND.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '## 🤝 Partnership Program',
            'To partner with **LARP** you can click the button below in order to request a partnership with our server.',
            '',
            'We have some rules about partnering with us:',
            '• If you have **under 30 members**, you must have **3 representatives** in our server.',
            '• If you have **under 50 members**, we require **20 representatives** in our server.',
            '• Anything **above 50 members** can have **1 representative**.',
            '• If you leave the server, the partnership will be **INSTANTLY** deleted.',
            '• If you choose an invite code that expires, we are not sending your advertisement again. Make an invite code that **does not expire**.',
            '',
            'Click below when you are ready to request a partnership.',
        ].join('\n')))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            dashboardButton('partnership:open', 'Request Partnership', '🤝', ButtonStyle.Primary),
        );
}

function verifyPanel(): ContainerBuilder {
    return withDashboardBanner([
        '## ✅ How do I verify?',
        `To verify in our server, head over to <#${VERIFY_CHANNEL_ID}> and then press **Verify**.`,
    ].join('\n'));
}

function moderatorPanel(): ContainerBuilder {
    return withDashboardBanner([
        '## 🛡️ How do I become a Moderator?',
        'To become a moderator in **LARP**, you can click one of the buttons below to apply. Make sure every written response uses **2+ sentences** where appropriate and proper **SPaG** (spelling, punctuation, and grammar).',
        '',
        '**DO NOT ASK FOR YOUR APPLICATION TO BE READ.**',
    ].join('\n'))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            dashboardButton('dashboard:apply:discord', 'Discord Moderator', { id: DISCORD_EMOJI_ID, name: 'Discord' }, ButtonStyle.Primary),
            dashboardButton('dashboard:apply:ingame', 'In-Game Moderator', { id: ROBLOX_EMOJI_ID, name: 'ROBLOX' }, ButtonStyle.Primary),
        );
}

function bulletinPanel(): ContainerBuilder {
    return withDashboardBanner('## Discord Bulletin')
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            disabledButton('dashboard:disabled:applications', 'Applications', '📝'),
        );
}

function regulationsPanel(): ContainerBuilder {
    return withDashboardBanner('## Regulations')
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            dashboardButton(
                'dashboard:regulations:discord',
                'Discord Regulations',
                { id: DISCORD_EMOJI_ID, name: 'Discord' },
            ),
            dashboardButton(
                'dashboard:regulations:vc',
                'VC Regulations',
                { id: ROBLOX_EMOJI_ID, name: 'ROBLOX' },
            ),
        );
}

const DISCORD_GUIDELINES = [
    '## Discord Guidelines',
    '## 1. Respect Everyone',
    '- Treat all members with respect at all times.',
    '- No harassment, discrimination, hate speech, or disrespecting people.',
    '- Keep arguments civil.',
    '## 2. Follow Discord TOS',
    '- All [Discord Terms of Service and Community Guidelines](https://discord.com/terms) apply.',
    '- Anything violating [Discord TOS](https://discord.com/terms) will result in moderation.',
    '## 3. No NSFW or Explicit Content',
    '- No sexual content, explicit images, extreme violence, or gore.',
    '- Keep all chats appropriate for a roleplay community.',
    '## 4. No Spamming or Advertising',
    '- No spam, excessive emojis, caps, or mic spam.',
    '- No advertising other servers, services, or social media without staff permission.',
    '## 5. Use Channels Correctly',
    '- Use channels only for their intended purpose.',
    '- While in [LEO RTO](https://discord.com/channels/1521593407741362257/1528089390054637799), you must remain RTO (Radio Traffic Only).',
    '- Commands must be used only in designated command channels.',
    '- Failure to use channels properly will result in moderation.',
    '## 6. Staff Interaction',
    '- Do not argue with staff.',
    '- If you have an issue, open a ticket or DM a staff member respectfully.',
    '- Staff impersonation is strictly prohibited.',
    '## 7. Account Responsibility',
    '- You are responsible for your account and actions.',
    '- No ban evasion or alternate accounts without staff permission.',
    '## 8. Enforcement',
    '- Rule violations may result in warnings, mutes, kicks, or bans.',
    '- Punishments scale based on severity and repeat offenses.',
    '## 9. Discord Usernames / Display Names',
    'You must have your Discord display name set to your full Roblox username.',
    '- Violating this rule may result in warnings, mutes, or other moderation actions.',
    '## 10. Common Sense',
    '- Use common sense at all times.',
    '- If something is not clearly allowed, assume it is not allowed and ask staff.',
    '- Do not look for loopholes or attempt to bend rules.',
    '- Staff may take action on behavior that disrupts the community, even if it is not explicitly listed in the rules.',
    '- If a staff member says something is a rule, you must follow it. If you believe it is not a rule, you may open a report against the Moderator.',
].join('\n');

const VC_REGULATIONS = [
    '# Voice Channel Regulations',
    'Rules for Voice Channels',
    '## 1. Joining RP VCs',
    '- Do not join any RP voice channels if you are not in-game.',
    '- You may not join RTOs if you are not currently on that team.',
    '- Do not join scene VCs you are not a part of or were not invited to join.',
    '## 2. Using RP VCs as their intended purpose',
    '- Use channels for their intended purpose only. Do not hop into a specific RP channel (like Traffic Stop 1) just to catch up or chat with a friend.',
    '- Respect the scene. Unless your character is actively involved in that exact situation or you were invited, please stay out of the channel.',
    '## 3. RTO Rules',
    '- **Radio Traffic Only:** RTO means exactly that. Do not transmit anything that is not radio traffic. Out-of-character (OOC) chatter, casual conversation, and background noise are strictly prohibited.',
    '- **Keep It Brief:** All transmissions must be as realistic, short, and direct as possible. Clear the airwaves quickly.',
    '- **Callsign Identification:** Start all transmissions with your callsign using proper phonetic alphabet wording (e.g., Adam, Boy, Charles or Alpha, Bravo, Charlie).',
    '- **Transmit Cooldown:** There is a 2 second cooldown to talk over another unit. Talking over another unit unless you are dispatch is strictly prohibited.',
    '## 4. Voice Channels',
    '- **RTOs:** Radio Traffic Only voice channels for radio communication.',
    '- **Civilian VCs:** Reserved for civilians actively acting as a law-abiding citizen.',
    '- **Criminal VCs:** Reserved for criminals actively breaking the law.',
    '- **Scene VCs:** Reserved for scenes.',
    '- **Business Scenes:** Reserved for business scenes, such as Orlando Cafe.',
    '- **Traffic Stops:** Reserved for traffic stops conducted by a LEO.',
    '## 5. Remaining in character',
    '- **Strict In-Character Requirement:** You must remain in character at all times while inside any RP voice channel. There are absolutely no exceptions.',
    '- **Not a Lounge:** RP channels are not lounges for casual chatting, hanging out, or starting out-of-character (OOC) conversations.',
    '- **Zero OOC Breaks:** Do not break character or talk out-of-roleplay at any time. If you need to speak OOC, move to a designated Frequency Change VC or a Lounge.',
    '## Breaking Character (BCP) System',
    'We maintain a zero-tolerance policy regarding immersion breaking. To ensure the highest standard of realism, all members are strictly required to remain In-Character (IC) while inside any active Roleplay Voice Channel. By entering a Roleplay Voice Channel, you acknowledge that any OOC (Out-of-Character) commentary, meta-gaming, or non-RP disruption will be met with immediate action under our cumulative strike system, which applies to all members as follows:',
    '**1st Offense:** Formal Verbal Warning.',
    '**2nd Offense:** Immediate Server Mute.',
    '**3rd Offense:** 1-Hour Server Mute & 1-Hour In-Game Kick.',
    '**4th Offense:** 3-Hour Discord Mute & 24-Hour In-Game Ban.',
    '**5th Offense:** 24-Hour Discord Timeout & 4-Day In-Game Ban.',
    '**6th Offense:** Permanent In-Game Ban (Appealable).',
    '`Note:` All infractions are logged by our moderation team. Offenses are cumulative and do not expire. Permanent ban appeals require a 7-day waiting period and must be submitted via our official appeal ticket system.',
].join('\n');

function longRulesPanel(title: string, content: string): ContainerBuilder {
    const chunks: string[] = [];
    let remaining = content;
    while (remaining.length > 3_800) {
        let cut = remaining.lastIndexOf('\n', 3_800);
        if (cut < 1_500) cut = 3_800;
        chunks.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).replace(/^\n+/, '');
    }
    if (remaining) chunks.push(remaining);

    const panel = withDashboardBanner(title);
    for (const chunk of chunks) {
        panel.addSeparatorComponents(separator());
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
    }
    return panel;
}

type DashboardPrivateInteraction = ButtonInteraction | StringSelectMenuInteraction;

async function privatePanel(
    interaction: DashboardPrivateInteraction,
    panel: ContainerBuilder,
    includeBanner = true,
): Promise<void> {
    await interaction.reply({
        components: [panel],
        files: includeBanner ? [bannerAttachment()] : [],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
}

async function startExistingApplication(interaction: ButtonInteraction, type: 'discord' | 'ingame'): Promise<void> {
    const applications = require('./applications.ts') as {
        handleApplicationSelect?: (interaction: unknown) => Promise<boolean>;
    };
    if (typeof applications.handleApplicationSelect !== 'function') {
        throw new Error('Existing application starter is unavailable.');
    }

    const synthetic = new Proxy(interaction as unknown as Record<PropertyKey, unknown>, {
        get(target, property, receiver) {
            if (property === 'customId') return 'applications:type';
            if (property === 'values') return [type];
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(interaction) : value;
        },
    });
    await applications.handleApplicationSelect(synthetic);
}

export async function handleDashboardSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== 'dashboard:menu') return false;
    try {
        switch (interaction.values[0]) {
            case 'faq':
                await privatePanel(interaction, faqPanel());
                return true;
            case 'bulletin':
                await privatePanel(interaction, bulletinPanel());
                return true;
            case 'regulations':
                await privatePanel(interaction, regulationsPanel());
                return true;
            default:
                await interaction.reply({ content: 'That dashboard section is unavailable.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
                return true;
        }
    } catch (error) {
        logger.error(`[Dashboard] Select ${interaction.customId} failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: 'The dashboard could not open that section right now.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
}

export async function handleDashboardButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('dashboard:')) return false;

    if (interaction.customId.startsWith('dashboard:disabled:')) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: 'This dashboard option is coming soon.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }

    try {
        switch (interaction.customId) {
            // Keep old top-level button IDs supported for dashboards posted before this update.
            case 'dashboard:faq':
                await privatePanel(interaction, faqPanel());
                return true;
            case 'dashboard:bulletin':
                await privatePanel(interaction, bulletinPanel());
                return true;
            case 'dashboard:regulations':
                await privatePanel(interaction, regulationsPanel());
                return true;
            case 'dashboard:faq:partner':
                await privatePanel(interaction, partnershipPanel(), false);
                return true;
            case 'dashboard:faq:verify':
                await privatePanel(interaction, verifyPanel());
                return true;
            case 'dashboard:faq:moderator':
                await privatePanel(interaction, moderatorPanel());
                return true;
            case 'dashboard:apply:discord':
                await startExistingApplication(interaction, 'discord');
                return true;
            case 'dashboard:apply:ingame':
                await startExistingApplication(interaction, 'ingame');
                return true;
            case 'dashboard:regulations:discord':
                await privatePanel(interaction, longRulesPanel('## <:Discord:1522529390687293460> Discord Regulations', DISCORD_GUIDELINES));
                return true;
            case 'dashboard:regulations:vc':
                await privatePanel(interaction, longRulesPanel('## <:ROBLOX:1020834558058442813> VC Regulations', VC_REGULATIONS));
                return true;
            default:
                return false;
        }
    } catch (error) {
        logger.error(`[Dashboard] Button ${interaction.customId} failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: 'The dashboard could not open that section right now.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
}

export const dashboardCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Post the Los Angeles Roleplay V2 dashboard')
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

            await channel.send({
                components: [mainDashboard()],
                files: [bannerAttachment()],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });

            await interaction.editReply(`✅ Dashboard posted in <#${DASHBOARD_CHANNEL_ID}>.`);
            logger.info(`[Dashboard] V2 dashboard posted in ${DASHBOARD_CHANNEL_ID} by ${interaction.user.id}.`);
        } catch (error) {
            logger.error(`[Dashboard] Could not post dashboard: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            await interaction.editReply('I could not post the dashboard. Check my channel permissions and the dashboard banner asset.');
        }
    },
};
