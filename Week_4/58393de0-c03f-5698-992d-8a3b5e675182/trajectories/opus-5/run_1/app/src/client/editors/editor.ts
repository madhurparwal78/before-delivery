import type { Project, ProjectKind, Snapshot } from '../../shared/types.js';
import { FIELD_COPY, PROJECT_NOT_FOUND, UI_COPY } from '../../shared/copy.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { openDialog } from '../dialog.js';
import { say } from '../status.js';
import { addNotice, removeNotice } from '../notice.js';
import { account } from '../runtime.js';
import { navigate, onLeave } from '../router.js';
import { countdown } from '../format.js';
import { onLive } from '../live.js';
import { defaultWorkplane } from '../geom/scene.js';
import { starterById } from '../starters.js';
import { createWorkshop3d } from './workshop3d.js';
import { createCircuitBench } from './circuit.js';
import { createBlockLab } from './blocks.js';
import { SaveEngine } from './save.js';
import { exportStateElement, openExportDialog } from './export-dialog.js';
import type { EditorBody } from './editor-kinds.js';

const NEW_NAMES: Record<ProjectKind, string> = {
  '3d': 'Untitled 3D design',
  circuit: 'Untitled circuit',
  blocks: 'Untitled block program',
};

const emptySnapshot = (kind: ProjectKind): Snapshot => {
  if (kind === '3d') return { kind: '3d', objects: [], workplane: defaultWorkplane() };
  if (kind === 'circuit') return { kind: 'circuit', components: [], wires: [] };
  return { kind: 'blocks', program: [], objects: [] };
};

const notFound = (main: HTMLElement): void => {
  say(PROJECT_NOT_FOUND);
  main.append(
    el('div', { class: 'qy-column qy-empty' }, [
      el('h1', { text: PROJECT_NOT_FOUND }),
      el('a', { href: '/', class: 'qy-pill qy-pill-solid', text: 'Quarkyard home' }),
    ]),
  );
};

export const editorPage = async (main: HTMLElement, url: URL): Promise<void> => {
  const current = account();
  if (!current) {
    navigate('/signin');
    return;
  }
  const slug = url.pathname.split('/')[2];
  const isNew = slug === 'new';
  let project: Project | null = null;
  let snapshot: Snapshot;
  let kind: ProjectKind;
  let otherOwnerName: string | null = null;

  if (isNew) {
    const asked = url.searchParams.get('kind');
    kind = asked === 'circuit' || asked === 'blocks' ? asked : '3d';
    const starter = starterById(url.searchParams.get('starter'));
    snapshot =
      kind === '3d' && starter
        ? { kind: '3d', objects: starter.objects(), workplane: defaultWorkplane() }
        : emptySnapshot(kind);
  } else {
    const loaded = await api.project(slug);
    if (!loaded.ok) {
      if (loaded.code === 'storage_unavailable') {
        addNotice({ id: 'storage-open', text: UI_COPY.openStorageDown });
        const retry = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Try again' });
        retry.addEventListener('click', () => {
          void editorPage(main, url);
        });
        main.append(
          el('div', { class: 'qy-column qy-empty' }, [
            el('h1', { text: UI_COPY.openStorageDown }),
            retry,
          ]),
        );
        return;
      }
      notFound(main);
      return;
    }
    project = loaded.value.project;
    snapshot = loaded.value.snapshot;
    kind = project.kind;
    const owned = project;
    if (owned.ownerId !== current.id && owned.classroomId) {
      const classroom = await api.classroom(owned.classroomId);
      otherOwnerName = classroom.ok
        ? (classroom.value.students.find((student) => student.id === owned.ownerId)?.nickname ?? null)
        : null;
    }
  }

  const nameInput = el('input', {
    class: 'qy-input qy-name-input',
    'aria-label': 'Project name',
    value: project ? project.name : NEW_NAMES[kind],
    autocomplete: 'off',
  });
  let committedName = nameInput.value;
  const indicator = el('span', { class: 'qy-save-indicator qy-figures' });
  const countdownLine = el('span', { class: 'qy-countdown qy-figures' });

  const undoButton = el('button', { type: 'button', class: 'qy-tool', text: 'Undo' });
  const redoButton = el('button', { type: 'button', class: 'qy-tool', text: 'Redo' });
  const saveButton = el('button', { type: 'button', class: 'qy-tool', text: 'Save' });
  const exportButton = el('button', { type: 'button', class: 'qy-tool', text: 'Export' });
  const handInButton = el('button', { type: 'button', class: 'qy-tool', text: 'Hand in' });

  const engineHolder: { engine: SaveEngine | null } = { engine: null };
  const body: EditorBody =
    kind === '3d'
      ? createWorkshop3d(snapshot.kind === '3d' ? snapshot : { kind: '3d', objects: [], workplane: defaultWorkplane() }, {
          onEdit: () => engineHolder.engine?.markEdited(),
        })
      : kind === 'circuit'
        ? createCircuitBench(snapshot.kind === 'circuit' ? snapshot : { kind: 'circuit', components: [], wires: [] }, {
            onEdit: () => engineHolder.engine?.markEdited(),
          })
        : createBlockLab(
            snapshot.kind === 'blocks' ? snapshot : { kind: 'blocks', program: [], objects: [] },
            { onEdit: () => engineHolder.engine?.markEdited() },
          );

  const engine = new SaveEngine({
    kind,
    project,
    name: () => committedName,
    snapshot: () => body.snapshot(),
    indicator,
    onRevision: () => undefined,
    onReadOnly: () => {
      body.setReadOnly(true);
      saveButton.disabled = true;
      handInButton.disabled = true;
    },
    onExternalSnapshot: (next) => body.loadSnapshot(next),
  });
  engineHolder.engine = engine;

  nameInput.addEventListener('change', () => {
    const value = nameInput.value.trim();
    if (value.length < 1 || value.length > 60) {
      nameInput.value = committedName;
      say(FIELD_COPY.name);
      return;
    }
    committedName = value;
    engine.markEdited();
  });

  undoButton.addEventListener('click', () => body.undo());
  redoButton.addEventListener('click', () => body.redo());
  saveButton.addEventListener('click', () => {
    void engine.save(true);
  });
  exportButton.addEventListener('click', () =>
    openExportDialog(
      {
        kind,
        projectId: () => engine.current?.id ?? null,
        projectName: () => committedName,
        objects: () => body.exportObjects(),
        circuit: body.circuit,
      },
      exportButton,
      () => undefined,
    ),
  );
  handInButton.addEventListener('click', () => {
    openDialog({ label: `Hand in ${committedName}?`, role: 'alertdialog', opener: handInButton }, (dialog) => {
      const confirm = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Hand in now' });
      const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
      cancel.addEventListener('click', dialog.close);
      confirm.addEventListener('click', () => {
        void (async () => {
          await engine.handIn();
          dialog.close();
        })();
      });
      return [
        el('h2', { class: 'qy-dialog-heading', text: `Hand in ${committedName}?` }),
        el('p', { class: 'qy-muted', text: 'Your instructor sees it straight away and you can no longer change it.' }),
        el('div', { class: 'qy-dialog-actions' }, [confirm, cancel]),
      ];
    });
  });

  const toolbar = el('div', { class: 'qy-editor-toolbar' }, [
    nameInput,
    indicator,
    undoButton,
    redoButton,
    saveButton,
    exportButton,
    current.kind === 'student' ? handInButton : null,
    countdownLine,
  ]);

  main.append(
    el('div', { class: 'qy-editor' }, [toolbar, body.element, exportStateElement()]),
  );

  if (otherOwnerName !== null) {
    body.setReadOnly(true);
    saveButton.disabled = true;
    handInButton.disabled = true;
    addNotice({ id: 'read-only', text: `${otherOwnerName}'s project is read-only here.` });
  }
  if (project && project.state === 'handed_in') {
    body.setReadOnly(true);
    saveButton.disabled = true;
    handInButton.disabled = true;
  }

  const kept = SaveEngine.keptEdits(project?.id ?? null, kind);
  if (kept && otherOwnerName === null) {
    addNotice({
      id: 'kept-edits',
      text: UI_COPY.keptEdits,
      actions: [
        {
          label: 'Restore',
          run: () => {
            body.loadSnapshot(kept.snapshot);
            committedName = kept.name;
            nameInput.value = kept.name;
            engine.markEdited();
            removeNotice('kept-edits');
          },
        },
        {
          label: 'Discard',
          run: () => {
            SaveEngine.discardKept(project?.id ?? null, kind);
            removeNotice('kept-edits');
          },
        },
      ],
    });
  }

  if (current.kind === 'student') {
    const view = await api.studentClass();
    if (view.ok) {
      countdownLine.textContent = countdown(view.value.secondsToHandIn);
      const stop = onLive('classroom-state', (data) => {
        if (data.classroomId !== view.value.id) return;
        countdownLine.textContent = countdown(data.secondsToHandIn);
      });
      onLeave(stop);
    }
  }

  const stopAccess = onLive('access-ended', (data) => {
    addNotice({ id: 'removed', text: data.message });
    body.setReadOnly(true);
    saveButton.disabled = true;
    void data;
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void engine.save(true);
  };
  document.addEventListener('keydown', onKeyDown);

  onLeave(() => {
    document.removeEventListener('keydown', onKeyDown);
    stopAccess();
    engine.stop();
    body.stop();
  });

  body.focus();
};
