import type { Pen } from '../../shared/api';
import { api } from '../api';
import { tablist } from '../components/tabs';
import { h, status } from '../dom';
import { mountPage } from '../layout';
import { PreviewHost } from '../preview';

const TABS = ['html', 'css', 'js', 'result'] as const;

/** A missing tab, and any value that is not a pane, falls back to the result tab. */
const startingTab = (): number => {
  const asked = (new URL(window.location.href).searchParams.get('tab') ?? '').toLowerCase();
  const index = TABS.indexOf(asked as (typeof TABS)[number]);
  return index === -1 ? TABS.length - 1 : index;
};

export const embedPage = async (params: Record<string, string>): Promise<void> => {
  const pen = await api.get<Pen>(`/api/pens/${params.id}`);
  const files = pen.version?.files ?? { html: '', css: '', js: '' };

  const region = h('div', { role: 'region', 'aria-label': 'Preview', class: 'embed-preview' });
  const previewStatus = status('Preview status');
  const rerun = h('button', { type: 'button', class: 'action accent', text: 'Rerun' });

  const tabs = tablist(
    'Embed',
    [
      { name: 'HTML', panel: h('pre', { class: 'code-view mono', text: files.html }) },
      { name: 'CSS', panel: h('pre', { class: 'code-view mono', text: files.css }) },
      { name: 'JS', panel: h('pre', { class: 'code-view mono', text: files.js }) },
      { name: 'Result', panel: h('div', { class: 'result-panel' }, [region, rerun, previewStatus]) },
    ],
    startingTab(),
  );

  mountPage(
    h('div', { class: 'embed' }, [
      h('div', { class: 'embed-bar' }, [
        h('span', { class: 'embed-title', text: pen.title }),
        h('span', { class: 'muted', text: pen.owner }),
        h('a', { href: `/pen/${pen.id}`, target: '_top', text: 'Open on Ashlar' }),
      ]),
      tabs.list,
      tabs.panels,
    ]),
  );

  const preview = new PreviewHost({ region, statusRegion: previewStatus });
  const run = (): void => void preview.show({ penId: pen.id }).catch(() => undefined);
  rerun.addEventListener('click', run);
  if (pen.head > 0) run();
};
