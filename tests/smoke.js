const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '0.1.0');
assert.equal(manifest.action.default_popup, 'src/popup.html');
assert.ok(fs.existsSync(path.join(root, 'src/background.js')));
assert.ok(fs.existsSync(path.join(root, 'src/popup.html')));
assert.ok(fs.existsSync(path.join(root, 'src/popup.css')));
assert.ok(fs.existsSync(path.join(root, 'src/popup.js')));
assert.ok(fs.existsSync(path.join(root, 'design/tokens.css')));
console.log('Cocotivity eLead extension smoke test: passed');
