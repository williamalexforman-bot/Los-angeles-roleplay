const sharp = require('sharp');
const fs = require('fs');

// Target width for the upscaled emblem. The original emblems are 1600x400
// (4:1 wide). We upscale them larger while PRESERVING the original 4:1 aspect
// ratio (fit: inside / no cropping) so the full emblem stays intact and big.
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

        const meta = await sharp(emblemPath).metadata();
        const scaledHeight = Math.round((meta.height / meta.width) * EMBLEM_WIDTH);

        // Upscale the emblem to the target width, preserving the wide aspect
        // ratio. No 16:9 cropping — the full emblem is kept and rendered big.
        await sharp(emblemPath)
            .resize(EMBLEM_WIDTH, scaledHeight, { fit: 'inside', withoutEnlargement: false })
            .png()
            .toFile(`assets/session-${type}-banner.png`);

        console.log(`Generated assets/session-${type}-banner.png (${EMBLEM_WIDTH}x${scaledHeight})`);
    }
}

build().then(() => console.log('Done.')).catch(error => {
    console.error('Failed to build session banners:', error);
    process.exit(1);
});
