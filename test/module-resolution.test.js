const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

test('all application imports resolve, including delayed startup imports', () => {
  const root = path.resolve(__dirname, '..');
  function check(file) {
    const resolve = createRequire(file).resolve;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      resolve(match[1]);
    }
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.js')) check(file);
    }
  }
  check(path.join(root, 'index.js'));
  walk(path.join(root, 'src'));
});
