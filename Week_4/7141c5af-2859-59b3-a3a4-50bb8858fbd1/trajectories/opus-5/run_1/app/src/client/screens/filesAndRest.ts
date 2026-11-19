/**
 * Photographs, collections, the dossier, the old workbook and labour rates.
 */
import { EMPTY, F } from '../../shared/feedback.ts';
import { api, ApiError } from '../ui/api.ts';
import { DURATION, animate, drawCheck, markDrawn } from '../ui/motion.ts';
import { all, el, find, need, patchList, setAttr, setHidden, setText } from '../ui/dom.ts';
import { announce, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal } from '../ui/dialog.ts';
import { body, pieceId, setRefresher, wireMainAction } from './deskShell.ts';
import { setQuery } from '../router.ts';
import { wireSectionRail } from './publicSite.ts';

// --------------------------------------------------------------- photographs

interface Photograph {
  id: string;
  number: number;
  side: 'before' | 'after';
  state: string;
  bytes: number;
}

const IMAGE_LIMIT = 8_000_000;

export async function startPhotographs(): Promise<void> {
  const screen = body();
  const piece = pieceId();

  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg', multiple: true, id: 'photo-file' });
  const fileLabel = el('label', { for: 'photo-file', class: 'file-button', text: 'Add photographs' });
  const sideGroup = el('div', { role: 'radiogroup', 'aria-label': 'Side', class: 'side-group' });
  for (const side of ['Before', 'After']) {
    const id = `side-${side.toLowerCase()}`;
    sideGroup.append(
      el('span', { class: 'radio' }, [
        el('input', { type: 'radio', name: 'side', id, value: side.toLowerCase(), checked: side === 'Before' }),
        el('label', { for: id, text: side }),
      ]),
    );
  }
  const uploads = el('ul', { class: 'uploads', id: 'uploads', 'aria-label': 'Uploads' });
  const stored = el('ul', { class: 'stored-list', id: 'stored-list' });
  const slider = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: '50',
    id: 'before-after',
    'aria-label': 'Before and after',
  });
  const compare = el('div', { class: 'compare', id: 'compare' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Stored files' }),
    el('p', { class: 'figure', id: 'stored-count', text: '0' }),
  ]);

  screen.textContent = '';
  screen.append(
    mint,
    el('div', { class: 'tile' }, [fileLabel, fileInput, sideGroup]),
    el('div', { class: 'tile' }, [el('h2', { text: 'Uploads' }), uploads]),
    el('div', { class: 'tile tile-large' }, [
      el('h2', { text: 'Before and after' }),
      compare,
      el('p', { class: 'field' }, [el('label', { for: 'before-after', text: 'Before and after' }), slider]),
    ]),
    el('div', { class: 'tile' }, [el('h2', { text: 'Files' }), stored, el('p', { class: 'tile-empty', id: 'photo-empty', text: EMPTY.photographs, hidden: true })]),
  );

  const share = (): number => Number(slider.value);

  const applySlider = (): void => {
    const value = share();
    compare.style.setProperty('--share', `${value}%`);
    slider.setAttribute('aria-valuetext', `${value}% before`);
    setQuery({ before: String(value) }, true);
  };

  slider.addEventListener('input', applySlider);
  slider.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    let value = share();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') value -= step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') value += step;
    else return;
    event.preventDefault();
    // In Arabic the before picture is on the right, so Left shows more of it.
    const rtl = document.documentElement.dir === 'rtl';
    const moved = rtl && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ? share() + (event.key === 'ArrowLeft' ? step : -step)
      : value;
    slider.value = String(Math.min(100, Math.max(0, moved)));
    applySlider();
    animate(compare, [{ opacity: 0.92 }, { opacity: 1 }], DURATION.quick);
  });

  const atStart = new URL(window.location.href).searchParams.get('before');
  if (atStart !== null) slider.value = atStart;
  applySlider();

  /** Each file gets its own row, its own `Try again`, and never stops another. */
  const sendOne = async (file: File, side: string, row: HTMLElement): Promise<void> => {
    const state = need('.upload-state', row);
    if (file.size > IMAGE_LIMIT) {
      setText(state, F.refused);
      need('.upload-reason', row).textContent = F.fileTooBig;
      return;
    }
    setText(state, F.sending);
    const form = new FormData();
    form.append('file', file);
    form.append('side', side);
    try {
      await api.upload(`/api/pieces/${piece}/photographs`, form);
      setText(state, F.stored);
      need('.upload-reason', row).textContent = '';
      announce(F.fileStored(file.name));
      await load();
    } catch (error) {
      setText(state, F.refused);
      need('.upload-reason', row).textContent = error instanceof ApiError ? error.failure.message : '';
      announce(error instanceof ApiError ? error.failure.message : F.refreshFailed);
    }
  };

  const addFiles = (files: FileList): void => {
    const side = find<HTMLInputElement>('input[name="side"]:checked', sideGroup)?.value ?? 'before';
    for (const file of files) {
      const state = el('span', { class: 'upload-state', text: F.waiting });
      const reason = el('span', { class: 'upload-reason' });
      const again = el('button', { type: 'button', text: 'Try again' });
      const row = el('li', { class: 'upload-row' }, [
        el('span', { class: 'upload-name', text: file.name }),
        state,
        reason,
        again,
      ]);
      again.addEventListener('click', () => {
        void withPending(again, () => sendOne(file, side, row));
      });
      uploads.append(row);
      void sendOne(file, side, row);
    }
  };

  fileInput.addEventListener('change', () => {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = '';
  });
  wireMainAction(() => fileInput.click());

  screen.addEventListener('dragover', (event) => event.preventDefault());
  screen.addEventListener('drop', (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files) addFiles(event.dataTransfer.files);
  });

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/pieces/${piece}/photographs`)) as { photographs: Photograph[] };
    patchList(
      stored,
      answer.photographs,
      (photo) => photo.id,
      () => el('li', {}),
      (node, photo) =>
        setText(node, `${photo.number} \u00b7 ${photo.side} \u00b7 ${photo.bytes} bytes \u00b7 ${photo.state === 'stored' ? F.stored : F.waiting}`),
    );
    setHidden(need<HTMLElement>('#photo-empty'), answer.photographs.length > 0);
    setText(need('#stored-count'), String(answer.photographs.filter((photo) => photo.state === 'stored').length));

    const latest = (side: 'before' | 'after'): Photograph | undefined =>
      [...answer.photographs].filter((photo) => photo.side === side && photo.state === 'stored').pop();
    const before = latest('before');
    const after = latest('after');
    compare.textContent = '';
    if (before || after) {
      if (before) {
        compare.append(
          el('figure', { class: 'compare-before' }, [
            el('img', {
              src: `/api/pieces/${piece}/photographs/${before.id}/file`,
              alt: 'Photograph before the work',
              width: '480',
              height: '360',
            }),
            el('figcaption', { text: 'Before' }),
          ]),
        );
      }
      if (after) {
        compare.append(
          el('figure', { class: 'compare-after' }, [
            el('img', {
              src: `/api/pieces/${piece}/photographs/${after.id}/file`,
              alt: 'Photograph after the work',
              width: '480',
              height: '360',
            }),
            el('figcaption', { text: 'After' }),
          ]),
        );
      }
      applySlider();
    } else {
      compare.append(el('p', { class: 'tile-empty', text: EMPTY.photographs }));
    }
  }

  await load();
  setRefresher(load);
}

// ---------------------------------------------------------------- collection

interface Collection {
  id: string;
  state: string;
  localDate: string;
  localTime: string;
  display: string;
  labelSha256: string | null;
}

export async function startCollection(): Promise<void> {
  const screen = body();
  const piece = pieceId();

  const quoteLine = el('p', { id: 'quote-line', text: 'No quote yet.' });
  const list = el('ul', { class: 'collection-list', id: 'collection-list' });
  const empty = el('p', { class: 'tile-empty', id: 'collection-empty', text: EMPTY.collections, hidden: true });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Next collection' }),
    el('p', { class: 'figure', id: 'next-collection', text: '\u2014' }),
  ]);
  const getQuote = el('button', { type: 'button', text: 'Get a quote', id: 'get-a-quote' });
  const bookIt = el('button', { type: 'button', class: 'button-primary', text: 'Book a collection', id: 'book-a-collection' });

  screen.textContent = '';
  screen.append(
    mint,
    el('div', { class: 'tile' }, [el('h2', { text: 'Quote' }), quoteLine]),
    el('div', { class: 'tile tile-large' }, [el('h2', { text: 'Collections' }), list, empty]),
    el('p', { class: 'screen-action' }, [getQuote, bookIt]),
  );

  let quoteId: string | null = null;

  getQuote.addEventListener('click', () => {
    void withPending(getQuote, async () => {
      try {
        const answer = (await api.post(`/api/pieces/${piece}/collections/quote`, {})) as {
          quote: { quoteId: string; display: string };
        };
        quoteId = answer.quote.quoteId;
        setText(quoteLine, F.quote(answer.quote.display));
        announce(F.quote(answer.quote.display));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        announce(error.failure.message);
      }
    });
  });

  const openBook = (): void => {
    openModal({
      name: 'Book a collection',
      opener: bookIt,
      build(dialogBody, handle) {
        const date = el('input', { type: 'text', name: 'localDate', inputmode: 'numeric' });
        const time = el('input', { type: 'text', name: 'localTime', value: '09:00', inputmode: 'numeric' });
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Book' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          field('book-date', 'Date', date),
          field('book-time', 'Time', time),
          el('p', { class: 'dialog-actions' }, [run, close]),
        );
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            try {
              await api.post(`/api/pieces/${piece}/collections`, {
                quoteId,
                localDate: date.value,
                localTime: time.value,
              });
              handle.close();
              announce(F.booked);
              await load();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const problems = Object.entries(error.failure.fields).map(([name, message]) => ({
                field: name,
                message,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'localDate', message: error.failure.message }],
                (name) => (name === 'localTime' ? time : date),
                'Problems',
              );
              announce(error.failure.message);
            }
          });
        });
      },
    });
  };
  bookIt.addEventListener('click', openBook);
  wireMainAction(openBook);

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/pieces/${piece}/collections`)) as { collections: Collection[] };
    patchList(
      list,
      answer.collections,
      (collection) => collection.id,
      () => el('li', {}),
      (node, collection) => {
        node.textContent = '';
        node.append(
          el('span', { class: 'collection-when', text: collection.display }),
          el('span', { class: 'collection-state', text: collection.state === 'waiting' ? F.waiting : F.booked }),
        );
        if (collection.labelSha256 !== null) {
          node.append(
            el('a', {
              href: `/api/pieces/${piece}/collections/${collection.id}/label`,
              text: `Label for ${collection.id}`,
              download: '',
            }),
          );
        }
      },
    );
    setHidden(need<HTMLElement>('#collection-empty'), answer.collections.length > 0);
    setText(need('#next-collection'), answer.collections[0]?.display ?? '\u2014');
  }

  await load();
  setRefresher(load);
}

// ------------------------------------------------------------------- dossier

interface Dossier {
  id: string;
  state: string;
  message: string | null;
  signedBy: string | null;
  history: { at: string; who: string; what: string }[];
}

const STEPS = [
  { key: 'waiting', label: F.waiting },
  { key: 'rendering', label: F.rendering },
  { key: 'stored', label: F.stored },
] as const;

export async function startDossier(): Promise<void> {
  const screen = body();
  const piece = pieceId();

  const strip = el('ol', { class: 'dossier-steps', id: 'dossier-steps', 'aria-label': 'Dossier steps' });
  for (const step of STEPS) {
    strip.append(
      el('li', { 'data-part': 'dossier-step', 'data-step': step.key, 'data-state': 'pending' }, [
        el('span', { class: 'step-check', 'data-part': 'step-check' }),
        el('span', { text: step.label }),
      ]),
    );
  }
  const sections = el('div', { class: 'dossier-sections' });
  const DOSSIER_SECTIONS = [
    ['01', 'The piece', 'the-piece'],
    ['02', 'Condition', 'condition'],
    ['03', 'Materials', 'materials'],
    ['04', 'Photographs', 'photographs'],
    ['05', 'Care card', 'care-card'],
    ['06', 'History', 'history'],
  ] as const;
  const railItems = DOSSIER_SECTIONS.map(
    ([number, heading, hash]) =>
      `<li><a href="#${hash}" data-rail="${hash}" aria-current="${number === '01' ? 'true' : 'false'}"><span class="rail-number">${number}</span><span class="visually-hidden"> ${heading}</span></a></li>`,
  ).join('');
  const rail = el('nav', {
    class: 'case-rail',
    id: 'dossier-rail',
    'aria-label': 'Sections',
    html: `<div class="rail-frame" role="region" aria-label="Section numbers" tabindex="0"><ol>${railItems}</ol></div>`,
  });
  for (const [number, heading, hash] of DOSSIER_SECTIONS) {
    sections.append(
      el('section', { class: 'tile case-section' }, [
        el('h2', { id: hash, tabindex: '-1', text: `${number} ${heading}` }),
        el('div', { class: 'section-body', 'data-section': hash }),
      ]),
    );
  }
  const history = el('ol', { class: 'dossier-history', id: 'dossier-history', 'aria-label': 'Dossier history' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Dossier' }),
    el('p', { class: 'figure', id: 'dossier-state', text: '\u2014' }),
  ]);
  const make = el('button', { type: 'button', class: 'button-primary', text: 'Make dossier', id: 'make-dossier' });
  const download = el('a', { href: `/api/pieces/${piece}/dossier/pdf`, text: 'Download PDF', download: '', hidden: true });
  const sign = el('button', { type: 'button', text: 'Sign dossier', id: 'sign-dossier', hidden: true });

  screen.textContent = '';
  screen.append(mint, el('div', { class: 'tile' }, [strip]), rail, sections, el('p', { class: 'screen-action' }, [make, download, sign]));
  need<HTMLElement>('[data-section="history"]').append(history);

  const openSign = (): void => {
    openModal({
      name: 'Sign dossier',
      opener: sign,
      build(dialogBody, handle) {
        const name = el('input', { type: 'text', name: 'typedName', autocomplete: 'name' });
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Sign' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(field('sign-name', 'Your full name', name), el('p', { class: 'dialog-actions' }, [run, close]));
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            try {
              await api.post(`/api/pieces/${piece}/dossier/sign`, { typedName: name.value });
              handle.close();
              announce(F.dossierSigned);
              await load();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const problems = Object.entries(error.failure.fields).map(([key, message]) => ({
                field: key,
                message,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'typedName', message: error.failure.message }],
                () => name,
                'Problems',
              );
            }
          });
        });
      },
    });
  };
  sign.addEventListener('click', openSign);

  const run = (button: HTMLElement): void => {
    void withPending(button, async () => {
      try {
        await api.post(`/api/pieces/${piece}/dossier`, {});
        await load();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        announce(error.failure.message);
      }
    });
  };
  make.addEventListener('click', () => run(make));
  wireMainAction((button) => run(button));

  let known: string | null = null;

  async function load(): Promise<void> {
    let dossier: Dossier | null = null;
    try {
      dossier = ((await api.get(`/api/pieces/${piece}/dossier`)) as { dossier: Dossier }).dossier;
    } catch (error) {
      if (!(error instanceof ApiError) || error.failure.status !== 404) throw error;
    }

    const state = dossier?.state ?? 'none';
    const reached = state === 'signed' ? 3 : state === 'stored' ? 3 : state === 'rendering' ? 2 : state === 'waiting' ? 1 : 0;
    all<HTMLElement>('[data-part="dossier-step"]', strip).forEach((node, index) => {
      const own = index + 1;
      const next = own < reached ? 'done' : own === reached ? (reached === 3 ? 'done' : 'current') : 'pending';
      const changed = node.dataset.state !== next;
      setAttr(node, 'data-state', next);
      const check = need<HTMLElement>('[data-part="step-check"]', node);
      if (next === 'done') {
        // A step already finished when the screen opens shows its check at once.
        if (known === null) markDrawn(check);
        else if (changed) drawCheck(check);
        else markDrawn(check);
      } else {
        delete check.dataset.drawn;
      }
    });
    known = state;

    setText(need('#dossier-state'), state === 'none' ? '\u2014' : state);
    setHidden(download, state !== 'stored' && state !== 'signed');
    setHidden(sign, state !== 'stored');
    if (dossier?.message) announce(dossier.message);

    patchList(
      history,
      dossier?.history ?? [],
      (entry) => `${entry.at}|${entry.what}`,
      () => el('li', {}),
      (node, entry) => setText(node, `${entry.at} \u00b7 ${entry.who} \u00b7 ${entry.what}`),
    );

    const piecePart = need<HTMLElement>('[data-section="the-piece"]');
    const answer = (await api.get(`/api/pieces/${piece}`)) as {
      piece: { title: string; stampNumber: string | null; maker: string | null; year: string | null };
    };
    piecePart.textContent = '';
    piecePart.append(
      el('dl', { class: 'facts' }, [
        el('dt', { text: 'Piece' }),
        el('dd', { text: answer.piece.title }),
        el('dt', { text: 'Stamp number' }),
        el('dd', { text: answer.piece.stampNumber ?? '' }),
        el('dt', { text: 'Maker' }),
        el('dd', { text: answer.piece.maker ?? '' }),
        el('dt', { text: 'Year' }),
        el('dd', { text: answer.piece.year ?? '' }),
      ]),
    );
  }

  await load();
  wireSectionRail();
  setRefresher(load);
}

// ------------------------------------------------------------------ workbook

interface PreviewRow {
  row: number;
  status: string;
  reason: string | null;
  client: string;
  piece: string;
  stamp: string;
  maker: string;
  year: string;
  material: string;
  notes: string;
}

export async function startWorkbook(): Promise<void> {
  const screen = body();

  const fileInput = el('input', { type: 'file', accept: '.csv,text/csv', id: 'workbook-file' });
  const chooseLabel = el('label', { for: 'workbook-file', class: 'file-button', text: 'Choose a file' });
  const table = el('table', { class: 'desk-table' });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Row' }),
        el('th', { scope: 'col', text: 'Status' }),
        el('th', { scope: 'col', text: 'Piece' }),
        el('th', { scope: 'col', text: 'Client' }),
        el('th', { scope: 'col', text: 'Stamp' }),
        el('th', { scope: 'col', text: 'Reason' }),
      ]),
    ]),
  );
  const tbody = el('tbody', {});
  table.append(tbody);
  const frame = el('div', { class: 'frame', role: 'region', 'aria-label': 'Workbook preview', tabindex: '0' }, [table]);
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'New rows' }),
    el('p', { class: 'figure', id: 'new-rows', text: '0' }),
  ]);
  const save = el('button', { type: 'button', class: 'button-primary', text: 'Save', id: 'workbook-save' });
  const listLink = el('a', { href: '/api/materials-list.csv', text: 'Download materials list', download: '' });

  screen.textContent = '';
  screen.append(
    mint,
    el('div', { class: 'tile' }, [chooseLabel, fileInput, el('p', {}, [listLink])]),
    el('div', { class: 'tile tile-large' }, [frame]),
    el('p', { class: 'screen-action' }, [save]),
  );

  let chosen: File | null = null;

  const preview = async (): Promise<void> => {
    if (!chosen) return;
    const form = new FormData();
    form.append('file', chosen);
    try {
      const answer = (await api.upload('/api/workbook/preview', form)) as {
        rows: PreviewRow[];
        counts: { new: number; matched: number; refused: number };
      };
      tbody.textContent = '';
      for (const row of answer.rows) {
        const expand = el('button', { type: 'button', text: `Row ${row.row}`, 'aria-expanded': 'false' });
        const detail = el('tr', { class: 'row-detail', hidden: true }, [
          el('td', { colspan: '6', text: `${row.maker} \u00b7 ${row.year} \u00b7 ${row.material} \u00b7 ${row.notes}` }),
        ]);
        expand.addEventListener('click', () => {
          const open = expand.getAttribute('aria-expanded') === 'true';
          expand.setAttribute('aria-expanded', open ? 'false' : 'true');
          detail.hidden = open;
        });
        tbody.append(
          el('tr', {}, [
            el('td', {}, [expand]),
            el('td', { text: row.status }),
            el('td', { text: row.piece }),
            el('td', { text: row.client }),
            el('td', { text: row.stamp }),
            el('td', { text: row.reason ?? '' }),
          ]),
          detail,
        );
      }
      setText(need('#new-rows'), String(answer.counts.new));
      announce(F.previewReady(answer.counts.new, answer.counts.matched, answer.counts.refused));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      tbody.textContent = '';
      announce(error.failure.message);
    }
  };

  fileInput.addEventListener('change', () => {
    chosen = fileInput.files?.[0] ?? null;
    void preview();
  });

  const openSave = (): void => {
    if (!chosen) return;
    openModal({
      name: 'Save this file',
      opener: save,
      build(dialogBody, handle) {
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Save file' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          el('p', { text: 'The file is kept byte for byte and its rows are read exactly as written.' }),
          el('p', { class: 'dialog-actions' }, [run, close]),
        );
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            const form = new FormData();
            form.append('file', chosen!);
            try {
              const answer = (await api.upload('/api/workbook/save', form)) as {
                created: number;
                matched: number;
                refused: number;
              };
              handle.close();
              announce(F.workbookSaved(answer.created, answer.matched, answer.refused));
              await preview();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              showProblems(handle.problems, [{ field: 'file', message: error.failure.message }], () => run, 'Problems');
              announce(error.failure.message);
            }
          });
        });
      },
    });
  };
  save.addEventListener('click', openSave);
  wireMainAction(openSave);
}

// --------------------------------------------------------------------- rates

interface Rate {
  takesEffectOn: string;
  eur: string;
  gbp: string;
  usd: string;
  jpy: string;
  aed: string;
}

export async function startRates(): Promise<void> {
  const screen = body();

  const table = el('table', { class: 'desk-table' });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Takes effect on' }),
        el('th', { scope: 'col', text: 'EUR' }),
        el('th', { scope: 'col', text: 'GBP' }),
        el('th', { scope: 'col', text: 'USD' }),
        el('th', { scope: 'col', text: 'JPY' }),
        el('th', { scope: 'col', text: 'AED' }),
      ]),
    ]),
  );
  const tbody = el('tbody', {});
  table.append(tbody);
  const frame = el('div', { class: 'frame', role: 'region', 'aria-label': 'Rates table', tabindex: '0' }, [table]);
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: "Today's rate" }),
    el('p', { class: 'figure', id: 'today-rate', text: '\u2014' }),
  ]);
  const newRate = el('button', { type: 'button', class: 'button-primary', text: 'New rate', id: 'new-rate' });

  screen.textContent = '';
  screen.append(mint, el('div', { class: 'tile tile-large' }, [frame]), el('p', { class: 'screen-action' }, [newRate]));

  const openNew = (): void => {
    openModal({
      name: 'New rate',
      opener: newRate,
      build(dialogBody, handle) {
        const day = el('input', { type: 'text', name: 'takesEffectOn', inputmode: 'numeric' });
        const amounts: Record<string, HTMLInputElement> = {};
        const rows: HTMLElement[] = [field('rate-day', 'Takes effect on', day)];
        for (const code of ['EUR', 'GBP', 'USD', 'JPY', 'AED']) {
          const input = el('input', { type: 'text', name: code, inputmode: 'decimal' });
          amounts[code] = input;
          rows.push(field(`rate-${code}`, code, input));
        }
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Save rate' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(...rows, el('p', { class: 'dialog-actions' }, [run, close]));
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            const payload: Record<string, unknown> = { takesEffectOn: day.value };
            for (const [code, input] of Object.entries(amounts)) payload[code] = input.value;
            try {
              const answer = (await api.post('/api/rates', payload)) as { message: string };
              handle.close();
              announce(answer.message);
              await load();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const problems = Object.entries(error.failure.fields).map(([key, message]) => ({
                field: key,
                message,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'takesEffectOn', message: error.failure.message }],
                (key) => amounts[key] ?? day,
                'Problems',
              );
            }
          });
        });
      },
    });
  };
  newRate.addEventListener('click', openNew);
  wireMainAction(openNew);

  async function load(): Promise<void> {
    const answer = (await api.get('/api/rates')) as { rates: Rate[] };
    const session = (await api.get('/api/session')) as { session: { today: string } };
    patchList(
      tbody,
      answer.rates,
      (rate) => rate.takesEffectOn,
      () =>
        el('tr', {}, [
          el('td', { class: 'c-day' }),
          el('td', { class: 'c-eur' }),
          el('td', { class: 'c-gbp' }),
          el('td', { class: 'c-usd' }),
          el('td', { class: 'c-jpy' }),
          el('td', { class: 'c-aed' }),
        ]),
      (row, rate) => {
        setText(need('.c-day', row), rate.takesEffectOn);
        setText(need('.c-eur', row), rate.eur);
        setText(need('.c-gbp', row), rate.gbp);
        setText(need('.c-usd', row), rate.usd);
        setText(need('.c-jpy', row), rate.jpy);
        setText(need('.c-aed', row), rate.aed);
      },
    );
    const applies = answer.rates.find((rate) => rate.takesEffectOn <= session.session.today);
    setText(need('#today-rate'), applies ? `\u20ac${applies.eur}` : '\u2014');
  }

  await load();
  setRefresher(load);
}
