'use strict';

// Build: copy the vendored htmx file from node_modules to public/vendor so the
// pages load it from this origin only.
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'node_modules', 'htmx.org', 'dist', 'htmx.min.js');
const targetDir = path.join(__dirname, '..', 'public', 'vendor');
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, path.join(targetDir, 'htmx.min.js'));
console.log('vendored htmx.min.js');
