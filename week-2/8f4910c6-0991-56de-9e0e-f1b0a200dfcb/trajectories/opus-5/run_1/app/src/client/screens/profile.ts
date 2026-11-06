import { call, upload } from '../lib/api.js';
import { append, clear, el, focus } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { liveRegion, pending, problemsSummary, radioGroup, textbox } from '../lib/forms.js';
import { pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { isSessionError, requireMember, sessionEndedNotice } from '../lib/session.js';
import { clearDraft, draft, officeOf, saveDraft } from '../lib/store.js';
import { copy, errorCopy, officeTime } from '../lib/copy.js';
import { cmToInches, formatHeightInchesOnly, inchesToCm } from '../../shared/format.js';
import type { OfficeRecord, PortfolioPhoto, TalentRecord } from '../../shared/types.js';

const PROFILE_DRAFT = 'profile-edit';

type ProfileDraft = {
  talentId: string;
  displayName: string;
  height: string;
  chest: string;
  waist: string;
  hips: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  officeNote: string;
  unit: string;
};

const FIELD_IDS: Record<string, string> = {
  displayName: 'profile-display-name',
  height: 'profile-height',
  chest: 'profile-chest',
  waist: 'profile-waist',
  hips: 'profile-hips',
  instagram: 'profile-instagram',
  tiktok: 'profile-tiktok',
  youtube: 'profile-youtube',
  officeNote: 'profile-office-note',
};

function measurementValue(cm: number | null, unit: string): string {
  if (cm === null) return '';
  if (unit === 'cm') return String(cm);
  return String(cmToInches(cm));
}

function heightValue(cm: number | null, unit: string): string {
  if (cm === null) return '';
  return unit === 'cm' ? String(cm) : formatHeightInchesOnly(cm);
}

function parseMeasurement(value: string, unit: string): { value: number; unit: 'cm' } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (unit === 'cm') {
    const number = Number(trimmed);
    return Number.isFinite(number) ? { value: Math.round(number), unit: 'cm' } : null;
  }
  const feetInches = /^(\d+)\s*(?:ft|')\s*(\d+(?:\.\d+)?)?/.exec(trimmed);
  if (feetInches) {
    return { value: inchesToCm(Number(feetInches[1]) * 12 + Number(feetInches[2] ?? '0')), unit: 'cm' };
  }
  const inches = Number(trimmed);
  return Number.isFinite(inches) ? { value: inchesToCm(inches), unit: 'cm' } : null;
}

export const profileEditorScreen: Screen = {
  pattern: '/workspace/talent/:id',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Profile announcements');
    const node = el('main', { class: 'page page-workspace page-profile-editor' }, []);
    const result = await call<TalentRecord>('GET', `/api/talent/${ctx.params.id}`);
    if (!result.body) {
      append(node, [
        pageHeading('Talent not found', { display: false }),
        isSessionError(result.error?.error) ? sessionEndedNotice((message) => live.announce(message)) : null,
        live.node,
      ]);
      return { node, chrome: 'workspace' };
    }
    let talent = result.body;
    const office: OfficeRecord = await officeOf(talent.office);
    const stored = draft<ProfileDraft | null>(PROFILE_DRAFT, null);
    const restored = stored !== null && stored.talentId === talent.id;
    let unit = restored ? stored.unit : 'cm';

    const build = (): void => {
      clear(node);
      const problems = problemsSummary();
      const displayName = textbox({
        id: FIELD_IDS.displayName,
        label: 'Display name',
        value: restored ? stored.displayName : talent.displayName,
      });
      const height = textbox({
        id: FIELD_IDS.height,
        label: 'Height',
        value: restored ? stored.height : heightValue(talent.measurements.heightCm, unit),
      });
      const chest = textbox({
        id: FIELD_IDS.chest,
        label: 'Chest',
        value: restored ? stored.chest : measurementValue(talent.measurements.chestCm, unit),
      });
      const waist = textbox({
        id: FIELD_IDS.waist,
        label: 'Waist',
        value: restored ? stored.waist : measurementValue(talent.measurements.waistCm, unit),
      });
      const hips = textbox({
        id: FIELD_IDS.hips,
        label: 'Hips',
        value: restored ? stored.hips : measurementValue(talent.measurements.hipsCm, unit),
      });
      const instagram = textbox({
        id: FIELD_IDS.instagram,
        label: 'Instagram followers',
        value: restored ? stored.instagram : String(talent.reach.instagram),
        inputmode: 'numeric',
      });
      const tiktok = textbox({
        id: FIELD_IDS.tiktok,
        label: 'TikTok followers',
        value: restored ? stored.tiktok : String(talent.reach.tiktok),
        inputmode: 'numeric',
      });
      const youtube = textbox({
        id: FIELD_IDS.youtube,
        label: 'YouTube subscribers',
        value: restored ? stored.youtube : String(talent.reach.youtube),
        inputmode: 'numeric',
      });
      const officeNote = textbox({
        id: FIELD_IDS.officeNote,
        label: 'Office note',
        value: restored ? stored.officeNote : talent.officeNote ?? '',
        multiline: true,
      });
      const unitGroup = radioGroup({
        name: 'measurement-unit',
        label: 'Measurement unit',
        value: unit,
        choices: [
          { value: 'cm', label: 'cm' },
          { value: 'ft_in', label: 'ft and in' },
        ],
        onChange: (value) => {
          unit = value;
        },
      });
      const save = el('button', { type: 'submit', class: 'button', text: 'Save profile' });

      const currentDraft = (): ProfileDraft => ({
        talentId: talent.id,
        displayName: displayName.input.value,
        height: height.input.value,
        chest: chest.input.value,
        waist: waist.input.value,
        hips: hips.input.value,
        instagram: instagram.input.value,
        tiktok: tiktok.input.value,
        youtube: youtube.input.value,
        officeNote: officeNote.input.value,
        unit,
      });

      const form = el('form', { class: 'form', 'aria-label': 'Profile', novalidate: true }, [
        problems.node,
        displayName.field,
        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Measurement unit' }),
          unitGroup.node,
        ]),
        height.field,
        chest.field,
        waist.field,
        hips.field,
        instagram.field,
        tiktok.field,
        youtube.field,
        officeNote.field,
        save,
      ]);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const spinner = pending(save, 'Saving profile…');
        spinner.start();
        const body = {
          version: talent.version,
          displayName: displayName.input.value,
          measurements: {
            ...(parseMeasurement(height.input.value, unit)
              ? { height: { ...parseMeasurement(height.input.value, unit), unit: unit === 'cm' ? 'cm' : 'ft_in' } }
              : {}),
            ...(parseMeasurement(chest.input.value, unit) ? { chest: parseMeasurement(chest.input.value, unit) } : {}),
            ...(parseMeasurement(waist.input.value, unit) ? { waist: parseMeasurement(waist.input.value, unit) } : {}),
            ...(parseMeasurement(hips.input.value, unit) ? { hips: parseMeasurement(hips.input.value, unit) } : {}),
          },
          reach: {
            instagram: Number.parseInt(instagram.input.value || '0', 10),
            tiktok: Number.parseInt(tiktok.input.value || '0', 10),
            youtube: Number.parseInt(youtube.input.value || '0', 10),
          },
          officeNote: officeNote.input.value,
        };
        const saved = await call<TalentRecord>('PATCH', `/api/talent/${talent.id}`, { body });
        spinner.stop();
        if (saved.body) {
          talent = saved.body;
          clearDraft(PROFILE_DRAFT);
          live.announce('Profile saved.');
          focus(save);
          return;
        }
        if (saved.status === 422 && saved.error?.errors) {
          problems.show(saved.error.errors, FIELD_IDS, node);
          live.announce(copy.validation(Object.keys(saved.error.errors).length));
          focus(node.querySelector<HTMLElement>(`#${FIELD_IDS[Object.keys(saved.error.errors)[0]]}`));
          return;
        }
        const code = saved.error?.error;
        if (isSessionError(code)) {
          saveDraft(PROFILE_DRAFT, currentDraft());
          if (code === 'access_removed') live.announce(copy.accessRemoved);
          else node.append(sessionEndedNotice((message) => live.announce(message)));
          return;
        }
        live.announce(errorCopy(saved.error, office));
      });

      for (const control of [displayName, height, chest, waist, hips, instagram, tiktok, youtube, officeNote]) {
        control.input.addEventListener('input', () => saveDraft(PROFILE_DRAFT, currentDraft()));
      }

      const portfolio = el('ul', { class: 'portfolio-editor', 'aria-label': 'Portfolio' });
      const uploadButton = el('button', { type: 'button', class: 'button', text: 'Upload photo' });
      const fileInput = el('input', {
        type: 'file',
        class: 'visually-hidden',
        accept: 'image/jpeg,image/png,image/webp',
        id: 'portfolio-file',
        tabindex: '-1',
        'aria-hidden': 'true',
      });
      uploadButton.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const spinner = pending(uploadButton, 'Uploading photo…');
        spinner.start();
        const saved = await upload<{ photoId: string }>('POST', `/api/talent/${talent.id}/photos`, file);
        spinner.stop();
        if (saved.body) {
          live.announce('Photo added to the portfolio.');
          await reload();
          return;
        }
        if (saved.status === 413) {
          live.announce('That photo is larger than 12,000,000 bytes.');
          return;
        }
        if (saved.status === 503) {
          live.announce(copy.storageUnavailable);
          return;
        }
        live.announce(saved.error?.errors?.file ?? errorCopy(saved.error, office));
      });

      const openLightbox = (index: number): void => {
        let current = index;
        const dialog = openDialog({ title: 'Portfolio', returnFocusTo: null });
        const image = el('img', { class: 'lightbox-photo', src: talent.portfolio[current].url, alt: `${talent.displayName}, photo ${current + 1} of ${talent.portfolio.length}` });
        const counter = el('p', { class: 'tabular', text: `${current + 1} of ${talent.portfolio.length}` });
        const previous = el('button', { type: 'button', class: 'button button-quiet', text: 'Previous photo' });
        const next = el('button', { type: 'button', class: 'button button-quiet', text: 'Next photo' });
        const close = el('button', { type: 'button', class: 'button button-quiet', text: 'Close' });
        const paint = (): void => {
          image.src = talent.portfolio[current].url;
          image.alt = `${talent.displayName}, photo ${current + 1} of ${talent.portfolio.length}`;
          counter.textContent = `${current + 1} of ${talent.portfolio.length}`;
        };
        const step = (delta: number): void => {
          current = (current + delta + talent.portfolio.length) % talent.portfolio.length;
          paint();
        };
        previous.addEventListener('click', () => step(-1));
        next.addEventListener('click', () => step(1));
        close.addEventListener('click', () => dialog.close());
        dialog.node.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            step(-1);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            step(1);
          }
        });
        let touchStart = 0;
        dialog.node.addEventListener('touchstart', (event) => {
          touchStart = event.changedTouches[0]?.clientX ?? 0;
        });
        dialog.node.addEventListener('touchend', (event) => {
          const end = event.changedTouches[0]?.clientX ?? 0;
          if (Math.abs(end - touchStart) > 40) step(end < touchStart ? 1 : -1);
        });
        dialog.body.append(image, counter, el('div', { class: 'dialog-actions' }, [previous, next, close]));
        dialog.closed.then(() => {
          const button = node.querySelector<HTMLElement>(`[data-open-photo="${talent.portfolio[current]?.photoId}"]`);
          focus(button);
        }).catch(() => undefined);
        focus(next);
      };

      const saveOrder = async (photoIds: string[], movedIndex: number, kind: 'earlier' | 'later'): Promise<void> => {
        const saved = await call<{ portfolioVersion: number; photoIds: string[] }>(
          'PUT',
          `/api/talent/${talent.id}/photos/order`,
          { body: { portfolioVersion: talent.portfolioVersion, photoIds } },
        );
        if (saved.body) {
          talent = { ...talent, portfolioVersion: saved.body.portfolioVersion, portfolio: reorder(talent.portfolio, photoIds) };
          drawPortfolio(movedIndex, kind);
          live.announce(`Moved photo to position ${movedIndex + 1} of ${photoIds.length}.`);
          return;
        }
        if (saved.error?.error === 'stale_version') {
          const message = copy.staleOrder(
            String(saved.error.savedBy ?? ''),
            officeTime(String(saved.error.savedAt ?? ''), office),
          );
          await reload();
          live.announce(message);
          return;
        }
        live.announce(errorCopy(saved.error, office));
      };

      const reorder = (photos: PortfolioPhoto[], order: string[]): PortfolioPhoto[] =>
        order
          .map((id) => photos.find((photo) => photo.photoId === id))
          .filter((photo): photo is PortfolioPhoto => photo !== undefined);

      const drawPortfolio = (focusIndex: number | null, focusKind: 'earlier' | 'later' | null): void => {
        clear(portfolio);
        talent.portfolio.forEach((photo, index) => {
          const earlier = el('button', { type: 'button', class: 'button button-quiet', text: 'Move earlier' });
          const later = el('button', { type: 'button', class: 'button button-quiet', text: 'Move later' });
          const open = el('button', {
            type: 'button',
            class: 'button button-quiet',
            text: 'Open',
            'data-open-photo': photo.photoId,
          });
          earlier.addEventListener('click', () => {
            if (index === 0) return;
            const ids = talent.portfolio.map((entry) => entry.photoId);
            [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
            void saveOrder(ids, index - 1, 'earlier');
          });
          later.addEventListener('click', () => {
            if (index === talent.portfolio.length - 1) return;
            const ids = talent.portfolio.map((entry) => entry.photoId);
            [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
            void saveOrder(ids, index + 1, 'later');
          });
          open.addEventListener('click', () => openLightbox(index));

          const item = el('li', {
            class: 'portfolio-item',
            'aria-label': `Photo ${index + 1} of ${talent.portfolio.length}`,
            draggable: 'true',
            'data-photo-id': photo.photoId,
          }, [
            el('img', { class: 'portfolio-photo', src: photo.url, alt: `${talent.displayName}, photo ${index + 1}` }),
            el('div', { class: 'actions' }, [earlier, later, open]),
          ]);
          item.addEventListener('dragstart', (event) => {
            event.dataTransfer?.setData('text/plain', photo.photoId);
          });
          item.addEventListener('dragover', (event) => event.preventDefault());
          item.addEventListener('drop', (event) => {
            event.preventDefault();
            const movedId = event.dataTransfer?.getData('text/plain');
            if (!movedId || movedId === photo.photoId) return;
            const ids = talent.portfolio.map((entry) => entry.photoId).filter((id) => id !== movedId);
            ids.splice(index, 0, movedId);
            void saveOrder(ids, index, 'later');
          });
          portfolio.append(item);
        });
        if (focusIndex !== null && focusKind) {
          const items = [...portfolio.querySelectorAll<HTMLElement>('.portfolio-item')];
          const target = items[focusIndex];
          const label = focusKind === 'earlier' ? 'Move earlier' : 'Move later';
          const button = [...(target?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
            (candidate) => candidate.textContent === label,
          );
          focus(button ?? null);
        }
      };

      const reload = async (): Promise<void> => {
        const fresh = await call<TalentRecord>('GET', `/api/talent/${talent.id}`);
        if (fresh.body) {
          talent = fresh.body;
          drawPortfolio(null, null);
        }
      };

      drawPortfolio(null, null);
      append(node, [
        pageHeading(talent.displayName, { display: false }),
        form,
        el('h2', { class: 'section-heading', text: 'Portfolio' }),
        portfolio,
        uploadButton,
        fileInput,
        live.node,
      ]);
    };

    build();
    return {
      node,
      chrome: 'workspace',
      onMounted: (): void => {
        if (restored) live.announce(copy.draftRestored);
      },
    };
  },
};
