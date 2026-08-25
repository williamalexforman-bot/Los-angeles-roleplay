const path = require('node:path');
const sharp = require('sharp');

const ASSETS_ROOT = path.resolve(__dirname, '..', 'assets');

const TOP_BANNERS = [
  'los-angeles-banner.png',
  'promotion-banner.png',
  'partnership-banner.png',
  'assistance-banner.png',
  'suggestion-banner.png',
  'dashboard-banner.png',
  'rules-banner.png',
  'applications-banner.png',
  'training-results-banner.png',
  'training-request-banner.png',
  'paid-ad-banner.png',
  'staff-feedback-banner.png',
  'session-start-banner.png',
  'session-end-banner.png',
  'session-vote-banner.png',
  'session-boost-banner.png',
  'giveaway-banner.png',
  'loa-banner.png',
];

async function assertImage(filename, expectedWidth, expectedHeight) {
  const metadata = await sharp(path.join(ASSETS_ROOT, filename)).metadata();
  if (metadata.format !== 'png'
    || metadata.width !== expectedWidth
    || metadata.height !== expectedHeight) {
    throw new Error(
      `${filename} must be the original ${expectedWidth}x${expectedHeight} PNG; `
      + `found ${metadata.width || '?'}x${metadata.height || '?'} ${metadata.format || 'unknown'}.`,
    );
  }
}

async function main() {
  await Promise.all(TOP_BANNERS.map(filename => assertImage(filename, 1600, 479)));
  await assertImage('underbanner.png', 1118, 40);
  await assertImage('larp-logo.png', 420, 420);
  console.log(`[Banner Quality] Passed: ${TOP_BANNERS.length} original 1600x479 banners, the 1118x40 underbanner, and the required logo are intact.`);
}

main().catch(error => {
  console.error(`[Banner Quality] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
