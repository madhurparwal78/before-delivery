import { get, send } from '../api.js';
import { el, svg } from '../dom.js';
import { session } from '../session.js';
import { navigate } from '../shell.js';
import { focusFirst, openDialog } from '../ui/dialog.js';
import { categoricalColor, rgbCss } from '../../shared/chart.js';

interface WorkbookCard {
  id: string;
  name: string;
  project: string;
  project_name: string;
  state: string;
  certified_by: string | null;
}

interface ProjectDoc {
  id: string;
  name: string;
  sources: { id: string; name: string }[];
}

function thumbnail(seed: string): SVGSVGElement {
  let hash = 7;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  const root = svg('svg', { class: 'thumb', width: 96, height: 56, viewBox: '0 0 96 56', 'aria-hidden': 'true' });
  for (let i = 0; i < 4; i += 1) {
    const height = 12 + ((hash >> (i * 3)) % 5) * 9;
    root.append(
      svg('rect', {
        x: 6 + i * 22,
        y: 52 - height,
        width: 16,
        height,
        rx: 6,
        fill: rgbCss(categoricalColor(i)),
        stroke: 'rgb(26,10,20)',
        'stroke-width': 1.5,
      }),
    );
  }
  return root;
}

export async function workbooksPage(host: HTMLElement): Promise<void> {
  document.body.dataset.field = 'ground';
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements', class: 'status' });
  const newButton = el('button', { type: 'button', class: 'pill-button primary', text: 'New workbook' });
  const list = el('div', { class: 'workbook-list' });
  host.append(el('div', { class: 'page' }, [el('h1', { text: 'Workbooks' }), newButton, status, list]));

  const res = await get<WorkbookCard[]>('/api/workbooks');
  const workbooks = res.status === 200 ? res.data : [];
  if (workbooks.length === 0) {
    list.append(el('p', { class: 'empty-headline', text: 'No workbooks yet.' }));
  }
  for (const workbook of workbooks) {
    const card = el('article', { class: 'card workbook-card' }, [
      thumbnail(workbook.id + workbook.name) as unknown as HTMLElement,
      el('div', { class: 'workbook-card-body' }, [
        el('h2', {}, [el('a', { href: `/workbooks/${workbook.id}`, text: workbook.name })]),
        el('p', { class: 'muted', text: workbook.project_name }),
        el('p', { class: 'state', text: workbook.state === 'published' ? 'Published' : 'Draft' }),
        workbook.certified_by === null
          ? null
          : el('p', { class: 'certified', text: `Certified by ${workbook.certified_by}` }),
      ]),
    ]);
    list.append(card);
  }

  newButton.addEventListener('click', () => {
    const nameInput = el('input', { type: 'text', id: 'wb-name', class: 'input' });
    const projectSelect = el('select', { id: 'wb-project', class: 'input' });
    const sourceSelect = el('select', { id: 'wb-source', class: 'input' });
    const error = el('p', { class: 'field-error' });
    const creatorProjects = (session.me?.projects ?? []).filter((p) => p.role === 'creator');
    for (const project of creatorProjects) {
      projectSelect.append(el('option', { value: project.id, text: project.name }));
    }
    const loadSources = async (): Promise<void> => {
      sourceSelect.replaceChildren();
      const projectId = projectSelect.value;
      if (projectId === '') return;
      const projectRes = await get<ProjectDoc>(`/api/projects/${projectId}`);
      if (projectRes.status !== 200) return;
      for (const source of projectRes.data.sources) {
        sourceSelect.append(el('option', { value: source.id, text: source.name }));
      }
    };
    projectSelect.addEventListener('change', () => {
      void loadSources();
    });

    const create = el('button', { type: 'button', class: 'pill-button primary', text: 'Create workbook' });
    const dialog = openDialog({ name: 'New workbook', opener: newButton });
    dialog.body.append(
      el('label', { for: 'wb-name', text: 'Workbook name' }),
      nameInput,
      error,
      el('label', { for: 'wb-project', text: 'Project' }),
      projectSelect,
      el('label', { for: 'wb-source', text: 'Source' }),
      sourceSelect,
      create,
    );
    create.addEventListener('click', () => {
      void (async () => {
        const res2 = await send<{ id: string }>('POST', `/api/projects/${projectSelect.value}/workbooks`, {
          name: nameInput.value,
          source: sourceSelect.value,
        });
        if (res2.status === 201) {
          dialog.close();
          navigate(`/workbooks/${res2.data.id}`);
          return;
        }
        error.textContent = 'Name is required.';
      })();
    });
    void loadSources();
    focusFirst(dialog);
  });
}
