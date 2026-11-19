import { el, t } from './ui.js';
import { api, getJson, type Character } from './api-client.js';
import { store, notify } from './store.js';
import { languagePickerHtml } from './language.js';
import { navTabs, heroDataOf, weaponById, signOutButton } from './pages-hangar.js';
import { createHeroPreview, reducedMotion, type SceneHandle, type HeroData } from './scene.js';
import { countChars, degreesToRoundedRadians, radiansToDegrees, PROPORTION_KEYS, clamp } from '../shared/domain.js';
import { formatNumber } from '../shared/domain.js';
import type { Locale } from '../shared/domain.js';
import { locale } from './ui.js';

/**
 * The builder (DP-11 to DP-17, DP-67): parts, proportions, pose, undo/redo and the save dialog.
 */

type UndoStep = { label: string; apply: () => void; restore: () => void };

const proportionSliderKeys: [string, string][] = [
  ['head_size', 'head-size'], ['neck_length', 'neck-length'], ['spine_length', 'spine-length'],
  ['upper_arm_length', 'upper-arm-length'], ['forearm_length', 'forearm-length'],
  ['thigh_length', 'thigh-length'], ['shin-length' as string, 'shin-length'],
];

export async function mountBuilder(characterId?: string): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  const list = await getJson<{ characters: Character[] }>('/api/characters');
  let character: Character | null = null;
  if (characterId) {
    character = (list?.characters ?? []).find((c) => c.id === characterId) ?? null;
  }
  if (!character) {
    character = (list?.characters ?? []).find((c) => c.equipped) ?? (list?.characters ?? [])[0] ?? null;
  }
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout builder-layout' });
  layout.append(navTabs('/builder'));
  const scene = el('div', { class: 'scene-hold builder-scene' });
  const parts = el('section', { class: 'parts-rail', role: 'region', 'aria-label': t('controls', 'parts'), id: 'parts-rail' });
  const inspector = el('aside', { class: 'inspector-card', role: 'region', 'aria-label': t('copy', 'builder-heading') });

  const hero: HeroData = heroDataOf(character);
  const preview = createHeroPreview(hero, null, { reduced: reducedMotion() });
  scene.append(preview.element);

  const undoHistory: UndoStep[] = [];
  const redoHistory: UndoStep[] = [];
  let currentHero = { ...hero, proportions: { ...hero.proportions }, pose: { ...hero.pose }, parts: { ...hero.parts }, accessories: { ...hero.accessories } };

  const undoButton = el('button', { class: 'ghost', text: t('controls', 'undo'), disabled: true });
  const redoButton = el('button', { class: 'ghost', text: t('controls', 'redo'), disabled: true });
  const saveButton = el('button', { class: 'primary', text: t('controls', 'save-to-slot') });

  const nameInput = el('input', { type: 'text', id: 'hero-name', value: currentHero.name });
  nameInput.setAttribute('aria-describedby', 'hero-name-counter');
  const nameCounter = el('span', { id: 'hero-name-counter', class: 'counter', text: `${countChars(nameInput.value)}/20` });
  const nameLimit = el('p', { class: 'field-limit', hidden: true, text: t('copy', 'hero-name-limit') });
  const nameField = el('label', { for: 'hero-name', text: t('controls', 'hero-name') });
  const syncName = () => {
    nameCounter.textContent = `${countChars(nameInput.value)}/20`;
    const over = countChars(nameInput.value) > 20 || countChars(nameInput.value) < 3;
    nameCounter.classList.toggle('over', over);
    nameLimit.hidden = !over;
    currentHero.name = nameInput.value;
  };
  nameInput.addEventListener('input', syncName);

  const pushUndo = (step: UndoStep) => {
    undoHistory.push(step);
    if (undoHistory.length > 50) undoHistory.shift();
    redoHistory.length = 0;
    undoButton.disabled = false;
    redoButton.disabled = true;
  };
  const applyUndo = () => {
    const step = undoHistory.pop();
    if (!step) return;
    step.restore();
    redoHistory.push(step);
    undoButton.disabled = undoHistory.length === 0;
    redoButton.disabled = false;
    preview.setHero(currentHero);
    syncSliders();
  };
  const applyRedo = () => {
    const step = redoHistory.pop();
    if (!step) return;
    step.apply();
    undoHistory.push(step);
    undoButton.disabled = false;
    redoButton.disabled = redoHistory.length === 0;
    preview.setHero(currentHero);
    syncSliders();
  };
  undoButton.addEventListener('click', applyUndo);
  redoButton.addEventListener('click', applyRedo);

  const builderKeys = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'text') return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      applyUndo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      applyRedo();
    }
  };

  const sliders: Record<string, HTMLInputElement> = {};
  const sliderLabels: Record<string, HTMLElement> = {};
  const syncSliders = () => {
    for (const key of PROPORTION_KEYS) {
      const slider = sliders[key];
      if (!slider) continue;
      slider.value = String(currentHero.proportions[key] ?? 1);
      const label = sliderLabels[key];
      if (label) label.textContent = formatNumber(currentHero.proportions[key] ?? 1, locale as Locale, 2);
    }
    if (sliders.rightArm) {
      sliders.rightArm.value = String(radiansToDegrees(currentHero.pose.right_arm_raise));
      sliderLabels.rightArm!.textContent = `${radiansToDegrees(currentHero.pose.right_arm_raise)}°`;
    }
  };

  const partsGroup = (id: string, kind: 'part' | 'accessory', options: string[], current: string, onChange: (value: string) => void, key?: string): HTMLElement => {
    const group = el('div', { role: 'radiogroup', 'aria-label': t('controls', id), class: 'radio-group', id: `group-${id}` });
    for (const value of options) {
      const input = el('input', { type: 'radio', name: id, id: `${id}-${value}`, value });
      input.checked = value === current;
      const label = el('label', { for: `${id}-${value}`, text: key ? t('copy', key) : value });
      const activate = () => {
        const before = { ...currentHero };
        const next = value;
        const apply = () => {
          if (kind === 'part') currentHero.parts[id] = next;
          else currentHero.accessories[id] = next;
          preview.setHero(currentHero);
          syncSliders();
        };
        const restore = () => {
          if (kind === 'part') currentHero.parts[id] = before.parts[id] ?? 'round';
          else currentHero.accessories[id] = before.accessories[id] ?? 'none';
          preview.setHero(currentHero);
          syncSliders();
        };
        input.checked = true;
        apply();
        pushUndo({ label: id, apply, restore });
        preview.setCameraFocus(id === 'head' ? 'head' : id === 'back' || id === 'head-socket' ? 'head' : 'material');
      };
      input.addEventListener('change', activate);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          const next = input.parentElement?.querySelectorAll('input') ?? [];
          const list = Array.from(next as NodeListOf<HTMLInputElement>);
          const index = list.findIndex((i) => i.checked);
          const target = list[(index + 1) % list.length];
          target?.click();
          target?.focus();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const list = Array.from((input.parentElement?.querySelectorAll('input') ?? []) as NodeListOf<HTMLInputElement>);
          const index = list.findIndex((i) => i.checked);
          const target = list[(index - 1 + list.length) % list.length];
          target?.click();
          target?.focus();
        }
      });
      group.append(input, label);
    }
    return group;
  };

  // Parts rail
  const headGroup = partsGroup('head', 'part', ['round', 'square', 'triangle'], currentHero.parts.head ?? 'round', () => {}, 'part-round');
  const torsoGroup = partsGroup('torso', 'part', ['stick', 'barrel', 'kite'], currentHero.parts.torso ?? 'stick', () => {}, 'part-stick');
  const armsGroup = partsGroup('arms', 'part', ['thin', 'thick'], currentHero.parts.arms ?? 'thin', () => {}, 'part-thin');
  const legsGroup = partsGroup('legs', 'part', ['thin', 'thick', 'spring'], currentHero.parts.legs ?? 'thin', () => {}, 'part-thin');
  const materialGroup = partsGroup('material', 'accessory', ['graphite', 'cobalt', 'marker', 'chalk', 'brick', 'moss'], currentHero.material, (value) => {
    currentHero.material = value;
  });
  const headSocket = partsGroup('head-socket', 'accessory', ['none', 'paper_crown', 'beanie'], currentHero.accessories.head ?? 'none', () => {}, 'accessory-none');
  const backSocket = partsGroup('back-socket', 'accessory', ['none', 'scarf', 'satchel'], currentHero.accessories.back ?? 'none', () => {}, 'accessory-none');
  const leftHandSocket = partsGroup('left-hand-socket', 'accessory', ['none', 'lantern', 'shield'], currentHero.accessories.left_hand ?? 'none', () => {}, 'accessory-none');

  const partsSheetHandle = el('button', { class: 'parts-sheet-handle', 'aria-expanded': 'false', 'aria-controls': 'parts-rail', text: t('controls', 'parts-sheet') });
  const sheetSection = el('div', { class: 'parts-sheet-body' });
  sheetSection.append(
    headGroup, torsoGroup, armsGroup, legsGroup, materialGroup, headSocket, backSocket, leftHandSocket,
  );
  parts.append(partsSheetHandle, sheetSection);

  // Proportion sliders
  const slidersBox = el('div', { class: 'sliders' });
  const proportionControls: [keyof typeof currentHero.proportions, string][] = [
    ['head_size', 'head-size'], ['neck_length', 'neck-length'], ['spine_length', 'spine-length'],
    ['upper_arm_length', 'upper-arm-length'], ['forearm_length', 'forearm-length'],
    ['thigh_length', 'thigh-length'], ['shin_length', 'shin-length'],
  ];
  for (const [key, labelKey] of proportionControls) {
    const initialValue = currentHero.proportions[key] ?? 1;
    const slider = el('input', { type: 'range', min: '0.50', max: '1.50', step: '0.05', value: String(initialValue), id: `slider-${key}` });
    const valueText = el('span', { class: 'slider-value', text: formatNumber(initialValue, locale as Locale, 2) });
    const label = el('label', { for: `slider-${key}`, text: t('controls', labelKey) });
    const applyValue = (value: number) => {
      const before = currentHero.proportions[key] ?? 1;
      const apply = () => {
        currentHero.proportions[key] = value;
        preview.setHero(currentHero);
        valueText.textContent = formatNumber(value, locale as Locale, 2);
      };
      const restore = () => {
        currentHero.proportions[key] = before;
        preview.setHero(currentHero);
        valueText.textContent = formatNumber(before, locale as Locale, 2);
      };
      void key;
      apply();
      pushUndo({ label: String(key), apply, restore });
    };
    slider.addEventListener('keydown', (event) => {
      const current = Number(slider.value);
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        applyValue(clamp(current + 0.05, 0.5, 1.5));
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        applyValue(clamp(current - 0.05, 0.5, 1.5));
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        applyValue(clamp(current + 0.2, 0.5, 1.5));
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        applyValue(clamp(current - 0.2, 0.5, 1.5));
      } else if (event.key === 'Home') {
        event.preventDefault();
        applyValue(0.5);
      } else if (event.key === 'End') {
        event.preventDefault();
        applyValue(1.5);
      }
    });
    let dragFrom: number | null = null;
    slider.addEventListener('pointerdown', () => {
      dragFrom = Number(slider.value);
    });
    slider.addEventListener('pointerup', () => {
      if (dragFrom !== null && dragFrom !== Number(slider.value)) applyValue(Number(slider.value));
      dragFrom = null;
    });
    slider.addEventListener('change', () => {
      if (dragFrom === null) applyValue(Number(slider.value));
    });
    sliders[key] = slider;
    sliderLabels[key] = valueText;
    slidersBox.append(label, el('div', { class: 'slider-row' }, slider, valueText));
  }

  // Right arm raise
  const rightArm = el('input', { type: 'range', min: '-180', max: '180', step: '15', value: String(radiansToDegrees(currentHero.pose.right_arm_raise)), id: 'slider-right-arm' });
  const rightArmValue = el('span', { class: 'slider-value', text: `${radiansToDegrees(currentHero.pose.right_arm_raise)}°` });
  const rightArmLabel = el('label', { for: 'slider-right-arm', text: t('controls', 'right-arm-raise') });
  rightArm.addEventListener('keydown', (event) => {
    const current = Number(rightArm.value);
    const applyAt = (angle: number) => {
      const clamped = clamp(angle, -180, 180);
      const before = currentHero.pose.right_arm_raise;
      const apply = () => {
        currentHero.pose.right_arm_raise = degreesToRoundedRadians(clamped);
        rightArm.value = String(clamped);
        rightArmValue.textContent = `${clamped}°`;
        preview.setHero(currentHero);
      };
      const restore = () => {
        currentHero.pose.right_arm_raise = before;
        rightArm.value = String(radiansToDegrees(before));
        rightArmValue.textContent = `${radiansToDegrees(before)}°`;
        preview.setHero(currentHero);
      };
      apply();
      pushUndo({ label: 'right-arm-raise', apply, restore });
    };
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      applyAt(current + 15);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      applyAt(current - 15);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      applyAt(current + 45);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      applyAt(current - 45);
    } else if (event.key === 'Home') {
      event.preventDefault();
      applyAt(-180);
    } else if (event.key === 'End') {
      event.preventDefault();
      applyAt(180);
    }
  });
  let armDragFrom: number | null = null;
  rightArm.addEventListener('pointerdown', () => {
    armDragFrom = Number(rightArm.value);
  });
  rightArm.addEventListener('pointerup', () => {
    if (armDragFrom !== null && armDragFrom !== Number(rightArm.value)) {
      const angle = Number(rightArm.value);
      const before = currentHero.pose.right_arm_raise;
      const apply = () => {
        currentHero.pose.right_arm_raise = degreesToRoundedRadians(angle);
        rightArmValue.textContent = `${angle}°`;
        preview.setHero(currentHero);
      };
      const restore = () => {
        currentHero.pose.right_arm_raise = before;
        rightArmValue.textContent = `${radiansToDegrees(before)}°`;
        preview.setHero(currentHero);
      };
      apply();
      pushUndo({ label: 'right-arm-raise', apply, restore });
    }
    armDragFrom = null;
  });
  sliders.rightArm = rightArm;
  sliderLabels.rightArm = rightArmValue;

  // Save dialog
  const dialog = el('div', { class: 'modal-backdrop', hidden: true });
  const dialogPanel = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('controls', 'save-hero'), class: 'modal-panel' });
  const slotGroup = el('div', { role: 'radiogroup', 'aria-label': t('controls', 'save-slot'), class: 'radio-group' });
  const slotRadios: HTMLInputElement[] = [];
  const save = el('button', { class: 'primary', text: t('controls', 'save') });
  const cancel = el('button', { class: 'ghost', text: t('controls', 'cancel') });
  dialogPanel.append(el('h2', { text: t('controls', 'save-hero') }), slotGroup, save, cancel);
  dialog.append(dialogPanel);

  const loadSlots = async () => {
    slotGroup.replaceChildren();
    slotRadios.length = 0;
    const listNow = await getJson<{ characters: Character[] }>('/api/characters');
    const bySlot = new Map((listNow?.characters ?? []).map((c) => [c.slot, c]));
    for (let slot = 1; slot <= 3; slot++) {
      const occupant = bySlot.get(slot);
      const input = el('input', { type: 'radio', name: 'save-slot', id: `slot-${slot}`, value: String(slot) });
      const labelText = occupant ? `${t('controls', 'slot', { n: slot })} — ${occupant.name}` : t('controls', 'slot', { n: slot });
      const label = el('label', { for: `slot-${slot}`, text: labelText });
      input.checked = slot === (character?.slot ?? 1);
      slotRadios.push(input);
      slotGroup.append(input, label);
    }
  };

  const openDialog = async () => {
    if (countChars(nameInput.value) < 3 || countChars(nameInput.value) > 20) {
      nameLimit.hidden = false;
      nameCounter.classList.add('over');
      return;
    }
    await loadSlots();
    dialog.hidden = false;
    slotRadios[0]?.focus();
  };
  const closeDialog = () => {
    dialog.hidden = true;
    saveButton.focus();
  };
  saveButton.addEventListener('click', () => void openDialog());
  cancel.addEventListener('click', closeDialog);
  dialogPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!dialog.hidden && !save.disabled) closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(dialogPanel.querySelectorAll<HTMLElement>('button, input')).filter((n) => !(n as HTMLInputElement).disabled);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  save.addEventListener('click', async () => {
    const slot = Number(slotRadios.find((r) => r.checked)?.value ?? 1);
    save.disabled = true;
    cancel.disabled = true;
    for (const radio of slotRadios) radio.disabled = true;
    save.textContent = t('copy', 'working');
    const revision = character && character.slot === slot ? character.revision : null;
    const result = await api<{ character: Character }>('PUT', `/api/characters/slots/${slot}`, {
      revision,
      name: nameInput.value.trim(),
      parts: currentHero.parts,
      proportions: currentHero.proportions,
      pose: { right_arm_raise: degreesToRoundedRadians(Number(rightArm.value)) },
      material: currentHero.material,
      accessories: currentHero.accessories,
      model_id: character?.model_id ?? null,
      weapon_id: character?.weapon_id ?? null,
    });
    save.textContent = t('controls', 'save');
    if (result.status === 200 || result.status === 201) {
      dialog.hidden = true;
      if (result.data?.character) character = result.data.character;
      await loadSlots();
      notify(t('copy', 'hero-saved', { n: slot }));
      saveButton.focus();
    } else if (result.status === 412) {
      await loadSlots();
      notify(t('copy', 'stale-slot'));
    } else {
      notify(t('copy', 'generic-error'));
    }
    save.disabled = false;
    cancel.disabled = false;
    for (const radio of slotRadios) radio.disabled = false;
  });

  // Bottom sheet
  const updateSheet = () => {
    const narrow = window.innerWidth < 1024;
    parts.classList.toggle('bottom-sheet', narrow);
    const expanded = parts.classList.contains('expanded');
    partsSheetHandle.setAttribute('aria-expanded', String(expanded));
    const body = parts.querySelector('.parts-sheet-body');
    if (body) {
      (body as HTMLElement).style.pointerEvents = narrow && !expanded ? 'none' : '';
      const items = Array.from((body as HTMLElement).children);
      for (const item of items.slice(1)) {
        (item as HTMLElement).inert = narrow && !expanded;
      }
    }
  };
  partsSheetHandle.addEventListener('click', () => {
    parts.classList.toggle('expanded');
    updateSheet();
  });
  window.addEventListener('resize', updateSheet);
  updateSheet();

  inspector.append(
    nameField, nameInput, nameCounter, nameLimit,
    el('h2', { class: 'section-heading', text: t('copy', 'proportions-heading') }),
    slidersBox,
    el('div', { class: 'slider-row' }, rightArmLabel, el('div', { class: 'slider-row' }, rightArm, rightArmValue)),
    el('div', { class: 'button-row' }, undoButton, redoButton, saveButton),
    languagePickerHtml(), signOutButton(),
  );

  layout.append(parts, inspector);
  root.append(layout, scene, dialog);
  document.addEventListener('keydown', builderKeys);
  preview.render();
}
