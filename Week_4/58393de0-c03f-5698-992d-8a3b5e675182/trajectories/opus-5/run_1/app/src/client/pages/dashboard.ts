import { STATE_LABEL } from '../../shared/copy.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { account } from '../runtime.js';
import { navigate } from '../router.js';
import { browserZone } from '../format.js';
import { editorLaunchPills } from '../shell.js';
import { emptyState, exportsList, projectCards, sectionHeading } from './common.js';
import { openCreateClassroom } from './classroom-dialogs.js';
import { showVerifyReminder } from './auth.js';

export const dashboardPage = async (main: HTMLElement): Promise<void> => {
  const current = account();
  if (!current) {
    navigate('/signin');
    return;
  }
  if (current.kind !== 'educator') {
    navigate(current.kind === 'student' ? '/class' : '/projects');
    return;
  }
  if (!current.emailVerified && current.email) showVerifyReminder(current.email);

  const [classroomsResult, projectsResult, exportsResult] = await Promise.all([
    api.classrooms(),
    api.projects(),
    api.exports(),
  ]);
  const classrooms = classroomsResult.ok ? classroomsResult.value.classrooms : [];
  const projects = projectsResult.ok ? projectsResult.value.projects : [];
  const exports = exportsResult.ok ? exportsResult.value.exports : [];

  const createPill = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Create classroom' });
  createPill.addEventListener('click', () =>
    openCreateClassroom(createPill, classrooms[0]?.timeZone ?? 'America/Chicago'),
  );

  const classroomSection = el('section', { class: 'qy-block' }, [sectionHeading('Classrooms')]);
  if (classrooms.length === 0) {
    classroomSection.append(
      emptyState('No classrooms yet. Make one and read its join code to the room.', createPill),
    );
  } else {
    const list = el('ul', { class: 'qy-classroom-grid', 'aria-label': 'Classrooms' });
    for (const classroom of classrooms) {
      list.append(
        el('li', { class: 'qy-card qy-classroom-card' }, [
          el('a', { href: `/classrooms/${classroom.id}`, class: 'qy-card-label qy-link', text: classroom.name }),
          el('p', { class: 'qy-state-label', text: STATE_LABEL[classroom.state] }),
          el('p', {
            class: 'qy-card-meta qy-figures',
            text: `${classroom.students.length} ${classroom.students.length === 1 ? 'student' : 'students'}`,
          }),
        ]),
      );
    }
    classroomSection.append(list, el('div', { class: 'qy-pill-row' }, [createPill]));
  }

  const projectsSection = el('section', { class: 'qy-block' }, [sectionHeading('My projects')]);
  if (projects.length === 0) {
    projectsSection.append(
      emptyState(
        'Nothing designed yet. Open the 3D Workshop and make something you can hold.',
        el('a', { href: '/editor/new?kind=3d', class: 'qy-pill qy-pill-solid qy-pill-3d', text: 'New 3D design' }),
      ),
    );
  } else {
    projectsSection.append(projectCards(projects, browserZone()));
  }

  const exportsSection = el('section', { class: 'qy-block' }, [sectionHeading('My exports'), exportsList(exports)]);

  main.append(
    el('div', { class: 'qy-column qy-stack' }, [
      el('h1', { class: 'qy-page-heading', text: `Welcome back, ${current.displayName}` }),
      classroomSection,
      el('section', { class: 'qy-block' }, [sectionHeading('Start making'), editorLaunchPills()]),
      projectsSection,
      exportsSection,
    ]),
  );
};
