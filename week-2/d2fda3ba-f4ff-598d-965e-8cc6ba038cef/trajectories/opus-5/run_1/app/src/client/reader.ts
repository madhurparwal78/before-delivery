interface PreviewEntry {
  path: string;
  title: string;
  excerpt: string;
}

const HOVER_DELAY_MS = 320;

function isInternal(link: HTMLAnchorElement): boolean {
  const href = link.getAttribute('href') ?? '';
  return href.length > 0 && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) && !href.startsWith('//');
}

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'cairn-link-preview';
  panel.setAttribute('role', 'tooltip');
  panel.hidden = true;
  const title = document.createElement('p');
  title.className = 'preview-title';
  const excerpt = document.createElement('p');
  excerpt.className = 'preview-excerpt';
  panel.append(title, excerpt);
  document.body.append(panel);
  return panel;
}

/** Link previews for a published dossier. Everything else on the page works without this script. */
function start(): void {
  const panel = buildPanel();
  const title = panel.querySelector('.preview-title');
  const excerpt = panel.querySelector('.preview-excerpt');
  if (!(title instanceof HTMLElement) || !(excerpt instanceof HTMLElement)) return;

  let previews: Map<string, PreviewEntry> | null = null;
  let timer: number | null = null;
  let describedLink: HTMLAnchorElement | null = null;

  const load = async (): Promise<Map<string, PreviewEntry>> => {
    if (previews) return previews;
    const [, area, key] = window.location.pathname.split('/');
    const response = await fetch(`/${area}/${key}/previews.json`, { credentials: 'same-origin' });
    const data = (await response.json()) as { previews?: PreviewEntry[] };
    previews = new Map((data.previews ?? []).map((entry) => [entry.path, entry]));
    return previews;
  };

  const hide = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    panel.hidden = true;
    describedLink?.removeAttribute('aria-describedby');
    describedLink = null;
  };

  const show = (link: HTMLAnchorElement): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void load()
        .then((entries) => {
          const entry = entries.get(link.getAttribute('href') ?? '');
          if (!entry) return;
          title.textContent = entry.title;
          excerpt.textContent = entry.excerpt;
          panel.hidden = false;
          describedLink = link;
          link.setAttribute('aria-describedby', panel.id);
        })
        .catch(() => undefined);
    }, HOVER_DELAY_MS);
  };

  for (const link of Array.from(document.querySelectorAll('a'))) {
    if (!isInternal(link)) continue;
    link.addEventListener('mouseenter', () => show(link));
    link.addEventListener('mouseleave', hide);
    link.addEventListener('focus', () => show(link));
    link.addEventListener('blur', hide);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
