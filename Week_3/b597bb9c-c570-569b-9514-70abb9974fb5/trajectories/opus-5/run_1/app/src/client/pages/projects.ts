/** The project list: the text band over a sheet of procedural frames. */
import { ApiCallError, get, post } from '../api.js';
import { fieldValue, openDialog, selectField, textField } from '../dialog.js';
import { el, find, findAll, prefersReducedMotion } from '../dom.js';
import { bandLinks, loadAllowance, loadStatus, mount, notice, noticesStrip, renderOutages, shared } from '../shell.js';
import { frameTimecode, loadMediaIndex, procedualFrame, type MediaIndex, type ProjectDetail } from '../sheet.js';
import { ASPECT_RATIOS, type ProjectRecord } from '../../shared/types.js';
import { FRAME_RATES } from '../../domain/rate.js';

interface Loaded {
  projects: ProjectRecord[];
  details: Map<string, ProjectDetail>;
  media: MediaIndex;
}

async function load(): Promise<Loaded> {
  const page = await get<{ items: ProjectRecord[] }>('/api/projects');
  shared.projects = page.items;
  const canLibrary = shared.session?.is_owner === true || page.items.some((project) => project.role === 'editor');
  const [media, ...details] = await Promise.all([
    loadMediaIndex(canLibrary),
    ...page.items.map((project) => get<ProjectDetail>(`/api/projects/${project.id}`)),
  ]);
  return {
    projects: page.items,
    details: new Map(details.map((detail) => [detail.project.id, detail])),
    media,
  };
}

function heroBand(loaded: Loaded): HTMLElement {
  const openProjects = loaded.projects.slice(0, 4);
  const agencies = [...new Set(loaded.projects.map((project) => project.agency).filter((agency) => agency !== ''))];
  const newProject = el('a', { href: '#new-project', class: 'new-project', 'data-new-project': '', text: 'New project' });
  return el('header', { class: 'band hero' }, [
    el('div', { class: 'band-grid' }, [
      el('p', { class: 'brand', text: 'Gatecut' }),
      el('p', { class: 'availability', text: shared.availability }),
      el(
        'div',
        { class: 'open-projects' },
        openProjects.map((project) => el('p', { text: project.title })),
      ),
      el(
        'div',
        { class: 'agencies' },
        agencies.map((agency) => el('p', { text: agency })),
      ),
      el('div', { class: 'band-corner' }, [bandLinks(), newProject]),
    ]),
    el('p', { class: 'band-allowance', 'data-allowance': '', text: shared.allowance?.text ?? '' }),
    el('p', { class: 'index-preview', 'data-index-preview': '' }),
  ]);
}

function run(detail: ProjectDetail, media: MediaIndex): HTMLElement {
  const project = detail.project;
  const frames = project.markers.map((marker) =>
    procedualFrame(detail, media, marker.frame, {
      label: `${project.title} at ${frameTimecode(project, marker.frame)}`,
    }),
  );
  const group = el('section', { class: 'run', role: 'group', 'aria-label': project.title, 'data-role': project.role, 'data-run': project.id }, [
    el('p', { class: 'run-title' }, [
      el('a', { href: `/projects/${project.id}`, text: project.title }),
      el('span', { class: 'muted role-word', text: ` ${project.role}` }),
    ]),
    el('div', { class: 'run-frames' }, frames),
  ]);
  const preview = (): void => {
    const lastCut = project.last_cut;
    const line = find<HTMLElement>('[data-index-preview]');
    if (line !== null) {
      const stamp = lastCut === null ? '' : ` · ${frameTimecode(project, Math.max(0, lastCut.total_frames - 1))}`;
      line.textContent = `${project.description}${stamp}`;
    }
    for (const other of findAll<HTMLElement>('[data-run]')) {
      other.classList.toggle('dimmed', other !== group);
      if (prefersReducedMotion()) other.style.transition = 'none';
    }
  };
  const restore = (): void => {
    const line = find<HTMLElement>('[data-index-preview]');
    if (line !== null) line.textContent = '';
    for (const other of findAll<HTMLElement>('[data-run]')) other.classList.remove('dimmed');
  };
  group.addEventListener('pointerenter', preview);
  group.addEventListener('pointerleave', restore);
  const titleLink = find<HTMLElement>('.run-title a', group);
  titleLink?.addEventListener('focus', preview);
  titleLink?.addEventListener('blur', restore);
  return group;
}

function newProjectDialog(opener: HTMLElement | null): void {
  const handle = openDialog(
    'New project',
    [
      textField('title', 'Title'),
      textField('agency', 'Agency'),
      textField('description', 'Description'),
      selectField('frame_rate', 'Frame rate', [...FRAME_RATES], '25'),
      selectField('aspect_ratio', 'Aspect ratio', [...ASPECT_RATIOS], '16:9'),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-create': '', text: 'Create project' }),
        el('button', { type: 'button', 'data-cancel': '', text: 'Cancel' }),
      ]),
    ],
    opener,
  );
  find<HTMLButtonElement>('[data-cancel]', handle.dialog)?.addEventListener('click', handle.close);
  find<HTMLButtonElement>('[data-create]', handle.dialog)?.addEventListener('click', () => {
    void post<ProjectRecord>('/api/projects', {
      title: fieldValue(handle.dialog, 'title'),
      agency: fieldValue(handle.dialog, 'agency'),
      description: fieldValue(handle.dialog, 'description'),
      frame_rate: fieldValue(handle.dialog, 'frame_rate'),
      aspect_ratio: fieldValue(handle.dialog, 'aspect_ratio'),
    })
      .then((project) => {
        handle.close();
        window.location.assign(`/projects/${project.id}`);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) {
          handle.errorSummary(error.failure.errors ?? { title: error.failure.message });
          notice(error.failure.message);
        }
      });
  });
}

export async function renderProjects(): Promise<void> {
  await Promise.all([loadAllowance(), loadStatus(), loadProfile()]);
  const loaded = await load();
  const sheet = el('main', { class: 'sheet-area', 'data-layout': 'list' }, [
    el('div', { class: 'ground-gap' }),
    loaded.projects.length === 0
      ? el('p', { class: 'empty', text: 'No projects yet. Start one with New project.' })
      : el(
          'section',
          { class: 'sheet', role: 'region', 'aria-label': 'Projects' },
          loaded.projects.map((project) => {
            const detail = loaded.details.get(project.id);
            return detail === undefined ? null : run(detail, loaded.media);
          }),
        ),
  ]);
  mount(heroBand(loaded), noticesStrip(), sheet);
  renderOutages();
  const opener = find<HTMLElement>('[data-new-project]');
  opener?.addEventListener('click', (event) => {
    event.preventDefault();
    newProjectDialog(opener);
  });
}

async function loadProfile(): Promise<void> {
  try {
    const profile = await get<{ name: string; availability: string }>('/api/profile');
    shared.availability = profile.availability;
  } catch {
    shared.availability = '';
  }
}
