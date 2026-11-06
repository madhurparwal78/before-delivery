import {
  api,
  ApiError,
  newIdempotencyKey,
  type Comparison,
  type HoofMarks,
  type Horse,
  type Photo,
  type Visit,
  type VetLink,
  type VetLinkView,
} from '../api.js';
import { clear, el, money, openDialog, staggerIn, withSkeleton } from '../dom.js';
import { announce, announceWithToast, failureCopy, pending } from '../notices.js';
import { HOOF_NAMES, WORK_LABELS, copy } from '../copy.js';
import { createStage, HOOVES, type Hoof } from '../stage.js';
import type { ScreenContext } from '../shell.js';
import { openStream } from '../stream-client.js';

/** `/horses` — a ruled list with next-due status, and the farrier's "Import CSV". */
export async function renderHorses(ctx: ScreenContext): Promise<void> {
  clear(ctx.main);
  const controls = el('div', { class: 'row-actions' });
  const table = el('table', { class: 'stacked', 'aria-label': 'Horses' });
  ctx.main.append(controls, table);

  if (ctx.me.role === 'farrier') {
    const importButton = el('button', { type: 'button', text: 'Import CSV' }) as HTMLButtonElement;
    importButton.addEventListener('click', () => openImportDialog(importButton, refresh));
    controls.append(importButton);
  }

  let firstLoad = true;
  const refresh = async (): Promise<void> => {
    const horses = firstLoad
      ? await withSkeleton(ctx.main, 6, () => api.get<Horse[]>('/api/horses'))
      : await api.get<Horse[]>('/api/horses');
    firstLoad = false;
    clear(table);
    table.append(
      el('caption', { text: 'Horses' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Horse' }),
          el('th', { scope: 'col', text: 'Barn' }),
          el('th', { scope: 'col', text: 'Stall' }),
          el('th', { scope: 'col', text: 'Cycle (weeks)' }),
          el('th', { scope: 'col', text: 'Next due' }),
        ]),
      ]),
    );
    const body = el('tbody');
    for (const horse of horses) {
      const link = el('a', { href: `/horses/${horse.id}?hoof=LF`, text: horse.name });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        ctx.navigate(`/horses/${horse.id}?hoof=LF`);
      });
      body.append(
        el('tr', {}, [
          el('td', { 'data-label': 'Horse' }, [link]),
          el('td', { 'data-label': 'Barn', text: horse.barn.name }),
          el('td', { 'data-label': 'Stall', class: 'num', text: horse.stall }),
          el('td', { 'data-label': 'Cycle (weeks)', class: 'num', text: String(horse.cycle_weeks) }),
          el('td', { 'data-label': 'Next due' }, [el('span', { class: 'chip', text: dueText(horse) })]),
        ]),
      );
    }
    table.append(body);
    staggerIn([...body.children].filter((node): node is HTMLElement => node instanceof HTMLElement));
  };

  await refresh();
  ctx.onRefresh(refresh, 30000);
}

function dueText(horse: Horse): string {
  switch (horse.due_status) {
    case 'current':
      return `Next due ${horse.next_due_date}`;
    case 'due':
      return `Due ${horse.next_due_date}`;
    case 'overdue':
      return `Overdue, was due ${horse.next_due_date}`;
    case 'unknown':
      return 'No visits yet';
  }
}

function openImportDialog(
  opener: HTMLButtonElement,
  afterImport: () => Promise<void>,
): void {
  const fileInput = el('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'CSV file' }) as HTMLInputElement;
  const errorsHost = el('div');
  const importNow = el('button', { type: 'button', class: 'primary', text: 'Import' }) as HTMLButtonElement;
  const dialog = openDialog({
    title: 'Import CSV',
    body: [
      el('div', { class: 'field' }, [el('label', { text: 'CSV file' }), fileInput]),
      el('div', { class: 'actions' }, [importNow]),
      errorsHost,
    ],
    initialFocus: () => fileInput,
    opener,
  });

  importNow.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const file = fileInput.files?.[0];
      if (file === undefined) {
        announce(copy.importInvalid);
        return;
      }
      const handle = pending(importNow, copy.importing);
      try {
        const result = await api.post<{
          created_owners: number;
          matched_owners: number;
          created_horses: number;
          updated_horses: number;
        }>('/api/imports', {
          raw: await file.arrayBuffer(),
          contentType: 'text/csv',
          idempotencyKey: newIdempotencyKey(),
        });
        handle.done();
        dialog.close();
        announceWithToast(
          copy.importFinished(
            result.created_owners,
            result.matched_owners,
            result.created_horses,
            result.updated_horses,
          ),
        );
        await afterImport();
      } catch (error) {
        const failure = error instanceof ApiError ? error.failure : null;
        if (failure !== null && failure.code === 'import_invalid') {
          handle.failed(copy.importInvalid);
          clear(errorsHost);
          errorsHost.append(
            el('table', { class: 'stacked', 'aria-label': 'Import errors' }, [
              el('caption', { text: 'Import errors' }),
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { scope: 'col', text: 'Line' }),
                  el('th', { scope: 'col', text: 'Column' }),
                  el('th', { scope: 'col', text: 'Code' }),
                ]),
              ]),
              el(
                'tbody',
                {},
                (failure.rowErrors ?? []).map((row) =>
                  el('tr', {}, [
                    el('td', { 'data-label': 'Line', class: 'num', text: String(row.line) }),
                    el('td', { 'data-label': 'Column', text: row.column }),
                    el('td', { 'data-label': 'Code', text: row.code }),
                  ]),
                ),
              ),
            ]),
          );
          return;
        }
        if (failure !== null && failure.code === 'idempotency_in_progress') {
          handle.failed(copy.importInProgress);
          return;
        }
        handle.failed(failureCopy(error, copy.importInvalid));
      }
    })();
  });
}

/* --------------------------------------------------------------------- horse panel */

export async function renderHorsePanel(ctx: ScreenContext, horseId: string, hoofParam: string): Promise<void> {
  let horse: Horse;
  try {
    horse = await api.get<Horse>(`/api/horses/${horseId}`);
  } catch (error) {
    clear(ctx.main);
    const failure = error instanceof ApiError ? error.failure : null;
    ctx.main.append(
      el('p', {
        class: 'form-error',
        text: failure?.network === true ? copy.networkFailure : copy.horseNotAvailable,
      }),
    );
    return;
  }

  const startingHoof: Hoof = (HOOVES as readonly string[]).includes(hoofParam) ? (hoofParam as Hoof) : 'LF';
  let visits: Visit[] = [];
  let comparison: Comparison | null = null;
  let pair: { previous: string | null; current: string | null } = { previous: null, current: null };

  const stage = createStage({
    showVisitPickers: true,
    onHoofChange: (hoof) => {
      pair = { previous: null, current: null };
      // Choosing another hoof replaces the current entry's hoof value.
      ctx.replace(`/horses/${horse.id}?hoof=${hoof}`);
      void loadComparison();
    },
    onPairChange: (previous, current) => {
      pair = { previous, current };
      void loadComparison();
    },
  });
  stage.setHoof(startingHoof, false);

  const dueLine = el('p', { class: 'num' });
  const visitsHost = el('div', { class: 'section' });
  const openVisitHost = el('div', { class: 'section' });
  const vetHost = el('div', { class: 'section' });

  clear(ctx.main);
  ctx.main.append(
    el('h5', { text: horse.name }),
    dueLine,
    stage.root,
    visitsHost,
    openVisitHost,
    vetHost,
  );

  const loadComparison = async (): Promise<void> => {
    const query = new URLSearchParams({ hoof: stage.hoof() });
    if (pair.previous !== null && pair.current !== null) {
      query.set('previous', pair.previous);
      query.set('current', pair.current);
    }
    try {
      comparison = await api.get<Comparison>(`/api/horses/${horse.id}/comparison?${query.toString()}`);
      stage.setComparison(comparison);
    } catch {
      comparison = null;
      stage.setComparison(null);
    }
  };

  const renderDue = (): void => {
    dueLine.textContent = dueText(horse);
  };

  const renderVisits = (): void => {
    clear(visitsHost);
    const body = el('tbody');
    for (const visit of visits) {
      const status =
        visit.status === 'invoiced' && visit.invoice === null
          ? 'Billed before Clinchline'
          : visit.status === 'invoice_pending'
            ? 'Invoice pending'
            : visit.status === 'invoiced'
              ? 'Invoiced'
              : visit.status === 'open'
                ? 'Open'
                : 'Closing';
      body.append(
        el('tr', {}, [
          el('td', { 'data-label': 'Date', class: 'num', text: visit.business_date }),
          el('td', { 'data-label': 'Status' }, [
            el('span', { class: visit.status === 'invoice_pending' ? 'chip pending' : 'chip', text: status }),
          ]),
          el('td', {
            'data-label': 'Total',
            class: 'amount',
            text: visit.invoice === null ? '' : money(visit.invoice.total_cents),
          }),
        ]),
      );
    }
    visitsHost.append(
      el('table', { class: 'stacked', 'aria-label': 'Visits' }, [
        el('caption', { text: 'Visits' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Date' }),
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Total' }),
          ]),
        ]),
        body,
      ]),
    );
  };

  const refresh = async (): Promise<void> => {
    const [freshHorse, freshVisits] = await Promise.all([
      api.get<Horse>(`/api/horses/${horse.id}`),
      api.get<Visit[]>(`/api/horses/${horse.id}/visits`),
    ]);
    horse = freshHorse;
    visits = freshVisits;
    renderDue();
    renderVisits();
    for (const hoof of HOOVES) {
      const thumb = visits
        .flatMap((visit) => visit.photos)
        .find((photo) => photo.hoof === hoof && photo.phase === 'after' && photo.thumbnail_url !== null);
      stage.setThumbnail(hoof, thumb?.thumbnail_url ?? null);
    }
    await renderOpenVisit();
    await renderVetLinks();
  };

  const renderOpenVisit = async (): Promise<void> => {
    clear(openVisitHost);
    if (ctx.me.role === 'owner') return;
    const open = visits.find((visit) => visit.status === 'open');
    if (open === undefined) return;
    openVisitHost.append(await buildOpenVisitPanel(ctx, open, stage, refresh, loadComparison));
  };

  const renderVetLinks = async (): Promise<void> => {
    clear(vetHost);
    if (ctx.me.role !== 'farrier') return;
    vetHost.append(await buildVetLinks(horse));
  };

  await refresh();
  await loadComparison();
  ctx.onRefresh(refresh, 30000);

  // An open horse panel follows its horse's stream; the divider, pair, hoof and focus
  // stay exactly as they were.
  const stream = openStream(`/api/horses/${horse.id}/events`, {
    onEvent: (event) => {
      void (async (): Promise<void> => {
        if (event.type === 'marks_saved') {
          const data = event.data as { visit_id?: string; hoof?: string } | null;
          if (data?.hoof === stage.hoof() || data?.hoof === undefined) {
            const query = new URLSearchParams({ hoof: stage.hoof() });
            if (pair.previous !== null && pair.current !== null) {
              query.set('previous', pair.previous);
              query.set('current', pair.current);
            }
            try {
              const next = await api.get<Comparison>(`/api/horses/${horse.id}/comparison?${query.toString()}`);
              comparison = next;
              stage.setComparison(next, { keepDivider: true });
            } catch {
              // The pair may no longer be marked; the panel keeps what it has.
            }
          }
        }
        await refresh();
      })();
    },
  });
  ctx.onTeardown(() => stream.close());
}

/* ------------------------------------------------------------ the open visit panel */

async function buildOpenVisitPanel(
  ctx: ScreenContext,
  visit: Visit,
  stage: ReturnType<typeof createStage>,
  refresh: () => Promise<void>,
  reloadComparison: () => Promise<void>,
): Promise<HTMLElement> {
  const host = el('div');
  const hoofPicker = el('select', { 'aria-label': 'Hoof' }) as HTMLSelectElement;
  for (const hoof of HOOVES) hoofPicker.append(el('option', { value: hoof, text: HOOF_NAMES[hoof] as string }));
  hoofPicker.value = stage.hoof();

  const phaseGroup = el('div', { role: 'radiogroup', 'aria-label': 'Phase', class: 'row-actions' });
  const phaseInputs: HTMLInputElement[] = [];
  for (const phase of ['before', 'after'] as const) {
    const input = el('input', {
      type: 'radio',
      name: 'phase',
      value: phase,
      'aria-label': phase === 'before' ? 'Before' : 'After',
    }) as HTMLInputElement;
    input.checked = phase === 'after';
    phaseInputs.push(input);
    phaseGroup.append(el('label', { class: 'inline' }, [input, phase === 'before' ? 'Before' : 'After']));
  }
  const phaseValue = (): 'before' | 'after' =>
    (phaseInputs.find((input) => input.checked)?.value as 'before' | 'after') ?? 'after';

  const fileInput = el('input', { type: 'file', accept: 'image/*', 'aria-label': 'Photo file' }) as HTMLInputElement;
  const uploadButton = el('button', { type: 'button', class: 'primary', text: 'Upload photo' }) as HTMLButtonElement;
  const resumeButton = el('button', { type: 'button', text: 'Resume upload', hidden: true }) as HTMLButtonElement;
  const photosHost = el('div', { class: 'row-actions' });

  const uploadPanel = el('div', { class: 'section' }, [
    el('h6', { text: 'Photos' }),
    el('div', { class: 'inline' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Hoof' }), hoofPicker]),
      el('div', { class: 'field' }, [el('label', { text: 'Phase' }), phaseGroup]),
      el('div', { class: 'field' }, [el('label', { text: 'Photo file' }), fileInput]),
      uploadButton,
      resumeButton,
    ]),
    photosHost,
  ]);

  const renderPhotos = (): void => {
    clear(photosHost);
    for (const photo of visit.photos) {
      const name = `${HOOF_NAMES[photo.hoof] ?? photo.hoof} ${photo.phase}`;
      const remove = el('button', {
        type: 'button',
        text: `Delete ${name} photo`,
      }) as HTMLButtonElement;
      remove.addEventListener('click', () => {
        void (async (): Promise<void> => {
          const handle = pending(remove, copy.deletingPhoto);
          try {
            await api.delete(`/api/photos/${photo.id}`);
            handle.done();
            announceWithToast(copy.photoDeleted(HOOF_NAMES[photo.hoof] ?? photo.hoof, photo.phase));
            await refresh();
            fileInput.focus();
          } catch (error) {
            const failure = error instanceof ApiError ? error.failure : null;
            handle.failed(
              failure !== null && failure.code === 'visit_closed'
                ? copy.visitClosed
                : failureCopy(error, copy.networkFailure),
            );
          }
        })();
      });
      photosHost.append(
        el('div', { class: 'stack' }, [
          el('img', { src: photo.thumbnail_url ?? photo.url, alt: '', width: '96' }),
          el('span', { text: name }),
          remove,
        ]),
      );
    }
  };

  /** Uploads in chunks that continue from the server's stored offset. */
  const uploadSessions = new Map<string, string>();

  const sendChunks = async (sessionId: string, file: File, startOffset: number, chunkBytes: number): Promise<void> => {
    let offset = startOffset;
    while (offset < file.size) {
      const slice = file.slice(offset, Math.min(offset + chunkBytes, file.size));
      const bytes = await slice.arrayBuffer();
      const result = await api.patch<{ offset?: number } & Partial<Photo>>(`/api/uploads/${sessionId}`, {
        raw: bytes,
        contentType: 'application/octet-stream',
        headers: { 'upload-offset': String(offset) },
      });
      offset = typeof result.offset === 'number' ? result.offset : file.size;
      announce(copy.uploadingPhoto(Math.round((offset / file.size) * 100)));
    }
  };

  uploadButton.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const file = fileInput.files?.[0];
      if (file === undefined) return;
      const hoof = hoofPicker.value;
      const phase = phaseValue();
      const sessionKey = `${hoof}:${phase}`;
      const handle = pending(uploadButton, copy.uploadingPhoto(0));
      try {
        const session = await api.post<{ id: string; chunk_bytes: number; offset: number }>(
          `/api/visits/${visit.id}/uploads`,
          { body: { hoof, phase, size_bytes: file.size } },
        );
        uploadSessions.set(sessionKey, session.id);
        await sendChunks(session.id, file, session.offset, session.chunk_bytes);
        uploadSessions.delete(sessionKey);
        handle.done();
        announceWithToast(copy.photoSaved(HOOF_NAMES[hoof] ?? hoof, phase));
        resumeButton.hidden = true;
        await refresh();
        await reloadComparison();
      } catch (error) {
        const failure = error instanceof ApiError ? error.failure : null;
        let message = failureCopy(error, copy.networkFailure);
        if (failure !== null && !failure.network) {
          switch (failure.code) {
            case 'unsupported_image':
              message = copy.photoNotAnImage;
              break;
            case 'photo_too_large':
              message = copy.photoTooLarge;
              break;
            case 'storage_unavailable':
              message = copy.photoStorageDown;
              break;
            case 'visit_quota_exceeded':
              message = copy.quotaExceeded(Number(failure.extra.remaining_bytes ?? 0));
              break;
            case 'upload_expired':
              message = copy.uploadExpired;
              break;
            case 'visit_closed':
              message = copy.visitClosed;
              break;
            default:
              break;
          }
        } else if (failure?.network === true) {
          message = copy.uploadInterrupted(0);
          resumeButton.hidden = false;
        }
        handle.failed(message);
      }
    })();
  });

  resumeButton.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const file = fileInput.files?.[0];
      const sessionId = uploadSessions.get(`${hoofPicker.value}:${phaseValue()}`);
      if (file === undefined || sessionId === undefined) return;
      const handle = pending(resumeButton, copy.uploadingPhoto(0));
      try {
        const session = await api.get<{ offset: number; chunk_bytes: number }>(`/api/uploads/${sessionId}`);
        await sendChunks(sessionId, file, session.offset, session.chunk_bytes);
        handle.done();
        announceWithToast(copy.photoSaved(HOOF_NAMES[hoofPicker.value] ?? hoofPicker.value, phaseValue()));
        resumeButton.hidden = true;
        await refresh();
      } catch (error) {
        handle.failed(failureCopy(error, copy.networkFailure));
      }
    })();
  });

  /** Choosing the same hoof and phase again shows "Resume upload" when a session exists. */
  const syncResume = (): void => {
    resumeButton.hidden = !(
      uploadSessions.has(`${hoofPicker.value}:${phaseValue()}`) && (fileInput.files?.length ?? 0) > 0
    );
  };
  hoofPicker.addEventListener('change', syncResume);
  fileInput.addEventListener('change', syncResume);
  for (const input of phaseInputs) input.addEventListener('change', syncResume);

  renderPhotos();

  const marksPanel = buildMarksPanel(visit, stage, reloadComparison);
  host.append(uploadPanel, marksPanel);

  if (ctx.me.role === 'farrier') host.append(buildClosePanel(visit, refresh));
  return host;
}

/* ------------------------------------------------------------------- marks form */

function buildMarksPanel(
  visit: Visit,
  stage: ReturnType<typeof createStage>,
  reloadComparison: () => Promise<void>,
): HTMLElement {
  const host = el('div', { class: 'section' });
  let version: number | null = null;
  let armed: 'hoof_wall' | 'pastern' | null = null;
  let armedPoint: 0 | 1 = 0;

  const makeGroup = (label: string, key: 'hoof_wall' | 'pastern') => {
    const inputs: Record<string, HTMLInputElement> = {};
    const fields: HTMLElement[] = [];
    for (const point of ['Start x', 'Start y', 'End x', 'End y']) {
      const input = el('input', { type: 'number', 'aria-label': point, value: '' }) as HTMLInputElement;
      input.addEventListener('input', () => drawPreview());
      inputs[point] = input;
      fields.push(el('div', { class: 'field' }, [el('label', { text: point }), input]));
    }
    const group = el('div', { role: 'group', 'aria-label': label, class: 'inline' }, fields);
    return { group, inputs, key };
  };

  const wall = makeGroup('Hoof wall line', 'hoof_wall');
  const pastern = makeGroup('Pastern line', 'pastern');

  const readLine = (inputs: Record<string, HTMLInputElement>): { x1: number; y1: number; x2: number; y2: number } => ({
    x1: Number(inputs['Start x']?.value ?? 0),
    y1: Number(inputs['Start y']?.value ?? 0),
    x2: Number(inputs['End x']?.value ?? 0),
    y2: Number(inputs['End y']?.value ?? 0),
  });

  const writeLine = (
    inputs: Record<string, HTMLInputElement>,
    line: { x1: number; y1: number; x2: number; y2: number } | null,
  ): void => {
    const values = line === null ? ['', '', '', ''] : [line.x1, line.y1, line.x2, line.y2].map(String);
    (['Start x', 'Start y', 'End x', 'End y'] as const).forEach((point, index) => {
      const input = inputs[point];
      if (input !== undefined) input.value = values[index] as string;
    });
  };

  const drawPreview = (): void => {
    // Typing in the spinbuttons moves the drawn line live.
    const layer = stage.currentLayer();
    if (layer === null) return;
    const lines = layer.querySelectorAll('line');
    const wallLine = readLine(wall.inputs);
    const pasternLine = readLine(pastern.inputs);
    const apply = (index: number, line: { x1: number; y1: number; x2: number; y2: number }): void => {
      for (const offset of [0, 1]) {
        const node = lines[index * 2 + offset];
        if (node === undefined) continue;
        node.setAttribute('x1', String(line.x1));
        node.setAttribute('y1', String(line.y1));
        node.setAttribute('x2', String(line.x2));
        node.setAttribute('y2', String(line.y2));
      }
    };
    if (Number.isFinite(wallLine.x1)) apply(0, wallLine);
    if (Number.isFinite(pasternLine.x1)) apply(1, pasternLine);
  };

  const markWall = el('button', { type: 'button', text: 'Mark hoof wall' }) as HTMLButtonElement;
  const markPastern = el('button', { type: 'button', text: 'Mark pastern' }) as HTMLButtonElement;
  const save = el('button', { type: 'button', class: 'primary', text: 'Save marks' }) as HTMLButtonElement;
  markWall.addEventListener('click', () => {
    armed = 'hoof_wall';
    armedPoint = 0;
  });
  markPastern.addEventListener('click', () => {
    armed = 'pastern';
    armedPoint = 0;
  });

  // The next two clicks on the after photo set the start and end point, in the stored
  // photo's own pixel coordinates.
  stage.stageElement.addEventListener('click', (event) => {
    if (armed === null) return;
    const layer = stage.currentLayer();
    if (layer === null) return;
    const point = layer.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = layer.getScreenCTM();
    if (matrix === null) return;
    const local = point.matrixTransform(matrix.inverse());
    const target = armed === 'hoof_wall' ? wall.inputs : pastern.inputs;
    const keys = armedPoint === 0 ? (['Start x', 'Start y'] as const) : (['End x', 'End y'] as const);
    const xInput = target[keys[0]];
    const yInput = target[keys[1]];
    if (xInput !== undefined) xInput.value = String(Math.round(local.x));
    if (yInput !== undefined) yInput.value = String(Math.round(local.y));
    if (armedPoint === 0) armedPoint = 1;
    else armed = null;
    drawPreview();
  });

  document.addEventListener('keydown', (event) => {
    // Escape disarms marking without changing the values.
    if (event.key === 'Escape' && armed !== null) armed = null;
  });

  const historyHost = el('div');

  const loadMarks = async (): Promise<void> => {
    const hoof = stage.hoof();
    const fresh = await api.get<Visit>(`/api/visits/${visit.id}`);
    const marks = fresh.marks.find((entry) => entry.hoof === hoof) ?? null;
    version = marks?.version ?? null;
    writeLine(wall.inputs, marks?.hoof_wall ?? null);
    writeLine(pastern.inputs, marks?.pastern ?? null);
    await loadHistory();
  };

  const loadHistory = async (): Promise<void> => {
    clear(historyHost);
    const history = await api
      .get<HoofMarks[]>(`/api/visits/${visit.id}/hooves/${stage.hoof()}/marks/history`)
      .catch(() => [] as HoofMarks[]);
    const body = el('tbody');
    for (const entry of history) {
      const restore = el('button', {
        type: 'button',
        text: `Restore version ${entry.version}`,
      }) as HTMLButtonElement;
      restore.addEventListener('click', () => {
        void (async (): Promise<void> => {
          const handle = pending(restore, copy.restoringMarks);
          try {
            const result = await api.post<HoofMarks>(
              `/api/visits/${visit.id}/hooves/${stage.hoof()}/marks/restore`,
              { body: { version, restore_version: entry.version } },
            );
            handle.done();
            announceWithToast(copy.marksRestored(entry.version, result.version));
            version = result.version;
            writeLine(wall.inputs, result.hoof_wall);
            writeLine(pastern.inputs, result.pastern);
            await loadHistory();
            await reloadComparison();
            historyHost.querySelector('tbody tr:last-child button')?.dispatchEvent(new Event('focus'));
            (historyHost.querySelector('tbody tr:last-child button') as HTMLElement | null)?.focus();
          } catch (error) {
            await handleMarksFailure(error, handle.failed);
          }
        })();
      });
      body.append(
        el('tr', {}, [
          el('td', { 'data-label': 'Version', class: 'num', text: String(entry.version) }),
          el('td', { 'data-label': 'Hoof wall', class: 'angle', text: `${entry.hoof_wall.angle.toFixed(1)}\u00b0` }),
          el('td', { 'data-label': 'Pastern', class: 'angle', text: `${entry.pastern.angle.toFixed(1)}\u00b0` }),
          el('td', { 'data-label': 'Alignment', text: entry.alignment }),
          el('td', { 'data-label': 'Saved by', text: entry.saved_by?.name ?? '' }),
          el('td', { 'data-label': 'Saved at', class: 'num', text: (entry.saved_at ?? '').slice(11, 19) }),
          el('td', { 'data-label': 'Restore' }, [restore]),
        ]),
      );
    }
    historyHost.append(
      el('table', { class: 'stacked', 'aria-label': 'Marks history' }, [
        el('caption', { text: 'Marks history' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Version' }),
            el('th', { scope: 'col', text: 'Hoof wall' }),
            el('th', { scope: 'col', text: 'Pastern' }),
            el('th', { scope: 'col', text: 'Alignment' }),
            el('th', { scope: 'col', text: 'Saved by' }),
            el('th', { scope: 'col', text: 'Saved at' }),
            el('th', { scope: 'col', text: 'Restore' }),
          ]),
        ]),
        body,
      ]),
    );
  };

  const handleMarksFailure = async (
    error: unknown,
    fail: (message: string) => void,
  ): Promise<void> => {
    const failure = error instanceof ApiError ? error.failure : null;
    if (failure !== null && failure.code === 'stale_marks') {
      // The form switches to the marks the server returned and takes their version.
      const current = failure.extra.current as HoofMarks | null;
      version = current?.version ?? null;
      writeLine(wall.inputs, current?.hoof_wall ?? null);
      writeLine(pastern.inputs, current?.pastern ?? null);
      drawPreview();
      fail(copy.staleMarks(HOOF_NAMES[stage.hoof()] ?? stage.hoof()));
      wall.inputs['Start x']?.focus();
      await loadHistory();
      return;
    }
    if (failure !== null && failure.code === 'photo_required') {
      fail(copy.photoRequired);
      return;
    }
    if (failure !== null && failure.code === 'visit_closed') {
      fail(copy.visitClosed);
      return;
    }
    if (failure !== null && failure.code === 'validation') {
      fail(Object.values(failure.errors ?? {})[0] ?? copy.networkFailure);
      return;
    }
    fail(failureCopy(error, copy.networkFailure));
  };

  save.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const handle = pending(save, copy.savingMarks);
      try {
        const result = await api.put<HoofMarks>(`/api/visits/${visit.id}/hooves/${stage.hoof()}/marks`, {
          body: { version, hoof_wall: readLine(wall.inputs), pastern: readLine(pastern.inputs) },
        });
        version = result.version;
        handle.done();
        announceWithToast(
          copy.marksSaved(result.hoof_wall.angle.toFixed(1), result.pastern.angle.toFixed(1), result.alignment),
        );
        await loadHistory();
        await reloadComparison();
      } catch (error) {
        await handleMarksFailure(error, handle.failed);
      }
    })();
  });

  host.append(
    el('h6', { text: 'Marks' }),
    wall.group,
    pastern.group,
    el('div', { class: 'row-actions' }, [markWall, markPastern, save]),
    historyHost,
  );
  void loadMarks();
  return host;
}

/* ----------------------------------------------------------------- close the visit */

function buildClosePanel(visit: Visit, refresh: () => Promise<void>): HTMLElement {
  const checks: HTMLInputElement[] = [];
  const group = el('div', { role: 'group', 'aria-label': 'Work done', class: 'stack' });
  for (const [code, label] of Object.entries(WORK_LABELS)) {
    const input = el('input', { type: 'checkbox', value: code, 'aria-label': label }) as HTMLInputElement;
    checks.push(input);
    group.append(el('label', { class: 'inline' }, [input, label]));
  }
  const note = el('input', { type: 'text', 'aria-label': 'Visit note', maxlength: '500' }) as HTMLInputElement;
  const close = el('button', { type: 'button', class: 'primary', text: 'Close visit' }) as HTMLButtonElement;

  close.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const work = checks.filter((input) => input.checked).map((input) => input.value);
      const handle = pending(close, copy.closingVisit);
      try {
        const closed = await api.post<Visit>(`/api/visits/${visit.id}/close`, {
          body: { work, note: note.value === '' ? undefined : note.value },
          idempotencyKey: newIdempotencyKey(),
        });
        handle.done();
        announceWithToast(
          closed.status === 'invoiced' && closed.invoice !== null
            ? copy.visitInvoiced(money(closed.invoice.total_cents).slice(1))
            : copy.visitPending,
        );
        await refresh();
      } catch (error) {
        const failure = error instanceof ApiError ? error.failure : null;
        let message = failureCopy(error, copy.networkFailure);
        if (failure !== null && !failure.network) {
          if (failure.code === 'idempotency_in_progress') message = copy.closeInProgress;
          else if (failure.code === 'illegal_transition') message = copy.visitAlreadyClosed;
          else if (failure.code === 'photos_required') message = copy.photoRequired;
          else if (failure.code === 'validation') {
            message = Object.values(failure.errors ?? {})[0] ?? message;
          }
        }
        handle.failed(message);
        await refresh();
      }
    })();
  });

  return el('div', { class: 'section' }, [
    el('h6', { text: 'Work done' }),
    group,
    el('div', { class: 'field' }, [el('label', { text: 'Visit note' }), note]),
    close,
  ]);
}

/* -------------------------------------------------------------------- vet links */

async function buildVetLinks(horse: Horse): Promise<HTMLElement> {
  const host = el('div');
  const send = el('button', { type: 'button', text: 'Send vet link' }) as HTMLButtonElement;
  const tableHost = el('div');

  send.addEventListener('click', () => {
    const name = el('input', { type: 'text', 'aria-label': 'Vet name' }) as HTMLInputElement;
    const email = el('input', { type: 'text', 'aria-label': 'Vet email' }) as HTMLInputElement;
    const sendLink = el('button', { type: 'button', class: 'primary', text: 'Send link' }) as HTMLButtonElement;
    const cancel = el('button', { type: 'button', text: 'Cancel' }) as HTMLButtonElement;
    const dialog = openDialog({
      title: 'Send vet link',
      body: [
        el('div', { class: 'field' }, [el('label', { text: 'Vet name' }), name]),
        el('div', { class: 'field' }, [el('label', { text: 'Vet email' }), email]),
        el('div', { class: 'actions' }, [sendLink, cancel]),
      ],
      initialFocus: () => name,
      opener: send,
    });
    cancel.addEventListener('click', () => dialog.close());
    sendLink.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const handle = pending(sendLink, copy.sendingLink);
        try {
          await api.post(`/api/horses/${horse.id}/vet-links`, {
            body: { vet_name: name.value, vet_email: email.value },
          });
          handle.done();
          dialog.close();
          announceWithToast(copy.linkSent(email.value));
          await renderTable();
        } catch (error) {
          const failure = error instanceof ApiError ? error.failure : null;
          let message = failureCopy(error, copy.networkFailure);
          if (failure !== null && failure.code === 'not_enough_visits') message = copy.needsTwoVisits;
          else if (failure !== null && failure.code === 'validation') {
            message = Object.values(failure.errors ?? {})[0] ?? message;
          }
          handle.failed(message);
        }
      })();
    });
  });

  const renderTable = async (): Promise<void> => {
    clear(tableHost);
    const links = await api.get<VetLink[]>(`/api/horses/${horse.id}/vet-links`);
    const body = el('tbody');
    for (const link of links) {
      const revoke = el('button', {
        type: 'button',
        text: `Revoke link to ${link.vet_email}`,
      }) as HTMLButtonElement;
      revoke.addEventListener('click', () => {
        void (async (): Promise<void> => {
          const handle = pending(revoke, copy.revoking);
          try {
            await api.post(`/api/vet-links/${link.id}/revoke`, { body: {} });
            handle.done();
            announceWithToast(copy.linkRevoked);
            await renderTable();
          } catch (error) {
            handle.failed(failureCopy(error, copy.networkFailure));
          }
        })();
      });
      const regenerate = el('button', {
        type: 'button',
        text: `Regenerate link to ${link.vet_email}`,
      }) as HTMLButtonElement;
      regenerate.addEventListener('click', () => {
        void (async (): Promise<void> => {
          const handle = pending(regenerate, copy.sendingNewLink);
          try {
            await api.post(`/api/vet-links/${link.id}/regenerate`, { body: {} });
            handle.done();
            announceWithToast(copy.newLinkSent(link.vet_email));
            await renderTable();
          } catch (error) {
            handle.failed(failureCopy(error, copy.networkFailure));
          }
        })();
      });
      const views = el('button', { type: 'button', text: `Views for ${link.vet_email}` }) as HTMLButtonElement;
      views.addEventListener('click', () => {
        void (async (): Promise<void> => {
          const rows = await api.get<VetLinkView[]>(`/api/vet-links/${link.id}/views`);
          openDialog({
            title: `Views for ${link.vet_email}`,
            body: [
              el('table', { class: 'stacked', 'aria-label': 'Link views' }, [
                el('caption', { text: 'Link views' }),
                el('thead', {}, [
                  el('tr', {}, [
                    el('th', { scope: 'col', text: 'At' }),
                    el('th', { scope: 'col', text: 'Address' }),
                    el('th', { scope: 'col', text: 'Outcome' }),
                    el('th', { scope: 'col', text: 'Pair' }),
                    el('th', { scope: 'col', text: 'User agent' }),
                  ]),
                ]),
                el(
                  'tbody',
                  {},
                  rows.map((view) =>
                    el('tr', {}, [
                      el('td', { 'data-label': 'At', class: 'num', text: view.at }),
                      el('td', { 'data-label': 'Address', text: view.address }),
                      el('td', { 'data-label': 'Outcome', text: view.outcome }),
                      el('td', {
                        'data-label': 'Pair',
                        class: 'num',
                        text:
                          view.outcome === 'viewed' && view.previous_date !== null
                            ? `${view.previous_date} \u2192 ${view.current_date}`
                            : '',
                      }),
                      el('td', { 'data-label': 'User agent', text: view.user_agent }),
                    ]),
                  ),
                ),
              ]),
            ],
            opener: views,
          });
        })();
      });

      body.append(
        el('tr', {}, [
          el('td', { 'data-label': 'Vet', text: link.vet_name }),
          el('td', { 'data-label': 'Email', text: link.vet_email }),
          el('td', { 'data-label': 'Status' }, [el('span', { class: 'chip', text: link.status })]),
          el('td', {
            'data-label': 'Pair',
            class: 'num',
            text:
              link.previous_date === null ? '' : `${link.previous_date} \u2192 ${link.current_date}`,
          }),
          el('td', { 'data-label': 'Views', class: 'num', text: String(link.view_count) }),
          el('td', { 'data-label': 'Actions' }, [el('div', { class: 'row-actions' }, [revoke, regenerate, views])]),
        ]),
      );
    }
    tableHost.append(
      el('table', { class: 'stacked', 'aria-label': 'Vet links' }, [
        el('caption', { text: 'Vet links' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Vet' }),
            el('th', { scope: 'col', text: 'Email' }),
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Pair' }),
            el('th', { scope: 'col', text: 'Views' }),
            el('th', { scope: 'col', text: 'Actions' }),
          ]),
        ]),
        body,
      ]),
    );
  };

  await renderTable();
  host.append(el('h6', { text: 'Vet links' }), send, tableHost);
  return host;
}
