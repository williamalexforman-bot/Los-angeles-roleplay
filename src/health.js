function healthResponse(path, { discord, database, commands, ...details }) {
  const ready = Boolean(discord && database && commands);
  return {
    statusCode: path.split('?')[0] === '/livez' || ready ? 200 : 503,
    body: { service: 'running', ready, discord: Boolean(discord), database: Boolean(database), commands: Boolean(commands), ...details },
  };
}
module.exports = { healthResponse };
