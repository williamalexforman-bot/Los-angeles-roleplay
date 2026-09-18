// This pack contains only static PNG emojis; animated slots cannot hold them.
function staticLimit(guild) {
  const tierLimit = [50, 100, 150, 250][Number(guild.premiumTier)] || 50;
  return Math.max(tierLimit, guild.features?.includes('MORE_EMOJI') ? 200 : 0);
}
function staticUsed(emojis) {
  return [...emojis.values()].filter(e => !e.animated && !e.managed).length;
}
module.exports = { staticLimit, staticUsed };
