import { api } from '../api.js';
import { el } from '../dom.js';
import { account } from '../runtime.js';
import { navigate, onLeave } from '../router.js';
import { browserZone, countdown } from '../format.js';
import { onLive } from '../live.js';
import { editorLaunchPills } from '../shell.js';
import { emptyState, exportsList, projectCards, sectionHeading } from './common.js';
import { showVerifyReminder } from './auth.js';
import { addNotice } from '../notice.js';

const projectsAndExports = async (zone: string): Promise<HTMLElement[]> => {
  const [projectsResult, exportsResult] = await Promise.all([api.projects(), api.exports()]);
  const projects = projectsResult.ok ? projectsResult.value.projects : [];
  const exports = exportsResult.ok ? exportsResult.value.exports : [];
  const projectsSection = el('section', { class: 'qy-block' }, [sectionHeading('My projects')]);
  if (projects.length === 0) {
    projectsSection.append(
      emptyState(
        'Nothing designed yet. Open the 3D Workshop and make something you can hold.',
        el('a', { href: '/editor/new?kind=3d', class: 'qy-pill qy-pill-solid qy-pill-3d', text: 'New 3D design' }),
      ),
    );
  } else {
    projectsSection.append(projectCards(projects, zone));
  }
  return [projectsSection, el('section', { class: 'qy-block' }, [sectionHeading('My exports'), exportsList(exports)])];
};

export const studentHomePage = async (main: HTMLElement): Promise<void> => {
  const current = account();
  if (!current) {
    navigate('/join');
    return;
  }
  if (current.kind !== 'student') {
    navigate(current.kind === 'educator' ? '/dashboard' : '/projects');
    return;
  }
  const classResult = await api.studentClass();
  if (!classResult.ok) {
    navigate('/join');
    return;
  }
  const view = classResult.value;
  const countdownLine = el('p', { class: 'qy-countdown qy-figures', text: countdown(view.secondsToHandIn) });
  const stop = onLive('classroom-state', (data) => {
    if (data.classroomId !== view.id) return;
    countdownLine.textContent = countdown(data.secondsToHandIn);
  });
  const endAccess = onLive('access-ended', (data) => {
    if (data.classroomId === view.id) addNotice({ id: 'removed', text: data.message });
  });
  onLeave(() => {
    stop();
    endAccess();
  });

  main.append(
    el('div', { class: 'qy-column qy-stack' }, [
      el('h1', { class: 'qy-page-heading', text: view.name }),
      countdownLine,
      el('section', { class: 'qy-block' }, [sectionHeading('Start making'), editorLaunchPills()]),
      ...(await projectsAndExports(view.timeZone)),
    ]),
  );
};

export const personalHomePage = async (main: HTMLElement): Promise<void> => {
  const current = account();
  if (!current) {
    navigate('/signin');
    return;
  }
  if (current.kind === 'student') {
    navigate('/class');
    return;
  }
  if (!current.emailVerified && current.email) showVerifyReminder(current.email);
  main.append(
    el('div', { class: 'qy-column qy-stack' }, [
      el('h1', { class: 'qy-page-heading', text: 'Your workshop' }),
      el('section', { class: 'qy-block' }, [sectionHeading('Start making'), editorLaunchPills()]),
      ...(await projectsAndExports(browserZone())),
    ]),
  );
};
