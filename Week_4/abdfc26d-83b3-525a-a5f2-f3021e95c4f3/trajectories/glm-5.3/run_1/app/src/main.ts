import { boot } from './server/main.js';

boot().catch((err) => {
  console.error('[phosphene] fatal boot error', err);
  void import('./server/db.js').then(({ pool }) => pool.end());
  setTimeout(() => process.exit(1), 100);
});
