import { call, upload } from '../lib/api.js';
import { clear, el, focus, setFieldError } from '../lib/dom.js';
import { liveRegion, pending, problemsSummary, radioGroup, textbox } from '../lib/forms.js';
import { navigate, pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { clearDraft, draft, saveDraft } from '../lib/store.js';
import { copy } from '../lib/copy.js';
import { inchesToCm } from '../../shared/format.js';
import { PHOTO_SLOTS, type ApplicationDraft, type PhotoSlot } from '../../shared/types.js';

type ApplyDraft = {
  id: string | null;
  token: string | null;
  office: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  heightValue: string;
  heightUnit: string;
  instagramFollowers: string;
  bio: string;
  guardianName: string;
  guardianEmail: string;
  minor: boolean;
};

const DRAFT_NAME = 'application';
const BIO_LIMIT = 600;

const SLOT_LABELS: Record<PhotoSlot, string> = {
  front: 'Front photo',
  profile: 'Profile photo',
  full_length: 'Full-length photo',
  smile: 'Smiling photo',
};

const FIELD_IDS: Record<string, string> = {
  firstName: 'apply-first-name',
  lastName: 'apply-last-name',
  email: 'apply-email',
  dateOfBirth: 'apply-dob',
  office: 'apply-office-toronto',
  height: 'apply-height',
  instagramFollowers: 'apply-instagram',
  bio: 'apply-bio',
  guardianName: 'apply-guardian-name',
  guardianEmail: 'apply-guardian-email',
  photo_front: 'apply-photo-front',
  photo_profile: 'apply-photo-profile',
  photo_full_length: 'apply-photo-full_length',
  photo_smile: 'apply-photo-smile',
  file: 'apply-photo-front',
};

function emptyDraft(): ApplyDraft {
  return {
    id: null,
    token: null,
    office: 'toronto',
    firstName: '',
    lastName: '',
    email: '',
    dateOfBirth: '',
    heightValue: '',
    heightUnit: 'cm',
    instagramFollowers: '',
    bio: '',
    guardianName: '',
    guardianEmail: '',
    minor: false,
  };
}

function stepTitles(minor: boolean): string[] {
  return minor
    ? ['About you', 'Your story', 'Photos', 'Guardian', 'Review']
    : ['About you', 'Your story', 'Photos', 'Review'];
}

export const applyScreen: Screen = {
  pattern: '/apply',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const stored = draft<Partial<ApplyDraft>>(DRAFT_NAME, {});
    const state: ApplyDraft = { ...emptyDraft(), ...stored };
    const uploaded = new Set<PhotoSlot>();
    const live = liveRegion('Application announcements');
    const problems = problemsSummary();
    const save = (): void => saveDraft(DRAFT_NAME, state);

    if (state.id && state.token) {
      const existing = await call<ApplicationDraft>('GET', `/api/applications/${state.id}`, {
        headers: { 'X-Application-Token': state.token },
      });
      if (existing.body) {
        state.minor = existing.body.minor;
        for (const slot of existing.body.photos) uploaded.add(slot);
      } else {
        state.id = null;
        state.token = null;
      }
    }

    const titles = stepTitles(state.minor);
    const step = Math.min(titles.length, Math.max(1, Number.parseInt(ctx.query.get('step') ?? '1', 10) || 1));
    const stepHeading = el('h2', { class: 'step-heading', text: titles[step - 1] });
    const body = el('div', { class: 'step-body' });

    const back = el('button', { type: 'button', class: 'button button-quiet', text: 'Back' });
    const next = el('button', { type: 'button', class: 'button', text: 'Next' });
    const send = el('button', { type: 'button', class: 'button', text: 'Send application' });
    back.hidden = step === 1;
    next.hidden = step === titles.length;
    send.hidden = step !== titles.length;

    const ensureDraft = async (): Promise<boolean> => {
      if (state.id && state.token) return true;
      const created = await call<{ id: string; token: string }>('POST', '/api/applications', {
        body: { office: state.office },
      });
      if (created.status === 429) {
        live.announce(copy.rateLimited(Number(created.error?.retryAfterSeconds ?? 1)));
        return false;
      }
      if (!created.body) {
        live.announce('That application could not be started.');
        return false;
      }
      state.id = created.body.id;
      state.token = created.body.token;
      save();
      return true;
    };

    const tokenHeaders = (): Record<string, string> => ({ 'X-Application-Token': state.token ?? '' });

    if (titles[step - 1] === 'About you') {
      const firstName = textbox({ id: FIELD_IDS.firstName, label: 'First name', value: state.firstName, autocomplete: 'given-name' });
      const lastName = textbox({ id: FIELD_IDS.lastName, label: 'Last name', value: state.lastName, autocomplete: 'family-name' });
      const email = textbox({ id: FIELD_IDS.email, label: 'Email', value: state.email, type: 'email', autocomplete: 'email' });
      const dob = textbox({ id: FIELD_IDS.dateOfBirth, label: 'Date of birth', value: state.dateOfBirth, type: 'date' });
      const office = radioGroup({
        name: 'apply-office',
        label: 'Office',
        value: state.office,
        choices: [
          { value: 'toronto', label: 'Toronto' },
          { value: 'vancouver', label: 'Vancouver' },
        ],
        onChange: (value) => {
          state.office = value;
          save();
        },
      });
      for (const [field, control] of [
        ['firstName', firstName],
        ['lastName', lastName],
        ['email', email],
        ['dateOfBirth', dob],
      ] as const) {
        control.input.addEventListener('input', () => {
          state[field] = control.input.value;
          save();
        });
      }
      body.append(
        firstName.field,
        lastName.field,
        email.field,
        dob.field,
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Office' }), office.node]),
      );
    }

    if (titles[step - 1] === 'Your story') {
      const height = textbox({ id: FIELD_IDS.height, label: 'Height', value: state.heightValue, inputmode: 'decimal' });
      const unit = radioGroup({
        name: 'apply-height-unit',
        label: 'Height unit',
        value: state.heightUnit,
        choices: [
          { value: 'cm', label: 'cm' },
          { value: 'ft_in', label: 'ft and in' },
        ],
        onChange: (value) => {
          state.heightUnit = value;
          save();
        },
      });
      const followers = textbox({
        id: FIELD_IDS.instagramFollowers,
        label: 'Instagram followers',
        value: state.instagramFollowers,
        inputmode: 'numeric',
      });
      const counter = el('p', { class: 'field-hint tabular', id: 'bio-counter' });
      const bio = textbox({
        id: FIELD_IDS.bio,
        label: 'Bio',
        value: state.bio,
        multiline: true,
        describedBy: 'bio-counter',
      });
      const graphemes = (value: string): number => {
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        let count = 0;
        for (const _ of segmenter.segment(value)) count += 1;
        return count;
      };
      const paintCounter = (): void => {
        counter.textContent = `${graphemes(state.bio)} of ${BIO_LIMIT}`;
      };
      paintCounter();
      height.input.addEventListener('input', () => {
        state.heightValue = height.input.value;
        save();
      });
      followers.input.addEventListener('input', () => {
        state.instagramFollowers = followers.input.value;
        save();
      });
      bio.input.addEventListener('input', () => {
        state.bio = bio.input.value;
        paintCounter();
        save();
      });
      body.append(
        height.field,
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Height unit' }), unit.node]),
        followers.field,
        bio.field,
        counter,
      );
    }

    if (titles[step - 1] === 'Photos') {
      for (const slot of PHOTO_SLOTS) {
        const id = FIELD_IDS[`photo_${slot}`];
        const input = el('input', { type: 'file', class: 'input', id, accept: 'image/jpeg,image/png,image/webp' });
        const status = el('p', { class: 'field-hint', text: uploaded.has(slot) ? 'Added' : 'Not added yet' });
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          if (!(await ensureDraft())) return;
          const label = SLOT_LABELS[slot];
          live.announce(`Uploading ${label.toLowerCase()}…`);
          const result = await upload<{ slot: PhotoSlot }>(
            'PUT',
            `/api/applications/${state.id}/photos/${slot}`,
            file,
            tokenHeaders(),
          );
          if (result.body) {
            uploaded.add(slot);
            status.textContent = 'Added';
            setFieldError(body, id, null);
            live.announce(`${label} added.`);
            return;
          }
          if (result.status === 413) {
            setFieldError(body, id, 'That photo is larger than 8,000,000 bytes.');
            live.announce(copy.validation(1));
            return;
          }
          if (result.status === 503) {
            live.announce(copy.storageUnavailable);
            return;
          }
          setFieldError(body, id, result.error?.errors?.file ?? 'That file is not a JPEG, PNG or WebP photo.');
          live.announce(copy.validation(1));
        });
        body.append(
          el('div', { class: 'field' }, [
            el('label', { class: 'field-label', for: id, text: SLOT_LABELS[slot] }),
            input,
            status,
            el('p', { class: 'field-error', id: `${id}-error`, hidden: true }),
          ]),
        );
      }
    }

    if (titles[step - 1] === 'Guardian') {
      const guardianName = textbox({ id: FIELD_IDS.guardianName, label: 'Guardian name', value: state.guardianName });
      const guardianEmail = textbox({
        id: FIELD_IDS.guardianEmail,
        label: 'Guardian email',
        value: state.guardianEmail,
        type: 'email',
      });
      guardianName.input.addEventListener('input', () => {
        state.guardianName = guardianName.input.value;
        save();
      });
      guardianEmail.input.addEventListener('input', () => {
        state.guardianEmail = guardianEmail.input.value;
        save();
      });
      body.append(
        el('p', { class: 'lede', text: 'You are under 18, so a guardian must approve your application.' }),
        guardianName.field,
        guardianEmail.field,
      );
    }

    if (titles[step - 1] === 'Review') {
      body.append(
        el('dl', { class: 'facts' }, [
          el('dt', { text: 'Name' }),
          el('dd', { text: `${state.firstName} ${state.lastName}`.trim() }),
          el('dt', { text: 'Email' }),
          el('dd', { text: state.email }),
          el('dt', { text: 'Date of birth' }),
          el('dd', { text: state.dateOfBirth }),
          el('dt', { text: 'Office' }),
          el('dd', { text: state.office === 'vancouver' ? 'Vancouver' : 'Toronto' }),
          el('dt', { text: 'Height' }),
          el('dd', { text: `${state.heightValue} ${state.heightUnit === 'cm' ? 'cm' : 'ft and in'}` }),
          el('dt', { text: 'Photos' }),
          el('dd', { text: `${uploaded.size} of 4 added` }),
        ]),
      );
    }

    const form = el('form', { class: 'form apply-form', novalidate: true }, [
      problems.node,
      stepHeading,
      body,
      el('div', { class: 'sticky-bar' }, [back, next, send]),
    ]);
    form.addEventListener('submit', (event) => event.preventDefault());

    const node = el('main', { class: 'page page-apply' }, [
      pageHeading('New face application'),
      form,
      live.node,
    ]);

    const heightPayload = (): { value: number; unit: 'cm' } | null => {
      const raw = state.heightValue.trim();
      if (!raw) return null;
      if (state.heightUnit === 'cm') {
        const value = Number(raw);
        return Number.isFinite(value) ? { value: Math.round(value), unit: 'cm' } : null;
      }
      const match = /^(\d+)\s*(?:ft|')\s*(\d+(?:\.\d+)?)?/.exec(raw);
      if (match) {
        const inches = Number(match[1]) * 12 + Number(match[2] ?? '0');
        return { value: inchesToCm(inches), unit: 'cm' };
      }
      const inches = Number(raw);
      return Number.isFinite(inches) ? { value: inchesToCm(inches), unit: 'cm' } : null;
    };

    const stepPayload = (): Record<string, unknown> => {
      const title = titles[step - 1];
      if (title === 'About you') {
        return {
          firstName: state.firstName,
          lastName: state.lastName,
          email: state.email,
          dateOfBirth: state.dateOfBirth,
          office: state.office,
        };
      }
      if (title === 'Your story') {
        const height = heightPayload();
        return {
          ...(height ? { height } : {}),
          ...(state.instagramFollowers.trim()
            ? { instagramFollowers: Number.parseInt(state.instagramFollowers, 10) }
            : {}),
          bio: state.bio,
        };
      }
      if (title === 'Guardian') {
        return { guardianName: state.guardianName, guardianEmail: state.guardianEmail };
      }
      return {};
    };

    const showErrors = (errors: Record<string, string>): void => {
      problems.show(errors, FIELD_IDS, node);
      live.announce(copy.validation(Object.keys(errors).length));
      const firstId = FIELD_IDS[Object.keys(errors)[0]];
      focus(node.querySelector<HTMLElement>(`#${firstId}`) ?? problems.node);
    };

    next.addEventListener('click', async () => {
      if (!(await ensureDraft())) return;
      const spinner = pending(next, 'Saving…');
      spinner.start();
      const result = await call<ApplicationDraft>('PATCH', `/api/applications/${state.id}`, {
        body: stepPayload(),
        headers: tokenHeaders(),
      });
      spinner.stop();
      if (result.status === 422 && result.error?.errors) {
        showErrors(result.error.errors);
        return;
      }
      if (!result.body) {
        live.announce('That step could not be saved.');
        return;
      }
      problems.hide(node, FIELD_IDS);
      state.minor = result.body.minor;
      save();
      live.announce('Step saved.');
      navigate(`/apply?step=${step + 1}`);
    });

    back.addEventListener('click', () => navigate(`/apply?step=${Math.max(1, step - 1)}`));

    send.addEventListener('click', async () => {
      if (!state.id || !state.token) return;
      const spinner = pending(send, 'Sending application…');
      spinner.start();
      const result = await call<{ status: string; minor: boolean }>(
        'POST',
        `/api/applications/${state.id}/submit`,
        { body: {}, headers: tokenHeaders() },
      );
      spinner.stop();
      if (result.status === 422 && result.error?.errors) {
        showErrors(result.error.errors);
        return;
      }
      if (result.status === 409) {
        live.announce('This application was already sent.');
        return;
      }
      if (!result.body) {
        live.announce('That application could not be sent.');
        return;
      }
      const message = result.body.minor
        ? 'Application sent. We have emailed your guardian for consent and will review it once they approve.'
        : 'Application sent. Our scouts will be in touch by email.';
      clearDraft(DRAFT_NAME);
      const heading = el('h1', { class: 'page-title display', text: 'Application sent' });
      clear(node);
      node.append(heading, el('p', { class: 'lede', text: message }), live.node);
      live.announce(message);
      document.title = `${heading.textContent ?? ''} — Vesper & Rowe Talent`;
      focus(heading);
    });

    const restored = Boolean(stored.firstName || stored.lastName || stored.bio || stored.email);

    return {
      node,
      chrome: 'public',
      onMounted: (): void => {
        focus(stepHeading);
        if (restored) live.announce(copy.draftRestored);
      },
    };
  },
};
