/** Document shell shared by every page: head, fonts and tokens, the single status region and the page scripts. */

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface PageOptions {
  title: string;
  description?: string;
  /** Selects the page-scoped class and the client module that boots on it. */
  page: string;
  /** Extra class on <body>, e.g. a tint class scoped to one marketing route. */
  bodyClass?: string;
  styles: string[];
  scripts: string[];
  body: string;
  /** Pages that carry session data are never stored by the browser or its back/forward cache. */
  private?: boolean;
}

export interface RenderedPage {
  html: string;
  private: boolean;
}

export function documentShell(options: PageOptions): RenderedPage {
  const styles = ["/assets/css/tokens.css", "/assets/css/base.css", ...options.styles]
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("\n    ");
  const scripts = options.scripts.map((src) => `<script type="module" src="${src}"></script>`).join("\n    ");
  const description = options.description ?? "Tallwind is business banking for companies on the move.";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(options.title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="theme-color" content="#fbfcfd">
    <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
    <link rel="preload" href="/assets/fonts/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
    ${styles}
  </head>
  <body class="${esc(options.bodyClass ?? "")}" data-page="${esc(options.page)}">
    <a class="skip-link" href="#main">Skip to content</a>
    ${options.body}
    <div role="status" aria-live="polite" data-status></div>
    ${scripts}
  </body>
</html>`;
  return { html, private: options.private ?? false };
}
