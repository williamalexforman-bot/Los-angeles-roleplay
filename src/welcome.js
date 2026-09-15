const { settings } = require('./discipline');
const { v2 } = require('./panels');
const TEXT = '<:welcome:1549441219774382080> Welcome to Valenti Crime Family the best mafia ever!';
async function welcome(member) {
  const config = await settings(member.guild.id);
  const channelId = config.welcome || member.guild.systemChannelId;
  if (!channelId) throw new Error('Set a welcome channel with /config channel destination:welcome.');
  const channel = await member.guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.send) throw new Error('Welcome channel is unavailable.');
  return channel.send({...v2(TEXT, `<@${member.id}>`), allowedMentions:{parse:[],users:[member.id]}});
}
module.exports = {welcome, TEXT};
