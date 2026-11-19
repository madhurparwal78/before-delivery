import { config } from './config';

export interface ShellBootstrap {
  form: unknown;
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function shellHtml(bootstrap: ShellBootstrap): string {
  const settings = {
    canvas_breakpoint_px: config.canvasBreakpointPx,
    time_zone: config.timeZone,
    form: bootstrap.form,
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pinbyte Switchyard</title>
<link rel="stylesheet" href="/assets/app.css">
<script id="switchyard-settings" type="application/json">${escapeJson(settings)}</script>
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
}
