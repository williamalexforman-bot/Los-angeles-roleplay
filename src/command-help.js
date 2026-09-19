const D = require('discord.js');
const { v2 } = require('./panels');

const PREFIX_COMMANDS = [['-deployment','Post a deployment.'],['-close','Save the transcript and close a ticket.'],['-closerequest <reason>','Ask the opener to close their ticket.'],['-ticketpanel','Post the configured ticket panel.']];

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
