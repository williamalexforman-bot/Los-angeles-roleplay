// Builds a SINGLE combined banner image per session type.
// Layout (top to bottom):
//   [ TOP BANNER stripe  ]  -> the wide header emblem (4:1)
//   [ sunset gap          ]  -> warm orange gradient spacing
//   [ UNDERBANNER stripe  ]  -> thin "LOS ANGELES ROLEPLAY" bar
//
// The result is ONE image that sits INSIDE the main embed (setImage), so the
// top banner is at the top and the underbanner is at the bottom of the same
// emblem, filling more of Discord's embed-height cap so it looks big.
const sharp = require('sharp');
const fs = require('fs');

const WIDTH = 1600;              // output width (Discord scales to ~550px wide)
const TOP_HEIGHT = 400;          // top banner stripe height (4:1)
const GAP_HEIGHT = 60;           // warm gradient gap between top + underbanner
const UNDER_HEIGHT = 90;         // underbanner stripe height
const TOTAL_HEIGHT = TOP_HEIGHT + GAP_HEIGHT + UNDER_HEIGHT; // 550

const TOP_BANNERS = {
    start: 'assets/session-start-banner.png',
    end: 'assets/session-end-banner.png',
    full: 'assets/session-full-banner.png',
    boost: 'assets/session-boost-banner.png',
    vote: 'assets/session-vote-banner.png',
};

const UNDERBANNER = 'assets/underbanner.webp';

// Warm orange/sunset gradient matching the underbanner style.
const gradientSvg = (w, h) => Buffer.from(`
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sunset" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="50%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sunset)"/>
</svg>
`);

async function build() {
    if (!fs.existsSync(UNDERBANNER)) {
        console.error('Missing underbanner:', UNDERBANNER);
        process.exit(1);
    }

    for (const type of Object.keys(TOP_BANNERS)) {
        const topPath = TOP_BANNERS[type];
        if (!fs.existsSync(topPath)) {
            console.log('MISSING top banner', topPath);
            continue;
        }

        // Resize top banner to exact stripe width/height (fit cover, no crop).
        const top = await sharp(topPath)
            .resize(WIDTH, TOP_HEIGHT, { fit: 'cover', position: 'centre' })
            .png()
            .toBuffer();

        // Resize underbanner to exact width.
        const under = await sharp(UNDERBANNER)
            .resize(WIDTH, UNDER_HEIGHT, { fit: 'cover', position: 'centre' })
            .png()
            .toBuffer();

        const gap = await sharp(gradientSvg(WIDTH, GAP_HEIGHT)).png().toBuffer();

        const combined = await sharp({
            create: {
                width: WIDTH,
                height: TOTAL_HEIGHT,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 },
            },
        })
            .composite([
                { input: top, top: 0, left: 0 },
                { input: gap, top: TOP_HEIGHT, left: 0 },
                { input: under, top: TOP_HEIGHT + GAP_HEIGHT, left: 0 },
            ])
            .png()
            .toFile(`assets/session-${type}-combo.png`);

        const meta = await sharp(`assets/session-${type}-combo.png`).metadata();
        console.log(`Generated assets/session-${type}-combo.png (${meta.width}x${meta.height})`);
    }

    console.log('Done.');
}

build().catch(error => {
    console.error('Failed to build combined banners:', error);
    process.exit(1);
});
