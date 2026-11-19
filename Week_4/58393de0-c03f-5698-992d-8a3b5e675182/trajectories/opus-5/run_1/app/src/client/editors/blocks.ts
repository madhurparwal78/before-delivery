import type { ProgramBlock, SceneObject, Snapshot, SnapshotBlocks } from '../../shared/types.js';
import { UI_COPY } from '../../shared/copy.js';
import { el, reducedMotion } from '../dom.js';
import { say } from '../status.js';
import { timers } from '../runtime.js';
import { stillSvg } from '../gl/still.js';
import { BLOCK_LABELS, applyStep, emptyRunState, flattenProgram, STEP_LIMIT } from '../blocks/runner.js';
import type { EditorBody, EditorHooks } from './editor-kinds.js';

type Path = number[];

const PALETTE: ProgramBlock['block'][] = [
  'addBox',
  'addCylinder',
  'addSphere',
  'moveX',
  'moveY',
  'moveZ',
  'makeHole',
  'repeat',
];

const cloneProgram = (program: ProgramBlock[]): ProgramBlock[] =>
  program.map((block) => ({ ...block, body: block.body ? cloneProgram(block.body) : undefined }));

const listAt = (program: ProgramBlock[], path: Path): ProgramBlock[] => {
  let blocks = program;
  for (const index of path) {
    const block = blocks[index];
    if (!block || !block.body) return blocks;
    blocks = block.body;
  }
  return blocks;
};

/** The Block Lab: a palette, a program with an insertion point, and a stepped run. */
export const createBlockLab = (snapshot: SnapshotBlocks, hooks: EditorHooks): EditorBody => {
  let program = cloneProgram(snapshot.program);
  let objects: SceneObject[] = snapshot.objects.map((object) => ({ ...object }));
  let readOnly = false;
  let running = false;
  let stepTimer = 0;
  let insertion: { path: Path; index: number } = { path: [], index: program.length };
  const history: ProgramBlock[][] = [];
  const future: ProgramBlock[][] = [];

  const hidden = el('div', {
    id: 'qy-blocks-scene',
    class: 'qy-sr-only',
    'data-state': 'idle',
    'data-step': '0',
  });
  const programList = el('ul', { class: 'qy-program', 'aria-label': 'Program' });
  const viewerHolder = el('section', { class: 'qy-blocks-viewer', role: 'region', 'aria-label': 'Block Lab viewer' });
  const playButton = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Play' });
  const stopButton = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Stop' });

  const pushHistory = (): void => {
    history.push(cloneProgram(program));
    if (history.length > 100) history.shift();
    future.length = 0;
  };

  const paintViewer = (step: number, state: 'idle' | 'running' | 'done'): void => {
    hidden.dataset.state = state;
    hidden.dataset.step = String(step);
    hidden.dataset.meshCount = String(objects.length);
    hidden.dataset.sphereCount = String(objects.filter((object) => object.kind === 'sphere').length);
    hidden.replaceChildren();
    for (const object of objects) {
      const child = el('div');
      child.dataset.objectId = object.id;
      child.dataset.kind = object.kind;
      child.dataset.mode = object.mode;
      child.dataset.x = String(object.x);
      child.dataset.y = String(object.y);
      child.dataset.z = String(object.z);
      child.dataset.w = String(object.w);
      child.dataset.d = String(object.d);
      child.dataset.h = String(object.h);
      child.dataset.rotationZ = String(object.rotationZ);
      child.dataset.volume = String(Math.round(volumeOf(object)));
      hidden.append(child);
    }
    viewerHolder.replaceChildren(
      el('h2', { class: 'qy-panel-heading', text: 'Block Lab viewer' }),
      el('div', { class: 'qy-blocks-stage', html: stillSvg(objects, { width: 320, height: 260 }) }),
      hidden,
    );
  };

  const volumeOf = (object: SceneObject): number => {
    if (object.mode === 'hole') return 0;
    if (object.kind === 'box') return object.w * object.d * object.h;
    if (object.kind === 'cylinder') return Math.PI * (object.w / 2) ** 2 * object.h;
    return (4 / 3) * Math.PI * (object.w / 2) ** 3;
  };

  const sameInsertion = (path: Path, index: number): boolean =>
    insertion.index === index && insertion.path.length === path.length && insertion.path.every((value, at) => value === path[at]);

  const renderBlocks = (blocks: ProgramBlock[], path: Path, host: HTMLElement): void => {
    blocks.forEach((block, index) => {
      if (sameInsertion(path, index)) host.append(el('li', { class: 'qy-insertion', 'aria-hidden': 'true' }));
      const item = el('li', { class: 'qy-block', tabindex: '0', 'aria-label': BLOCK_LABELS[block.block] });
      item.append(el('span', { class: 'qy-block-label', text: BLOCK_LABELS[block.block] }));
      if (block.block === 'repeat') {
        const count = el('input', {
          class: 'qy-input qy-input-small',
          'aria-label': 'Repeat count',
          value: String(block.count ?? 3),
        });
        count.addEventListener('input', () => {
          const value = Number(count.value);
          if (!Number.isFinite(value) || value < 1 || value > 50) return;
          pushHistory();
          const list = listAt(program, path);
          list[index] = { ...block, count: value };
          hooks.onEdit();
        });
        item.append(count);
      }
      if (block.block === 'moveX' || block.block === 'moveY' || block.block === 'moveZ') {
        const axis = block.block.slice(-1);
        const mm = el('input', {
          class: 'qy-input qy-input-small',
          'aria-label': `Move ${axis} by (mm)`,
          value: String(block.mm ?? 10),
        });
        mm.addEventListener('input', () => {
          const value = Number(mm.value);
          if (!Number.isFinite(value) || value < -500 || value > 500) return;
          pushHistory();
          const list = listAt(program, path);
          list[index] = { ...block, mm: value };
          hooks.onEdit();
        });
        item.append(mm);
      }
      const remove = el('button', { type: 'button', class: 'qy-tool', text: 'Delete block', 'aria-label': 'Delete block' });
      remove.addEventListener('click', () => deleteBlock(path, index));
      item.append(remove);
      item.addEventListener('keydown', (event) => onBlockKey(event, path, index, item));
      host.append(item);
      if (block.block === 'repeat') {
        const nested = el('ul', { class: 'qy-repeat-body', 'aria-label': 'Repeat body' });
        renderBlocks(block.body ?? [], [...path, index], nested);
        host.append(el('li', { class: 'qy-block-nest' }, [nested]));
      }
    });
    if (sameInsertion(path, blocks.length)) host.append(el('li', { class: 'qy-insertion', 'aria-hidden': 'true' }));
  };

  const paintProgram = (): void => {
    programList.replaceChildren();
    renderBlocks(program, [], programList);
  };

  const onBlockKey = (event: KeyboardEvent, path: Path, index: number, item: HTMLElement): void => {
    const block = listAt(program, path)[index];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const all = [...programList.querySelectorAll<HTMLElement>('.qy-block')];
      const at = all.indexOf(item);
      const next = all[event.key === 'ArrowDown' ? at + 1 : at - 1];
      next?.focus();
      return;
    }
    if (event.key === 'ArrowRight' && block?.block === 'repeat') {
      event.preventDefault();
      insertion = { path: [...path, index], index: (block.body ?? []).length };
      paintProgram();
      return;
    }
    if (event.key === 'ArrowLeft' && path.length > 0) {
      event.preventDefault();
      const enclosing = path[path.length - 1];
      insertion = { path: path.slice(0, -1), index: enclosing + 1 };
      paintProgram();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteBlock(path, index);
    }
  };

  const deleteBlock = (path: Path, index: number): void => {
    if (readOnly || running) return;
    pushHistory();
    const list = listAt(program, path);
    list.splice(index, 1);
    insertion = { path, index: Math.min(index, list.length) };
    paintProgram();
    hooks.onEdit();
  };

  const insertBlock = (name: ProgramBlock['block']): void => {
    if (readOnly || running) return;
    pushHistory();
    const block: ProgramBlock = { block: name };
    if (name === 'repeat') {
      block.count = 3;
      block.body = [];
    }
    if (name === 'moveX' || name === 'moveY' || name === 'moveZ') block.mm = 10;
    const list = listAt(program, insertion.path);
    list.splice(insertion.index, 0, block);
    insertion = { path: insertion.path, index: insertion.index + 1 };
    paintProgram();
    hooks.onEdit();
  };

  const palette = el(
    'div',
    { class: 'qy-toolbar qy-palette', role: 'toolbar', 'aria-label': 'Blocks palette' },
    PALETTE.map((name) => {
      const control = el('button', { type: 'button', class: 'qy-tool', text: BLOCK_LABELS[name], draggable: true });
      control.addEventListener('click', () => insertBlock(name));
      control.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', name);
      });
      return control;
    }),
  );

  const stopRun = (announceStop: boolean): void => {
    window.clearTimeout(stepTimer);
    running = false;
    if (announceStop) say(UI_COPY.programStopped);
    paintViewer(Number(hidden.dataset.step ?? '0'), 'done');
  };

  const play = (): void => {
    if (running) return;
    const { steps, hitLimit } = flattenProgram(program);
    running = true;
    let state = emptyRunState();
    objects = [];
    paintViewer(0, 'running');
    if (reducedMotion()) {
      for (const step of steps) state = applyStep(state, step);
      objects = state.objects;
      running = false;
      paintViewer(steps.length, 'done');
      if (hitLimit) say(UI_COPY.programStepLimit);
      else say(UI_COPY.programFinished(objects.length));
      hooks.onEdit();
      return;
    }
    let at = 0;
    const next = (): void => {
      if (!running) return;
      if (at >= steps.length) {
        running = false;
        paintViewer(at, 'done');
        if (hitLimit) say(UI_COPY.programStepLimit);
        else say(UI_COPY.programFinished(objects.length));
        hooks.onEdit();
        return;
      }
      state = applyStep(state, steps[at]);
      objects = state.objects;
      at += 1;
      paintViewer(at, 'running');
      if (at >= STEP_LIMIT + 1) {
        running = false;
        say(UI_COPY.programStepLimit);
        return;
      }
      stepTimer = window.setTimeout(next, timers().blocksStepMs);
    };
    stepTimer = window.setTimeout(next, timers().blocksStepMs);
  };

  // Pointer users drag palette blocks into the Program.
  programList.addEventListener('dragover', (event) => event.preventDefault());
  programList.addEventListener('drop', (event) => {
    event.preventDefault();
    const name = event.dataTransfer?.getData('text/plain') as ProgramBlock['block'] | undefined;
    if (name && PALETTE.includes(name)) insertBlock(name);
  });

  playButton.addEventListener('click', play);
  stopButton.addEventListener('click', () => stopRun(true));

  const element = el('div', { class: 'qy-editor-blocks' }, [
    el('div', { class: 'qy-editor-left' }, [palette, el('div', { class: 'qy-pill-row' }, [playButton, stopButton])]),
    el('section', { class: 'qy-panel qy-program-panel' }, [
      el('h2', { class: 'qy-panel-heading', text: 'Program' }),
      programList,
    ]),
    viewerHolder,
  ]);

  paintProgram();
  paintViewer(0, 'idle');

  return {
    element,
    snapshot: (): Snapshot => ({ kind: 'blocks', program: cloneProgram(program), objects }),
    undo: () => {
      const step = history.pop();
      if (!step) return;
      future.push(cloneProgram(program));
      program = step;
      paintProgram();
      hooks.onEdit();
    },
    redo: () => {
      const step = future.pop();
      if (!step) return;
      history.push(cloneProgram(program));
      program = step;
      paintProgram();
      hooks.onEdit();
    },
    setReadOnly: (next) => {
      readOnly = next;
      if (next) {
        for (const control of element.querySelectorAll('button, input')) control.setAttribute('disabled', '');
      }
    },
    loadSnapshot: (next) => {
      if (next.kind !== 'blocks') return;
      program = cloneProgram(next.program);
      objects = next.objects.map((object) => ({ ...object }));
      paintProgram();
      paintViewer(0, 'idle');
    },
    exportObjects: () => objects.map((object) => ({ ...object })),
    focus: () => playButton.focus(),
    stop: () => window.clearTimeout(stepTimer),
  };
};
