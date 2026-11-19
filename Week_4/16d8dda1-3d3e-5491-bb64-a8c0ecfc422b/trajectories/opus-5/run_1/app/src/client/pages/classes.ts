import type { ClassDetail, ClassListItem } from '../../shared/types.js';
import { api } from '../api.js';
import { button, element, labelledInput } from '../dom.js';
import { makeDialog } from '../dialog.js';
import { internalLink, navigate, pageShell, pending } from '../shell.js';

const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')];

function zonePicker(label: string, selected?: string): { field: HTMLLabelElement; select: HTMLSelectElement } {
  const select = element('select', {});
  for (const zone of zones) {
    const option = element('option', { value: zone }, [zone]);
    if (zone === selected) option.selected = true;
    select.append(option);
  }
  const field = element('label', { class: 'field' }, [element('span', {}, [label]), select]);
  return { field, select };
}

export function classesPage(): HTMLElement {
  const shell = pageShell('wide');
  const list = element('ul', { class: 'cards', 'aria-label': 'Classes' });
  const newClass = button('New class', { class: 'primary' });
  const signOut = button('Sign out', { class: 'quiet' });

  const title = labelledInput('Title');
  const zone = zonePicker('Time zone', 'Europe/London');
  const create = button('Create class', { class: 'primary' });
  const cancel = button('Cancel', { class: 'quiet' });
  const dialogAlert = element('div', { role: 'alert', class: 'alert', hidden: true });
  const dialog = makeDialog('New class', [
    dialogAlert,
    title.field,
    zone.field,
    element('div', { class: 'row' }, [create, cancel])
  ]);

  cancel.addEventListener('click', () => dialog.close());
  newClass.addEventListener('click', () => dialog.open(newClass));
  create.addEventListener('click', () => {
    void (async () => {
      dialogAlert.hidden = true;
      pending(create, true);
      shell.setStatus('Saving...');
      const answer = await api.post<ClassDetail>('/api/classes', {
        title: title.input.value,
        timeZone: zone.select.value
      });
      pending(create, false);
      shell.setStatus('');
      if (answer.error !== null) {
        dialogAlert.hidden = false;
        dialogAlert.textContent = answer.error;
        return;
      }
      dialog.close();
      navigate(`/classes/${answer.body.id}`);
    })();
  });

  signOut.addEventListener('click', () => {
    void (async () => {
      await api.post('/api/sign-out');
      navigate('/sign-in');
    })();
  });

  shell.body.append(
    element('div', { class: 'page-head' }, [element('h1', {}, ['Your classes']), newClass, signOut]),
    list,
    dialog.root
  );

  void (async () => {
    const answer = await api.get<{ classes: ClassListItem[] }>('/api/classes');
    if (answer.error !== null) {
      shell.showError(answer.error);
      return;
    }
    for (const item of answer.body.classes) {
      list.append(
        element('li', { class: 'card' }, [
          internalLink(item.title, `/classes/${item.id}`, { class: 'card-title' }),
          element('p', { class: 'meta' }, [`Code `, element('span', { class: 'mono' }, [item.code])]),
          element('p', { class: 'meta' }, [item.timeZone]),
          element('p', { class: 'meta' }, [item.role === 'owner' ? 'Owner' : 'Co-teacher'])
        ])
      );
    }
  })();

  return shell.root;
}

export function classPage(classId: string): HTMLElement {
  const shell = pageShell('wide');
  const heading = element('h1', {}, ['']);
  const code = element('p', { class: 'meta' }, ['']);
  const roomPlan = element('div', { class: 'room-plan' });
  const roomRegion = element('section', { 'aria-label': 'Room', class: 'panel' }, [
    element('h2', {}, ['Room']),
    roomPlan,
    internalLink('Edit room', `/classes/${classId}/room`)
  ]);

  const lessonList = element('ul', { class: 'rows', 'aria-label': 'Lessons' });
  const lessonTitle = labelledInput('Lesson title');
  const addLesson = button('Add lesson', { class: 'primary' });
  const lessonsRegion = element('section', { 'aria-label': 'Lessons', class: 'panel' }, [
    element('h2', {}, ['Lessons']),
    lessonList,
    element('div', { class: 'row' }, [lessonTitle.field, addLesson])
  ]);

  const sessionList = element('ul', { class: 'rows', 'aria-label': 'Sessions' });
  const scheduleButton = button('Schedule session', { class: 'primary' });
  const sessionsRegion = element('section', { 'aria-label': 'Sessions', class: 'panel' }, [
    element('h2', {}, ['Sessions']),
    sessionList,
    scheduleButton
  ]);

  const coTeacherList = element('ul', { class: 'rows', 'aria-label': 'Co-teachers' });
  const coTeacherEmail = labelledInput('Co-teacher email', { type: 'email' });
  const addCoTeacher = button('Add co-teacher', { class: 'primary' });
  const coTeacherRegion = element('section', { 'aria-label': 'Co-teachers', class: 'panel' }, [
    element('h2', {}, ['Co-teachers']),
    coTeacherList,
    element('div', { class: 'row' }, [coTeacherEmail.field, addCoTeacher])
  ]);

  const lessonPicker = element('select', {});
  const lessonField = element('label', { class: 'field' }, [element('span', {}, ['Lesson']), lessonPicker]);
  const starts = labelledInput('Starts', { placeholder: '2027-03-09T19:00' });
  const ends = labelledInput('Ends', { placeholder: '2027-03-09T20:30' });
  const schedule = button('Schedule', { class: 'primary' });
  const scheduleCancel = button('Cancel', { class: 'quiet' });
  const scheduleAlert = element('div', { role: 'alert', class: 'alert', hidden: true });
  const scheduleZone = element('p', { class: 'meta' }, ['']);
  const scheduleDialog = makeDialog('Schedule session', [
    scheduleAlert,
    scheduleZone,
    lessonField,
    starts.field,
    ends.field,
    element('div', { class: 'row' }, [schedule, scheduleCancel])
  ]);
  scheduleCancel.addEventListener('click', () => scheduleDialog.close());
  scheduleButton.addEventListener('click', () => scheduleDialog.open(scheduleButton));

  shell.body.append(
    element('div', { class: 'page-head' }, [heading, code]),
    roomRegion,
    lessonsRegion,
    sessionsRegion,
    coTeacherRegion,
    scheduleDialog.root
  );

  const draw = (detail: ClassDetail): void => {
    heading.textContent = detail.title;
    code.replaceChildren(document.createTextNode('Class code '), element('span', { class: 'mono' }, [detail.code]));
    document.title = `${detail.title} - Slatehall`;

    roomPlan.replaceChildren();
    roomPlan.style.setProperty('--columns', String(detail.layout.columns));
    for (let row = 0; row < detail.layout.rows; row += 1) {
      for (let column = 0; column < detail.layout.columns; column += 1) {
        const piece = detail.layout.pieces.find(
          (candidate) =>
            candidate.row === row &&
            (candidate.kind === 'board'
              ? column >= candidate.column && column < candidate.column + 4
              : candidate.column === column)
        );
        roomPlan.append(element('span', { class: `plan-cell ${piece?.kind ?? 'empty'}` }));
      }
    }

    lessonList.replaceChildren();
    for (const lesson of detail.lessons) {
      lessonList.append(
        element('li', {}, [
          internalLink(lesson.title, `/lessons/${lesson.id}`),
          element('span', { class: 'meta' }, [` ${statusWord(lesson.state)}`])
        ])
      );
    }

    lessonPicker.replaceChildren();
    for (const lesson of detail.lessons) {
      lessonPicker.append(element('option', { value: lesson.id }, [lesson.title]));
    }
    scheduleZone.textContent = `Times are in ${detail.timeZone}.`;

    sessionList.replaceChildren();
    for (const session of detail.sessions) {
      sessionList.append(
        element('li', {}, [
          internalLink(`${session.startsAt.replace('T', ' ')} to ${session.endsAt.slice(11, 16)}`, `/sessions/${session.id}`),
          element('span', { class: 'meta' }, [` ${session.state}`]),
          session.state === 'ended' ? internalLink('Session summary', `/sessions/${session.id}/summary`) : null
        ])
      );
    }

    coTeacherList.replaceChildren();
    for (const teacher of detail.coTeachers) {
      coTeacherList.append(element('li', {}, [`${teacher.displayName} (${teacher.email})`]));
    }
  };

  const load = async (): Promise<void> => {
    const answer = await api.get<ClassDetail>(`/api/classes/${classId}`);
    if (answer.status === 404) {
      shell.showNotFound();
      return;
    }
    if (answer.error !== null) {
      shell.showError(answer.error);
      return;
    }
    draw(answer.body);
  };

  addLesson.addEventListener('click', () => {
    void (async () => {
      shell.showError(null);
      pending(addLesson, true);
      shell.setStatus('Saving...');
      const answer = await api.post<{ id: string }>(`/api/classes/${classId}/lessons`, {
        title: lessonTitle.input.value
      });
      pending(addLesson, false);
      shell.setStatus('');
      if (answer.error !== null) {
        shell.showError(answer.error);
        return;
      }
      navigate(`/lessons/${answer.body.id}`);
    })();
  });

  addCoTeacher.addEventListener('click', () => {
    void (async () => {
      shell.showError(null);
      pending(addCoTeacher, true);
      shell.setStatus('Saving...');
      const answer = await api.post<{ displayName: string }>(`/api/classes/${classId}/co-teachers`, {
        email: coTeacherEmail.input.value
      });
      pending(addCoTeacher, false);
      if (answer.error !== null) {
        shell.setStatus('');
        shell.showError(answer.error);
        return;
      }
      shell.setStatus(`${answer.body.displayName} can now co-teach this class.`);
      coTeacherEmail.input.value = '';
      await load();
    })();
  });

  schedule.addEventListener('click', () => {
    void (async () => {
      scheduleAlert.hidden = true;
      pending(schedule, true);
      shell.setStatus('Saving...');
      const answer = await api.post<{ id: string }>(`/api/classes/${classId}/sessions`, {
        lessonId: lessonPicker.value,
        startsAt: starts.input.value,
        endsAt: ends.input.value
      });
      pending(schedule, false);
      if (answer.error !== null) {
        shell.setStatus('');
        scheduleAlert.hidden = false;
        scheduleAlert.textContent = answer.error;
        return;
      }
      scheduleDialog.close();
      shell.setStatus('Session scheduled.');
      await load();
    })();
  });

  void load();
  return shell.root;
}

function statusWord(state: string): string {
  if (state === 'ready') return 'Status: Ready';
  if (state === 'uploading') return 'Status: Uploading';
  return 'Status: Draft';
}
