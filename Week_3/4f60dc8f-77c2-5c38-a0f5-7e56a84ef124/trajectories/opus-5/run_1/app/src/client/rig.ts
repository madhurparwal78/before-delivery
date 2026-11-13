import {
  SHOT_ORDER,
  UNIT_SCALE,
  type EngagementView,
  type IntakeFileView,
  type QuoteView,
  type Service,
  type UnitDecision,
} from '../shared/domain.js';
import { formatMoney, type CurrencyCode } from '../shared/money.js';
import {
  FX_LINE_GBP,
  degrees,
  fullReadout,
  fxLineIndicative,
  fxLineLocked,
  metreReadout,
} from '../shared/format.js';
import { MEASUREMENT_FAILED_COPY, SCALE_EMPTY_COPY } from '../shared/errors.js';
import {
  announce,
  api,
  createDialog,
  pending,
  qs,
  qsa,
  reducedMotion,
  setFieldErrors,
  tween,
} from './core.js';
import { initOutage } from './chrome.js';
import { initRigScene, type RigShot } from './scenes.js';

export type RigBootstrap = {
  engagement: EngagementView;
  services: Service[];
  finance_email: string;
};

type Phase = 'flying' | 'focusing' | 'cut' | 'counting' | 'idle';
type ShotCode = (typeof SHOT_ORDER)[number];

const FIGURES = ['subtotal', 'vat', 'total', 'deposit', 'look_dev', 'final_delivery'] as const;
type FigureKey = (typeof FIGURES)[number];
const COUNTED: FigureKey[] = ['total', 'deposit', 'look_dev', 'final_delivery'];

const figureValue = (quote: QuoteView, key: FigureKey): number => {
  switch (key) {
    case 'subtotal':
      return quote.subtotal_minor;
    case 'vat':
      return quote.vat_minor;
    case 'total':
      return quote.total_minor;
    case 'deposit':
      return quote.milestones.deposit_minor;
    case 'look_dev':
      return quote.milestones.look_dev_minor;
    case 'final_delivery':
      return quote.milestones.final_delivery_minor;
  }
};

export const initRig = (data: RigBootstrap): void => {
  const page = qs<HTMLElement>('[data-rig-page]');
  const group = qs<HTMLElement>('[data-rig]');
  const pipElement = qs<HTMLElement>('[data-pip]');
  if (page === null || group === null || pipElement === null) return;

  const engagementId = page.dataset.rigPage ?? '';
  const outage = initOutage('rig');
  const currency = data.engagement.quote.currency as CurrencyCode;
  const financeEmail = data.finance_email;

  const uploadRegion = qs<HTMLElement>('[data-upload-progress]');
  const quoteRegion = qs<HTMLElement>('[data-quote-updates]');
  const focusRegion = qs<HTMLElement>('[data-rig-focus]');
  const quoteBlock = qs<HTMLElement>('[data-quote-region]');
  const fxLine = qs<HTMLElement>('[data-fx-line]');
  const positions = qs<HTMLElement>('[data-shot-positions]');
  const scaleRegion = qs<HTMLElement>('[data-product-scale]');
  const intakeList = qs<HTMLElement>('[data-intake-files]');
  const quoteBarTotal = qs<HTMLElement>('[data-quote-bar-total]');
  const depositSuccess = qs<HTMLElement>('[data-deposit-success]');

  const shots: RigShot[] = SHOT_ORDER.map((code) => {
    const service = data.services.find((entry) => entry.code === code);
    return {
      code,
      title: service?.title ?? code,
      azimuth: service?.azimuth_deg ?? 0,
      elevation: service?.elevation_deg ?? 0,
    };
  });

  const rigScene = initRigScene(group, pipElement, shots);

  let quote: QuoteView = data.engagement.quote;
  let files: IntakeFileView[] = data.engagement.files;
  let applied = false;
  let phase: Phase = 'idle';
  let stopCount: (() => void) | null = null;

  const desired = new Set<string>(quote.lines.map((line) => line.shot_code));
  const placed = new Set<string>(desired);
  const animating = new Set<string>();
  const pipStack: string[] = SHOT_ORDER.filter((code) => desired.has(code));
  let focused: ShotCode = (pipStack.at(-1) as ShotCode | undefined) ?? SHOT_ORDER[0];

  const inFlight = new Set<string>();
  const waiting = new Map<string, number | null>();

  const titleOf = (code: string): string =>
    quote.lines.find((entry) => entry.shot_code === code)?.title ??
    shots.find((shot) => shot.code === code)?.title ??
    code;

  const setPhase = (next: Phase): void => {
    phase = next;
    group.dataset.rigPhase = next;
  };

  const syncFrustums = (): void => {
    group.dataset.frustumCount = String(placed.size);
    rigScene.setSelection([...placed]);
  };

  const setPip = (): void => {
    const code = pipStack.at(-1) ?? 'overview';
    pipElement.dataset.pipShot = code;
    const label = qs<HTMLElement>('[data-pip-label]', pipElement);
    if (label !== null) label.textContent = code === 'overview' ? 'Overview' : titleOf(code);
    rigScene.setPip(code);
  };

  const setFocused = (code: ShotCode): void => {
    focused = code;
    group.dataset.focusedShot = code;
    rigScene.setFocused(code);
    const shot = shots.find((entry) => entry.code === code);
    if (shot === undefined) return;
    announce(
      focusRegion,
      `${titleOf(code)}, azimuth ${degrees(shot.azimuth)}, elevation ${degrees(shot.elevation)}, ${
        desired.has(code) ? 'selected' : 'not selected'
      }`,
    );
  };

  const paintFigures = (): void => {
    for (const key of FIGURES) {
      const node = qs<HTMLElement>(`[data-quote="${key}"]`);
      if (node === null) continue;
      node.dataset.valueMinor = String(figureValue(quote, key));
    }
    if (quoteBlock !== null) quoteBlock.dataset.quoteRevision = String(quote.revision);
    if (fxLine !== null)
      fxLine.textContent =
        currency === 'GBP'
          ? FX_LINE_GBP
          : quote.fx_locked && quote.fx_locked_at !== null
            ? fxLineLocked(quote.fx_rate, quote.fx_locked_at)
            : fxLineIndicative(quote.fx_rate);
    if (quoteBarTotal !== null)
      quoteBarTotal.textContent = formatMoney(BigInt(quote.total_minor), currency);
  };

  const writeNumerals = (): void => {
    for (const key of FIGURES) {
      const node = qs<HTMLElement>(`[data-quote="${key}"]`);
      if (node !== null) node.textContent = formatMoney(BigInt(figureValue(quote, key)), currency);
    }
  };

  const countNumerals = (from: Map<FigureKey, number>): void => {
    stopCount?.();
    for (const key of FIGURES)
      if (!COUNTED.includes(key)) {
        const node = qs<HTMLElement>(`[data-quote="${key}"]`);
        if (node !== null) node.textContent = formatMoney(BigInt(figureValue(quote, key)), currency);
      }
    const targets = new Map<FigureKey, number>();
    for (const key of COUNTED) targets.set(key, figureValue(quote, key));
    setPhase('counting');
    stopCount = tween(
      600,
      (progress) => {
        for (const key of COUNTED) {
          const node = qs<HTMLElement>(`[data-quote="${key}"]`);
          if (node === null) continue;
          const start = from.get(key) ?? 0;
          const end = targets.get(key) ?? 0;
          node.textContent = formatMoney(
            BigInt(Math.round(start + (end - start) * progress)),
            currency,
          );
        }
      },
      () => {
        writeNumerals();
        stopCount = null;
        setPhase('idle');
      },
    );
  };

  const paintControls = (): void => {
    for (const code of SHOT_ORDER) {
      const line = quote.lines.find((entry) => entry.shot_code === code);
      const checkbox = qs<HTMLInputElement>(`[data-shot-checkbox="${code}"]`);
      const spin = qs<HTMLInputElement>(`[data-colourways="${code}"]`);
      const label = qs<HTMLElement>(`label[for="shot-${code}"]`);
      const keepUserValue = waiting.has(code);
      if (checkbox !== null && !keepUserValue) checkbox.checked = line !== undefined;
      if (label !== null) label.textContent = titleOf(code);
      if (spin !== null) {
        spin.setAttribute('aria-label', `Colourways for ${titleOf(code)}`);
        spin.hidden = line === undefined && !keepUserValue;
        if (!keepUserValue && line !== undefined) spin.value = String(line.quantity);
      }
    }
    if (positions === null) return;
    for (const code of SHOT_ORDER) {
      const row = qs<HTMLElement>(`[data-shot-row="${code}"]`, positions);
      if (row === null) continue;
      const cells = qsa<HTMLElement>('td', row);
      const line = quote.lines.find((entry) => entry.shot_code === code);
      const service = data.services.find((entry) => entry.code === code);
      if (cells[0] !== undefined) cells[0].textContent = titleOf(code);
      if (cells[3] !== undefined)
        cells[3].textContent = formatMoney(
          BigInt(line?.unit_price_gbp_minor ?? service?.list_price_pence ?? 0),
          'GBP',
        );
      if (cells[4] !== undefined) cells[4].textContent = line === undefined ? 'No' : 'Yes';
    }
  };

  const runSelectSequence = (code: string): void => {
    animating.add(code);
    if (reducedMotion()) {
      placed.add(code);
      if (!pipStack.includes(code)) pipStack.push(code);
      syncFrustums();
      setPip();
      animating.delete(code);
      setPhase('idle');
      return;
    }
    setPhase('flying');
    tween(600, () => undefined, () => {
      placed.add(code);
      syncFrustums();
      setPhase('focusing');
      tween(300, () => undefined, () => {
        setPhase('cut');
        if (!pipStack.includes(code)) pipStack.push(code);
        setPip();
        animating.delete(code);
        if (phase === 'cut') setPhase('idle');
      });
    });
  };

  const runDeselectSequence = (code: string): void => {
    animating.add(code);
    const wasShown = pipStack.at(-1) === code;
    const index = pipStack.indexOf(code);
    if (index !== -1) pipStack.splice(index, 1);
    if (reducedMotion()) {
      placed.delete(code);
      syncFrustums();
      if (wasShown) setPip();
      animating.delete(code);
      setPhase('idle');
      return;
    }
    if (wasShown) {
      setPhase('cut');
      setPip();
    }
    setPhase('focusing');
    tween(300, () => undefined, () => {
      setPhase('flying');
      tween(600, () => undefined, () => {
        placed.delete(code);
        syncFrustums();
        animating.delete(code);
        if (phase === 'flying') setPhase('idle');
      });
    });
  };

  const reconcile = (): void => {
    for (const code of SHOT_ORDER) {
      if (animating.has(code)) continue;
      if (desired.has(code) && !placed.has(code)) runSelectSequence(code);
      else if (!desired.has(code) && placed.has(code)) runDeselectSequence(code);
    }
  };

  const applyQuote = (next: QuoteView, options: { force?: boolean } = {}): void => {
    if (applied && options.force !== true && next.revision <= quote.revision) return;
    const from = new Map<FigureKey, number>();
    for (const key of COUNTED) from.set(key, figureValue(quote, key));
    const firstApply = !applied;
    applied = true;
    quote = next;

    desired.clear();
    for (const line of quote.lines) desired.add(line.shot_code);

    paintFigures();
    paintControls();
    reconcile();
    setPip();
    if (reducedMotion() || firstApply) {
      writeNumerals();
      setPhase('idle');
    } else {
      countNumerals(from);
    }
    announce(
      quoteRegion,
      `Quote updated: total ${formatMoney(BigInt(quote.total_minor), currency)}, deposit ${formatMoney(
        BigInt(quote.milestones.deposit_minor),
        currency,
      )}.`,
    );
  };

  const readEngagement = async (): Promise<EngagementView | null> => {
    const result = await api<EngagementView>(`/api/engagements/${engagementId}`);
    if (!result.ok) {
      outage.noteFromError(result.body.error);
      return null;
    }
    files = result.body.files;
    paintIntake();
    return result.body;
  };

  const sendChange = async (code: string, quantity: number | null): Promise<void> => {
    inFlight.add(code);
    const result =
      quantity === null
        ? await api<QuoteView>(`/api/engagements/${engagementId}/quote/lines/${code}`, {
            method: 'DELETE',
          })
        : await api<QuoteView>(`/api/engagements/${engagementId}/quote/lines/${code}`, {
            method: 'PUT',
            body: { quantity },
          });
    inFlight.delete(code);

    if (result.ok) {
      applyQuote(result.body);
    } else {
      outage.noteFromError(result.body.error);
      announce(quoteRegion, result.body.message ?? 'That change was refused.');
      waiting.delete(code);
      const engagement = await readEngagement();
      if (engagement !== null) applyQuote(engagement.quote, { force: true });
    }

    if (waiting.has(code)) {
      const next = waiting.get(code) ?? null;
      waiting.delete(code);
      await sendChange(code, next);
    }
  };

  const queueChange = (code: string, quantity: number | null): void => {
    if (inFlight.has(code)) {
      waiting.set(code, quantity);
      return;
    }
    void sendChange(code, quantity);
  };

  const toggleShot = (code: string, selected: boolean): void => {
    if (selected) {
      desired.add(code);
      runSelectSequence(code);
      queueChange(code, 1);
    } else {
      desired.delete(code);
      runDeselectSequence(code);
      queueChange(code, null);
    }
  };

  for (const code of SHOT_ORDER) {
    const checkbox = qs<HTMLInputElement>(`[data-shot-checkbox="${code}"]`);
    checkbox?.addEventListener('change', () => {
      setFocused(code);
      toggleShot(code, checkbox.checked);
    });
    const spin = qs<HTMLInputElement>(`[data-colourways="${code}"]`);
    const commit = (): void => {
      if (spin === null) return;
      const value = Math.min(6, Math.max(1, Math.round(Number(spin.value) || 1)));
      spin.value = String(value);
      queueChange(code, value);
    };
    spin?.addEventListener('change', commit);
    spin?.addEventListener('blur', commit);
    spin?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit();
    });
  }

  const RESET_SELECTORS = [
    '[data-rig]',
    '[data-shot-checkbox]',
    '[data-upload-button]',
    '[data-check-unit]',
    '[data-pay-deposit]',
  ].join(',');

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'r' && event.key !== 'R') return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active.matches('input, textarea, select')) {
      if (!active.matches('[data-shot-checkbox]')) return;
    }
    if (!active.matches(RESET_SELECTORS)) return;
    event.preventDefault();
    group.dataset.orbitAzimuth = '0';
    rigScene.setAzimuth(0);
  });

  group.addEventListener('keydown', (event) => {
    const index = SHOT_ORDER.indexOf(focused);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setFocused(SHOT_ORDER[(index + 1) % SHOT_ORDER.length]);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setFocused(SHOT_ORDER[(index - 1 + SHOT_ORDER.length) % SHOT_ORDER.length]);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      const checkbox = qs<HTMLInputElement>(`[data-shot-checkbox="${focused}"]`);
      if (checkbox === null) return;
      checkbox.checked = !checkbox.checked;
      toggleShot(focused, checkbox.checked);
    }
  });

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragAzimuth = 0;
  let axis: 'none' | 'horizontal' | 'vertical' = 'none';

  group.addEventListener('pointerdown', (event) => {
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragAzimuth = rigScene.azimuth();
    axis = event.pointerType === 'touch' ? 'none' : 'horizontal';
  });
  group.addEventListener(
    'pointermove',
    (event) => {
      if (!dragging) return;
      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      if (axis === 'none') {
        if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
        axis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'horizontal' : 'vertical';
      }
      if (axis !== 'horizontal') return;
      event.preventDefault();
      const whole = ((Math.round(dragAzimuth + deltaX * 0.5) % 360) + 360) % 360;
      group.dataset.orbitAzimuth = String(whole);
      rigScene.setAzimuth(whole);
    },
    { passive: false },
  );
  for (const name of ['pointerup', 'pointercancel', 'pointerleave'] as const)
    group.addEventListener(name, () => {
      dragging = false;
      axis = 'none';
    });

  const currentModel = (): IntakeFileView | undefined =>
    [...files].reverse().find((file) => file.kind === 'model' && file.status === 'received');

  const paintScale = (): void => {
    const model = currentModel();
    if (scaleRegion === null) return;
    if (model === undefined || model.dimensions_m === null || model.unit === null) {
      scaleRegion.textContent = SCALE_EMPTY_COPY;
      return;
    }
    const metres = {
      x: String(model.dimensions_m.x),
      y: String(model.dimensions_m.y),
      z: String(model.dimensions_m.z),
    };
    scaleRegion.textContent = fullReadout(metres, model.unit);
    rigScene.setModel({
      widthM: model.dimensions_m.x,
      heightM: model.dimensions_m.y,
      depthM: model.dimensions_m.z,
      unitScale: UNIT_SCALE[model.unit],
      url: `/api/engagements/${engagementId}/files/${model.id}/content`,
    });
  };

  const statusWord = (file: IntakeFileView): string =>
    file.status === 'superseded'
      ? 'Superseded'
      : file.measurement === 'failed'
        ? 'Rejected'
        : 'Received';

  const noteWord = (file: IntakeFileView): string => {
    if (file.kind !== 'model' || currentModel()?.id !== file.id) return '';
    if (file.measurement === 'measured') return 'Measured';
    if (file.measurement === 'delayed') return 'Measuring is delayed';
    if (file.measurement === 'failed') return MEASUREMENT_FAILED_COPY;
    return 'Measuring';
  };

  type PendingRow = { id: string; name: string; size: number; status: string };
  const pendingRows: PendingRow[] = [];

  const paintIntake = (): void => {
    if (intakeList === null) return;
    intakeList.innerHTML = '';
    for (const file of files) {
      const row = document.createElement('li');
      row.dataset.file = file.id;
      row.dataset.kind = file.kind;
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = file.name;
      const size = document.createElement('span');
      size.className = 'file-size numeral';
      size.textContent = String(file.size_bytes);
      const status = document.createElement('span');
      status.className = 'file-status';
      status.textContent = statusWord(file);
      row.append(name, size, status);
      const note = noteWord(file);
      if (note !== '') {
        const noteNode = document.createElement('span');
        noteNode.className = 'file-note';
        noteNode.textContent = note;
        row.append(noteNode);
      }
      if (file.needs_unit_confirmation) {
        const check = document.createElement('button');
        check.type = 'button';
        check.dataset.checkUnit = file.id;
        check.textContent = 'Check unit';
        check.addEventListener('click', () => openUnitDialog(file, check));
        row.append(check);
      }
      intakeList.append(row);
    }
    for (const entry of pendingRows) {
      const row = document.createElement('li');
      row.dataset.file = entry.id;
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = entry.name;
      const size = document.createElement('span');
      size.className = 'file-size numeral';
      size.textContent = String(entry.size);
      const status = document.createElement('span');
      status.className = 'file-status';
      if (entry.status === 'Not saved') status.dataset.status = 'not_saved';
      status.textContent = entry.status;
      row.append(name, size, status);
      intakeList.append(row);
    }
    paintScale();
  };

  const unitDialogElement = qs<HTMLElement>('[data-unit-dialog]');
  let unitFile: IntakeFileView | null = null;
  const unitDialog = unitDialogElement === null ? null : createDialog(unitDialogElement);

  const openUnitDialog = (file: IntakeFileView, opener: HTMLElement | null): void => {
    if (unitDialog === null) return;
    unitFile = file;
    const asExported = qs<HTMLElement>('[data-as-exported]', unitDialog.element);
    if (asExported !== null && file.dimensions_m !== null)
      asExported.textContent = metreReadout({
        x: String(file.dimensions_m.x),
        y: String(file.dimensions_m.y),
        z: String(file.dimensions_m.z),
      });
    unitDialog.open(opener);
  };

  qs<HTMLButtonElement>('[data-unit-confirm]')?.addEventListener('click', () => {
    if (unitFile === null || unitDialog === null) return;
    const chosen = qsa<HTMLInputElement>('input[name="unit"]', unitDialog.element).find(
      (input) => input.checked,
    );
    if (chosen === undefined) return;
    const fileId = unitFile.id;
    void (async () => {
      const result = await api<IntakeFileView>(
        `/api/engagements/${engagementId}/files/${fileId}/unit`,
        { method: 'PUT', body: { unit: chosen.value as UnitDecision } },
      );
      if (!result.ok) {
        outage.noteFromError(result.body.error);
        setFieldErrors(unitDialog.element, result.body.fields);
        return;
      }
      files = files.map((file) => (file.id === fileId ? result.body : file));
      unitDialog.close();
      paintIntake();
      const model = result.body;
      if (model.dimensions_m !== null && model.unit !== null)
        announce(
          uploadRegion,
          `Measurement complete: ${fullReadout(
            {
              x: String(model.dimensions_m.x),
              y: String(model.dimensions_m.y),
              z: String(model.dimensions_m.z),
            },
            model.unit,
          )}.`,
        );
    })();
  });

  const askedForUnit = new Set<string>();

  const refreshIntake = async (): Promise<void> => {
    const engagement = await readEngagement();
    if (engagement === null) return;
    const model = currentModel();
    if (model === undefined) return;
    if (model.measurement === 'measured' && model.dimensions_m !== null) {
      const metres = {
        x: String(model.dimensions_m.x),
        y: String(model.dimensions_m.y),
        z: String(model.dimensions_m.z),
      };
      if (model.needs_unit_confirmation) {
        if (!askedForUnit.has(model.id)) {
          askedForUnit.add(model.id);
          announce(uploadRegion, `Check the export unit for ${model.name}.`);
          openUnitDialog(model, qs<HTMLElement>(`[data-check-unit="${model.id}"]`));
        }
      } else if (model.unit !== null) {
        announce(uploadRegion, `Measurement complete: ${fullReadout(metres, model.unit)}.`);
      }
    }
    if (model.measurement === 'failed')
      announce(uploadRegion, `${model.name}: ${MEASUREMENT_FAILED_COPY}`);
  };

  const uploadOne = (file: File, pendingId: string): Promise<void> =>
    new Promise((resolve) => {
      const entry = pendingRows.find((row) => row.id === pendingId);
      const form = new FormData();
      form.append('file', file, file.name);
      const request = new XMLHttpRequest();
      request.open('POST', `/api/engagements/${engagementId}/files`);
      let step = -1;
      request.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.min(100, Math.floor((event.loaded / event.total) * 100));
        if (entry !== undefined) {
          entry.status = `Uploading ${percent}%`;
          paintIntake();
        }
        const bucket = Math.floor(percent / 10);
        if (bucket === step) return;
        step = bucket;
        announce(uploadRegion, `Uploading ${file.name}: ${percent}%`);
      });
      request.addEventListener('loadend', () => {
        let body: Partial<IntakeFileView> & { error?: string; message?: string } = {};
        try {
          body = JSON.parse(request.responseText) as typeof body;
        } catch {
          body = {};
        }
        const index = pendingRows.findIndex((row) => row.id === pendingId);
        if (request.status === 201 && body.id !== undefined) {
          if (index !== -1) pendingRows.splice(index, 1);
          files = [...files.filter((entry_) => entry_.id !== body.id), body as IntakeFileView];
          announce(uploadRegion, `${file.name} received.`);
          paintIntake();
          void refreshIntake();
        } else {
          outage.noteFromError(body.error);
          announce(uploadRegion, `${file.name}: ${body.message ?? 'That upload was refused.'}`);
          if (index !== -1) {
            if (body.error === 'storage_unavailable') pendingRows[index].status = 'Not saved';
            else pendingRows[index].status = 'Rejected';
          }
          paintIntake();
        }
        resolve();
      });
      request.addEventListener('error', () => resolve());
      request.send(form);
    });

  const fileInput = qs<HTMLInputElement>('[data-file-input]');
  qs<HTMLButtonElement>('[data-upload-button]')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const chosen = [...(fileInput.files ?? [])];
    fileInput.value = '';
    const queued = chosen.map((file) => {
      const id = `pending:${crypto.randomUUID()}`;
      pendingRows.push({ id, name: file.name, size: file.size, status: 'Uploading 0%' });
      return { file, id };
    });
    paintIntake();
    void (async () => {
      for (const item of queued) await uploadOne(item.file, item.id);
    })();
  });

  window.setInterval(() => {
    if (currentModel()?.measurement === 'pending') void refreshIntake();
  }, 2_000);
  window.setInterval(() => {
    if (currentModel()?.measurement === 'delayed') void refreshIntake();
  }, 10_000);

  const depositDialogElement = qs<HTMLElement>('[data-deposit-dialog]');
  const depositDialog = depositDialogElement === null ? null : createDialog(depositDialogElement);
  let depositKey = '';

  for (const button of qsa<HTMLButtonElement>('[data-pay-deposit]'))
    button.addEventListener('click', () => {
      if (depositDialog === null) return;
      depositKey = crypto.randomUUID();
      const confirm = qs<HTMLButtonElement>('[data-dialog-confirm]', depositDialog.element);
      if (confirm !== null)
        confirm.textContent = `Pay ${formatMoney(BigInt(quote.milestones.deposit_minor), currency)}`;
      depositDialog.open(button);
    });

  if (depositDialog !== null) {
    qs<HTMLButtonElement>('[data-dialog-cancel]', depositDialog.element)?.addEventListener(
      'click',
      () => depositDialog.close(),
    );
    const confirm = qs<HTMLButtonElement>('[data-dialog-confirm]', depositDialog.element);
    const errorSlot = qs<HTMLElement>('[data-dialog-error]', depositDialog.element);
    confirm?.addEventListener('click', () => {
      const card = {
        number: qs<HTMLInputElement>('[data-card="number"]', depositDialog.element)?.value ?? '',
        expiry: qs<HTMLInputElement>('[data-card="expiry"]', depositDialog.element)?.value ?? '',
        cvc: qs<HTMLInputElement>('[data-card="cvc"]', depositDialog.element)?.value ?? '',
        name: qs<HTMLInputElement>('[data-card="name"]', depositDialog.element)?.value ?? '',
      };
      pending(confirm, 'Processing payment');
      void (async () => {
        const result = await api<{ engagement: EngagementView }>(
          `/api/engagements/${engagementId}/deposit`,
          { method: 'POST', body: { card }, headers: { 'Idempotency-Key': depositKey } },
        );
        pending(confirm, null);
        if (!result.ok) {
          outage.noteFromError(result.body.error);
          setFieldErrors(depositDialog.element, result.body.fields);
          if (errorSlot !== null) errorSlot.textContent = result.body.message ?? '';
          confirm.focus();
          return;
        }
        if (errorSlot !== null) errorSlot.textContent = '';
        depositDialog.close({ restoreFocus: false });
        applyQuote(result.body.engagement.quote, { force: true });
        if (depositSuccess === null) return;
        const paidQuote = result.body.engagement.quote;
        depositSuccess.innerHTML = '';
        const heading = document.createElement('h2');
        heading.textContent = 'Deposit received';
        const note = document.createElement('p');
        note.textContent = `A receipt for this deposit goes to ${financeEmail}.`;
        const fx = document.createElement('p');
        fx.textContent =
          currency === 'GBP'
            ? FX_LINE_GBP
            : fxLineLocked(
                paidQuote.fx_rate,
                paidQuote.fx_locked_at ?? new Date().toISOString(),
              );
        const schedule = document.createElement('ul');
        for (const [label, value] of [
          ['Deposit', paidQuote.milestones.deposit_minor],
          ['Look-dev', paidQuote.milestones.look_dev_minor],
          ['Final delivery', paidQuote.milestones.final_delivery_minor],
        ] as const) {
          const item = document.createElement('li');
          item.textContent = `${label}: ${formatMoney(BigInt(value), currency)}`;
          schedule.append(item);
        }
        depositSuccess.append(heading, note, fx, schedule);
        depositSuccess.hidden = false;
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      })();
    });
  }

  paintIntake();
  paintFigures();
  paintControls();
  syncFrustums();
  setPip();
  setFocused(focused);
  setPhase('idle');
  void refreshIntake();
  void (async () => {
    const engagement = await readEngagement();
    if (engagement !== null) applyQuote(engagement.quote);
  })();
};
