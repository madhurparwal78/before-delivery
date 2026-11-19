import type { RosterStudent, SceneObject, Snapshot } from '../shared/types.js';
import { api } from './api.js';
import { el, focusableIn, icon, isNarrow, reducedMotion } from './dom.js';
import { timers } from './runtime.js';
import { Viewer, type ViewerObject } from './gl/renderer.js';
import { stillSvg } from './gl/still.js';
import { computeGroupResult, primitiveWorldMesh } from './geom/scene.js';
import type { Mesh } from './geom/mesh.js';

export interface GlancetHost {
  student: RosterStudent;
  opener: HTMLElement;
}

interface OpenGlancet {
  studentId: string;
  close: (returnFocus: boolean) => void;
  update: (student: RosterStudent) => void;
  element: HTMLElement;
  opener: HTMLElement;
}

let open: OpenGlancet | null = null;

export const glancetStudentId = (): string | null => (open ? open.studentId : null);

export const closeGlancet = (returnFocus = true): void => {
  open?.close(returnFocus);
};

export const glancetHasFocus = (): boolean =>
  open !== null && document.activeElement !== null && open.element.contains(document.activeElement);

export const refreshGlancet = (student: RosterStudent): void => {
  if (open && open.studentId === student.id) open.update(student);
};

const positionsOf = (mesh: Mesh): Float32Array => {
  const data = new Float32Array(mesh.triangles.length * 9);
  let at = 0;
  for (const triangle of mesh.triangles) {
    for (const corner of [triangle.a, triangle.b, triangle.c]) {
      data[at] = corner[0];
      data[at + 1] = corner[1];
      data[at + 2] = corner[2];
      at += 3;
    }
  }
  return data;
};

const viewerObjects = (objects: SceneObject[]): ViewerObject[] =>
  objects.map((object) => ({
    id: object.id,
    mode: object.mode,
    color: object.color,
    positions: positionsOf(
      object.kind === 'group' ? computeGroupResult(object.children).mesh : primitiveWorldMesh(object),
    ),
  }));

const objectsOfSnapshot = (snapshot: Snapshot): SceneObject[] => {
  if (snapshot.kind === '3d') return snapshot.objects;
  if (snapshot.kind === 'blocks') return snapshot.objects;
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
};

/** The one docked viewer: `Watch <nickname> live` opens it and it keeps its place. */
export const openGlancet = (host: GlancetHost, onClosed: (returnFocus: boolean, studentId: string) => void): void => {
  if (open) open.close(false);

  const student = { ...host.student };
  const revisionLabel = el('span', { class: 'qy-figures qy-glancet-revision' });
  const nicknameLabel = el('span', { class: 'qy-glancet-nickname', text: student.nickname });
  const stage = el('div', { class: 'qy-glancet-stage' });
  const hidden = el('div', { id: 'qy-glancet-state', class: 'qy-sr-only' });

  const expand = el('button', {
    type: 'button',
    class: 'qy-glancet-button',
    'aria-label': 'Expand viewer',
    'aria-expanded': 'false',
  });
  expand.append(icon('expand'));
  const turntable = el('button', {
    type: 'button',
    class: 'qy-glancet-button',
    'aria-label': 'Pause turntable',
    'aria-pressed': reducedMotion() ? 'true' : 'false',
  });
  turntable.append(icon(reducedMotion() ? 'play' : 'pause'));
  const closeButton = el('button', { type: 'button', class: 'qy-glancet-button', 'aria-label': 'Close viewer' });
  closeButton.append(icon('close'));

  const panel = el('div', {
    class: 'qy-glancet',
    role: 'dialog',
    'aria-label': `Glancet: ${student.nickname}`,
    'data-playing': reducedMotion() ? 'false' : 'true',
    tabindex: '-1',
  });
  panel.append(
    el('div', { class: 'qy-glancet-bar' }, [nicknameLabel, revisionLabel, turntable, expand, closeButton]),
    stage,
    hidden,
  );
  if (isNarrow()) expand.style.display = 'none';
  document.body.append(panel);

  const canvas = el('canvas', { class: 'qy-glancet-canvas', 'aria-hidden': 'true' });
  stage.append(canvas);
  const viewer = new Viewer(canvas);
  let objects: SceneObject[] = [];
  let azimuth = reducedMotion() ? 45 : 0;
  let playing = !reducedMotion();
  let frame = 0;
  let fadeTimer = 0;

  const paint = (): void => {
    if (viewer.hasWebgl) {
      viewer.camera = { azimuth: (azimuth + 360) % 360, elevation: 30, distance: 180, target: [0, 0, 10] };
      viewer.render();
    } else {
      stage.innerHTML = stillSvg(objects, { width: 340, height: 170, azimuth });
    }
  };

  // A new revision swaps in place with a crossfade, or at once under reduced motion.
  const crossfade = (): void => {
    if (reducedMotion()) return;
    stage.style.transition = 'none';
    stage.style.opacity = '0.25';
    requestAnimationFrame(() => {
      stage.style.transition = 'opacity 250ms linear';
      stage.style.opacity = '1';
    });
  };

  const tick = (): void => {
    if (!playing) return;
    azimuth = (azimuth + 360 / (12 * 60)) % 360;
    paint();
    frame = requestAnimationFrame(tick);
  };

  const setPlaying = (next: boolean): void => {
    playing = next;
    panel.dataset.playing = next ? 'true' : 'false';
    turntable.setAttribute('aria-pressed', next ? 'false' : 'true');
    turntable.replaceChildren(icon(next ? 'pause' : 'play'));
    if (next) frame = requestAnimationFrame(tick);
    else cancelAnimationFrame(frame);
  };

  const close = (returnFocus: boolean): void => {
    cancelAnimationFrame(frame);
    window.clearTimeout(fadeTimer);
    panel.setAttribute('aria-hidden', 'true');
    panel.removeAttribute('role');
    hidden.remove();
    const drop = (): void => panel.remove();
    if (reducedMotion()) drop();
    else {
      panel.style.opacity = '0';
      fadeTimer = window.setTimeout(drop, timers().glancetFadeMs);
    }
    document.removeEventListener('keydown', onKeyDown, true);
    open = null;
    onClosed(returnFocus, student.id);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Expanded, the viewer is modal, so Tab stays inside it.
    if (event.key === 'Tab' && panel.classList.contains('qy-glancet-expanded')) {
      const inside = focusableIn(panel);
      if (inside.length > 0) {
        const first = inside[0];
        const last = inside[inside.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (event.key === 'F6') {
      event.preventDefault();
      if (panel.contains(document.activeElement)) host.opener.focus();
      else panel.focus();
      return;
    }
    if (event.key !== 'Escape') return;
    if (document.querySelector('.qy-backdrop')) return;
    event.preventDefault();
    close(true);
  };

  closeButton.addEventListener('click', () => close(true));
  turntable.addEventListener('click', () => setPlaying(!playing));
  expand.addEventListener('click', () => {
    const expanded = panel.classList.toggle('qy-glancet-expanded');
    expand.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    expand.setAttribute('aria-label', 'Expand viewer');
    if (expanded) panel.setAttribute('aria-modal', 'true');
    else panel.removeAttribute('aria-modal');
    paint();
  });
  document.addEventListener('keydown', onKeyDown, true);

  const load = async (next: RosterStudent): Promise<void> => {
    student.id = next.id;
    student.nickname = next.nickname;
    student.latestProject = next.latestProject;
    nicknameLabel.textContent = next.nickname;
    panel.setAttribute('aria-label', `Glancet: ${next.nickname}`);
    const revision = next.latestProject?.revision ?? 0;
    revisionLabel.textContent = `Rev ${revision}`;
    hidden.dataset.student = next.id;
    hidden.dataset.revision = String(revision);
    if (!next.latestProject) {
      objects = [];
      hidden.dataset.meshCount = '0';
      paint();
      return;
    }
    const result = await api.project(next.latestProject.id);
    if (!result.ok) {
      objects = [];
      hidden.dataset.meshCount = '0';
      paint();
      return;
    }
    objects = objectsOfSnapshot(result.value.snapshot);
    hidden.dataset.meshCount = String(objects.length);
    if (viewer.hasWebgl) viewer.setObjects(viewerObjects(objects));
    crossfade();
    paint();
  };

  open = {
    studentId: student.id,
    close,
    update: (next) => {
      void load(next);
    },
    element: panel,
    opener: host.opener,
  };

  if (!reducedMotion()) {
    panel.style.opacity = '0';
    requestAnimationFrame(() => {
      panel.style.transition = `opacity ${timers().glancetFadeMs}ms linear`;
      panel.style.opacity = '1';
    });
  }
  void load(student);
  if (playing) frame = requestAnimationFrame(tick);
  panel.focus();
};
