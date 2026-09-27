const { PermissionFlagsBits } = require('discord.js');
const { settings } = require('../database');

async function freshMember(interaction) {
  if (interaction.member?.roles?.cache && interaction.member?.permissions) return interaction.member;
  let timer;
  try {
    return await Promise.race([
      interaction.guild.members.fetch(interaction.user.id),
      new Promise((_, reject) => { timer=setTimeout(() => reject(new Error('Member permission check timed out. Please try again.')), 2000);timer.unref(); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function hasConfiguredRole(interaction, keys) {
  const member = await freshMember(interaction);
  const cfg = settings(interaction.client.db, interaction.guildId);
  return keys.some(key => cfg[key] && member.roles.cache.has(cfg[key]));
}

async function requireStaff(interaction, keys = ['staff_role', 'admin_role']) {
  const member = await freshMember(interaction);
  if (interaction.user.id === interaction.client.appConfig.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) return member;
  const cfg = settings(interaction.client.db, interaction.guildId);
  if (keys.some(key => cfg[key] && member.roles.cache.has(cfg[key]))) return member;
  throw new Error('You do not have permission to use this action.');
}

async function requireOwner(interaction) {
  if (interaction.user.id === interaction.client.appConfig.ownerId) return freshMember(interaction);
  const member = await freshMember(interaction);
  const cfg = settings(interaction.client.db, interaction.guildId);
  if (cfg.admin_role && member.roles.cache.has(cfg.admin_role)) return member;
  throw new Error('Only the bot owner or configured administrator role can use this dashboard.');
}

function requireBotPermission(interaction, permission, label) {
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(permission)) throw new Error(`The bot needs the ${label} permission to do that.`);
}

module.exports = { freshMember, hasConfiguredRole, requireStaff, requireOwner, requireBotPermission };
