export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const pageLayout = (opts: { title: string; body: string; desk?: boolean; lang?: string; dir?: string }): string => {
  const { title, body, desk, lang = "en", dir = "ltr" } = opts;
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body data-desk="${desk ? "true" : "false"}">
${body}
<script src="/assets/app.js" defer></script>
</body>
</html>`;
};

export const publicHeader = (active: string): string => `
<header class="site-header" data-scrolled="false">
  <a class="wordmark" href="/">Bottega Semenza</a>
  <nav class="site-nav">
    <button id="work-panel-button" aria-expanded="false" aria-controls="work-panel">Work</button>
    <a href="/enquire" class="${active === "enquire" ? "is-active" : ""}">Enquire</a>
    <a href="/sign-in" class="${active === "sign-in" ? "is-active" : ""}">Sign in</a>
  </nav>
</header>
<div id="work-panel" class="work-panel" hidden></div>`;

export const publicFooter = `<footer class="site-footer"><p>Bottega Semenza, Turin. One chair at a time.</p></footer>`;

export const notFoundBody = (): string => `
${publicHeader("")}
<main id="main"><h1>Page not found</h1><p>The address you asked for does not exist.</p></main>
${publicFooter}`;
