// The public site: hero field, Signal path, Plans with the rounding calculator, trial form.

import { el, getJson, navigate, registerRoute, prefersReducedMotion, statusRegion, setStatus } from './lib';
import { createSessionField, type FieldHandle, type FieldRow } from './field';
import { billableSeconds, formatBillableMinutes, parseCalculatorSeconds } from '../src-shared/billing';
import { CALCULATOR, TRIAL_STATUS } from '../src-shared/copy';

type DemoSpectrum = { frame_rate: number; rows: number[][] };

let heroField: FieldHandle | null = null;
let demoTimer: number | null = null;

registerRoute('/', async () => {
  document.title = 'Lowfield Console — live speech recognition metering';
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  root.append(await publicPage());
});

registerRoute('/console/?', async () => { await navigate('/'); });
registerRoute('/console/?$', async () => { await navigate('/'); });

async function publicPage(): Promise<HTMLElement> {
  const page = el('main', { class: 'public' });

  // ---------- Hero ----------
  const hero = el('section', { class: 'hero', 'aria-label': 'Hero' });
  const heroFieldWrap = el('div', { class: 'hero-field' });
  hero.append(heroFieldWrap);
  const overlay = el('div', { class: 'hero-copy' });
  const signIn = el('a', { href: '/sign-in' }, 'Sign in');
  signIn.addEventListener('click', (ev) => { ev.preventDefault(); void navigate('/sign-in'); });
  overlay.append(
    el('h1', {}, 'Every audio minute, metered the moment it happens.'),
    el('p', {}, 'Live speech recognition for contact-centre agent assist and clinical dictation, with quotas per project and invoices you can reconcile.'),
    signIn,
  );
  hero.append(overlay);
  page.append(hero);

  // ---------- Signal path ----------
  const signal = el('section', { class: 'signal-path', 'aria-label': 'Signal path' });
  signal.setAttribute('data-stage', '1');
  const heading = el('h2', {}, 'Signal path');
  signal.append(heading);
  const list = el('ol', { class: 'stage-list' });
  const stages: { title: string; copy: string }[] = [
    { title: 'Capture', copy: 'Audio arrives from the phone line, the bedside mic or a recording, and the original bytes are kept exactly as received.' },
    { title: 'Stream', copy: 'Sixteen-kilohertz PCM flows over one socket per session while the console shows the live spectrum field.' },
    { title: 'Recognise', copy: 'The recognizer steps one row per thirtieth of a second and turns the sidecar into words with confidences.' },
    { title: 'Review', copy: 'Low-confidence segments are flagged, corrected by keyboard and approved, without ever touching the machine original.' },
    { title: 'Meter', copy: 'Billable seconds are computed once under the plan in force at the start and recorded to billing.' },
  ];
  stages.forEach((s, i) => {
    const li = el('li', { class: 'stage' });
    li.append(el('h3', {}, s.title), el('p', {}, s.copy));
    if (i === 0) li.setAttribute('aria-current', 'step');
    list.append(li);
  });
  signal.append(list);
  page.append(signal);

  // ---------- Plans ----------
  const plans = el('section', { class: 'plans', 'aria-label': 'Plans' });
  plans.append(el('h2', {}, 'Plans'));
  const cards = el('div', { class: 'plan-cards' });
  const pilot = el('article', { class: 'plan-card' });
  pilot.append(
    el('h3', {}, 'Pilot'),
    el('p', { class: 'price num' }, '$0.06 per billable minute'),
    el('p', {}, 'Rounded up to whole minutes, per channel: a 61-second mono session bills 2.00 minutes.'),
  );
  const scale = el('article', { class: 'plan-card' });
  scale.append(
    el('h3', {}, 'Scale'),
    el('p', { class: 'price num' }, '$0.03 per billable minute'),
    el('p', {}, 'Billed per second with a 15-second minimum, per channel: a 5-second stereo session bills 0.50 minutes.'),
  );
  cards.append(pilot, scale);
  plans.append(cards);

  // ---------- Rounding calculator ----------
  const calc = el('div', { class: 'calculator' });
  const lengthInput = el('input', { type: 'text', id: 'calc-length', 'aria-label': 'Session length in seconds', autocomplete: 'off', value: '' });
  const lengthError = el('p', { class: 'field-error', id: 'calc-length-error', hidden: 'true' });
  const channelGroup = el('fieldset', { role: 'radiogroup', 'aria-label': 'Channels' });
  const monoLabel = el('label', { class: 'radio' });
  const mono = el('input', { type: 'radio', name: 'channels', value: '1', checked: 'true' });
  monoLabel.append(mono, document.createTextNode(' Mono'));
  const stereoLabel = el('label', { class: 'radio' });
  const stereo = el('input', { type: 'radio', name: 'channels', value: '2' });
  stereoLabel.append(stereo, document.createTextNode(' Stereo'));
  channelGroup.append(el('legend', {}, 'Channels'), monoLabel, stereoLabel);
  const billed = statusRegion('Billed minutes');
  billed.id = 'billed-status';
  const recompute = () => {
    const raw = lengthInput.value;
    const channels = mono.checked ? 1 : 2;
    lengthError.hidden = true;
    lengthInput.removeAttribute('aria-invalid');
    lengthInput.setAttribute('aria-describedby', 'billed-status');
    if (raw === '') { setStatus(billed, ''); return; }
    const seconds = parseCalculatorSeconds(raw);
    if (seconds === null) {
      setStatus(billed, '');
      lengthError.textContent = CALCULATOR.error;
      lengthError.hidden = false;
      lengthInput.setAttribute('aria-invalid', 'true');
      lengthInput.setAttribute('aria-describedby', 'calc-length-error');
      return;
    }
    setStatus(billed, `Pilot: ${formatBillableMinutes(billableSeconds('pilot', seconds * 1000, channels))} billed minutes. Scale: ${formatBillableMinutes(billableSeconds('scale', seconds * 1000, channels))} billed minutes.`);
  };
  lengthInput.addEventListener('input', recompute);
  mono.addEventListener('change', recompute);
  stereo.addEventListener('change', recompute);
  const lengthField = el('div', { class: 'field' });
  lengthField.append(el('label', { for: 'calc-length' }, 'Session length in seconds'), lengthInput, lengthError);
  calc.append(el('h3', {}, 'Rounding calculator'), lengthField, channelGroup, billed);
  plans.append(calc);
  page.append(plans);

  // ---------- Trial request ----------
  const trialSection = el('section', { class: 'trial', 'aria-label': 'Request a trial workspace' });
  trialSection.append(el('h2', {}, 'Request a trial workspace'));
  const form = el('form', { 'aria-label': 'Request a trial workspace' });
  form.setAttribute('aria-labelledby', 'trial-heading');
  const nameInput = el('input', { type: 'text', id: 'trial-name', autocomplete: 'name' });
  const nameError = el('p', { class: 'field-error', id: 'trial-name-error', hidden: 'true' });
  const emailInput = el('input', { type: 'text', id: 'trial-email', autocomplete: 'email' });
  const emailError = el('p', { class: 'field-error', id: 'trial-email-error', hidden: 'true' });
  const companyInput = el('input', { type: 'text', id: 'trial-company', autocomplete: 'organization' });
  const companyError = el('p', { class: 'field-error', id: 'trial-company-error', hidden: 'true' });
  const teamSelect = el('select', { id: 'trial-team' });
  teamSelect.append(el('option', { value: '' }, ''), el('option', { value: 'contact_centre' }, 'Contact centre'), el('option', { value: 'clinical_dictation' }, 'Clinical dictation'));
  const teamError = el('p', { class: 'field-error', id: 'trial-team-error', hidden: 'true' });
  const submitBtn = el('button', { type: 'submit', class: 'accent' }, 'Request trial');
  const trialStatus = statusRegion('Trial status');
  const row = el('div', { class: 'trial-grid' });
  const mk = (label: string, input: HTMLElement, error: HTMLElement): HTMLElement => {
    const field = el('div', { class: 'field' });
    field.append(el('label', { for: input.id }, label), input, error);
    return field;
  };
  row.append(
    mk('Name', nameInput, nameError),
    mk('Work email', emailInput, emailError),
    mk('Company', companyInput, companyError),
    mk('Team', teamSelect, teamError),
  );
  form.append(row, submitBtn, trialStatus);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    submitBtn.disabled = true;
    try {
      const res = await fetch('/api/trial-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: nameInput.value, email: emailInput.value, company: companyInput.value, team: teamSelect.value,
        }),
      });
      if (res.ok) {
        // The form's fields and the button are removed; the status region stays.
        row.remove();
        submitBtn.remove();
        setStatus(trialStatus, TRIAL_STATUS.success);
        return;
      }
      const data = (await res.json()) as { fields?: Record<string, string> };
      const fields = data.fields ?? {};
      const setErr = (err: HTMLElement, input: HTMLElement, msg: string | undefined) => {
        if (msg) { err.textContent = msg; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', err.id); }
        else { err.hidden = true; input.removeAttribute('aria-invalid'); input.setAttribute('aria-describedby', trialStatus.id); }
      };
      setErr(nameError, nameInput, fields['name']);
      setErr(emailError, emailInput, fields['email']);
      setErr(companyError, companyInput, fields['company']);
      setErr(teamError, teamSelect, fields['team']);
      setStatus(trialStatus, '');
    } catch {
      setStatus(trialStatus, 'Something went wrong. Try again.');
    } finally {
      submitBtn.disabled = false;
    }
  });
  trialSection.append(form);
  page.append(trialSection);

  // ---------- hero + scroll behaviours ----------
  void startHero(heroFieldWrap);
  wireSignalPath(signal, hero);

  return page;
}

async function startHero(wrap: HTMLElement): Promise<void> {
  heroField?.destroy();
  if (demoTimer !== null) { clearInterval(demoTimer); demoTimer = null; }
  let demo: DemoSpectrum | null = null;
  try {
    demo = await getJson<DemoSpectrum>('/api/public/demo-spectrum');
  } catch {
    demo = null;
  }
  heroField = createSessionField('Session field');
  heroField.setState({ display: 'live', endState: 'none' });
  wrap.append(heroField.canvas);
  if (!demo) return;
  const rows = demo.rows.map((r) => ({ frame: 0, peak_bin: 0, bins: r }) as FieldRow);
  const reduced = prefersReducedMotion();
  // The hero replays the 12-second demo at 30 rows per second and then starts over.
  let i = 0;
  if (reduced) {
    // The hero holds the demo's first frame.
    heroField.loadHistory(rows.slice(0, 1));
    return;
  }
  demoTimer = window.setInterval(() => {
    const row = rows[i % rows.length];
    heroField?.pushRow({ frame: i, peak_bin: row.peak_bin, bins: row.bins });
    i++;
  }, Math.round(1000 / (demo.frame_rate || 30)));
}

function wireSignalPath(signal: HTMLElement, hero: HTMLElement): void {
  const list = signal.querySelector('.stage-list');
  const items = list ? [...list.children] : [];
  if (prefersReducedMotion()) {
    // All five stages at once as static labelled panels.
    signal.setAttribute('data-stage', '5');
    items.forEach((li) => {
      li.setAttribute('aria-current', 'step');
      li.classList.add('active');
    });
    return;
  }
  const onScroll = () => {
    const rect = hero.getBoundingClientRect();
    // The hero and the Signal path stay pinned while the visitor scrolls the first 1,600 px.
    const scrolled = Math.max(0, -rect.top);
    const stage = Math.min(5, Math.max(1, Math.floor(scrolled / 320) + 1));
    signal.setAttribute('data-stage', String(stage));
    items.forEach((li, idx) => {
      const active = idx === stage - 1;
      li.classList.toggle('active', active);
      if (active) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
