const sharp = require('sharp');
const fs = require('fs');

// 16:9 HD banner size (per user request): 1920x1080.
const BANNER_WIDTH = 1920;
const BANNER_HEIGHT = 1080;

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

        // Resize the emblem to fill the 1920x1080 (16:9) canvas.
        // Resize to cover width first, then crop any overflow to exactly 16:9.
        await sharp(emblemPath)
            .resize(BANNER_WIDTH, BANNER_HEIGHT, { fit: 'cover', position: 'centre' })
            .png()
            .toFile(`assets/session-${type}-banner.png`);

        console.log(`Generated assets/session-${type}-banner.png (${BANNER_WIDTH}x${BANNER_HEIGHT})`);
    }
}

build().then(() => console.log('Done.')).catch(error => {
    console.error('Failed to build session banners:', error);
    process.exit(1);
});
