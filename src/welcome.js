const { settings } = require('./discipline');
const TEXT = 'Welcome to Clearwater Fire Department!';
async function welcome(member) {
  const config = await settings(member.guild.id);
  const channelId = config.welcome || member.guild.systemChannelId;
  if (!channelId) throw new Error('Set a welcome channel with /config channel destination:welcome.');
  const channel = await member.guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.send) throw new Error('Welcome channel is unavailable.');
  return channel.send({content: `${require("./panel-emojis").icon("welcome","👋",member.guild.id)} ${TEXT}\n<@${member.id}>`, allowedMentions:{parse:[],users:[member.id]}});
}
module.exports = {welcome, TEXT};
