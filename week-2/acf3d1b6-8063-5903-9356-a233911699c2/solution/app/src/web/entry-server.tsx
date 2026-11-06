import { renderToString } from 'preact-render-to-string';
import { App, resolvePage } from './app.js';
import type { PageData } from './data.js';

export { resolvePage };

/** Renders an address to HTML on the server; the browser hydrates the same markup. */
export function render(url: string, data: PageData): string {
  const { pathname, search } = new URL(url, 'http://kinora.local');
  // preact-iso reads the address from `location`; on the server it is this request's.
  (globalThis as { location?: unknown }).location = { origin: 'http://kinora.local', pathname, search };
  return renderToString(<App url={pathname + search} data={data} />);
}
