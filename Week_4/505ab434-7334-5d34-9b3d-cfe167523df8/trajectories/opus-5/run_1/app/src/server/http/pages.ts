const GLYPH = `<svg class="empty-glyph" viewBox="0 0 120 120" role="img" aria-hidden="true" focusable="false">
<rect x="10" y="22" width="100" height="76" fill="#F2A08C"/>
<rect x="22" y="34" width="76" height="52" fill="#A3341F"/>
<rect x="40" y="52" width="40" height="16" fill="#17161C"/>
</svg>`;

export function fieldCellPage(heading: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="grid-lines" aria-hidden="true"></div>
<main class="page plain-page">
  <div class="cell field field-ember empty-state">
    ${GLYPH}
    <h1>${heading}</h1>
  </div>
</main>
</body>
</html>
`;
}
