import { announcementRegion } from './core/announce';
import { get, post } from './core/api';
import { el } from './core/dom';
import { startLive } from './core/live';
import { watchMotionPreference } from './core/motion';
import { navigate, route, setNotFound, startRouter, type PageRender } from './core/router';
import { buildHeader, currentUser, loadingFrame, registerToastHost, setCurrentUser, type Me } from './core/shell';
import { renderApplicationDetail, renderApply, renderMyApplications } from './pages/apply';
import { renderForgotPassword, renderJoin, renderJoinConfirm, renderResetPassword, renderSignIn } from './pages/auth';
import { renderChannel, renderChannels } from './pages/channels';
import { renderCompany, renderReviewLink } from './pages/company';
import { renderCompanySearch } from './pages/companies';
import { renderContribute, renderInterviewForm, renderPayForm, renderReviewForm } from './pages/contribute';
import { renderMyContributions } from './pages/contributions';
import { renderApplicant, renderEmployerHome, renderNewJob, renderPipeline } from './pages/employer';
import { renderFounder } from './pages/founder';
import { renderJobPage, renderJobSearch } from './pages/jobs';
import { renderLanding } from './pages/landing';
import { renderModeration } from './pages/moderation';
import { renderAlerts, renderSavedJobs } from './pages/saved';

function notFoundPage(container: HTMLElement): void {
  container.append(
    el('div', { class: 'narrow-page' }, [
      el('h1', { text: 'Page not found' }),
      el('p', { text: 'It may have been removed, or the link is wrong.' }),
      el('a', { href: '/jobs', text: 'Search lab jobs' }),
    ]),
  );
}

async function signOut(): Promise<void> {
  await post('/api/auth/sign-out');
  setCurrentUser(null);
  navigate('/');
}

type Guard = 'member' | 'moderator' | 'team' | 'founder';

/** A page the signed-in role cannot use is the not-found page, as on the server. */
function guarded(guard: Guard, render: PageRender): PageRender {
  return (container, ctx) => {
    const user = currentUser();
    if (!user) {
      navigate('/sign-in', { replace: true });
      return undefined;
    }
    const allowed =
      guard === 'member'
        ? user.role === 'member'
        : guard === 'moderator'
          ? user.role === 'moderator' || user.role === 'founder'
          : guard === 'team'
            ? user.role === 'employer_admin' || user.role === 'recruiter'
            : user.role === 'founder';
    if (!allowed) return notFoundPage(container);
    return render(container, ctx);
  };
}

async function boot(): Promise<void> {
  watchMotionPreference();
  const root = document.getElementById('app');
  if (!root) return;

  try {
    setCurrentUser(await get<Me>('/api/me'));
  } catch {
    setCurrentUser(null);
  }

  const toastHost = el('div', { class: 'toast-host' });
  const headerHost = el('div');
  const main = el('main', { class: 'site-main' });
  root.append(announcementRegion(), toastHost, headerHost, main);
  registerToastHost(toastHost);

  route('/', renderLanding);
  route('/sign-in', renderSignIn);
  route('/join', renderJoin);
  route('/join/confirm', renderJoinConfirm);
  route('/forgot-password', renderForgotPassword);
  route('/reset-password', renderResetPassword);
  route('/jobs', renderJobSearch);
  route('/jobs/:id', renderJobPage);
  route('/jobs/:id/apply', guarded('member', renderApply));
  route('/companies', renderCompanySearch);
  route('/companies/:slug', renderCompany);
  route('/companies/:slug/reviews/:id', renderReviewLink);
  route('/contribute', guarded('member', renderContribute));
  route('/contribute/review', guarded('member', renderReviewForm));
  route('/contribute/pay', guarded('member', renderPayForm));
  route('/contribute/interview', guarded('member', renderInterviewForm));
  route('/me/contributions', guarded('member', renderMyContributions));
  route('/saved', guarded('member', renderSavedJobs));
  route('/alerts', guarded('member', renderAlerts));
  route('/applications', guarded('member', renderMyApplications));
  route('/applications/:id', guarded('member', renderApplicationDetail));
  route('/channels', guarded('member', renderChannels));
  route('/channels/:slug', guarded('member', renderChannel));
  route('/moderation', guarded('moderator', renderModeration));
  route('/employer', guarded('team', renderEmployerHome));
  route('/employer/jobs/new', guarded('team', renderNewJob));
  route('/employer/jobs/:id', guarded('team', renderPipeline));
  route('/employer/applications/:id', guarded('team', renderApplicant));
  route('/founder', guarded('founder', renderFounder));
  setNotFound(notFoundPage);

  startRouter(main, () => headerHost.replaceChildren(buildHeader(() => void signOut())), loadingFrame);
  startLive();
}

void boot();
