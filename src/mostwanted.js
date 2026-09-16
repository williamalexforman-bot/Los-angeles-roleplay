const D = require('discord.js');
const { requireAccess } = require('./access');
const { v2 } = require('./panels');
const CHANNEL_ID = '1549901960142913616';

function discordId(value) {
  const input = value.trim();
  const id = /^(?:<@!?)?([1-9]\d{16,19})(?:>)?$/.exec(input)?.[1];
  if (!id || ![id, `<@${id}>`, `<@!${id}>`].includes(input)) {
    throw new Error('Enter their numeric Discord user ID or a mention. They do not need to be in this server.');
  }
  return id;
}

async function robloxAccount(username, request = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  username = username.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Enter a Roblox username, not a display name or profile URL.');
  async function json(url, options = {}) {
    let response;
    try { response = await request(url, { ...options, signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error('Roblox lookup timed out or could not connect. Try again shortly.'); }
    if (response.status === 429) throw new Error('Roblox is rate limiting lookups. Try again shortly.');
    if (!response.ok) throw new Error('Roblox lookup is unavailable. Try again shortly.');
    try { return await response.json(); }
    catch { throw new Error('Roblox returned an unreadable response. Try again shortly.'); }
  }
  const result = await json('https://users.roblox.com/v1/usernames/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  const account = result.data?.[0];
  if (!account) throw new Error('No Roblox account was found with that username. Check the spelling.');
  if (!Number.isSafeInteger(account.id) || account.id <= 0 || typeof account.name !== 'string') throw new Error('Roblox returned an invalid account. Try again shortly.');
  const url = `https://thumbnails.roblox.com/v1/users/avatar?userIds=${account.id}&size=420x420&format=Png&isCircular=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const thumbnails = await json(url);
    const avatar = thumbnails.data?.find(item => item.targetId === account.id);
    if (avatar?.state === 'Completed' && typeof avatar.imageUrl === 'string') {
      let image;
      try { image = new URL(avatar.imageUrl); } catch {}
      if (image?.protocol === 'https:' && image.hostname.endsWith('.rbxcdn.com')) {
        return { id: account.id, name: account.name, displayName: account.displayName || account.name, avatar: image.href };
      }
    }
    if (avatar?.state !== 'Pending' || attempt === 2) break;
    await pause(1000);
  }
  throw new Error('Roblox has not made this avatar available. No notice was posted; try again later.');
}

function notice(account, target, reason, actor) {
  const box = new D.ContainerBuilder().setAccentColor(0xb02028)
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent('## MOST WANTED'))
    .addSeparatorComponents(new D.SeparatorBuilder())
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(
      `**Roblox:** [${D.escapeMarkdown(account.name)}](https://www.roblox.com/users/${account.id}/profile)\n` +
      `**Display name:** ${D.escapeMarkdown(account.displayName)}\n**Roblox ID:** ${account.id}\n` +
      `**Discord:** <@${target}> — \`${target}\`\n\n**Reason:**\n${D.escapeMarkdown(reason)}`))
    .addMediaGalleryComponents(new D.MediaGalleryBuilder().addItems(
      new D.MediaGalleryItemBuilder().setURL(account.avatar).setDescription(`${account.name}'s Roblox avatar`)))
    .addTextDisplayComponents(new D.TextDisplayBuilder().setContent(`-# Posted by <@${actor}> • <t:${Math.floor(Date.now() / 1000)}:f>`));
  return { components: [box], flags: D.MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function execute(i, request = fetch, pause) {
  await i.deferReply({ flags: D.MessageFlags.Ephemeral });
  await requireAccess(i, 'mostwanted');
  const target = discordId(i.options.getString('discord', true));
  const reason = i.options.getString('reason', true).trim();
  if (!reason || reason.length > 1000) throw new Error('Enter a reason between 1 and 1,000 characters.');
  const channel = await i.guild.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel || ![D.ChannelType.GuildText, D.ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('The most-wanted channel is unavailable in this server.');
  const me = await i.guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([D.PermissionFlagsBits.ViewChannel, D.PermissionFlagsBits.SendMessages, D.PermissionFlagsBits.EmbedLinks])) {
    throw new Error('The bot needs View Channel, Send Messages and Embed Links in the most-wanted channel.');
  }
  const account = await robloxAccount(i.options.getString('roblox', true), request, pause);
  const message = await channel.send({ ...notice(account, target, reason, i.user.id), nonce: i.id, enforceNonce: true });
  await i.editReply(v2('Most Wanted Posted', `[View the notice](${message.url}) in <#${CHANNEL_ID}>.`, [], true));
}

module.exports = { CHANNEL_ID, discordId, robloxAccount, notice, execute };
