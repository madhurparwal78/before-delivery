import type { Board, BoardSummary, Pin, TagCount } from '../../shared/types.js';
import { counterText, overLimit } from '../../shared/copy.js';
import { codePoints, tagFragmentAt } from '../../shared/text.js';
import {
  ApiFailure,
  announce,
  api,
  busy,
  clear,
  el,
  failureMessage,
  navigate,
  showAlert,
  state,
} from '../core.js';
import { clearFieldErrors, fieldError, labelledField } from '../dialogs.js';
import type { RouteContext, View } from '../view.js';

function magicFormat(bytes: Uint8Array): 'png' | 'jpeg' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return null;
}

export function composerView({ main, url }: RouteContext): View {
  main.className = 'page composer-page';
  clear(main);

  const well = el('div', { class: 'image-well' });
  const fields = el('div', { class: 'composer-fields' });
  main.append(el('h1', { class: 'page-title', text: 'Create' }), well, fields);

  const fileInput = el('input', { type: 'file', 'aria-label': 'Image', accept: 'image/png,image/jpeg', class: 'file-input' });
  const chooseButton = el('button', { type: 'button', class: 'secondary', text: 'Choose image' });
  chooseButton.addEventListener('click', () => fileInput.click());
  const preview = el('img', { class: 'preview', alt: '' });
  preview.hidden = true;
  const outage = el('div', { class: 'banner', hidden: true });
  well.append(chooseButton, fileInput, preview, outage);

  const title = el('input', { type: 'text', 'aria-label': 'Title' });
  const titleCounter = el('p', {
    class: 'counter',
    text: counterText(0, state.config.limits.title_max),
  });
  const description = el('textarea', { 'aria-label': 'Description', rows: '3' });
  description.setAttribute('aria-expanded', 'false');
  const descriptionCounter = el('p', {
    class: 'counter',
    text: counterText(0, state.config.limits.description_max),
  });
  const alt = el('input', { type: 'text', 'aria-label': 'Alt text' });
  const source = el('input', { type: 'text', 'aria-label': 'Source link' });
  const boardSelect = el('select', { 'aria-label': 'Board' });
  const sectionSelect = el('select', { 'aria-label': 'Section' });
  const publish = el('button', { type: 'button', class: 'primary', text: 'Publish' });
  const suggestions = el('div', {
    class: 'listbox suggestions',
    role: 'listbox',
    'aria-label': 'Tag suggestions',
  });
  suggestions.hidden = true;

  const counterFor = (
    input: HTMLInputElement | HTMLTextAreaElement,
    node: HTMLElement,
    max: number,
  ): void => {
    const used = codePoints(input.value);
    node.textContent = used > max ? overLimit(used, max) : counterText(used, max);
    node.classList.toggle('over', used > max);
    updatePublishState();
  };

  const overLimits = (): boolean =>
    codePoints(title.value) > state.config.limits.title_max ||
    codePoints(description.value) > state.config.limits.description_max ||
    codePoints(alt.value) > 500;

  function updatePublishState(): void {
    publish.disabled = overLimits();
  }

  title.addEventListener('input', () =>
    counterFor(title, titleCounter, state.config.limits.title_max),
  );
  alt.addEventListener('input', updatePublishState);

  let activeIndex = -1;
  let options: TagCount[] = [];

  const closeSuggestions = (): void => {
    suggestions.hidden = true;
    clear(suggestions);
    options = [];
    activeIndex = -1;
    description.setAttribute('aria-expanded', 'false');
    description.removeAttribute('aria-activedescendant');
  };

  const paintSuggestions = (): void => {
    clear(suggestions);
    options.forEach((option, index) => {
      const node = el('div', {
        class: 'option',
        role: 'option',
        id: `tag-option-${index}`,
        'aria-selected': index === activeIndex ? 'true' : 'false',
        text: `#${option.tag} (${option.count})`,
      });
      node.addEventListener('mousedown', (event) => {
        event.preventDefault();
        activeIndex = index;
        applySuggestion();
      });
      suggestions.append(node);
    });
    suggestions.hidden = options.length === 0;
    description.setAttribute('aria-expanded', options.length > 0 ? 'true' : 'false');
    if (activeIndex >= 0 && options.length > 0) {
      description.setAttribute('aria-activedescendant', `tag-option-${activeIndex}`);
    } else {
      description.removeAttribute('aria-activedescendant');
    }
  };

  const applySuggestion = (): void => {
    const option = options[activeIndex];
    if (!option) return;
    const caret = description.selectionStart ?? description.value.length;
    const fragment = tagFragmentAt(description.value, caret);
    if (!fragment) return;
    const before = description.value.slice(0, fragment.start);
    const after = description.value.slice(caret);
    description.value = `${before}#${option.tag} ${after}`;
    const position = before.length + option.tag.length + 2;
    description.setSelectionRange(position, position);
    closeSuggestions();
    counterFor(description, descriptionCounter, state.config.limits.description_max);
  };

  const refreshSuggestions = async (): Promise<void> => {
    const caret = description.selectionStart ?? description.value.length;
    const fragment = tagFragmentAt(description.value, caret);
    if (!fragment) {
      closeSuggestions();
      return;
    }
    try {
      const data = await api.get<{ tags: TagCount[] }>(
        `/api/tags/suggest?prefix=${encodeURIComponent(fragment.fragment)}`,
      );
      options = data.tags;
      activeIndex = -1;
      paintSuggestions();
    } catch {
      closeSuggestions();
    }
  };

  description.addEventListener('input', () => {
    counterFor(description, descriptionCounter, state.config.limits.description_max);
    void refreshSuggestions();
  });

  description.addEventListener('keydown', (event) => {
    if (suggestions.hidden || options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(options.length - 1, activeIndex + 1);
      paintSuggestions();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      paintSuggestions();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && activeIndex >= 0) {
      event.preventDefault();
      applySuggestion();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSuggestions();
    }
  });

  let chosen: File | null = null;

  const imageProblem = async (file: File): Promise<string | null> => {
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!magicFormat(bytes)) return 'Use a PNG or JPEG image.';
    if (file.size > state.config.limits.image_max_bytes) {
      return `Images must be ${Math.floor(state.config.limits.image_max_bytes / 1000)} KB or smaller.`;
    }
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return 'Use a PNG or JPEG image.';
    const pixels = bitmap.width * bitmap.height;
    const ratio = bitmap.width / bitmap.height;
    bitmap.close();
    if (pixels > state.config.limits.image_max_pixels) {
      return `Images must be ${(state.config.limits.image_max_pixels / 1000000).toFixed(1)} megapixels or smaller.`;
    }
    if (ratio < 0.5 || ratio > 2) return 'Images must be between 1:2 and 2:1.';
    return null;
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0] ?? null;
    if (!file) return;
    clearFieldErrors(fields);
    void (async () => {
      const problem = await imageProblem(file);
      if (problem) {
        chosen = null;
        fieldError(chooseButton, problem);
        return;
      }
      chosen = file;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    })();
  });

  const loadBoards = async (): Promise<void> => {
    const data = await api.get<{ boards: BoardSummary[] }>('/api/boards/mine');
    clear(boardSelect);
    for (const board of data.boards) {
      boardSelect.append(el('option', { value: String(board.id), text: board.name }));
    }
    const preset = url.searchParams.get('board');
    if (preset && data.boards.some((board) => String(board.id) === preset)) {
      boardSelect.value = preset;
    }
    await loadSections();
  };

  const loadSections = async (): Promise<void> => {
    clear(sectionSelect);
    sectionSelect.append(el('option', { value: '', text: 'No section' }));
    if (!boardSelect.value) return;
    const board = await api.get<Board>(`/api/boards/${boardSelect.value}`);
    for (const section of board.order.sections) {
      sectionSelect.append(el('option', { value: String(section.id), text: section.name }));
    }
  };

  boardSelect.addEventListener('change', () => {
    void loadSections();
  });

  publish.addEventListener('click', () => {
    clearFieldErrors(fields);
    outage.hidden = true;
    void busy(publish, 'Publishing', async () => {
      if (!chosen) {
        fieldError(chooseButton, 'Use a PNG or JPEG image.');
        return;
      }
      const problem = await imageProblem(chosen);
      if (problem) {
        fieldError(chooseButton, problem);
        return;
      }
      const form = new FormData();
      form.set('image', chosen, chosen.name);
      form.set('title', title.value);
      form.set('description', description.value);
      form.set('alt', alt.value);
      form.set('source', source.value);
      form.set('board', boardSelect.value);
      form.set('section', sectionSelect.value);
      try {
        const pin = await api.post<Pin>('/api/pins', form);
        announce('Pin published');
        navigate(`/pin/${pin.id}`);
      } catch (error) {
        if (!(error instanceof ApiFailure)) {
          showAlert(failureMessage(error));
          return;
        }
        if (error.code === 'storage_unavailable') {
          outage.hidden = false;
          clear(outage);
          outage.append(
            el('span', { class: 'banner-icon', 'aria-hidden': 'true', text: '⚠' }),
            el('span', { text: "Images can't be uploaded right now. Your draft is kept." }),
          );
          showAlert("Images can't be uploaded right now. Your draft is kept.");
          return;
        }
        if (error.code === 'duplicate_image') {
          const board = error.body.board as { name: string } | undefined;
          fieldError(chooseButton, `You already saved this pin to ${board?.name ?? ''}`);
          return;
        }
        if (error.status === 415) {
          fieldError(chooseButton, 'Use a PNG or JPEG image.');
          return;
        }
        if (error.status === 413) {
          fieldError(
            chooseButton,
            `Images must be ${Math.floor(state.config.limits.image_max_bytes / 1000)} KB or smaller.`,
          );
          return;
        }
        if (error.field === 'title') {
          fieldError(title, 'Add a title.');
          return;
        }
        if (error.field === 'alt') {
          fieldError(alt, 'Add alt text so everyone knows what this pin shows.');
          return;
        }
        if (error.field === 'source') {
          fieldError(source, 'Use a link that starts with http:// or https://.');
          return;
        }
        if (error.field === 'image') {
          fieldError(chooseButton, 'Images must be between 1:2 and 2:1.');
          return;
        }
        showAlert(failureMessage(error));
      }
    });
  });

  fields.append(
    labelledField('Title', title),
    titleCounter,
    labelledField('Description', description),
    suggestions,
    descriptionCounter,
    labelledField('Alt text', alt),
    labelledField('Source link', source),
    labelledField('Board', boardSelect),
    labelledField('Section', sectionSelect),
    publish,
  );

  void loadBoards();
  return {};
}
