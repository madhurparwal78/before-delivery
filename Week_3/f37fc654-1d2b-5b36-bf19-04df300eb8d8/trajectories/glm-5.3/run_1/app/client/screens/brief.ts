/** The Cue-line Brief: six questions, one per screen, typed with the guide cursor. */
import { getApp, goto, setStatus } from '../app.js';
import { api, ApiError } from '../api.js';
import { el } from '../dom.js';
import { renderTypedHeading, createCursor, riseControls } from '../cue-line.js';
import type { BriefShape, Venue } from '../types.js';
import type { RouteContext } from './router.js';

interface Question {
  text: string;
  kind: 'chips' | 'venue' | 'fields' | 'checkboxes';
  labels?: string[];
}

const QUESTIONS: Question[] = [
  { text: 'What should stand in the room?', kind: 'chips', labels: ['Camera-reactive wall', 'Generative portrait kiosk', 'Voice-driven projection room'] },
  { text: 'Where will it stand?', kind: 'venue' },
  { text: 'How big is the room?', kind: 'fields' },
  { text: 'Which wall has the main door?', kind: 'chips', labels: ['Front wall', 'Back wall', 'Left wall', 'Right wall'] },
  { text: 'How many people at once?', kind: 'chips', labels: ['Up to 25', '25 to 100', '100 to 300', 'Over 300'] },
  { text: 'Anything else to try?', kind: 'checkboxes', labels: ['Ambient sound', 'Night-mode lighting', 'Photo takeaway'] },
];

const DUST_BY_AUDIENCE: Record<string, number> = {
  'up-to-25': 40,
  '25-100': 80,
  '100-300': 140,
  'over-300': 220,
};

const SILHOUETTE_BY_TYPE: Record<string, 'camera-reactive-wall' | 'portrait-kiosk' | 'projection-room'> = {
  'camera-reactive-wall': 'camera-reactive-wall',
  'portrait-kiosk': 'portrait-kiosk',
  'projection-room': 'projection-room',
};

/** A kept answer survives sign-in and is replayed once. */
interface PendingAnswer {
  briefId: string | null;
  step: number;
  answer: Record<string, unknown>;
}

const pendingStore: { answer: PendingAnswer | null } = { answer: null };

export async function briefScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('brief');
  app.main.textContent = '';
  const path = ctx.path;
  const stepParam = ctx.params.get('step');

  // Pending answers replay once after sign-in.
  if (pendingStore.answer && path === '/brief/new' && pendingStore.answer.briefId === null) {
    await replayPending(app, pendingStore.answer);
    pendingStore.answer = null;
    return;
  }

  if (path === '/brief/new') {
    const n = Number(stepParam);
    if (stepParam !== '1' || !Number.isFinite(n) || n !== 1) {
      history.replaceState({}, '', '/brief/new?step=1');
      await renderQuestion(app, null, 1, true);
      return;
    }
    await renderQuestion(app, null, 1, true);
    return;
  }

  // /briefs/<id>?step=<n>
  const id = path.split('/')[2] ?? '';
  const brief = await api<BriefShape>(`/briefs/${id}`).catch(() => null);
  if (!brief) {
    // A signed-out visitor opening a completed draft is sent to sign in with this address as return route.
    goto(`/auth/login?returnTo=${encodeURIComponent(path)}`);
    return;
  }
  if (brief.commissionId) {
    goto(`/c/${brief.commissionId}`);
    return;
  }
  const nextStep = brief.nextStep ?? 6;
  let n = Number(stepParam);
  if (!Number.isFinite(n) || n < 1 || n > 6 || n > nextStep) {
    history.replaceState({}, '', `/briefs/${id}?step=${nextStep}`);
    n = nextStep;
  }
  await renderQuestion(app, brief, n, n === 1);
}

async function replayPending(app: ReturnType<typeof getApp>, pending: PendingAnswer): Promise<void> {
  const created = await api<BriefShape>('/briefs', { method: 'POST' });
  const brief = await api<BriefShape>(`/briefs/${created.id}/steps/1`, { method: 'PUT', body: { answer: pending.answer } });
  applyStage(app, 1, pending.answer);
  await advance(app, brief, created.id, 2);
}

async function renderQuestion(app: ReturnType<typeof getApp>, brief: BriefShape | null, step: number, playIntro: boolean): Promise<void> {
  const question = QUESTIONS[step - 1];
  if (!question) return;
  const answers = (brief?.answers ?? {}) as Record<string, unknown>;

  const screen = el('section', { class: 'brief-screen' });
  const headingWrap = el('div', { class: 'brief-heading-wrap' });
  const heading = el('h1', { class: 'brief-question', tabindex: '-1' });
  const cursor = createCursor();
  headingWrap.append(heading, cursor);

  const introLine = 'Hi. Six questions, then your room.';
  const intro = playIntro ? el('p', { class: 'brief-intro', 'data-typed': '0' }) : null;

  const controls = el('div', { class: 'brief-controls' });
  const okRow = el('div', { class: 'brief-ok-row', 'data-rise': '1' });
  const ok = el('button', { class: 'btn primary ok-btn', disabled: 'true' }, 'OK');
  const arrow = el('span', { class: 'ok-arrow', 'aria-hidden': 'true' }, '→');
  ok.textContent = '';
  ok.append(document.createTextNode('OK '), arrow);
  const hint = el('span', { class: 'key-hint', 'aria-hidden': 'true' });
  const closeChip = el('button', { class: 'chip close-brief' }, 'CLOSE ×');

  const progress = app.statusRegions.brief;

  if (intro) {
    const introCursor = createCursor();
    intro.append(introCursor);
    headingWrap.before(intro);
  }
  screen.append(headingWrap);
  const controlsWrap = el('div', { class: 'brief-answer' });
  controlsWrap.append(controls, okRow);
  screen.append(controlsWrap);
  app.main.append(screen);


  const answerState: { value: Record<string, unknown> } = { value: {} };

  const buildControls = (): void => {
    controls.textContent = '';
    if (question.kind === 'chips' || question.kind === 'checkboxes') {
      const isRadio = question.kind === 'chips';
      const group = el('div', { role: isRadio ? 'radiogroup' : 'group', class: 'chip-group', 'data-rise': '1' });
      group.setAttribute('aria-label', question.text);
      question.labels?.forEach((label, i) => {
        const chip = el('label', { class: 'chip-wrap' });
        const input = el('input', { type: isRadio ? 'radio' : 'checkbox', class: 'chip-input', name: `q${step}` });
        input.setAttribute('aria-label', label);
        chip.append(input, el('span', { class: 'chip-box', 'aria-hidden': 'true' }, ''));
        const text = el('span', { class: 'chip-label' }, label);
        chip.append(text);
        input.addEventListener('change', () => {
          ok.disabled = false;
          if (isRadio) {
            answerState.value = step === 1 ? { ...answerState.value, installationType: mapType(label) } : answerState.value;
            if (step === 4) answerState.value = { doorWall: mapWall(label) };
            if (step === 5) answerState.value = { audience: mapAudience(label) };
          } else {
            const checked = Array.from(group.querySelectorAll<HTMLInputElement>('input:checked')).map((n) => mapAddon(n.getAttribute('aria-label') ?? ''));
            answerState.value = { ...answerState.value, addOns: checked };
          }
        });
        group.append(chip);
        if (isRadio && i === 0 && group.firstChild) {
          // Radios move with arrow keys natively.
        }
      });
      controls.append(group);
    }
    if (question.kind === 'venue') {
      const combo = el('div', { class: 'combo', 'data-rise': '1' });
      const input = el('input', { type: 'text', class: 'answer-field', placeholder: 'Start typing the venue or address', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', autocomplete: 'off' });
      input.setAttribute('aria-label', 'Venue');
      const listbox = el('ul', { role: 'listbox', class: 'venue-list', 'aria-label': 'Venues' });
      combo.append(input, listbox);
      controls.append(combo);
      let activeIndex = -1;
      let latestQuery = '';
      let latestToken = 0;
      let venues: Venue[] = [];
      const closeList = (): void => {
        listbox.textContent = '';
        input.setAttribute('aria-expanded', 'false');
        activeIndex = -1;
      };
      input.addEventListener('input', () => {
        const q = input.value;
        ok.disabled = q.trim().length === 0;
        latestQuery = q;
        const token = ++latestToken;
        // Suggestions arrive 250 ms after the last keystroke; only the latest shows.
        window.setTimeout(async () => {
          if (token !== latestToken || q !== latestQuery) return;
          const result = await api<{ venues: Venue[] }>(`/venues?q=${encodeURIComponent(q)}`).catch(() => ({ venues: [] }));
          if (token !== latestToken) return;
          venues = result.venues;
          listbox.textContent = '';
          venues.forEach((v, i) => {
            const option = el('li', { role: 'option', class: 'venue-option', 'aria-selected': 'false', tabindex: '-1' }, `${v.name} — ${v.city}`);
            option.addEventListener('click', () => {
              pick(v, i);
            });
            listbox.append(option);
          });
          input.setAttribute('aria-expanded', venues.length > 0 ? 'true' : 'false');
        }, 250);
      });
      input.addEventListener('keydown', (e) => {
        const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = Math.min(options.length - 1, activeIndex + 1);
          options.forEach((o, i) => {
            o.classList.toggle('active', i === activeIndex);
            o.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
          });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = Math.max(0, activeIndex - 1);
          options.forEach((o, i) => {
            o.classList.toggle('active', i === activeIndex);
            o.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
          });
        } else if (e.key === 'Enter' && activeIndex >= 0) {
          e.preventDefault();
          const v = venues[activeIndex];
          if (v) pick(v, activeIndex);
        }
      });
      const pick = (v: Venue, index: number): void => {
        input.value = v.name;
        answerState.value = { venueId: v.id };
        ok.disabled = false;
        closeList();
        activeIndex = index;
      };
      (combo as unknown as { refresh: undefined }).refresh = undefined;
    }
    if (question.kind === 'fields') {
      const fields = el('div', { class: 'field-pair', 'data-rise': '1' });
      const width = el('input', { type: 'number', class: 'answer-field', placeholder: 'Width in metres', min: '4', max: '60', step: '0.5' });
      width.setAttribute('aria-label', 'Width in metres');
      const depth = el('input', { type: 'number', class: 'answer-field', placeholder: 'Depth in metres', min: '4', max: '60', step: '0.5' });
      depth.setAttribute('aria-label', 'Depth in metres');
      fields.append(width, depth);
      controls.append(fields);
      const check = (): void => {
        const w = Number(width.value);
        const d = Number(depth.value);
        const valid = w >= 4 && w <= 60 && (w * 2) % 1 === 0 && d >= 4 && d <= 60 && (d * 2) % 1 === 0;
        ok.disabled = !valid;
        if (valid) answerState.value = { widthM: w, depthM: d };
      };
      width.addEventListener('input', check);
      depth.addEventListener('input', check);
    }
    if (step === 1) {
      const nameField = el('input', { type: 'text', class: 'answer-field', placeholder: 'Name the piece', maxlength: '80' });
      nameField.setAttribute('aria-label', 'Name the piece');
      nameField.addEventListener('input', () => {
        const t = nameField.value.trim();
        if (t.length >= 2) {
          answerState.value = { ...answerState.value, title: t };
        }
        const hasType = 'installationType' in answerState.value;
        ok.disabled = !(hasType && t.length >= 2);
      });
      const wrap = el('div', { 'data-rise': '1' });
      wrap.append(nameField);
      controls.append(wrap);
    }
    if (step === 6) {
      const notes = el('textarea', { class: 'answer-field notes', placeholder: 'Notes for the studio', maxlength: '2000' });
      notes.setAttribute('aria-label', 'Notes for the studio');
      notes.addEventListener('input', () => {
        const t = notes.value;
        if (t.length <= 2000) answerState.value = { ...answerState.value, notes: t };
      });
      const wrap = el('div', { 'data-rise': '1' });
      wrap.append(notes);
      controls.append(wrap);
    }
  };

  buildControls();
  okRow.append(ok, hint);
  hint.textContent = question.kind === 'chips' || question.kind === 'checkboxes' ? 'ENTER ↵ to continue' : 'ENTER ↵ · SHIFT+ENTER new line';
  const closeWrap = el('div', { class: 'close-brief-wrap' });
  closeWrap.append(closeChip);
  screen.append(closeWrap);

  const leaveBrief = (): void => {
    const me = app.me;
    goto(me ? '/commissions' : '/');
  };
  closeChip.addEventListener('click', leaveBrief);

  const submit = async (): Promise<void> => {
    if (ok.disabled) return;
    ok.disabled = true;
    let briefId = brief?.id ?? null;
    const answer = answerState.value;
    if (!briefId) {
      // A signed-out visitor keeps the answer in the browser and is sent to sign in.
      const me = app.me;
      if (!me) {
        pendingStore.answer = { briefId: null, step, answer };
        location.href = `/auth/login?returnTo=${encodeURIComponent('/brief/new?step=1')}`;
        return;
      }
      const created = await api<BriefShape>('/briefs', { method: 'POST' }).catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      });
      if (!created) return;
      briefId = created.id;
    }
    try {
      const updated = await api<BriefShape>(`/briefs/${briefId}/steps/${step}`, { method: 'PUT', body: { answer } });
      applyStage(app, step, answer);
      if (step === 6) {
        setStatus(progress, 'Brief complete. Your room is ready.');
        const completed = await api<{ id: string }>(`/briefs/${briefId}/complete`, { method: 'POST' });
        goto(`/c/${completed.id}`);
        return;
      }
      setStatus(progress, `Answer saved. Question ${step + 1} of 6.`);
      await advance(app, updated, briefId, step + 1);
    } catch (e) {
      ok.disabled = false;
      if (e instanceof ApiError) {
        setStatus(progress, e.message || 'Something went wrong.');
      }
    }
  };

  ok.addEventListener('click', () => {
    void submit();
  });

  screen.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      leaveBrief();
    }
    if (e.key === 'Enter' && e.shiftKey && (e.target as HTMLElement).tagName === 'TEXTAREA') {
      // Shift+Enter adds a new line natively.
    }
  });

  renderTypedHeading(heading, question.text, cursor, () => {
    riseControls(controlsWrap);
    const first = controlsWrap.querySelector<HTMLElement>('input');
    first?.focus();
  });
}

async function advance(app: ReturnType<typeof getApp>, brief: BriefShape, briefId: string, nextStep: number): Promise<void> {
  history.replaceState({}, '', `/briefs/${briefId}?step=${nextStep}`);
  await renderQuestion(app, brief, nextStep, false);
}

function applyStage(app: ReturnType<typeof getApp>, step: number, answer: Record<string, unknown>): void {
  if (step === 1 && typeof answer['installationType'] === 'string') {
    app.stage.setRoom(undefined, undefined, SILHOUETTE_BY_TYPE[answer['installationType']]);
    app.stage.pulseAnswer();
  }
  if (step === 3) {
    const w = Number(answer['widthM']);
    const d = Number(answer['depthM']);
    if (Number.isFinite(w) && Number.isFinite(d)) {
      app.stage.setRoom(w, d);
      app.stage.pulseAnswer();
    }
  }
  if (step === 5 && typeof answer['audience'] === 'string') {
    app.stage.setRoom(undefined, undefined, undefined, DUST_BY_AUDIENCE[answer['audience']] ?? 60);
    app.stage.pulseAnswer();
  }
}

function mapType(label: string): string {
  if (label === 'Camera-reactive wall') return 'camera-reactive-wall';
  if (label === 'Generative portrait kiosk') return 'portrait-kiosk';
  return 'projection-room';
}

function mapWall(label: string): string {
  if (label === 'Front wall') return 'front';
  if (label === 'Back wall') return 'back';
  if (label === 'Left wall') return 'left';
  return 'right';
}

function mapAudience(label: string): string {
  if (label === 'Up to 25') return 'up-to-25';
  if (label === '25 to 100') return '25-100';
  if (label === '100 to 300') return '100-300';
  return 'over-300';
}

function mapAddon(label: string): string {
  if (label === 'Ambient sound') return 'ambient-sound';
  if (label === 'Night-mode lighting') return 'night-lighting';
  return 'photo-takeaway';
}
