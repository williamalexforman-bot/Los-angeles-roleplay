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
    offline: '<path d="M64 34v31M44 46a27 27 0 0 0 40 37M84 46a27 27 0 0 1-4 38"/><path d="m39 38 50 52" stroke="#FACC15"/>',
    vote: '<path d="M40 41h48v47H40V41Z"/><path d="m49 57 5 5 10-12M69 58h11M49 76l5 5 10-12M69 77h11"/>',
    boost: '<path d="m70 29-29 39h20l-3 31 29-42H67l3-28Z"/>',
    welcome: '<path d="M47 55c-8-7-10-16-4-20 5-3 10 1 13 7 0-9 4-14 9-12 5 1 6 7 5 14 4-6 9-8 13-5 4 4 1 10-3 16l-9 12"/><path d="M47 58c-9 6-11 17-7 27 3 7 10 10 20 10h12c9 0 16-8 16-17V66"/>',
    infraction: '<path d="m64 31 34 61H30l34-61Z"/><path d="M64 52v18M64 81h1"/>',
    promotion: '<path d="M38 88V69h16v19M56 88V52h16v36M74 88V39h16v49M34 94h58"/><path d="m42 54 16-15 12 8 20-22"/>',
};

for (const [name, shape] of Object.entries(icons)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<circle cx="64" cy="64" r="59" fill="#17324A" stroke="#FACC15" stroke-width="5"/>
<circle cx="64" cy="64" r="51" fill="none" stroke="#FFFFFF" stroke-opacity=".28" stroke-width="1.5"/>
<g fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${shape}</g>
</svg>`;
    const svgPath = path.join(output, `${name}.svg`);
    const pngPath = path.join(output, `${name}.png`);
    fs.writeFileSync(svgPath, svg);
    execFileSync('inkscape', [svgPath, '--export-filename', pngPath, '--export-width', '128', '--export-height', '128']);
}

console.log(`Built ${Object.keys(icons).length} transparent CSRP emoji images in ${output}`);
