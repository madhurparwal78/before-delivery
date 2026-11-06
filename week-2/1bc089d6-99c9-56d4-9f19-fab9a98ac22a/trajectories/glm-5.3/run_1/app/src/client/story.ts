// The story page: the gate, the scroll-tied chapters and the planner.
import { qs, qsa, el, announce, formatNumber, prefersReducedMotion, fetchJson, postJson, pad } from './dom.js';
import { startScrollEngine, onScroll, windowProgress, throughScreen, pageFraction } from './scroll.js';
import { SceneCanvas } from './scenes.js';
import { RITUAL_CATALOGUE, countCharacters, MAX_NOTE, normaliseEmail, validBedtime, validNote, startsAtLocal, totalMinutes, type RitualInput } from '../shared/plan.js';
import { setSound, loadAudio, soundChime, wireSoundSwitch, attachFilm, duckAmbient, rememberedSound, AUDIO_FILES } from './sound.js';

const reducedMotion = prefersReducedMotion();

// ---------- the gate ----------

const GATE_ASSETS: { label: string; load: () => Promise<void> }[] = [
  { label: 'font-fraunces', load: () => document.fonts.load('1em Fraunces').then(() => undefined) },
  { label: 'font-hanken', load: () => document.fonts.load('1em "Hanken Grotesk"').then(() => undefined) },
  { label: 'film-poster', load: () => loadImage('/media/film/poster.webp') },
  ...RITUAL_CATALOGUE.map((r) => ({ label: `clip-${r.id}`, load: () => loadImage(`/media/clips/${r.id}-still.webp`) })),
];

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

async function runGate(): Promise<void> {
  const gate = qs<HTMLElement>('#gate');
  const label = qs<HTMLElement>('#gate-label');
  const percent = qs<HTMLElement>('#gate-percent');
  const buttons = qs<HTMLElement>('#gate-buttons');
  const beginHour = qs<HTMLButtonElement>('#begin-hour');
  const beginSilence = qs<HTMLButtonElement>('#begin-silence');

  document.documentElement.classList.add('locked');

  let done = 0;
  const total = GATE_ASSETS.length + AUDIO_FILES.length;
  const tick = () => {
    done += 1;
    const pct = Math.min(100, Math.floor((done / total) * 100));
    label.setAttribute('aria-valuenow', String(pct));
    percent.textContent = `${pct}%`;
    if (done >= total) {
      label.setAttribute('aria-valuenow', '100');
      percent.textContent = '100%';
      buttons.hidden = false;
      const remembered = rememberedSound();
      const focusTarget = remembered === false ? beginSilence : beginHour;
      focusTarget.focus();
    }
  };

  const results = GATE_ASSETS.map((a) => a.load().then(tick, tick));
  const audioDone = loadAudio((failed) => {
    if (failed) {
      // a failed audio file leaves sound off
      localStorage.setItem('stillhour-sound', 'off');
    }
    tick();
  });
  await Promise.all([...results, audioDone]);

  const choose = async (sound: boolean) => {
    gate.classList.add('gone');
    document.documentElement.classList.remove('locked');
    qs<HTMLElement>('#topbar').hidden = false;
    await setSound(sound);
    if (sound) qs<HTMLElement>('#sound-switch').setAttribute('aria-checked', 'true');
    else qs<HTMLElement>('#sound-switch').setAttribute('aria-checked', 'false');
    revealHeroTitle();
    void refreshLiveCount();
    qs<HTMLElement>('#hero-title').focus();
    setTimeout(() => gate.remove(), 900);
  };
  beginHour.addEventListener('click', () => void choose(true));
  beginSilence.addEventListener('click', () => void choose(false));

  // While the gate is up nothing scrolls or sounds.
  const block = (e: Event) => {
    e.preventDefault();
  };
  window.addEventListener('wheel', block, { passive: false });
  window.addEventListener('touchmove', block, { passive: false });
  const blockKeys = (e: KeyboardEvent) => {
    const keys = ['PageDown', 'PageUp', 'Home', 'End', ' ', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
    if (keys.includes(e.key) && !isButton(e.target)) e.preventDefault();
  };
  window.addEventListener('keydown', blockKeys);
  const unblock = () => {
    window.removeEventListener('wheel', block);
    window.removeEventListener('touchmove', block);
    window.removeEventListener('keydown', blockKeys);
  };
  beginHour.addEventListener('click', unblock, { once: true });
  beginSilence.addEventListener('click', unblock, { once: true });
}

function isButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.closest('button') !== null);
}

// ---------- hero title ----------

function splitIntoLetters(node: HTMLElement): void {
  const text = node.dataset['text'] ?? node.textContent ?? '';
  node.textContent = '';
  for (const ch of text) {
    const span = el('span', { class: 'letter' });
    span.textContent = ch === ' ' ? '\u00a0' : ch;
    node.append(span);
  }
  node.setAttribute('aria-label', text);
}

function revealHeroTitle(): void {
  const title = qs<HTMLElement>('#hero-title');
  if (reducedMotion) {
    title.classList.add('revealed');
    return;
  }
  splitIntoLetters(title);
  const letters = qsa<HTMLElement>('.letter', title);
  letters.forEach((letter, i) => {
    letter.style.animationDelay = `${(i * 40) / letters.length}s`;
  });
  requestAnimationFrame(() => title.classList.add('revealed'));
}

// ---------- live count ----------

let liveCountTimer: number | null = null;

async function refreshLiveCount(): Promise<void> {
  const line = qs<HTMLElement>('#live-count');
  const res = await fetchJson<{ keeping: number }>('/api/tonight').catch(() => null);
  if (!res || res.status !== 200 || res.body === null) {
    line.textContent = 'Tonight, people everywhere are keeping a Stillhour.';
    return;
  }
  const n = res.body.keeping;
  line.textContent = n === 1
    ? '1 person is keeping a Stillhour tonight'
    : `${formatNumber(n)} people are keeping a Stillhour tonight`;
}

function startLiveCount(): void {
  const band = qs<HTMLElement>('#numbers');
  const update = () => {
    if (liveCountTimer !== null) return;
    const visible = () => {
      const rect = band.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };
    if (visible()) {
      void refreshLiveCount();
      liveCountTimer = window.setInterval(() => {
        if (visible()) void refreshLiveCount();
      }, 60_000);
    }
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ---------- numbers band roll-up ----------

function rollNumbers(): void {
  const band = qs<HTMLElement>('#numbers');
  const numerals = qsa<HTMLElement>('.numeral', band);
  const targets = numerals.map((n) => Number(n.dataset['final'] ?? '0'));
  if (reducedMotion) {
    numerals.forEach((node, i) => (node.textContent = pad2(targets[i]!, 2)));
    return;
  }
  let rolled = false;
  const roll = () => {
    const rect = band.getBoundingClientRect();
    if (!rolled && rect.top < window.innerHeight * 0.75) {
      rolled = true;
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / 900);
        const eased = 1 - Math.pow(1 - t, 2);
        numerals.forEach((node, i) => {
          node.textContent = pad2(Math.round(targets[i]! * eased), 2);
        });
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      window.removeEventListener('scroll', roll);
    }
  };
  window.addEventListener('scroll', roll, { passive: true });
  roll();
}

function pad2(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

// ---------- city counter and caption ----------

const CITY_START = 0.18;
const CITY_END = 0.82;

function wireCity(): void {
  const city = qs<HTMLElement>('#city-window');
  const counter = qs<HTMLElement>('#window-counter');
  const caption = qs<HTMLElement>('#city-caption');
  onScroll(() => {
    const p = windowProgress(city);
    const lit = litWindows(p);
    counter.textContent = `${formatNumber(lit)} window${lit === 1 ? '' : 's'} lit`;
    caption.textContent = p < 0.40 ? 'The offices close.' : p < 0.82 ? 'The kitchens go quiet.' : 'One window left.';
  });
}

function litWindows(p: number): number {
  if (p <= CITY_START) return 4096;
  if (p >= CITY_END) return 1;
  return Math.max(1, Math.round(4096 - 4095 * ((p - CITY_START) / (CITY_END - CITY_START))));
}

// ---------- story clock and brightness dial ----------

function wireClockAndDial(): void {
  const clock = qs<HTMLElement>('#story-clock');
  const dial = qs<HTMLElement>('#brightness-dial');
  const dialValue = qs<HTMLElement>('#dial-value');
  const dialGlow = qs<HTMLElement>('#dial-glow');
  onScroll((fraction) => {
    const minutes = Math.floor(fraction * 60);
    const total = 21 * 60 + minutes;
    clock.textContent = `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
    const q = throughScreen(dial);
    const value = Math.round(100 - 95 * q);
    dial.setAttribute('aria-valuenow', String(value));
    dialValue.textContent = `${value}%`;
    dialGlow.style.opacity = String(0.25 + 0.75 * (1 - q));
  });
}

// ---------- water, flowers, settle line ----------

function wireSettleLine(): void {
  const settle = qs<HTMLElement>('#settle');
  const line = qs<HTMLElement>('#settle-line');
  if (reducedMotion) {
    line.setAttribute('aria-label', line.dataset['text'] ?? line.textContent ?? '');
    line.textContent = line.dataset['text'] ?? line.textContent ?? '';
    return;
  }
  splitIntoLetters(line);
  const letters = qsa<HTMLElement>('.letter', line);
  const offsets = letters.map((_, i) => ({
    up: 40 + ((i * 37) % 45),
    rot: ((i * 53) % 17) - 8,
  }));
  line.setAttribute('aria-label', line.dataset['text'] ?? '');
  onScroll(() => {
    const p = Math.min(1, windowProgress(settle) / 0.6);
    letters.forEach((letter, i) => {
      const up = offsets[i]!;
      const off = up as { up: number; rot: number };
      letter.style.transform = `translateY(${(1 - p) * off.up}px) rotate(${(1 - p) * off.rot}deg)`;
      letter.style.opacity = String(0.2 + 0.8 * p);
    });
  });
}

// ---------- breathing guide ----------

function wireBreathing(): void {
  const button = qs<HTMLButtonElement>('#breathe-button');
  const status = qs<HTMLElement>('#breathing-guide');
  const circle = qs<HTMLElement>('#breath-circle');
  const roundCounter = qs<HTMLElement>('#round-counter');
  const PHASES = [
    { name: 'Breathe in', seconds: 4, scale: 1.9 },
    { name: 'Hold', seconds: 7, scale: 1.9 },
    { name: 'Breathe out', seconds: 8, scale: 1 },
  ] as const;
  let running = false;
  let timers: number[] = [];

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };

  const setPhaseVisual = (name: string, seconds: number, scale: number, remaining: number) => {
    if (reducedMotion) {
      circle.style.transform = 'none';
      status.textContent = `${name} ${remaining}`;
      const t = window.setTimeout(() => {
        if (running) setPhaseVisual(name, seconds, scale, remaining - 1);
      }, 1000);
      timers.push(t);
      return;
    }
    circle.style.transitionDuration = `${seconds}s`;
    circle.style.transform = `scale(${scale})`;
    status.textContent = name;
    void seconds;
  };

  const runRound = (round: number) => {
    roundCounter.textContent = `Round ${round} of 3`;
    let phaseIndex = 0;
    const nextPhase = () => {
      if (!running) return;
      if (phaseIndex >= PHASES.length) {
        if (round >= 3) {
          running = false;
          button.textContent = 'Breathe with me';
          roundCounter.textContent = 'Round 3 of 3';
          announce(status, 'Three rounds done. Notice how you feel.');
          return;
        }
        runRound(round + 1);
        return;
      }
      const phase = PHASES[phaseIndex]!;
      phaseIndex += 1;
      soundChime('breath');
      setPhaseVisual(phase.name, phase.seconds, phase.scale, phase.seconds);
      const t = window.setTimeout(nextPhase, phase.seconds * 1000);
      timers.push(t);
    };
    nextPhase();
  };

  button.addEventListener('click', () => {
    if (running) {
      running = false;
      clearTimers();
      button.textContent = 'Breathe with me';
      circle.style.transform = 'scale(1)';
      announce(status, 'Breathing stopped.');
      return;
    }
    running = true;
    button.textContent = 'Stop';
    runRound(1);
  });
}

// ---------- rituals: the chosen hour ----------

class ChosenRituals {
  private entries: RitualInput[] = [];

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }

  add(id: string, minutes: number): void {
    if (!this.has(id)) this.entries.push({ id, minutes });
  }

  remove(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  setMinutes(id: string, minutes: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.minutes = minutes;
  }

  clear(): void {
    this.entries = [];
  }

  list(): readonly RitualInput[] {
    return this.entries;
  }

  total(): number {
    return totalMinutes(this.entries);
  }
}

const chosen = new ChosenRituals();

function wireRituals(): void {
  const status = qs<HTMLElement>('#ritual-updates');
  const toggles = qsa<HTMLButtonElement>('.toggle');
  const checks = qsa<HTMLInputElement>('[data-ritual-check]');
  const minutesInputs = qsa<HTMLInputElement>('[data-ritual-minutes]');
  const plannerCheckboxes = new Map(checks.map((c) => [c.dataset['ritualCheck']!, c]));
  const plannerMinutes = new Map(minutesInputs.map((m) => [m.dataset['ritualMinutes']!, m]));
  const defaults = new Map(RITUAL_CATALOGUE.map((r) => [r.id, r.minutes]));

  const syncAddress = () => {
    if (chosen.list().length === 0) {
      const url = new URL(window.location.href);
      url.searchParams.delete('rituals');
      window.history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ''));
      return;
    }
    const param = chosen.list().map((r) => `${r.id}:${r.minutes}`).join(',');
    window.history.replaceState(null, '', `/?rituals=${param}`);
  };

  const syncPlanner = () => {
    for (const [id, checkbox] of plannerCheckboxes) {
      const on = chosen.has(id);
      checkbox.checked = on;
      const minutes = plannerMinutes.get(id)!;
      minutes.disabled = !on;
      if (on) minutes.value = String(chosen.list().find((r) => r.id === id)!.minutes);
    }
  };

  const syncCards = () => {
    for (const toggle of toggles) {
      const id = toggle.dataset['add']!;
      const on = chosen.has(id);
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? `Remove ${ritualTitle(id)} from my hour` : `Add ${ritualTitle(id)} to my hour`;
      toggle.classList.toggle('pressed', on);
    }
  };

  const ritualTitle = (id: string): string => RITUAL_CATALOGUE.find((r) => r.id === id)?.title ?? id;

  const change = (kind: 'add' | 'remove' | 'none', id: string) => {
    syncCards();
    syncPlanner();
    syncAddress();
    updateSummary();
    const title = ritualTitle(id);
    if (kind === 'add') {
      soundChime('add');
      announce(status, `${title} added. ${chosen.total()} of 60 minutes planned.`);
    } else if (kind === 'remove') {
      announce(status, `${title} removed. ${chosen.total()} of 60 minutes planned.`);
    } else {
      announce(status, `There is no room for ${title}. Your hour already has ${chosen.total()} of 60 minutes.`);
    }
  };

  for (const toggle of toggles) {
    const id = toggle.dataset['add']!;
    toggle.addEventListener('click', () => {
      if (chosen.has(id)) {
        chosen.remove(id);
        change('remove', id);
        return;
      }
      const minutes = defaults.get(id) ?? 5;
      if (chosen.total() + minutes > 60) {
        change('none', id);
        return;
      }
      chosen.add(id, minutes);
      change('add', id);
    });
    toggle.addEventListener('focus', () => {
      scrollCardIntoView(toggle);
    });
  }

  for (const [id, checkbox] of plannerCheckboxes) {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        const minutes = plannerMinutes.get(id)!;
        const value = Number(minutes.value) || defaults.get(id) || 5;
        if (chosen.total() + value > 60) {
          checkbox.checked = false;
          change('none', id);
          return;
        }
        chosen.add(id, value);
        change('add', id);
      } else {
        chosen.remove(id);
        change('remove', id);
      }
    });
  }

  for (const [id, minutes] of plannerMinutes) {
    minutes.addEventListener('change', () => {
      if (!chosen.has(id)) return;
      const value = Number(minutes.value);
      if (!Number.isFinite(value) || value < 5 || value > 30 || value % 5 !== 0) {
        minutes.value = String(chosen.list().find((r) => r.id === id)!.minutes);
        return;
      }
      const others = chosen.total() - chosen.list().find((r) => r.id === id)!.minutes;
      if (others + value > 60) {
        minutes.value = String(chosen.list().find((r) => r.id === id)!.minutes);
        announce(status, `There is no room for ${ritualTitle(id)}. Your hour already has ${chosen.total()} of 60 minutes.`);
        return;
      }
      chosen.setMinutes(id, value);
      syncAddress();
      updateSummary();
      announce(status, `${ritualTitle(id)} changed to ${value} minutes. ${chosen.total()} of 60 minutes planned.`);
    });
  }

  // clips play only while at least half the card is on screen
  if (!reducedMotion) {
    const clips = qsa<HTMLVideoElement>('.card-clip');
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.intersectionRatio >= 0.5) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      }
    }, { threshold: [0, 0.5, 1] });
    for (const clip of clips) observer.observe(clip);
  }

  syncCards();
  syncPlanner();
  restoreFromAddress();
  syncCards();
  syncPlanner();
  updateSummary();
}

// How far the ritual row is currently slid sideways; the scroll engine and
// keyboard focus both move it.
let cardTranslate = 0;

function cardShift(delta: number): void {
  const cards = document.getElementById('cards');
  if (!cards) return;
  cardTranslate = Math.min(0, cardTranslate + delta);
  cards.style.transform = `translateX(${cardTranslate}px)`;
}

function scrollCardIntoView(toggle: HTMLButtonElement): void {
  const card = toggle.closest('.card');
  if (!card) return;
  if (!document.documentElement.classList.contains('pin-ready')) return;
  const rect = card.getBoundingClientRect();
  if (rect.left < 16) {
    cardShift(-rect.left + 16);
  } else if (rect.right > window.innerWidth - 16) {
    cardShift(window.innerWidth - 16 - rect.right);
  }
}

function restoreFromAddress(): void {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('rituals') ?? '';
  chosen.clear();
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const match = /^([a-z0-9-]+):(\d+)$/.exec(part);
    if (!match) continue;
    const id = match[1]!;
    const minutes = Number(match[2]);
    if (!RITUAL_CATALOGUE.some((r) => r.id === id)) continue;
    if (seen.has(id)) continue;
    if (minutes < 5 || minutes > 30 || minutes % 5 !== 0) continue;
    if (chosen.total() + minutes > 60) continue;
    seen.add(id);
    chosen.add(id, minutes);
  }
  const param = chosen.list().length === 0
    ? ''
    : `?rituals=${chosen.list().map((r) => `${r.id}:${r.minutes}`).join(',')}`;
  window.history.replaceState(null, '', `/${param}`);
}

// ---------- sideways ritual chapter ----------

function wireSidewaysChapter(): void {
  const chapter = qs<HTMLElement>('#chapter-four');
  const pin = qs<HTMLElement>('.pin');
  const cards = qs<HTMLElement>('#cards');
  const canPin = () => window.innerWidth >= 1024 && !prefersReducedMotion();
  const apply = () => {
    document.documentElement.classList.toggle('pin-ready', canPin());
    if (!canPin()) {
      cards.style.transform = '';
      cardTranslate = 0;
      return;
    }
    const p = windowProgress(chapter);
    const distance = cards.scrollWidth - window.innerWidth;
    const target = -Math.max(0, Math.min(1, p * 1.1)) * Math.max(0, distance);
    // the scroll drives the row; keyboard focus may have slid it further along
    cardTranslate = Math.min(cardTranslate, target);
    cards.style.transform = `translateX(${Math.min(cardTranslate, target)}px)`;
  };
  onScroll(apply);
  window.addEventListener('resize', apply);
  apply();
  void pin;
}

// ---------- planner ----------

function bedtimeOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      out.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return out;
}

function zoneOptions(): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  const list = [...zones.filter((z) => z !== 'UTC'), 'UTC'];
  return list;
}

function wirePlanner(): void {
  const form = qs<HTMLFormElement>('#planner');
  const email = qs<HTMLInputElement>('#email');
  const bedtime = qs<HTMLSelectElement>('#bedtime');
  const zone = qs<HTMLSelectElement>('#time-zone');
  const note = qs<HTMLTextAreaElement>('#note');
  const charCount = qs<HTMLElement>('#char-count');
  const status = qs<HTMLElement>('#planner-status');
  const alertBox = qs<HTMLElement>('#planner-alert');
  const summaryLine = qs<HTMLElement>('#summary-line');
  const summaryTotal = qs<HTMLElement>('#summary-total');
  const saveButton = qs<HTMLButtonElement>('#save-hour');

  for (const z of zoneOptions()) {
    const option = el('option', { value: z }, z.replace(/_/g, ' '));
    zone.append(option);
  }
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  zone.value = zoneOptions().includes(local) ? local : 'UTC';

  const updateSummaryFn = () => {
    const start = startsAtLocal(bedtime.value);
    summaryLine.innerHTML = '';
    summaryLine.append(`Your hour starts at ${start} and ends at ${bedtime.value}, `);
    const zoneSpan = el('span');
    zoneSpan.textContent = zone.value;
    summaryLine.append(zoneSpan, ' time.');
    summaryTotal.textContent = `${chosen.total()} of 60 minutes planned.`;
  };
  updateSummaryRef = updateSummaryFn;

  const updateCounter = () => {
    charCount.textContent = `${countCharacters(note.value)} of 280 characters`;
  };

  email.addEventListener('input', updateSummaryFn);
  bedtime.addEventListener('change', updateSummaryFn);
  zone.addEventListener('change', updateSummaryFn);
  note.addEventListener('input', updateCounter);

  const validate = (): Map<string, string> => {
    const errors = new Map<string, string>();
    if (normaliseEmail(email.value) === null) errors.set('email', 'Enter an email address, like name@example.com.');
    if (!validBedtime(bedtime.value)) errors.set('bedtime', 'Choose a bedtime on a five-minute step, like 22:30.');
    if (zone.value === '' || !zoneOptions().includes(zone.value)) errors.set('time_zone', 'Choose a time zone from the list.');
    if (chosen.list().length < 1) {
      errors.set('rituals', 'Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.');
    }
    if (!validNote(note.value)) errors.set('note', 'Keep your note to 280 characters.');
    return errors;
  };

  const names: Record<string, string> = {
    email: 'Email',
    bedtime: 'Bedtime',
    time_zone: 'Time zone',
    rituals: 'Rituals',
    note: 'A note for tonight',
  };

  const messageEl = (field: string): HTMLElement | null => {
    const id = field === 'time_zone' ? 'time-zone' : field;
    return document.getElementById(`${id}-error`);
  };

  const focusTarget = (field: string): HTMLElement | null => {
    if (field === 'rituals') return qs<HTMLInputElement>('[data-ritual-check="dim-lamps"]');
    if (field === 'time_zone') return zone;
    const input = document.getElementById(field);
    return input instanceof HTMLElement ? input : null;
  };

  const showErrors = (errors: Map<string, string>) => {
    alertBox.innerHTML = '';
    const heading = el('h4', {}, 'Check your hour');
    const list = el('ul');
    for (const [field, message] of errors) {
      const link = el('a', { href: '#' }, names[field] ?? field);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        focusTarget(field)?.focus();
      });
      list.append(el('li', {}, link, ` — ${message}`));
    }
    alertBox.append(heading, list);
    alertBox.hidden = false;
    for (const [field, message] of errors) {
      const input = focusTarget(field);
      input?.setAttribute('aria-invalid', 'true');
      const el2 = messageEl(field);
      if (el2) {
        el2.textContent = message;
        el2.hidden = false;
      }
    }
    alertBox.setAttribute('tabindex', '-1');
    alertBox.focus();
  };

  const clearErrors = () => {
    alertBox.hidden = true;
    alertBox.innerHTML = '';
    for (const id of ['email', 'bedtime', 'time-zone', 'rituals', 'note']) {
      const message = document.getElementById(`${id}-error`);
      if (message) message.hidden = true;
    }
    for (const input of [email, bedtime, zone, note] as HTMLElement[]) {
      input.removeAttribute('aria-invalid');
    }
  };

  let idempotencyKey: { key: string; fingerprint: string } | null = null;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    const errors = validate();
    if (errors.size > 0) {
      announce(status, 'Some details need another look.');
      showErrors(errors);
      return;
    }
    const body = {
      email: normaliseEmail(email.value),
      bedtime: bedtime.value,
      time_zone: zone.value,
      rituals: chosen.list().map((r) => ({ id: r.id, minutes: r.minutes })),
      note: note.value,
    };
    const fingerprint = JSON.stringify(body);
    if (idempotencyKey === null || idempotencyKey.fingerprint !== fingerprint) {
      idempotencyKey = { key: randomKey(), fingerprint };
    }
    void save(body, idempotencyKey.key, 0);
  });

  const save = async (body: unknown, key: string, attempt: number) => {
    saveButton.disabled = true;
    announce(status, 'Saving your hour…');
    try {
      const res = await postJson<{ status?: string; error?: { fields?: Record<string, string> } }>('/api/plans', body, { 'Idempotency-Key': key });
      if (res.status === 202 && res.body) {
        soundChime('save');
        const queued = res.body.status === 'confirmation_queued';
        announce(status, queued
          ? 'Your hour is saved as a draft. The confirmation email is delayed and will arrive as soon as our mail service is back.'
          : 'Check your inbox. We sent a link to confirm your hour.');
        return;
      }
      if (res.status === 422 && res.body?.error?.fields) {
        const serverErrors = new Map(Object.entries(res.body.error.fields));
        announce(status, 'Some details need another look.');
        showErrors(serverErrors);
        return;
      }
      if (res.status === 429) {
        const minutes = Math.max(1, Math.ceil(Number(res.headers?.get('retry-after') ?? '60') / 60));
        announce(status, `You have saved three hours for this address in the last hour. Try again in ${minutes} minutes.`);
        return;
      }
      if (res.status === 503) {
        announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
        return;
      }
      announce(status, 'Your hour was not saved. Please try again.');
    } catch {
      if (attempt < 3) {
        setTimeout(() => void save(body, key, attempt + 1), 3000);
        return;
      }
      announce(status, 'Your hour was not saved. Please try again.');
    } finally {
      saveButton.disabled = false;
    }
  };

  updateSummaryFn();
  updateCounter();
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let updateSummaryRef: (() => void) | null = null;
function updateSummary(): void {
  updateSummaryRef?.();
}

// ---------- the film ----------

async function wireFilm(): Promise<void> {
  const openButton = qs<HTMLButtonElement>('#play-film');
  const dialog = qs<HTMLElement>('#film-dialog');
  const video = qs<HTMLVideoElement>('#film-video');
  const play = qs<HTMLButtonElement>('#film-play');
  const seek = qs<HTMLInputElement>('#film-seek');
  const time = qs<HTMLElement>('#film-time');
  const captionsButton = qs<HTMLButtonElement>('#film-captions-btn');
  const mute = qs<HTMLButtonElement>('#film-mute');
  const full = qs<HTMLButtonElement>('#film-full');
  const close = qs<HTMLButtonElement>('#film-close');
  const captionsEl = qs<HTMLElement>('#film-captions');
  const status = qs<HTMLElement>('#film-status');

  let captionsOn = false;
  let lastFocus: HTMLElement | null = null;

  let captionLines: { start: number; end: number; text: string }[] = [];
  try {
    const res = await fetch('/media/film/captions.json');
    captionLines = await res.json();
  } catch {
    captionLines = [];
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

  const setStatus = (text: string) => announce(status, text);

  const updateCaptions = () => {
    const t = video.currentTime;
    const line = captionLines.find((c) => t >= c.start && t < c.end);
    if (captionsOn && line) {
      captionsEl.textContent = line.text;
      captionsEl.hidden = false;
    } else {
      captionsEl.textContent = '';
      captionsEl.hidden = true;
    }
  };

  const updateTime = () => {
    seek.value = String(Math.min(40, video.currentTime));
    seek.setAttribute('aria-valuenow', String(Math.floor(video.currentTime)));
    seek.setAttribute('aria-valuetext', `${fmt(video.currentTime)} of 0:40`);
    time.textContent = `${fmt(video.currentTime)} of 0:40`;
    updateCaptions();
  };
  video.addEventListener('timeupdate', updateTime);

  const setPlaying = (on: boolean) => {
    if (on) {
      void video.play().then(() => {
        play.textContent = 'Pause';
        setStatus('Playing');
      }).catch(() => undefined);
    } else {
      video.pause();
      play.textContent = 'Play';
      setStatus('Paused');
    }
  };

  play.addEventListener('click', () => setPlaying(play.textContent === 'Play'));

  seek.addEventListener('input', () => {
    video.currentTime = Number(seek.value);
    updateTime();
  });

  const open = () => {
    lastFocus = openButton;
    dialog.hidden = false;
    attachFilm(video);
    duckAmbient(true);
    play.focus();
    if (!reducedMotion) setPlaying(true);
    else setStatus('Paused');
  };

  const closeDialog = () => {
    video.pause();
    duckAmbient(false);
    dialog.hidden = true;
    setStatus('Paused');
    openButton.focus();
  };

  openButton.addEventListener('click', open);
  close.addEventListener('click', closeDialog);

  captionsButton.addEventListener('click', () => {
    captionsOn = !captionsOn;
    captionsButton.setAttribute('aria-pressed', String(captionsOn));
    setStatus(captionsOn ? 'Captions on' : 'Captions off');
    updateCaptions();
  });
  mute.addEventListener('click', () => {
    video.muted = !video.muted;
    mute.setAttribute('aria-pressed', String(video.muted));
    setStatus(video.muted ? 'Muted' : 'Sound on');
  });
  full.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void dialog.requestFullscreen?.().catch(() => undefined);
    }
  });

  const cycleFocus = (e: KeyboardEvent) => {
    if (dialog.hidden) return;
    if (e.key === 'Tab') {
      const focusables = qsa<HTMLElement>('button, input, a[href]', dialog);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  window.addEventListener('keydown', cycleFocus);

  window.addEventListener('keydown', (e) => {
    if (dialog.hidden) return;
    if (e.key === 'Escape') {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
        return;
      }
      closeDialog();
      return;
    }
    const inDialog = dialog.contains(document.activeElement);
    if (!inDialog) return;
    if (e.key === ' ' || e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPlaying(play.textContent === 'Play');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 5);
      updateTime();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      video.currentTime = Math.min(40, video.currentTime + 5);
      updateTime();
    } else if (e.key.toLowerCase() === 'm') {
      video.muted = !video.muted;
      mute.setAttribute('aria-pressed', String(video.muted));
      setStatus(video.muted ? 'Muted' : 'Sound on');
    } else if (e.key.toLowerCase() === 'c') {
      captionsOn = !captionsOn;
      captionsButton.setAttribute('aria-pressed', String(captionsOn));
      setStatus(captionsOn ? 'Captions on' : 'Captions off');
      updateCaptions();
    } else if (e.key.toLowerCase() === 'f') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void dialog.requestFullscreen?.().catch(() => undefined);
    }
  });
  void lastFocus;
}

// ---------- moonflowers also close under the pointer ----------

function wireFlowerHover(canvas: SceneCanvas): void {
  const flowers = qs<HTMLElement>('#flowers-window');
  const toUv = (e: Event): [number, number] | null => {
    const pointer = e as PointerEvent;
    if (typeof pointer.clientX !== 'number' || typeof pointer.clientY !== 'number') return null;
    const rect = flowers.getBoundingClientRect();
    if (pointer.clientY < rect.top || pointer.clientY > rect.bottom) return null;
    return [pointer.clientX / window.innerWidth, 1 - pointer.clientY / window.innerHeight];
  };
  window.addEventListener('pointermove', (e) => {
    canvas.setHover(toUv(e));
  });
  window.addEventListener('pointerdown', (e) => {
    canvas.setHover(toUv(e));
  });
  window.addEventListener('pointerleave', () => {
    canvas.setHover(null);
  });
  window.addEventListener('scroll', () => {
    canvas.setHover(null);
  }, { passive: true });
}

// ---------- boot the page ----------

export function bootStory(): void {
  startScrollEngine();
  wireSoundSwitch();
  void runGate();

  const canvas = qs<HTMLCanvasElement>('#scene');
  const sceneCanvas = new SceneCanvas(canvas);
  sceneCanvas.setWindows([
    { el: qs('#hero-window'), scene: 0 },
    { el: qs('#city-window'), scene: 1 },
    { el: qs('#water-window'), scene: 2 },
    { el: qs('#flowers-window'), scene: 3 },
    { el: qs('#chapter-four'), scene: 4 },
    { el: qs('#footer-window'), scene: 5 },
  ]);

  const loop = (time: number) => {
    sceneCanvas.update(time);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  onScroll(() => {
    const flame = qs<HTMLElement>('#lantern-flame');
    const p = windowProgress(qs('#footer-window'));
    flame.style.opacity = String(Math.max(0, 1 - p));
    flame.style.transform = `scale(${Math.max(0.05, 1 - p)})`;
    void pageFraction;
  });

  wireFlowerHover(sceneCanvas);
  rollNumbers();
  wireCity();
  wireClockAndDial();
  wireSettleLine();
  wireBreathing();
  wireRituals();
  wireSidewaysChapter();
  wirePlanner();
  void wireFilm();
  startLiveCount();
}
