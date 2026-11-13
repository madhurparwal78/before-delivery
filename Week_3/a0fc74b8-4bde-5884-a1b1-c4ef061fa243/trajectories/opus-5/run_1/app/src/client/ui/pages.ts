import { h } from '../dom.ts';
import { pdfjs } from './pdfjs.ts';

const RENDER_WIDTH = 1100;

export interface RenderedPages {
  container: HTMLElement;
  groups: HTMLElement[];
}

export interface PageShape {
  width: number;
  height: number;
}

/** Builds one focusable group per page, each holding a decorative page image. */
export const buildPageGroups = (pageCount: number): RenderedPages => {
  const groups: HTMLElement[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const sheet = h('div', { class: 'page-sheet' }, h('img', { alt: '', class: 'page-image' }));
    const group = h(
      'div',
      {
        role: 'group',
        'aria-label': `Page ${page} of ${pageCount}`,
        id: `page-${page}`,
        tabindex: '0',
        class: 'page-group',
      },
      sheet,
    );
    groups.push(group);
  }
  return { container: h('div', { class: 'pages' }, ...groups), groups };
};

const toObjectUrl = (canvas: HTMLCanvasElement): Promise<string> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob === null ? '' : URL.createObjectURL(blob));
    }, 'image/png');
  });

/**
 * Paints each page into its group and reports the page's own aspect ratio, so a
 * page keeps its shape at every width and zoom level.
 */
export const paintPages = async (
  url: string,
  groups: readonly HTMLElement[],
  onPage: (page: number, shape: PageShape, imageUrl: string) => void,
): Promise<void> => {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`pages unavailable: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const renderer = await pdfjs();
  const document_ = await renderer.getDocument({ data: bytes }).promise;
  for (let page = 1; page <= Math.min(document_.numPages, groups.length); page += 1) {
    const group = groups[page - 1];
    if (!group) continue;
    const pdfPage = await document_.getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    group.style.setProperty('--page-ratio', `${base.width} / ${base.height}`);
    const viewport = pdfPage.getViewport({ scale: RENDER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (context === null) continue;
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    const painted = await toObjectUrl(canvas);
    const image = group.querySelector<HTMLImageElement>('img.page-image');
    if (image) image.src = painted;
    onPage(page, { width: base.width, height: base.height }, painted);
  }
};
