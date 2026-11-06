import { api, ApiError, type Comparison, type VetPage } from '../api.js';
import { clear, el } from '../dom.js';
import { mountNotices, announce } from '../notices.js';
import { copy } from '../copy.js';
import { createStage, HOOVES, type Hoof } from '../stage.js';

/**
 * `/vet/<token>` — a read-only comparison of the horse's two most recent closed
 * visits, with no rail and no control that changes anything.
 */
export async function renderVetPage(token: string): Promise<void> {
  clear(document.body);
  const main = el('main', { class: 'main' });
  const header = el('header', { class: 'header' }, [
    el('span', { class: 'wordmark', text: 'Rasp & Rein' }),
  ]);
  document.body.append(el('div', {}, [header, main]));
  mountNotices(header);

  let page: VetPage;
  try {
    page = await api.get<VetPage>(`/api/vet/${encodeURIComponent(token)}`);
  } catch (error) {
    const failure = error instanceof ApiError ? error.failure : null;
    const message =
      failure?.network === true
        ? copy.networkFailure
        : failure?.status === 429
          ? copy.rateLimited(failure.retryAfter ?? 1)
          : copy.vetLinkGone;
    main.append(el('p', { class: 'form-error', text: message }));
    announce(message);
    return;
  }

  const marked = HOOVES.filter((hoof) => page.hooves[hoof] !== null && page.hooves[hoof] !== undefined);
  const stage = createStage({
    showVisitPickers: false,
    onHoofChange: (hoof) => {
      stage.setComparison(page.hooves[hoof] ?? null);
    },
  });

  const firstHoof: Hoof = (marked[0] ?? 'LF') as Hoof;
  stage.setHoof(firstHoof, false);

  main.append(
    el('h5', { text: page.horse.name }),
    el('p', { class: 'num', text: `${page.previous_date} \u2192 ${page.current_date}` }),
    stage.root,
  );
  stage.setComparison((page.hooves[firstHoof] ?? null) as Comparison | null);
}
