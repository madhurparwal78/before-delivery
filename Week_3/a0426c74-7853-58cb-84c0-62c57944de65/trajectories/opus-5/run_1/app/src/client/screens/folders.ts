import type { VersionSnapshot } from '../../shared/snapshot.js';
import { sheetSvg } from '../../shared/svgtext.js';
import { RequestFailed, api } from '../api.js';
import { button, clear, el, on } from '../dom.js';
import { toast, toastStack } from '../toasts.js';

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  role: string;
}

interface DrawingRow {
  id: string;
  name: string;
  sheets: {
    id: string;
    name: string;
    versions: { id: string; number: number; state: string; snapshot: VersionSnapshot }[];
  }[];
}

export async function foldersScreen(root: HTMLElement, navigate: (path: string) => void): Promise<void> {
  clear(root);
  const page = el('main', { class: 'folders' });
  page.append(el('h1', { class: 'display' }, ['Folders']));
  const newFolder = button('New folder');
  page.append(newFolder);
  page.append(toastStack());
  root.append(page);

  const draw = async (): Promise<void> => {
    for (const node of page.querySelectorAll('.folder')) node.remove();
    const folders = await api.get<{ folders: FolderRow[] }>('/api/folders');
    for (const folder of folders.folders) {
      const section = el('section', { class: 'folder', 'data-folder': folder.id });
      section.append(el('h2', { class: 'folder-name' }, [folder.name]));
      const drawings = await api.get<{ drawings: DrawingRow[] }>(`/api/folders/${folder.id}/drawings`);
      for (const drawing of drawings.drawings) {
        const row = el('div', { class: 'drawing-row', 'data-drawing': drawing.id });
        const link = el('a', { href: `/drawings/${drawing.id}`, class: 'drawing-name' }, [drawing.name]);
        on(link, 'click', (event: MouseEvent) => {
          event.preventDefault();
          navigate(`/drawings/${drawing.id}`);
        });
        row.append(link);
        const run = el('div', { class: 'frame-run' });
        for (const sheet of drawing.sheets) {
          for (const version of [...sheet.versions].sort((a, b) => a.number - b.number)) {
            const frame = el('figure', {
              class: 'sheet-frame',
              'data-version': version.id,
              'data-state': version.state,
            });
            const thumb = el('div', { class: 'thumb' });
            thumb.innerHTML = sheetSvg(version.snapshot);
            const caption = el('figcaption', {}, [`${sheet.name} v${version.number}`, el('span', { class: 'state' }, [version.state])]);
            frame.append(thumb, caption);
            on(frame, 'click', () => navigate(`/versions/${version.id}`));
            run.append(frame);
          }
        }
        if (run.childElementCount === 0) run.append(el('figure', { class: 'sheet-frame empty' }));
        row.append(run);
        section.append(row);
      }
      if (drawings.drawings.length === 0) {
        const row = el('div', { class: 'drawing-row empty-row' });
        row.append(el('figure', { class: 'sheet-frame empty' }), el('p', {}, ['No drawings yet.']));
        section.append(row);
      }
      const newDrawing = button('New drawing');
      on(newDrawing, 'click', () => {
        void api
          .post<{ id: string }>(`/api/folders/${folder.id}/drawings`, { name: `Drawing ${drawings.drawings.length + 1}` })
          .then((created) => navigate(`/drawings/${created.id}`))
          .catch((error: unknown) => {
            if (error instanceof RequestFailed) toast(error.body.message);
          });
      });
      section.append(newDrawing);
      page.append(section);
    }
  };

  on(newFolder, 'click', () => {
    void api
      .post('/api/folders', { name: 'New folder', parent_id: null })
      .then(() => draw())
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });

  await draw();
}
