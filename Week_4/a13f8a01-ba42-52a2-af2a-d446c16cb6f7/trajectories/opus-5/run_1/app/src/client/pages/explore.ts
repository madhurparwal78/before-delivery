import type { PenSummary } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api } from '../api';
import { panel, penList } from '../components/penlist';
import { siteHeader, verifyBanner, watchVerification } from '../components/shell';
import { h, replace, say, status } from '../dom';
import { mountPage, splitPage } from '../layout';
import { PreviewHost } from '../preview';
import { replaceAddress } from '../router';
import { config, live } from '../store';

export const explorePage = async (): Promise<void> => {
  const { root, stage, column } = splitPage(siteHeader(), 'stage-list');
  const region = h('div', { class: 'stage-inner' });
  stage.appendChild(region);

  const banner = verifyBanner();
  const searchStatus = status('Search results');
  const results = h('div', { class: 'list-holder' });
  const box = h('input', {
    type: 'search',
    'aria-label': 'Search pens',
    class: 'searchbox',
    autocomplete: 'off',
  });

  replace(column, [banner, box, results, searchStatus]);
  mountPage(root);

  const preview = new PreviewHost({ region, crossfade: true });
  live([], { account: watchVerification(banner) });

  let issued = 0;
  let answered = 0;

  const run = async (query: string): Promise<void> => {
    if (query.trim().length === 0) {
      issued += 1;
      answered = issued;
      replace(results, [panel(copy.searchAtRest)]);
      say(searchStatus, '');
      return;
    }
    issued += 1;
    const sequence = issued;
    const found = await api.get<{ total: number; pens: PenSummary[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    );
    if (sequence < answered) return;
    answered = sequence;
    replace(results, [
      found.pens.length === 0
        ? panel(copy.searchResults(0))
        : penList('Results', found.pens, { preview, showOwner: true }),
    ]);
    say(searchStatus, copy.searchResults(found.total));
  };

  let timer = 0;
  box.addEventListener('input', () => {
    window.clearTimeout(timer);
    const query = box.value;
    timer = window.setTimeout(() => {
      replaceAddress(query.trim().length > 0 ? `/explore?q=${encodeURIComponent(query)}` : '/explore');
      void run(query);
    }, config().search_debounce_ms);
  });

  const initial = new URL(window.location.href).searchParams.get('q') ?? '';
  box.value = initial;
  await run(initial);
};
