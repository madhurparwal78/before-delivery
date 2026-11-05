import { EVENT } from '../../shared/event.js';

export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${EVENT.site} — ${EVENT.courseTitle}</title>
<meta name="description" content="${EVENT.courseTitle}, ${EVENT.dates}, ${EVENT.venueName}, ${EVENT.city}.">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script src="/app.js" defer></script>
</body>
</html>
`;
