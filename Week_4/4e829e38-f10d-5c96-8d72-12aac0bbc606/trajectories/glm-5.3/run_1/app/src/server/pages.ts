export type PageName = 'welcome' | 'account' | 'mywork' | 'project' | 'rules' | 'goals' | 'workload' | 'inbox' | 'form' | 'notfound';

export interface PageOptions { personName?: string; }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderPage(name: PageName, opts: PageOptions): string {
  void opts;
  const title = titleFor(name);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/app.css">
<link rel="stylesheet" href="/pages.css">
</head>
<body class="page-${name}">
<div id="app" data-page="${name}"></div>
<script src="/app.js" defer></script>
</body>
</html>`;
}

function titleFor(name: PageName): string {
  switch (name) {
    case 'welcome': return 'Everyweek';
    case 'account': return 'Account | Everyweek';
    case 'mywork': return 'My work | Everyweek';
    case 'project': return 'Project | Everyweek';
    case 'rules': return 'Rules | Everyweek';
    case 'goals': return 'Goals | Everyweek';
    case 'workload': return 'Workload | Everyweek';
    case 'inbox': return 'Inbox | Everyweek';
    case 'form': return 'Request | Everyweek';
    case 'notfound': return 'Not found | Everyweek';
  }
}
