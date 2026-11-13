import * as THREE from 'three';
import { hasWebGL, createScene, fit, addStudioLights, animateLoop, tween, EMBER, COBALT, VIOLET, OFFWHITE } from '../scenes';
import { api, el, escapeHtml, isApiError, mountOutageBanner, formatMoneyMinor, CURRENCY_SYMBOLS, CURRENCY_EXPONENTS, formatUtcDate, trapDialog, setStatus } from '../shell';
import type { Engagement, IntakeFile, Invoice } from './account';
import { redirectToSignIn, formatBytes } from './account';

/**
 * The Shot Rig: shot list + WebGL canvas + quote, with the selection
 * sequence, keyboard control, uploads, unit decision and the deposit.
 */

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Service {
  code: string;
  title: string;
  list_price_pence: number;
  azimuth_deg: number;
  elevation_deg: number;
  sort: number;
}

interface RigState {
  engagement: Engagement | null;
  services: Service[];
  focusedShot: string;
  pipShot: string;
  rigPhase: string;
  orbitAzimuth: number;
  uploading: { name: string; progress: number }[];
  lastAppliedRevision: number;
  pendingByShot: Map<string, number>;
  busy: boolean;
  servicesLoaded: boolean;
}

export function mountRig(path: string): void {
  const engagementId = path.split('/')[2] ?? '';
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  mountOutageBanner();

  const layout = el('div', 'rig-layout');
  const left = el('div', 'rig-left');
  const right = el('div', 'rig-right');
  layout.append(left, right);
  main.appendChild(layout);

  const heading = el('h1', 'display-2');
  heading.textContent = 'Shot Rig';
  const reference = el('p', 'section-label');
  reference.id = 'rig-reference';

  const uploadLabel = el('p');
  const uploadButton = el('button', 'button secondary');
  uploadButton.textContent = 'Upload files';
  uploadButton.id = 'upload-button';
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.id = 'product-files';
  fileInput.setAttribute('aria-label', 'Product files');
  fileInput.accept = '.glb,.step,.stp,.pdf';
  fileInput.hidden = true;
  uploadLabel.append(uploadButton, fileInput);

  const filesHeading = el('h2', 'display-5');
  filesHeading.textContent = 'Intake files';
  const filesList = el('ul', 'intake-list');
  filesList.setAttribute('aria-label', 'Intake files');
  filesList.id = 'intake-files';

  const shotsHeading = el('h2', 'display-5');
  shotsHeading.textContent = 'Shots';
  const shotsList = el('ul', 'shots-list');
  shotsList.setAttribute('aria-label', 'Shots');
  shotsList.id = 'shots-list';

  const quoteRegion = el('section');
  quoteRegion.setAttribute('aria-label', 'Quote');
  quoteRegion.id = 'quote';
  quoteRegion.className = 'rig-quote';
  quoteRegion.setAttribute('data-quote-revision', '0');

  const payDeposit = el('button', 'button');
  payDeposit.textContent = 'Pay deposit';
  payDeposit.id = 'pay-deposit';

  const quoteBarTotal = el('span', 'bar-total');
  quoteBarTotal.id = 'bar-total';
  const quoteBarPay = el('button', 'button');
  quoteBarPay.textContent = 'Pay deposit';
  const quoteBar = el('div', 'rig-quote-bar');
  quoteBar.append(quoteBarTotal, quoteBarPay);
  main.appendChild(quoteBar);
  quoteBarPay.hidden = true;

  left.append(heading, reference, uploadLabel, filesHeading, filesList, shotsHeading, shotsList, quoteRegion, payDeposit);

  const canvasWrap = el('div', 'rig-canvas-wrap');
  canvasWrap.setAttribute('role', 'group');
  canvasWrap.setAttribute('aria-label', 'Shot Rig');
  canvasWrap.setAttribute('tabindex', '0');
  canvasWrap.setAttribute('data-frustum-count', '0');
  canvasWrap.setAttribute('data-focused-shot', '');
  canvasWrap.setAttribute('data-rig-phase', 'idle');
  canvasWrap.setAttribute('data-orbit-azimuth', '0');
  canvasWrap.setAttribute('data-webgl', hasWebGL() ? 'on' : 'off');
  const pip = el('figure', 'rig-pip');
  pip.setAttribute('aria-label', 'Camera view');
  pip.setAttribute('data-pip-shot', 'overview');
  const pipLabel = el('span', 'rig-pip-label');
  pipLabel.id = 'pip-label';
  pip.appendChild(pipLabel);
  const scaleRegion = el('section');
  scaleRegion.setAttribute('aria-label', 'Product scale');
  scaleRegion.id = 'product-scale';
  scaleRegion.className = 'rig-scale';
  const positionsHeading = el('h3', 'display-5');
  positionsHeading.textContent = 'Shot positions';
  const positionsTable = el('table', 'data-table');
  const positionsCaption = el('caption', 'visually-hidden');
  positionsCaption.textContent = 'Shot positions';
  positionsTable.appendChild(positionsCaption);
  const positionsHead = el('thead');
  const positionsHeadRow = el('tr');
  for (const column of ['Shot', 'Azimuth', 'Elevation', 'Price', 'Selected']) {
    const th = el('th');
    th.textContent = column;
    th.scope = 'col';
    positionsHeadRow.appendChild(th);
  }
  positionsHead.appendChild(positionsHeadRow);
  positionsTable.appendChild(positionsHead);
  const positionsBody = el('tbody');
  positionsTable.appendChild(positionsBody);
  right.append(canvasWrap, pip, scaleRegion, positionsHeading, positionsTable);

  const uploadProgress = el('p');
  uploadProgress.className = 'visually-hidden';
  uploadProgress.id = 'upload-progress';
  uploadProgress.setAttribute('role', 'status');
  uploadProgress.setAttribute('aria-live', 'polite');
  const quoteStatus = el('p');
  quoteStatus.className = 'visually-hidden';
  quoteStatus.id = 'quote-updates';
  quoteStatus.setAttribute('role', 'status');
  quoteStatus.setAttribute('aria-live', 'polite');
  const focusStatus = el('p');
  focusStatus.className = 'visually-hidden';
  focusStatus.id = 'rig-focus';
  focusStatus.setAttribute('role', 'status');
  focusStatus.setAttribute('aria-live', 'polite');
  main.append(uploadProgress, quoteStatus, focusStatus);

  const state: RigState = {
    engagement: null,
    services: [],
    focusedShot: '',
    pipShot: 'overview',
    rigPhase: 'idle',
    orbitAzimuth: 0,
    uploading: [],
    lastAppliedRevision: -1,
    pendingByShot: new Map(),
    busy: false,
    servicesLoaded: false,
  };

  const announceUpload = (text: string): void => setStatus(uploadProgress, text);
  const announceQuote = (text: string): void => setStatus(quoteStatus, text);
  const announceFocus = (text: string): void => setStatus(focusStatus, text);

  // ---- rig scene ----
  let rig: RigScene | null = null;
  if (hasWebGL()) {
    rig = createRigScene(canvasWrap, pip);
  } else {
    canvasWrap.setAttribute('data-webgl', 'off');
    mountPlanView(canvasWrap);
  }

  // ---- data load ----
  const loadServices = async (): Promise<void> => {
    const { status, json } = await api<{ services: Service[] }>('GET', '/api/content');
    if (status === 200 && !isApiError(json)) {
      state.services = (json as { services: Service[] }).services;
      state.servicesLoaded = true;
    }
  };

  const loadEngagement = async (): Promise<void> => {
    const { status, json } = await api<Engagement>('GET', `/api/engagements/${engagementId}`);
    if (status === 401) {
      redirectToSignIn();
      return;
    }
    if (status !== 200 || isApiError(json)) {
      void import('./notfound').then(m => {
        main.innerHTML = '';
        m.mountNotFound();
      });
      return;
    }
    const previousRevision = state.engagement?.quote.revision ?? -1;
    state.engagement = json as Engagement;
    if (previousRevision === -1) {
      state.lastAppliedRevision = json.quote.revision;
    }
    renderAll();
  };

  const renderAll = (): void => {
    const engagement = state.engagement;
    if (!engagement) {
      return;
    }
    reference.textContent = `${engagement.reference} · ${engagement.title}`;
    renderFiles(filesList, engagement);
    renderShots(shotsList, engagement);
    renderQuote(quoteRegion, quoteBarTotal, engagement);
    renderPositions(positionsBody, engagement);
    renderScale(scaleRegion, engagement);
    syncRigSurfaces(engagement);
    const payable = engagement.state !== 'quoted';
    payDeposit.hidden = payable;
    quoteBarPay.hidden = payable;
    if (payable) {
      const deposit = engagement.invoices.find(invoice => invoice.milestone === 'deposit');
      if (deposit && deposit.status === 'paid') {
        showDepositConfirmation(engagement, deposit);
      }
    }
  };

  const syncRigSurfaces = (engagement: Engagement): void => {
    const selectedCodes = engagement.quote.lines.map(line => line.shot_code);
    canvasWrap.setAttribute('data-frustum-count', String(selectedCodes.length));
    if (rig) {
      rig.setFrustums(selectedCodes, state.services);
    }
    if (state.pipShot !== 'overview' && !selectedCodes.includes(state.pipShot)) {
      const lastSelected = selectedCodes[selectedCodes.length - 1] ?? 'overview';
      state.pipShot = lastSelected;
      pip.setAttribute('data-pip-shot', lastSelected);
      if (rig) {
        rig.setPip(lastSelected, state.services);
      }
    }
    if (!state.servicesLoaded) {
      return;
    }
    if (rig) {
      rig.setProductModel(currentModel(engagement));
    }
  };

  const currentModel = (engagement: Engagement): IntakeFile | null =>
    engagement.files.find(file => file.kind === 'model' && file.status === 'received' && file.measurement === 'measured') ?? null;

  // ---- quote changes: per-shot queue, newest reply wins ----
  const applyReply = (quote: Engagement['quote']): void => {
    if (state.lastAppliedRevision !== -1 && quote.revision <= state.lastAppliedRevision) {
      return;
    }
    state.lastAppliedRevision = quote.revision;
    if (state.engagement) {
      state.engagement.quote = quote;
      renderQuote(quoteRegion, quoteBarTotal, state.engagement);
      renderPositions(positionsBody, state.engagement);
      syncRigSurfaces(state.engagement);
      renderShots(shotsList, state.engagement);
    }
  };

  const queueForShot = (shotCode: string): { promise: Promise<void> } => {
    const run = async (): Promise<void> => {
      const pending = state.pendingByShot.get(shotCode);
      if (pending === undefined) {
        return;
      }
      let outcome: 'ok' | 'refused' = 'ok';
      let refusalMessage = '';
      const isDelete = pending === 0;
      const { status, json } = isDelete
        ? await api<Engagement['quote']>('DELETE', `/api/engagements/${engagementId}/quote/lines/${shotCode}`)
        : await api<Engagement['quote']>('PUT', `/api/engagements/${engagementId}/quote/lines/${shotCode}`, { quantity: pending });
      if (status === 200 && !isApiError(json)) {
        applyReply(json as Engagement['quote']);
      } else {
        outcome = 'refused';
        refusalMessage = isApiError(json) ? json.message : 'That change was refused.';
        // Re-read the engagement and rebuild from the server's quote.
        const fresh = await api<Engagement>('GET', `/api/engagements/${engagementId}`);
        if (fresh.status === 200 && !isApiError(fresh.json)) {
          state.engagement = fresh.json as Engagement;
          state.lastAppliedRevision = fresh.json.quote.revision;
          renderAll();
          // A refused select runs the deselect sequence.
          if (!isDelete) {
            runDeselectSequence(shotCode);
          }
        }
      }
      const nextPending = state.pendingByShot.get(shotCode);
      if (nextPending !== undefined && nextPending !== pending) {
        state.pendingByShot.delete(shotCode);
        void queueForShot(shotCode);
        return;
      }
      state.pendingByShot.delete(shotCode);
      if (outcome === 'ok') {
        const symbol = CURRENCY_SYMBOLS[state.engagement?.brand.currency ?? 'GBP'];
        const exponent = CURRENCY_EXPONENTS[state.engagement?.brand.currency ?? 'GBP'];
        announceQuote(`Quote updated: total ${formatMoneyMinor(state.engagement?.quote.total_minor ?? 0, symbol, exponent)}, deposit ${formatMoneyMinor(state.engagement?.quote.milestones.deposit_minor ?? 0, symbol, exponent)}.`);
      } else {
        announceQuote(refusalMessage);
      }
      state.busy = state.pendingByShot.size > 0;
      quoteRegion.setAttribute('data-busy', String(state.busy));
    };
    return { promise: run() };
  };

  const changeShot = (shotCode: string, quantity: number): void => {
    state.pendingByShot.set(shotCode, quantity);
    state.busy = true;
    quoteRegion.setAttribute('data-busy', 'true');
    if (state.pendingByShot.get(shotCode) === quantity && state.pendingByShot.size === 1 && state.pendingByShot.has(shotCode)) {
      // Only one in-flight change per shot: run when the previous finished.
      if (!changeRunning.has(shotCode)) {
        void startChange(shotCode);
      }
    }
  };

  const changeRunning = new Set<string>();
  const startChange = async (shotCode: string): Promise<void> => {
    if (changeRunning.has(shotCode)) {
      return;
    }
    changeRunning.add(shotCode);
    try {
      while (state.pendingByShot.has(shotCode)) {
        await queueForShot(shotCode).promise;
      }
    } finally {
      changeRunning.delete(shotCode);
    }
  };

  const selectShot = (shotCode: string, quantity: number): void => {
    runSelectSequence(shotCode);
    changeShot(shotCode, quantity);
  };

  const deselectShot = (shotCode: string): void => {
    runDeselectSequence(shotCode);
    changeShot(shotCode, 0);
  };

  // ---- selection sequence ----
  const setPhase = (phase: string): void => {
    state.rigPhase = phase;
    canvasWrap.setAttribute('data-rig-phase', phase);
  };

  const runSelectSequence = (shotCode: string): void => {
    if (reducedMotion()) {
      rig?.showFrustumInstant(shotCode, state.services);
      setPhase('idle');
      countTo();
      return;
    }
    setPhase('flying');
    rig?.flyFrustumIn(shotCode, state.services, () => {
      setPhase('focusing');
      tween(320, () => undefined, () => {
        rig?.setFrustumEmber(shotCode);
        setPhase('cut');
        const previous = state.pipShot;
        state.pipShot = shotCode;
        pip.setAttribute('data-pip-shot', shotCode);
        rig?.setPip(shotCode, state.services);
        void previous;
        setPhase('counting');
        countTo(() => {
          setPhase('idle');
        });
      });
    });
  };

  const runDeselectSequence = (shotCode: string): void => {
    if (reducedMotion()) {
      rig?.removeFrustumInstant(shotCode);
      countTo();
      return;
    }
    setPhase('counting');
    countTo(() => {
      if (state.pipShot === shotCode) {
        const remaining = state.engagement?.quote.lines.filter(l => l.shot_code !== shotCode) ?? [];
        const next = remaining.length > 0 ? remaining[remaining.length - 1].shot_code : 'overview';
        state.pipShot = next;
        pip.setAttribute('data-pip-shot', next);
        rig?.setPip(next, state.services);
      }
      rig?.fadeFrustumOut(shotCode, () => {
        rig?.removeFrustum(shotCode);
        setPhase('idle');
      });
    });
  };

  let countAnimation: (() => void) | null = null;
  const countTo = (done?: () => void): void => {
    const engagement = state.engagement;
    if (!engagement) {
      done?.();
      return;
    }
    if (countAnimation) {
      countAnimation();
      countAnimation = null;
    }
    if (reducedMotion()) {
      renderQuote(quoteRegion, quoteBarTotal, engagement);
      done?.();
      return;
    }
    const targets = quoteTargets(engagement);
    const numeralTargets: Record<string, number> = {
      total: targets.total,
      deposit: targets.deposit,
      look_dev: targets.look_dev,
      final_delivery: targets.final_delivery,
      bar: targets.bar,
    };
    for (const element of quoteNumerals(quoteRegion, quoteBarTotal)) {
      element.dataset.target = String(numeralTargets[element.dataset.kind ?? ''] ?? 0);
      element.dataset.from = String(numeralsFrom(element.textContent));
    }
    const start = performance.now();
    const duration = 600;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      for (const element of quoteNumerals(quoteRegion, quoteBarTotal)) {
        const from = Number(element.dataset.from ?? '0');
        const to = Number(element.dataset.target ?? '0');
        element.textContent = formatMoneyMinor(Math.round(from + (to - from) * eased), targets.symbol, targets.exponent);
      }
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        countAnimation = null;
        done?.();
      }
    };
    countAnimation = () => {
      // restart marker: a newer reply restarting the count replaces this animation
    };
    requestAnimationFrame(step);
  };

  const quoteNumerals = (region: HTMLElement, bar: HTMLElement): HTMLElement[] => {
    const total = region.querySelector('[data-numeral="total"]') as HTMLElement | null;
    const deposit = region.querySelector('[data-numeral="deposit"]') as HTMLElement | null;
    const lookDev = region.querySelector('[data-numeral="look_dev"]') as HTMLElement | null;
    const final = region.querySelector('[data-numeral="final_delivery"]') as HTMLElement | null;
    const barTotal = bar as HTMLElement;
    const list = [total, deposit, lookDev, final].filter((x): x is HTMLElement => x !== null);
    if (barTotal) {
      list.push(barTotal);
    }
    return list;
  };

  const quoteTargets = (engagement: Engagement): { total: number; deposit: number; look_dev: number; final_delivery: number; bar: number; symbol: string; exponent: number } => ({
    total: engagement.quote.total_minor,
    deposit: engagement.quote.milestones.deposit_minor,
    look_dev: engagement.quote.milestones.look_dev_minor,
    final_delivery: engagement.quote.milestones.final_delivery_minor,
    bar: engagement.quote.total_minor,
    symbol: CURRENCY_SYMBOLS[engagement.brand.currency] ?? '£',
    exponent: CURRENCY_EXPONENTS[engagement.brand.currency] ?? 2,
  });

  const numeralsFrom = (text: string | null | undefined): number => {
    if (!text) {
      return 0;
    }
    const digits = text.replace(/[^\d]/g, '');
    return Number(digits || '0');
  };

  // ---- shots list ----
  const renderShots = (list: HTMLElement, engagement: Engagement): void => {
    const selectedMap = new Map(engagement.quote.lines.map(line => [line.shot_code, line.quantity]));
    list.innerHTML = '';
    const ordered = serviceOrder(engagement);
    for (const service of ordered) {
      const quantity = selectedMap.get(service.code);
      const item = el('li');
      item.dataset.shotCode = service.code;
      const label = el('label');
      label.htmlFor = `shot-${service.code}`;
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.id = `shot-${service.code}`;
      checkbox.checked = quantity !== undefined;
      checkbox.setAttribute('data-field', service.code);
      label.append(checkbox, document.createTextNode(shotTitle(service.code, engagement)));
      item.appendChild(label);
      if (quantity !== undefined) {
        const spinner = el('input', 'colourways');
        spinner.type = 'number';
        spinner.min = '1';
        spinner.max = '6';
        spinner.value = String(quantity);
        spinner.id = `colourways-${service.code}`;
        spinner.setAttribute('aria-label', `Colourways for ${shotTitle(service.code, engagement)}`);
        spinner.setAttribute('data-field', `quantity-${service.code}`);
        item.appendChild(spinner);
      }
      list.appendChild(item);
    }
  };

  const shotTitle = (code: string, engagement: Engagement): string => {
    const line = engagement.quote.lines.find(l => l.shot_code === code);
    if (line) {
      return line.title;
    }
    const service = state.services.find(s => s.code === code);
    if (service) {
      return service.title;
    }
    return code;
  };

  const serviceOrder = (_engagement: Engagement): Service[] => state.services;

  listInteraction(shotsList, state, () => state.engagement, selectShot, deselectShot, changeShot);

  // ---- keyboard on the rig group ----
  mountRigKeyboard(canvasWrap, state, () => state.engagement, selectShot, deselectShot, (code) => {
    state.focusedShot = code;
    canvasWrap.setAttribute('data-focused-shot', code);
    const service = state.services.find(s => s.code === code);
    const selected = state.engagement?.quote.lines.some(l => l.shot_code === code) ?? false;
    announceFocus(`${shotTitle(code, state.engagement as Engagement)}, azimuth ${service?.azimuth_deg ?? 0}°, elevation ${service?.elevation_deg ?? 0}°, ${selected ? '' : 'not '}selected`);
    if (rig) {
      rig.setFocused(code, state.services);
    }
  });

  // reset orbit with R
  document.addEventListener('keydown', event => {
    if (event.key !== 'r' && event.key !== 'R') {
      return;
    }
    const allowed = (target: HTMLElement | null): boolean => {
      if (!target) return false;
      return target === canvasWrap
        || target.id === 'upload-button'
        || target.id === 'pay-deposit'
        || target.classList.contains('colourways') === false && target.closest('#shots-list') !== null
        || target.closest('[data-unit-check]') !== null;
    };
    if (!allowed(event.target as HTMLElement)) {
      return;
    }
    event.preventDefault();
    if (reducedMotion()) {
      state.orbitAzimuth = 0;
      canvasWrap.setAttribute('data-orbit-azimuth', '0');
      rig?.setOrbit(0);
    } else {
      const from = state.orbitAzimuth;
      tween(600, t => {
        const value = Math.round(from * (1 - t));
        state.orbitAzimuth = value;
        canvasWrap.setAttribute('data-orbit-azimuth', String(value));
        rig?.setOrbit(value);
      });
    }
  });

  // ---- uploads ----
  uploadButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void uploadFiles(files);
  });

  const uploadFiles = async (files: File[]): Promise<void> => {
    for (const file of files) {
      const row = addFileRow(filesList, file.name, 'Uploading 0%');
      const onProgress = (percent: number): void => {
        const stepped = Math.floor(percent / 10) * 10;
        if (stepped !== (Number(row.dataset.lastStep ?? -1))) {
          row.dataset.lastStep = String(stepped);
          announceUpload(`Uploading ${file.name}: ${Math.min(99, Math.max(0, Math.round(percent)))}%`);
        }
        row.querySelector('.file-size')!.textContent = `Uploading ${Math.min(100, Math.max(0, Math.round(percent)))}%`;
      };
      try {
        const json = await uploadOne(file, onProgress);
        row.remove();
        announceUpload(`${file.name} received.`);
        await loadEngagement();
        if (json.kind === 'model') {
          pollMeasurement();
        }
        void json;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'That file couldn\'t be uploaded.';
        row.querySelector('.file-size')!.textContent = message;
        row.classList.add('not_saved');
        announceUpload(`${file.name}: ${message}`);
      }
    }
  };

  const uploadOne = (file: File, onProgress: (percent: number) => void): Promise<IntakeFile> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/engagements/${engagementId}/files`);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) {
        onProgress((event.loaded / event.total) * 100);
      }
    });
    xhr.addEventListener('load', () => {
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as IntakeFile);
      } else {
        const message = (body as { message?: string } | null)?.message ?? 'That file couldn\'t be uploaded.';
        reject(new Error(message));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('That file couldn\'t be uploaded.')));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });

  const addFileRow = (list: HTMLElement, name: string, status: string): HTMLLIElement => {
    const item = el('li');
    const nameSpan = el('span', 'file-name');
    nameSpan.textContent = name;
    const sizeSpan = el('span', 'file-size');
    sizeSpan.textContent = status;
    item.append(nameSpan, sizeSpan);
    list.appendChild(item);
    return item;
  };

  const renderFiles = (list: HTMLElement, engagement: Engagement): void => {
    const uploadingNames = new Set(Array.from(list.children).map(row => (row as HTMLElement).dataset.uploadName).filter(Boolean));
    list.innerHTML = '';
    for (const file of engagement.files) {
      if (uploadingNames.has(file.name)) {
        continue;
      }
      const item = el('li');
      item.dataset.uploadName = file.name;
      const nameSpan = el('span', 'file-name');
      nameSpan.textContent = file.name;
      const sizeSpan = el('span', 'file-size');
      sizeSpan.textContent = formatBytes(file.size_bytes);
      const statusSpan = el('span', `intake-status ${file.measurement === 'failed' ? 'rejected' : ''}`);
      statusSpan.textContent = file.status === 'received' ? 'Received' : 'Superseded';
      item.append(nameSpan, sizeSpan, statusSpan);
      if (file.kind === 'model' && file.measurement !== null) {
        const note = el('span', 'intake-note');
        note.textContent = file.measurement === 'pending' ? 'Measuring'
          : file.measurement === 'delayed' ? 'Measuring is delayed'
          : file.measurement === 'failed' ? 'That GLB couldn\'t be measured. Re-export it as binary glTF 2.0 and upload it again.'
          : measurementReadout(file);
        item.appendChild(note);
      }
      if (file.kind === 'model' && file.measurement === 'measured' && file.needs_unit_confirmation) {
        const checkButton = el('button', 'button secondary');
        checkButton.textContent = 'Check unit';
        checkButton.dataset.unitCheck = file.id;
        checkButton.addEventListener('click', () => openUnitDialog(file, checkButton));
        item.appendChild(checkButton);
      }
      list.appendChild(item);
    }
    // Open the unit dialog automatically when the model needs a unit.
    const needsUnit = engagement.files.find(file => file.kind === 'model' && file.measurement === 'measured' && file.needs_unit_confirmation);
    if (needsUnit && !document.querySelector('dialog[open]')) {
      openUnitDialog(needsUnit, null);
    }
  };

  const measurementReadout = (file: IntakeFile): string => {
    if (!file.dimensions_mm) {
      return 'Measured';
    }
    const mm = file.dimensions_mm;
    const inches = { x: mm.x / 25.4, y: mm.y / 25.4, z: mm.z / 25.4 };
    const one = (value: number): string => value.toFixed(1);
    const two = (value: number): string => value.toFixed(2);
    return `Measured ${one(mm.x)} × ${one(mm.y)} × ${one(mm.z)} mm · ${two(inches.x)} × ${two(inches.y)} × ${two(inches.z)} in`;
  };

  const renderScale = (region: HTMLElement, engagement: Engagement): void => {
    const model = currentModel(engagement);
    if (!model || !model.dimensions_mm) {
      region.textContent = 'Upload a GLB to see it at true scale.';
      return;
    }
    region.textContent = measurementReadout(model);
  };

  const openUnitDialog = (file: IntakeFile, opener: HTMLElement | null): void => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Check the export unit');
    const body = el('div', 'dialog-body');
    const title = el('h2');
    title.textContent = 'Check the export unit';
    const asExported = el('p', 'lede');
    if (file.dimensions_m) {
      const d = file.dimensions_m;
      asExported.textContent = `As exported this measures ${d.x.toFixed(3)} × ${d.y.toFixed(3)} × ${d.z.toFixed(3)} m.`;
    }
    const radios = el('div', 'radio-row');
    radios.setAttribute('role', 'radiogroup');
    radios.setAttribute('aria-label', 'Export unit');
    const units: { value: string; label: string }[] = [
      { value: 'as_exported', label: 'As exported (metres)' },
      { value: 'mm', label: 'Millimetres' },
      { value: 'cm', label: 'Centimetres' },
      { value: 'in', label: 'Inches' },
    ];
    for (const unit of units) {
      const pill = el('label', 'radio-pill');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'unit';
      radio.value = unit.value;
      radio.setAttribute('data-field', 'unit');
      pill.append(radio, document.createTextNode(unit.label));
      radios.appendChild(pill);
    }
    const errorLine = el('p', 'dialog-error');
    errorLine.hidden = true;
    const actions = el('div', 'dialog-actions');
    const useButton = el('button', 'button');
    useButton.textContent = 'Use this unit';
    actions.appendChild(useButton);
    body.append(title, asExported, radios, errorLine, actions);
    dialog.appendChild(body);
    document.body.appendChild(dialog);
    trapDialog(dialog, () => {
      dialog.remove();
      opener?.focus();
    });
    useButton.addEventListener('click', async () => {
      const selected = dialog.querySelector<HTMLInputElement>('input[name="unit"]:checked');
      if (!selected) {
        errorLine.textContent = 'Choose as exported, mm, cm or in.';
        errorLine.hidden = false;
        return;
      }
      useButton.setAttribute('aria-busy', 'true');
      const { status, json } = await api<IntakeFile>('PUT', `/api/engagements/${engagementId}/files/${file.id}/unit`, { unit: selected.value });
      useButton.removeAttribute('aria-busy');
      if (status === 200 && !isApiError(json)) {
        const measured = json as IntakeFile;
        const mm = measured.dimensions_mm;
        const inches = mm ? { x: mm.x / 25.4, y: mm.y / 25.4, z: mm.z / 25.4 } : null;
        const readout = mm && inches
          ? `Measurement complete: ${mm.x.toFixed(1)} × ${mm.y.toFixed(1)} × ${mm.z.toFixed(1)} mm · ${inches.x.toFixed(2)} × ${inches.y.toFixed(2)} × ${inches.z.toFixed(2)} in.`
          : 'Measurement complete.';
        announceUpload(readout);
        dialog.close();
        dialog.remove();
        await loadEngagement();
        return;
      }
      if (isApiError(json)) {
        errorLine.textContent = json.message;
        errorLine.hidden = false;
      }
    });
  };

  // Poll while a model's measurement is pending or delayed.
  const pollMeasurement = (): void => {
    const tick = async (): Promise<void> => {
      const engagement = state.engagement;
      if (!engagement) {
        return;
      }
      const model = engagement.files.find(file => file.kind === 'model' && file.status === 'received');
      if (!model || (model.measurement !== 'pending' && model.measurement !== 'delayed')) {
        return;
      }
      await loadEngagement();
      const fresh = state.engagement;
      const freshModel = fresh?.files.find(file => file.kind === 'model' && file.status === 'received');
      if (freshModel && (freshModel.measurement === 'pending' || freshModel.measurement === 'delayed')) {
        const delay = freshModel.measurement === 'pending' ? 2000 : 10_000;
        window.setTimeout(tick, delay);
      } else if (freshModel && freshModel.measurement === 'measured') {
        const mm = freshModel.dimensions_mm;
        if (mm) {
          const inches = { x: mm.x / 25.4, y: mm.y / 25.4, z: mm.z / 25.4 };
          announceUpload(`Measurement complete: ${mm.x.toFixed(1)} × ${mm.y.toFixed(1)} × ${mm.z.toFixed(1)} mm · ${inches.x.toFixed(2)} × ${inches.y.toFixed(2)} × ${inches.z.toFixed(2)} in.`);
        }
      }
    };
    window.setTimeout(tick, 2000);
  };

  // ---- pay deposit ----
  const mountPayDeposit = (button: HTMLButtonElement): void => {
    button.addEventListener('click', () => {
      const engagement = state.engagement;
      if (!engagement) {
        return;
      }
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-label', 'Pay deposit');
      const body = el('div', 'dialog-body');
      const title = el('h2');
      title.textContent = 'Pay deposit';
      const testCards = el('p', 'test-cards');
      testCards.innerHTML = `Test cards: <code>4242 4242 4242 4242</code> approves, <code>4000 0000 0000 0002</code> declines.`;
      const fields = [
        { name: 'number', label: 'Card number' },
        { name: 'expiry', label: 'Expiry (MM/YY)' },
        { name: 'cvc', label: 'Security code' },
        { name: 'name', label: 'Name on card' },
      ];
      const inputs: Record<string, HTMLInputElement> = {};
      for (const field of fields) {
        const wrap = el('div', 'field');
        const label = el('label');
        label.htmlFor = `deposit-${field.name}`;
        label.textContent = field.label;
        const input = el('input');
        input.id = `deposit-${field.name}`;
        inputs[field.name] = input;
        wrap.append(label, input);
        body.appendChild(wrap);
      }
      const errorLine = el('p', 'dialog-error');
      errorLine.hidden = true;
      const actions = el('div', 'dialog-actions');
      const cancelButton = el('button', 'button secondary');
      cancelButton.textContent = 'Cancel';
      const payButton = el('button', 'button');
      const symbol = CURRENCY_SYMBOLS[engagement.brand.currency] ?? '£';
      const exponent = CURRENCY_EXPONENTS[engagement.brand.currency] ?? 2;
      payButton.textContent = `Pay ${formatMoneyMinor(engagement.quote.milestones.deposit_minor, symbol, exponent)}`;
      payButton.dataset.pendingLabel = 'Processing payment';
      actions.append(cancelButton, payButton);
      body.append(errorLine, actions);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      trapDialog(dialog, () => {
        dialog.remove();
        button.focus();
      });
      cancelButton.addEventListener('click', () => {
        dialog.close();
        dialog.remove();
        button.focus();
      });
      payButton.addEventListener('click', async () => {
        errorLine.hidden = true;
        payButton.setAttribute('aria-busy', 'true');
        payButton.textContent = payButton.dataset.pendingLabel ?? 'Processing payment';
        const key = `deposit-${engagementId}-${Date.now()}`;
        const { status, json } = await api<{ engagement: Engagement; invoice: Invoice }>('POST', `/api/engagements/${engagementId}/deposit`, {
          card: {
            number: inputs.number.value,
            expiry: inputs.expiry.value,
            cvc: inputs.cvc.value,
            name: inputs.name.value,
          },
        }, { 'Idempotency-Key': key });
        payButton.removeAttribute('aria-busy');
        payButton.textContent = `Pay ${formatMoneyMinor(engagement.quote.milestones.deposit_minor, symbol, exponent)}`;
        if (status === 201 && !isApiError(json)) {
          dialog.close();
          dialog.remove();
          await loadEngagement();
          return;
        }
        if (isApiError(json)) {
          const fieldsErrors = json.fields ?? {};
          if (Object.keys(fieldsErrors).length > 0) {
            errorLine.textContent = Object.values(fieldsErrors)[0] ?? json.message;
          } else {
            errorLine.textContent = json.message;
          }
          errorLine.hidden = false;
          payButton.focus();
        }
      });
    });
  };
  mountPayDeposit(payDeposit);
  mountPayDeposit(quoteBarPay);

  const showDepositConfirmation = (engagement: Engagement, deposit: Invoice): void => {
    if (document.getElementById('deposit-confirmation')) {
      return;
    }
    const symbol = CURRENCY_SYMBOLS[engagement.brand.currency] ?? '£';
    const exponent = CURRENCY_EXPONENTS[engagement.brand.currency] ?? 2;
    const financeEmail = 'your finance contact';
    const section = el('section', 'rig-quote');
    section.id = 'deposit-confirmation';
    const heading = el('h2', 'display-4');
    heading.textContent = 'Deposit received';
    const note = el('p');
    note.textContent = `A receipt for this deposit goes to ${financeEmail}.`;
    const rate = engagement.quote.fx_locked_at
      ? `Locked at ${Number(engagement.quote.fx_rate).toFixed(4)} per £1 on ${formatUtcDate(engagement.quote.fx_locked_at)}.`
      : `Priced in GBP.`;
    const milestones = el('ul');
    const format = (minor: number): string => formatMoneyMinor(minor, symbol, exponent);
    milestones.innerHTML = `
      <li class="quote-row"><span>Deposit</span><span>${escapeHtml(format(engagement.quote.milestones.deposit_minor))}</span></li>
      <li class="quote-row"><span>Look-dev</span><span>${escapeHtml(format(engagement.quote.milestones.look_dev_minor))}</span></li>
      <li class="quote-row"><span>Final delivery</span><span>${escapeHtml(format(engagement.quote.milestones.final_delivery_minor))}</span></li>`;
    const fxLine = el('p', 'fx-line');
    fxLine.textContent = rate;
    section.append(heading, note, milestones, fxLine);
    left.insertBefore(section, payDeposit);
    void deposit;
  };

  const renderQuote = (region: HTMLElement, bar: HTMLElement, engagement: Engagement): void => {
    const symbol = CURRENCY_SYMBOLS[engagement.brand.currency] ?? '£';
    const exponent = CURRENCY_EXPONENTS[engagement.brand.currency] ?? 2;
    const format = (minor: number): string => formatMoneyMinor(minor, symbol, exponent);
    region.setAttribute('data-quote-revision', String(engagement.quote.revision));
    region.innerHTML = `
      <div class="quote-row"><span>Subtotal</span><span data-value-minor="${engagement.quote.subtotal_minor}">${escapeHtml(format(engagement.quote.subtotal_minor))}</span></div>
      <div class="quote-row"><span>VAT</span><span data-value-minor="${engagement.quote.vat_minor}">${escapeHtml(format(engagement.quote.vat_minor))}</span></div>
      <div class="quote-row quote-total"><span>Total</span><span data-value-minor="${engagement.quote.total_minor}" data-numeral="total" data-kind="total">${escapeHtml(format(engagement.quote.total_minor))}</span></div>
      <div class="quote-row"><span>Deposit</span><span data-value-minor="${engagement.quote.milestones.deposit_minor}" data-numeral="deposit" data-kind="deposit">${escapeHtml(format(engagement.quote.milestones.deposit_minor))}</span></div>
      <div class="quote-row"><span>Look-dev</span><span data-value-minor="${engagement.quote.milestones.look_dev_minor}" data-numeral="look_dev" data-kind="look_dev">${escapeHtml(format(engagement.quote.milestones.look_dev_minor))}</span></div>
      <div class="quote-row"><span>Final delivery</span><span data-value-minor="${engagement.quote.milestones.final_delivery_minor}" data-numeral="final_delivery" data-kind="final_delivery">${escapeHtml(format(engagement.quote.milestones.final_delivery_minor))}</span></div>`;
    const fxLine = el('p', 'fx-line');
    fxLine.textContent = fxLineText(engagement);
    region.appendChild(fxLine);
    bar.dataset.kind = 'bar';
    bar.dataset.target = String(engagement.quote.total_minor);
    bar.textContent = format(engagement.quote.total_minor);
  };

  const fxLineText = (engagement: Engagement): string => {
    if (engagement.brand.currency === 'GBP') {
      return 'Priced in GBP.';
    }
    const rate = Number(engagement.quote.fx_rate).toFixed(4);
    if (engagement.quote.fx_locked && engagement.quote.fx_locked_at) {
      return `Locked at ${rate} per £1 on ${formatUtcDate(engagement.quote.fx_locked_at)}.`;
    }
    return `Indicative at ${rate} per £1.`;
  };

  const renderPositions = (tbody: HTMLTableSectionElement, engagement: Engagement): void => {
    tbody.innerHTML = '';
    const selectedMap = new Map(engagement.quote.lines.map(line => [line.shot_code, line]));
    for (const service of state.services) {
      const row = el('tr');
      const shotCell = el('td');
      shotCell.textContent = shotTitle(service.code, engagement);
      const azimuthCell = el('td');
      azimuthCell.textContent = `${service.azimuth_deg}°`;
      const elevationCell = el('td');
      elevationCell.textContent = `${service.elevation_deg}°`;
      const priceCell = el('td', 'num');
      const line = selectedMap.get(service.code);
      const pricePence = line ? line.unit_price_gbp_minor : service.list_price_pence;
      priceCell.textContent = formatMoneyMinor(pricePence, '£', 2);
      const selectedCell = el('td');
      selectedCell.textContent = line ? 'Yes' : 'No';
      row.append(shotCell, azimuthCell, elevationCell, priceCell, selectedCell);
      tbody.appendChild(row);
    }
  };

  void loadServices().then(() => {
    return loadEngagement();
  }).then(() => {
    // On load, selected shots count as selected; the last one shows in the camera view.
    const lines = state.engagement?.quote.lines ?? [];
    if (lines.length > 0) {
      const last = lines[lines.length - 1].shot_code;
      state.pipShot = last;
      pip.setAttribute('data-pip-shot', last);
      rig?.setPip(last, state.services);
    }
    pollMeasurement();
  });
  void escapeHtml;
}

function listInteraction(list: HTMLElement, state: RigState, getEngagement: () => Engagement | null, selectShot: (code: string, quantity: number) => void, deselectShot: (code: string) => void, changeShot: (code: string, quantity: number) => void): void {
  list.addEventListener('change', event => {
    const target = event.target as HTMLElement;
    const item = target.closest('li');
    if (!item) {
      return;
    }
    const code = item.dataset.shotCode ?? '';
    const engagement = getEngagement();
    if (engagement === null) {
      return;
    }
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const wasSelected = engagement.quote.lines.some(line => line.shot_code === code);
      if (target.checked && !wasSelected) {
        selectShot(code, 1);
      } else if (!target.checked && wasSelected) {
        deselectShot(code);
      }
    }
    if (target instanceof HTMLInputElement && target.classList.contains('colourways')) {
      const value = Number(target.value);
      if (Number.isInteger(value) && value >= 1 && value <= 6) {
        changeShot(code, value);
      }
    }
  });
  list.addEventListener('keydown', event => {
    const target = event.target as HTMLElement;
    const item = target.closest('li');
    if (!item) {
      return;
    }
    const code = item.dataset.shotCode ?? '';
    if (target instanceof HTMLInputElement && target.classList.contains('colourways')) {
      if (event.key === 'Enter') {
        target.blur();
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        // let the native number stepping run, then send on change
        window.setTimeout(() => {
          const value = Number(target.value);
          if (Number.isInteger(value) && value >= 1 && value <= 6) {
            changeShot(code, value);
          }
        }, 0);
      }
    }
    if (target instanceof HTMLInputElement && target.type === 'checkbox' && (event.key === ' ' || event.key === 'Spacebar')) {
      // The browser toggles the checkbox and fires change.
    }
  });
  void state;
}

function mountRigKeyboard(group: HTMLElement, state: RigState, getEngagement: () => Engagement | null, selectShot: (code: string, quantity: number) => void, deselectShot: (code: string) => void, focusShot: (code: string) => void): void {
  group.addEventListener('keydown', event => {
    const services = state.services;
    if (services.length === 0) {
      return;
    }
    const currentIndex = services.findIndex(service => service.code === state.focusedShot);
    let delta = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      delta = 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      delta = -1;
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      if (state.focusedShot) {
        event.preventDefault();
        const engagement = getEngagement();
        const wasSelected = engagement?.quote.lines.some(line => line.shot_code === state.focusedShot) ?? false;
        if (wasSelected) {
          deselectShot(state.focusedShot);
        } else {
          selectShot(state.focusedShot, 1);
        }
        // Keep the checkbox in sync.
        const checkbox = document.getElementById(`shot-${state.focusedShot}`) as HTMLInputElement | null;
        if (checkbox) {
          checkbox.checked = !wasSelected;
        }
      }
      return;
    } else {
      return;
    }
    event.preventDefault();
    const nextIndex = currentIndex === -1
      ? (delta === 1 ? 0 : services.length - 1)
      : (currentIndex + delta + services.length) % services.length;
    focusShot(services[nextIndex].code);
  });
  // Focus on click as well.
  group.addEventListener('pointerdown', () => {
    if (state.services.length > 0 && !state.focusedShot) {
      focusShot(state.services[0].code);
    }
  });
}

/** The 2D plan view shown without WebGL. */
function mountPlanView(container: HTMLElement): void {
  const wrap = el('div', 'plan-view');
  container.appendChild(wrap);
  wrap.innerHTML = `<svg viewBox="0 0 200 140" aria-hidden="true"></svg>`;
}

interface RigScene {
  setFrustums(codes: string[], services: Service[]): void;
  showFrustumInstant(code: string, services: Service[]): void;
  removeFrustumInstant(code: string): void;
  removeFrustum(code: string): void;
  flyFrustumIn(code: string, services: Service[], done: () => void): void;
  setFrustumEmber(code: string): void;
  fadeFrustumOut(code: string, done: () => void): void;
  setPip(code: string, services: Service[]): void;
  setFocused(code: string, services: Service[]): void;
  setOrbit(azimuth: number): void;
  setProductModel(file: IntakeFile | null): void;
}

function createRigScene(container: HTMLElement, pip: HTMLElement): RigScene | null {
  const handle = createScene(container);
  if (!handle) {
    return null;
  }
  fit(handle, container);
  addStudioLights(handle.scene);

  // Plinth + card outline at true scale.
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.62, 0.1, 64),
    new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9, metalness: 0.05 }),
  );
  plinth.position.y = -0.05;
  handle.scene.add(plinth);
  const cardOutline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.0856, 0.001, 0.054)),
    new THREE.LineBasicMaterial({ color: OFFWHITE, transparent: true, opacity: 0.8 }),
  );
  cardOutline.position.set(0.55, 0.005, 0.25);
  handle.scene.add(cardOutline);

  // Product proxy (the client's GLB would load here; a procedural stand-in shows scale).
  const product = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.21, 0.085),
    new THREE.MeshStandardMaterial({ color: 0x30343e, roughness: 0.3, metalness: 0.6 }),
  );
  product.position.y = 0.105;
  product.visible = false;
  handle.scene.add(product);

  // Frustums on a ring.
  const ring = new THREE.Line(
    new THREE.RingGeometry(1.05, 1.06, 96),
    new THREE.LineBasicMaterial({ color: OFFWHITE, transparent: true, opacity: 0.25 }),
  );
  ring.rotation.x = -Math.PI / 2;
  handle.scene.add(ring);

  const frustumGeometry = (): THREE.BufferGeometry => {
    const cone = new THREE.ConeGeometry(0.16, 0.5, 4, 1, true);
    cone.rotateX(Math.PI / 2);
    cone.translate(0, 0, -0.25);
    const edges = new THREE.EdgesGeometry(cone);
    return edges;
  };

  interface Frustum {
    code: string;
    object: THREE.LineSegments;
  }
  const frustums: Frustum[] = [];

  const positionFor = (code: string, services: Service[], radius: number): THREE.Vector3 | null => {
    const service = services.find(s => s.code === code);
    if (!service) {
      return null;
    }
    const azimuth = THREE.MathUtils.degToRad(service.azimuth_deg);
    const elevation = THREE.MathUtils.degToRad(service.elevation_deg);
    const height = Math.sin(elevation) * radius + 0.35;
    const horizontal = Math.cos(elevation) * radius;
    return new THREE.Vector3(Math.sin(azimuth) * horizontal, height, Math.cos(azimuth) * horizontal);
  };

  const orientedAt = (code: string, services: Service[], radius: number, edge: THREE.BufferGeometry): THREE.LineSegments => {
    const object = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: OFFWHITE, transparent: true, opacity: 0.9 }));
    const position = positionFor(code, services, radius);
    if (position) {
      object.position.copy(position);
      object.lookAt(0, position.y, 0);
    }
    return object;
  };

  const setFrustums = (codes: string[], services: Service[]): void => {
    for (const frustum of frustums) {
      if (!codes.includes(frustum.code)) {
        handle.scene.remove(frustum.object);
      }
    }
    // Rebuild the list from the codes.
    frustums.length = 0;
    for (const code of codes) {
      const object = orientedAt(code, services, 1.0, frustumGeometry());
      handle.scene.add(object);
      frustums.push({ code, object });
    }
    updateContainer();
  };

  const findFrustum = (code: string): Frustum | undefined => frustums.find(f => f.code === code);

  // Main camera orbit.
  let orbit = 0;
  const setOrbit = (azimuth: number): void => {
    orbit = azimuth;
  };

  // Picture-in-picture camera.
  let pipCode = 'overview';
  const pipHandle = createScene(pip);
  if (pipHandle) {
    fit(pipHandle, pip);
    addStudioLights(pipHandle.scene);
    const pipProduct = product.clone();
    pipHandle.scene.add(pipProduct);
  }

  const updateContainer = (): void => {
    const azimuthRad = THREE.MathUtils.degToRad(orbit);
    handle.camera.position.set(Math.sin(azimuthRad) * 3.2, 1.5, Math.cos(azimuthRad) * 3.2);
    handle.camera.lookAt(0, 0.3, 0);
    container.setAttribute('data-orbit-azimuth', String(((orbit % 360) + 360) % 360));
  };
  updateContainer();

  // Drag orbit.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  container.addEventListener('pointerdown', event => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    container.setPointerCapture(event.pointerId);
  });
  container.addEventListener('pointermove', event => {
    if (!dragging) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (Math.abs(dx) >= Math.abs(dy)) {
      orbit = (orbit + dx * 0.4 + 360) % 360;
      updateContainer();
    } else {
      window.scrollBy(0, -dy);
    }
  });
  container.addEventListener('pointerup', () => {
    dragging = false;
  });
  container.addEventListener('pointercancel', () => {
    dragging = false;
  });

  animateLoop(() => {
    updateContainer();
    handle.render();
    if (pipHandle) {
      const service = pipCode === 'overview' ? null : servicesCache.find(s => s.code === pipCode);
      if (service) {
        const azimuth = THREE.MathUtils.degToRad(service.azimuth_deg);
        const elevation = THREE.MathUtils.degToRad(service.elevation_deg);
        const radius = 1.4;
        pipHandle.camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * radius, Math.sin(elevation) * radius + 0.3, Math.cos(azimuth) * Math.cos(elevation) * radius);
        pipHandle.camera.lookAt(0, 0.25, 0);
      } else {
        pipHandle.camera.position.set(0, 1.4, 3.0);
        pipHandle.camera.lookAt(0, 0.25, 0);
      }
      pipHandle.render();
    }
  });

  let servicesCache: Service[] = [];

  return {
    setFrustums(codes, services) {
      servicesCache = services;
      setFrustums(codes, services);
    },
    showFrustumInstant(code, services) {
      servicesCache = services;
      if (!findFrustum(code)) {
        const object = orientedAt(code, services, 1.0, frustumGeometry());
        handle.scene.add(object);
        frustums.push({ code, object });
      }
      updateContainer();
    },
    removeFrustumInstant(code) {
      const frustum = findFrustum(code);
      if (frustum) {
        handle.scene.remove(frustum.object);
        frustums.splice(frustums.indexOf(frustum), 1);
      }
    },
    removeFrustum(code) {
      const frustum = findFrustum(code);
      if (frustum) {
        handle.scene.remove(frustum.object);
        frustums.splice(frustums.indexOf(frustum), 1);
      }
    },
    flyFrustumIn(code, services, done) {
      servicesCache = services;
      let frustum = findFrustum(code);
      if (!frustum) {
        const object = orientedAt(code, services, 1.6, frustumGeometry());
        handle.scene.add(object);
        frustum = { code, object };
        frustums.push(frustum);
      }
      const start = frustum.object.position.clone();
      const target = positionFor(code, services, 1.0);
      if (!target) {
        done();
        return;
      }
      tween(600, t => {
        frustum?.object.position.lerpVectors(start, target, t);
        frustum?.object.lookAt(0, target.y, 0);
      }, done);
    },
    setFrustumEmber(code) {
      const frustum = findFrustum(code);
      if (frustum) {
        (frustum.object.material as THREE.LineBasicMaterial).color.set(EMBER);
      }
    },
    fadeFrustumOut(code, done) {
      const frustum = findFrustum(code);
      if (!frustum) {
        done();
        return;
      }
      (frustum.object.material as THREE.LineBasicMaterial).color.set(OFFWHITE);
      const start = frustum.object.position.clone();
      const target = positionFor(code, servicesCache, 1.6);
      if (!target) {
        done();
        return;
      }
      tween(500, t => {
        frustum?.object.position.lerpVectors(start, target, t);
      }, done);
    },
    setPip(code, services) {
      pipCode = code;
      servicesCache = services;
      const label = document.getElementById('pip-label');
      if (label) {
        const service = services.find(s => s.code === code);
        label.textContent = code === 'overview' ? 'Overview' : (service?.title ?? code);
      }
    },
    setFocused(code, services) {
      for (const frustum of frustums) {
        (frustum.object.material as THREE.LineBasicMaterial).color.set(frustum.code === code ? EMBER : OFFWHITE);
      }
    },
    setOrbit(azimuth) {
      orbit = azimuth;
      updateContainer();
    },
    setProductModel(file) {
      product.visible = file !== null;
      if (file && file.dimensions_mm) {
        const mm = file.dimensions_mm;
        product.scale.set(Math.max(mm.x / 180, 0.05), Math.max(mm.y / 210, 0.05), Math.max(mm.z / 85, 0.05));
        product.position.y = (mm.y / 210) * 0.105;
      }
    },
  };
}
