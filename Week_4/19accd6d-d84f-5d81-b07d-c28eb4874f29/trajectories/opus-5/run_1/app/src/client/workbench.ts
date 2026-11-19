import { fromText, decodeLossy, decodeLossyIn, countLines } from '../shared/bytes.js';
import type { TextEncodingName } from '../shared/bytes.js';
import { byteLineStatus, formatStamp, parseTtl } from '../shared/format.js';
import {
  defaultArgs,
  findOperation,
  flagLabels,
  FLAG_LETTERS,
  normalizeArgs,
  opFamilies,
  operations,
  operationsOfFamily,
  type ArgSpec,
  type OpFamily,
} from '../shared/ops.js';
import { buildRecipeLink, parseRecipeLink, parseTagList, type RecipeStep } from '../shared/recipe.js';
import type { SpanRange } from '../shared/span.js';
import {
  api,
  ApiCallError,
  uploadFile,
  type ClientConfig,
  type RecipeSummary,
  type SnapshotBody,
  type TeamMembership,
  type User,
  type VersionBody,
} from './api.js';
import { Baker } from './baker.js';
import { announceInto, clear, downloadBytes, h, icon, iconButton, isPhoneLayout, mascot } from './dom.js';
import {
  dialogActions,
  fieldError,
  openModal,
  plainButton,
  primaryButton,
  showFieldErrors,
  withBusy,
} from './dialogs.js';
import {
  enabledIndices,
  errorLine,
  firstBreakpoint,
  loadFavourites,
  loadStored,
  newTab,
  nextEnabled,
  outputView,
  saveFavourites,
  STARTER_INPUT,
  STARTER_STEPS,
  storeState,
  suggestOperation,
  tabBytes,
  toBase64,
  walkSpan,
  type InputTab,
  type WorkbenchState,
} from './workbench-state.js';
import type { LiveEvent } from './live.js';

export interface WorkbenchOptions {
  config: ClientConfig;
  session: { user: User; teams: TeamMembership[] } | null;
  recipeRequest: { id: string; version: number | null } | null;
}

export interface WorkbenchHandle {
  onLiveEvent(event: LiveEvent): void;
  onReconnect(): void;
}

const MAX_TABS = 10;

export function renderWorkbench(root: HTMLElement, options: WorkbenchOptions): WorkbenchHandle {
  const { config } = options;
  const stored = loadStored();
  const state: WorkbenchState = {
    steps: stored?.steps ?? STARTER_STEPS.map((step) => ({ ...step, args: { ...step.args } })),
    tabs:
      stored?.tabs.map((entry) => ({
        text: entry.text,
        encoding: entry.encoding,
        file: entry.file,
        fileBytes: null,
        selection: null,
      })) ?? [{ ...newTab(), text: STARTER_INPUT }],
    selectedTab: stored?.selectedTab ?? 0,
    autoBake: stored?.autoBake ?? true,
    outputView: stored?.outputView ?? 'Text',
    recipe: stored?.recipe ?? null,
    edited: false,
    favourites: loadFavourites(),
    result: null,
    pausedAt: null,
    baking: false,
    splitA: 20,
    splitB: 50,
    splitC: 50,
  };
  if (state.tabs.length === 0) state.tabs = [newTab()];
  if (state.selectedTab >= state.tabs.length) state.selectedTab = 0;

  const baker = new Baker(config.regexBudgetMs);
  const separatorUpdaters: (() => void)[] = [];
  let openFamily: OpFamily | null = 'Encoding';
  let searchText = '';
  let activeOption: string | null = null;
  let bakeTimer: number | null = null;
  let inputAlertSticky = false;
  let spinnerTimer: number | null = null;
  let lastInputValue = state.tabs[state.selectedTab]!.text;

  const tab = (): InputTab => state.tabs[state.selectedTab]!;

  clear(root);
  const announcements = h('div', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Workbench announcements',
  });
  const announce = (message: string): void => announceInto(announcements, message);

  const topAlert = h('div', { class: 'workbench-alert', role: 'alert', hidden: true });

  const operationsPane = h('section', {
    class: 'pane operations-pane',
    role: 'region',
    'aria-label': 'Operations',
    tabindex: '-1',
  });
  const recipePane = h('section', {
    class: 'pane recipe-pane',
    role: 'region',
    'aria-label': 'Recipe',
    tabindex: '-1',
  });
  const inputPane = h('section', {
    class: 'pane input-pane',
    role: 'region',
    'aria-label': 'Input',
    tabindex: '-1',
  });
  const outputPane = h('section', {
    class: 'pane output-pane',
    role: 'region',
    'aria-label': 'Output',
    tabindex: '-1',
  });

  const paneTabs = h('div', { class: 'pane-tabs', role: 'tablist', 'aria-label': 'Workbench panes' });
  const panels = new Map<string, HTMLElement>([
    ['Operations', operationsPane],
    ['Recipe', recipePane],
    ['Input', inputPane],
    ['Output', outputPane],
  ]);
  let phoneTab = 'Recipe';

  const separatorA = createSeparator({
    name: 'Resize Operations and Recipe',
    orientation: 'vertical',
    get: () => state.splitA,
    set: (value) => {
      state.splitA = value;
      applySplits();
    },
    min: () => 10,
    max: () => state.splitB - 10,
  });
  const separatorB = createSeparator({
    name: 'Resize Recipe and Editors',
    orientation: 'vertical',
    get: () => state.splitB,
    set: (value) => {
      state.splitB = value;
      applySplits();
    },
    min: () => state.splitA + 10,
    max: () => 90,
  });
  const separatorC = createSeparator({
    name: 'Resize Input and Output',
    orientation: 'horizontal',
    get: () => state.splitC,
    set: (value) => {
      state.splitC = value;
      applySplits();
    },
    min: () => 10,
    max: () => 90,
  });

  const inputsTabRow = h('div', { class: 'input-tabs' });
  const operationsSlot = h('div', { class: 'pane-slot operations-slot' }, [operationsPane]);
  const recipeSlot = h('div', { class: 'pane-slot recipe-slot' }, [recipePane]);
  const inputSlot = h('div', { class: 'pane-slot input-slot' }, [inputsTabRow, inputPane]);
  const outputSlot = h('div', { class: 'pane-slot output-slot' }, [outputPane]);
  const editorColumn = h('div', { class: 'editor-column' }, [inputSlot, separatorC, outputSlot]);
  const editorsSlot = h('div', { class: 'editors-slot' }, [editorColumn]);

  const grid = h('div', { class: 'workbench-grid' }, [
    operationsSlot,
    separatorA,
    recipeSlot,
    separatorB,
    editorsSlot,
  ]);

  root.append(topAlert, paneTabs, grid, announcements);

  // --------------------------------------------------------- operations pane
  const finder = h('input', {
    type: 'search',
    class: 'finder',
    'aria-label': 'Find operation',
    placeholder: 'Find operation',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const favouritesHeader = h('div', { class: 'pinned-row' }, [
    h('span', { class: 'pinned-label', text: 'Favourites' }),
    iconButton({
      name: 'star',
      label: 'Edit favourites',
      extraClass: 'star-button',
      onActivate: () => openFavouritesDialog(),
    }),
  ]);
  const favouritesList = h('div', {
    class: 'listbox',
    role: 'listbox',
    'aria-label': 'Favourites',
    tabindex: '0',
  });
  const familyBlocks = new Map<OpFamily, { button: HTMLButtonElement; list: HTMLElement }>();
  const familiesWrap = h('div', { class: 'families' });
  for (const family of opFamilies) {
    const listId = `family-list-${family.replace(/\s+/g, '-').toLowerCase()}`;
    const button = h('button', {
      type: 'button',
      class: 'family-header',
      'aria-expanded': 'false',
      'aria-controls': listId,
    }, [h('span', { text: family })]);
    button.append(icon('chevron-down'));
    const list = h('div', {
      class: 'listbox family-list',
      role: 'listbox',
      'aria-label': family,
      id: listId,
      tabindex: '0',
    });
    button.addEventListener('click', () => {
      openFamily = openFamily === family ? null : family;
      renderOperations();
    });
    familyBlocks.set(family, { button, list });
    familiesWrap.append(button, list);
  }
  const flatList = h('div', {
    class: 'listbox flat-list',
    role: 'listbox',
    'aria-label': 'Operations',
    tabindex: '0',
  });
  const operationsStrip = h('div', { class: 'status-strip' });

  operationsPane.append(
    h('div', { class: 'pane-title' }, [h('h2', { class: 'pane-title-text', text: 'Operations' })]),
    h('div', { class: 'finder-wrap' }, [icon('search'), finder]),
    h('div', { class: 'operations-body' }, [favouritesHeader, favouritesList, familiesWrap, flatList]),
    operationsStrip,
  );

  function optionRow(name: string, container: HTMLElement): HTMLElement {
    const option = h('div', {
      class: 'op-row',
      role: 'option',
      id: `option-${container.getAttribute('aria-label')}-${name}`.replace(/[^A-Za-z0-9-]/g, '-'),
      'aria-selected': 'false',
      text: name,
    });
    option.addEventListener('click', () => {
      activeOption = name;
      addOperation(name);
      markActive();
    });
    return option;
  }

  function visibleOptionNames(): string[] {
    if (searchText.trim() !== '') return filteredNames();
    return [];
  }

  function filteredNames(): string[] {
    const needle = searchText.trim().toLowerCase();
    return operations.filter((op) => op.name.toLowerCase().includes(needle)).map((op) => op.name);
  }

  function markActive(): void {
    for (const list of [favouritesList, flatList, ...[...familyBlocks.values()].map((block) => block.list)]) {
      let activeId: string | null = null;
      for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
        const isActive = option.textContent === activeOption;
        option.setAttribute('aria-selected', isActive ? 'true' : 'false');
        option.classList.toggle('active', isActive);
        if (isActive) activeId = option.id;
      }
      if (activeId === null) list.removeAttribute('aria-activedescendant');
      else list.setAttribute('aria-activedescendant', activeId);
    }
    const flatActive = flatList.getAttribute('aria-activedescendant');
    if (searchText.trim() !== '' && flatActive !== null) finder.setAttribute('aria-activedescendant', flatActive);
    else finder.removeAttribute('aria-activedescendant');
  }

  function renderOperations(): void {
    const searching = searchText.trim() !== '';
    favouritesHeader.toggleAttribute('hidden', searching);
    favouritesList.toggleAttribute('hidden', searching);
    familiesWrap.toggleAttribute('hidden', searching);
    flatList.toggleAttribute('hidden', !searching);

    clear(favouritesList);
    for (const name of state.favourites) favouritesList.append(optionRow(name, favouritesList));

    for (const family of opFamilies) {
      const block = familyBlocks.get(family)!;
      const open = openFamily === family;
      block.button.setAttribute('aria-expanded', open ? 'true' : 'false');
      block.list.toggleAttribute('hidden', !open);
      block.button.classList.toggle('open', open);
      clear(block.list);
      if (open) {
        for (const op of operationsOfFamily(family)) block.list.append(optionRow(op.name, block.list));
      }
    }

    clear(flatList);
    const names = filteredNames();
    if (searching) {
      for (const name of names) flatList.append(optionRow(name, flatList));
      if (activeOption === null || !names.includes(activeOption)) activeOption = names[0] ?? null;
      operationsStrip.textContent = `${names.length} ${names.length === 1 ? 'result' : 'results'}`;
    } else {
      activeOption = null;
      operationsStrip.textContent = `${operations.length} operations`;
    }
    markActive();
  }

  function moveActive(delta: number): void {
    const names = visibleOptionNames();
    if (names.length === 0) return;
    const at = activeOption === null ? -1 : names.indexOf(activeOption);
    const next = at < 0 ? (delta > 0 ? 0 : names.length - 1) : (at + delta + names.length) % names.length;
    activeOption = names[next]!;
    markActive();
    const option = flatList.querySelector<HTMLElement>('[aria-selected="true"]');
    option?.scrollIntoView({ block: 'nearest' });
  }

  finder.addEventListener('input', () => {
    searchText = finder.value;
    renderOperations();
  });
  finder.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption !== null && searchText.trim() !== '') {
        addOperation(activeOption);
        finder.focus();
        finder.select();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      operationsPane.focus();
    }
  });

  function listboxKeys(list: HTMLElement): void {
    list.addEventListener('keydown', (event) => {
      const names = [...list.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent ?? '');
      if (names.length === 0) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const at = activeOption === null ? -1 : names.indexOf(activeOption);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = at < 0 ? (delta > 0 ? 0 : names.length - 1) : (at + delta + names.length) % names.length;
        activeOption = names[next]!;
        markActive();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = activeOption !== null && names.includes(activeOption) ? activeOption : names[0]!;
        activeOption = chosen;
        addOperation(chosen);
        markActive();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        operationsPane.focus();
      }
    });
  }
  listboxKeys(favouritesList);
  listboxKeys(flatList);
  for (const block of familyBlocks.values()) listboxKeys(block.list);

  function openFavouritesDialog(): void {
    const opener = favouritesHeader.querySelector<HTMLButtonElement>('button');
    const modal = openModal({ title: 'Edit favourites', opener });
    const list = h('div', { class: 'favourites-grid' });
    for (const op of operations) {
      const box = h('input', { type: 'checkbox', '.checked': state.favourites.includes(op.name) });
      box.setAttribute('aria-label', op.name);
      box.addEventListener('change', () => {
        if (box.checked) {
          if (!state.favourites.includes(op.name)) state.favourites.push(op.name);
        } else {
          state.favourites = state.favourites.filter((name) => name !== op.name);
        }
        saveFavourites(state.favourites);
        renderOperations();
      });
      list.append(h('label', { class: 'checkbox-row' }, [box, h('span', { text: op.name })]));
    }
    modal.body.append(list, dialogActions([plainButton('Done', () => modal.close())]));
    modal.body.querySelector<HTMLInputElement>('input')?.focus();
  }

  // ------------------------------------------------------------- recipe pane
  const recipeLineText = h('span', { class: 'recipe-line' });
  const saveButton = iconButton({ name: 'save', label: 'Save', onActivate: () => openSaveDialog() });
  const copyLinkButton = iconButton({ name: 'link', label: 'Copy link', onActivate: () => copyRecipeLink() });
  const shareButton = iconButton({ name: 'share-2', label: 'Share snapshot', onActivate: () => openSnapshotDialog() });
  const clearRecipeButton = iconButton({ name: 'eraser', label: 'Clear recipe', onActivate: () => clearRecipe() });
  const recipeLinkField = h('input', {
    type: 'text',
    class: 'link-field',
    'aria-label': 'Recipe link',
    readonly: true,
  });
  const recipeLinkRow = h('div', { class: 'link-row', hidden: true }, [recipeLinkField]);
  const updateBannerText = h('span', { class: 'banner-text' });
  const loadLatestButton = plainButton('Load latest', () => void loadLatestVersion());
  const keepMineButton = plainButton('Keep mine', () => {
    updateBanner.hidden = true;
  });
  const updateBanner = h('div', {
    class: 'update-banner',
    role: 'status',
    'aria-live': 'off',
    'aria-label': 'Recipe update',
    hidden: true,
  }, [updateBannerText, loadLatestButton, keepMineButton]);
  const stepList = h('div', { class: 'step-list', role: 'list', 'aria-label': 'Recipe steps' });
  const addOperationButton = plainButton('Add operation', () => openOperationSheet());
  addOperationButton.classList.add('add-operation');
  const stepLabelButton = h('button', { type: 'button', class: 'step-button', text: 'Step' });
  stepLabelButton.addEventListener('click', () => void stepOnce());
  const bakeLabel = h('span', { class: 'bake-label', text: 'Bake' });
  const bakeButton = h('button', { type: 'button', class: 'bake-pill' }, [mascot('bake-mascot'), bakeLabel]);
  bakeButton.setAttribute('aria-label', 'Bake');
  bakeButton.addEventListener('click', () => void bakeNow());
  const autoBakeBox = h('input', { type: 'checkbox', '.checked': state.autoBake, id: 'auto-bake' });
  autoBakeBox.setAttribute('aria-label', 'Auto-bake');
  autoBakeBox.addEventListener('change', () => {
    state.autoBake = autoBakeBox.checked;
    storeState(state);
  });
  const bakeStatus = h('div', {
    class: 'status-strip bake-status',
    role: 'status',
    'aria-live': 'off',
    'aria-label': 'Bake status',
  });
  const runFooter = h('div', { class: 'run-footer' }, [
    stepLabelButton,
    h('div', { class: 'run-footer-right' }, [
      bakeButton,
      h('label', { class: 'checkbox-row auto-bake-row' }, [autoBakeBox, h('span', { text: 'Auto-bake' })]),
    ]),
    bakeStatus,
  ]);

  recipePane.append(
    h('div', { class: 'pane-title' }, [
      h('h2', { class: 'pane-title-text', text: 'Recipe' }),
      recipeLineText,
      h('div', { class: 'pane-title-actions' }, [saveButton, copyLinkButton, shareButton, clearRecipeButton]),
    ]),
    recipeLinkRow,
    updateBanner,
    h('div', { class: 'recipe-body' }, [addOperationButton, stepList]),
    runFooter,
  );

  interface StepView {
    card: HTMLElement;
    chip: HTMLElement;
    stateText: HTMLElement;
  }
  let stepViews: StepView[] = [];

  function argumentField(step: RecipeStep, spec: ArgSpec, index: number): HTMLElement {
    const args = normalizeArgs(findOperation(step.op)!, step.args);
    const change = (value: string | number | boolean): void => {
      step.args[spec.key] = value;
      onRecipeChanged();
      updateStepDecorations();
    };
    if (spec.kind === 'option') {
      const select = h('select', { class: 'select arg-field', 'aria-label': spec.label });
      for (const option of spec.options) {
        select.append(h('option', { value: option, text: option, selected: option === args[spec.key] }));
      }
      select.addEventListener('change', () => change(select.value));
      return h('label', { class: 'arg-row' }, [h('span', { class: 'arg-label', text: spec.label }), select]);
    }
    if (spec.kind === 'toggle') {
      const box = h('input', { type: 'checkbox', '.checked': args[spec.key] === true });
      box.setAttribute('aria-label', spec.label);
      box.addEventListener('change', () => change(box.checked));
      return h('label', { class: 'arg-row checkbox-row' }, [box, h('span', { class: 'arg-label', text: spec.label })]);
    }
    if (spec.kind === 'int') {
      const field = h('input', {
        type: 'number',
        class: 'text-input arg-field mono',
        'aria-label': spec.label,
        min: String(spec.min),
        max: String(spec.max),
        '.value': String(args[spec.key]),
      });
      field.addEventListener('input', () => {
        const parsed = Number.parseInt(field.value, 10);
        if (Number.isInteger(parsed)) change(Math.min(spec.max, Math.max(spec.min, parsed)));
      });
      return h('label', { class: 'arg-row' }, [h('span', { class: 'arg-label', text: spec.label }), field]);
    }
    if (spec.kind === 'text') {
      const field = h('input', {
        type: 'text',
        class: 'text-input arg-field mono',
        'aria-label': spec.label,
        '.value': String(args[spec.key]),
      });
      field.addEventListener('input', () => change(field.value));
      return h('label', { class: 'arg-row' }, [h('span', { class: 'arg-label', text: spec.label }), field]);
    }
    const group = h('div', { class: 'arg-row flags-group', role: 'group', 'aria-label': 'Flags' });
    for (const letter of FLAG_LETTERS) {
      const current = String(args[spec.key]);
      const box = h('input', { type: 'checkbox', '.checked': current.includes(letter) });
      box.setAttribute('aria-label', flagLabels[letter]!);
      box.addEventListener('change', () => {
        const letters = new Set(String(step.args[spec.key] ?? current).split(''));
        if (box.checked) letters.add(letter);
        else letters.delete(letter);
        change(FLAG_LETTERS.filter((candidate) => letters.has(candidate)).join(''));
      });
      group.append(h('label', { class: 'checkbox-row flag-row' }, [box, h('span', { text: flagLabels[letter]! })]));
    }
    void index;
    return group;
  }

  function renderSteps(): void {
    const focusedIndex = stepViews.findIndex((view) => view.card === document.activeElement);
    clear(stepList);
    stepViews = [];
    state.steps.forEach((step, index) => {
      const number = index + 1;
      const card = h('div', {
        class: 'step-card',
        role: 'listitem',
        tabindex: '0',
        'aria-label': `Step ${number}: ${step.op}`,
      });
      const stateText = h('span', { class: 'step-state' });
      const chip = h('span', { class: 'span-chip', hidden: true });
      const disableBox = h('input', { type: 'checkbox', '.checked': step.disabled });
      disableBox.setAttribute('aria-label', `Disable step ${number}`);
      disableBox.addEventListener('change', () => toggleDisabled(index));
      const breakpointButton = iconButton({
        name: 'circle-dot',
        label: `Toggle breakpoint on step ${number}`,
        pressed: step.breakpoint,
        onActivate: () => toggleBreakpoint(index),
        extraClass: 'breakpoint-button',
      });
      const removeButton = iconButton({
        name: 'trash-2',
        label: `Remove step ${number}`,
        onActivate: () => removeStep(index),
      });
      const handle = iconButton({
        name: 'grip-vertical',
        label: `Reorder step ${number}`,
        onActivate: () => undefined,
        extraClass: 'reorder-handle',
      });
      attachReorder(handle, index);
      const header = h('div', { class: 'step-header' }, [
        h('span', { class: 'step-number', text: String(number) }),
        h('span', { class: 'step-name', text: step.op }),
        stateText,
        chip,
        h('div', { class: 'step-actions' }, [
          h('label', { class: 'checkbox-row' }, [disableBox, h('span', { class: 'sr-only', text: 'Disabled' })]),
          breakpointButton,
          removeButton,
          handle,
        ]),
      ]);
      card.append(header);
      const op = findOperation(step.op)!;
      if (op.args.length > 0) {
        card.append(h('div', { class: 'step-args' }, op.args.map((spec) => argumentField(step, spec, index))));
      }
      card.addEventListener('keydown', (event) => onStepKey(event, index));
      stepList.append(card);
      stepViews.push({ card, chip, stateText });
    });
    if (state.steps.length === 0) {
      stepList.append(h('p', { class: 'muted-note', text: 'No steps yet. Add an operation to start.' }));
    }
    updateStepDecorations();
    if (focusedIndex >= 0) {
      const target = stepViews[Math.min(focusedIndex, stepViews.length - 1)];
      target?.card.focus();
    }
  }

  function updateStepDecorations(): void {
    const error = state.result?.error ?? null;
    state.steps.forEach((step, index) => {
      const view = stepViews[index];
      if (view === undefined) return;
      const isCurrent = state.pausedAt === index;
      const isError = error !== null && error.stepIndex === index;
      view.card.classList.toggle('current', isCurrent);
      view.card.classList.toggle('failed', isError);
      view.card.classList.toggle('disabled', step.disabled);
      if (isCurrent) view.card.setAttribute('aria-current', 'step');
      else view.card.removeAttribute('aria-current');
      view.stateText.textContent = isError ? 'Error' : isCurrent ? 'Current' : '';
    });
    renderSpanChips();
  }

  function onStepKey(event: KeyboardEvent, index: number): void {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveStep(index, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      removeStep(index);
      return;
    }
    if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      toggleDisabled(index);
      return;
    }
    if (event.key === 'b' || event.key === 'B') {
      event.preventDefault();
      toggleBreakpoint(index);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = index + (event.key === 'ArrowUp' ? -1 : 1);
      stepViews[next]?.card.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      recipePane.focus();
    }
  }

  function addOperation(name: string): void {
    const op = findOperation(name);
    if (op === undefined) return;
    state.steps.push({ op: op.name, args: defaultArgs(op), disabled: false, breakpoint: false });
    renderSteps();
    const card = stepViews[stepViews.length - 1]?.card;
    card?.classList.add('arriving');
    window.setTimeout(() => card?.classList.remove('arriving'), 200);
    announce(`Added ${op.name} at step ${state.steps.length}`);
    onRecipeChanged();
  }

  function removeStep(index: number): void {
    const step = state.steps[index];
    if (step === undefined) return;
    state.steps.splice(index, 1);
    renderSteps();
    announce(`Removed ${step.op} from step ${index + 1}`);
    const next = stepViews[index] ?? stepViews[index - 1];
    next?.card.focus();
    onRecipeChanged();
  }

  function moveStep(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= state.steps.length) return;
    const [step] = state.steps.splice(index, 1);
    state.steps.splice(target, 0, step!);
    renderSteps();
    stepViews[target]?.card.focus();
    announce(`Moved ${step!.op} to step ${target + 1}`);
    onRecipeChanged();
  }

  function toggleDisabled(index: number): void {
    const step = state.steps[index];
    if (step === undefined) return;
    step.disabled = !step.disabled;
    renderSteps();
    stepViews[index]?.card.focus();
    announce(`${step.disabled ? 'Disabled' : 'Enabled'} step ${index + 1}`);
    onRecipeChanged();
  }

  function toggleBreakpoint(index: number): void {
    const step = state.steps[index];
    if (step === undefined) return;
    step.breakpoint = !step.breakpoint;
    renderSteps();
    stepViews[index]?.card.focus();
    announce(`Breakpoint ${step.breakpoint ? 'set on' : 'cleared on'} step ${index + 1}`);
    onRecipeChanged();
  }

  function clearRecipe(): void {
    state.steps = [];
    renderSteps();
    announce('Recipe cleared');
    onRecipeChanged();
  }

  /** Pointer events cover both the mouse drag and the touch drag of a reorder handle. */
  function attachReorder(handle: HTMLElement, index: number): void {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const card = handle.closest('.step-card') as HTMLElement | null;
      if (card === null) return;
      handle.setPointerCapture(event.pointerId);
      let from = index;
      let startY = event.clientY;
      let moved = false;
      const onMove = (moveEvent: PointerEvent): void => {
        const height = card.getBoundingClientRect().height;
        const delta = moveEvent.clientY - startY;
        if (Math.abs(delta) < height / 2) return;
        const direction = delta > 0 ? 1 : -1;
        const target = from + direction;
        if (target < 0 || target >= state.steps.length) return;
        const neighbour = [...stepList.children][target] as HTMLElement | undefined;
        if (neighbour === undefined) return;
        const [step] = state.steps.splice(from, 1);
        state.steps.splice(target, 0, step!);
        // The dragged card itself moves, so the handle keeps its pointer capture.
        stepList.insertBefore(card, direction > 0 ? neighbour.nextSibling : neighbour);
        from = target;
        startY = moveEvent.clientY;
        moved = true;
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('touchend', onUp);
        if (!moved) return;
        const step = state.steps[from]!;
        renderSteps();
        announce(`Moved ${step.op} to step ${from + 1}`);
        onRecipeChanged();
        stepViews[from]?.card.focus();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      window.addEventListener('touchend', onUp);
    });
  }

  function openOperationSheet(): void {
    const modal = openModal({ title: 'Add operation', opener: addOperationButton, sheet: true });
    const search = h('input', {
      type: 'search',
      class: 'finder',
      'aria-label': 'Search operations',
      placeholder: 'Search operations',
      autocomplete: 'off',
    });
    const list = h('div', { class: 'listbox', role: 'listbox', 'aria-label': 'Operation sheet', tabindex: '0' });
    const fill = (): void => {
      clear(list);
      const needle = search.value.trim().toLowerCase();
      for (const op of operations) {
        if (needle !== '' && !op.name.toLowerCase().includes(needle)) continue;
        const option = h('div', { class: 'op-row', role: 'option', 'aria-selected': 'false', text: op.name });
        option.addEventListener('click', () => {
          addOperation(op.name);
          modal.close();
        });
        list.append(option);
      }
    };
    search.addEventListener('input', fill);
    fill();
    modal.body.append(
      h('div', { class: 'finder-wrap' }, [icon('search'), search]),
      list,
      dialogActions([plainButton('Close', () => modal.close())]),
    );
    search.focus();
  }

  // ------------------------------------------------------------ editor panes
  const inputsTablist = h('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Inputs' });
  const newInputButton = iconButton({ name: 'plus', label: 'New input', onActivate: () => addInputTab() });
  inputsTabRow.append(inputsTablist, newInputButton);

  const filePicker = h('input', { type: 'file', class: 'sr-only', tabindex: '-1' });
  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (file !== undefined) void handleFile(file);
    filePicker.value = '';
  });
  const openFileButton = iconButton({
    name: 'folder-open',
    label: 'Open file',
    onActivate: () => {
      if (!requireSignIn()) return;
      filePicker.click();
    },
  });
  const clearInputButton = iconButton({ name: 'eraser', label: 'Clear input', onActivate: () => clearInput() });
  const encodingSelect = h('select', { class: 'select', 'aria-label': 'Input encoding' });
  for (const name of ['UTF-8', 'UTF-16LE', 'ISO-8859-1']) {
    encodingSelect.append(h('option', { value: name, text: name }));
  }
  encodingSelect.addEventListener('change', () => {
    tab().encoding = encodingSelect.value as TextEncodingName;
    if (tab().file !== null) syncInputFromState();
    onInputChanged();
  });
  const inputArea = h('textarea', {
    class: 'editor mono',
    'aria-label': 'Input',
    spellcheck: 'false',
    wrap: 'soft',
  });
  const inputAlert = h('div', { class: 'pane-alert', role: 'alert', hidden: true });
  const suggestionButton = plainButton('', () => {
    const name = suggestionButton.dataset['op'];
    if (name !== undefined) addOperation(name);
  });
  suggestionButton.classList.add('suggestion');
  suggestionButton.hidden = true;
  const inputStatus = h('div', {
    class: 'status-strip',
    role: 'status',
    'aria-live': 'off',
    'aria-label': 'Input status',
  });
  inputPane.append(
    h('div', { class: 'pane-title' }, [
      h('h2', { class: 'pane-title-text', text: 'Input' }),
      h('div', { class: 'pane-title-actions' }, [openFileButton, clearInputButton, encodingSelect]),
    ]),
    inputAlert,
    h('div', { class: 'editor-wrap' }, [inputArea]),
    suggestionButton,
    inputStatus,
    filePicker,
  );

  const outputViewSelect = h('select', { class: 'select', 'aria-label': 'Output view' });
  for (const name of ['Text', 'Hex']) outputViewSelect.append(h('option', { value: name, text: name }));
  outputViewSelect.value = state.outputView;
  outputViewSelect.addEventListener('change', () => {
    state.outputView = outputViewSelect.value as 'Text' | 'Hex';
    storeState(state);
    renderOutput();
  });
  const outputNotices = h('div', { class: 'notices' });
  const outputMirror = h('div', { class: 'editor-mirror mono', 'aria-hidden': 'true' });
  const outputArea = h('textarea', {
    class: 'editor mono output-editor',
    'aria-label': 'Output',
    readonly: true,
    spellcheck: 'false',
    wrap: 'soft',
  });
  outputArea.addEventListener('scroll', () => {
    outputMirror.scrollTop = outputArea.scrollTop;
    outputMirror.scrollLeft = outputArea.scrollLeft;
  });
  const downloadButton = iconButton({
    name: 'download',
    label: 'Download output',
    onActivate: () => downloadOutput(),
    extraClass: 'download-button',
  });
  const outputStatus = h('div', {
    class: 'status-strip',
    role: 'status',
    'aria-live': 'off',
    'aria-label': 'Output status',
  });
  const outputWrap = h('div', { class: 'editor-wrap' }, [outputMirror, outputArea]);
  outputPane.append(
    h('div', { class: 'pane-title' }, [
      h('h2', { class: 'pane-title-text', text: 'Output' }),
      h('div', { class: 'pane-title-actions' }, [outputViewSelect]),
    ]),
    outputNotices,
    outputWrap,
    downloadButton,
    outputStatus,
  );
  let shownOutput = '';

  /** New output crossfades into place. */
  function showOutputText(text: string): void {
    outputArea.value = text;
    outputArea.textContent = text;
    if (text === shownOutput) return;
    shownOutput = text;
    outputWrap.classList.remove('changed');
    void outputWrap.offsetWidth;
    outputWrap.classList.add('changed');
  }

  function renderInputTabs(): void {
    clear(inputsTablist);
    state.tabs.forEach((_entry, index) => {
      const selected = index === state.selectedTab;
      const button = h('button', {
        type: 'button',
        class: 'tab',
        role: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        tabindex: selected ? '0' : '-1',
        text: `Input ${index + 1}`,
      });
      button.addEventListener('click', () => selectTab(index));
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
        if (next < 0 || next >= state.tabs.length) return;
        selectTab(next);
        const tabs = inputsTablist.querySelectorAll<HTMLElement>('[role="tab"]');
        tabs[next]?.focus();
      });
      inputsTablist.append(button);
    });
    newInputButton.disabled = state.tabs.length >= MAX_TABS;
  }

  function selectTab(index: number): void {
    state.selectedTab = index;
    syncInputFromState();
    renderInputTabs();
    onInputChanged();
  }

  function addInputTab(): void {
    if (state.tabs.length >= MAX_TABS) return;
    state.tabs.push(newTab());
    selectTab(state.tabs.length - 1);
  }

  function syncInputFromState(): void {
    const current = tab();
    inputArea.value = current.text;
    inputArea.textContent = current.text;
    lastInputValue = current.text;
    encodingSelect.value = current.encoding;
    const isFile = current.file !== null;
    inputArea.readOnly = isFile;
    inputArea.classList.toggle('file-mode', isFile);
    if (isFile && current.fileBytes !== null) {
      const shown = decodeLossyIn(current.fileBytes, current.encoding);
      inputArea.value = shown;
      inputArea.textContent = shown;
    }
    if (current.selection !== null) {
      inputArea.setSelectionRange(current.selection.start, current.selection.end);
    }
  }

  function clearInput(): void {
    const current = tab();
    current.file = null;
    current.fileBytes = null;
    current.text = '';
    current.selection = null;
    syncInputFromState();
    setInputAlert(null);
    onInputChanged();
  }

  function setInputAlert(message: string | null, sticky = false): void {
    inputAlertSticky = sticky && message !== null;
    inputAlert.textContent = message ?? '';
    inputAlert.toggleAttribute('hidden', message === null);
  }

  function requireSignIn(): boolean {
    if (options.session !== null) return true;
    topAlert.textContent = 'Sign in to save recipes, open files or share snapshots.';
    topAlert.hidden = false;
    return false;
  }

  async function handleFile(file: File): Promise<void> {
    if (!requireSignIn()) return;
    if (file.size > config.fileMaxBytes) {
      setInputAlert(`File too large: ${file.size} bytes (limit ${config.fileMaxBytes} bytes).`, true);
      return;
    }
    setInputAlert(`Uploading ${file.name}…`, true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const stored = await uploadFile(file.name, bytes);
      const current = tab();
      current.file = { id: stored.file.id, name: stored.file.name };
      current.fileBytes = bytes;
      current.text = '';
      current.selection = null;
      setInputAlert(null);
      syncInputFromState();
      onInputChanged();
    } catch (cause) {
      const message = cause instanceof ApiCallError ? cause.failure.message : 'The file was not saved.';
      setInputAlert(message, true);
    }
  }

  inputPane.addEventListener('dragover', (event) => {
    event.preventDefault();
    inputPane.classList.add('dropping');
  });
  inputPane.addEventListener('dragleave', () => inputPane.classList.remove('dropping'));
  inputPane.addEventListener('drop', (event) => {
    event.preventDefault();
    inputPane.classList.remove('dropping');
    const file = event.dataTransfer?.files?.[0];
    if (file !== undefined) void handleFile(file);
  });

  inputArea.addEventListener('input', () => {
    const next = inputArea.value;
    const size = fromText(next).length;
    const current = tab();
    if (tabBytesLength(next, current.encoding) > config.inputMaxBytes) {
      inputArea.value = lastInputValue;
      setInputAlert(`Input too large: ${size} bytes (limit ${config.inputMaxBytes} bytes).`, true);
      return;
    }
    lastInputValue = next;
    current.text = next;
    if (!inputAlertSticky) setInputAlert(null);
    onInputChanged();
  });

  function tabBytesLength(text: string, encoding: TextEncodingName): number {
    try {
      return tabBytes({ text, encoding, file: null, fileBytes: null, selection: null }).bytes?.length ?? 0;
    } catch {
      return 0;
    }
  }

  const trackSelection = (): void => {
    const current = tab();
    if (current.file !== null) return;
    const start = inputArea.selectionStart;
    const end = inputArea.selectionEnd;
    const changed =
      current.selection === null ? start !== end : current.selection.start !== start || current.selection.end !== end;
    current.selection = start === end ? null : { start, end };
    if (changed) window.requestAnimationFrame(() => onSelectionChanged());
  };
  for (const name of ['keyup', 'mouseup', 'select', 'click', 'selectionchange'] as const) {
    inputArea.addEventListener(name, trackSelection);
  }

  function selectedRange(): SpanRange | null {
    const current = tab();
    if (current.file !== null || current.selection === null) return null;
    const before = tabBytes({ ...current, text: current.text.slice(0, current.selection.start), selection: null });
    const inside = tabBytes({
      ...current,
      text: current.text.slice(current.selection.start, current.selection.end),
      selection: null,
    });
    if (before.bytes === null || inside.bytes === null || inside.bytes.length === 0) return null;
    return { start: before.bytes.length, end: before.bytes.length + inside.bytes.length };
  }

  function spanWalkNow(): ReturnType<typeof walkSpan> | null {
    const result = state.result;
    const range = selectedRange();
    if (result === null || range === null) return null;
    const bytes = tabBytes(tab()).bytes;
    if (bytes === null) return null;
    const limit = state.pausedAt;
    return walkSpan(state.steps, result, bytes.length, range, limit);
  }

  function renderSpanChips(): void {
    const walk = spanWalkNow();
    state.steps.forEach((_step, index) => {
      const view = stepViews[index];
      if (view === undefined) return;
      const chip = walk?.chips.get(index);
      view.chip.textContent = chip ?? '';
      view.chip.toggleAttribute('hidden', chip === undefined);
      view.chip.classList.toggle('lost', chip === 'span lost');
    });
  }

  function onSelectionChanged(): void {
    renderSpanChips();
    renderOutput();
    const walk = spanWalkNow();
    if (walk === null) return;
    if (walk.lostAt !== null) {
      announce(`Span lost at step ${walk.lostAt + 1}`);
      return;
    }
    if (walk.finalRange !== null && walk.lastStep !== null) {
      announce(
        `Span maps to characters ${walk.finalRange.start} to ${walk.finalRange.end - 1} at step ${walk.lastStep + 1}`,
      );
    }
  }

  function renderInputStatus(): void {
    const current = tab();
    const outcome = tabBytes(current);
    if (outcome.bytes === null) {
      inputStatus.textContent = 'Not encodable';
      if (outcome.error !== null) setInputAlert(outcome.error, true);
      suggestionButton.hidden = true;
      return;
    }
    inputStatus.textContent = byteLineStatus(outcome.bytes.length, countLines(outcome.bytes));
    const suggestion = suggestOperation(outcome.bytes);
    if (suggestion === null) {
      suggestionButton.hidden = true;
      delete suggestionButton.dataset['op'];
    } else {
      suggestionButton.hidden = false;
      suggestionButton.textContent = `Suggested: ${suggestion}`;
      suggestionButton.dataset['op'] = suggestion;
    }
  }

  function renderOutput(): void {
    const result = state.result;
    clear(outputNotices);
    if (result === null) {
      showOutputText('');
      outputStatus.textContent = '';
      outputMirror.textContent = '';
      return;
    }
    if (result.error !== null) {
      const line = errorLine(result.error);
      showOutputText(line);
      outputMirror.textContent = line;
      outputStatus.textContent = 'No output';
      return;
    }
    const walk = spanWalkNow();
    const span = walk?.finalRange ?? null;
    const view = outputView(result.output, state.outputView, config.outputDisplayBytes, span);
    showOutputText(view.text);
    for (const notice of view.notices) outputNotices.append(h('p', { class: 'notice-line', text: notice }));
    const suffix =
      span === null ? '' : ` · Selection maps to characters ${span.start}\u2013${span.end - 1}`;
    outputStatus.textContent = `${view.status}${suffix}`;
    clear(outputMirror);
    if (view.tint === null) {
      outputMirror.textContent = view.text;
    } else {
      outputMirror.append(
        document.createTextNode(view.text.slice(0, view.tint.start)),
        h('span', { class: 'tint', text: view.text.slice(view.tint.start, view.tint.end) }),
        document.createTextNode(view.text.slice(view.tint.end)),
      );
    }
  }

  function downloadOutput(): void {
    const result = state.result;
    if (result === null || result.error !== null) return;
    const valid = new TextDecoder('utf-8', { fatal: true });
    let name = 'output.bin';
    try {
      valid.decode(result.output);
      name = 'output.txt';
    } catch {
      name = 'output.bin';
    }
    downloadBytes(result.output, name);
  }

  // --------------------------------------------------------------- baking
  function renderRunFooter(): void {
    const paused = state.pausedAt !== null;
    bakeLabel.textContent = paused ? 'Resume' : 'Bake';
    bakeButton.setAttribute('aria-label', paused ? 'Resume' : 'Bake');
    const result = state.result;
    if (result === null) {
      bakeStatus.textContent = '';
      return;
    }
    if (result.error !== null) {
      bakeStatus.textContent = `Stopped at step ${result.error.stepIndex + 1}`;
      return;
    }
    if (result.pausedAt !== null) {
      bakeStatus.textContent = `Paused at step ${result.pausedAt + 1}`;
      return;
    }
    bakeStatus.textContent = `Baked in ${result.runtimeMs} ms`;
  }

  function renderRecipeLine(): void {
    const recipe = state.recipe;
    const base = recipe === null ? 'Unsaved recipe' : `${recipe.name} · version ${recipe.version}`;
    recipeLineText.textContent = state.edited ? `${base} · edited` : base;
  }

  function cancelPending(): void {
    if (bakeTimer !== null) {
      window.clearTimeout(bakeTimer);
      bakeTimer = null;
    }
    baker.cancel();
    stopSpinner();
    state.pausedAt = null;
  }

  function scheduleBake(): void {
    if (!state.autoBake) {
      renderRunFooter();
      return;
    }
    bakeTimer = window.setTimeout(() => {
      bakeTimer = null;
      void runBake(firstBreakpoint(state.steps));
    }, config.autobakeMs);
  }

  function onRecipeChanged(): void {
    state.edited = state.recipe !== null;
    recipeLinkRow.hidden = true;
    renderRecipeLine();
    storeState(state);
    cancelPending();
    updateStepDecorations();
    renderRunFooter();
    scheduleBake();
  }

  function onInputChanged(): void {
    recipeLinkRow.hidden = true;
    storeState(state);
    cancelPending();
    renderInputStatus();
    renderSpanChips();
    renderRunFooter();
    scheduleBake();
  }

  function startSpinner(): void {
    spinnerTimer = window.setTimeout(() => {
      bakeButton.setAttribute('aria-busy', 'true');
      bakeButton.classList.add('busy');
    }, 250);
  }

  function stopSpinner(): void {
    if (spinnerTimer !== null) {
      window.clearTimeout(spinnerTimer);
      spinnerTimer = null;
    }
    bakeButton.removeAttribute('aria-busy');
    bakeButton.classList.remove('busy');
  }

  async function runBake(stopBefore: number | null): Promise<void> {
    const outcome = tabBytes(tab());
    if (outcome.bytes === null) {
      renderInputStatus();
      return;
    }
    startSpinner();
    const result = await baker.run(outcome.bytes, state.steps, stopBefore);
    stopSpinner();
    if (result === null) return;
    state.result = result;
    state.pausedAt = result.pausedAt;
    renderOutput();
    updateStepDecorations();
    renderRunFooter();
    if (result.error !== null) return;
    if (result.pausedAt !== null) announce(`Paused at step ${result.pausedAt + 1}`);
    else announce('Output updated');
  }

  async function bakeNow(): Promise<void> {
    if (bakeTimer !== null) {
      window.clearTimeout(bakeTimer);
      bakeTimer = null;
    }
    if (state.pausedAt !== null) {
      const resumeFrom = state.pausedAt;
      await runBake(firstBreakpoint(state.steps, resumeFrom));
      return;
    }
    await runBake(firstBreakpoint(state.steps));
  }

  async function stepOnce(): Promise<void> {
    if (bakeTimer !== null) {
      window.clearTimeout(bakeTimer);
      bakeTimer = null;
    }
    const enabled = enabledIndices(state.steps);
    if (enabled.length === 0) {
      await runBake(null);
      return;
    }
    if (state.pausedAt !== null) {
      await runBake(nextEnabled(state.steps, state.pausedAt));
      return;
    }
    await runBake(enabled[1] ?? null);
  }

  // --------------------------------------------------------------- sharing
  function copyRecipeLink(): void {
    const outcome = tabBytes(tab());
    const link = `${window.location.origin}${buildRecipeLink(state.steps, outcome.bytes ?? new Uint8Array())}`;
    recipeLinkField.value = link;
    recipeLinkRow.hidden = false;
    void navigator.clipboard?.writeText(link).catch(() => undefined);
    announce('Link copied');
  }

  function ownerChoices(): { value: string; label: string }[] {
    const choices = [{ value: 'user', label: 'Personal' }];
    for (const team of options.session?.teams ?? []) choices.push({ value: `team:${team.id}`, label: team.name });
    return choices;
  }

  function openSaveDialog(): void {
    if (!requireSignIn()) return;
    const modal = openModal({ title: 'Save recipe', opener: saveButton });
    const nameField = h('input', {
      type: 'text',
      class: 'text-input',
      'aria-label': 'Recipe name',
      '.value': state.recipe?.name ?? '',
    });
    const noteField = h('input', { type: 'text', class: 'text-input', 'aria-label': 'Version note' });
    const tagsField = h('input', {
      type: 'text',
      class: 'text-input',
      'aria-label': 'Tags',
      '.value': (state.recipe?.tags ?? []).join(', '),
    });
    const ownerSelect = h('select', { class: 'select', 'aria-label': 'Save to' });
    for (const choice of ownerChoices()) {
      ownerSelect.append(h('option', { value: choice.value, text: choice.label }));
    }
    const rows = h('div', { class: 'field-rows' }, [
      h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'Recipe name' }), nameField, fieldError('name')]),
      h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'Version note' }), noteField, fieldError('note')]),
      h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'Tags' }), tagsField, fieldError('tags')]),
    ]);
    if (state.recipe === null) {
      rows.append(h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'Save to' }), ownerSelect]));
    }
    const saveVersionButton = primaryButton('Save version', () => undefined);
    saveVersionButton.addEventListener(
      'click',
      withBusy(saveVersionButton, async () => {
        const tags = parseTagList(tagsField.value);
        try {
          if (state.recipe === null) {
            const choice = ownerSelect.value;
            const owner =
              choice === 'user'
                ? { type: 'user', id: options.session!.user.id }
                : { type: 'team', id: choice.slice('team:'.length) };
            const created = await api.createRecipe({
              name: nameField.value,
              owner,
              tags,
              note: noteField.value,
              steps: state.steps,
            });
            adoptSaved(created.recipe, created.version);
          } else {
            const saved = await api.saveVersion(state.recipe.id, {
              baseVersion: state.recipe.version,
              name: nameField.value,
              note: noteField.value,
              tags,
              steps: state.steps,
            });
            adoptSaved(saved.recipe, saved.version);
          }
          modal.close();
        } catch (cause) {
          if (!(cause instanceof ApiCallError)) throw cause;
          if (cause.failure.code === 'version_conflict') {
            modal.close();
            openStaleDialog(cause.failure.message);
            return;
          }
          if (cause.failure.code === 'validation_failed') {
            showFieldErrors(rows, cause.fields());
            return;
          }
          showFieldErrors(rows, { name: cause.failure.message });
        }
      }),
    );
    modal.body.append(rows, dialogActions([saveVersionButton, plainButton('Cancel', () => modal.close())]));
    nameField.focus();
  }

  function adoptSaved(summary: RecipeSummary, version: VersionBody): void {
    state.recipe = {
      id: summary.id,
      name: version.name,
      version: version.n,
      tags: version.tags,
      note: version.note,
      ownerType: summary.owner.type,
      ownerId: summary.owner.id,
    };
    state.edited = false;
    justSavedVersion = version.n;
    updateBanner.hidden = true;
    renderRecipeLine();
    storeState(state);
    announce(`Recipe saved as version ${version.n}`);
  }

  function openStaleDialog(message: string): void {
    const modal = openModal({
      title: 'This recipe changed',
      opener: saveButton,
      onEscape: () => modal.close(),
    });
    const loadLatest = primaryButton('Load latest', () => {
      modal.close();
      void loadLatestVersion();
    });
    const saveCopy = plainButton('Save as copy', () => {
      modal.close();
      void saveAsCopy();
    });
    modal.body.append(
      h('p', { class: 'dialog-text', text: message }),
      dialogActions([loadLatest, saveCopy, plainButton('Cancel', () => modal.close())]),
    );
    loadLatest.focus();
  }

  async function saveAsCopy(): Promise<void> {
    const recipe = state.recipe;
    if (recipe === null) return;
    const created = await api.createRecipe({
      name: `${recipe.name} (copy)`,
      owner: { type: recipe.ownerType, id: recipe.ownerId },
      tags: recipe.tags,
      note: recipe.note,
      steps: state.steps,
    });
    adoptSaved(created.recipe, created.version);
  }

  async function loadLatestVersion(): Promise<void> {
    const recipe = state.recipe;
    if (recipe === null) return;
    const head = await api.recipe(recipe.id);
    const version = await api.version(recipe.id, head.recipe.latestVersion);
    state.steps = version.version.steps;
    state.recipe = {
      id: recipe.id,
      name: version.version.name,
      version: version.version.n,
      tags: version.version.tags,
      note: version.version.note,
      ownerType: head.recipe.owner.type,
      ownerId: head.recipe.owner.id,
    };
    state.edited = false;
    updateBanner.hidden = true;
    renderSteps();
    renderRecipeLine();
    storeState(state);
    cancelPending();
    void runBake(firstBreakpoint(state.steps));
  }

  function snapshotSentence(snapshot: SnapshotBody): string {
    if (snapshot.status === 'pending') return 'Pending: storage has not confirmed the input yet.';
    if (snapshot.status === 'active') return `Active until ${formatStamp(snapshot.expiresAt)}.`;
    if (snapshot.status === 'expired') return `This snapshot expired on ${formatStamp(snapshot.expiresAt)}.`;
    return 'This snapshot was revoked.';
  }

  function badgeFor(status: SnapshotBody['status']): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function openSnapshotDialog(): void {
    if (!requireSignIn()) return;
    const modal = openModal({ title: 'Share snapshot', opener: shareButton });
    const group = h('div', { class: 'radio-group', role: 'radiogroup', 'aria-label': 'Expires after' });
    const choices = config.shareTtlChoices;
    choices.forEach((code, index) => {
      const label = parseTtl(code)?.label ?? code;
      const radio = h('input', { type: 'radio', name: 'snapshot-ttl', value: code, '.checked': index === 0 });
      radio.setAttribute('aria-label', label);
      group.append(h('label', { class: 'checkbox-row' }, [radio, h('span', { text: label })]));
    });
    const status = h('div', {
      class: 'snapshot-status',
      role: 'status',
      'aria-live': 'off',
      'aria-label': 'Snapshot status',
    });
    const linkField = h('input', { type: 'text', class: 'link-field', 'aria-label': 'Snapshot link', readonly: true });
    const copyLink = plainButton('Copy snapshot link', () => {
      void navigator.clipboard?.writeText(linkField.value).catch(() => undefined);
    });
    const linkRow = h('div', { class: 'link-row', hidden: true }, [linkField, copyLink]);
    const createButton = primaryButton('Create snapshot', () => undefined);
    let poll: number | null = null;

    const show = (snapshot: SnapshotBody): void => {
      clear(status);
      status.append(
        h('span', { class: `badge badge-${snapshot.status}`, text: badgeFor(snapshot.status) }),
        document.createTextNode(` ${snapshotSentence(snapshot)}`),
      );
      const active = snapshot.status === 'active';
      linkRow.hidden = !active;
      if (active) linkField.value = `${window.location.origin}${snapshot.url}`;
    };

    createButton.addEventListener(
      'click',
      withBusy(createButton, async () => {
        const ttl = group.querySelector<HTMLInputElement>('input:checked')?.value ?? choices[0]!;
        const current = tab();
        const outcome = tabBytes(current);
        const result = state.result;
        try {
          const created = await api.createSnapshot({
            steps: state.steps,
            recipe: state.recipe === null ? null : { id: state.recipe.id, version: state.recipe.version },
            ...(current.file !== null && current.file.id !== ''
              ? { fileId: current.file.id }
              : { inputBase64: toBase64(outcome.bytes ?? new Uint8Array()) }),
            outputBase64: toBase64(result?.error === null ? result.output : new Uint8Array()),
            ttl,
          });
          show(created.snapshot);
          if (created.snapshot.status === 'pending') {
            poll = window.setInterval(async () => {
              const probe = await api.snapshot(created.snapshot.token);
              show(probe.snapshot);
              if (probe.snapshot.status !== 'pending' && poll !== null) {
                window.clearInterval(poll);
                poll = null;
              }
            }, 1000);
          }
        } catch (cause) {
          if (!(cause instanceof ApiCallError)) throw cause;
          clear(status);
          status.textContent = cause.failure.message;
        }
      }),
    );

    modal.body.append(
      group,
      dialogActions([createButton]),
      status,
      linkRow,
      dialogActions([
        plainButton('Close', () => {
          if (poll !== null) window.clearInterval(poll);
          modal.close();
        }),
      ]),
    );
    group.querySelector<HTMLInputElement>('input')?.focus();
  }

  // ------------------------------------------------------------- separators
  function applySplits(): void {
    grid.style.setProperty('--split-a', `${state.splitA}%`);
    grid.style.setProperty('--split-mid', `${state.splitB - state.splitA}%`);
    grid.style.setProperty('--split-rest', `${100 - state.splitB}%`);
    editorColumn.style.setProperty('--split-c', `${state.splitC}%`);
    editorColumn.style.setProperty('--split-c-rest', `${100 - state.splitC}%`);
    for (const update of separatorUpdaters) update();
  }

  function createSeparator(spec: {
    name: string;
    orientation: 'vertical' | 'horizontal';
    get: () => number;
    set: (value: number) => void;
    min: () => number;
    max: () => number;
  }): HTMLElement {
    const element = h('div', {
      class: `gutter gutter-${spec.orientation}`,
      role: 'separator',
      tabindex: '0',
      'aria-label': spec.name,
      'aria-orientation': spec.orientation,
    });
    const clamp = (value: number): number => Math.round(Math.min(spec.max(), Math.max(spec.min(), value)));
    const update = (): void => {
      element.setAttribute('aria-valuenow', String(Math.round(spec.get())));
      element.setAttribute('aria-valuemin', String(Math.round(spec.min())));
      element.setAttribute('aria-valuemax', String(Math.round(spec.max())));
    };
    separatorUpdaters.push(update);
    const forward = spec.orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const backward = spec.orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    element.addEventListener('keydown', (event) => {
      let next: number | null = null;
      if (event.key === forward) next = spec.get() + (event.shiftKey ? 10 : 2);
      else if (event.key === backward) next = spec.get() - (event.shiftKey ? 10 : 2);
      else if (event.key === 'Home') next = spec.min();
      else if (event.key === 'End') next = spec.max();
      if (next === null) return;
      event.preventDefault();
      spec.set(clamp(next));
    });
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent): void => {
        if (spec.orientation === 'vertical') {
          spec.set(clamp((moveEvent.clientX / window.innerWidth) * 100));
        } else {
          const rect = editorColumn.getBoundingClientRect();
          spec.set(clamp(((moveEvent.clientY - rect.top) / rect.height) * 100));
        }
      };
      const onUp = (): void => {
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', onUp);
      };
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', onUp);
    });
    element.addEventListener('dblclick', () => {
      state.splitA = 20;
      state.splitB = 50;
      state.splitC = 50;
      applySplits();
    });
    return element;
  }

  // ------------------------------------------------------------ phone layout
  function renderPaneTabs(): void {
    clear(paneTabs);
    for (const [name, pane] of panels) {
      const slot = pane.closest('.pane-slot') as HTMLElement;
      const selected = name === phoneTab;
      const button = h('button', {
        type: 'button',
        class: 'pane-tab',
        role: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        tabindex: selected ? '0' : '-1',
        text: name,
      });
      button.addEventListener('click', () => {
        phoneTab = name;
        renderPaneTabs();
      });
      paneTabs.append(button);
      if (isPhoneLayout()) {
        slot.setAttribute('role', 'tabpanel');
        slot.setAttribute('aria-label', name);
        slot.toggleAttribute('hidden', !selected);
        slot.toggleAttribute('inert', !selected);
      } else {
        slot.removeAttribute('role');
        slot.removeAttribute('aria-label');
        slot.removeAttribute('hidden');
        slot.removeAttribute('inert');
      }
    }
  }

  window.addEventListener('resize', () => renderPaneTabs());

  // --------------------------------------------------------------- shortcuts
  function isTextField(element: Element | null): boolean {
    if (element === null) return false;
    const tag = element.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.hasAttribute('contenteditable');
  }

  document.addEventListener('keydown', (event) => {
    if (document.querySelector('.backdrop') !== null) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void bakeNow();
      return;
    }
    if (event.key === 'F8') {
      event.preventDefault();
      void stepOnce();
      return;
    }
    if (event.ctrlKey && event.altKey && (event.key === 'n' || event.key === 'N')) {
      event.preventDefault();
      addInputTab();
      return;
    }
    if (event.key === '/' && !isTextField(document.activeElement)) {
      event.preventDefault();
      if (isPhoneLayout()) {
        phoneTab = 'Operations';
        renderPaneTabs();
      }
      finder.focus();
      return;
    }
    if (event.key === 'Escape' && isTextField(document.activeElement)) {
      const region = (document.activeElement as HTMLElement).closest('[role="region"]') as HTMLElement | null;
      if (region !== null) {
        event.preventDefault();
        region.focus();
      }
    }
  });

  // ------------------------------------------------------------ live updates
  let justSavedVersion = 0;

  function showUpdateBanner(authorName: string): void {
    updateBannerText.textContent = `Recipe updated by ${authorName}`;
    updateBanner.hidden = false;
    announce(`Recipe updated by ${authorName}`);
  }

  const handle: WorkbenchHandle = {
    onLiveEvent(event) {
      if (event.type !== 'version_saved') return;
      const recipe = state.recipe;
      if (recipe === null || event.recipeId !== recipe.id) return;
      if (event.version === justSavedVersion || event.version <= recipe.version) return;
      showUpdateBanner(event.authorName);
    },
    onReconnect() {
      const recipe = state.recipe;
      if (recipe === null) return;
      void api.recipe(recipe.id).then(async (head) => {
        if (head.recipe.latestVersion <= recipe.version) return;
        const newest = await api.version(recipe.id, head.recipe.latestVersion);
        showUpdateBanner(newest.version.author.displayName);
      });
    },
  };

  // ---------------------------------------------------------------- start up
  function applyLink(): 'recipe' | 'input' | null {
    const hash = window.location.hash;
    if (!hash.includes('r=')) return null;
    const parsed = parseRecipeLink(hash);
    if (parsed === 'recipe' || parsed === 'input') {
      state.steps = [];
      state.tabs = [newTab()];
      state.selectedTab = 0;
      state.recipe = null;
      return parsed;
    }
    state.steps = parsed.steps;
    state.recipe = null;
    state.edited = false;
    const bytes = parsed.input;
    const valid = (() => {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    })();
    state.tabs = [newTab()];
    state.selectedTab = 0;
    if (valid) state.tabs[0]!.text = decodeLossy(bytes);
    else {
      state.tabs[0]!.file = { id: '', name: 'input.bin' };
      state.tabs[0]!.fileBytes = bytes;
    }
    return null;
  }

  async function loadRequestedRecipe(request: { id: string; version: number | null }): Promise<void> {
    try {
      const head = await api.recipe(request.id);
      const wanted = request.version ?? head.recipe.latestVersion;
      const version = await api.version(request.id, wanted);
      state.steps = version.version.steps;
      state.recipe = {
        id: head.recipe.id,
        name: version.version.name,
        version: version.version.n,
        tags: version.version.tags,
        note: version.version.note,
        ownerType: head.recipe.owner.type,
        ownerId: head.recipe.owner.id,
      };
      state.edited = false;
      void api.opened(request.id).catch(() => undefined);
      renderSteps();
      renderRecipeLine();
      storeState(state);
      void runBake(firstBreakpoint(state.steps));
    } catch (cause) {
      if (cause instanceof ApiCallError) {
        topAlert.textContent = cause.failure.message;
        topAlert.hidden = false;
      }
    }
  }

  const damaged = applyLink();
  if (damaged !== null) {
    topAlert.textContent =
      damaged === 'recipe'
        ? 'This link is damaged: the recipe part is not valid.'
        : 'This link is damaged: the input part is not valid.';
    topAlert.hidden = false;
  }

  applySplits();
  renderOperations();
  renderSteps();
  renderInputTabs();
  syncInputFromState();
  renderInputStatus();
  renderRecipeLine();
  renderRunFooter();
  renderPaneTabs();
  storeState(state);

  if (options.recipeRequest !== null) void loadRequestedRecipe(options.recipeRequest);
  else void runBake(firstBreakpoint(state.steps));

  return handle;
}
