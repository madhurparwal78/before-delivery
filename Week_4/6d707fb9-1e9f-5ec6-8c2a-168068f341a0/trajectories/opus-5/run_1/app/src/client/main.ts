import {
  announce,
  api,
  type ApiAnswer,
  clearProblems,
  errorOf,
  focusHeading,
  pick,
  pickAll,
  showProblems,
  valueOf,
  working,
} from './dom';
import { closeDialog, closeTop, isOpen, openCount, openDialog, topDialog, trapTab } from './dialogs';
import { comboboxKeys, optionAt, pickMaterial, searchMaterials } from './comboboxes';
import { restoreDraft } from './drafts';
import { applyFrameWidth, toggleSheet, watchHeader, watchPinned, watchStrip } from './frame';
import { endIntro, introPlaying, startIntro } from './intro';
import { goTo, onBack, readData, screenData, startRefresh } from './navigate';
import { rollTo } from './morph';
import { call, sessionEnded } from './session';
import { measureKeys, nextStage, openFactors, showMeasure } from './strata';
import {
  addReading,
  keepMine,
  keepRecorded,
  refuseSignOutWhileWaiting,
  sendWaiting,
  showWaitingLine,
} from './visitQueue';
import { announce as announceCopy, answerCopy, copy } from '../server/domain/copy';
import type { Language } from '../server/domain/numbers';

const PAUSE_MS = 300;
const WORKING = 'Working\u2026';

function language(): Language {
  const held = screenData().language;
  return held === 'fr' || held === 'tr' || held === 'ar' ? held : 'en';
}

function onAnswerPage(): boolean {
  return screenData().screen === 'answer';
}

function workingText(): string {
  return onAnswerPage() ? answerCopy.working[language()] : WORKING;
}

function problemsName(): string {
  return onAnswerPage() ? answerCopy.problems[language()] : 'Problems';
}

function actionOf(target: EventTarget | null): { action: string; element: HTMLElement } | null {
  if (!(target instanceof Element)) return null;
  const found = target.closest('[data-action]') as HTMLElement | null;
  if (!found) return null;
  return { action: found.dataset.action as string, element: found };
}

function styleId(): string {
  const held = screenData().styleId;
  return typeof held === 'string' ? held : '';
}

function version(): number {
  const held = screenData().version;
  return typeof held === 'number' ? held : 0;
}

async function reload(): Promise<void> {
  await goTo(location.pathname + location.search, 'none');
}

function refused(scope: ParentNode, answer: ApiAnswer): boolean {
  if (answer.status < 400) return false;
  if (answer.status === 401 && sessionEnded()) return true;
  const failure = errorOf(answer);
  if (!failure) return true;
  showProblems(scope, failure, problemsName());
  announce(failure.message);
  return true;
}

function dialogById(id: string): HTMLElement | null {
  return pick<HTMLElement>(`#${id}`);
}

/* ---------------------------------------------------------------- styles list */

function listAddress(changes: Record<string, string | null>): string {
  const parameters = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') parameters.delete(key);
    else parameters.set(key, value);
  }
  const text = parameters.toString();
  return `${location.pathname}${text === '' ? '' : `?${text}`}`;
}

async function commitList(changes: Record<string, string | null>): Promise<void> {
  history.replaceState({ scrollY: window.scrollY }, '');
  const kept = { ...changes };
  if (!('cursor' in kept)) kept.cursor = null;
  await goTo(listAddress(kept), 'push');
  const count = screenData().shownCount;
  if (typeof count === 'number') announce(announceCopy.stylesShown(count));
}

/* ------------------------------------------------------------- row action menu */

let rowMenuFor: string | null = null;

function openRowMenu(button: HTMLElement): void {
  const menu = pick<HTMLElement>('[data-part="row-menu"]');
  if (!menu) return;
  rowMenuFor = button.dataset.style ?? null;
  const row = button.closest('tr');
  const box = button.getBoundingClientRect();
  menu.style.setProperty('--left', `${Math.max(8, Math.min(box.left, window.innerWidth - 220))}px`);
  const below = window.innerHeight - box.bottom;
  menu.style.setProperty('--top', below > 180 ? `${box.bottom + 4}px` : `${Math.max(8, box.top - 180)}px`);
  if (row) row.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-expanded', 'true');
  openDialog(menu, button);
  const first = pick<HTMLElement>('[data-action="menu-open"]', menu);
  if (first) first.focus();
}

function closeRowMenu(): void {
  const menu = pick<HTMLElement>('[data-part="row-menu"]');
  if (!menu || !isOpen(menu)) return;
  for (const button of pickAll('[data-action="open-row-menu"]')) button.setAttribute('aria-expanded', 'false');
  closeDialog(menu);
}

function rowMenuKeys(event: KeyboardEvent): boolean {
  const menu = pick<HTMLElement>('[data-part="row-menu"]');
  if (!menu || !isOpen(menu)) return false;
  const items = pickAll<HTMLElement>('[role="menuitem"]', menu);
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'ArrowDown') {
    (items[(at + 1) % items.length] as HTMLElement).focus();
    event.preventDefault();
    return true;
  }
  if (event.key === 'ArrowUp') {
    (items[(at - 1 + items.length) % items.length] as HTMLElement).focus();
    event.preventDefault();
    return true;
  }
  return false;
}

/* ----------------------------------------------------------- try one garment */

let estimateTimer = 0;
let estimateTurn = 0;

function estimateChoice(): { garment: string; fibre: string; country: string } {
  const garment = pick<HTMLInputElement>('input[name="garment"]:checked');
  const fibre = pick<HTMLSelectElement>('#try-fibre');
  const country = pick<HTMLSelectElement>('#try-country');
  return {
    garment: garment ? garment.value : 'tshirt',
    fibre: fibre ? fibre.value : 'organic-cotton',
    country: country ? country.value : 'PT',
  };
}

/** After the published pause the figure answers in place; an earlier answer is ignored. */
function askEstimate(): void {
  const choice = estimateChoice();
  history.replaceState({}, '', `/?garment=${choice.garment}&fibre=${choice.fibre}&country=${choice.country}`);
  window.clearTimeout(estimateTimer);
  estimateTimer = window.setTimeout(() => {
    const turn = (estimateTurn += 1);
    void api(
      'GET',
      `/api/estimate?garment=${encodeURIComponent(choice.garment)}&fibre=${encodeURIComponent(
        choice.fibre,
      )}&country=${encodeURIComponent(choice.country)}`,
    ).then((answer) => {
      if (turn !== estimateTurn) return;
      const shown = answer.body.shown;
      if (typeof shown !== 'string') return;
      const figure = pick('[data-part="estimate-figure"]');
      if (figure) rollTo(figure, shown);
      announce(shown);
    });
  }, PAUSE_MS);
}

/* ------------------------------------------------------------------ questions */

function toggleQuestion(button: HTMLElement): void {
  const section = button.closest('.accordion') as HTMLElement | null;
  if (!section) return;
  const slug = section.dataset.slug as string;
  const open = button.getAttribute('aria-expanded') === 'true';
  void goTo(open ? location.pathname : `${location.pathname}?q=${slug}`, 'push').then(() => {
    const again = pick<HTMLElement>(`.accordion[data-slug="${slug}"] .accordion-button`);
    if (again) again.focus();
  });
}

/* ------------------------------------------------------------------- scenarios */

let scenarioTimer = 0;

function scenarioAddress(kind: string, key: string, value: string, drop: boolean): string {
  const parameters = new URLSearchParams(location.search);
  const kept = parameters.getAll(kind).filter((entry) => !entry.startsWith(`${key}:`));
  parameters.delete(kind);
  for (const entry of kept) parameters.append(kind, entry);
  if (!drop) parameters.append(kind, `${key}:${value}`);
  const text = parameters.toString();
  return `${location.pathname}${text === '' ? '' : `?${text}`}`;
}

/** A change is committed once its pause has ended, as one history entry. */
function commitScenario(kind: string, key: string, value: string, drop: boolean): void {
  window.clearTimeout(scenarioTimer);
  const address = scenarioAddress(kind, key, value, drop);
  scenarioTimer = window.setTimeout(() => {
    void goTo(address, 'push').then(() => {
      const held = screenData().measures;
      if (Array.isArray(held)) {
        const climate = (held as { measure: string; totalShown: string }[]).find(
          (entry) => entry.measure === 'climate',
        );
        if (climate) announce(announceCopy.scenarioTotal(climate.totalShown));
      }
    });
  }, PAUSE_MS);
}

/* -------------------------------------------------------------- material lines */

function lineFields(): Record<string, unknown> {
  const dialog = dialogById('add-material');
  const scope = dialog ?? document;
  const kind = pick<HTMLInputElement>('input[name="massKind"]:checked', scope);
  const body: Record<string, unknown> = {
    materialId: (pick<HTMLInputElement>('#material-search', scope)?.dataset.materialId ?? '').trim(),
    baseVersion: version(),
  };
  if (kind && kind.value === 'plain') {
    body.massGrams = valueOf('massGrams', scope);
  } else {
    body.fabricWeightGsm = valueOf('fabricWeightGsm', scope);
    body.areaM2 = valueOf('areaM2', scope);
  }
  const fibres: { name: string; sharePercent: string }[] = [];
  for (const row of pickAll<HTMLInputElement>('[data-part="fibres"] input', scope)) {
    if (!row.name.endsWith('Name')) continue;
    const index = row.name.replace(/\D/g, '');
    const share = pick<HTMLInputElement>(`[name="fibre${index}Share"]`, scope);
    fibres.push({ name: row.value.trim(), sharePercent: share ? share.value.trim() : '' });
  }
  body.fibres = fibres;
  for (const tier of [1, 2, 3]) {
    const factory = valueOf(`tier${tier}Factory`, scope);
    const town = valueOf(`tier${tier}Town`, scope);
    const country = valueOf(`tier${tier}Country`, scope);
    body[`tier${tier}`] =
      factory === '' && town === '' && country === ''
        ? null
        : {
            factory: factory === '' ? null : factory,
            town: town === '' ? null : town,
            country: country === '' ? null : country,
          };
  }
  return body;
}

function addFibreRow(): void {
  const holder = pick<HTMLElement>('[data-part="fibres"]');
  if (!holder) return;
  const count = pickAll('input[name$="Name"]', holder).length + 1;
  const block = document.createElement('div');
  block.innerHTML = `<p class="field"><label class="field-label" for="fibre-${count}-name">Fibre ${count} name</label>
    <input id="fibre-${count}-name" name="fibre${count}Name" type="text"></p>
  <p class="field"><label class="field-label" for="fibre-${count}-share">Fibre ${count} share (%)</label>
    <input id="fibre-${count}-share" name="fibre${count}Share" type="text"></p>`;
  while (block.firstChild) holder.append(block.firstChild);
}

async function moveLine(button: HTMLElement): Promise<void> {
  const row = button.closest('[data-line]') as HTMLElement | null;
  if (!row) return;
  const lineId = row.dataset.line as string;
  const direction = button.dataset.direction as string;
  if (button.getAttribute('aria-disabled') === 'true') return;
  const material = row.querySelector('.line-material')?.textContent ?? '';
  const answer = await working(button, workingText(), () =>
    call('POST', `/api/styles/${styleId()}/lines/${lineId}/move`, { direction, baseVersion: version() }),
  );
  if (answer.status >= 400) {
    const failure = errorOf(answer);
    if (failure) announce(failure.message);
    return;
  }
  const position = Number(answer.body.position ?? 0);
  const total = Number(answer.body.total ?? 0);
  await reload();
  const again = pick<HTMLElement>(
    `[data-line="${lineId}"] [data-action="move-line"][data-direction="${direction}"]`,
  );
  if (again) again.focus();
  announce(announceCopy.lineMoved(material, position, total));
}


/* ----------------------------------------------------------------- answer page */

let step = 0;
const evidenceIds: string[] = [];

function stepCount(): number {
  return pickAll('[data-part="steps"] .step').length;
}

function showStep(next: number): void {
  const total = stepCount();
  if (total === 0) return;
  step = Math.max(0, Math.min(total - 1, next));
  pickAll<HTMLElement>('[data-part="steps"] .step').forEach((button, index) => {
    if (index === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    button.setAttribute('tabindex', index === step ? '0' : '-1');
  });
  pickAll<HTMLElement>('[data-part="step-panels"] .step-panel').forEach((panel, index) => {
    panel.hidden = index !== step;
  });
  const last = step === total - 1;
  const nextButton = pick<HTMLElement>('[data-action="step-next"]');
  const sendButton = pick<HTMLElement>('[data-action="send-answers"]');
  if (nextButton) nextButton.hidden = last;
  if (sendButton) sendButton.hidden = !last;
}

function stepKeys(event: KeyboardEvent): boolean {
  const rail = pick('[data-part="steps"]');
  if (!rail || !(event.target instanceof Element) || !rail.contains(event.target)) return false;
  const forward = language() === 'ar' ? 'ArrowLeft' : 'ArrowRight';
  const back = language() === 'ar' ? 'ArrowRight' : 'ArrowLeft';
  if (event.key === forward) showStep(step + 1);
  else if (event.key === back) showStep(step - 1);
  else if (event.key === 'Home') showStep(0);
  else if (event.key === 'End') showStep(stepCount() - 1);
  else return false;
  event.preventDefault();
  const current = pickAll<HTMLElement>('[data-part="steps"] .step')[step];
  if (current) current.focus();
  return true;
}

async function uploadEvidence(input: HTMLInputElement): Promise<void> {
  const file = input.files && input.files[0];
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  const answer = await api('POST', `/api/a/${token()}/evidence`, body);
  if (answer.status >= 400) {
    const failure = errorOf(answer);
    if (failure) {
      showProblems(document, failure, problemsName());
      announce(failure.message);
    }
    input.value = '';
    return;
  }
  const id = answer.body.evidenceId;
  if (typeof id === 'string') {
    evidenceIds.push(id);
    const list = pick('[data-part="evidence-list"]');
    if (list) {
      const item = document.createElement('li');
      item.textContent = String(answer.body.fileName ?? '');
      list.append(item);
    }
  }
}

function token(): string {
  const parts = location.pathname.split('/');
  return parts[parts.length - 1] ?? '';
}

const ANSWER_DRAFT = 'fioAnswerDraft';

/** A supplier's draft survives a reload. */
function saveAnswerDraft(): void {
  const held: Record<string, string> = {};
  for (const field of pickAll<HTMLInputElement>('#energy-value, #water-value, #fibre-origin')) {
    held[field.id] = field.value;
  }
  const unit = pick<HTMLInputElement>('input[name="unit"]:checked');
  if (unit) held.unit = unit.value;
  try {
    window.localStorage.setItem(`${ANSWER_DRAFT}:${token()}`, JSON.stringify(held));
  } catch {
    /* a device with no storage keeps the draft in this page only */
  }
}

function restoreAnswerDraft(): void {
  let held: Record<string, string> = {};
  try {
    const text = window.localStorage.getItem(`${ANSWER_DRAFT}:${token()}`);
    held = text ? (JSON.parse(text) as Record<string, string>) : {};
  } catch {
    return;
  }
  for (const [id, value] of Object.entries(held)) {
    if (id === 'unit') {
      const radio = pick<HTMLInputElement>(`input[name="unit"][value="${value}"]`);
      if (radio) radio.checked = true;
      const shown = pick('[data-part="unit-shown"]');
      const label = radio?.closest('label');
      if (shown && label) shown.textContent = label.textContent?.trim() ?? '';
      continue;
    }
    const field = pick<HTMLInputElement>(`#${id}`);
    if (field) field.value = value;
  }
}

let sendingAnswers = false;

/** Pressing Send answers twice sends once. */
async function sendAnswers(button: HTMLElement): Promise<void> {
  if (sendingAnswers) return;
  sendingAnswers = true;
  clearProblems(document);
  const questions = (screenData().questions ?? []) as string[];
  const body: Record<string, unknown> = { evidenceIds };
  if (questions.includes('energy')) {
    body.energy = {
      value: valueOf('energyValue'),
      unit: pick<HTMLInputElement>('input[name="unit"]:checked')?.value ?? 'kWh',
    };
  }
  if (questions.includes('water')) body.water = { value: valueOf('waterValue') };
  if (questions.includes('fibreOrigin')) {
    body.fibreOrigin = pick<HTMLSelectElement>('#fibre-origin')?.value ?? '';
  }
  try {
    const answer = await working(button, workingText(), () => api('POST', `/api/a/${token()}/answers`, body));
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure, problemsName());
        announce(failure.message);
      }
      return;
    }
    const sent = pick<HTMLElement>('[data-part="sent-line"]');
    if (sent) sent.hidden = false;
    announce(answerCopy.sent[language()]);
  } finally {
    sendingAnswers = false;
  }
}


/* ------------------------------------------------------------------- dispatcher */

const actions: Record<string, (element: HTMLElement, event: Event) => void | Promise<void>> = {
  'skip-intro': () => endIntro(),

  'toggle-mega': (element) => {
    const mega = pick<HTMLElement>('[data-part="mega-menu"]');
    if (mega) toggleSheet(mega, element);
  },

  'toggle-menu': (element) => {
    const rail = pick<HTMLElement>('[data-part="desk-menu"]');
    if (rail) toggleSheet(rail, element);
  },

  'sign-out': async (element) => {
    if (refuseSignOutWhileWaiting()) return;
    await working(element, workingText(), () => call('POST', '/api/sign-out'));
    location.assign('/sign-in');
  },

  'toggle-question': (element) => toggleQuestion(element),

  'estimate-choice': () => askEstimate(),

  'sign-in': async (element, event) => {
    event.preventDefault();
    clearProblems(document);
    const answer = await working(element, WORKING, () =>
      api('POST', '/api/sign-in', {
        email: valueOf('email'),
        password: pick<HTMLInputElement>('[name="password"]')?.value ?? '',
      }),
    );
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    const next = screenData().next;
    location.assign(typeof next === 'string' && next.startsWith('/') ? next : '/styles');
  },

  'sign-up': async (element, event) => {
    event.preventDefault();
    clearProblems(document);
    const answer = await working(element, WORKING, () =>
      api('POST', '/api/sign-up', {
        name: valueOf('name'),
        email: valueOf('email'),
        password: pick<HTMLInputElement>('[name="password"]')?.value ?? '',
      }),
    );
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    location.assign('/styles');
  },

  'open-dialog': (element) => {
    const target = element.dataset.target as string;
    const dialog = dialogById(target);
    if (dialog) {
      clearProblems(dialog);
      openDialog(dialog, element);
      if (target === 'new-request') void fillRequestLines();
    }
  },

  'close-dialog': (element) => {
    const dialog = element.closest('[data-dialog]') as HTMLElement | null;
    if (dialog) closeDialog(dialog);
  },

  'save-style': async (element) => {
    const dialog = dialogById('new-style') as HTMLElement;
    clearProblems(dialog);
    const repair = valueOf('repairService', dialog);
    const washes = valueOf('washes', dialog);
    const range = valueOf('rangeSize', dialog);
    const body: Record<string, unknown> = {
      labelId: valueOf('labelId', dialog),
      name: valueOf('name', dialog),
      season: valueOf('season', dialog),
      gtin: valueOf('gtin', dialog),
      garment: valueOf('garment', dialog),
    };
    const code = valueOf('styleCode', dialog);
    if (code !== '') body.styleCode = code;
    if (washes !== '') body.washes = Number(washes);
    if (repair !== '') body.repairService = repair === 'true';
    if (range !== '') body.rangeSize = Number(range);
    const notes = valueOf('notes', dialog);
    if (notes !== '') body.notes = notes;
    const answer = await working(element, WORKING, () => call('POST', '/api/styles', body));
    if (refused(dialog, answer)) return;
    const name = String(answer.body.name ?? '');
    closeDialog(dialog);
    await goTo(`/styles/${String(answer.body.id)}`, 'push');
    focusHeading();
    announce(announceCopy.styleAdded(name));
  },

  'preview-catalogue': async (element) => {
    const dialog = dialogById('bring-in-catalogue') as HTMLElement;
    clearProblems(dialog);
    const input = pick<HTMLInputElement>('#catalogue-file', dialog);
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;
    const text = await file.text();
    const answer = await working(element, WORKING, () =>
      fetch(`/api/labels/${valueOf('labelId', dialog)}/catalogue/preview`, {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: text,
        credentials: 'same-origin',
      }).then(async (held) => ({
        status: held.status,
        body: (await held.json().catch(() => ({}))) as Record<string, unknown>,
        headers: held.headers,
      })),
    );
    if (refused(dialog, answer)) return;
    drawCataloguePreview(dialog, answer.body);
    announce(
      announceCopy.cataloguePreview(
        Number(answer.body.newCount ?? 0),
        Number(answer.body.matchedCount ?? 0),
        Number(answer.body.refusedCount ?? 0),
      ),
    );
  },

  'save-catalogue': async (element) => {
    const dialog = dialogById('bring-in-catalogue') as HTMLElement;
    clearProblems(dialog);
    const input = pick<HTMLInputElement>('#catalogue-file', dialog);
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;
    const text = await file.text();
    const answer = await working(element, WORKING, () =>
      fetch(`/api/labels/${valueOf('labelId', dialog)}/catalogue/save`, {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: text,
        credentials: 'same-origin',
      }).then(async (held) => ({
        status: held.status,
        body: (await held.json().catch(() => ({}))) as Record<string, unknown>,
        headers: held.headers,
      })),
    );
    if (refused(dialog, answer)) return;
    closeDialog(dialog);
    await reload();
    announce(
      announceCopy.catalogueSaved(
        Number(answer.body.newCount ?? 0),
        Number(answer.body.matchedCount ?? 0),
        Number(answer.body.refusedCount ?? 0),
      ),
    );
  },

  'open-row-menu': (element) => openRowMenu(element),

  'menu-open': () => {
    if (!rowMenuFor) return;
    const id = rowMenuFor;
    closeRowMenu();
    try {
      window.sessionStorage.setItem('fioLastStyle', id);
    } catch {
      /* no storage, no focus restore */
    }
    void goTo(`/styles/${id}`, 'push').then(focusHeading);
  },

  'menu-duplicate': async (element) => {
    if (!rowMenuFor) return;
    const answer = await working(element, WORKING, () =>
      call('POST', `/api/styles/${rowMenuFor}/duplicate`),
    );
    closeRowMenu();
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) announce(failure.message);
      return;
    }
    await goTo(`/styles/${String(answer.body.id)}`, 'push');
    focusHeading();
    announce(announceCopy.styleAdded(String(answer.body.name ?? '')));
  },

  'menu-archive': async (element) => {
    if (!rowMenuFor) return;
    const answer = await working(element, WORKING, () => call('POST', `/api/styles/${rowMenuFor}/archive`));
    closeRowMenu();
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) announce(failure.message);
      return;
    }
    await reload();
    focusHeading();
    announce(announceCopy.styleArchived(String(answer.body.name ?? '')));
  },

  'next-page': async (element) => {
    await commitList({ cursor: element.dataset.cursor ?? null });
  },

  'open-style': (element, event) => {
    event.preventDefault();
    const row = element.closest('[data-style]') as HTMLElement | null;
    if (row && row.dataset.style) {
      try {
        window.sessionStorage.setItem('fioLastStyle', row.dataset.style);
      } catch {
        /* no storage, no focus restore */
      }
    }
    history.replaceState({ scrollY: window.scrollY }, '');
    void goTo((element as HTMLAnchorElement).getAttribute('href') as string, 'push').then(focusHeading);
  },

  /* --------------------------------------------------------------- materials */

  'save-material': async (element) => {
    const dialog = dialogById('add-material') as HTMLElement;
    clearProblems(dialog);
    const editing = dialog.dataset.editing ?? '';
    const body = lineFields();
    const path =
      editing === ''
        ? `/api/styles/${styleId()}/lines`
        : `/api/styles/${styleId()}/lines/${editing}`;
    const answer = await working(element, WORKING, () => call(editing === '' ? 'POST' : 'PATCH', path, body));
    if (refused(dialog, answer)) return;
    const name = String(answer.body.materialName ?? '');
    closeDialog(dialog);
    await reload();
    announce(editing === '' ? announceCopy.lineAdded(name) : announceCopy.lineSaved(name));
  },

  'edit-line': async (element) => {
    const row = element.closest('[data-line]') as HTMLElement | null;
    const dialog = dialogById('add-material');
    if (!row || !dialog) return;
    const lineId = row.dataset.line as string;
    const answer = await call('GET', `/api/styles/${styleId()}/lines`);
    const lines = (answer.body.lines ?? []) as Record<string, unknown>[];
    const line = lines.find((entry) => entry.id === lineId);
    dialog.dataset.editing = lineId;
    dialog.setAttribute('aria-label', 'Edit material');
    const title = pick('.dialog-title', dialog);
    if (title) title.textContent = 'Edit material';
    if (line) {
      const search = pick<HTMLInputElement>('#material-search', dialog);
      if (search) {
        search.value = String(line.materialName ?? '');
        search.dataset.materialId = String(line.materialId ?? '');
      }
      const weight = pick<HTMLInputElement>('[name="fabricWeightGsm"]', dialog);
      if (weight) weight.value = line.fabricWeightGsm === null ? '' : String(line.fabricWeightGsm);
      const area = pick<HTMLInputElement>('[name="areaM2"]', dialog);
      if (area) area.value = line.areaM2 === null ? '' : String(line.areaM2);
      const mass = pick<HTMLInputElement>('[name="massGrams"]', dialog);
      if (mass) mass.value = String(line.massGrams ?? '');
      const plain = line.fabricWeightGsm === null;
      const kind = pick<HTMLInputElement>(`input[name="massKind"][value="${plain ? 'plain' : 'weight'}"]`, dialog);
      if (kind) kind.checked = true;
      const fibres = (line.fibres ?? []) as { name: string; sharePercent: string }[];
      fibres.forEach((fibre, index) => {
        if (index > 0) addFibreRow();
        const name = pick<HTMLInputElement>(`[name="fibre${index + 1}Name"]`, dialog);
        const share = pick<HTMLInputElement>(`[name="fibre${index + 1}Share"]`, dialog);
        if (name) name.value = fibre.name;
        if (share) share.value = fibre.sharePercent;
      });
      for (const tier of [1, 2, 3]) {
        const held = line[`tier${tier}`] as { factory: string | null; town: string | null; country: string | null } | null;
        const factory = pick<HTMLInputElement>(`[name="tier${tier}Factory"]`, dialog);
        const town = pick<HTMLInputElement>(`[name="tier${tier}Town"]`, dialog);
        const country = pick<HTMLSelectElement>(`[name="tier${tier}Country"]`, dialog);
        if (factory) factory.value = held && held.factory ? held.factory : '';
        if (town) town.value = held && held.town ? held.town : '';
        if (country) country.value = held && held.country ? held.country : '';
      }
    }
    openDialog(dialog, element);
  },

  'remove-line': async (element) => {
    const row = element.closest('[data-line]') as HTMLElement | null;
    if (!row) return;
    const name = row.querySelector('.line-material')?.textContent ?? '';
    const answer = await working(element, WORKING, () =>
      call('DELETE', `/api/styles/${styleId()}/lines/${row.dataset.line}?baseVersion=${version()}`),
    );
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) announce(failure.message);
      return;
    }
    await reload();
    focusHeading();
    announce(announceCopy.lineRemoved(name));
  },

  'move-line': (element) => moveLine(element),

  'add-fibre': () => addFibreRow(),

  'save-leg': async (element) => {
    const dialog = dialogById('add-leg') as HTMLElement;
    clearProblems(dialog);
    const answer = await working(element, WORKING, () =>
      call('POST', `/api/styles/${styleId()}/legs`, {
        mode: valueOf('mode', dialog),
        km: valueOf('km', dialog),
        baseVersion: version(),
      }),
    );
    if (refused(dialog, answer)) return;
    closeDialog(dialog);
    await reload();
    announce(announceCopy.legAdded);
  },

  'remove-leg': async (element) => {
    const row = element.closest('[data-leg]') as HTMLElement | null;
    if (!row) return;
    const answer = await working(element, WORKING, () =>
      call('DELETE', `/api/styles/${styleId()}/legs/${row.dataset.leg}?baseVersion=${version()}`),
    );
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) announce(failure.message);
      return;
    }
    await reload();
    focusHeading();
    announce(announceCopy.legRemoved);
  },

  /* ---------------------------------------------------------------- requests */

  'send-request': async (element) => {
    const dialog = dialogById('new-request') as HTMLElement;
    clearProblems(dialog);
    const questions = pickAll<HTMLInputElement>('input[name="questions"]:checked', dialog).map(
      (box) => box.value,
    );
    const answer = await working(element, WORKING, () =>
      call('POST', '/api/requests', {
        styleId: valueOf('styleId', dialog),
        lineId: valueOf('lineId', dialog),
        supplierName: valueOf('supplierName', dialog),
        contactName: valueOf('contactName', dialog),
        contactEmail: valueOf('contactEmail', dialog),
        town: valueOf('town', dialog),
        language: valueOf('language', dialog),
        questions,
        dueDate: valueOf('dueDate', dialog),
      }),
    );
    if (refused(dialog, answer)) return;
    closeDialog(dialog);
    await reload();
    announce(announceCopy.requestSent(String(answer.body.supplierName ?? '')));
  },

  'show-answer': (element) => {
    const row = element.closest('[data-request]') as HTMLElement | null;
    if (!row) return;
    const open = element.getAttribute('aria-expanded') === 'true';
    const parameters = new URLSearchParams(location.search);
    if (open) parameters.delete('answer');
    else parameters.set('answer', row.dataset.request as string);
    const text = parameters.toString();
    void goTo(`${location.pathname}${text === '' ? '' : `?${text}`}`, 'push').then(() => {
      const again = pick<HTMLElement>(`[data-request="${row.dataset.request}"] [data-action="show-answer"]`);
      if (again) again.focus();
    });
  },

  'new-request-address': async (element) => {
    const row = element.closest('[data-request]') as HTMLElement | null;
    if (!row) return;
    const answer = await working(element, WORKING, () =>
      call('POST', `/api/requests/${row.dataset.request}/new-address`),
    );
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) announce(failure.message);
      return;
    }
    await reload();
    announce(announceCopy.newAddressSent(String(answer.body.supplierName ?? '')));
  },

  'end-request': async (element) => {
    const row = element.closest('[data-request]') as HTMLElement | null;
    if (!row) return;
    const answer = await working(element, WORKING, () => call('POST', `/api/requests/${row.dataset.request}/end`));
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) announce(failure.message);
      return;
    }
    await reload();
    announce(announceCopy.pageEnded(String(answer.body.supplierName ?? '')));
  },

  'download-evidence': (element) => {
    window.location.assign(`/api/evidence/${element.dataset.evidence}/file`);
    announce(announceCopy.evidenceDownloaded);
  },

  /* ------------------------------------------------------------------ visits */

  'save-visit': async (element) => {
    const dialog = dialogById('book-visit') as HTMLElement;
    clearProblems(dialog);
    const answer = await working(element, WORKING, () =>
      call('POST', '/api/visits', {
        labelId: valueOf('labelId', dialog),
        factoryName: valueOf('factoryName', dialog),
        town: valueOf('town', dialog),
        localDate: valueOf('localDate', dialog),
        localTime: valueOf('localTime', dialog),
      }),
    );
    if (refused(dialog, answer)) return;
    const name = String(answer.body.factoryName ?? '');
    closeDialog(dialog);
    await goTo(`/visits/${String(answer.body.id)}`, 'push');
    focusHeading();
    announce(announceCopy.visitBooked(name));
  },

  'record-reading': (element) => {
    clearProblems(document);
    const meter = Number(valueOf('meter'));
    const value = valueOf('value');
    const unit = valueOf('unit');
    if (!Number.isInteger(meter) || meter < 1 || value === '') {
      showProblems(document, {
        code: 'validation_failed',
        message: copy.emptyField,
        fields: { [value === '' ? 'value' : 'meter']: copy.emptyField },
      });
      announce(copy.emptyField);
      return;
    }
    addReading(meter, value, unit);
    element.focus();
  },

  'keep-mine': () => {
    const dialog = dialogById('lower-reading');
    if (dialog) closeDialog(dialog);
    keepMine();
  },

  'keep-recorded': () => {
    const dialog = dialogById('lower-reading');
    if (dialog) closeDialog(dialog);
    keepRecorded();
  },

  /* ------------------------------------------------------------------- style */

  'work-out-footprint': async (element) => {
    clearProblems(document);
    const answer = await working(element, WORKING, () => call('POST', `/api/styles/${styleId()}/results`));
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    await reload();
    element.focus();
    announce(announceCopy.footprintWorkedOut(String(answer.body.edition ?? '')));
  },

  'check-newer-factors': async (element) => {
    const answer = await working(element, WORKING, () => call('POST', '/api/factors/check'));
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) announce(failure.message);
      return;
    }
    await reload();
    element.focus();
    const note = pick('[data-part="newer-factors"]');
    announce(note ? (note.textContent ?? '') : copy.noNewerFactors);
  },

  'open-factors': (element) => {
    const stratum = element.closest('[data-part="stratum"]') as HTMLElement | null;
    if (stratum && stratum.dataset.stage) void openFactors(stratum.dataset.stage);
  },

  'next-stage': () => nextStage(),

  'ask-for-score': async (element) => {
    clearProblems(document);
    const answer = await working(element, WORKING, () => call('POST', `/api/styles/${styleId()}/score`));
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    await reload();
    element.focus();
    announce(String(answer.body.shown ?? ''));
  },

  'make-dossier': async (element) => {
    clearProblems(document);
    const answer = await working(element, WORKING, () => call('POST', `/api/styles/${styleId()}/dossiers`));
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    await reload();
    element.focus();
    announce(announceCopy.dossierReady);
  },

  'download-dossier': (element) => {
    window.location.assign(`/api/dossiers/${element.dataset.dossier}/file`);
    announce(announceCopy.dossierDownloaded);
  },

  'download-results': (element) => {
    window.location.assign(`/api/styles/${styleId()}/results-file`);
    element.focus();
    announce(announceCopy.resultsDownloaded);
  },

  'send-sign-off': async (element) => {
    clearProblems(document);
    const answer = await working(element, WORKING, () =>
      call('POST', `/api/dossiers/${element.dataset.dossier}/sign-off-page`),
    );
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    element.focus();
    const contact = screenData().labelContact;
    announce(announceCopy.signOffSent(typeof contact === 'string' ? contact : ''));
  },

  'publish-passport': async (element) => {
    clearProblems(document);
    const answer = await working(element, WORKING, () => call('POST', `/api/styles/${styleId()}/passport`));
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    await reload();
    element.focus();
    announce(announceCopy.passportPublished(Number(answer.body.edition ?? 1)));
  },

  'open-withdraw': (element) => {
    const dialog = dialogById('withdraw-passport');
    if (!dialog) return;
    dialog.dataset.style = element.dataset.style ?? styleId();
    openDialog(dialog, element);
  },

  'withdraw-passport': async (element) => {
    const dialog = dialogById('withdraw-passport') as HTMLElement;
    const id = dialog.dataset.style ?? styleId();
    const answer = await working(element, WORKING, () => call('POST', `/api/styles/${id}/passport/withdraw`));
    if (refused(dialog, answer)) return;
    const name = pick('#page-heading')?.textContent ?? '';
    closeDialog(dialog);
    await reload();
    focusHeading();
    announce(announceCopy.passportWithdrawn(name));
  },

  /* --------------------------------------------------------------- scenarios */

  'save-scenario': async (element) => {
    const dialog = dialogById('save-scenario') as HTMLElement;
    if (!isOpen(dialog)) return;
    clearProblems(dialog);
    const answer = await working(element, WORKING, () =>
      call('POST', `/api/styles/${styleId()}/scenarios`, {
        name: valueOf('name', dialog),
        resultId: screenData().resultId,
        ...scenarioBody(),
      }),
    );
    if (refused(dialog, answer)) return;
    const name = String(answer.body.name ?? '');
    closeDialog(dialog);
    await reload();
    announce(announceCopy.scenarioSaved(name));
  },

  /* ------------------------------------------------------------------ labels */

  'save-label': async (element) => {
    const dialog = dialogById('new-label') as HTMLElement;
    clearProblems(dialog);
    const answer = await working(element, WORKING, () =>
      call('POST', '/api/labels', {
        name: valueOf('name', dialog),
        contactName: valueOf('contactName', dialog),
        contactEmail: valueOf('contactEmail', dialog),
      }),
    );
    if (refused(dialog, answer)) return;
    const name = String(answer.body.name ?? '');
    closeDialog(dialog);
    await goTo(`/labels/${String(answer.body.id)}`, 'push');
    focusHeading();
    announce(announceCopy.labelAdded(name));
  },

  'save-password': async (element) => {
    const dialog = dialogById('change-password') as HTMLElement;
    clearProblems(dialog);
    const answer = await working(element, WORKING, () =>
      call('POST', '/api/password', {
        currentPassword: pick<HTMLInputElement>('[name="currentPassword"]', dialog)?.value ?? '',
        newPassword: pick<HTMLInputElement>('[name="newPassword"]', dialog)?.value ?? '',
      }),
    );
    if (refused(dialog, answer)) return;
    closeDialog(dialog);
    announce(announceCopy.passwordChanged);
  },

  'save-name': async (element) => {
    const dialog = dialogById('rename-label') as HTMLElement;
    clearProblems(dialog);
    const answer = await working(element, WORKING, () =>
      call('PATCH', `/api/labels/${String(screenData().labelId)}`, { name: valueOf('name', dialog) }),
    );
    if (refused(dialog, answer)) return;
    const name = String(answer.body.name ?? '');
    closeDialog(dialog);
    await reload();
    const opener = pick<HTMLElement>('[data-target="rename-label"]');
    if (opener) opener.focus();
    announce(announceCopy.labelRenamed(name));
  },

  'delete-label': async (element) => {
    const dialog = dialogById('delete-label') as HTMLElement;
    const name = String(screenData().labelName ?? '');
    const answer = await working(element, WORKING, () =>
      call('DELETE', `/api/labels/${String(screenData().labelId)}`),
    );
    if (refused(dialog, answer)) return;
    closeDialog(dialog);
    await goTo('/labels', 'push');
    focusHeading();
    announce(announceCopy.labelDeleted(name));
  },

  'close-label': async (element) => {
    const dialog = dialogById('close-label') as HTMLElement;
    const name = String(screenData().labelName ?? '');
    const answer = await working(element, WORKING, () =>
      call('POST', `/api/labels/${String(screenData().labelId)}/close`),
    );
    if (refused(dialog, answer)) return;
    closeDialog(dialog);
    await reload();
    focusHeading();
    const line = pick('[data-part="label-state"]');
    announce(line ? (line.textContent ?? announceCopy.labelBack(name)) : '');
  },

  'bring-back-label': async (element) => {
    const dialog = dialogById('bring-back') as HTMLElement;
    const name = String(screenData().labelName ?? '');
    const answer = await working(element, WORKING, () =>
      call('POST', `/api/labels/${String(screenData().labelId)}/bring-back`),
    );
    if (refused(dialog, answer)) return;
    closeDialog(dialog);
    await reload();
    focusHeading();
    announce(announceCopy.labelBack(name));
  },

  /* ------------------------------------------------- answer and sign-off pages */

  'open-unit-sheet': (element) => {
    const sheet = dialogById('unit-sheet');
    if (sheet) openDialog(sheet, element);
  },

  'step-next': () => showStep(step + 1),
  'step-back': () => showStep(step - 1),
  'send-answers': (element) => sendAnswers(element),

  'sign-off': async (element) => {
    clearProblems(document);
    const answer = await working(element, workingText(), () =>
      api('POST', `/api/s/${token()}/sign`, { name: valueOf('name') }),
    );
    if (answer.status >= 400) {
      const failure = errorOf(answer);
      if (failure) {
        showProblems(document, failure);
        announce(failure.message);
      }
      return;
    }
    await reload();
    element.focus();
    announce(announceCopy.signedOff(String(answer.body.signedOffBy ?? '')));
  },
};

function scenarioBody(): Record<string, unknown> {
  const parameters = new URLSearchParams(location.search);
  const recycled: { lineId: string; percent: number }[] = [];
  const materialSwaps: { lineId: string; materialId: string }[] = [];
  const factorySwaps: { lineId: string; country: string }[] = [];
  const legModes: { legIndex: number; mode: string }[] = [];
  for (const entry of parameters.getAll('recycled')) {
    const [lineId, percent] = entry.split(':');
    if (lineId && percent) recycled.push({ lineId, percent: Number(percent) });
  }
  for (const entry of parameters.getAll('material')) {
    const [lineId, materialId] = entry.split(':');
    if (lineId && materialId) materialSwaps.push({ lineId, materialId });
  }
  for (const entry of parameters.getAll('factory')) {
    const [lineId, country] = entry.split(':');
    if (lineId && country) factorySwaps.push({ lineId, country });
  }
  for (const entry of parameters.getAll('mode')) {
    const [index, mode] = entry.split(':');
    if (index && mode) legModes.push({ legIndex: Number(index), mode });
  }
  return { recycled, materialSwaps, factorySwaps, legModes };
}

function drawCataloguePreview(dialog: HTMLElement, body: Record<string, unknown>): void {
  const holder = pick('[data-part="catalogue-preview"]', dialog);
  if (!holder) return;
  holder.textContent = '';
  const table = document.createElement('table');
  table.className = 'plain';
  table.setAttribute('aria-label', 'Catalogue preview');
  const head = document.createElement('thead');
  head.innerHTML =
    '<tr><th scope="col">Row</th><th scope="col">Style code</th><th scope="col">Name</th><th scope="col">Outcome</th><th scope="col">Reason</th></tr>';
  const tbody = document.createElement('tbody');
  for (const row of (body.rows ?? []) as Record<string, unknown>[]) {
    const line = document.createElement('tr');
    for (const cell of [row.row, row.styleCode, row.name, row.outcome, row.reason ?? '']) {
      const held = document.createElement('td');
      held.textContent = String(cell ?? '');
      line.append(held);
    }
    tbody.append(line);
  }
  table.append(head, tbody);
  holder.append(table);
}

async function fillRequestLines(): Promise<void> {
  const dialog = dialogById('new-request');
  if (!dialog) return;
  const style = valueOf('styleId', dialog);
  const holder = pick<HTMLSelectElement>('[data-part="request-lines"]', dialog);
  if (!holder || style === '') return;
  const answer = await call('GET', `/api/styles/${style}/lines`);
  holder.textContent = '';
  for (const line of (answer.body.lines ?? []) as Record<string, unknown>[]) {
    const option = document.createElement('option');
    option.value = String(line.id);
    option.textContent = `${String(line.materialName)} (line ${String(line.position)})`;
    holder.append(option);
  }
}


/* --------------------------------------------------------------------- events */

document.addEventListener('click', (event) => {
  if (introPlaying()) {
    const skip = (event.target as Element | null)?.closest('[data-action="skip-intro"]');
    if (!skip) return;
  }
  const option = optionAt(event.target);
  if (option) {
    pickMaterial(option.id, option.name);
    event.preventDefault();
    return;
  }
  const found = actionOf(event.target);
  if (found) {
    const run = actions[found.action];
    if (run) {
      void run(found.element, event);
      if (found.element.tagName === 'BUTTON' || found.element.tagName === 'A') {
        if (found.element.getAttribute('href') === null) event.preventDefault();
      }
      return;
    }
  }
  const rail = pick<HTMLElement>('[data-part="desk-menu"]');
  const link = (event.target as Element | null)?.closest('a');
  if (link && rail && rail.contains(link)) return;

  const menu = pick<HTMLElement>('[data-part="row-menu"]');
  if (menu && isOpen(menu) && !menu.contains(event.target as Node)) closeRowMenu();
  const mega = pick<HTMLElement>('[data-part="mega-menu"]');
  if (mega && isOpen(mega) && !mega.contains(event.target as Node)) {
    const opener = pick<HTMLElement>('[data-action="toggle-mega"]');
    if (opener && !opener.contains(event.target as Node)) {
      opener.setAttribute('aria-expanded', 'false');
      closeDialog(mega);
    }
  }
  const sheet = rail && rail.getAttribute('data-sheet') === 'true' ? rail : null;
  if (sheet && isOpen(sheet) && !sheet.contains(event.target as Node)) {
    const opener = pick<HTMLElement>('[data-action="toggle-menu"]');
    if (opener && !opener.contains(event.target as Node)) {
      opener.setAttribute('aria-expanded', 'false');
      closeDialog(sheet);
    }
  }
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLElement;
  if (target.id === 'filter-label') void commitList({ label: (target as HTMLSelectElement).value });
  else if (target.id === 'filter-season') void commitList({ season: (target as HTMLSelectElement).value });
  else if (target.id === 'filter-state') void commitList({ state: (target as HTMLSelectElement).value });
  else if (target.id === 'filter-sort') void commitList({ sort: (target as HTMLSelectElement).value });
  else if (target.id === 'request-style') void fillRequestLines();
  else if (target.id === 'evidence-file') void uploadEvidence(target as HTMLInputElement);
  else if (target.dataset.action === 'estimate-choice') askEstimate();
  else if (target.dataset.action === 'scenario-material') {
    commitScenario('material', target.dataset.line as string, (target as HTMLSelectElement).value, false);
  } else if (target.dataset.action === 'scenario-factory') {
    commitScenario('factory', target.dataset.line as string, (target as HTMLSelectElement).value, false);
  } else if (target.dataset.action === 'scenario-mode') {
    commitScenario('mode', target.dataset.index as string, (target as HTMLSelectElement).value, false);
  } else if (target.getAttribute('name') === 'unit' && onAnswerPage()) {
    const shown = pick('[data-part="unit-shown"]');
    const label = target.closest('label');
    if (shown && label) shown.textContent = label.textContent?.trim() ?? '';
    saveAnswerDraft();
  } else if (onAnswerPage()) {
    saveAnswerDraft();
  }
});

document.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
  if (target.id === 'material-search') {
    (target as HTMLInputElement).dataset.materialId = '';
    searchMaterials((target as HTMLInputElement).value);
  } else if (onAnswerPage()) {
    saveAnswerDraft();
  } else if (target.dataset.action === 'scenario-recycled') {
    commitScenario(
      'recycled',
      target.dataset.line as string,
      (target as HTMLInputElement).value,
      (target as HTMLInputElement).value === '0',
    );
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (introPlaying()) {
      endIntro();
      return;
    }
    if (comboboxKeys(event)) return;
    if (openCount() > 0) {
      const top = topDialog();
      if (top && top.getAttribute('data-part') === 'row-menu') closeRowMenu();
      else closeTop();
      event.preventDefault();
    }
    return;
  }
  if (event.key === 'Tab' && openCount() > 0) {
    trapTab(event);
    return;
  }
  if (comboboxKeys(event)) return;
  if (rowMenuKeys(event)) return;
  if (measureKeys(event)) return;
  if (stepKeys(event)) return;
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    const row = (event.target as Element | null)?.closest('[data-line]') as HTMLElement | null;
    if (row) {
      const direction = event.key === 'ArrowUp' ? 'up' : 'down';
      const button = pick<HTMLElement>(`[data-action="move-line"][data-direction="${direction}"]`, row);
      if (button) {
        event.preventDefault();
        void moveLine(button);
      }
    }
    return;
  }
  if (event.key === 'Enter') {
    const target = event.target as HTMLElement;
    if (target.dataset.action === 'open-row-menu') {
      openRowMenu(target);
      event.preventDefault();
      return;
    }
    if (target.id === 'filter-search') {
      void commitList({ q: (target as HTMLInputElement).value });
      event.preventDefault();
      return;
    }
    if (target.closest('[data-part="sign-in-form"]')) {
      const button = pick<HTMLElement>('[data-action="sign-in"]');
      if (button) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    if (target.closest('[data-part="sign-up-form"]')) {
      const button = pick<HTMLElement>('[data-action="sign-up"]');
      if (button) {
        event.preventDefault();
        button.click();
      }
    }
  }
});

document.addEventListener(
  'focusout',
  (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'filter-search') void commitList({ q: (target as HTMLInputElement).value });
  },
  true,
);

document.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target as HTMLElement;
  if (form.dataset.part === 'sign-in-form') {
    const button = pick<HTMLElement>('[data-action="sign-in"]');
    if (button) button.click();
  }
  if (form.dataset.part === 'sign-up-form') {
    const button = pick<HTMLElement>('[data-action="sign-up"]');
    if (button) button.click();
  }
});

document.addEventListener('click', (event) => {
  const measure = (event.target as Element | null)?.closest('[data-part="measures"] [role="radio"]');
  if (measure) {
    const chosen = measure.getAttribute('data-measure');
    if (chosen) showMeasure(chosen, true);
  }
});

window.addEventListener('online', () => void sendWaiting());
window.addEventListener('offline', () => showWaitingLine());

onBack(() => {
  void goTo(location.pathname + location.search, 'none').then(() => {
    const state = history.state as { scrollY?: number } | null;
    if (state && typeof state.scrollY === 'number') window.scrollTo(0, state.scrollY);
    restoreListFocus();
  });
});

function restoreListFocus(): void {
  if (screenData().screen !== 'styles') return;
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem('fioLastStyle');
    window.sessionStorage.removeItem('fioLastStyle');
  } catch {
    id = null;
  }
  if (!id) return;
  const link = pick<HTMLElement>(`[data-style="${id}"] a[data-action="open-style"]`);
  if (link) link.focus();
}

/** As each statement reaches the pinned fragment the band moves to that measure. */
function movePinnedBand(measure: string): void {
  const band = pick<HTMLElement>('[data-part="pin-band"]');
  if (!band) return;
  const table = JSON.parse(band.dataset.shares ?? '{}') as Record<string, Record<string, string>>;
  const shares = table[measure];
  if (!shares) return;
  band.dataset.measure = measure;
  for (const stratum of pickAll<HTMLElement>('.pin-stratum', band)) {
    const stage = stratum.dataset.stage as string;
    stratum.style.setProperty('--share', `${shares[stage] ?? '0'}%`);
  }
}

function start(): void {
  readData();
  applyFrameWidth();
  window.addEventListener('resize', applyFrameWidth);
  watchHeader();
  watchStrip();
  watchPinned(movePinnedBand);
  startIntro();
  startRefresh();
  restoreDraft();
  restoreListFocus();
  if (screenData().screen === 'visit') {
    showWaitingLine();
    void sendWaiting();
    window.setInterval(() => void sendWaiting(), 5000);
  }
  if (onAnswerPage()) {
    restoreAnswerDraft();
    showStep(0);
  }
  const chosen = screenData().measure;
  if (typeof chosen === 'string' && pick('[data-part="strata"]')) showMeasure(chosen, false);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();

