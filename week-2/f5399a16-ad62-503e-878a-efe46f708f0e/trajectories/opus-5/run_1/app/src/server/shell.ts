import { matchScreen, pageTitle } from '../domain/screens.js';

function escapeHtml(text: string): string {
  return text
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;');
}

/**
 * The shell carries the heading's text in its first paint, so a public page's
 * level-one heading never appears empty, and never names a service address.
 */
export function shellHtml(path: string): string {
  const screen = matchScreen(path);
  const lines = screen.headingLines;
  const heading = lines === null ? '' : lines.join(' ');
  const title = lines === null ? 'Clapstick' : pageTitle(heading);
  const headingHtml =
    lines === null
      ? ''
      : lines
          .map(
            (line, index) =>
              `${index > 0 ? ' ' : ''}<span data-part="heading-line" style="--line:${index}">${escapeHtml(
                line,
              )}</span>`,
          )
          .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div id="shell">
<main id="main">
<h1 class="h1" id="screen-heading" tabindex="-1">${headingHtml}</h1>
</main>
</div>
<div id="announcements" role="status" aria-live="polite" class="announcements"></div>
<script src="/app.js" defer></script>
</body>
</html>
`;
}
