import { startNotFound, startRouter } from './router.js';

type Boot = { not_found: boolean; signed_in: boolean };

function boot(): Boot {
  const holder = document.getElementById('boot');
  const fallback: Boot = { not_found: false, signed_in: false };
  if (!holder?.textContent) return fallback;
  try {
    return JSON.parse(holder.textContent) as Boot;
  } catch {
    return fallback;
  }
}

const loaded = boot();
if (loaded.not_found) startNotFound();
void startRouter(loaded.signed_in);
