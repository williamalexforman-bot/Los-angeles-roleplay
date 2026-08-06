// Regenerates assets/underbanner.webp with "LOS ANGELES ROLEPLAY" text.
// The underbanner is a thin, wide bar that sits at the very bottom of each
// session embed. It is rendered as a warm gradient with bold white text.
const sharp = require('sharp');

const WIDTH = 1872;
const HEIGHT = 105;

// Warm orange/sunset gradient matching the session banner style.
function gradientColors(stops) {
    return stops.map(([offset, color]) => {
        const hex = color.replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return { offset, color: { r, g, b } };
    });
}

const svg = Buffer.from(`
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sunset" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="50%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sunset)"/>
  <text x="${WIDTH / 2}" y="${HEIGHT / 2 + 16}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="bold" font-style="italic" fill="#ffffff" text-anchor="middle" letter-spacing="2">LOS ANGELES ROLEPLAY</text>
</svg>
`);

async function build() {
    await sharp(svg)
        .webp({ quality: 95 })
        .toFile('assets/underbanner.webp');
    const meta = await sharp('assets/underbanner.webp').metadata();
    console.log(`Rebuilt assets/underbanner.webp (${meta.width}x${meta.height}) with "LOS ANGELES ROLEPLAY"`);
}

build().then(() => console.log('Done.')).catch((error) => {
    console.error('Failed to rebuild underbanner:', error);
    process.exit(1);
});
