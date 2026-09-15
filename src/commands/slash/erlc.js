const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { v2Reply, env, logo } = require('../../utils/v2');
const erlc = require('../../utils/erlcApi');
const { hasPermission } = require('../../utils/security');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('erlc')
        .setDescription('ERLC server commands')
        .addSubcommand(sub => sub.setName('server').setDescription('Get server information'))
        .addSubcommand(sub => sub.setName('players').setDescription('Get online players'))
        .addSubcommand(sub => sub.setName('joinlogs').setDescription('Get join logs'))
        .addSubcommand(sub => sub.setName('killlogs').setDescription('Get kill logs'))
        .addSubcommand(sub => sub.setName('commandlogs').setDescription('Get command logs'))
        .addSubcommand(sub => sub.setName('bans').setDescription('Get server bans'))
        .addSubcommand(sub => sub.setName('vehicles').setDescription('Get server vehicles'))
        .addSubcommand(sub => sub.setName('queue').setDescription('Get server queue'))
        .addSubcommand(sub => sub
            .setName('command')
            .setDescription('Execute an in-game command')
            .addStringOption(opt => opt.setName('cmd').setDescription('Command to execute').setRequired(true))
        ),

    async execute(interaction) {
        if (!hasPermission(interaction.member, 'STAFF_ROLE_ID')) {
            return interaction.reply({ content: env('NO_PERMISSION_MSG', 'You do not have permission to use this command.'), flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();

        try {
            if (sub === 'server') {
                const data = await erlc.getServerInfo();
                let ownerName = data.OwnerId?.toString() || 'N/A';
                try { ownerName = await erlc.getRobloxUsername(data.OwnerId); } catch (_) {}
                return interaction.editReply(v2Reply({
                    title: env('ERLC_SERVER_TITLE', 'Server Information'),
                    fields: [
                        { name: 'Name', value: data.Name || 'N/A' },
                        { name: 'Players', value: `${data.CurrentPlayers || 0}/${data.MaxPlayers || 0}` },
                        { name: 'Join Code', value: data.JoinKey || 'N/A' },
                        { name: 'Owner', value: ownerName }
                    ],
                    thumbnail: logo()
                }));
            }

            if (sub === 'players') {
                const players = await erlc.getPlayers();
                const playerList = players.map(p => {
                    const stars = p.WantedStars > 0 ? ` ⭐${p.WantedStars}` : '';
                    const location = p.Location ? ` \`@${p.PostalCode || p.StreetName}\`` : '';
                    return `\`${p.Player.split(':')[0]}\` -- ${p.Team}${stars}${location}`;
                });
                
                return interaction.editReply(v2Reply({
                    title: env('ERLC_PLAYERS_TITLE', 'Current Players'),
                    description: playerList.length > 0 ? playerList.slice(0, 25).join('\n') : 'No players online'
                }));
            }

            if (sub === 'joinlogs') {
                const data = await erlc.getServerFull({ JoinLogs: true });
                const logs = (data.JoinLogs || []).slice(0, 15).map(l => {
                    const action = l.Join ? env('ERLC_JOIN_LABEL', 'Joined') : env('ERLC_LEAVE_LABEL', 'Left');
                    return `${action} \`${l.Player.split(':')[0]}\` -- <t:${l.Timestamp}:T>`;
                });
                return interaction.editReply(v2Reply({
                    title: env('ERLC_JOINLOGS_TITLE', 'Join Logs'),
                    description: logs.join('\n') || 'No logs'
                }));
            }

            if (sub === 'killlogs') {
                const data = await erlc.getServerFull({ KillLogs: true });
                const logs = (data.KillLogs || []).slice(0, 15).map(l => `\`${l.Killer.split(':')[0]}\` killed \`${l.Killed.split(':')[0]}\` -- <t:${l.Timestamp}:T>`);
                return interaction.editReply(v2Reply({
                    title: env('ERLC_KILLLOGS_TITLE', 'Kill Logs'),
                    description: logs.join('\n') || 'No logs'
                }));
            }

            if (sub === 'commandlogs') {
                const data = await erlc.getServerFull({ CommandLogs: true });
                const logs = (data.CommandLogs || []).slice(0, 15).map(l => `\`${l.Player.split(':')[0]}\`: \`${l.Command}\` -- <t:${l.Timestamp}:X>`);
                return interaction.editReply(v2Reply({
                    title: env('ERLC_CMDLOGS_TITLE', 'Command Logs'),
                    description: logs.join('\n') || 'No logs'
                }));
            }

            if (sub === 'bans') {
                const data = await erlc.getBans();
                const banList = Object.entries(data).slice(0, 20).map(([id, name]) => `**${id}** -- ${name}`);
                return interaction.editReply(v2Reply({
                    title: env('ERLC_BANS_TITLE', 'Server Bans'),
                    description: banList.join('\n') || 'No bans'
                }));
            }

            if (sub === 'vehicles') {
                const data = await erlc.getServerFull({ Vehicles: true });
                const vehicles = (data.Vehicles || []).slice(0, 20).map(v => `\`${v.Plate || '???'}\` ${v.Name} -- Owner: \`${v.Owner}\``);
                return interaction.editReply(v2Reply({
                    title: env('ERLC_VEHICLES_TITLE', 'Server Vehicles'),
                    description: vehicles.join('\n') || 'No vehicles'
                }));
            }

            if (sub === 'queue') {
                const data = await erlc.getServerFull({ Queue: true });
                const queue = (data.Queue || []).slice(0, 20).map((p, i) => `**${i + 1}.** ${p}`);
                return interaction.editReply(v2Reply({
                    title: env('ERLC_QUEUE_TITLE', 'Server Queue'),
                    description: queue.join('\n') || 'No one in queue'
                }));
            }

            if (sub === 'command') {
                if (!hasPermission(interaction.member, 'MANAGEMENT_ROLE_ID')) {
                    return interaction.editReply({ content: env('NO_PERMISSION_MSG', 'You do not have permission to execute in-game commands.') });
                }
                const cmd = interaction.options.getString('cmd');
                const res = await erlc.sendCommand(cmd);
                return interaction.editReply({ content: `**Command Result:** ${res.message || 'Success'}` });
            }
        } catch (error) {
            return interaction.editReply({ content: `ERLC API Error: ${error.message}` });
        }
    }
};
