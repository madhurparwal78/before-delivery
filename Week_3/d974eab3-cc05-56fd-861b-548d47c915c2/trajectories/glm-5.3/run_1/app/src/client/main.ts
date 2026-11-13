import type { Content, InterviewDetail } from './core.js';
import { meridianInit } from './meridian.js';
import { announcePanel, announceStage, initInnerPace, initOxygen } from './pacer.js';
import { renderInterviewDetail, renderProduct, renderStore, initInterviewFilter } from './product.js';
import { initScience } from './science.js';
import {
  initChapterHeadingReveals,
  initChapterRail,
  initHeroWords,
  initMenu,
  initSkipLink,
  jumpToChapter,
  syncHashToView,
  currentHashChapter,
} from './page.js';

function contentLoadAlert(): void {
  const existing = document.querySelector('[data-content-alert]');
  if (existing) return;
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.setAttribute('data-content-alert', 'true');
  alert.textContent = 'The story cannot be loaded right now. Please reload the page.';
  const main = document.querySelector('main');
  main?.prepend(alert);
}

async function loadContent(): Promise<Content | null> {
  try {
    const response = await fetch('/api/content');
    if (!response.ok) throw new Error('content failed');
    return (await response.json()) as Content;
  } catch {
    contentLoadAlert();
    return null;
  }
}

function storyPage(content: Content): void {
  initHeroWords();
  initChapterHeadingReveals();
  initInnerPace((panel, announce) => {
    if (announce) announcePanel(panel);
  });
  initOxygen((stage, announce) => {
    if (announce) announceStage(stage);
  });
  initScience(content.product);
  renderProduct(content);
  initInterviewFilter(content);
  meridianInit(content);

  const storedHash = currentHashChapter();
  if (storedHash && document.getElementById(storedHash)) {
    jumpToChapter(storedHash, true);
  } else {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#opening`);
    syncHashToView();
  }

  initChapterRail((chapterId) => {
    jumpToChapter(chapterId, true);
  });
}

function storePage(content: Content): void {
  renderStore(content);
}

async function interviewPage(slug: string): Promise<void> {
  const response = await fetch(`/api/interviews/${slug}`);
  if (!response.ok) {
    document.title = 'Not found | Vireo Pace';
    const heading = document.querySelector<HTMLElement>('[data-interview-name]');
    if (heading) {
      heading.textContent = 'This interview does not exist.';
      heading.removeAttribute('data-interview-name');
    }
    document.querySelector('[data-interview-role]')?.remove();
    document.querySelector('[data-interview-lede]')?.remove();
    document.querySelector('[data-interview-portrait]')?.remove();
    document.querySelector('[data-interview-answers]')?.remove();
    document.querySelector('[data-interview-nav]')?.remove();
    const link = document.createElement('p');
    link.innerHTML = '<a class="action-link" href="/#interviews" data-chapter-jump="interviews">All interviews</a>';
    const page = document.querySelector('[data-interview-page]');
    page?.append(link);
    const fictional = document.querySelector('.fictional-note');
    fictional?.remove();
    window.setTimeout(() => heading?.focus({ preventScroll: true }), 0);
    return;
  }
  const interview = (await response.json()) as InterviewDetail;
  renderInterviewDetail(interview);
}

function detectPage(): 'story' | 'store' | 'interview' | 'info' {
  const path = window.location.pathname;
  if (path === '/') return 'story';
  if (path === '/store') return 'store';
  if (/^\/interviews\/[a-z0-9-]+$/.test(path)) return 'interview';
  return 'info';
}

async function boot(): Promise<void> {
  initSkipLink();
  initMenu();

  const kind = detectPage();
  if (kind === 'interview') {
    if (!document.querySelector('[data-interview-page]')) return;
    const slug = window.location.pathname.split('/').pop() ?? '';
    await interviewPage(slug);
    return;
  }

  const content = await loadContent();
  if (!content) return;
  if (kind === 'story') storyPage(content);
  if (kind === 'store') storePage(content);
}

boot();
