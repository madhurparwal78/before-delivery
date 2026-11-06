/**
 * The dated citation page. It applies only a response newer than the one on
 * screen, so a late provisional response never undoes a final citation.
 */
import { getBoard, getCitation } from './api';
import { BOARD_COPY, citationHeading, provisionalLine, restatedLine } from './copy';
import { element, setText } from './dom';
import { FigureTile, createFigureTile } from './figureTile';
import { siteFooter, siteHeader } from './header';
import { activeTrace, openTrace } from './trace';
import { CitationPayload, Computation, HistoryRow } from './types';

const REFRESH_MS = 3000;

export function mountCitation(root: HTMLElement, figure: string, date: string): void {
  const heading = element('h1', { className: 'citation-heading' });
  const markers = element('div', { className: 'citation-markers' });
  const tileHost = element('div', { className: 'citation-tile-host' });
  root.appendChild(siteHeader());
  root.appendChild(
    element('main', { className: 'citation-main', children: [heading, markers, tileHost] }),
  );
  root.appendChild(siteFooter());

  let tile: FigureTile | null = null;
  let exhibitRows = new Map<string, HistoryRow>();
  let requestSeq = 0;
  let appliedSeq = 0;
  let isFinal = false;
  let pending: Computation | null = null;
  let current: CitationPayload | null = null;
  let timer = 0;

  function stepFromUrl(): string | null {
    return new URL(window.location.href).searchParams.get('step');
  }

  function writeStep(step: string | null): void {
    const url = new URL(window.location.href);
    if (step === null) url.searchParams.delete('step');
    else url.searchParams.set('step', step);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  function renderMarkers(payload: CitationPayload): void {
    const restated = payload.computation.restated;
    const wanted: string[] = [];
    if (restated !== null) wanted.push('restated');
    if (payload.citation.provisional) wanted.push('provisional');
    const key = wanted.join(',') + (restated === null ? '' : restated.superseded_by);
    if (markers.dataset.markerKey === key) return;
    markers.dataset.markerKey = key;
    while (markers.firstChild !== null) markers.removeChild(markers.firstChild);
    if (restated !== null) {
      markers.appendChild(
        element('p', { className: 'restated-marker', text: BOARD_COPY.restated }),
      );
      markers.appendChild(
        element('p', { className: 'restated-line', text: restatedLine(restated.on, restated.reason) }),
      );
      markers.appendChild(
        element('a', {
          text: BOARD_COPY.viewSuperseding,
          attributes: { href: `/#restatement-${restated.superseded_by}` },
        }),
      );
    }
    if (payload.citation.provisional) {
      markers.appendChild(
        element('p', { className: 'provisional-marker', text: provisionalLine(payload.citation.date) }),
      );
    }
  }

  function openTraceFor(step: string | null, instant: boolean): void {
    if (tile === null) return;
    const activeTile = tile;
    openTrace({
      tile: activeTile.root,
      numeral: activeTile.numeral,
      chipHost: activeTile.chipHost,
      opener: activeTile.activate,
      computation: activeTile.computation,
      exhibitRows: exhibitRows.get(activeTile.computation.restatement_id) ?? null,
      marketDate: null,
      initialInputKey: step,
      instant,
      onStep: (inputKey) => writeStep(inputKey),
      onClose: () => {
        writeStep(null);
        if (pending !== null) {
          activeTile.update(pending);
          pending = null;
        }
      },
    });
    writeStep(activeTrace()?.selectedInput() ?? null);
  }

  function apply(payload: CitationPayload): void {
    current = payload;
    setText(heading, citationHeading(payload.computation.label, payload.citation.date));
    renderMarkers(payload);
    if (tile === null) {
      tile = createFigureTile(payload.computation, 'h2');
      const created = tile;
      created.activate.addEventListener('click', () => openTraceFor(null, false));
      tileHost.appendChild(created.root);
      const step = stepFromUrl();
      if (step !== null && payload.computation.inputs.some((input) => input.key === step)) {
        openTraceFor(step, true);
      } else if (step !== null) {
        writeStep(null);
      }
      return;
    }
    const open = activeTrace();
    if (open !== null && open.tile === tile.root) {
      pending = payload.computation;
      return;
    }
    tile.update(payload.computation);
  }

  function renderNotFound(): void {
    setText(heading, BOARD_COPY.citationNotFound);
    while (markers.firstChild !== null) markers.removeChild(markers.firstChild);
    markers.dataset.markerKey = 'not-found';
    markers.appendChild(
      element('a', { text: 'Back to the figure board', attributes: { href: '/' } }),
    );
  }

  async function load(): Promise<void> {
    if (isFinal) return;
    const seq = requestSeq + 1;
    requestSeq = seq;
    const result = await getCitation(figure, date);
    if (seq <= appliedSeq || isFinal) return;
    if (result.kind !== 'success') {
      if (result.kind === 'failure' && result.status === 404 && current === null) {
        appliedSeq = seq;
        isFinal = true;
        window.clearInterval(timer);
        renderNotFound();
      }
      return;
    }
    appliedSeq = seq;
    apply(result.value);
    if (!result.value.citation.provisional) {
      isFinal = true;
      window.clearInterval(timer);
    }
  }

  void (async () => {
    const board = await getBoard();
    if (board.kind === 'success') {
      exhibitRows = new Map(board.value.history.map((row) => [row.restatement_id, row]));
    }
    await load();
    timer = window.setInterval(() => {
      void load();
    }, REFRESH_MS);
  })();
}
