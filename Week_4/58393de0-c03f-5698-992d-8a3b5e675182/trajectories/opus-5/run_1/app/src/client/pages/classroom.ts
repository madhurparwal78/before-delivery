import type { Classroom, ExportRecord, RosterStudent, SceneObject, Snapshot } from '../../shared/types.js';
import { STATE_LABEL, UI_COPY } from '../../shared/copy.js';
import { api } from '../api.js';
import { el, icon } from '../dom.js';
import { fieldError, modalDialogsOpen, openDialog } from '../dialog.js';
import { say } from '../status.js';
import { account } from '../runtime.js';
import { navigate, onLeave } from '../router.js';
import { bytesLabel, nicknameOrder, stamp } from '../format.js';
import { onLive } from '../live.js';
import { stillSvg } from '../gl/still.js';
import { emptyState, sectionHeading } from './common.js';
import { openClassroomTimes } from './classroom-dialogs.js';
import { closeGlancet, glancetHasFocus, glancetStudentId, openGlancet, refreshGlancet } from '../glancet.js';
import { addNotice } from '../notice.js';

type SortOrder = 'nickname' | 'recent';

const snapshotArt = new Map<string, string>();

const objectsOfSnapshot = (snapshot: Snapshot): SceneObject[] => {
  if (snapshot.kind === 'circuit') {
    return snapshot.components.map((component, index) => ({
      id: component.label,
      kind: 'box' as const,
      mode: 'solid' as const,
      x: ((index % 3) - 1) * 26,
      y: (Math.floor(index / 3) - 1) * 24,
      z: 6,
      w: 20,
      d: 12,
      h: 12,
      rotationZ: 0,
      color: component.type === 'led' ? '#f08a24' : component.type === 'battery' ? '#3fa34d' : '#2f80ed',
      children: [],
    }));
  }
  return snapshot.objects;
};

export const classroomPage = async (main: HTMLElement, url: URL): Promise<void> => {
  const current = account();
  if (!current) {
    navigate('/signin');
    return;
  }
  const id = url.pathname.split('/')[2];
  const result = await api.classroom(id);
  if (!result.ok) {
    main.append(
      el('div', { class: 'qy-column qy-empty' }, [
        el('h1', { text: result.code === 'forbidden' ? 'Not found.' : 'Not found.' }),
        el('a', { href: '/dashboard', class: 'qy-pill qy-pill-solid', text: 'Back to your dashboard' }),
      ]),
    );
    say(result.message);
    return;
  }

  let classroom: Classroom = result.value;
  let students: RosterStudent[] = [...classroom.students];
  let sortOrder: SortOrder = 'nickname';
  const isOwner = classroom.role === 'owner';

  const heading = el('h1', { class: 'qy-page-heading', text: classroom.name, tabindex: '-1' });
  const stateLabel = el('p', { class: 'qy-state-label', text: STATE_LABEL[classroom.state] });
  const joinWindowLine = el('p', { class: 'qy-muted qy-figures' });
  const handInLine = el('p', { class: 'qy-muted qy-figures' });
  const rosterList = el('ul', { class: 'qy-roster', 'aria-label': 'Classroom roster' });
  const rosterHolder = el('div', { class: 'qy-roster-holder' });
  const instructorsList = el('ul', { class: 'qy-instructors', 'aria-label': 'Instructors' });
  const filesList = el('ul', { class: 'qy-files', 'aria-label': 'Hand-in files' });

  const writeTimes = (): void => {
    joinWindowLine.textContent = UI_COPY.joinWindow(
      classroom.joinOpensLocal.replace('T', ' '),
      classroom.joinClosesLocal.replace('T', ' '),
      classroom.timeZone,
    );
    handInLine.textContent = UI_COPY.handInLine(classroom.handInLocal.replace('T', ' '), classroom.timeZone);
    stateLabel.textContent = STATE_LABEL[classroom.state];
  };

  const joinCodeButton = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Show join code' });

  const sortedStudents = (): RosterStudent[] => {
    const byNickname = (left: RosterStudent, right: RosterStudent): number => {
      const order = nicknameOrder(left.nickname, right.nickname);
      return order !== 0 ? order : left.id < right.id ? -1 : 1;
    };
    if (sortOrder === 'nickname') return [...students].sort(byNickname);
    return [...students].sort((left, right) => {
      const leftAt = left.latestProject?.savedAt ?? null;
      const rightAt = right.latestProject?.savedAt ?? null;
      if (leftAt === null && rightAt === null) return byNickname(left, right);
      if (leftAt === null) return 1;
      if (rightAt === null) return -1;
      if (leftAt === rightAt) return byNickname(left, right);
      return leftAt < rightAt ? 1 : -1;
    });
  };

  const loadArt = async (student: RosterStudent, holder: HTMLElement): Promise<void> => {
    const project = student.latestProject;
    if (!project) {
      holder.innerHTML = stillSvg([], { width: 240, height: 150 });
      return;
    }
    const cacheKey = `${project.id}:${project.revision}`;
    const known = snapshotArt.get(cacheKey);
    if (known) {
      holder.innerHTML = known;
      return;
    }
    const snapshot = await api.project(project.id);
    if (!snapshot.ok) return;
    const art = stillSvg(objectsOfSnapshot(snapshot.value.snapshot), { width: 240, height: 150 });
    snapshotArt.set(cacheKey, art);
    holder.innerHTML = art;
  };

  const renderRoster = (): void => {
    rosterList.replaceChildren();
    rosterHolder.replaceChildren();
    if (students.length === 0) {
      rosterHolder.append(
        emptyState('No one has joined yet. Share the join code with the room.', joinCodeButton),
      );
      return;
    }
    rosterHolder.append(rosterList);
    for (const student of sortedStudents()) {
      const art = el('div', { class: 'qy-card-art' });
      void loadArt(student, art);
      const watch = el('button', {
        type: 'button',
        class: 'qy-tile-play',
        'aria-label': `Watch ${student.nickname} live`,
      });
      watch.append(icon('playCircle'));
      const rename = el('button', {
        type: 'button',
        class: 'qy-tile-action',
        'aria-label': `Rename ${student.nickname}`,
      });
      rename.append(icon('pencil'));
      const remove = el('button', {
        type: 'button',
        class: 'qy-tile-action',
        'aria-label': `Remove ${student.nickname}`,
      });
      remove.append(icon('trash'));
      watch.addEventListener('click', () => watchStudent(student, watch));
      rename.addEventListener('click', () => openRename(student, rename));
      remove.addEventListener('click', () => openRemove(student, remove));

      const tile = el('li', { class: 'qy-card qy-tile', 'aria-label': student.nickname, 'data-student': student.id }, [
        el('div', { class: 'qy-tile-art' }, [art, watch]),
        el('p', { class: 'qy-tile-nickname', text: student.nickname }),
        el('p', {
          class: 'qy-figures qy-tile-revision',
          text: student.latestProject ? `Rev ${student.latestProject.revision}` : 'Rev 0',
        }),
        el('p', {
          class: 'qy-figures qy-tile-saved qy-muted',
          text: student.latestProject ? UI_COPY.savedAt(stamp(student.latestProject.savedAt, classroom.timeZone)) : '',
        }),
        student.handedIn ? el('p', { class: 'qy-tile-handed', text: UI_COPY.handedInLabel }) : null,
        el('div', { class: 'qy-tile-actions' }, [rename, remove]),
      ]);
      rosterList.append(tile);
    }
  };

  const watchButtonOf = (studentId: string): HTMLElement | null =>
    rosterList.querySelector<HTMLElement>(`[data-student="${studentId}"] .qy-tile-play`);

  const watchStudent = (student: RosterStudent, opener: HTMLElement): void => {
    openGlancet({ student, opener }, (returnFocus, studentId) => {
      if (returnFocus) watchButtonOf(studentId)?.focus();
    });
  };

  const openRename = (student: RosterStudent, opener: HTMLElement): void => {
    openDialog({ label: `Rename ${student.nickname}`, opener }, (dialog) => {
      const input = el('input', {
        id: 'rename-nickname',
        class: 'qy-input',
        'aria-label': 'Nickname',
        value: student.nickname,
        autocomplete: 'off',
      });
      const form = el('form', { class: 'qy-form', novalidate: true });
      form.append(
        el('h2', { class: 'qy-dialog-heading', text: `Rename ${student.nickname}` }),
        el('div', { class: 'qy-field' }, [el('label', { for: 'rename-nickname', text: 'Nickname' }), input]),
        el('div', { class: 'qy-dialog-actions' }, [
          el('button', { type: 'submit', class: 'qy-pill qy-pill-solid', text: 'Save nickname' }),
          (() => {
            const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
            cancel.addEventListener('click', dialog.close);
            return cancel;
          })(),
        ]),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void (async () => {
          fieldError(input, null);
          const renamed = await api.renameStudent(classroom.id, student.id, input.value);
          if (!renamed.ok) {
            const copy = renamed.fields?.nickname ?? renamed.message;
            fieldError(input, copy);
            say(copy);
            return;
          }
          applyRename(student.id, renamed.value.nickname);
          say(UI_COPY.renamed(renamed.value.nickname));
          dialog.close();
          rosterList
            .querySelector<HTMLElement>(`[data-student="${student.id}"] [aria-label="Rename ${renamed.value.nickname}"]`)
            ?.focus();
        })();
      });
      return [form];
    });
  };

  const openRemove = (student: RosterStudent, opener: HTMLElement): void => {
    openDialog({ label: `Remove ${student.nickname}?`, role: 'alertdialog', opener }, (dialog) => {
      const confirm = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Remove from classroom' });
      const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
      cancel.addEventListener('click', dialog.close);
      confirm.addEventListener('click', () => {
        void (async () => {
          const removed = await api.removeStudent(classroom.id, student.id);
          if (!removed.ok) {
            say(removed.message);
            return;
          }
          const landing = focusAfterRemoval(student.id);
          applyRemoval(student.id, student.nickname, false);
          say(UI_COPY.removedStudent(student.nickname));
          dialog.close();
          landing();
        })();
      });
      return [
        el('h2', { class: 'qy-dialog-heading', text: `Remove ${student.nickname}?` }),
        el('p', {
          class: 'qy-muted',
          text: 'Their projects and exports are deleted and the nickname becomes free again.',
        }),
        el('div', { class: 'qy-dialog-actions' }, [confirm, cancel]),
      ];
    });
  };

  /** Focus lands on the next tile's Watch button, the last tile's, or `Show join code`. */
  const focusAfterRemoval = (studentId: string): (() => void) => {
    const order = sortedStudents();
    const index = order.findIndex((candidate) => candidate.id === studentId);
    const next = order[index + 1] ?? order[index - 1] ?? null;
    return () => {
      if (!next) {
        joinCodeButton.focus();
        return;
      }
      watchButtonOf(next.id)?.focus();
    };
  };

  const applyRename = (studentId: string, nickname: string): void => {
    students = students.map((student) => (student.id === studentId ? { ...student, nickname } : student));
    renderRoster();
    const watching = students.find((student) => student.id === glancetStudentId());
    if (watching) refreshGlancet(watching);
  };

  const applyRemoval = (studentId: string, nickname: string, fromEvent: boolean): void => {
    const watching = glancetStudentId() === studentId;
    students = students.filter((student) => student.id !== studentId);
    const hadFocus = glancetHasFocus();
    const landing = watching ? focusAfterRemoval(studentId) : null;
    renderRoster();
    if (watching) {
      closeGlancet(false);
      say(UI_COPY.glancetRemoved(nickname, classroom.name));
      if (hadFocus) landing?.();
    }
    if (fromEvent) return;
  };

  const openJoinCode = (opener: HTMLElement): void => {
    openDialog({ label: 'Join code', opener, className: 'qy-dialog-code' }, (dialog) => {
      const codeLine = el('p', { class: 'qy-join-code', 'aria-label': `Join code ${classroom.joinCode}` });
      const paint = (): void => {
        codeLine.replaceChildren();
        for (const letter of classroom.joinCode) {
          codeLine.append(el('span', { class: 'qy-join-code-box', text: letter }));
        }
      };
      paint();
      const replace = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'New code' });
      replace.addEventListener('click', () => {
        void (async () => {
          const next = await api.newJoinCode(classroom.id);
          if (!next.ok) {
            say(next.message);
            return;
          }
          classroom = { ...classroom, joinCode: next.value.joinCode };
          paint();
          say(UI_COPY.newJoinCode);
        })();
      });
      const close = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Close' });
      close.addEventListener('click', dialog.close);
      return [
        el('h2', { class: 'qy-dialog-heading', text: 'Join code' }),
        codeLine,
        el('p', { class: 'qy-muted', text: 'Read it to the room. Children join at /join with a nickname.' }),
        el('div', { class: 'qy-dialog-actions' }, [replace, close]),
      ];
    });
  };

  joinCodeButton.addEventListener('click', () => openJoinCode(joinCodeButton));

  const editTimes = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Edit times' });
  editTimes.addEventListener('click', () =>
    openClassroomTimes(classroom, editTimes, (updated) => {
      classroom = updated;
      writeTimes();
    }),
  );

  const handInAll = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Hand in all projects' });
  handInAll.addEventListener('click', () => {
    openDialog({ label: 'Hand in all projects?', role: 'alertdialog', opener: handInAll }, (dialog) => {
      const confirm = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Hand in now' });
      const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
      cancel.addEventListener('click', dialog.close);
      confirm.addEventListener('click', () => {
        void (async () => {
          const handed = await api.handInClassroom(classroom.id);
          if (!handed.ok) {
            say(handed.message);
            dialog.close();
            return;
          }
          classroom = handed.value;
          students = [...handed.value.students];
          writeTimes();
          renderRoster();
          say(UI_COPY.handedInClassroom(classroom.name));
          dialog.close();
        })();
      });
      return [
        el('h2', { class: 'qy-dialog-heading', text: 'Hand in all projects?' }),
        el('p', { class: 'qy-muted', text: 'Every project in this classroom becomes read-only at once.' }),
        el('div', { class: 'qy-dialog-actions' }, [confirm, cancel]),
      ];
    });
  });

  const archive = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Archive classroom' });
  archive.addEventListener('click', () => {
    void (async () => {
      const archived = await api.archiveClassroom(classroom.id);
      if (!archived.ok) {
        say(archived.message);
        return;
      }
      classroom = archived.value;
      writeTimes();
    })();
  });

  const sortSelect = el('select', { class: 'qy-input qy-sort', 'aria-label': 'Sort roster' }, [
    el('option', { value: 'nickname', text: 'Nickname (A–Z)' }),
    el('option', { value: 'recent', text: 'Most recently saved' }),
  ]);
  sortSelect.value = 'nickname';
  sortSelect.addEventListener('change', () => {
    sortOrder = sortSelect.value === 'recent' ? 'recent' : 'nickname';
    renderRoster();
  });

  const assistantEmail = el('input', {
    id: 'assistant-email',
    class: 'qy-input',
    'aria-label': "Assistant's email",
    type: 'email',
    autocomplete: 'off',
  });
  const addAssistant = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Add assistant' });

  const renderInstructors = (): void => {
    instructorsList.replaceChildren();
    for (const educator of classroom.educators) {
      const row = el('li', { class: 'qy-instructor' }, [
        el('span', { text: educator.displayName }),
        el('span', { class: 'qy-muted', text: educator.email }),
        el('span', { class: 'qy-muted', text: educator.role === 'owner' ? 'Owner' : 'Assistant' }),
      ]);
      if (isOwner && educator.role === 'assistant') {
        const remove = el('button', {
          type: 'button',
          class: 'qy-pill qy-pill-quiet',
          'aria-label': `Remove ${educator.displayName}`,
          text: 'Remove',
        });
        remove.addEventListener('click', () => {
          openDialog({ label: `Remove ${educator.displayName}?`, role: 'alertdialog', opener: remove }, (dialog) => {
            const confirm = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Remove from classroom' });
            const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
            cancel.addEventListener('click', dialog.close);
            confirm.addEventListener('click', () => {
              void (async () => {
                const removed = await api.removeEducator(classroom.id, educator.id);
                if (!removed.ok) {
                  say(removed.message);
                  dialog.close();
                  return;
                }
                classroom = {
                  ...classroom,
                  educators: classroom.educators.filter((candidate) => candidate.id !== educator.id),
                };
                renderInstructors();
                dialog.close();
                assistantEmail.focus();
              })();
            });
            return [
              el('h2', { class: 'qy-dialog-heading', text: `Remove ${educator.displayName}?` }),
              el('div', { class: 'qy-dialog-actions' }, [confirm, cancel]),
            ];
          });
        });
        row.append(remove);
      }
      instructorsList.append(row);
    }
  };

  addAssistant.addEventListener('click', () => {
    void (async () => {
      fieldError(assistantEmail, null);
      const added = await api.addEducator(classroom.id, assistantEmail.value);
      if (!added.ok) {
        const copy = added.fields?.email ?? added.message;
        if (added.code === 'already_added' || added.code === 'no_such_educator') fieldError(assistantEmail, copy);
        say(copy);
        return;
      }
      classroom = { ...classroom, educators: [...classroom.educators, added.value] };
      renderInstructors();
      assistantEmail.value = '';
      say(UI_COPY.addedAssistant(added.value.displayName));
    })();
  });

  const renderFiles = (records: (ExportRecord & { nickname: string })[]): void => {
    filesList.replaceChildren();
    for (const record of records) {
      filesList.append(
        el('li', { class: 'qy-file' }, [
          el('span', { class: 'qy-file-nickname', text: record.nickname }),
          el('a', {
            href: record.downloadUrl,
            class: 'qy-link',
            text: `Download ${record.fileName}`,
            download: record.fileName,
          }),
          el('span', {
            class: 'qy-figures qy-muted',
            text: `${record.format.toUpperCase()} · ${record.unit} · ${bytesLabel(record.bytes)}`,
          }),
        ]),
      );
    }
  };

  const reloadFiles = async (): Promise<void> => {
    const files = await api.classroomExports(classroom.id);
    if (files.ok) renderFiles(files.value.exports);
  };

  const actions = el('div', { class: 'qy-pill-row' }, [joinCodeButton]);
  if (isOwner) actions.append(editTimes);
  actions.append(handInAll);
  if (isOwner) actions.append(archive);

  main.append(
    el('div', { class: 'qy-column qy-stack' }, [
      el('header', { class: 'qy-classroom-head' }, [heading, stateLabel, joinWindowLine, handInLine, actions]),
      el('section', { class: 'qy-block' }, [
        el('div', { class: 'qy-roster-head' }, [sectionHeading('Classroom roster'), sortSelect]),
        rosterHolder,
      ]),
      el('section', { class: 'qy-block', role: 'region', 'aria-label': 'Instructors' }, [
        sectionHeading('Instructors'),
        instructorsList,
        isOwner
          ? el('div', { class: 'qy-inline-form' }, [
              el('label', { for: 'assistant-email', text: "Assistant's email" }),
              assistantEmail,
              addAssistant,
            ])
          : null,
      ]),
      el('section', { class: 'qy-block', role: 'region', 'aria-label': 'Hand-in files' }, [
        sectionHeading('Hand-in files'),
        filesList,
      ]),
    ]),
  );

  writeTimes();
  renderRoster();
  renderInstructors();
  void reloadFiles();

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || modalDialogsOpen() > 0) return;
    if (glancetStudentId()) closeGlancet(true);
  };
  document.addEventListener('keydown', onEscape);

  const stops = [
    onLive('student-joined', (data) => {
      if (data.classroomId !== classroom.id) return;
      if (students.some((student) => student.id === data.student.id)) return;
      students = [...students, { ...data.student, handedIn: false, latestProject: null }];
      renderRoster();
      say(UI_COPY.studentJoined(data.student.nickname));
    }),
    onLive('student-renamed', (data) => {
      if (data.classroomId !== classroom.id) return;
      applyRename(data.studentId, data.nickname);
    }),
    onLive('student-removed', (data) => {
      if (data.classroomId !== classroom.id) return;
      applyRemoval(data.studentId, data.nickname, true);
    }),
    onLive('project-saved', (data) => {
      if (data.classroomId !== classroom.id) return;
      const student = students.find((candidate) => candidate.id === data.ownerId);
      if (!student) return;
      const latest =
        student.latestProject && student.latestProject.savedAt > data.savedAt
          ? student.latestProject
          : {
              id: data.projectId,
              kind: data.kind,
              name: data.name,
              revision: data.revision,
              savedAt: data.savedAt,
              state: 'editing' as const,
            };
      students = students.map((candidate) =>
        candidate.id === data.ownerId ? { ...candidate, latestProject: latest } : candidate,
      );
      renderRoster();
      say(UI_COPY.studentSaved(student.nickname, data.revision));
      const watching = students.find((candidate) => candidate.id === glancetStudentId());
      if (watching) refreshGlancet(watching);
    }),
    onLive('project-handed-in', (data) => {
      if (data.classroomId !== classroom.id) return;
      const student = students.find((candidate) => candidate.id === data.ownerId);
      if (!student) return;
      students = students.map((candidate) =>
        candidate.id === data.ownerId
          ? {
              ...candidate,
              handedIn: candidate.latestProject?.id === data.projectId ? true : candidate.handedIn,
              latestProject:
                candidate.latestProject && candidate.latestProject.id === data.projectId
                  ? { ...candidate.latestProject, state: 'handed_in' }
                  : candidate.latestProject,
            }
          : candidate,
      );
      renderRoster();
      say(UI_COPY.studentHandedIn(student.nickname));
      void reloadFiles();
    }),
    onLive('classroom-state', (data) => {
      if (data.classroomId !== classroom.id) return;
      classroom = { ...classroom, state: data.state, serverNow: data.serverNow, secondsToHandIn: data.secondsToHandIn };
      if (data.state === 'handed_in' || data.state === 'archived') {
        students = students.map((student) => ({
          ...student,
          handedIn: student.latestProject !== null,
          latestProject: student.latestProject ? { ...student.latestProject, state: 'handed_in' } : null,
        }));
        renderRoster();
      }
      writeTimes();
    }),
    onLive('access-ended', (data) => {
      if (data.classroomId !== classroom.id) return;
      closeGlancet(false);
      addNotice({ id: 'removed', text: data.message });
    }),
  ];

  onLeave(() => {
    document.removeEventListener('keydown', onEscape);
    closeGlancet(false);
    for (const stop of stops) stop();
  });

  heading.focus();
};
