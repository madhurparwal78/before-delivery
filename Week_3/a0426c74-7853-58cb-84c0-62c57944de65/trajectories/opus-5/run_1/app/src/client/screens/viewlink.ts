import { sheetSvg } from '../../shared/svgtext.js';
import type { VersionSnapshot } from '../../shared/snapshot.js';
import { RequestFailed, api } from '../api.js';
import { clear, el } from '../dom.js';
import { openLive } from '../live.js';

interface LinkVersion {
  id: string;
  number: number;
  state: string;
  snapshot: VersionSnapshot;
}

export function notAvailable(root: HTMLElement, sentence: string): void {
  clear(root);
  root.append(el('main', { class: 'surface not-available' }, [el('p', {}, [sentence])]));
}

export async function viewLinkScreen(root: HTMLElement, token: string): Promise<void> {
  clear(root);
  try {
    const version = await api.get<LinkVersion>(`/api/links/${token}`);
    const page = el('main', { class: 'review-screen link-screen' });
    const pane = el('section', { role: 'region', 'aria-label': 'Drawing', class: 'drawing-pane' });
    pane.innerHTML = sheetSvg(version.snapshot);
    page.append(el('p', { class: 'version-label' }, [`v${version.number}`]), pane);
    root.append(page);
    openLive({
      path: `/api/links/${token}/live`,
      onMessage: (message) => {
        const text = String((message.data as { text?: string }).text ?? '');
        if (text) notAvailable(root, text);
      },
      onStatus: () => undefined,
    });
  } catch (error) {
    if (error instanceof RequestFailed) {
      notAvailable(root, error.body.message);
      return;
    }
    notAvailable(root, 'We couldn\u2019t find that page.');
  }
}
