import { CONTENT_FAILED_MESSAGE } from '../shared/messages';
import { fetchContent } from './api';
import { all, need, showAlert } from './dom';
import { openAddressedChapter, setupNavigation } from './navigation';
import { renderInterviewPage } from './page-interview';
import { renderStorePage } from './page-store';
import { InnerPace } from './story-about';
import { renderInterviews } from './story-interviews';
import { setupMeridian } from './story-meridian';
import { OxygenStages } from './story-oxygen';
import { renderProduct } from './story-product';
import { setupScience } from './story-science';

/** Chapter headings slide up the first time they enter the viewport. */
function revealChapterHeadings(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.1 },
  );
  for (const heading of all('.chapter__heading')) {
    observer.observe(heading);
  }
}

async function startStory(): Promise<void> {
  const navigation = setupNavigation();
  setupScience();
  const innerPace = new InnerPace();
  const oxygen = new OxygenStages();
  innerPace.follow();
  oxygen.follow();
  try {
    const content = await fetchContent();
    renderProduct(content);
    renderInterviews(content.interviews);
    setupMeridian(content.scenarios);
  } catch {
    showAlert(need('#main'), CONTENT_FAILED_MESSAGE);
  }
  innerPace.follow();
  oxygen.follow();
  openAddressedChapter(navigation);
  revealChapterHeadings();
}

async function start(): Promise<void> {
  const page = document.body.dataset['page'];
  if (page === 'story') {
    await startStory();
    return;
  }
  setupNavigation();
  if (page === 'interview') {
    await renderInterviewPage();
    return;
  }
  if (page === 'store') {
    renderStorePage(await fetchContent());
  }
}

void start().catch(() => {
  showAlert(need('#main'), CONTENT_FAILED_MESSAGE);
});
