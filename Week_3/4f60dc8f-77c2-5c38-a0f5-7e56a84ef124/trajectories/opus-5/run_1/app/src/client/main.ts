import type { CaseStudy, EngagementView, ReviewView, Service } from '../shared/domain.js';
import { bootstrap } from './core.js';
import { initMarquee, initNavigation, initOutage, initSearch, initStillZoom } from './chrome.js';
import { initCaseStudyTransition, initClaySwitch, initDeck } from './home.js';
import {
  initEngagementPage,
  initReviewPage,
  initSignInForm,
  initStartForm,
  initStudioDashboard,
  initStudioEngagement,
  initStudioSignIn,
} from './pages.js';
import { initRig, type RigBootstrap } from './rig.js';
import { initCaseStudySubjects, initHero, initProcess, initServiceObjects } from './scenes.js';

type Boot =
  | { page: 'home' }
  | { page: 'case_study'; study: CaseStudy }
  | { page: 'not_found' }
  | { page: 'start' }
  | { page: 'sign_in'; next: string | null }
  | { page: 'account' }
  | { page: 'engagement'; engagement: EngagementView }
  | ({ page: 'rig' } & RigBootstrap)
  | { page: 'review'; review: ReviewView; token: string }
  | { page: 'studio_sign_in' }
  | { page: 'studio' }
  | { page: 'studio_engagement'; engagement: EngagementView; services: Service[] };

const start = (): void => {
  const boot = bootstrap<Boot>();
  initNavigation();

  switch (boot.page) {
    case 'home':
      initSearch();
      initOutage('public');
      initHero();
      initCaseStudySubjects();
      initServiceObjects();
      initProcess();
      initMarquee();
      initDeck();
      initCaseStudyTransition();
      break;
    case 'case_study':
      initSearch();
      initCaseStudySubjects();
      initClaySwitch();
      break;
    case 'start':
      initStartForm();
      break;
    case 'sign_in':
      initSignInForm(boot.next);
      break;
    case 'account':
      initOutage('account');
      break;
    case 'engagement':
      initEngagementPage(boot.engagement);
      break;
    case 'rig':
      initRig(boot);
      break;
    case 'review':
      initReviewPage(boot.review, boot.token);
      initStillZoom();
      break;
    case 'studio_sign_in':
      initStudioSignIn();
      break;
    case 'studio':
      initCaseStudySubjects();
      initStudioDashboard();
      break;
    case 'studio_engagement':
      initStudioEngagement();
      break;
    case 'not_found':
      break;
  }
};

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
