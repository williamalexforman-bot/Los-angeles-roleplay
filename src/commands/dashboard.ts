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
import { DISCORD_GUIDELINES, GAME_GUIDELINES } from './supportContent';

const DASHBOARD_CHANNEL_ID = '1526049604712529971';
const VERIFY_CHANNEL_ID = '1541264318799159326';
const DASHBOARD_BANNER_NAME = 'dashboard-banner.png';
const DASHBOARD_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', DASHBOARD_BANNER_NAME);
const RULES_BANNER_NAME = 'rules-banner.png';
const RULES_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', RULES_BANNER_NAME);
const UNDERBANNER_NAME = 'underbanner.png';
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);
const DISCORD_EMOJI_ID = '1522529390687293460';
const ROBLOX_EMOJI_ID = '1020834558058442813';

const ROLE_CONFIG = {
    event: { id: '1521593407749754989', label: 'Event Ping', emoji: '📆' },
    session: { id: '1521593407749754990', label: 'Session Ping', emoji: '🎮' },
    announcement: { id: '1521593407762464944', label: 'Announcement Ping', emoji: '📢' },
    giveaway: { id: '1528128142709887146', label: 'Giveaway Ping', emoji: '🎉' },
    content: { id: '1521593407741362265', label: 'Content Ping', emoji: '🖥️' },
} as const;

type RoleKey = keyof typeof ROLE_CONFIG;
type DashboardPrivateInteraction = ButtonInteraction | StringSelectMenuInteraction;

function artworkFor(name: string, filePath: string): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(filePath, { name }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}
function bannerAttachments(): AttachmentBuilder[] { return artworkFor(DASHBOARD_BANNER_NAME, DASHBOARD_BANNER_PATH); }
function rulesAttachments(): AttachmentBuilder[] { return artworkFor(RULES_BANNER_NAME, RULES_BANNER_PATH); }
function separator(): SeparatorBuilder { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }
function media(name: string): MediaGalleryBuilder { return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)); }
function dashboardButton(customId: string, label: string, emoji?: string | { id: string; name: string }, style: ButtonStyle = ButtonStyle.Secondary): ActionRowBuilder<ButtonBuilder> { const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style); if (emoji) button.setEmoji(emoji); return new ActionRowBuilder<ButtonBuilder>().addComponents(button); }
function disabledButton(customId: string, label: string, emoji?: string): ActionRowBuilder<ButtonBuilder> { const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(true); if (emoji) button.setEmoji(emoji); return new ActionRowBuilder<ButtonBuilder>().addComponents(button); }
function dashboardNavigation(): ActionRowBuilder<StringSelectMenuBuilder> { return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('dashboard:menu').setPlaceholder('Select a dashboard section').addOptions({ label: 'Frequently Asked Questions', value: 'faq', emoji: '❔', description: 'Partnerships, verification, and moderator applications' },{ label: 'Discord Bulletin', value: 'bulletin', emoji: '📌', description: 'Official Los Angeles Roleplay resources' },{ label: 'Regulations', value: 'regulations', emoji: '📖', description: 'Discord and voice channel regulations' })); }
function roleButtons(): ActionRowBuilder<ButtonBuilder> { return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('dashboard:role:announcement').setLabel('Announcement Ping').setEmoji('📢').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dashboard:role:session').setLabel('Session Ping').setEmoji('🎮').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dashboard:role:event').setLabel('Event Ping').setEmoji('📆').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dashboard:role:content').setLabel('Content Ping').setEmoji('🖥️').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dashboard:role:giveaway').setLabel('Giveaway Ping').setEmoji('🎉').setStyle(ButtonStyle.Secondary)); }
function withBanner(content: string, bannerName = DASHBOARD_BANNER_NAME): ContainerBuilder { return new ContainerBuilder().setAccentColor(BRAND.color).addMediaGalleryComponents(media(bannerName)).addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent(content)); }
function withDashboardBanner(content: string): ContainerBuilder { return withBanner(content, DASHBOARD_BANNER_NAME); }

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
    '- 📢  `-` Announcement Ping','- 🎮  `-` Session Ping','- 📆  `-` Event Ping','- 🖥  `-` Content Ping','- 🎉  `-` Giveaway Ping',
    '',
    '# <:link:1531485100368334900>Important Channels',
    '> <#1526034504953892925>  `If you need any help`','> <#1526035127606706196>  `Buy LA VIP and more`','> <#1526035041593856182>  `Apply here`','> <#1526046592187105421>  `Read server regulations`',`> <#${VERIFY_CHANNEL_ID}>  \`Verify here\``,
].join('\n');

function mainDashboard(): ContainerBuilder { return withDashboardBanner(DASHBOARD_TEXT).addSeparatorComponents(separator()).addActionRowComponents(dashboardNavigation()).addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🔔 Notification Roles\nUse the buttons below to add or remove your ping roles.')).addActionRowComponents(roleButtons()).addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent('*Los Angeles Roleplay • Most immersive Los Angeles experience*')).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function faqPanel(): ContainerBuilder { return withDashboardBanner('## Frequently Asked Questions').addSeparatorComponents(separator()).addActionRowComponents(dashboardButton('dashboard:faq:partner','How do I partner with LARP?','❔'),dashboardButton('dashboard:faq:verify','How do I verify?','❔'),dashboardButton('dashboard:faq:moderator','How do I become a Moderator?','❔')).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function partnershipPanel(): ContainerBuilder { return new ContainerBuilder().setAccentColor(BRAND.color).addTextDisplayComponents(new TextDisplayBuilder().setContent(['## 🤝 Partnership Program','To partner with **LARP**, use `/partnership request` to open the partnership request form.','','Please use a permanent Discord invite and include your complete server advertisement.'].join('\n'))); }
function verifyPanel(): ContainerBuilder { return withDashboardBanner(['## ✅ How do I verify?',`To verify in our server, head over to <#${VERIFY_CHANNEL_ID}> and follow the verification instructions there.`].join('\n')).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function moderatorPanel(): ContainerBuilder { return withDashboardBanner(['## 🛡️ How do I become a Moderator?','To become a moderator in **LARP**, use the application buttons below. Make sure your written responses use proper SPaG and meet the application requirements.','','**DO NOT ASK FOR YOUR APPLICATION TO BE READ.**'].join('\n')).addSeparatorComponents(separator()).addActionRowComponents(dashboardButton('dashboard:apply:discord','Discord Moderator',{ id: DISCORD_EMOJI_ID,name:'Discord' },ButtonStyle.Primary),dashboardButton('dashboard:apply:ingame','In-Game Moderator',{ id: ROBLOX_EMOJI_ID,name:'ROBLOX' },ButtonStyle.Primary)).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function bulletinPanel(): ContainerBuilder { return withDashboardBanner('## Discord Bulletin').addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent(['Use the official Los Angeles Roleplay channels below for important server resources.','','• <#1526035041593856182> — Applications','• <#1526046592187105421> — Server Regulations','• <#1526192979218530335> — Departments',`• <#${VERIFY_CHANNEL_ID}> — Verification`,'• <#1526034504953892925> — Help / Assistance'].join('\n'))).addSeparatorComponents(separator()).addActionRowComponents(disabledButton('dashboard:disabled:applications','Applications','📝')).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function regulationsPanel(): ContainerBuilder { return withBanner('## Regulations', RULES_BANNER_NAME).addSeparatorComponents(separator()).addActionRowComponents(dashboardButton('dashboard:regulations:discord','Discord Regulations',{ id:DISCORD_EMOJI_ID,name:'Discord' }),dashboardButton('dashboard:regulations:vc','VC Regulations',{ id:ROBLOX_EMOJI_ID,name:'ROBLOX' })).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }

function longRulesPanel(title:string,content:string):ContainerBuilder { const chunks:string[]=[]; let remaining=content; while(remaining.length>3800){ let cut=remaining.lastIndexOf('\n',3800); if(cut<1500)cut=3800; chunks.push(remaining.slice(0,cut)); remaining=remaining.slice(cut).replace(/^\n+/,''); } if(remaining)chunks.push(remaining); const panel=withBanner(title,RULES_BANNER_NAME); for(const chunk of chunks){ panel.addSeparatorComponents(separator()); panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk)); } return panel.addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }

async function privatePanel(interaction: DashboardPrivateInteraction, panel: ContainerBuilder, includeBanner = true, useRulesBanner = false): Promise<void> { await interaction.reply({ components:[panel], files: includeBanner ? (useRulesBanner ? rulesAttachments() : bannerAttachments()) : [], flags:MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, allowedMentions:{ parse:[] } }); }
async function startExistingApplication(interaction: ButtonInteraction,type:'discord'|'ingame'):Promise<void>{ const applications=require('./applications.ts') as {handleApplicationSelect?:(interaction:unknown)=>Promise<boolean>}; if(typeof applications.handleApplicationSelect!=='function')throw new Error('Existing application starter is unavailable.'); const synthetic=new Proxy(interaction as unknown as Record<PropertyKey,unknown>,{get(target,property,receiver){if(property==='customId')return'applications:type';if(property==='values')return[type];const value=Reflect.get(target,property,receiver);return typeof value==='function'?value.bind(interaction):value;}}); await applications.handleApplicationSelect(synthetic); }
export async function handleDashboardSelect(interaction:StringSelectMenuInteraction):Promise<boolean>{ if(interaction.customId!=='dashboard:menu')return false; try{switch(interaction.values[0]){case'faq':await privatePanel(interaction,faqPanel());return true;case'bulletin':await privatePanel(interaction,bulletinPanel());return true;case'regulations':await privatePanel(interaction,regulationsPanel(),true,true);return true;default:await interaction.reply({content:'That dashboard section is unavailable.',flags:MessageFlags.Ephemeral});return true;}}catch(error){logger.error(`[Dashboard] Select failed: ${error instanceof Error?error.stack||error.message:String(error)}`);if(!interaction.deferred&&!interaction.replied)await interaction.reply({content:'The dashboard could not open that section right now.',flags:MessageFlags.Ephemeral}).catch(()=>undefined);return true;}}
async function toggleRole(interaction:ButtonInteraction,key:RoleKey):Promise<boolean>{if(!interaction.guild){await interaction.reply({content:'This button can only be used inside the server.',flags:MessageFlags.Ephemeral});return true;}const config=ROLE_CONFIG[key];await interaction.deferReply({flags:MessageFlags.Ephemeral});const member=await interaction.guild.members.fetch(interaction.user.id).catch(()=>null);const role=interaction.guild.roles.cache.get(config.id)||await interaction.guild.roles.fetch(config.id).catch(()=>null);if(!member||!role){await interaction.editReply('I could not load your account or that ping role.');return true;}try{if(member.roles.cache.has(config.id)){await member.roles.remove(role,`Dashboard ping role removed by ${interaction.user.tag}`);await interaction.editReply(`${config.emoji} Removed **${config.label}** from you.`);}else{await member.roles.add(role,`Dashboard ping role added by ${interaction.user.tag}`);await interaction.editReply(`${config.emoji} Added **${config.label}** to you.`);}}catch(error){logger.warn(`[Dashboard] Role toggle failed for ${interaction.user.id} / ${config.id}: ${error instanceof Error?error.message:String(error)}`);await interaction.editReply('I could not change that role. Make sure my bot role is above the ping roles and has **Manage Roles** permission.');}return true;}
export async function handleDashboardButton(interaction:ButtonInteraction):Promise<boolean>{if(!interaction.customId.startsWith('dashboard:'))return false;if(interaction.customId.startsWith('dashboard:role:')){const key=interaction.customId.split(':')[2] as RoleKey;if(!ROLE_CONFIG[key]){await interaction.reply({content:'That ping role is not configured.',flags:MessageFlags.Ephemeral});return true;}return toggleRole(interaction,key);}if(interaction.customId.startsWith('dashboard:disabled:')){await interaction.reply({content:'This dashboard option is coming soon.',flags:MessageFlags.Ephemeral}).catch(()=>undefined);return true;}try{switch(interaction.customId){case'dashboard:faq':await privatePanel(interaction,faqPanel());return true;case'dashboard:bulletin':await privatePanel(interaction,bulletinPanel());return true;case'dashboard:regulations':await privatePanel(interaction,regulationsPanel(),true,true);return true;case'dashboard:faq:partner':await privatePanel(interaction,partnershipPanel(),false);return true;case'dashboard:faq:verify':await privatePanel(interaction,verifyPanel());return true;case'dashboard:faq:moderator':await privatePanel(interaction,moderatorPanel());return true;case'dashboard:apply:discord':await startExistingApplication(interaction,'discord');return true;case'dashboard:apply:ingame':await startExistingApplication(interaction,'ingame');return true;case'dashboard:regulations:discord':await privatePanel(interaction,longRulesPanel('## Discord Regulations',DISCORD_GUIDELINES),true,true);return true;case'dashboard:regulations:vc':await privatePanel(interaction,longRulesPanel('## Game Regulations',GAME_GUIDELINES),true,true);return true;default:return false;}}catch(error){logger.error(`[Dashboard] Button failed: ${error instanceof Error?error.stack||error.message:String(error)}`);if(!interaction.deferred&&!interaction.replied)await interaction.reply({content:'The dashboard could not process that button right now.',flags:MessageFlags.Ephemeral}).catch(()=>undefined);return true;}}
export function buildDashboardRefreshPayload(){return{components:[mainDashboard()],files:bannerAttachments(),flags:MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2,allowedMentions:{parse:[] as[]}};}
export const dashboardCommand={data:new SlashCommandBuilder().setName('dashboard').setDescription('Post or refresh the Los Angeles Roleplay dashboard').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),async execute(interaction:ChatInputCommandInteraction):Promise<void>{await interaction.deferReply({flags:MessageFlags.Ephemeral});const channel=await interaction.client.channels.fetch(DASHBOARD_CHANNEL_ID).catch(()=>null);if(!channel?.isTextBased()||!('messages'in channel)||!channel.isSendable()){await interaction.editReply(`I could not access <#${DASHBOARD_CHANNEL_ID}>.`);return;}const recent=await channel.messages.fetch({limit:50}).catch(()=>null);const existing=recent?.find(message=>message.author.id===interaction.client.user?.id&&message.components.length>0);const payload=buildDashboardRefreshPayload();if(existing){await existing.edit({...payload,attachments:[]}).catch(async()=>{await channel.send(payload);});}else{await channel.send(payload);}await interaction.editReply('✅ Dashboard refreshed with the new banner set.');}};
