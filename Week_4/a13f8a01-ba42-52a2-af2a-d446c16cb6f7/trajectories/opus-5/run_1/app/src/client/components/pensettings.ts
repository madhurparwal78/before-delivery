import type { Pen, ShelfEntry, Visibility } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { h, replace, say, status, trapFocus } from '../dom';
import { me } from '../store';
import { combobox } from './combobox';

const VISIBILITIES: readonly Visibility[] = ['private', 'unlisted', 'public'];
const LABELS: Record<Visibility, string> = {
  private: 'Private',
  unlisted: 'Unlisted',
  public: 'Public',
};

export interface PenSettings {
  element: HTMLElement;
  open: () => void;
}

export const penSettingsDialog = (options: {
  pen: () => Pen;
  libraries: () => string[];
  shelf: () => ShelfEntry[];
  onLibraries: (libraries: string[]) => void;
  onPen: (pen: Pen) => void;
  onDeleted: () => void;
  trigger: HTMLElement;
}): PenSettings => {
  const settingsStatus = status('Settings status');
  const libraryChips = h('div', { class: 'chips' });
  const tagChips = h('div', { class: 'chips' });
  const deleteHolder = h('div', { class: 'alert-holder' });

  const radios = VISIBILITIES.map((visibility) =>
    h('input', { type: 'radio', name: 'visibility', value: visibility, class: 'radio' }),
  );
  const visibilityGroup = h(
    'div',
    { role: 'radiogroup', 'aria-label': 'Visibility', class: 'radios' },
    VISIBILITIES.map((visibility, index) =>
      h('label', { class: 'radio-row' }, [radios[index]!, h('span', { text: LABELS[visibility] })]),
    ),
  );

  const failure = (error: unknown): void => {
    if (error instanceof ApiFailure && error.code === 'unverified') {
      say(settingsStatus, copy.unverified(me()?.email ?? ''));
      return;
    }
    if (error instanceof ApiFailure && error.fields.tags) {
      say(settingsStatus, error.fields.tags);
      return;
    }
    throw error;
  };

  radios.forEach((radio, index) => {
    radio.addEventListener('change', async () => {
      const chosen = VISIBILITIES[index]!;
      try {
        const updated = await api.patch<Pen>(`/api/pens/${options.pen().id}`, { visibility: chosen });
        options.onPen(updated);
        say(settingsStatus, copy.visibilityChanged(chosen));
      } catch (error) {
        paint();
        failure(error);
      }
    });
  });

  const addTag = h('input', { type: 'text', 'aria-label': 'Add tag', class: 'field' });
  addTag.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const tag = addTag.value.trim().toLowerCase();
    if (tag.length === 0) return;
    try {
      const updated = await api.patch<Pen>(`/api/pens/${options.pen().id}`, {
        tags: [...options.pen().tags, tag],
      });
      options.onPen(updated);
      addTag.value = '';
      paint();
      say(settingsStatus, '');
    } catch (error) {
      failure(error);
    }
  });

  const removeTag = async (tag: string): Promise<void> => {
    const updated = await api.patch<Pen>(`/api/pens/${options.pen().id}`, {
      tags: options.pen().tags.filter((candidate) => candidate !== tag),
    });
    options.onPen(updated);
    paint();
  };

  const addLibrary = combobox({
    label: 'Add library',
    options: () => options.shelf().map((entry) => ({ id: entry.id, label: entry.id })),
    onChoose: (option, text) => {
      if (!option) {
        say(settingsStatus, copy.notOnShelf(text));
        return;
      }
      const libraries = options.libraries();
      if (!libraries.includes(option.id)) options.onLibraries([...libraries, option.id]);
      addLibrary.input.value = '';
      addLibrary.refresh();
      paint();
      say(settingsStatus, '');
    },
  });

  const confirmDelete = (): void => {
    const pen = options.pen();
    const cancel = h('button', { type: 'button', class: 'ghost', text: 'Cancel' });
    const confirm = h('button', { type: 'button', class: 'action accent', text: 'Delete' });
    const dialog = h(
      'div',
      { role: 'alertdialog', 'aria-label': 'Delete this pen?', class: 'panel panel-error dialog' },
      [h('p', { text: copy.deleteConfirm(pen.title) }), confirm, cancel],
    );
    const close = (): void => {
      replace(deleteHolder, []);
      deleteButton.focus();
    };
    cancel.addEventListener('click', close);
    dialog.addEventListener('keydown', (event) => {
      // The confirmation sits inside Pen settings, so its keys must not reach the outer dialog.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog)(event);
    });
    confirm.addEventListener('click', async () => {
      try {
        await api.delete(`/api/pens/${pen.id}`);
        window.sessionStorage.setItem('ashlar.deleted', pen.title);
        options.onDeleted();
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
          close();
          say(settingsStatus, copy.deleteStorageDown);
          return;
        }
        throw error;
      }
    });
    replace(deleteHolder, [dialog]);
    cancel.focus();
  };

  const deleteButton = h('button', {
    type: 'button',
    class: 'ghost',
    text: 'Delete pen',
    onclick: confirmDelete,
  });
  const closeButton = h('button', { type: 'button', class: 'ghost', text: 'Close' });

  const element = h(
    'div',
    { role: 'dialog', 'aria-label': 'Pen settings', class: 'dialog panel', hidden: true },
    [
      visibilityGroup,
      h('h3', { text: 'Libraries' }),
      addLibrary.root,
      libraryChips,
      h('h3', { text: 'Tags' }),
      addTag,
      tagChips,
      deleteButton,
      deleteHolder,
      closeButton,
      settingsStatus,
    ],
  );

  const paint = (): void => {
    const pen = options.pen();
    radios.forEach((radio, index) => {
      radio.checked = VISIBILITIES[index] === pen.visibility;
    });
    replace(
      libraryChips,
      options.libraries().map((id) =>
        h('span', { class: 'chip' }, [
          h('span', { class: 'mono', text: id }),
          h('button', {
            type: 'button',
            class: 'ghost',
            text: `Remove ${id}`,
            onclick: () => {
              options.onLibraries(options.libraries().filter((candidate) => candidate !== id));
              paint();
              addLibrary.input.focus();
            },
          }),
        ]),
      ),
    );
    replace(
      tagChips,
      pen.tags.map((tag) =>
        h('span', { class: 'chip' }, [
          h('span', { text: tag }),
          h('button', {
            type: 'button',
            class: 'ghost',
            text: `Remove tag ${tag}`,
            onclick: () => void removeTag(tag).then(() => addTag.focus()).catch(failure),
          }),
        ]),
      ),
    );
  };

  const close = (): void => {
    element.hidden = true;
    replace(deleteHolder, []);
    options.trigger.focus();
  };
  closeButton.addEventListener('click', close);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(element)(event);
  });

  return {
    element,
    open: () => {
      paint();
      addLibrary.refresh();
      element.hidden = false;
      (radios.find((radio) => radio.checked) ?? radios[0]!).focus();
    },
  };
};
