const { v2Msg, env, tpl, logo, banner } = require('../utils/v2');

module.exports = {
    name: 'guildMemberRemove',
    once: false,
    async execute(member) {
        const channelId = process.env.LEAVING_CHANNEL_ID;
        if (!channelId) return;

        const channel = member.guild.channels.cache.get(channelId);
        if (!channel) return;

        const count = member.guild.memberCount;
        const title = env('LEAVING_TITLE', 'Goodbye!');
        const desc = tpl(env('LEAVING_DESCRIPTION', '**{user}** has left **{server}**.\n\n**Member Count:** {count}'), {
            user: member.user.tag,
            server: member.guild.name,
            count: `${count}`
        });

        channel.send(v2Msg({
            title,
            description: desc,
            thumbnail: logo(),
            banner: banner('LEAVING_BANNER')
        }));
    }
};
