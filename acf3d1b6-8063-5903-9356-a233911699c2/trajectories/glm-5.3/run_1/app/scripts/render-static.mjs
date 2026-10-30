// Build-time check: render every public page with the SSR bundle and fail the
// build if any of them throws. Pages are filled in live by the server; this
// only proves the bundle renders.
import { renderPage } from '../src/server/pages.mjs';
import { PUBLIC_ROUTES } from '../src/content.mjs';

let failed = 0;
for (const route of PUBLIC_ROUTES) {
  try {
    const html = await renderPage(route.path);
    if (html.length < 400) throw new Error(`too short (${html.length} bytes)`);
    console.log(`[render] ${route.path} ok (${html.length} bytes)`);
  } catch (e) {
    failed += 1;
    console.log(`[render] ${route.path} FAILED: ${e.message}`);
  }
}
if (failed) {
  console.log(`[render] ${failed} route(s) failed`);
  process.exit(1);
}
console.log('[render] all public routes render');
