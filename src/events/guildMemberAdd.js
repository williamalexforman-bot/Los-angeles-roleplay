const { v2Msg, env, tpl, logo, banner } = require('../utils/v2');

module.exports = {
    name: 'guildMemberAdd',
    once: false,
    async execute(member) {
        const channelId = process.env.WELCOME_CHANNEL_ID;
        if (!channelId) return;

        const channel = member.guild.channels.cache.get(channelId);
        if (!channel) return;

        const count = member.guild.memberCount;
        const title = env('WELCOME_TITLE', 'Welcome!');
        const desc = tpl(env('WELCOME_DESCRIPTION', 'Welcome to **{server}**, {user}!\n\n**Member Count:** {count}'), {
            user: `${member}`,
            server: member.guild.name,
            count: `${count}`
        });

        channel.send(v2Msg({
            title,
            description: desc,
            thumbnail: logo(),
            banner: banner('WELCOME_BANNER')
        }));
    }
};
