import { el, svgEl, entityLabel, displayText, pointText } from './ui.js';
import { sheetStrip } from './strip.js';
import type { ResolvedEntity, Entity, Pt } from '../shared/geometry.js';
import type { DrawingModel, LayerRecord } from '../shared/model.js';

// ---------------------------------------------------------------------------
// Pages: landing, register, sign in, folders, not available.
// ---------------------------------------------------------------------------

export interface PageContext {
  navigate: (path: string) => void;
  api: <T>(method: string, path: string, body?: unknown) => Promise<{ status: number; data: T }>;
  me: string | null;
}

export function landingPage(context: PageContext): HTMLElement {
  const page = el('div', { class: 'landing' });
  page.append(
    el('div', { class: 'corner tl' }, el('span', { class: 'product-name', text: 'Plotfold' })),
    el('div', { class: 'corner tr' }, el('a', { href: '/signin', text: 'Sign in' })),
    el('div', { class: 'corner bl' }, el('p', { text: 'Draw to scale, publish, then review.' })),
    el('div', { class: 'corner br' }, el('a', { href: '/register', text: 'Start drawing' })),
    sheetStrip(),
  );
  return page;
}

export function registerPage(context: PageContext): HTMLElement {
  return authFormPage(context, 'Create account', '/register', '/signin', 'Sign in');
}

export function signInPage(context: PageContext): HTMLElement {
  return authFormPage(context, 'Sign in', '/signin', '/register', 'Start drawing');
}

function authFormPage(context: PageContext, action: string, submitPath: string, altPath: string, altLabel: string): HTMLElement {
  const error = el('p', { class: 'form-error', role: 'status', 'aria-live': 'polite' });
  const username = el('input', { type: 'text', id: 'username', autocomplete: 'username' });
  const password = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
  const form = el('form', { class: 'surface auth-form' },
    el('h1', { text: action }),
    el('label', { for: 'username', text: 'Username' }, username),
    el('label', { for: 'password', text: 'Password' }, password),
    error,
    el('button', { type: 'submit', class: 'primary', text: action }),
    el('span', {}, el('a', { href: altPath, text: altLabel })),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const { status, data } = await context.api<{ message?: string; error?: string; fields?: Record<string, string> }>(submitPath === '/register' ? 'POST' : 'POST', submitPath, {
      username: (username as HTMLInputElement).value.trim().toLowerCase(),
      password: (password as HTMLInputElement).value,
    });
    if (status === 200 || status === 201) {
      context.navigate('/folders');
      return;
    }
    const fields = (data as { fields?: Record<string, string> }).fields;
    if (fields && Object.keys(fields).length) {
      error.textContent = Object.values(fields)[0];
      return;
    }
    error.textContent = (data as { message?: string }).message ?? 'Try again.';
  });
  return el('div', { class: 'landing' }, form);
}

interface FoldersResponse {
  folders: Array<{ id: string; name: string; parent_id: string | null; role: string }>;
}

interface DrawingsResponse {
  drawings: Array<{
    id: string;
    name: string;
    sheets: Array<{ id: string; name: string; versions: Array<{ id: string; number: number; state: string }> }>;
  }>;
}

export async function foldersPage(context: PageContext): Promise<HTMLElement> {
  const [foldersResult, drawingLists] = await Promise.all([
    context.api<FoldersResponse>('GET', '/api/folders'),
    Promise.resolve([] as DrawingsResponse[]),
  ]);
  const perFolder: Array<{ folder: { id: string; name: string; parent_id: string | null; role: string }; drawings: DrawingsResponse['drawings'] }> = [];
  for (const folder of foldersResult.data.folders) {
    const drawings = await context.api<DrawingsResponse>('GET', `/api/folders/${folder.id}/drawings`);
    perFolder.push({ folder, drawings: drawings.data.drawings });
  }
  const page = el('div', { class: 'folders-page' });
  page.append(el('h1', { class: 'page-name', text: 'Folders' }));
  const newFolderButton = el('button', { text: 'New folder' });
  newFolderButton.addEventListener('click', async () => {
    const name = window.prompt('Folder name');
    if (!name) return;
    await context.api('POST', '/api/folders', { name, parent_id: null });
    context.navigate('/folders');
  });
  page.append(newFolderButton);
  if (!perFolder.length) {
    page.append(el('div', { class: 'surface note' }, el('p', { text: 'No drawings yet.' })));
    return page;
  }
  for (const { folder, drawings } of perFolder) {
    const block = el('div', { class: 'folder-block surface' });
    block.append(el('div', { class: 'folder-name', text: folder.name }));
    if (!drawings.length) {
      const empty = el('div', { class: 'drawing-row' },
        el('span', { class: 'drawing-name' }),
        el('div', { class: 'versions-run empty-frame' },
          el('div', { class: 'version-frame' }, el('div', { class: 'sentence', text: 'No drawings yet.' }))));
      block.append(empty);
    }
    for (const drawing of drawings) {
      const run = el('div', { class: 'versions-run' });
      const sheets = drawing.sheets.length ? drawing.sheets : [];
      if (!sheets.length) {
        run.append(emptyFrame());
      }
      for (const sheet of sheets) {
        if (!sheet.versions.length) {
          run.append(emptyFrame());
          continue;
        }
        for (const version of sheet.versions) {
          const frame = el('div', { class: 'version-frame' });
          frame.append(
            frameThumbnail(sheet.name, version.number),
            el('span', { class: 'frame-state', text: `${sheet.name} v${version.number} ${version.state}` }),
          );
          frame.addEventListener('click', () => context.navigate(`/versions/${version.id}`));
          run.append(frame);
        }
      }
      block.append(el('div', { class: 'drawing-row' },
        el('a', { class: 'drawing-name', href: `/drawings/${drawing.id}`, text: drawing.name }),
        run));
    }
    const newDrawing = el('button', { text: 'New drawing' });
    newDrawing.addEventListener('click', async () => {
      const name = window.prompt('Drawing name');
      if (!name) return;
      await context.api('POST', `/api/folders/${folder.id}/drawings`, { name });
      context.navigate('/folders');
    });
    block.append(el('div', { class: 'folder-tools' }, newDrawing));
    page.append(block);
  }
  return page;
}

function emptyFrame(): HTMLElement {
  const frame = el('div', { class: 'version-frame' });
  const svg = svgEl('svg', { width: 48, height: 34, viewBox: '0 0 48 34', 'aria-hidden': 'true' });
  svg.append(svgEl('rect', { x: 0.5, y: 0.5, width: 47, height: 33, fill: '#1d2023', stroke: '#8a9187' }));
  frame.append(svg, el('span', { class: 'frame-state', text: ' ' }));
  return frame;
}

function frameThumbnail(sheetName: string, versionNumber: number): SVGElement {
  const svg = svgEl('svg', { width: 48, height: 34, viewBox: '0 0 48 34', 'aria-hidden': 'true' });
  svg.append(svgEl('rect', { x: 0.5, y: 0.5, width: 47, height: 33, fill: '#1d2023', stroke: '#8a9187' }));
  const seed = (sheetName.length + versionNumber) % 5;
  for (let i = 0; i < 3 + seed; i++) {
    const y = 6 + i * 5;
    const line = svgEl('line', { x1: 6, y1: y, x2: 40 - (i * 3) % 20, y2: y, stroke: '#ece7db', 'stroke-width': 0.5, opacity: 0.7 });
    svg.append(line);
  }
  svg.append(svgEl('rect', { x: 30, y: 24, width: 15, height: 7, fill: 'none', stroke: '#ece7db', 'stroke-width': 0.5 }));
  return svg;
}

export function notAvailablePage(message: string): HTMLElement {
  return el('div', { class: 'landing' },
    el('main', { class: 'surface note' },
      el('h1', { class: 'title', text: 'Not available' }),
      el('p', { text: message })));
}

export function notFoundPage(): HTMLElement {
  return el('div', { class: 'landing' },
    el('main', { class: 'surface note' },
      el('p', { text: 'We couldn\u2019t find that page.' })));
}

export { el, svgEl, entityLabel, displayText, pointText };
export type { ResolvedEntity, Entity, Pt, DrawingModel, LayerRecord };
