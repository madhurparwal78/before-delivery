interface Shell {
  title: string;
  bundle: 'game' | 'console' | 'claim';
  bodyClass: string;
  root: string;
}

function page({ title, bundle, bodyClass, root }: Shell): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>${title}</title>
<link rel="stylesheet" href="/assets/paper.css">
<link rel="preload" href="/assets/fonts/fraunces-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/atkinson-400.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body class="${bodyClass}">
${root}
<script type="module" src="/assets/${bundle}.js"></script>
</body>
</html>
`;
}

export const gamePage = (): string =>
  page({
    title: 'Parcel Moon',
    bundle: 'game',
    bodyClass: 'game-body',
    root: '<div id="bramble-app"></div>',
  });

export const claimPage = (): string =>
  page({
    title: 'Claim your save — Parcel Moon',
    bundle: 'claim',
    bodyClass: 'paper-page',
    root: '<div id="claim-app"></div>',
  });

export const consolePage = (): string =>
  page({
    title: 'Founder console — Parcel Moon',
    bundle: 'console',
    bodyClass: 'paper-page',
    root: '<div id="console-app"></div>',
  });
