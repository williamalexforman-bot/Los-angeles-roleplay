import { resolve } from 'path';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    ContainerBuilder,
    EmbedBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
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
    type GuildMember,
    type Message,
    type TextChannel,
} from 'discord.js';
import { BRAND } from '../config/constants';
import { legacyEmbedToV2Message } from '../utils/embeds';
import { logger } from '../utils/logger';

const ASSISTANCE_BANNER_NAME = 'assistance-banner.png';
const UNDERBANNER_NAME = 'underbanner.png';
const ASSISTANCE_BANNER_PATH = resolve(__dirname, '..', '..', 'assets', ASSISTANCE_BANNER_NAME);
const UNDERBANNER_PATH = resolve(__dirname, '..', '..', 'assets', UNDERBANNER_NAME);

const TICKET_SUPPORT_ROLE_ID = '1523122697746382868';
const TICKET_PANEL_CHANNEL_ID = '1526034504953892925';
const TICKET_LOG_CHANNEL_ID = '1526255112149008524';
const TICKET_TRANSCRIPT_CHANNEL_ID = '1526255184303493291';
const TICKET_CATEGORIES = {
    general: { label: 'General Support', emoji: '🎫', parentId: '1526254341646712883' },
    internal: { label: 'Internal Affairs Support', emoji: '📋', parentId: '1526254402426503320' },
    management: { label: 'Management Support', emoji: '🏛️', parentId: '1526254462128099479' },
    highrank: { label: 'High-Rank Support', emoji: '⭐', parentId: '1526254518570844231' },
} as const;

type TicketType = keyof typeof TICKET_CATEGORIES;
interface TicketMetadata { ownerId: string; type: TicketType; createdAt: string; claimedBy?: string; panelMessageId?: string; }

const PANEL_COPY = [
    '## 🎫 Los Angeles Roleplay Support',
    'Welcome to the Los Angeles Roleplay support system! If you have an issue, select the proper option below.',
    '',
    'After selecting an option, you must provide a clear reason for opening your ticket. Choose the correct category so our team can help you quickly. Trolling in tickets may result in punishment.',
    '',
    '━━━━━━━━━━━━━━━━━━━',
    '### 🎫 General Support',
    '> General questions • Server information',
    '### 📋 Internal Affairs Support',
    '> Staff reports • Application inquiries',
    '### 🏛️ Management Support',
    '> High Rank+ reports • Perk/prize claims • Paid advertisements • Partnerships • Staff transfers and fast passes',
    '### ⭐ High-Rank Support',
    '> Prize/payment claims • Marketplace concerns • Ownership questions',
    '',
    '*Realism at its finest*',
].join('\n');

function artwork(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(ASSISTANCE_BANNER_PATH, { name: ASSISTANCE_BANNER_NAME }),
        new AttachmentBuilder(UNDERBANNER_PATH, { name: UNDERBANNER_NAME }),
    ];
}
function media(name: string): MediaGalleryBuilder { return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)); }
function separator(): SeparatorBuilder { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }
function ticketSelect(): ActionRowBuilder<StringSelectMenuBuilder> { return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:create-select').setPlaceholder('Select the correct support category').addOptions(...Object.entries(TICKET_CATEGORIES).map(([value, category]) => ({ label: category.label, value, emoji: category.emoji })))); }
function buildTicketLauncher(): ContainerBuilder { return new ContainerBuilder().setAccentColor(BRAND.color).addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME)).addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent(PANEL_COPY)).addActionRowComponents(ticketSelect()).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function compact(value: string, max = 700): string { const clean = value.replace(/```/g, "'''").trim() || 'Not provided.'; return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; }
function ticketActionRows(claimedBy?: string): ActionRowBuilder<ButtonBuilder>[] { return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('ticket:claim').setLabel(claimedBy ? `Claimed by ${claimedBy}`.slice(0, 80) : 'Claim Ticket').setEmoji('🙋').setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(Boolean(claimedBy)), new ButtonBuilder().setCustomId('ticket:close').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('ticket:close-request').setLabel('Request Close').setEmoji('📝').setStyle(ButtonStyle.Secondary))]; }
function buildOpenTicketPanel(userId: string, username: string, accountCreated: number, joinedAt: number | null, type: TicketType, answers: ReadonlyArray<{ label: string; value: string }>, discordLogo: string): ContainerBuilder { const category = TICKET_CATEGORIES[type]; const details = [`<@&${TICKET_SUPPORT_ROLE_ID}> • <@${userId}>`,`## ${category.emoji} ${category.label} Ticket`,...answers.flatMap(answer => [`### ${answer.label}`,`\`\`\`\n${compact(answer.value)}\n\`\`\``]),`### ${discordLogo} Discord Account Information`,`> **Username:** \`${compact(username, 80)}\``,`> **User ID:** \`${userId}\``,`> **Account Created:** <t:${Math.floor(accountCreated / 1_000)}:F>`,`> **Joined Server:** ${joinedAt ? `<t:${Math.floor(joinedAt / 1_000)}:F>` : 'Unavailable'}`].join('\n'); const panel = new ContainerBuilder().setAccentColor(BRAND.color).addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME)).addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent(details.slice(0, 4_000))); for (const row of ticketActionRows()) panel.addActionRowComponents(row); return panel.addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function buildCloseRequestPanel(ownerId: string, requesterId: string, reason: string): ContainerBuilder { return new ContainerBuilder().setAccentColor(BRAND.color).addMediaGalleryComponents(media(ASSISTANCE_BANNER_NAME)).addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent([`<@${ownerId}>`,'## 📝 Ticket Close Request',`<@${requesterId}> would like to close this ticket.`,'','**Reason:**',`\`\`\`\n${compact(reason, 1_000)}\n\`\`\``].join('\n'))).addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('ticket:close-confirm').setLabel('Close').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('ticket:close-keep').setLabel('Keep Open').setStyle(ButtonStyle.Secondary))).addSeparatorComponents(separator()).addMediaGalleryComponents(media(UNDERBANNER_NAME)); }
function encodeMetadata(metadata: TicketMetadata): string { return `larp-ticket:${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')}`; }
function decodeMetadata(topic?: string | null): TicketMetadata | null { if (!topic?.startsWith('larp-ticket:')) return null; try { const parsed = JSON.parse(Buffer.from(topic.slice('larp-ticket:'.length), 'base64url').toString('utf8')) as TicketMetadata; return parsed.ownerId && parsed.type in TICKET_CATEGORIES ? parsed : null; } catch { return null; } }
function safeChannelName(value: string): string { return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'member'; }
function memberHasRole(member: ButtonInteraction['member'], roleId: string): boolean { if (!member) return false; const roles = (member as GuildMember).roles; if (roles && 'cache' in roles) return roles.cache.has(roleId); return Array.isArray((member as { roles?: string[] }).roles) && (member as { roles: string[] }).roles.includes(roleId); }
function isTicketStaff(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction): boolean { return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) || memberHasRole(interaction.member, TICKET_SUPPORT_ROLE_ID); }
function createTicketModal(type: TicketType): ModalBuilder { const modal = new ModalBuilder().setCustomId(`ticket:create-modal:${type}`).setTitle(`${TICKET_CATEGORIES[type].label} Ticket`.slice(0, 45)); if (type === 'internal') return modal.addComponents(modalInput('reported_user','User you are reporting',TextInputStyle.Short),modalInput('reason','Reason for report',TextInputStyle.Paragraph),modalInput('proof','Do you have proof?',TextInputStyle.Paragraph),modalInput('anything_else','Anything else?',TextInputStyle.Paragraph,false)); return modal.addComponents(modalInput('reason','Reason for opening ticket',TextInputStyle.Paragraph)); }
function closeRequestModal(): ModalBuilder { return new ModalBuilder().setCustomId('ticket:close-request-modal').setTitle('Request Ticket Closure').addComponents(modalInput('reason','Reason for close request',TextInputStyle.Paragraph)); }
function modalInput(customId: string, label: string, style: TextInputStyle, required = true): ActionRowBuilder<TextInputBuilder> { return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(style === TextInputStyle.Short ? 100 : 1_000)); }
async function discordLogo(guild: ModalSubmitInteraction['guild']): Promise<string> { if (!guild) return '💬'; const emojis = await guild.emojis.fetch().catch(() => null); return emojis?.find(emoji => emoji.name?.toLowerCase() === 'discord_logo')?.toString() || '💬'; }
function modalAnswers(interaction: ModalSubmitInteraction, type: TicketType): Array<{ label: string; value: string }> { if (type === 'internal') return [{ label:'User Reported',value:interaction.fields.getTextInputValue('reported_user')},{ label:'Reason for Report',value:interaction.fields.getTextInputValue('reason')},{ label:'Proof',value:interaction.fields.getTextInputValue('proof')},{ label:'Anything Else',value:interaction.fields.getTextInputValue('anything_else') || 'Nothing else provided.' }]; return [{ label:'Reason for Opening Ticket',value:interaction.fields.getTextInputValue('reason') }]; }

async function createTicket(interaction: ModalSubmitInteraction, type: TicketType): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) { await interaction.editReply('Tickets can only be created inside the server.'); return; }
    const category = TICKET_CATEGORIES[type];
    const metadata: TicketMetadata = { ownerId: interaction.user.id, type, createdAt: new Date().toISOString() };
    let channel: TextChannel | null = null;
    try {
        channel = await guild.channels.create({
            name: `${type}-${safeChannelName(interaction.user.username)}-${Date.now().toString().slice(-6)}`.slice(0, 100),
            type: ChannelType.GuildText,
            parent: category.parentId,
            topic: encodeMetadata(metadata),
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks] },
                { id: TICKET_SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageMessages] },
                { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages] },
            ],
            reason: `${category.label} ticket opened by ${interaction.user.tag}`,
        });
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        const panelMessage = await channel.send({ components: [buildOpenTicketPanel(interaction.user.id,interaction.user.username,interaction.user.createdTimestamp,member?.joinedTimestamp || null,type,modalAnswers(interaction,type),await discordLogo(guild))], files: artwork(), flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], users: [interaction.user.id], roles: [TICKET_SUPPORT_ROLE_ID] } });
        metadata.panelMessageId = panelMessage.id;
        await channel.setTopic(encodeMetadata(metadata), `Ticket panel linked for ${interaction.user.id}`);
        await interaction.editReply(`✅ Your ${category.label} ticket has been created: <#${channel.id}>`);
    } catch (error) {
        if (channel) await channel.delete('Ticket setup failed.').catch(() => undefined);
        logger.error(`[Tickets] Could not create ticket: ${error instanceof Error ? error.message : 'Unknown'}`);
        await interaction.editReply('Unable to create your ticket. Please contact an administrator.');
    }
}

async function ticketTranscript(channel: TextChannel): Promise<Buffer> { const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null); const lines = messages ? Array.from(messages.values()).sort((a,b)=>a.createdTimestamp-b.createdTimestamp).map(message => { const attachments = Array.from(message.attachments.values()).map(file => file.url).join(' '); return `[${message.createdAt.toISOString()}] ${message.author.tag} (${message.author.id}): ${message.cleanContent || '[no text]'}${attachments ? ` ${attachments}` : ''}`; }) : ['Transcript could not be fetched.']; return Buffer.from(lines.join('\n'),'utf8'); }
async function writeCloseLogs(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, channel: TextChannel, metadata: TicketMetadata, reason: string): Promise<void> { const transcript = await ticketTranscript(channel); const transcriptName = `${channel.name}-transcript.txt`; const transcriptChannel = await interaction.client.channels.fetch(TICKET_TRANSCRIPT_CHANNEL_ID).catch(() => null); if (transcriptChannel?.isSendable()) await transcriptChannel.send({ content:`Transcript for **${channel.name}** • Opened by <@${metadata.ownerId}> • Closed by <@${interaction.user.id}>`,files:[new AttachmentBuilder(transcript,{ name:transcriptName })],allowedMentions:{ parse:[] } }).catch(()=>undefined); const logChannel = await interaction.client.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(()=>null); if(logChannel?.isSendable()){ const embed = new EmbedBuilder().setColor(BRAND.color).setTitle('Ticket Closed').addFields({ name:'Ticket',value:channel.name,inline:true},{ name:'Opened By',value:`<@${metadata.ownerId}>`,inline:true},{ name:'Closed By',value:`<@${interaction.user.id}>`,inline:true},{ name:'Category',value:TICKET_CATEGORIES[metadata.type].label,inline:true},{ name:'Claimed By',value:metadata.claimedBy ? `<@${metadata.claimedBy}>` : 'Unclaimed',inline:true},{ name:'Reason',value:compact(reason,1_000) }).setFooter({ text:BRAND.footer }).setTimestamp(); await logChannel.send(legacyEmbedToV2Message(embed,{ allowedMentions:{ parse:[] } })).catch(()=>undefined); } }
async function closeTicket(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, reason: string): Promise<void> { const channel = interaction.channel; if(!channel || channel.type !== ChannelType.GuildText){ await interaction.editReply('This command can only be used inside a ticket channel.'); return; } const metadata=decodeMetadata(channel.topic); if(!metadata){ await interaction.editReply('This is not a managed ticket channel.'); return; } if(interaction.user.id!==metadata.ownerId && !isTicketStaff(interaction)){ await interaction.editReply('Only the ticket opener or support staff can close this ticket.'); return; } await writeCloseLogs(interaction,channel,metadata,reason); await interaction.editReply('🔒 Ticket closed. The transcript and ticket log were saved.'); await channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch(error => logger.error(`[Tickets] Could not delete ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)); }
function updatedClaimComponents(interaction: ButtonInteraction): unknown[] { const components = interaction.message.components.map(component => component.toJSON()) as unknown as Array<Record<string, unknown>>; const visit=(node:Record<string,unknown>):void=>{ if(node.custom_id==='ticket:claim'){ node.label=`Claimed by ${interaction.user.username}`.slice(0,80); node.disabled=true; node.style=ButtonStyle.Secondary; } for(const child of (node.components as Array<Record<string,unknown>>|undefined)||[]) visit(child); }; for(const component of components) visit(component); return components; }
function restoredClaimComponents(message: Message): unknown[] { const components=message.components.map(component=>component.toJSON()) as unknown as Array<Record<string,unknown>>; const visit=(node:Record<string,unknown>):void=>{ if(node.custom_id==='ticket:claim'){ node.label='Claim Ticket'; node.disabled=false; node.style=ButtonStyle.Primary; } for(const child of (node.components as Array<Record<string,unknown>>|undefined)||[]) visit(child); }; for(const component of components) visit(component); return components; }
function containsClaimButton(message: Message): boolean { const visit=(node:Record<string,unknown>):boolean=>{ if(node.custom_id==='ticket:claim') return true; return ((node.components as Array<Record<string,unknown>>|undefined)||[]).some(visit); }; return message.components.some(component=>visit(component.toJSON() as unknown as Record<string,unknown>)); }
async function findTicketPanelMessage(channel: TextChannel, metadata: TicketMetadata): Promise<Message | null> { if(metadata.panelMessageId){ const linked=await channel.messages.fetch(metadata.panelMessageId).catch(()=>null); if(linked&&containsClaimButton(linked)) return linked; } const recent=await channel.messages.fetch({ limit:100 }).catch(()=>null); return recent?.find(message=>message.author.id===channel.client.user.id && containsClaimButton(message)) || null; }

export async function handleTicketSelect(interaction: StringSelectMenuInteraction): Promise<boolean> { if(interaction.customId!=='ticket:create-select') return false; const type=interaction.values[0] as TicketType; if(!(type in TICKET_CATEGORIES)){ await interaction.reply({ content:'That ticket category is unavailable.',flags:MessageFlags.Ephemeral }); return true; } await interaction.showModal(createTicketModal(type)); return true; }
export async function handleTicketButton(interaction: ButtonInteraction): Promise<boolean> { if(!interaction.customId.startsWith('ticket:')) return false; if(interaction.customId==='ticket:claim'){ const channel=interaction.channel; if(!channel||channel.type!==ChannelType.GuildText) return true; const metadata=decodeMetadata(channel.topic); if(!metadata){ await interaction.reply({ content:'This is not a managed ticket.',flags:MessageFlags.Ephemeral }); return true; } if(!isTicketStaff(interaction)){ await interaction.reply({ content:'Only support staff can claim tickets.',flags:MessageFlags.Ephemeral }); return true; } if(metadata.claimedBy){ await interaction.reply({ content:`This ticket is already claimed by <@${metadata.claimedBy}>.`,flags:MessageFlags.Ephemeral }); return true; } metadata.claimedBy=interaction.user.id; await channel.setTopic(encodeMetadata(metadata)); await interaction.update({ components:updatedClaimComponents(interaction) as never }); await interaction.followUp({ content:`✅ Ticket claimed by <@${interaction.user.id}>.`,allowedMentions:{ parse:[] } }); return true; } if(interaction.customId==='ticket:close'){ await interaction.deferReply({ flags:MessageFlags.Ephemeral }); await closeTicket(interaction,'Closed from the ticket panel.'); return true; } if(interaction.customId==='ticket:close-request'){ await interaction.showModal(closeRequestModal()); return true; } if(interaction.customId==='ticket:close-confirm'){ await interaction.deferReply({ flags:MessageFlags.Ephemeral }); await closeTicket(interaction,'Close request accepted.'); return true; } if(interaction.customId==='ticket:close-keep'){ const channel=interaction.channel; const metadata=channel?.type===ChannelType.GuildText ? decodeMetadata(channel.topic) : null; if(!metadata || (interaction.user.id!==metadata.ownerId&&!isTicketStaff(interaction))){ await interaction.reply({ content:'Only the ticket opener or support staff can answer this request.',flags:MessageFlags.Ephemeral }); return true; } await interaction.reply({ content:'The ticket will remain open.',flags:MessageFlags.Ephemeral }); await interaction.message.delete().catch(()=>undefined); return true; } return false; }
export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> { if(interaction.customId.startsWith('ticket:create-modal:')){ const type=interaction.customId.split(':')[2] as TicketType; if(!(type in TICKET_CATEGORIES)) return false; await createTicket(interaction,type); return true; } if(interaction.customId==='ticket:close-request-modal'){ await interaction.deferReply({ flags:MessageFlags.Ephemeral }); const channel=interaction.channel; if(!channel||channel.type!==ChannelType.GuildText){ await interaction.editReply('This can only be used inside a ticket channel.'); return true; } const metadata=decodeMetadata(channel.topic); if(!metadata){ await interaction.editReply('This is not a managed ticket channel.'); return true; } const reason=interaction.fields.getTextInputValue('reason'); await channel.send({ components:[buildCloseRequestPanel(metadata.ownerId,interaction.user.id,reason)],files:artwork(),flags:MessageFlags.IsComponentsV2,allowedMentions:{ parse:[],users:[metadata.ownerId] } }); await interaction.editReply('✅ Your close request was sent to the ticket opener.'); return true; } return false; }

export function isTicketPanelCommandName(commandName: string): boolean { return commandName.replace(/[-_\s]/g,'').toLowerCase()==='ticketpanel' || commandName.toLowerCase()==='ticket'; }
export function buildTicketPanelRefreshPayload() { return { components:[buildTicketLauncher()], files:artwork(), flags:MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2, allowedMentions:{ parse:[] as [] } }; }
export async function postTicketPanel(interaction: ChatInputCommandInteraction): Promise<void> { await interaction.deferReply({ flags:MessageFlags.Ephemeral }); const channel=await interaction.client.channels.fetch(TICKET_PANEL_CHANNEL_ID).catch(()=>null); if(!channel?.isTextBased()||!('messages' in channel)||!channel.isSendable()){ await interaction.editReply(`The ticket panel channel <#${TICKET_PANEL_CHANNEL_ID}> is unavailable.`); return; } try { const recent=await channel.messages.fetch({ limit:50 }).catch(()=>null); const existing=recent?.find(message=>message.author.id===interaction.client.user?.id && JSON.stringify(message.components.map(component=>component.toJSON())).includes('ticket:create-select')); const payload=buildTicketPanelRefreshPayload(); if(existing) await existing.edit({...payload,attachments:[]}).catch(async()=>{ await channel.send(payload); }); else await channel.send(payload); await interaction.editReply(`✅ The V2 Assistance ticket panel was refreshed in <#${TICKET_PANEL_CHANNEL_ID}>.`); } catch(error){ logger.error(`[Tickets] Could not refresh the ticket panel: ${error instanceof Error ? error.message : 'Unknown error'}`); await interaction.editReply(`I could not update <#${TICKET_PANEL_CHANNEL_ID}>. Check that I can view the channel, send messages, and attach files.`); } }

const ticketPanelCommand={ data:new SlashCommandBuilder().setName('ticket-panel').setDescription('Post the Los Angeles Roleplay support ticket panel (legacy alias)').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async execute(interaction:ChatInputCommandInteraction):Promise<void>{ await postTicketPanel(interaction); } };
const ticketPanelCompatibilityCommand={ data:new SlashCommandBuilder().setName('ticketpanel').setDescription('Post the Los Angeles Roleplay V2 support ticket panel').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async execute(interaction:ChatInputCommandInteraction):Promise<void>{ await postTicketPanel(interaction); } };
const ticketCommand={ data:new SlashCommandBuilder().setName('ticket').setDescription('Manage the Los Angeles Roleplay ticket system').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addSubcommand(subcommand=>subcommand.setName('panel').setDescription('Post the V2 support ticket panel in the configured channel')), async execute(interaction:ChatInputCommandInteraction):Promise<void>{ await postTicketPanel(interaction); } };
const closeCommand={ data:new SlashCommandBuilder().setName('close').setDescription('Close the current ticket and save its transcript').setDMPermission(false), async execute(interaction:ChatInputCommandInteraction):Promise<void>{ await interaction.deferReply({ flags:MessageFlags.Ephemeral }); await closeTicket(interaction,'Closed with /close.'); } };
const closeRequestCommand={ data:new SlashCommandBuilder().setName('closerequest').setDescription('Ask the ticket opener for permission to close this ticket').setDMPermission(false), async execute(interaction:ChatInputCommandInteraction):Promise<void>{ const channel=interaction.channel; if(!channel||channel.type!==ChannelType.GuildText||!decodeMetadata(channel.topic)){ await interaction.reply({ content:'This command can only be used inside a ticket channel.',flags:MessageFlags.Ephemeral }); return; } await interaction.showModal(closeRequestModal()); } };
const unclaimCommand={ data:new SlashCommandBuilder().setName('unclaim').setDescription('Unclaim the current support ticket').setDMPermission(false), async execute(interaction:ChatInputCommandInteraction):Promise<void>{ await interaction.deferReply({ flags:MessageFlags.Ephemeral }); const channel=interaction.channel; if(!channel||channel.type!==ChannelType.GuildText){ await interaction.editReply('This command can only be used inside a ticket channel.'); return; } const metadata=decodeMetadata(channel.topic); if(!metadata){ await interaction.editReply('This is not a managed ticket channel.'); return; } if(!isTicketStaff(interaction)){ await interaction.editReply('Only support staff can unclaim tickets.'); return; } const panelMessage=await findTicketPanelMessage(channel,metadata); if(!panelMessage){ await interaction.editReply('I could not find the ticket panel message, so the claim was not changed.'); return; } const previousClaimant=metadata.claimedBy; delete metadata.claimedBy; metadata.panelMessageId=panelMessage.id; await channel.setTopic(encodeMetadata(metadata),`Ticket unclaimed by ${interaction.user.id}`); try { await panelMessage.edit({ components:restoredClaimComponents(panelMessage) as never,flags:MessageFlags.IsComponentsV2,attachments:Array.from(panelMessage.attachments.values()) }); } catch(error){ if(previousClaimant){ metadata.claimedBy=previousClaimant; await channel.setTopic(encodeMetadata(metadata),'Restoring ticket claim after panel update failure').catch(()=>undefined); } logger.error(`[Tickets] Could not restore the claim button in ${channel.id}: ${error instanceof Error ? error.message : 'Unknown error'}`); await interaction.editReply('I could not restore the Claim Ticket button, so the existing claim was kept.'); return; } await interaction.editReply(previousClaimant ? `✅ Ticket unclaimed. It was previously claimed by <@${previousClaimant}>.` : '✅ The ticket was already unclaimed; the Claim Ticket button has been restored.'); } };

export const ticketCommands=[ticketCommand,ticketPanelCommand,ticketPanelCompatibilityCommand,closeCommand,closeRequestCommand,unclaimCommand];
