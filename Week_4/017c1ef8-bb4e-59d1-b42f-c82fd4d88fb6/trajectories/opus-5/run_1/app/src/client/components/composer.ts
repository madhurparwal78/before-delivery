import { codePoints, counterText } from '../../shared/format';
import { mentionSuggestions, type MentionCandidate } from '../../shared/mentions';
import { api, newIdempotencyKey } from '../api';
import { announce, dialog, h, showAlert } from '../dom';
import { cfg } from '../state';
import { S } from '../strings';
import type { PostData } from './post';
import { richText } from './text';

type Suggestion = MentionCandidate;

export type ComposerOptions = {
  sharedPost?: PostData;
  opener: HTMLElement | null;
  onDone: () => void;
};

/** The post composer: counter, mention suggestions, photo and Post. */
export function openComposer(options: ComposerOptions): void {
  let connections: Suggestion[] = [];
  void api
    .get<{ connections: Suggestion[] }>('/api/network')
    .then((result) => {
      if (result.ok) connections = result.body.connections;
    });
  let photoId: string | null = null;
  let photoPending = false;
  let suggestions: Suggestion[] = [];
  let activeIndex = 0;
  let listOpen = false;

  dialog(
    'Create a post',
    (close) => {
      const field = h('textarea', {
        'aria-label': 'What do you want to talk about?',
        class: 'input composer-field',
        rows: '5',
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
      }) as HTMLTextAreaElement;

      const counter = h('p', {
        role: 'status',
        'aria-label': 'Character count',
        class: 'counter tabular',
        text: counterText(0, cfg().post_max_chars),
      });

      const listbox = h('ul', {
        role: 'listbox',
        'aria-label': 'Mention suggestions',
        class: 'listbox',
        hidden: true,
      });

      const photoInput = h('input', {
        type: 'file',
        'aria-label': 'Photo',
        accept: 'image/jpeg,image/png',
        class: 'file-input',
        change: () => void startUpload(),
      }) as HTMLInputElement;

      const addPhoto = h(
        'button',
        { type: 'button', class: 'button quiet', click: () => photoInput.click() },
        ['Add a photo'],
      );

      const removePhoto = h(
        'button',
        {
          type: 'button',
          class: 'button quiet',
          hidden: true,
          click: () => {
            photoId = null;
            photoPending = false;
            photoInput.value = '';
            removePhoto.setAttribute('hidden', '');
            updateState();
          },
        },
        ['Remove photo'],
      );

      const post = h('button', { type: 'button', class: 'button', disabled: true }, ['Post']);
      const body = h('div', { class: 'dialog-body' });

      post.addEventListener('click', async () => {
        post.setAttribute('disabled', '');
        const result = await api.post<{ error?: string; fields?: Record<string, string> }>(
          '/api/posts',
          {
            text: field.value,
            photo_id: photoId,
            shared_post_id: options.sharedPost ? options.sharedPost.id : null,
          },
          { 'Idempotency-Key': newIdempotencyKey() },
        );
        if (result.ok) {
          announce('Feed announcements', S.announce.postPublished);
          close();
          options.onDone();
          return;
        }
        post.removeAttribute('disabled');
        announce('Feed announcements', S.announce.postNotPublished);
        showAlert(body, result.body.fields?.text ?? S.alert.somethingWrong);
      });

      field.addEventListener('input', () => {
        updateCounter();
        refreshSuggestions();
      });
      field.addEventListener('keydown', (event) => {
        if (!listOpen) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          activeIndex =
            event.key === 'ArrowDown'
              ? (activeIndex + 1) % suggestions.length
              : (activeIndex - 1 + suggestions.length) % suggestions.length;
          drawSuggestions();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          pick(suggestions[activeIndex]);
        } else if (event.key === 'Tab') {
          closeList();
        }
      });

      body.append(field, counter, listbox);
      if (options.sharedPost) {
        const shared = h('section', { 'aria-label': 'Shared post', class: 'shared' }, [
          h('p', { class: 'person-name small', text: options.sharedPost.author.name }),
          richText(options.sharedPost.text, options.sharedPost.mentions),
        ]);
        body.append(shared);
      }
      body.append(h('div', { class: 'row' }, [addPhoto, photoInput, removePhoto]));

      updateState();
      return [h('h2', { text: 'Create a post' }), body, post];

      function updateCounter(): void {
        counter.textContent = counterText(codePoints(field.value), cfg().post_max_chars);
        updateState();
      }

      function updateState(): void {
        const used = codePoints(field.value);
        const blocked = used === 0 || field.value.trim() === '' || used > cfg().post_max_chars || photoPending;
        if (blocked) post.setAttribute('disabled', '');
        else post.removeAttribute('disabled');
      }

      async function startUpload(): Promise<void> {
        const file = photoInput.files?.[0];
        if (!file) return;
        photoPending = true;
        updateState();
        announce('Feed announcements', S.announce.uploading);
        const result = await api.upload<{ photo_id: string; error?: string; limit?: number }>(
          '/api/uploads/photo',
          file,
        );
        photoPending = false;
        if (result.ok) {
          photoId = result.body.photo_id;
          removePhoto.removeAttribute('hidden');
          announce('Feed announcements', S.announce.photoAttached);
        } else {
          photoInput.value = '';
          const error = result.body.error;
          showAlert(
            body,
            error === 'photo_too_large'
              ? S.alert.photoTooLarge(result.body.limit ?? cfg().photo_max_bytes)
              : error === 'photo_type'
                ? S.alert.photoWrongType
                : error === 'storage_unavailable'
                  ? S.alert.storageUnreachable
                  : S.alert.somethingWrong,
          );
        }
        updateState();
      }

      function fragment(): { text: string; start: number } | null {
        const caret = field.selectionStart ?? 0;
        const before = field.value.slice(0, caret);
        const at = before.lastIndexOf('@');
        if (at === -1) return null;
        if (at > 0 && !/\s/.test(before[at - 1])) return null;
        const typed = before.slice(at + 1);
        if (typed.length < 1 || /\s/.test(typed)) return null;
        return { text: typed, start: at };
      }

      function closeList(): void {
        listOpen = false;
        listbox.setAttribute('hidden', '');
        field.setAttribute('aria-expanded', 'false');
        field.removeAttribute('aria-activedescendant');
      }

      function refreshSuggestions(): void {
        const found = fragment();
        if (!found) {
          closeList();
          return;
        }
        suggestions = mentionSuggestions(connections, found.text);
        if (suggestions.length === 0) {
          closeList();
          return;
        }
        activeIndex = 0;
        listOpen = true;
        listbox.removeAttribute('hidden');
        field.setAttribute('aria-expanded', 'true');
        drawSuggestions();
      }

      function drawSuggestions(): void {
        listbox.replaceChildren();
        suggestions.forEach((suggestion, index) => {
          const id = `mention-option-${index}`;
          listbox.append(
            h(
              'li',
              {
                role: 'option',
                id,
                'aria-label': `${suggestion.name} (@${suggestion.handle})`,
                'aria-selected': index === activeIndex ? 'true' : 'false',
                class: index === activeIndex ? 'option active' : 'option',
                click: () => pick(suggestion),
              },
              [`${suggestion.name} (@${suggestion.handle})`],
            ),
          );
        });
        field.setAttribute('aria-activedescendant', `mention-option-${activeIndex}`);
      }

      function pick(suggestion: Suggestion): void {
        const found = fragment();
        if (!suggestion || !found) return;
        const caret = field.selectionStart ?? 0;
        const after = field.value.slice(caret);
        const replacement = `@${suggestion.handle} `;
        field.value = `${field.value.slice(0, found.start)}${replacement}${after}`;
        const position = found.start + replacement.length;
        field.setSelectionRange(position, position);
        closeList();
        field.focus();
        updateCounter();
      }
    },
    options.opener,
    {
      onEscape: () => {
        if (!listOpen) return false;
        listOpen = false;
        const node = document.querySelector('[aria-label="Mention suggestions"]');
        node?.setAttribute('hidden', '');
        (document.querySelector('.composer-field') as HTMLTextAreaElement | null)?.focus();
        return true;
      },
    },
  );
}
