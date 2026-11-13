/** The HTML shells: the consoles and the fixed full-page headings. */

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type ShellOptions = {
  title: string;
  screen: "missions" | "author" | "share";
  missionId?: string;
  token?: string;
};

export function appShell(options: ShellOptions): string {
  const attributes = [
    `data-screen="${options.screen}"`,
    options.missionId ? `data-mission-id="${escapeHtml(options.missionId)}"` : "",
    options.token ? `data-share-token="${escapeHtml(options.token)}"` : "",
  ]
    .filter((attribute) => attribute.length > 0)
    .join(" ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body ${attributes}>
<main id="app"></main>
</body>
</html>
`;
}

export function fixedPage(heading: string, line: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<link rel="stylesheet" href="/app.css">
</head>
<body data-screen="notice">
<main id="app" class="notice">
<h1>${escapeHtml(heading)}</h1>
${line.length > 0 ? `<p>${escapeHtml(line)}</p>` : ""}
</main>
</body>
</html>
`;
}
