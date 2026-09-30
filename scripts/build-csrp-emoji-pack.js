const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const output = path.resolve(__dirname, '../assets/emojis');
fs.mkdirSync(output, { recursive: true });

const icons = {
    assistance: '<path d="M64 34v60M34 64h60"/>',
    ticket: '<path d="M38 34h52v15a12 12 0 0 0 0 30v15H38V79a12 12 0 0 0 0-30V34Z"/><path d="M54 49h20M54 64h20M54 79h12"/>',
    claim: '<path d="m64 31 9 20 22 2-17 15 5 22-19-12-19 12 5-22-17-15 22-2 9-20Z"/>',
    close: '<path d="m42 42 44 44M86 42 42 86"/>',
    escalate: '<path d="M64 93V38M42 60l22-22 22 22"/>',
    general: '<path d="M49 49a16 16 0 1 1 25 13c-8 6-10 9-10 16"/><circle cx="64" cy="91" r="2" fill="#fff"/>',
    management: '<path d="M64 31 91 42v22c0 17-11 29-27 37-16-8-27-20-27-37V42l27-11Z"/><path d="m64 47 5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1 5-11Z"/>',
    highrank: '<path d="m35 82 7-39 21 20 21-20 9 39H35Z"/><path d="M39 91h50M42 43h1M64 39h1M85 43h1"/>',
    dashboard: '<path d="M35 83a31 31 0 1 1 58 0"/><path d="m64 69 17-17M42 84h44"/><circle cx="64" cy="69" r="4" fill="#fff"/>',
    rules: '<path d="M41 31h35l13 13v53H41V31Z"/><path d="M76 32v14h13M51 59h28M51 71h28M51 83h20"/>',
    discord: '<path d="M35 39h58v42H61L45 94v-13h-10V39Z"/><path d="M49 57h1M64 57h1M79 57h1"/>',
    game: '<circle cx="64" cy="64" r="28"/><circle cx="64" cy="64" r="10"/><path d="M64 36v18M40 78l16-9M88 78l-16-9"/>',
    application: '<path d="M43 38h42v57H43V38Z"/><path d="M54 38v-7h20v7M53 55h22M53 68h22M53 81h14"/>',
    apply: '<path d="M39 37h39l12 12v42H39V37Z"/><path d="M78 38v13h12M51 70l8 8 18-20"/>',
    session: '<circle cx="64" cy="64" r="31"/><path d="M64 44v21l15 9M53 30h22"/>',
    staff: '<circle cx="64" cy="49" r="13"/><path d="M39 94c2-17 11-26 25-26s23 9 25 26"/><path d="m82 80 5 5 10-12"/>',
    players: '<circle cx="51" cy="51" r="10"/><circle cx="77" cy="51" r="10"/><path d="M31 88c2-15 8-23 20-23s18 8 20 23M57 88c2-15 8-23 20-23s18 8 20 23"/>',
    queue: '<circle cx="40" cy="46" r="3" fill="#fff"/><circle cx="40" cy="64" r="3" fill="#fff"/><circle cx="40" cy="82" r="3" fill="#fff"/><path d="M52 46h37M52 64h37M52 82h37"/>',
    online: '<path d="M64 33v33M45 45a27 27 0 1 0 38 0"/>',
    offline: '<path d="M64 34v31M44 46a27 27 0 0 0 40 37M84 46a27 27 0 0 1-4 38"/><path d="m39 38 50 52"/>',
    vote: '<path d="M40 41h48v47H40V41Z"/><path d="m49 57 5 5 10-12M69 58h11M49 76l5 5 10-12M69 77h11"/>',
    boost: '<path d="m70 29-29 39h20l-3 31 29-42H67l3-28Z"/>',
    welcome: '<path d="M47 55c-8-7-10-16-4-20 5-3 10 1 13 7 0-9 4-14 9-12 5 1 6 7 5 14 4-6 9-8 13-5 4 4 1 10-3 16l-9 12"/><path d="M47 58c-9 6-11 17-7 27 3 7 10 10 20 10h12c9 0 16-8 16-17V66"/>',
    infraction: '<path d="m64 31 34 61H30l34-61Z"/><path d="M64 52v18M64 81h1"/>',
    promotion: '<path d="M38 88V69h16v19M56 88V52h16v36M74 88V39h16v49M34 94h58"/><path d="m42 54 16-15 12 8 20-22"/>',
    warning: '<path d="m64 24 39 72H25l39-72Z"/><path d="M64 48v23M64 83h1"/>',
    strike: '<path d="m70 24-38 47h25l-5 34 44-53H68l2-28Z"/>',
    suspension: '<path d="M42 34v60M86 34v60"/><path d="M31 64h66"/>',
    demotion: '<path d="M40 37v53h48M63 69l25 23 25-23" transform="translate(-12 -3)"/>',
    termination: '<path d="M42 29h45v70H42V29Z"/><path d="M63 64h37M87 50l14 14-14 14"/>',
    blacklist: '<circle cx="64" cy="47" r="14"/><path d="M35 96c2-19 12-29 29-29s27 10 29 29M42 39l44 48M86 39 42 87"/>',
    appeal: '<path d="M38 47V28L18 48l20 20V49c33-6 56 11 56 39"/><path d="M48 91h44"/>',
    approved: '<path d="m33 66 20 20 43-48"/>',
    denied: '<path d="m41 41 46 46M87 41 41 87"/>',
    training: '<path d="m20 48 44-22 44 22-44 22-44-22Z"/><path d="M39 59v20c15 12 35 12 50 0V59M108 49v28"/>',
    dispatch: '<path d="M41 27h46v74H41V27Z"/><path d="M53 44h22M53 57h22M53 70h13M53 83h22M35 36h6M87 36h6"/>',
    vehicle: '<path d="M27 72h74v20H27V72ZM36 72l9-26h37l10 26M45 85h1M82 85h1"/><path d="M51 56h25"/>',
    guide: '<path d="M64 40c-13-10-27-11-40-5v55c14-6 27-5 40 5 13-10 26-11 40-5V35c-13-6-27-5-40 5Z"/><path d="M64 40v55M39 51c7-2 13-1 18 2M39 66c7-2 13-1 18 2M72 53c6-3 12-4 18-2M72 68c6-3 12-4 18-2"/>',
};

for (const [name, shape] of Object.entries(icons)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<g fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${shape}</g>
</svg>`;
    const svgPath = path.join(output, `${name}.svg`);
    const pngPath = path.join(output, `${name}.png`);
    fs.writeFileSync(svgPath, svg);
    execFileSync('inkscape', [svgPath, '--export-filename', pngPath, '--export-width', '128', '--export-height', '128']);
}

console.log(`Built ${Object.keys(icons).length} transparent CSRP emoji images in ${output}`);
