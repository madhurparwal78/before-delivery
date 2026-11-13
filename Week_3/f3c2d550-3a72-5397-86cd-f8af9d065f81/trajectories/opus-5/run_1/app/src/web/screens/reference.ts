import { DECK_STATUS, SCREEN_STATES, unitChangedCopy } from '../../shared/copy.js';
import type { ReelSummaryJson, ReferenceJson, Unit } from '../../shared/types.js';
import { ApiCallError, api } from '../api.js';
import { openDialog } from '../dialog.js';
import { clear, element, setText } from '../dom.js';
import { openEyedropper } from '../eyedropper.js';
import { buildFactsForm, type FactsForm } from '../factsForm.js';
import { stopFor, type Screen, type ScreenContext } from './screen.js';

/** One reference's facts, its original photograph and everything you can do with it. */
export function renderReference({ shell, params, navigate }: ScreenContext): Screen {
  const id = params.id ?? '';
  let reference: ReferenceJson | null = null;
  let unit: Unit = shell.sizeUnit;
  let editing: FactsForm | null = null;
  let destroyed = false;

  const heading = element('h1', {}, ['']);
  const factsList = element('dl', { class: 'facts-list' });
  const factsSection = element('section', { class: 'facts-section' }, [factsList]);
  const unitGroup = element('div', {
    role: 'radiogroup',
    'aria-label': 'Size unit',
    class: 'radio-row',
  });
  const actions = element('div', { class: 'facts-actions' });
  const editHost = element('div', { class: 'facts-edit', hidden: true });
  shell.main.append(heading, factsSection, unitGroup, actions, editHost);
  shell.field.showMessage(SCREEN_STATES.loading);

  const editFacts = element('button', { type: 'button', class: 'action' }, ['Edit facts']);
  const saveFacts = element('button', { type: 'button', class: 'action primary', hidden: true }, [
    'Save facts',
  ]);
  const pickSwatch = element('button', { type: 'button', class: 'action quiet' }, ['Pick swatch']);
  const resetSwatch = element('button', { type: 'button', class: 'action quiet', hidden: true }, [
    'Reset swatch',
  ]);
  const viewOriginal = element('button', { type: 'button', class: 'action quiet' }, [
    'View original (O)',
  ]);
  const addToReel = element('button', { type: 'button', class: 'action quiet' }, ['Add to reel']);
  const moveToTrash = element('button', { type: 'button', class: 'action quiet' }, [
    'Move to trash',
  ]);
  actions.append(
    editFacts,
    saveFacts,
    pickSwatch,
    resetSwatch,
    viewOriginal,
    addToReel,
    moveToTrash,
  );

  for (const value of ['mm', 'in'] as const) {
    const radioId = `facts-unit-${value}`;
    const input = element('input', {
      id: radioId,
      type: 'radio',
      name: 'facts-unit',
      value,
      checked: value === unit,
    });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      unit = value;
      shell.setUnit(value);
      paintFacts();
      shell.setDeckStatus(unitChangedCopy(value));
      void api.saveUnit(value).catch(() => undefined);
    });
    unitGroup.append(input, element('label', { for: radioId }, [value]));
  }

  function row(term: string, value: string): void {
    factsList.append(element('dt', {}, [term]), element('dd', {}, [value]));
  }

  function paintFacts(): void {
    if (!reference) return;
    setText(heading, reference.title);
    document.title = `${reference.title} · Stowdeck`;
    clear(factsList);
    row('Maker', reference.maker ?? '—');
    row('Year', reference.year === null ? '—' : String(reference.year));
    row('Size', reference.size_text[unit]);
    row('Materials', reference.materials.join(', ') || '—');
    row('Finish', reference.finish ?? '—');
    row('Colour family', reference.colour_family);
    row('Swatch', reference.swatch);
    row('Source', reference.source_url ?? '—');
    row('Where found', reference.source_note ?? '—');
    row('Notes', reference.notes ?? '—');
    row('Captured', reference.captured_at);
    resetSwatch.hidden = reference.swatch_source !== 'eyedropper';
    for (const input of unitGroup.querySelectorAll('input')) {
      input.checked = input.value === unit;
    }
    shell.field.showSingle(stopFor(reference, unit));
  }

  async function load(): Promise<void> {
    const loaded = await api.reference(id).catch(() => null);
    if (destroyed) return;
    if (!loaded) {
      setText(heading, 'Not found');
      shell.field.showMessage(SCREEN_STATES.unknown);
      actions.hidden = true;
      unitGroup.hidden = true;
      return;
    }
    reference = loaded;
    paintFacts();
  }

  editFacts.addEventListener('click', () => {
    if (!reference) return;
    const form = buildFactsForm({ includePhoto: false, unit });
    form.fill(reference, unit);
    form.pickSwatch.hidden = true;
    editing = form;
    clear(editHost);
    editHost.append(form.root);
    editHost.hidden = false;
    factsSection.hidden = true;
    unitGroup.hidden = true;
    editFacts.hidden = true;
    saveFacts.hidden = false;
    form.root.querySelector('input')?.focus();
  });

  function leaveEditing(): void {
    editing = null;
    editHost.hidden = true;
    clear(editHost);
    factsSection.hidden = false;
    unitGroup.hidden = false;
    editFacts.hidden = false;
    saveFacts.hidden = true;
  }

  saveFacts.addEventListener('click', () => {
    if (!reference || !editing) return;
    const form = editing;
    shell.setDeckStatus(DECK_STATUS.savingFacts);
    void api
      .patchFacts(id, { ...form.patch(), version: reference.version })
      .then((updated) => {
        reference = updated;
        unit = form.unitOf();
        leaveEditing();
        paintFacts();
        shell.setDeckStatus(DECK_STATUS.factsSaved);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError && error.status === 422) {
          shell.setDeckStatus(DECK_STATUS.validationFailure);
          form.showErrors(error.fields);
          return;
        }
        if (error instanceof ApiCallError && error.code === 'reference_version_conflict') {
          leaveEditing();
          void load();
          shell.setDeckStatus(DECK_STATUS.referenceVersionConflict);
          editFacts.focus();
          return;
        }
        shell.setDeckStatus(DECK_STATUS.genericFailure);
      });
  });

  pickSwatch.addEventListener('click', () => {
    if (!reference) return;
    const whole = reference;
    shell.field.showSingle(
      { ...stopFor(whole, unit), photoUrl: whole.photo.original_url },
      { wholePhoto: true },
    );
    openEyedropper({
      photo: shell.field.photoElement,
      container: shell.field.tileElement,
      opener: pickSwatch,
      onPick: (x, y) => {
        shell.setDeckStatus(DECK_STATUS.measuringSwatch);
        void api
          .setSwatch(id, x, y)
          .then((updated) => {
            reference = updated;
            paintFacts();
            shell.setDeckStatus(DECK_STATUS.swatchSet);
          })
          .catch((error: unknown) => {
            paintFacts();
            shell.setDeckStatus(
              error instanceof ApiCallError && error.status === 503
                ? DECK_STATUS.storageFailure
                : DECK_STATUS.genericFailure,
            );
          });
      },
      onClose: () => paintFacts(),
    });
  });

  resetSwatch.addEventListener('click', () => {
    shell.setDeckStatus(DECK_STATUS.measuringSwatch);
    void api
      .resetSwatch(id)
      .then((updated) => {
        reference = updated;
        paintFacts();
        shell.setDeckStatus(DECK_STATUS.swatchReset);
      })
      .catch((error: unknown) => {
        shell.setDeckStatus(
          error instanceof ApiCallError && error.status === 503
            ? DECK_STATUS.storageFailure
            : DECK_STATUS.genericFailure,
        );
      });
  });

  function openOriginal(): void {
    if (!reference) return;
    const current = reference;
    openDialog({
      label: 'Original photograph',
      opener: viewOriginal,
      build: (close) => {
        const close1 = element('button', { type: 'button', class: 'action quiet' }, ['Close']);
        close1.addEventListener('click', close);
        return [
          element('img', {
            class: 'original-photo',
            src: current.photo.original_url,
            alt: current.title,
          }),
          close1,
        ];
      },
    });
  }

  viewOriginal.addEventListener('click', openOriginal);

  addToReel.addEventListener('click', () => {
    void api.reels().then(({ reels }) => openAddToReel(reels));
  });

  function openAddToReel(reels: ReelSummaryJson[]): void {
    let chosen = reels[0]?.id ?? '';
    openDialog({
      label: 'Add to reel',
      opener: addToReel,
      build: (close) => {
        const group = element('div', { role: 'radiogroup', 'aria-label': 'Reel' });
        for (const reel of reels) {
          const radioId = `add-reel-${reel.id}`;
          const input = element('input', {
            id: radioId,
            type: 'radio',
            name: 'add-reel',
            value: reel.id,
            checked: reel.id === chosen,
          });
          input.addEventListener('change', () => {
            if (input.checked) chosen = reel.id;
          });
          group.append(input, element('label', { for: radioId }, [reel.name]));
        }
        const add = element('button', { type: 'button', class: 'action primary' }, ['Add']);
        add.addEventListener('click', () => {
          const reel = reels.find((entry) => entry.id === chosen);
          if (!reel || !reference) return;
          const title = reference.title;
          close();
          void api
            .appendStop(reel.id, id)
            .then(() => shell.setDeckStatus(`Added to ${reel.name}.`))
            .catch((error: unknown) => {
              if (error instanceof ApiCallError && error.code === 'already_in_reel') {
                shell.setDeckStatus(`${title} is already in ${reel.name}.`);
                return;
              }
              if (error instanceof ApiCallError && error.code === 'reel_full') {
                shell.setDeckStatus(DECK_STATUS.reelFull);
                return;
              }
              shell.setDeckStatus(DECK_STATUS.genericFailure);
            });
        });
        return [group, add];
      },
    });
  }

  moveToTrash.addEventListener('click', () => {
    if (!reference) return;
    const title = reference.title;
    openDialog({
      label: 'Move to trash?',
      opener: moveToTrash,
      initialFocus: (dialog) => dialog.querySelector<HTMLElement>('[data-keep]'),
      build: (close) => {
        const confirm = element('button', { type: 'button', class: 'action primary' }, [
          'Move to trash',
        ]);
        const keep = element('button', { type: 'button', class: 'action quiet', 'data-keep': 'true' }, [
          'Keep it',
        ]);
        keep.addEventListener('click', close);
        confirm.addEventListener('click', () => {
          close();
          void api
            .trash(id)
            .then(() => {
              navigate('/library');
              shell.setDeckStatus(`Moved ${title} to the trash.`);
            })
            .catch(() => shell.setDeckStatus(DECK_STATUS.genericFailure));
        });
        return [
          element('p', {}, [
            `${title} will be purged 30 days after it is trashed unless you restore it.`,
          ]),
          confirm,
          keep,
        ];
      },
    });
  });

  /** `O` opens the original, whichever control has focus, except a text field. */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'o' && event.key !== 'O') return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    ) {
      return;
    }
    if (document.querySelector('.dialog')) return;
    event.preventDefault();
    openOriginal();
  };
  document.addEventListener('keydown', onKeyDown);

  const stopUnitListener = shell.onUnitChange((next) => {
    if (next === unit) return;
    unit = next;
    paintFacts();
  });

  void load();

  return {
    destroy() {
      destroyed = true;
      document.removeEventListener('keydown', onKeyDown);
      stopUnitListener();
      document.title = 'Stowdeck';
    },
  };
}
