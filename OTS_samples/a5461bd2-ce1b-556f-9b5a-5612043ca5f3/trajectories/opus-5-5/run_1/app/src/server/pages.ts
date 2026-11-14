import { emptyAnswers, esc, renderFooter, renderHeader, renderMain } from "../shared/render.js";
import {
  currentSection,
  pageTitle,
  parseContactQuery,
  parseFaqQuery,
  parseGalleryQuery,
  parsePriceQuery,
  type Route,
} from "../shared/routes.js";
import type { Bootstrap } from "../shared/types.js";

function bootstrapScript(bootstrap: Bootstrap): string {
  const json = JSON.stringify(bootstrap).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script id="bootstrap" type="application/json">${json}</script>`;
}

export function renderPage(route: Route, search: URLSearchParams, bootstrap: Bootstrap): string {
  const { content, settings } = bootstrap;
  const prefill = parseContactQuery(search, content);
  const main = renderMain(route, content, {
    gallery: parseGalleryQuery(search, content),
    workPageSize: settings.workPageSize,
    prices: parsePriceQuery(search, content),
    faqOpen: parseFaqQuery(search, content),
    contact: { ...emptyAnswers(), service: prefill.service, item: prefill.item },
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle(route, content))}</title>
<link rel="stylesheet" href="/assets/app-style.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
${renderHeader(currentSection(route))}
<main id="content" class="route-${route.kind}">${main}</main>
${renderFooter()}
${bootstrapScript(bootstrap)}
</body>
</html>`;
}

export function renderUnavailablePage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Vellum Orbit Studio</title></head>
<body><main><h1>Vellum Orbit Studio is starting. Try again in a moment.</h1></main></body></html>`;
}
