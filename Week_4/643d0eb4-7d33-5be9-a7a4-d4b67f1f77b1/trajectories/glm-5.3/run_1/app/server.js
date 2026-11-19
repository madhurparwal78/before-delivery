// Keystone Tables — a governed reporting workspace.
// The server: applies the schema, seeds deterministically, serves the pages and the /api prefix
// from one origin on the port named by APP_PUBLIC_PORT.
require('express');
const { initStore } = require('./src/store');
const { buildApp } = require('./src/app');

const PORT = Number(process.env.APP_PUBLIC_PORT || 4173);

initStore()
  .then(() => {
    const app = buildApp();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Keystone Tables listening on 0.0.0.0:${PORT} (APP_PUBLIC_URL=${process.env.APP_PUBLIC_URL || ''})`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
