const D = require('discord.js');
const { v2 } = require('./panels');

const PREFIX_COMMANDS = [
  ['-say <message>', 'Send the supplied text as the bot.'],
  ['-deployment', 'Post the deployment announcement and ping the deployment role.'],
  ['-close', 'Save the transcript and close the current ticket.'],
  ['-closerequest <reason>', 'Ask the ticket opener to approve closing their ticket.'],
  ['-purge <amount>', 'Delete 1–100 recent messages; messages older than 14 days are skipped.'],
  ['-ticketpanel', 'Post a ticket launcher in the current channel.'],
  ['-applicationpanel', 'Post the Valenti application launcher in the current channel.'],
  ['-verificationpanel', 'Post or reuse the Roblox verification panel in <#1538390763476357130>.'],
  ['-spamcool <message> <amount>', 'Run the restricted DM test for the two authorized accounts (1–50 messages, ten-minute cooldown).'],
  ['-spamcool stop', 'Cancel the restricted DM test.'],
];

function slashEntries(commands) {
  const entries = [];
  function walk(command, path) {
    const subcommands = (command.options || []).filter(o => [D.ApplicationCommandOptionType.Subcommand, D.ApplicationCommandOptionType.SubcommandGroup].includes(o.type));
    if (subcommands.length) {
      for (const sub of subcommands) walk(sub, `${path} ${sub.name}`);
      return;
    }
    const args = (command.options || []).map(o => o.required ? `${o.name}:<value>` : `[${o.name}:value]`).join(' ');
    let description = command.description;
    if (path === '/config shift-role') description = 'Save the legacy shift-role setting; shifts currently remain available to all members.';
    entries.push(`\`${path}${args ? ' ' + args : ''}\` — ${description}`);
  }
  for (const builder of commands) { const command = builder.toJSON(); walk(command, `/${command.name}`); }
  return entries;
}

function pages(commands = require('./commands/config').commands) {
  const lines = [
    'All available commands are listed below. Staff, manager, administrator and ticket-access restrictions still apply. `<value>` is required; `[option:value]` is optional.',
    '**Slash commands**', ...slashEntries(commands),
    '**Prefix commands**', ...PREFIX_COMMANDS.map(([usage, description]) => `\`${usage}\` — ${description}`),
    '**Verification:** Members press Verify on the panel to enter a Roblox username and sync their server nickname.',
  ];
  const result = []; let body = '';
  for (const line of lines) {
    if (body && body.length + line.length + 2 > 3300) { result.push(body); body = ''; }
    body += (body ? '\n\n' : '') + line;
  }
  if (body) result.push(body);
  return result.map((text, index) => v2(`Command List (${index + 1}/${result.length})`, text, [], true));
}

async function handle(i) {
  const messages = pages();
  await i.reply(messages[0]);
  for (const message of messages.slice(1)) await i.followUp(message);
}
module.exports = { PREFIX_COMMANDS, slashEntries, pages, handle };
