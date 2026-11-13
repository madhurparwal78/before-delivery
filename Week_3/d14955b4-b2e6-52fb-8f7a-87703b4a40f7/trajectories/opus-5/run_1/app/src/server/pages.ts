interface ShellOptions {
  nonce: string;
  gameSlug?: string;
  gameName?: string;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderShell(options: ShellOptions): string {
  const slug = escapeAttribute(options.gameSlug ?? '');
  const name = escapeAttribute(options.gameName ?? '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hushline</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root" data-game-slug="${slug}" data-game-name="${name}"></div>
<script nonce="${options.nonce}" src="/app.js"></script>
</body>
</html>
`;
}

export const PAGE_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/signin$/,
  /^\/inbox$/,
  /^\/inbox\/[^/]+$/,
  /^\/team$/,
  /^\/widget\/[^/]+$/,
];

export function isKnownPage(pathname: string): boolean {
  return PAGE_PATTERNS.some((pattern) => pattern.test(pathname));
}
