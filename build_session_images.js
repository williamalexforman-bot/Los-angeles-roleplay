const sharp = require('sharp');
const fs = require('fs');

// LARGE embeds: make the banner wider (max Discord embed width) and taller so it displays large.
const EMBLEM_WIDTH = 4096;

const BASE_EMBLEMS = {
    start: 'assets/session-start.png',
    end: 'assets/session-end.png',
    full: 'assets/session-full.png',
    boost: 'assets/session-boost.png',
    vote: 'assets/session-start.png',
};

async function build() {
    for (const type of Object.keys(BASE_EMBLEMS)) {
        const emblemPath = BASE_EMBLEMS[type];
        if (!fs.existsSync(emblemPath)) {
            console.log('MISSING emblem', emblemPath);
            continue;
        }

        const emblemMeta = await sharp(emblemPath).metadata();

        // Scale the emblem up to the target width (keeps aspect ratio).
        const emblemScaledHeight = Math.round((emblemMeta.height / emblemMeta.width) * EMBLEM_WIDTH);

        // Resize the top banner to the target width. The underbanner is NOT
        // merged here anymore - it is sent as its own separate embed at the
        // very bottom so it never appears twice.
        await sharp(emblemPath)
            .resize(EMBLEM_WIDTH, emblemScaledHeight)
            .png()
            .toFile(`assets/session-${type}-banner.png`);

        console.log(`Generated assets/session-${type}-banner.png (${EMBLEM_WIDTH}x${emblemScaledHeight})`);
    }
}

build().then(() => console.log('Done.')).catch(error => {
    console.error('Failed to build session banners:', error);
    process.exit(1);
});
