import { openDialog } from './dialogs.js';

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The breakpoint is whatever the server served with this page. */
function breakpoint(): number {
  return Number(document.documentElement.dataset.diffBreakpoint);
}

export function isNarrow(): boolean {
  return window.innerWidth < breakpoint();
}

export function storedDiffView(): 'split' | 'unified' {
  return window.localStorage.getItem('ridgestack.diffview') === 'unified' ? 'unified' : 'split';
}

export function activeDiffView(): 'split' | 'unified' {
  return isNarrow() ? 'unified' : storedDiffView();
}

function applyDiffTables(): void {
  const view = activeDiffView();
  document.querySelectorAll<HTMLTableElement>('table.diff').forEach((table) => {
    table.hidden = table.dataset.view !== view;
  });
  document.querySelectorAll<HTMLInputElement>('[data-diff-view]').forEach((radio) => {
    radio.checked = radio.dataset.diffView === storedDiffView();
  });
}

function filesDialog(opener: HTMLElement): void {
  const tree = document.querySelector<HTMLElement>('.filetree ul');
  if (!tree) return;
  const content = document.createElement('div');
  const clone = tree.cloneNode(true) as HTMLElement;
  content.append(clone);
  const handle = openDialog({
    label: 'Files',
    content,
    opener,
    onSubmit: () => handle.close(),
  });
  clone.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => handle.close());
  });
}

export function applyLayout(): void {
  const narrow = isNarrow();
  document.body.classList.toggle('narrow', narrow);
  const group = document.querySelector<HTMLElement>('.diffviews');
  if (group) group.hidden = narrow;
  const tree = document.querySelector<HTMLElement>('.filetree');
  if (tree) tree.hidden = narrow;
  const filesButton = document.querySelector<HTMLElement>('[data-files-drawer]');
  if (filesButton) filesButton.hidden = !narrow;
  applyDiffTables();
}

export function initLayout(): void {
  applyLayout();
  window.addEventListener('resize', applyLayout);

  document.addEventListener('change', (event) => {
    const radio = (event.target as HTMLElement).closest<HTMLInputElement>('[data-diff-view]');
    if (!radio) return;
    window.localStorage.setItem('ridgestack.diffview', radio.dataset.diffView ?? 'split');
    applyDiffTables();
  });

  document.addEventListener('click', (event) => {
    const opener = (event.target as HTMLElement).closest<HTMLElement>('[data-files-drawer]');
    if (opener) filesDialog(opener);
  });

  const pill = document.querySelector<HTMLElement>('.navpill');
  if (pill) {
    const onScroll = () => pill.classList.toggle('stuck', window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  if (!reducedMotion() && 'IntersectionObserver' in window) {
    const sections = document.querySelectorAll<HTMLElement>('.hero, .bento .card, .runners, .pushapi, .closing, .neonmark');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('reveal');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );
    sections.forEach((section) => observer.observe(section));
  }
}
