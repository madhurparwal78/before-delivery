import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from 'react-router';
import { DeskProvider } from '../app/deskData.jsx';
import { AnswerPage } from '../app/root.jsx';
import { routes } from '../app/routes.jsx';
import { ui } from '../shared/copy.js';

const here = dirname(fileURLToPath(import.meta.url));
export const CLIENT_ROOT = join(here, 'client');

const manifest = JSON.parse(readFileSync(join(CLIENT_ROOT, '.vite', 'manifest.json'), 'utf8'));
const entry = manifest['src/app/entry.client.jsx'];
const scriptHref = `/${entry.file}`;

// The styles travel in the document, so a route's heading is readable after one request.
const styles = (entry.css ?? []).map((file) => readFileSync(join(CLIENT_ROOT, file), 'utf8')).join('\n');

const handler = createStaticHandler(routes);

function serialise(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function document({ body, title, hydration }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${styles}</style>
</head>
<body>
<div id="app">${body}</div>
${hydration ? `<script>window.__rostara=${serialise(hydration)}</script>\n<script type="module" src="${scriptHref}"></script>` : ''}
</body>
</html>
`;
}

function titleFor(screenName) {
  return screenName ? `${screenName} ${'\u2014'} ${ui.brand}` : ui.brand;
}

/** Renders a route through React Router on the server, already drawn. */
export async function renderRoute({ url, routeId, shell, page, hydrate }) {
  const data = { routeId, shell, page };
  const context = await handler.query(new Request(url, { method: 'GET' }));
  const router = createStaticRouter(handler.dataRoutes, context);
  const body = renderToString(
    <DeskProvider value={data}>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </DeskProvider>,
  );
  return document({ body, title: titleFor(shell.screenName), hydration: hydrate ? data : null });
}

/** Renders one of the product's own page answers, which need no script. */
export function renderAnswer({ kind, shell }) {
  return document({
    body: renderToString(<AnswerPage kind={kind} shell={shell} />),
    title: titleFor(shell.screenName),
    hydration: null,
  });
}
