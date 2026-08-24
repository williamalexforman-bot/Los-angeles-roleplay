const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src');
const extensions = new Set(['.ts', '.js']);
const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name))) inspect(full);
  }
}

function inspect(file) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    // Direct non-empty Discord embed payloads are forbidden for bot emblems.
    // `embeds: []` is allowed because it is used only to clear legacy embeds
    // while migrating an existing message to Components V2.
    if (/\bembeds\s*:\s*\[(?!\s*\])/.test(line)) {
      violations.push(`${path.relative(process.cwd(), file)}:${index + 1} -> ${line.trim()}`);
    }
  });
}

walk(ROOT);

if (violations.length) {
  console.error('\n[V2 Emblem Check] Legacy embed payloads detected. All user-facing emblems must use Discord Components V2.');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log('[V2 Emblem Check] Passed: no non-empty legacy embeds payloads found in src/.');
