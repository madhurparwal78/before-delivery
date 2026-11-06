// The story screen: formatting toolbar, rich editor, Save story and Publish story,
// with versioned saves and the Story status live region.
import { api, apiOk, failOf, type DropStaff } from './api.js';
import { el, buttonEl, liveRegion, announce, pending, openDialog } from './ui.js';
import { renderHeader, renderAuthNeeded, renderNotFoundScreen, ensureMember } from './staff-helpers.js';
import { marketTimeWords, parseInstant } from './format.js';

interface StoryState { html: string; version: number; savedBy: string | null; savedAt: string; publishedHtml: string | null; publishedAt: string | null; }

export async function renderStory(root: HTMLElement, dropId: string): Promise<HTMLElement> {
  if (!(await ensureMember())) return renderAuthNeeded(root, `/studio/drops/${dropId}/story`);
  renderHeader('/studio/press');
  let drop: DropStaff | null = null;
  try { drop = await apiOk<DropStaff>('GET', `/api/drops/${dropId}`); } catch { drop = null; }
  if (!drop) return renderNotFoundScreen(root);
  const h = el('h1', {}, `Story · ${drop.name}`);
  const status = liveRegion('Story status');
  let story: StoryState | null = null;
  try { story = await apiOk<StoryState>('GET', `/api/drops/${dropId}/story`); } catch { story = null; }
  if (!story) return renderNotFoundScreen(root);

  const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' });
  const editor = el('div', { class: 'story-editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Story' }) as HTMLElement;
  editor.innerHTML = story.html;

  function exec(command: string, value?: string): void {
    document.execCommand(command, false, value);
    editor.focus();
  }

  for (const [label, command] of [['Heading', 'h2'], ['Subheading', 'h3'], ['Bold', 'bold'], ['Italic', 'italic'], ['Bulleted list', 'insertUnorderedList'], ['Numbered list', 'insertOrderedList']] as [string, string][]) {
    toolbar.append(buttonEl({ text: label, onclick: () => {
      if (command === 'h2' || command === 'h3') exec('formatBlock', `<${command}>`);
      else exec(command);
    } }));
  }
  toolbar.append(buttonEl({ text: 'Link', onclick: () => {
    openDialog({
      label: 'Add link', opener: null,
      body: (dlg) => {
        const address = el('input', { type: 'text', 'aria-label': 'Link address', placeholder: 'https://example.com' }) as HTMLInputElement;
        const add = buttonEl({ class: 'btn btn-primary', text: 'Add link', onclick: () => {
          const selection = window.getSelection();
          const text = selection?.toString() ?? '';
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const a = document.createElement('a');
            a.href = address.value;
            a.textContent = text || address.value;
            range.insertNode(a);
          }
          dlg.root.close();
          editor.focus();
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, el('label', { class: 'field' }, el('span', { class: 'label', text: 'Link address' }), address), el('div', { class: 'btn-row' }, add, cancel));
      }
    });
  } }));

  const saveBtn = buttonEl({ class: 'btn btn-primary', text: 'Save story', onclick: async () => {
    const restore = pending(saveBtn, 'Saving story…');
    try {
      const res = await api<StoryState>('PUT', `/api/drops/${dropId}/story`, { version: story!.version, html: editor.innerHTML });
      story = res.data!;
      announce(status, `Story saved at ${marketTimeWords(parseInstant(res.data!.savedAt), 'copenhagen', 'Copenhagen')}.`);
    } catch (err) {
      const fail = failOf(err);
      if (fail.status === 412) announce(status, `Not saved: ${fail.savedBy} saved a newer version at ${fail.savedAt}. Your text is still in the editor.`, true);
      else if (fail.status === 401) announce(status, 'Your session ended. Sign in again to continue — your draft is kept.', true);
      else announce(status, fail.message, true);
    } finally { restore(); }
  } });

  const publishBtn = buttonEl({ class: 'btn', text: 'Publish story', onclick: () => {
    openDialog({
      label: 'Publish story', opener: publishBtn,
      body: (dlg) => {
        const publish = buttonEl({ class: 'btn btn-primary', text: 'Publish', onclick: () => {
          dlg.onResult(api('POST', `/api/drops/${dropId}/story/publish`, { version: story!.version }), (ok, fail) => {
            if (ok) announce(status, 'Story published.');
            else if (fail?.status === 412) announce(status, `Not saved: ${fail.savedBy} saved a newer version at ${fail.savedAt}.`, true);
            else announce(status, fail?.message ?? 'Publishing failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, el('p', { text: 'Publish this story to the drop page and the press preview?' }), el('div', { class: 'btn-row' }, publish, cancel));
      }
    });
  } });

  root.append(h, el('section', { class: 'panel col-12' }, toolbar, editor,
    el('div', { class: 'btn-row', style: 'margin-top: 14px;' }, saveBtn, publishBtn), status));
  return h;
}
