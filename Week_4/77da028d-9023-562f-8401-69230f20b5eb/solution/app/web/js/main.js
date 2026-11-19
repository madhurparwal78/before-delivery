// Picks the page module for the current path and mounts it.
const ROUTES = [
  [/^\/unlock$/, 'unlock'],
  [/^\/plan$/, 'plan'],
  [/^\/projects$/, 'projects'],
  [/^\/projects\/([^/]+)$/, 'project', 'id'],
  [/^\/sessions$/, 'sessions'],
  [/^\/library$/, 'library'],
  [/^\/site$/, 'site'],
  [/^\/s\/([^/]+)$/, 'shared', 'token'],
];

for (const [pattern, name, param] of ROUTES) {
  const match = pattern.exec(location.pathname);
  if (!match) continue;
  const page = await import(`./pages/${name}.js`);
  await page.mount({ params: param ? { [param]: decodeURIComponent(match[1]) } : {} });
  break;
}
