// Validates the supplied underbanner artwork without overwriting it.
const sharp = require('sharp');
const fs = require('fs');

const UNDERBANNER = 'assets/underbanner.png';

async function build() {
    if (!fs.existsSync(UNDERBANNER)) throw new Error(`Missing supplied artwork: ${UNDERBANNER}`);
    const meta = await sharp(UNDERBANNER).metadata();
    if (meta.format !== 'png' || !meta.width || !meta.height) {
        throw new Error(`${UNDERBANNER} is not a valid PNG image.`);
    }
    console.log(`Verified ${UNDERBANNER} (${meta.width}x${meta.height})`);
}

build().then(() => console.log('Done.')).catch((error) => {
    console.error('Failed to validate underbanner:', error);
    process.exit(1);
});
