import { escapeHtml } from "../shared/html.js";
import { PAGE_PATHS, PAGE_TITLES, type PageName } from "../shared/titles.js";

/** The fixed page an address names, or null for any other address. */
export function pageNameOf(pathname: string): PageName | null {
  return pathname in PAGE_PATHS ? PAGE_PATHS[pathname as keyof typeof PAGE_PATHS] : null;
}

export function titleOfPage(name: PageName | null): string {
  return name === null ? PAGE_TITLES.notFound : PAGE_TITLES[name];
}

/** The one HTML document every page shares; the browser app draws the page inside it. */
export function shell(title: string, modules: readonly string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b1511">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/shippori-mincho-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/zen-kaku-gothic-new-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/zen-kaku-gothic-new-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
${modules.map((module) => `<link rel="modulepreload" href="${module}">`).join("\n")}
<script type="module" src="/assets/client/main.js"></script>
</head>
<body>
<div id="root"></div>
</body>
</html>
`;
}
