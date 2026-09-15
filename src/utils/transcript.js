async function createTranscript(channel) {
    const messages = [];
    let lastId;

    // Fetch all messages in the channel
    while (true) {
        const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
        if (batch.size === 0) break;
        batch.forEach(m => messages.push(m));
        lastId = batch.last().id;
    }

    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lines = [
        `=== Transcript: #${channel.name} ===`,
        `Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`,
        ''
    ];

    for (const msg of messages) {
        const time = new Date(msg.createdTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
        const date = new Date(msg.createdTimestamp).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
        const author = `${msg.author.displayName || msg.author.username} (${msg.author.tag})`;
        let content = msg.content || '';

        if (msg.embeds.length > 0) {
            for (const embed of msg.embeds) {
                if (embed.title) content += `\n  [Embed] ${embed.title}`;
                if (embed.description) content += `\n  ${embed.description}`;
            }
        }
        if (msg.attachments.size > 0) {
            content += msg.attachments.map(a => `\n  [Attachment: ${a.name}]`).join('');
        }

        lines.push(`[${date} ${time}] ${author}`);
        lines.push(`  ${content || '(no content)'}`);
        lines.push('');
    }

    lines.push('=== End of Transcript ===');

    const buffer = Buffer.from(lines.join('\n'), 'utf-8');
    const { AttachmentBuilder } = require('discord.js');
    return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
}

module.exports = { createTranscript };
