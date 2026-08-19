// Compatibility bootstrap for hosts that still use the legacy Render start command:
//   node dist/index.js
// The canonical runtime remains the root index.js, which registers ts-node in
// transpileOnly mode and loads src/index.ts directly.
require('../index.js');
