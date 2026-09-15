const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

const color = () => parseInt(process.env.EMBED_COLOR || '2F3136', 16);
const footer = () => process.env.BOT_NAME || 'Cortex ERLC Bot';
const logo = () => process.env.BOT_LOGO || null;
const banner = (key) => (key && process.env[key]) ? process.env[key] : (process.env.BANNER_IMAGE || null);

function env(key, fallback) {
    return (process.env[key] || fallback || '').replace(/\\n/g, '\n');
}

function tpl(str, vars) {
    let out = str;
    for (const [k, v] of Object.entries(vars)) {
        out = out.split(`{${k}}`).join(v);
    }
    return out;
}

function buildContainer(opts) {
    const container = new ContainerBuilder().setAccentColor(color());

    // Banner image at top if provided
    const bannerUrl = opts.banner !== undefined ? opts.banner : null;
    if (bannerUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(bannerUrl)
            )
        );
    }

    // Build main content as a single text block to avoid blank space
    let body = `**${opts.title}**`;
    if (opts.description) body += `\n${opts.description}`;

    if (opts.fields && opts.fields.length > 0) {
        const fieldLines = opts.fields.map(f => `> **${f.name}:** ${f.value}`).join('\n');
        body += `\n\n${fieldLines}`;
    }

    if (opts.thumbnail) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.thumbnail))
        );
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer()} • <t:${Math.floor(Date.now() / 1000)}:f>`));

    return container;
}

function v2Reply(opts) {
    return {
        components: [buildContainer(opts)],
        flags: MessageFlags.IsComponentsV2
    };
}

function v2Msg(opts) {
    return {
        components: [buildContainer(opts)],
        flags: MessageFlags.IsComponentsV2
    };
}

module.exports = { buildContainer, v2Reply, v2Msg, env, tpl, color, footer, logo, banner };
