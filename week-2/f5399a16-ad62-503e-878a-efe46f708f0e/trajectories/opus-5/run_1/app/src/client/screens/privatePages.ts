import { FEE_COPY, framesText, privateCopy } from '../../domain/privateCopy.js';
import type { Language } from '../../domain/privateCopy.js';
import {
  announce,
  api,
  closeSurface,
  isRefusal,
  openSurface,
  redraw,
  registerScreen,
  run,
  state,
} from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { registerSurface } from '../shell.js';
import { button, field, loadingBars, problemsRegion, surfaceView } from '../ui.js';

type PageFrame = {
  number: number;
  position: number;
  durationFrames: number;
  timecodeIn: string;
  actionNote: string;
  drawingUrl: string | null;
};

type ReviewPage = {
  language: Language;
  jobTitle: string;
  cut: number;
  frameRate: string;
  aspect: string;
  dueDate: string;
  endsAt: string;
  name: string | null;
  frames: PageFrame[];
  notes: {
    id: string;
    frame: number;
    x: number;
    y: number;
    text: string;
    suggestedSeconds: string | null;
    suggestedFrames: number | null;
    attachmentUrl: string | null;
    createdAt: string;
  }[];
};

type Ended = { ended: true; language: Language; message: string };

type ReviewData = { page: ReviewPage | null; ended: Ended | null };

type Pin = {
  frame: number;
  x: number;
  y: number;
  text: string;
  length: string;
  attachmentId: string | null;
};

const review = {
  playing: false,
  playTimer: null as number | null,
  step: 0 as 0 | 1 | 2,
  frame: 0,
  pins: [] as Pin[],
  name: '',
  sendKey: '',
  sent: false,
  crosshair: null as { x: number; y: number } | null,
  storageRefused: false,
  frames: null as number | null,
};

const DRAFT_KEY = 'clapstick-review-draft';

function language(): Language {
  const data = state.data as unknown as ReviewData;
  return data.page?.language ?? data.ended?.language ?? 'en';
}

function say(key: string, placeholders: Record<string, string | number> = {}): string {
  return privateCopy(key, language(), placeholders);
}

function keepDraft(): void {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ pins: review.pins, name: review.name, sendKey: review.sendKey }),
    );
  } catch {
    review.storageRefused = true;
  }
}

function readDraft(): void {
  try {
    const held = localStorage.getItem(DRAFT_KEY);
    if (held === null) return;
    const parsed = JSON.parse(held) as { pins?: Pin[]; name?: string; sendKey?: string };
    review.pins = parsed.pins ?? [];
    review.name = parsed.name ?? '';
    review.sendKey = parsed.sendKey ?? '';
  } catch {
    review.storageRefused = true;
  }
}

function ensureSendKey(): string {
  if (review.sendKey === '') {
    review.sendKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    keepDraft();
  }
  return review.sendKey;
}

registerScreen({
  name: 'review',
  frame: 'private',
  refreshes: true,
  heading: (raw) => {
    const data = raw as unknown as ReviewData;
    if (data.ended !== null) return data.ended.message;
    return privateCopy('reviewHeading', language(), { title: data.page?.jobTitle ?? '' });
  },
  load: async () => {
    try {
      const page = await api<ReviewPage>(`/api/r/${state.screen.token ?? ''}`);
      state.language = page.language;
      state.direction = page.language === 'ar' ? 'rtl' : 'ltr';
      if (review.sendKey === '' && review.pins.length === 0) readDraft();
      if (page.name !== null) review.name = page.name;
      return { page, ended: null } as unknown as Record<string, unknown>;
    } catch (error) {
      if (isRefusal(error) && error.failure.status === 410) {
        const asked = (navigator.language ?? 'en').slice(0, 2);
        const held = (['en', 'nl', 'fr', 'ar'] as const).includes(asked as Language)
          ? (asked as Language)
          : 'en';
        state.language = held;
        state.direction = held === 'ar' ? 'rtl' : 'ltr';
        return {
          page: null,
          ended: { ended: true, language: held, message: error.failure.message },
        } as unknown as Record<string, unknown>;
      }
      throw error;
    }
  },
  mainAction: (raw) => {
    const data = raw as unknown as ReviewData;
    if (data.page === null) return null;
    if (review.step === 2) {
      return button({
        id: 'send-notes',
        label: say('sendNotes'),
        kind: 'primary',
        pendingKey: 'send-notes',
        working: say('working'),
        onPress: () => void sendNotes(),
      });
    }
    return h(
      'div',
      { class: 'pair' },
      review.step > 0
        ? button({
            id: 'step-back',
            label: say('back'),
            working: say('working'),
            onPress: () => moveStep(-1),
          })
        : null,
      button({
        id: 'step-next',
        label: say('next'),
        kind: 'primary',
        working: say('working'),
        onPress: () => moveStep(1),
      }),
    );
  },
  view: (raw) => {
    const data = raw as unknown as ReviewData;
    if (data.ended !== null) return [endedView(data.ended)];
    const page = data.page;
    if (state.loading || page === null) return [loadingBars('…')];
    const frame = page.frames[review.frame];
    const steps = ['stepFrames', 'stepNotes', 'stepSend'] as const;
    return [
      h(
        'div',
        {
          key: 'steps',
          class: 'steps',
          role: 'group',
          'aria-label': say('stepsGroup'),
          onkeydown: (event: globalThis.Event) => stepKeys(event as KeyboardEvent),
        },
        ...steps.map((key, index) =>
          h(
            'button',
            {
              key,
              id: `step-${index}`,
              type: 'button',
              class: 'step',
              tabindex: review.step === index ? '0' : '-1',
              'aria-current': review.step === index ? 'step' : undefined,
              onclick: () => {
                review.step = index as 0 | 1 | 2;
                redraw();
              },
            },
            say(key),
          ),
        ),
      ),
      h(
        'div',
        {
          key: 'film-strip',
          class: 'film-strip strip-scroll',
          role: 'group',
          'aria-label': say('filmStrip'),
          dir: 'ltr',
          onkeydown: (event: globalThis.Event) => stripKeys(event as KeyboardEvent, page),
        },
        h(
          'div',
          { class: 'strip' },
          ...page.frames.map((candidate, index) =>
            h(
              'button',
              {
                key: `clip-${candidate.number}`,
                id: `page-clip-${candidate.number}`,
                type: 'button',
                class: 'clip',
                'data-part': 'clip',
                'data-frame': String(candidate.number),
                'data-duration': String(candidate.durationFrames),
                'aria-label': say('clip', { number: candidate.number }),
                'aria-current': review.frame === index ? 'true' : 'false',
                tabindex: review.frame === index ? '0' : '-1',
                style: `width:${candidate.durationFrames * 2}px`,
                onclick: () => {
                  review.frame = index;
                  redraw();
                },
              },
              candidate.drawingUrl === null
                ? null
                : h('img', { src: candidate.drawingUrl, alt: '' }),
            ),
          ),
          h('span', {
            'data-part': 'playhead',
            'data-position': String(frame?.number ?? 0),
            style: `inset-inline-start:${startOf(page, review.frame) * 2}px`,
          }),
        ),
      ),
      h(
        'p',
        { key: 'timecode', class: 'numeric', dir: 'ltr' },
        frame?.timecodeIn ?? '',
      ),
      h(
        'div',
        {
          key: 'frame-view',
          'data-part': 'frame-view',
          onpointerdown: (event: globalThis.Event) => placePinByTap(event as PointerEvent),
        },
        frame?.drawingUrl === null || frame === undefined
          ? null
          : h('img', { src: frame.drawingUrl, alt: say('clip', { number: frame.number }) }),
        ...review.pins
          .filter((pin) => pin.frame === (frame?.number ?? -1))
          .map((pin, index) =>
            h('span', {
              key: `pin-${index}`,
              'data-part': 'pin',
              'data-x': String(pin.x),
              'data-y': String(pin.y),
              style: `left:${pin.x}%;top:${pin.y}%`,
            }),
          ),
        review.crosshair === null
          ? null
          : h('span', {
              key: 'crosshair',
              'data-part': 'crosshair',
              'data-x': String(review.crosshair.x),
              'data-y': String(review.crosshair.y),
              style: `left:${review.crosshair.x}%;top:${review.crosshair.y}%`,
            }),
      ),
      h(
        'div',
        { key: 'strip-controls', class: 'row-actions' },
        button({
          id: 'page-earlier',
          label: say('earlier'),
          working: say('working'),
          onPress: () => stepFrame(page, -1),
        }),
        button({
          id: 'page-play',
          label: review.playing ? say('pause') : say('play'),
          working: say('working'),
          onPress: () => togglePlay(page),
        }),
        button({
          id: 'page-later',
          label: say('later'),
          working: say('working'),
          onPress: () => stepFrame(page, 1),
        }),
      ),
      h(
        'div',
        { key: 'page-actions', class: 'row-actions' },
        button({
          id: 'place-a-pin',
          label: say('placePin'),
          working: say('working'),
          onPress: startCrosshair,
          extra: { onkeydown: (event: globalThis.Event) => crosshairKeys(event as KeyboardEvent) },
        }),
        button({
          id: 'open-notes',
          label: say('openSheet'),
          working: say('working'),
          onPress: () =>
            openSurface('Notes sheet', 'open-notes', { kind: 'sheet', sheet: 'notes' }),
        }),
      ),
      review.storageRefused
        ? h('p', { key: 'draft-refused' }, say('draftRefused'))
        : null,
      review.sent ? h('p', { key: 'sent' }, say('notesSent')) : null,
      review.step === 2
        ? h(
            'div',
            { key: 'send-step', class: 'form' },
            problemsRegion(state.problems, { heading: say('problems') }),
            review.sent
              ? null
              : field({
                  id: 'name',
                  label: say('nameField'),
                  autocomplete: 'name',
                  value: review.name,
                  onInput: (value) => {
                    review.name = value;
                    keepDraft();
                  },
                  problem: state.problems['name'],
                }),
          )
        : null,
    ];
  },
});

function stepFrame(page: ReviewPage, by: number): void {
  review.frame = Math.min(page.frames.length - 1, Math.max(0, review.frame + by));
  redraw();
}

/** Playback steps the strip frame by frame and stops on the last frame. */
function togglePlay(page: ReviewPage): void {
  if (review.playing) {
    if (review.playTimer !== null) window.clearInterval(review.playTimer);
    review.playTimer = null;
    review.playing = false;
    redraw();
    return;
  }
  review.playing = true;
  review.playTimer = window.setInterval(() => {
    if (review.frame >= page.frames.length - 1 || document.hidden) {
      togglePlay(page);
      return;
    }
    review.frame += 1;
    redraw();
  }, 400);
  redraw();
}

function startOf(page: ReviewPage, index: number): number {
  let running = 0;
  for (let at = 0; at < index; at += 1) running += page.frames[at]?.durationFrames ?? 0;
  return running;
}

function endedView(ended: Ended): Child {
  return h(
    'div',
    { key: 'ended', class: 'form form--narrow' },
    problemsRegion(state.problems, { heading: privateCopy('problems', ended.language) }),
    field({
      id: 'email',
      label: privateCopy('mailField', ended.language),
      kind: 'email',
      autocomplete: 'email',
      value: review.name,
      onInput: (value) => {
        review.name = value;
      },
      problem: state.problems['email'],
    }),
    button({
      id: 'ask-for-a-new-link',
      label: privateCopy('askLink', ended.language),
      kind: 'primary',
      pendingKey: 'new-link',
      working: privateCopy('working', ended.language),
      onPress: () =>
        void run('new-link', async () => {
          try {
            const answer = await api<{ message: string }>(
              `/api/r/${state.screen.token ?? ''}/new-link`,
              { method: 'POST', body: { email: review.name } },
            );
            announce(answer.message);
          } catch (error) {
            if (isRefusal(error)) {
              announce(error.failure.message);
              return;
            }
            throw error;
          }
        }),
    }),
  );
}

/** Left and Right move through the steps, mirrored in Arabic. */
function stepKeys(event: KeyboardEvent): void {
  const mirrored = language() === 'ar';
  const steps: Record<string, number> = {
    ArrowRight: mirrored ? -1 : 1,
    ArrowLeft: mirrored ? 1 : -1,
  };
  if (event.key === 'Home') {
    event.preventDefault();
    review.step = 0;
    focusStep();
    return;
  }
  if (event.key === 'End') {
    event.preventDefault();
    review.step = 2;
    focusStep();
    return;
  }
  const step = steps[event.key];
  if (step === undefined) return;
  event.preventDefault();
  moveStep(step);
}

function moveStep(by: number): void {
  review.step = Math.min(2, Math.max(0, review.step + by)) as 0 | 1 | 2;
  focusStep();
}

function focusStep(): void {
  redraw();
  requestAnimationFrame(() => document.getElementById(`step-${review.step}`)?.focus());
}

/** On the film strip Left still moves earlier, even in Arabic. */
function stripKeys(event: KeyboardEvent, page: ReviewPage): void {
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
  const step = steps[event.key];
  if (step === undefined) return;
  event.preventDefault();
  review.frame = Math.min(page.frames.length - 1, Math.max(0, review.frame + step));
  redraw();
  requestAnimationFrame(() => {
    const frame = page.frames[review.frame];
    if (frame !== undefined) document.getElementById(`page-clip-${frame.number}`)?.focus();
  });
}

function placePinByTap(event: PointerEvent): void {
  const view = event.currentTarget as HTMLElement;
  const box = view.getBoundingClientRect();
  addPin(
    Math.round(((event.clientX - box.left) / box.width) * 1000) / 10,
    Math.round(((event.clientY - box.top) / box.height) * 1000) / 10,
  );
}

/** By keyboard the crosshair starts at the centre and moves in the direction pressed. */
function startCrosshair(): void {
  review.crosshair = { x: 50, y: 50 };
  redraw();
}

function crosshairKeys(event: KeyboardEvent): void {
  if (review.crosshair === null) return;
  const steps: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (event.key === 'Escape') {
    event.stopPropagation();
    review.crosshair = null;
    redraw();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const place = review.crosshair;
    review.crosshair = null;
    addPin(place.x, place.y);
    return;
  }
  const step = steps[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const scale = event.shiftKey ? 10 : 1;
  review.crosshair = {
    x: Math.min(100, Math.max(0, review.crosshair.x + step[0] * scale)),
    y: Math.min(100, Math.max(0, review.crosshair.y + step[1] * scale)),
  };
  redraw();
}

/** Placing a pin opens the Notes sheet with focus on its first field. */
function addPin(x: number, y: number): void {
  const page = (state.data as unknown as ReviewData).page;
  const frame = page?.frames[review.frame];
  if (frame === undefined) return;
  review.pins.push({ frame: frame.number, x, y, text: '', length: '', attachmentId: null });
  keepDraft();
  openSurface('Notes sheet', 'place-a-pin', { kind: 'sheet', sheet: 'notes' });
}

registerSurface('Notes sheet', (surface) => {
  const page = (state.data as unknown as ReviewData).page;
  const pins = review.pins;
  return surfaceView(surface, {
    title: say('stepNotes'),
    closeLabel: say('close'),
    body: [
      problemsRegion(surface.problems, {
        heading: say('problems'),
        withLinks: false,
        message: surface.message,
      }),
      ...pins.map((pin, index) =>
        h(
          'div',
          { key: `pin-note-${index}`, class: 'panel' },
          h('p', { class: 'numeric', dir: 'ltr' }, `${pin.frame} · ${pin.x}% ${pin.y}%`),
          field({
            id: `note-text-${index}`,
            label: say('noteField'),
            kind: 'multiline',
            value: pin.text,
            onInput: (value) => {
              pin.text = value;
              keepDraft();
            },
          }),
          field({
            id: `note-length-${index}`,
            label: say('lengthField'),
            value: pin.length,
            onInput: (value) => {
              pin.length = value;
              keepDraft();
            },
            extra: {
              onblur: () => void showFrames(pin.length),
            },
          }),
          h(
            'div',
            { class: 'file-field' },
            h(
              'label',
              { class: 'field__label', for: `note-attachment-${index}` },
              say('attachment'),
            ),
            h('input', {
              id: `note-attachment-${index}`,
              type: 'file',
              class: 'input',
              accept: 'image/png,image/jpeg',
              onchange: (event: globalThis.Event) => {
                const picked = (event.target as HTMLInputElement).files?.[0];
                if (picked !== undefined) void attach(surface, pin, picked);
              },
            }),
          ),
          review.frames === null
            ? null
            : h('p', { class: 'numeric' }, framesText(review.frames, language())),
        ),
      ),
      pins.length === 0 ? h('p', {}, say('emptyNote')) : null,
    ],
    footer: [
      button({
        id: 'add-note',
        label: say('addNote'),
        working: say('working'),
        onPress: () => {
          closeSurface('Notes sheet');
        },
      }),
    ],
  });
});

/** An attachment is judged like a frame's drawing: PNG or JPEG, on the file alone. */
async function attach(
  surface: { problems: Record<string, string>; message: string | null },
  pin: Pin,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const answer = await api<{ attachmentId: string }>(
      `/api/r/${state.screen.token ?? ''}/attachments`,
      { form },
    );
    pin.attachmentId = answer.attachmentId;
    surface.problems = {};
    surface.message = null;
  } catch (error) {
    if (isRefusal(error)) {
      surface.problems = error.failure.fields;
      surface.message = error.failure.message;
      announce(error.failure.message);
    }
  }
  redraw();
}

/** It shows in frames once the field is left, at the job's rate. */
async function showFrames(typed: string): Promise<void> {
  if (typed.trim() === '') {
    review.frames = null;
    redraw();
    return;
  }
  try {
    const answer = await api<{ seconds: string; frames: number }>(
      `/api/r/${state.screen.token ?? ''}/length`,
      { method: 'POST', body: { length: typed } },
    );
    review.frames = answer.frames;
    state.problems = {};
  } catch (error) {
    if (isRefusal(error)) {
      review.frames = null;
      state.problems = error.failure.fields;
      announce(error.failure.message);
    }
  }
  redraw();
}

/** Pressing Send notes twice sends once. */
async function sendNotes(): Promise<void> {
  await run('send-notes', async () => {
    state.problems = {};
    try {
      await api(`/api/r/${state.screen.token ?? ''}/notes`, {
        method: 'POST',
        body: {
          sendKey: ensureSendKey(),
          name: review.name,
          notes: review.pins.map((pin) => ({
            frame: pin.frame,
            x: pin.x,
            y: pin.y,
            text: pin.text,
            suggestedLength: pin.length === '' ? null : pin.length,
            attachmentId: pin.attachmentId,
          })),
        },
      });
      review.sent = true;
      announce(say('notesSent'));
      redraw();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems = error.failure.fields;
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}

type SignOffPage = {
  language: Language;
  jobTitle: string;
  cut: number;
  frameRate: string;
  endsAt: string;
  signedOffAt: string | null;
  signedOffText: string | null;
  frames: PageFrame[];
};

type SignOffData = { page: SignOffPage | null; ended: Ended | null };

const signOff = { name: '' };

registerScreen({
  name: 'signOff',
  frame: 'private',
  refreshes: true,
  heading: (raw) => {
    const data = raw as unknown as SignOffData;
    if (data.ended !== null) return data.ended.message;
    return privateCopy('signOffHeading', data.page?.language ?? 'en', {
      title: data.page?.jobTitle ?? '',
    });
  },
  load: async () => {
    try {
      const page = await api<SignOffPage>(`/api/s/${state.screen.token ?? ''}`);
      state.language = page.language;
      state.direction = page.language === 'ar' ? 'rtl' : 'ltr';
      return { page, ended: null } as unknown as Record<string, unknown>;
    } catch (error) {
      if (isRefusal(error) && error.failure.status === 410) {
        return {
          page: null,
          ended: { ended: true, language: 'en', message: error.failure.message },
        } as unknown as Record<string, unknown>;
      }
      throw error;
    }
  },
  mainAction: (raw) => {
    const data = raw as unknown as SignOffData;
    if (data.page === null || data.page.signedOffAt !== null) return null;
    return button({
      id: 'sign-off',
      label: privateCopy('signOffButton', data.page.language),
      kind: 'primary',
      pendingKey: 'sign-off',
      working: privateCopy('working', data.page.language),
      onPress: () => void sign(data.page as SignOffPage),
    });
  },
  view: (raw) => {
    const data = raw as unknown as SignOffData;
    if (data.ended !== null) {
      return [h('p', { key: 'ended' }, data.ended.message)];
    }
    const page = data.page;
    if (state.loading || page === null) return [loadingBars('…')];
    return [
      page.signedOffText === null
        ? null
        : h('p', { key: 'signed', 'data-part': 'signed' }, page.signedOffText),
      h(
        'ul',
        { key: 'frames', class: 'list-plain' },
        ...page.frames.map((frame) =>
          h(
            'li',
            { key: `frame-${frame.number}` },
            frame.drawingUrl === null
              ? null
              : h('img', {
                  src: frame.drawingUrl,
                  alt: privateCopy('clip', page.language, { number: frame.number }),
                  style: 'max-width:100%;height:auto',
                }),
            h(
              'p',
              { class: 'numeric', dir: 'ltr' },
              `${frame.number} · ${frame.timecodeIn}`,
            ),
            h('p', {}, frame.actionNote),
          ),
        ),
      ),
      page.signedOffAt !== null
        ? null
        : h(
            'div',
            { key: 'form', class: 'form form--narrow' },
            problemsRegion(state.problems, { heading: privateCopy('problems', page.language) }),
            field({
              id: 'name',
              label: privateCopy('nameField', page.language),
              autocomplete: 'name',
              value: signOff.name,
              onInput: (value) => {
                signOff.name = value;
              },
              problem: state.problems['name'],
            }),
          ),
    ];
  },
});

async function sign(page: SignOffPage): Promise<void> {
  await run('sign-off', async () => {
    state.problems = {};
    try {
      const answer = await api<{ signedOffAt: string; signedOffText: string }>(
        `/api/s/${state.screen.token ?? ''}/sign`,
        { method: 'POST', body: { name: signOff.name } },
      );
      announce(answer.signedOffText);
      (state.data as unknown as SignOffData).page = {
        ...page,
        signedOffAt: answer.signedOffAt,
        signedOffText: answer.signedOffText,
      };
      redraw();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems =
          Object.keys(error.failure.fields).length > 0
            ? error.failure.fields
            : { name: error.failure.message };
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}

type FeePage = {
  jobTitle: string;
  currency: string;
  feeText: string;
  taxText: string;
  totalText: string;
  milestones: { number: number; amountText: string; taxText: string }[];
  state: string;
  stamp: string;
  endsAt: string | null;
  pdfUrl: string;
};

type FeeData = { page: FeePage | null; ended: Ended | null };

const fee = { name: '' };

registerScreen({
  name: 'fee',
  frame: 'private',
  refreshes: true,
  heading: (raw) => {
    const data = raw as unknown as FeeData;
    if (data.ended !== null) return data.ended.message;
    return FEE_COPY.heading.replace('<title>', data.page?.jobTitle ?? '');
  },
  load: async () => {
    state.language = 'en';
    state.direction = 'ltr';
    try {
      const page = await api<FeePage>(`/api/f/${state.screen.token ?? ''}`);
      return { page, ended: null } as unknown as Record<string, unknown>;
    } catch (error) {
      if (isRefusal(error) && error.failure.status === 410) {
        return {
          page: null,
          ended: { ended: true, language: 'en', message: error.failure.message },
        } as unknown as Record<string, unknown>;
      }
      throw error;
    }
  },
  mainAction: (raw) => {
    const data = raw as unknown as FeeData;
    if (data.page === null || data.page.state === 'accepted') return null;
    return button({
      id: 'accept-letter',
      label: FEE_COPY.button,
      kind: 'primary',
      pendingKey: 'accept',
      onPress: () => void accept(data.page as FeePage),
    });
  },
  view: (raw) => {
    const data = raw as unknown as FeeData;
    if (data.ended !== null) return [h('p', { key: 'ended' }, data.ended.message)];
    const page = data.page;
    if (state.loading || page === null) return [loadingBars('…')];
    return [
      h(
        'ul',
        { key: 'milestones', class: 'list-plain' },
        ...page.milestones.map((milestone) =>
          h(
            'li',
            { key: `milestone-${milestone.number}`, class: 'numeric' },
            `Milestone ${milestone.number}: ${milestone.amountText} + ${milestone.taxText}`,
          ),
        ),
      ),
      h('p', { key: 'fee', class: 'numeric' }, `Fee ${page.feeText}`),
      h('p', { key: 'tax', class: 'numeric' }, `Tax ${page.taxText}`),
      h('p', { key: 'total', class: 'numeric' }, `Total ${page.totalText}`),
      h(
        'p',
        { key: 'pdf' },
        h('a', { href: page.pdfUrl, class: 'link' }, FEE_COPY.openLetter),
      ),
      page.state === 'accepted'
        ? h('p', { key: 'accepted' }, FEE_COPY.accepted)
        : h(
            'div',
            { key: 'form', class: 'form form--narrow' },
            problemsRegion(state.problems),
            field({
              id: 'name',
              label: privateCopy('nameField', 'en'),
              autocomplete: 'name',
              value: fee.name,
              onInput: (value) => {
                fee.name = value;
              },
              problem: state.problems['name'],
            }),
          ),
    ];
  },
});

async function accept(page: FeePage): Promise<void> {
  await run('accept', async () => {
    state.problems = {};
    try {
      await api(`/api/f/${state.screen.token ?? ''}/accept`, {
        method: 'POST',
        body: { name: fee.name, stamp: page.stamp },
      });
      announce(FEE_COPY.accepted);
      (state.data as unknown as FeeData).page = { ...page, state: 'accepted' };
      redraw();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems =
          Object.keys(error.failure.fields).length > 0
            ? error.failure.fields
            : { name: error.failure.message };
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}

