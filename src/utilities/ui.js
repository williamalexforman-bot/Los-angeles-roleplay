const { EmbedBuilder, MessageFlags } = require('discord.js');

const COLORS = { primary: 0x247bf1, success: 0x2ecc71, warning: 0xf1c40f, error: 0xe74c3c };

function embed(title, description, color = COLORS.primary) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description || ' ').setTimestamp();
}

function privateReply(title, description, color) {
  return { embeds: [embed(title, description, color)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function clean(text, max = 1000) {
  return String(text ?? '').replace(/@everyone|@here/gi, '[mention removed]').trim().slice(0, max);
}

function shortId(prefix) {
  return `${prefix}-${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
}

module.exports = { COLORS, embed, privateReply, clean, shortId };
