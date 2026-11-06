const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tidewright</title>
    <link rel="stylesheet" href="/assets/app.css" />
    <script type="module" src="/assets/app.js"></script>
  </head>
  <body>
    <div class="paper-grid" aria-hidden="true"></div>
    <div id="app"></div>
    <div class="live-regions">
      <div id="announcements" role="status" aria-live="polite" aria-label="Announcements"></div>
    </div>
  </body>
</html>
`;

export function renderShell(): string {
  return SHELL;
}
