const sharp = require('sharp');
const fs = require('fs');

async function build() {
  const types = ['start', 'end', 'full', 'boost'];
  for (const t of types) {
    const emblemFile = `assets/session-${t}.png`;
    if (!fs.existsSync(emblemFile)) { console.log('MISSING', emblemFile); continue; }
    const bif = await sharp('assets/underbanner.webp').metadata();
    const eif = await sharp(emblemFile).metadata();
    console.log(t, 'emblem', eif.width, eif.height, 'under', bif.width, bif.height);
  }
}
build();
