const { v2Reply, env, tpl } = require('../../utils/v2');

module.exports = {
    name: 'ping',
    aliases: [],
    async execute(message, args, client) {
        const sent = await message.reply('Pinging...');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        const api = Math.round(client.ws.ping);
        const payload = v2Reply({
            title: env('PING_TITLE', 'Pong!'),
            description: tpl(env('PING_RESPONSE', 'Latency: {latency}ms | API: {api}ms'), { latency: `${latency}`, api: `${api}` })
        });
        payload.content = '';
        sent.edit(payload);
    }
};
