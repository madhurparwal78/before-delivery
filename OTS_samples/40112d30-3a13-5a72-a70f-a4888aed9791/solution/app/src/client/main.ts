import { notFound } from './lib/shell.ts';

// One client for every screen. The server decides the status of each page; the path picks the screen.

type Params = Record<string, string>;
interface Screen { pattern: RegExp; names: string[]; load: () => Promise<{ render: (params: Params) => Promise<void> }> }

const UUID = '[0-9a-f-]{36}';
const screens: Screen[] = [
  { pattern: /^\/$/, names: [], load: () => import('./screens/marketing.ts') },
  { pattern: /^\/signin$/, names: [], load: () => import('./screens/signin.ts') },
  { pattern: /^\/signup$/, names: [], load: () => import('./screens/signup.ts') },
  { pattern: /^\/forms$/, names: [], load: () => import('./screens/forms.ts') },
  { pattern: new RegExp(`^/forms/(${UUID})/edit$`), names: ['id'], load: () => import('./screens/builder.ts') },
  { pattern: new RegExp(`^/forms/(${UUID})/summary$`), names: ['id'], load: () => import('./screens/summary.ts') },
  { pattern: new RegExp(`^/forms/(${UUID})/responses$`), names: ['id'], load: () => import('./screens/responses.ts') },
  { pattern: new RegExp(`^/forms/(${UUID})/responses/(${UUID})$`), names: ['id', 'rid'], load: () => import('./screens/response.ts') },
  { pattern: new RegExp(`^/forms/(${UUID})/editions$`), names: ['id'], load: () => import('./screens/editions.ts') },
  { pattern: new RegExp(`^/forms/(${UUID})/editions/(\\d+)$`), names: ['id', 'number'], load: () => import('./screens/edition.ts') },
  { pattern: /^\/f\/([^/]+)$/, names: ['slug'], load: () => import('./screens/respond.ts') },
  { pattern: /^\/r\/([^/]+)$/, names: ['token'], load: () => import('./screens/resume.ts') },
  { pattern: /^\/invite\/([^/]+)$/, names: ['token'], load: () => import('./screens/invite.ts') },
];

async function start(): Promise<void> {
  const flagged = document.querySelector('meta[name="nf-screen"]')?.getAttribute('content') === 'notfound';
  const match = flagged ? null : screens.find((s) => s.pattern.test(location.pathname));
  if (!match) return notFound();
  const groups = match.pattern.exec(location.pathname) ?? [];
  const params: Params = {};
  match.names.forEach((name, index) => { params[name] = decodeURIComponent(groups[index + 1] ?? ''); });
  const screen = await match.load();
  await screen.render(params);
}

void start();
