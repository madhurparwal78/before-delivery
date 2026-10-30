export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(title: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/paper.css">
</head>
<body class="paper-page">
${main}
</body>
</html>
`;
}

/** The public postcard page: a heading, the live display name and the image. Nothing else. */
export function postcardPage(displayName: string, shareToken: string): string {
  return shell(
    'A postcard from Bramble',
    `<main class="postcard-page">
  <article class="stamp-card perforated">
    <h1>A postcard from Bramble</h1>
    <div class="postcard-frame">
      <img src="/p/${encodeURIComponent(shareToken)}/image.png" alt="" width="1200" height="800">
    </div>
    <p class="postcard-caption">Sent by ${escapeHtml(displayName)}</p>
  </article>
</main>`,
  );
}

export function returnedToSenderPage(): string {
  return shell(
    'Returned to sender',
    `<main class="postcard-page">
  <article class="stamp-card perforated">
    <h1>Returned to sender</h1>
    <p>This postcard has been returned to sender.</p>
  </article>
</main>`,
  );
}
