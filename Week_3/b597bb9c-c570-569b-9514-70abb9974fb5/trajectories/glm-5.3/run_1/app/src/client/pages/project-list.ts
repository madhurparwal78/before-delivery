import { api } from '../api';
import { el, announce } from '../ui';
import { renderBand, setEditorVisible } from '../main';
import type { Project, Clip } from '../../shared/types';
import { timecode, aspectSize } from '../../shared/frames';
import { fittedBox, layerValuesAt, baseDefaults, textBox } from '../../shared/keyframes';
import { reducedMotion } from '../ui';

/** The project list: the text band, then the sheet of project runs. */
export async function renderProjectList(root: HTMLElement): Promise<HTMLElement> {
  setEditorVisible(true);
  const main = el('main', null);
  main.append(renderBand(root), noticesStrip());
  const { items } = await api.projects();
  // The index preview sits in the band and shows the hovered project.
  const indexPreview = el('div', { 'data-index-preview': '', style: 'padding: 0 14px; min-height: 20px;' });
  indexPreview.hidden = true;
  main.append(indexPreview);
  const sheet = el('div', { class: 'sheet' });
  const region = el('section', { role: 'region', 'aria-label': 'Projects' });
  if (items.length === 0) {
    region.append(el('p', { class: 'empty', text: 'No projects yet. Start one with New project.' }));
  }
  const mediaDims = new Map<string, { width: number; height: number; sha: string }>();
  try {
    const media = await api.media('');
    for (const item of media.items) {
      if (item.width !== null && item.height !== null) {
        mediaDims.set(item.id, { width: item.width, height: item.height, sha: item.sha256 });
      }
    }
  } catch {
    // The sheet still draws with fallback colours.
  }
  for (const project of items) {
    let clips: Clip[] = [];
    try {
      clips = (await api.project(project.id)).clips;
    } catch {
      clips = [];
    }
    const run = el('div', { class: 'run' });
    const group = el('div', { role: 'group', 'aria-label': project.title, 'data-role': project.role });
    const title = el('h2');
    const link = el('a', { href: `/projects/${project.id}`, text: project.title });
    title.append(link, el('span', { class: 'muted', text: ` ${project.role}` }));
    group.append(title);
    for (const marker of project.markers) {
      const frame = drawFrame(project, marker.frame, clips, mediaDims);
      const alt = `${project.title} at ${timecode(marker.frame, project.frame_rate)}`;
      frame.setAttribute('role', 'img');
      frame.setAttribute('aria-label', alt);
      frame.setAttribute('data-sheet-frame', String(marker.frame));
      frame.setAttribute('data-project-id', project.id);
      const holder = el('span', { class: 'frame' });
      holder.append(frame);
      group.append(holder);
    }
    run.append(group);
    // Hovering a run dims every other run and shows this project's
    // description and last-cut timecode in the index preview.
    const showPreview = (): void => {
      indexPreview.hidden = false;
      indexPreview.textContent = `${project.description} · last cut ${project.last_cut === null ? '—' : project.last_cut.name}`;
      for (const other of region.querySelectorAll<HTMLElement>('.run')) {
        if (other !== run) other.style.opacity = '0.3';
      }
    };
    const hidePreview = (): void => {
      indexPreview.hidden = true;
      for (const other of region.querySelectorAll<HTMLElement>('.run')) {
        other.style.opacity = '';
      }
    };
    run.addEventListener('pointerenter', showPreview);
    run.addEventListener('pointerleave', hidePreview);
    link.addEventListener('focus', showPreview);
    link.addEventListener('blur', hidePreview);
    run.style.transition = reducedMotion() ? 'none' : 'opacity 120ms linear';
    region.append(run);
  }
  sheet.append(region);
  main.append(sheet);
  const newProject = el('a', { class: 'btn primary fixed-new-project', href: '#new-project', text: 'New project', style: 'position: fixed; right: 14px; bottom: 14px; z-index: 20; text-decoration: none; padding: 10px 16px;' });
  main.append(newProject);
  newProject.addEventListener('click', (event) => {
    event.preventDefault();
    openNewProjectDialog(main);
  });
  return main;
}

/** One procedural frame: the marker frame's layer boxes in checksum colours. */
function drawFrame(project: Project, frame: number, clips: Clip[], mediaDims: Map<string, { width: number; height: number; sha: string }>): HTMLCanvasElement {
  const size = aspectSize(project.aspect_ratio);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = Math.round((320 * size.height) / size.width);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  ctx.fillStyle = '#241d16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const defaults = baseDefaults(size.width, size.height);
  const drawn = clips
    .filter((clip) => !clip.hidden && frame >= clip.start_frame && frame < clip.end_frame);
  for (const clip of drawn) {
    const values = layerValuesAt(clip.keyframes, frame - clip.start_frame, defaults);
    let boxW = size.width;
    let boxH = size.height;
    let colour = '#a89b8a';
    if (clip.kind === 'text') {
      const tb = textBox(size.width, size.height);
      boxW = tb.width;
      boxH = tb.height;
      colour = `#${clip.box_colour ?? 'a89b8a'}`;
    } else if (clip.media_id !== null && mediaDims.has(clip.media_id)) {
      const dims = mediaDims.get(clip.media_id)!;
      const ratio = Math.min(size.width / dims.width, size.height / dims.height);
      boxW = ratio * dims.width;
      boxH = ratio * dims.height;
      colour = `#${dims.sha.slice(0, 6)}`;
    }
    const fitted = fittedBox(boxW, boxH, size.width, size.height, values.scale, values.x, values.y);
    const sx = canvas.width / size.width;
    const sy = canvas.height / size.height;
    ctx.globalAlpha = values.opacity / 100;
    ctx.fillStyle = colour;
    ctx.fillRect(fitted.x * sx, fitted.y * sy, fitted.width * sx, fitted.height * sy);
    ctx.globalAlpha = 1;
  }
  return canvas;
}

function noticesStrip(): HTMLElement {
  return el('div', { role: 'status', 'aria-label': 'Notices', id: 'status-notices', class: 'notices' });
}

function openNewProjectDialog(main: HTMLElement): void {
  const opener = document.activeElement as HTMLElement | null;
  const overlay = el('div', { class: 'overlay' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New project' });
  const title = el('h2', { text: 'New project' });
  const errorSummary = el('div', { class: 'error-summary', hidden: 'hidden' });
  const fields: Record<string, HTMLElement> = {};
  const body: Record<string, string> = { title: '', agency: '', description: '' };
  const form = el('form', null);
  for (const [label, tag, name] of [
    ['Title', 'input', 'title'],
    ['Agency', 'input', 'agency'],
    ['Description', 'input', 'description'],
  ] as const) {
    const input = el('input', { type: 'text', 'aria-label': label, name });
    const field = el('label', { class: 'field' });
    field.append(el('span', { text: label }), input);
    form.append(field);
    fields[name] = input;
  }
  const rates = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'];
  const rate = select('Frame rate', 'frame_rate', rates);
  const aspects = ['16:9', '9:16', '1:1', '4:5'];
  const aspect = select('Aspect ratio', 'aspect_ratio', aspects);
  form.append(rate.field, aspect.field);
  const create = el('button', { class: 'btn primary', type: 'submit', text: 'Create project' });
  const cancel = el('button', { class: 'btn', type: 'button', text: 'Cancel' });
  const row = el('div', { class: 'row' });
  row.append(create, cancel);
  form.append(row);
  dialog.append(title, errorSummary, form);
  overlay.append(dialog);
  document.body.append(overlay);
  (fields.title as HTMLInputElement).focus();

  const close = (): void => {
    overlay.remove();
    opener?.focus();
  };
  cancel.addEventListener('click', close);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(dialog, event);
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const created = await api.createProject({
          title: (fields.title as HTMLInputElement).value,
          agency: (fields.agency as HTMLInputElement).value,
          description: (fields.description as HTMLInputElement).value,
          frame_rate: (rate.input as HTMLSelectElement).value,
          aspect_ratio: (aspect.input as HTMLSelectElement).value,
        });
        window.location.href = `/projects/${created.project.id}`;
      } catch (err) {
        const apiErr = err as { body?: { errors?: Record<string, string> } };
        const errors = apiErr.body?.errors ?? {};
        errorSummary.textContent = '';
        errorSummary.hidden = false;
        for (const [field, message] of Object.entries(errors)) {
          const link = el('a', { href: '#', text: message });
          link.addEventListener('click', (e) => {
            e.preventDefault();
            fields[field]?.focus();
          });
          errorSummary.append(el('p', null, link));
        }
        errorSummary.focus?.();
        announce('Notices', 'Check the highlighted fields.');
        void body;
      }
    })();
  });
}

function trapTab(dialog: HTMLElement, event: KeyboardEvent): void {
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'))
    .filter((node) => !node.hasAttribute('disabled') && node.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function select(label: string, name: string, options: readonly string[]): { field: HTMLElement; input: HTMLElement } {
  const input = el('select', { 'aria-label': label, name });
  for (const option of options) {
    input.append(el('option', { value: option, text: option }));
  }
  const field = el('label', { class: 'field' });
  field.append(el('span', { text: label }), input);
  return { field, input };
}

export function frameLayers(project: Project, clips: Clip[], frame: number, shaByMedia: Map<string, string>): void {
  void project;
  void clips;
  void frame;
  void shaByMedia;
  void fittedBox;
  void layerValuesAt;
  void baseDefaults;
  void textBox;
}
