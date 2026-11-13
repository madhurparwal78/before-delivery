import { ApiFailure, api } from '../api.js';
import { el, trapFocus } from '../dom.js';
import { HeroPreview, type CameraFocus } from '../scene/preview.js';
import { DEFAULT_LOOK, type AppContext, type Screen } from './shared.js';
import { fmtCount, fmtFixed, type MessageKey } from '../../shared/i18n/index.js';
import { NAME_MAX, NAME_MIN, PROPORTION_STEP } from '../../shared/constants.js';
import { graphemeLength } from '../../shared/text.js';
import { degreesToStoredRadians, storedRadiansToDegrees } from '../../shared/pose.js';
import {
  PROPORTION_KEYS,
  type Accessories,
  type Character,
  type MaterialName,
  type Parts,
  type ProportionKey,
  type Proportions,
} from '../../shared/types.js';

interface HeroDraft {
  name: string;
  parts: Parts;
  proportions: Proportions;
  raiseDegrees: number;
  material: MaterialName;
  accessories: Accessories;
  model_id: string | null;
  weapon_id: string | null;
}

interface RadioOption {
  value: string;
  label: string;
}

const PROPORTION_LABELS: Record<ProportionKey, MessageKey> = {
  head_size: 'slider.headSize',
  neck_length: 'slider.neckLength',
  spine_length: 'slider.spineLength',
  upper_arm_length: 'slider.upperArmLength',
  forearm_length: 'slider.forearmLength',
  thigh_length: 'slider.thighLength',
  shin_length: 'slider.shinLength',
};

const HISTORY_LIMIT = 50;

function cloneDraft(draft: HeroDraft): HeroDraft {
  return JSON.parse(JSON.stringify(draft)) as HeroDraft;
}

function draftFrom(character: Character | null, fallbackName: string): HeroDraft {
  if (character === null) {
    return {
      name: fallbackName,
      parts: { ...DEFAULT_LOOK.parts },
      proportions: { ...DEFAULT_LOOK.proportions },
      raiseDegrees: 0,
      material: 'graphite',
      accessories: { ...DEFAULT_LOOK.accessories },
      model_id: null,
      weapon_id: null,
    };
  }
  return {
    name: character.name,
    parts: { ...character.parts },
    proportions: { ...character.proportions },
    raiseDegrees: storedRadiansToDegrees(character.pose.right_arm_raise),
    material: character.material,
    accessories: { ...character.accessories },
    model_id: character.model_id,
    weapon_id: character.weapon_id,
  };
}

export async function renderBuilder(
  ctx: AppContext,
  host: HTMLElement,
  characterId: string | null,
): Promise<Screen> {
  const { characters } = await api.get<{ characters: Character[] }>('/api/characters');
  const slots = new Map<number, { name: string; revision: number }>();
  for (const character of characters) {
    slots.set(character.slot, { name: character.name, revision: character.revision });
  }
  const opened = characterId === null ? null : characters.find((entry) => entry.id === characterId) ?? null;

  let draft = draftFrom(opened, ctx.account?.display_name ?? 'Hero');
  const history: HeroDraft[] = [cloneDraft(draft)];
  let historyIndex = 0;

  const preview = new HeroPreview({ label: ctx.t('app.heroPreview'), turntable: false });

  const applyLook = (): void => {
    preview.setHero({
      parts: draft.parts,
      proportions: draft.proportions,
      material: draft.material,
      accessories: draft.accessories,
      armRaiseRadians: degreesToStoredRadians(draft.raiseDegrees),
    });
  };
  applyLook();

  const partsRegion = el('div', {
    class: 'parts-rail',
    role: 'region',
    'aria-label': ctx.t('region.parts'),
  });
  const inspector = el('div', { class: 'paper-card inspector' });
  const layout = el('div', { class: 'builder-layout' }, [
    partsRegion,
    el('div', { class: 'scene-pane' }, [
      preview.element,
      preview.webglAvailable ? null : el('p', { class: 'notice', text: ctx.t('scene.noWebgl') }),
    ]),
    inspector,
  ]);
  host.append(layout);

  // --- history ---------------------------------------------------------------
  const undoButton = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.undo'),
  ]) as HTMLButtonElement;
  const redoButton = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.redo'),
  ]) as HTMLButtonElement;

  const refreshHistoryButtons = (): void => {
    undoButton.disabled = historyIndex === 0;
    redoButton.disabled = historyIndex === history.length - 1;
  };

  const commitStep = (): void => {
    history.splice(historyIndex + 1);
    history.push(cloneDraft(draft));
    if (history.length > HISTORY_LIMIT + 1) history.shift();
    historyIndex = history.length - 1;
    refreshHistoryButtons();
  };

  const syncControls: (() => void)[] = [];

  const restore = (index: number): void => {
    historyIndex = index;
    draft = cloneDraft(history[index]);
    applyLook();
    for (const sync of syncControls) sync();
    refreshHistoryButtons();
  };

  undoButton.addEventListener('click', () => {
    if (historyIndex > 0) restore(historyIndex - 1);
  });
  redoButton.addEventListener('click', () => {
    if (historyIndex < history.length - 1) restore(historyIndex + 1);
  });

  // --- parts pickers ---------------------------------------------------------
  function radioGroup(
    labelKey: MessageKey,
    options: RadioOption[],
    focus: CameraFocus,
    read: () => string,
    write: (value: string) => void,
  ): HTMLElement {
    const group = el('div', {
      class: 'radiogroup',
      role: 'radiogroup',
      'aria-label': ctx.t(labelKey),
    });
    const radios: HTMLElement[] = [];

    const sync = (): void => {
      const current = read();
      radios.forEach((radio) => {
        const selected = radio.dataset.value === current;
        radio.setAttribute('aria-checked', String(selected));
        radio.tabIndex = selected ? 0 : -1;
        radio.classList.toggle('selected', selected);
      });
      if (!radios.some((radio) => radio.getAttribute('aria-checked') === 'true') && radios[0]) {
        radios[0].tabIndex = 0;
      }
    };

    const choose = (index: number, moveFocus: boolean): void => {
      const radio = radios[index];
      if (radio === undefined) return;
      write(radio.dataset.value ?? '');
      applyLook();
      commitStep();
      sync();
      preview.setCameraFocus(focus);
      if (moveFocus) radio.focus();
    };

    options.forEach((option, index) => {
      const radio = el('button', {
        type: 'button',
        role: 'radio',
        class: 'swatch',
        'aria-checked': 'false',
        'data-value': option.value,
      }, [option.label]);
      radio.addEventListener('click', () => choose(index, true));
      radio.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          choose((index + 1) % options.length, true);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          choose((index - 1 + options.length) % options.length, true);
        } else if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          choose(index, true);
        }
      });
      radio.addEventListener('focus', () => preview.setCameraFocus(focus));
      radios.push(radio);
      group.append(radio);
    });

    syncControls.push(sync);
    sync();
    return group;
  }

  const partOptions = <T extends string>(values: readonly T[], prefix: string): RadioOption[] =>
    values.map((value) => ({ value, label: ctx.t(`${prefix}.${value}` as MessageKey) }));

  const sheetHandle = el('button', {
    type: 'button',
    class: 'sheet-handle',
    'aria-expanded': 'false',
  }, [ctx.t('btn.partsSheet')]) as HTMLButtonElement;

  const headGroup = el('div', { class: 'parts-group parts-group-head' }, [
    radioGroup(
      'group.head',
      partOptions(['round', 'square', 'triangle'] as const, 'part.head'),
      'head',
      () => draft.parts.head,
      (value) => {
        draft.parts.head = value as Parts['head'];
      },
    ),
  ]);

  const otherGroups = el('div', { class: 'parts-group' }, [
    radioGroup(
      'group.torso',
      partOptions(['stick', 'barrel', 'kite'] as const, 'part.torso'),
      'torso',
      () => draft.parts.torso,
      (value) => {
        draft.parts.torso = value as Parts['torso'];
      },
    ),
    radioGroup(
      'group.arms',
      partOptions(['thin', 'thick'] as const, 'part.arms'),
      'arms',
      () => draft.parts.arms,
      (value) => {
        draft.parts.arms = value as Parts['arms'];
      },
    ),
    radioGroup(
      'group.legs',
      partOptions(['thin', 'thick', 'spring'] as const, 'part.legs'),
      'legs',
      () => draft.parts.legs,
      (value) => {
        draft.parts.legs = value as Parts['legs'];
      },
    ),
    radioGroup(
      'group.material',
      partOptions(
        ['graphite', 'cobalt', 'marker', 'chalk', 'brick', 'moss'] as const,
        'material',
      ),
      'material',
      () => draft.material,
      (value) => {
        draft.material = value as MaterialName;
      },
    ),
    radioGroup(
      'group.headSocket',
      partOptions(['none', 'paper_crown', 'beanie'] as const, 'accessory'),
      'sockets',
      () => draft.accessories.head,
      (value) => {
        draft.accessories.head = value as Accessories['head'];
      },
    ),
    radioGroup(
      'group.backSocket',
      partOptions(['none', 'scarf', 'satchel'] as const, 'accessory'),
      'sockets',
      () => draft.accessories.back,
      (value) => {
        draft.accessories.back = value as Accessories['back'];
      },
    ),
    radioGroup(
      'group.leftHandSocket',
      partOptions(['none', 'lantern', 'shield'] as const, 'accessory'),
      'sockets',
      () => draft.accessories.left_hand,
      (value) => {
        draft.accessories.left_hand = value as Accessories['left_hand'];
      },
    ),
  ]);

  partsRegion.append(sheetHandle, headGroup, otherGroups);

  // --- bottom sheet ----------------------------------------------------------
  let sheetExpanded = false;
  const sheetQuery = window.matchMedia('(max-width: 1023px)');

  const applySheet = (): void => {
    const inSheet = sheetQuery.matches;
    layout.classList.toggle('sheet-mode', inSheet);
    sheetHandle.hidden = !inSheet;
    const collapsed = inSheet && !sheetExpanded;
    layout.classList.toggle('sheet-collapsed', collapsed);
    otherGroups.hidden = collapsed;
    otherGroups.inert = collapsed;
    inspector.hidden = collapsed;
    inspector.inert = collapsed;
    sheetHandle.setAttribute('aria-expanded', String(inSheet && sheetExpanded));
  };

  sheetHandle.addEventListener('click', () => {
    sheetExpanded = !sheetExpanded;
    applySheet();
  });
  let touchStartY = 0;
  sheetHandle.addEventListener('touchstart', (event) => {
    touchStartY = event.touches[0]?.clientY ?? 0;
  });
  sheetHandle.addEventListener('touchend', (event) => {
    const endY = event.changedTouches[0]?.clientY ?? touchStartY;
    if (Math.abs(endY - touchStartY) > 20) {
      sheetExpanded = endY < touchStartY;
      applySheet();
    }
  });
  sheetQuery.addEventListener('change', applySheet);
  applySheet();

  // --- hero name -------------------------------------------------------------
  const nameInput = el('input', {
    id: 'hero-name',
    type: 'text',
    'aria-describedby': 'hero-name-counter',
  }) as HTMLInputElement;
  nameInput.value = draft.name;
  const nameCounter = el('span', { class: 'counter', id: 'hero-name-counter' });
  const nameLimit = el('p', { class: 'field-error' });

  const refreshNameCounter = (): void => {
    const used = graphemeLength(nameInput.value.trim());
    nameCounter.textContent = `${fmtCount(ctx.locale, used)}/${fmtCount(ctx.locale, NAME_MAX)}`;
    const over = used > NAME_MAX || (used > 0 && used < NAME_MIN);
    nameCounter.classList.toggle('over-limit', used > NAME_MAX);
    nameLimit.textContent = over ? ctx.t('fb.heroNameLimit') : '';
  };
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value;
    refreshNameCounter();
  });
  refreshNameCounter();
  syncControls.push(() => {
    nameInput.value = draft.name;
    refreshNameCounter();
  });

  inspector.append(
    el('label', { class: 'field', for: 'hero-name' }, [
      el('span', { text: ctx.t('field.heroName') }),
      nameInput,
      nameCounter,
      nameLimit,
    ]),
  );

  // --- proportion sliders ----------------------------------------------------
  for (const key of PROPORTION_KEYS) {
    const slider = el('input', {
      type: 'range',
      min: '0.5',
      max: '1.5',
      step: String(PROPORTION_STEP),
      'aria-label': ctx.t(PROPORTION_LABELS[key]),
    }) as HTMLInputElement;
    const valueText = el('span', { class: 'slider-value' });

    const show = (): void => {
      slider.value = String(draft.proportions[key]);
      const text = fmtFixed(ctx.locale, draft.proportions[key], 2);
      slider.setAttribute('aria-valuetext', text);
      valueText.textContent = text;
    };

    const setValue = (value: number, step: boolean): void => {
      const clamped = Math.min(1.5, Math.max(0.5, Math.round(value / PROPORTION_STEP) * PROPORTION_STEP));
      draft.proportions[key] = Number(clamped.toFixed(2));
      applyLook();
      show();
      if (step) commitStep();
    };

    slider.addEventListener('keydown', (event) => {
      const current = draft.proportions[key];
      const moves: Record<string, number> = {
        ArrowUp: PROPORTION_STEP,
        ArrowRight: PROPORTION_STEP,
        ArrowDown: -PROPORTION_STEP,
        ArrowLeft: -PROPORTION_STEP,
        PageUp: PROPORTION_STEP * 4,
        PageDown: -PROPORTION_STEP * 4,
      };
      if (event.key in moves) {
        event.preventDefault();
        setValue(current + moves[event.key], true);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setValue(0.5, true);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setValue(1.5, true);
      }
    });
    slider.addEventListener('input', () => {
      draft.proportions[key] = Number(Number(slider.value).toFixed(2));
      applyLook();
      show();
    });
    slider.addEventListener('change', () => commitStep());

    show();
    syncControls.push(show);
    inspector.append(
      el('label', { class: 'field slider-field' }, [
        el('span', { text: ctx.t(PROPORTION_LABELS[key]) }),
        slider,
        valueText,
      ]),
    );
  }

  // --- right arm raise -------------------------------------------------------
  const raiseSlider = el('input', {
    type: 'range',
    min: '-180',
    max: '180',
    step: '1',
    'aria-label': ctx.t('slider.rightArmRaise'),
  }) as HTMLInputElement;
  const raiseValue = el('span', { class: 'slider-value' });

  const showRaise = (): void => {
    raiseSlider.value = String(draft.raiseDegrees);
    const text = `${fmtCount(ctx.locale, draft.raiseDegrees)}°`;
    raiseSlider.setAttribute('aria-valuetext', text);
    raiseValue.textContent = text;
  };

  const setRaise = (degrees: number, step: boolean): void => {
    draft.raiseDegrees = Math.min(180, Math.max(-180, Math.round(degrees)));
    preview.setArmRaiseRadians(degreesToStoredRadians(draft.raiseDegrees));
    showRaise();
    if (step) commitStep();
  };

  raiseSlider.addEventListener('keydown', (event) => {
    const moves: Record<string, number> = {
      ArrowUp: 15,
      ArrowRight: 15,
      ArrowDown: -15,
      ArrowLeft: -15,
      PageUp: 45,
      PageDown: -45,
    };
    if (event.key in moves) {
      event.preventDefault();
      setRaise(draft.raiseDegrees + moves[event.key], true);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setRaise(-180, true);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setRaise(180, true);
    }
  });
  raiseSlider.addEventListener('input', () => {
    draft.raiseDegrees = Number(raiseSlider.value);
    preview.setArmRaiseRadians(degreesToStoredRadians(draft.raiseDegrees));
    showRaise();
  });
  raiseSlider.addEventListener('change', () => commitStep());
  showRaise();
  syncControls.push(showRaise);

  inspector.append(
    el('label', { class: 'field slider-field' }, [
      el('span', { text: ctx.t('slider.rightArmRaise') }),
      raiseSlider,
      raiseValue,
    ]),
  );

  // --- save dialog -----------------------------------------------------------
  const saveButton = el('button', { type: 'button', class: 'button primary' }, [
    ctx.t('btn.saveToSlot'),
  ]) as HTMLButtonElement;

  const openSaveDialog = (): void => {
    if (graphemeLength(nameInput.value.trim()) < NAME_MIN || graphemeLength(nameInput.value.trim()) > NAME_MAX) {
      nameLimit.textContent = ctx.t('fb.heroNameLimit');
      return;
    }
    let chosenSlot = 1;

    const dialog = el('div', {
      class: 'dialog paper-card',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': ctx.t('dialog.saveHero'),
    });
    const group = el('div', {
      class: 'radiogroup',
      role: 'radiogroup',
      'aria-label': ctx.t('group.saveSlot'),
    });
    const radios: HTMLElement[] = [];

    const slotLabel = (slot: number): string => {
      const held = slots.get(slot);
      const base = ctx.t('radio.slot', { n: slot });
      return held === undefined ? base : `${base} — ${held.name}`;
    };

    const syncSlots = (): void => {
      radios.forEach((radio, index) => {
        const slot = index + 1;
        radio.textContent = slotLabel(slot);
        const selected = slot === chosenSlot;
        radio.setAttribute('aria-checked', String(selected));
        radio.tabIndex = selected ? 0 : -1;
      });
    };

    for (const slot of [1, 2, 3]) {
      const radio = el('button', {
        type: 'button',
        role: 'radio',
        class: 'swatch',
        'aria-checked': String(slot === 1),
      }, [slotLabel(slot)]);
      radio.addEventListener('click', () => {
        chosenSlot = slot;
        syncSlots();
        radio.focus();
      });
      radio.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          chosenSlot = (slot % 3) + 1;
          syncSlots();
          radios[chosenSlot - 1].focus();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          chosenSlot = ((slot + 1) % 3) + 1;
          syncSlots();
          radios[chosenSlot - 1].focus();
        }
      });
      radios.push(radio);
      group.append(radio);
    }

    const saveAction = el('button', { type: 'button', class: 'button primary' }, [
      ctx.t('btn.save'),
    ]) as HTMLButtonElement;
    const cancelAction = el('button', { type: 'button', class: 'button' }, [
      ctx.t('btn.cancel'),
    ]) as HTMLButtonElement;

    const close = (): void => {
      dialog.remove();
      saveButton.focus();
    };

    cancelAction.addEventListener('click', close);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !saveAction.disabled) {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });

    saveAction.addEventListener('click', () => {
      const held = slots.get(chosenSlot);
      saveAction.disabled = true;
      cancelAction.disabled = true;
      for (const radio of radios) radio.setAttribute('aria-disabled', 'true');
      saveAction.textContent = ctx.t('fb.pending');
      saveAction.focus();

      void (async () => {
        try {
          const response = await api.put<{ character: Character }>(
            `/api/characters/slots/${chosenSlot}`,
            {
              revision: held?.revision ?? null,
              name: nameInput.value.trim(),
              parts: draft.parts,
              proportions: draft.proportions,
              pose: { right_arm_raise: degreesToStoredRadians(draft.raiseDegrees) },
              material: draft.material,
              accessories: draft.accessories,
              model_id: draft.model_id,
              weapon_id: draft.weapon_id,
            },
          );
          slots.set(chosenSlot, {
            name: response.character.name,
            revision: response.character.revision,
          });
          dialog.remove();
          ctx.announce(ctx.t('fb.heroSaved', { n: chosenSlot }));
          saveButton.focus();
        } catch (failure) {
          saveAction.textContent = ctx.t('btn.save');
          saveAction.disabled = false;
          cancelAction.disabled = false;
          for (const radio of radios) radio.removeAttribute('aria-disabled');
          if (failure instanceof ApiFailure && failure.code === 'stale_revision') {
            const fresh = await api.get<{ characters: Character[] }>('/api/characters');
            slots.clear();
            for (const character of fresh.characters) {
              slots.set(character.slot, {
                name: character.name,
                revision: character.revision,
              });
            }
            syncSlots();
            ctx.announce(failure.localisedMessage);
            saveAction.focus();
            return;
          }
          ctx.announce(
            failure instanceof ApiFailure
              ? (failure.fieldMessage('proportions') ??
                  failure.fieldMessage('pose') ??
                  failure.fieldMessage('name') ??
                  failure.localisedMessage)
              : ctx.t('fb.generic'),
          );
          saveAction.focus();
        }
      })();
    });

    dialog.append(
      el('h2', { text: ctx.t('dialog.saveHero') }),
      group,
      el('div', { class: 'dialog-actions' }, [saveAction, cancelAction]),
    );
    host.append(dialog);
    radios[0].focus();
  };

  saveButton.addEventListener('click', openSaveDialog);
  inspector.append(el('div', { class: 'inspector-actions' }, [undoButton, redoButton, saveButton]));
  refreshHistoryButtons();

  const shortcuts = (event: KeyboardEvent): void => {
    if (document.activeElement === nameInput) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      if (historyIndex > 0) restore(historyIndex - 1);
      return;
    }
    if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      if (historyIndex < history.length - 1) restore(historyIndex + 1);
    }
  };
  layout.addEventListener('keydown', shortcuts);

  return {
    destroy: (): void => {
      preview.destroy();
      sheetQuery.removeEventListener('change', applySheet);
    },
  };
}
